/**
 * The consult service.
 *
 * One place owns the panel lifecycle and every guard:
 *   convene → (record opinion rounds) → verdict → archive
 *
 * Two product rules live here, not in prose:
 *   1. Explicit-use gate: the model may only convene a panel when the user
 *      explicitly asked for it (a `/experts` command or a panel click is a user
 *      action; a model-initiated convene must carry the user's own words).
 *   2. Customisation: presets are code, the user's experts/teams are data; a
 *      malformed payload cannot corrupt the catalog.
 *
 * Guards are real, not advisory: a verdict without opinions (in standard/deep
 * mode), a verdict that ignores a proven disagreement, or a verdict that
 * overwrites an existing one all fail loudly. The tool, the command and the
 * panel route all call exactly these methods, so no entry point can skip a gate.
 */

import {
  buildBrief,
  detectDisagreements,
  estimateBudget,
  modeLabel,
  MODES,
  PROTOCOL_RULES,
  roundsFor,
  auditOpinion,
  LIMITS,
} from './protocol.js'
import { getTeam, TEAMS, teamName } from './teams.js'
import { EXPERTS, EXPERT_GROUPS, getExpert, expertName } from './experts.js'
import { DOMAIN_PACKS, DOMAIN_EXPERTS, DOMAIN_TEAMS, getDomain, domainForTeam, DOMAIN_BY_ID } from './domains.js'
import { createPanelExecutor } from './executor.js'
import { llmAvailable } from './llm.js'
import {
  addHistoryEntry,
  cleanExpertInput,
  cleanTeamInput,
  emptyCustomization,
  MAX_CUSTOM_EXPERTS,
  MAX_CUSTOM_TEAMS,
  mergeExperts,
  mergeTeams,
  normalizeCustomization,
  summarizeCustomization,
} from './custom.js'
import { checkIsolation, BOUNDARY_NOTE } from './isolation.js'
import { normalizeConsult, normalizeOpinion, normalizeRound, normalizeVerdict, summarizeConsult } from './records.js'
import { asArray, clamp, consultId, estimateTokens, nowMs, truncate } from './util.js'

function fail(message) {
  const error = new Error(message)
  error.userMessage = message
  return error
}

function clampInt(value, min, max, fallback) {
  const number = Math.trunc(Number(value))
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

export function createExpertCouncilService({ store, log = console, config = {}, ctx = null }) {
  const policy = {
    requireExplicitConsent: config.requireExplicitConsent !== false,
  }
  const runConfig = {
    maxParallel: clampInt(config.maxParallel, 1, 8, 4),
    callTimeoutMs: clampInt(config.callTimeoutMs, 5000, 300000, 90000),
    runTimeoutMs: clampInt(config.runTimeoutMs, 30000, 1800000, 600000),
    waitMs: clampInt(config.waitMs, 1000, 600000, 240000),
    temperature: Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.55,
    reasoningEffort: typeof config.reasoningEffort === 'string' && config.reasoningEffort ? config.reasoningEffort : 'low',
    provider: typeof config.provider === 'string' && config.provider ? config.provider : null,
    model: typeof config.model === 'string' && config.model ? config.model : null,
  }
  /** In-memory live runs: runId -> entry. Finished summaries live on the consult. */
  const activeRuns = new Map()
  const executor = createPanelExecutor({ log })
  const BASE_EXPERTS = [...EXPERTS, ...DOMAIN_EXPERTS]
  const BASE_TEAMS = [...TEAMS, ...DOMAIN_TEAMS]

  function baseExperts() {
    return BASE_EXPERTS
  }
  function baseTeams() {
    return BASE_TEAMS
  }

  async function loadCustom() {
    return normalizeCustomization(await store.customization())
  }

  /** Merge presets with the user's customisation; the only catalog source. */
  async function catalog() {
    const custom = await loadCustom()
    const experts = mergeExperts(BASE_EXPERTS, custom)
    const teams = mergeTeams(BASE_TEAMS, custom, experts)
    const expertMap = new Map(experts.map((expert) => [expert.id, expert]))
    const teamMap = new Map(teams.map((team) => [team.id, team]))
    return { custom, experts, teams, expertMap, teamMap }
  }

  function describeExpert(expert) {
    return {
      id: expert.id,
      name: expert.name,
      group: expert.group,
      mandate: expert.mandate,
      lens: expert.lens,
      asks: expert.asks.slice(),
      redLines: expert.redLines.slice(),
      misses: expert.misses,
      pairs: expert.pairs,
      conflicts: expert.conflicts ?? [],
      budget: expert.budget,
      domain: expert.domain ?? null,
      custom: expert.custom === true,
      preset: expert.preset === true,
      updatedAt: expert.updatedAt ?? null,
    }
  }

  function describeTeam(team, expertMap) {
    return {
      id: team.id,
      name: team.name,
      tagline: team.tagline,
      intent: team.intent,
      defaultMode: team.defaultMode,
      members: team.members.map((member) => {
        const expert = expertMap?.get(member.id) ?? getExpert(member.id)
        return {
          id: member.id,
          role: member.role,
          name: expert?.name ?? { zh: member.id, en: member.id },
          mandate: expert?.mandate ?? '',
          custom: expert?.custom === true,
        }
      }),
      agenda: team.agenda.slice(),
      artifacts: team.artifacts.slice(),
      budget: team.budget,
      domain: team.domain ?? null,
      estimates: {
        lean: estimateBudget(team, 'lean').cap,
        standard: estimateBudget(team, 'standard').cap,
        deep: estimateBudget(team, 'deep').cap,
      },
      custom: team.custom === true,
      preset: team.preset === true,
      incomplete: team.incomplete === true,
    }
  }

  function resolveConsent({ actor = 'agent', via = null, explicitRequest = false, requestQuote = null } = {}) {
    if (actor === 'user') {
      return { ok: true, consent: { kind: 'user-action', via: via ?? 'panel', at: nowMs() } }
    }
    if (!policy.requireExplicitConsent) {
      return { ok: true, consent: { kind: 'explicit-request', via: 'config', at: nowMs() } }
    }
    const quote = typeof requestQuote === 'string' ? requestQuote.trim() : ''
    if (explicitRequest !== true) {
      return {
        ok: false,
        error:
          '专家团只在你明确呼叫时使用：模型不能主动召开会诊。若用户确实点名要用专家团，请带 explicit_request:true 和 request_quote（用户原话）再调用；' +
          '或者由用户用 /experts、面板发起。',
      }
    }
    if (quote.length < 2) {
      return {
        ok: false,
        error: '缺少 request_quote：请把用户明确点名专家团的原话放进来（至少 2 个字），会诊台账要留痕。',
      }
    }
    return { ok: true, consent: { kind: 'explicit-request', via: 'tool', quote: truncate(quote, 300), at: nowMs() } }
  }

  /**
   * Catalogue mutations need the same evidence as convenes when a model does
   * them: the user's own words. Panel/command actions are `actor:'user'` and
   * bypass this.
   */
  function requireMutationConsent(actor, requestQuote) {
    if (actor === 'user' || !policy.requireExplicitConsent) {
      return typeof requestQuote === 'string' && requestQuote.trim().length > 0 ? truncate(requestQuote.trim(), 300) : null
    }
    const quote = typeof requestQuote === 'string' ? requestQuote.trim() : ''
    if (quote.length < 2) {
      throw fail(
        '调整专家团也需要你的原话：请带 request_quote（用户是怎么说的）。' +
          '或者由用户在面板「用一句话调整」里发起。',
      )
    }
    return truncate(quote, 300)
  }

  async function teams() {
    const { teams: list, expertMap } = await catalog()
    return list.map((team) => describeTeam(team, expertMap))
  }

  /** Professional domain packs (each ships a team staffed by domain experts). */
  async function domains() {
    const { expertMap } = await catalog()
    return DOMAIN_PACKS.map((pack) => ({
      id: pack.id,
      name: pack.name,
      tagline: pack.tagline,
      description: pack.description,
      keywords: [...(pack.keywords ?? [])],
      defaultMode: pack.defaultMode,
      budget: pack.budget,
      evidence: pack.evidence,
      artifacts: [...(pack.artifacts ?? [])],
      agenda: [...(pack.team?.agenda ?? pack.agenda ?? [])],
      experts: pack.experts.map((expert) => ({
        id: expert.id,
        name: expert.name,
        group: expert.group,
        mandate: expert.mandate,
        lens: expert.lens,
        redLines: [...(expert.redLines ?? [])],
      })),
      team: {
        id: pack.team.id,
        name: pack.team.name,
        tagline: pack.team.tagline,
        defaultMode: pack.team.defaultMode,
        members: pack.team.members.map((member) => {
          const expert = expertMap.get(member.id)
          return { id: member.id, role: member.role, name: expert?.name ?? { zh: member.id, en: member.id } }
        }),
        budget: pack.team.budget,
        estimates: {
          lean: estimateBudget(pack.team, 'lean').cap,
          standard: estimateBudget(pack.team, 'standard').cap,
          deep: estimateBudget(pack.team, 'deep').cap,
        },
      },
    }))
  }  async function experts() {
    const { experts: list } = await catalog()
    return list.map(describeExpert)
  }

  function protocol() {
    return {
      rules: PROTOCOL_RULES,
      modes: MODES,
      limits: LIMITS,
      groups: EXPERT_GROUPS,
      boundary: BOUNDARY_NOTE,
    }
  }

  function getPolicy() {
    return {
      requireExplicitConsent: policy.requireExplicitConsent,
      isolation: checkIsolation(),
      boundary: BOUNDARY_NOTE,
    }
  }

  async function customizationState() {
    const { custom } = await catalog()
    return summarizeCustomization(custom)
  }

  /**
   * Natural-language customisation brief.
   *
   * Most users will not read the config schema, so the panel (and the
   * `/experts 调整` command) hands their plain-language request to the model
   * together with exactly what it may change and the rules for doing it safely.
   * This is the "describe it, don't configure it" path.
   */
  async function customizationBrief({ request } = {}) {
    const text = typeof request === 'string' ? request.trim() : ''
    if (text.length < 2) throw fail('先用一句自然语言说清楚你想怎么调整专家团（至少 2 个字）。')
    const { experts: expertList, teams: teamList, custom } = await catalog()
    const expertLine = expertList.map((expert) => `${expert.id}(${expert.name.zh}${expert.custom ? '*' : ''})`).join('、')
    const teamLine = teamList
      .map((team) => `${team.id}(${team.members.map((member) => member.id).join('/')}${team.custom ? '*' : ''})`)
      .join('、')
    const brief = [
      '# 专家团 · 自然语言调整简报',
      '',
      `**用户原话**：${text}`,
      '',
      '## 当前目录',
      `- 专家（* = 已被你自定义）：${expertLine}`,
      `- 团队（* = 已被你自定义）：${teamLine}`,
      `- 已隐藏：专家 ${custom.hiddenExperts.length} 个、团队 ${custom.hiddenTeams.length} 个`,
      '',
      '## 你可以做的四件事（都用 expert_council 工具）',
      '1. `{action:"save_expert", expert:{…}, request_quote:"<用户原话>"}` — 新增专家；同 id 则是覆盖内置/自定义。',
      '2. `{action:"save_team", team:{…}, request_quote:"<用户原话>"}` — 新增团队；同 id 覆盖。',
      '3. `{action:"delete", kind:"expert"|"team", id:"…", request_quote:"<用户原话>"}` — 内置=隐藏，自定义=删除。',
      '4. `{action:"reset", confirm:true, request_quote:"<用户原话>"}` — 恢复出厂目录（破坏性，只在用户明确要求时用）。',
      '',
      '## 字段速查',
      '- expert：`id, name:{zh,en}, group(structure|risk|user|execution), mandate, lens, asks[], redLines[], misses, pairs[], budget:{standard,deep}`',
      '- team：`id, name:{zh,en}, tagline, intent, defaultMode(lean|standard|deep), members:[{id,role:"lead"|"member"}], agenda[], artifacts[], budget:{lean,standard,deep}`',
      '- 约束：恰好一个主持；成员必须是已存在专家；预算 lean ≤ standard ≤ deep；id 是小写字母开头的短横线串。',
      '',
      '## 规则（必须遵守）',
      '1. 先用 1 行复述你理解的调整目标，再动手（写在回复里，不要写进工具参数）。',
      '2. 破坏性操作（删除/重置/覆盖内置）先说明影响；用户没有明确说要删，就选可回退的做法（新增而不是删旧的）。',
      '3. 一次只做一组自然变更；新团队引用的新专家要先 save_expert，再 save_team。',
      '4. 不要编造 id；新增 id 用小写字母 + 数字 + `-`，语义清晰（如 `privacy-officer`、`launch-check`）。',
      '5. 完成后调用 `expert_council({action:"customization"})` 复核，并向用户汇报：新增/覆盖/隐藏了什么、影响哪些团队、怎么回退（删掉即可，或面板重置）。',
      '',
      '## 原话 → 调用 示例',
      '- 「加一个只看数据授权的合规专家」→ `save_expert`，group=risk，mandate/lens/asks/redLines/misses 围绕数据授权与最小权限。',
      '- 「建一个上线前检查团：SRE 主持，产品和安全参加」→ `save_team`，members=[{id:"sre",role:"lead"},{id:"product"},{id:"security"}]，defaultMode=lean。',
      '- 「把架构评审团默认改成轻会诊」→ `save_team` 覆盖 `architecture`，defaultMode="lean"，其余字段照抄现有。',
      '',
      '## 收尾',
      '用 3–6 行汇报改动与回退方式即可；不要贴出整份简报或原始 JSON。',
    ].join('\n')
    return {
      ok: true,
      request: text,
      brief,
      expertCount: expertList.length,
      teamCount: teamList.length,
      next: '按简报构造 save_expert / save_team / delete 调用（带 request_quote），完成后用 customization 复核。',
    }
  }

  /** Create one consult and render its brief. Refuses without explicit consent. */
  async function convene({
    teamId,
    domain = null,
    question,
    context = null,
    mode = null,
    budgetCap = null,
    sessionId = null,
    actor = 'agent',
    via = null,
    explicitRequest = false,
    requestQuote = null,
  } = {}) {
    const resolved = resolveConsent({ actor, via, explicitRequest, requestQuote })
    if (!resolved.ok) throw fail(resolved.error)
    let resolvedDomain = null
    if (domain) {
      resolvedDomain = DOMAIN_BY_ID.get(String(domain).trim()) ?? null
      if (!resolvedDomain) throw fail(`未知领域：${domain}；可用：${DOMAIN_PACKS.map((pack) => pack.id).join('、')}`)
    }
    const effectiveTeamId = teamId || resolvedDomain?.team?.id || ''
    const { teamMap, expertMap } = await catalog()
    const team = teamMap.get(typeof effectiveTeamId === 'string' ? effectiveTeamId.trim() : '')
    if (!team) {
      throw fail(`未知团队：${effectiveTeamId || '（空）'}；可用：${[...teamMap.keys()].join('、')}`)
    }
    const teamDomain = team.domain ? DOMAIN_BY_ID.get(team.domain) ?? null : null
    if (resolvedDomain && teamDomain && resolvedDomain.id !== teamDomain.id) {
      throw fail(`团队 ${team.id} 属于领域 ${teamDomain.id}，与 domain=${resolvedDomain.id} 不一致`)
    }
    const activeDomain = resolvedDomain ?? teamDomain
    if (team.incomplete) throw fail(`团队 ${team.id} 没有可用专家（成员可能已被删除）；先在面板里编辑团队或恢复专家。`)
    const resolvedTeam = { ...team, members: team.members.map((member) => ({ ...member, expert: expertMap.get(member.id) })) }
    const text = typeof question === 'string' ? question.trim() : ''
    if (text.length < LIMITS.questionMin) {
      throw fail(`问题太短（至少 ${LIMITS.questionMin} 个字）：把要决定的事写成一句话再来。`)
    }
    const depth = mode ?? team.defaultMode
    if (!MODES.some((item) => item.id === depth)) throw fail(`未知会诊档位：${depth}`)
    const estimate = estimateBudget(team, depth)
    const cap = budgetCap === null || budgetCap === undefined ? estimate.cap : clamp(Math.trunc(Number(budgetCap)), 200, 20000)
    const budget = { ...estimate, cap, custom: cap !== estimate.cap }
    const consult = normalizeConsult({
      id: consultId(),
      teamId: team.id,
      domainId: activeDomain?.id ?? null,
      mode: depth,
      question: text,
      context: context ?? null,
      status: 'open',
      consent: resolved.consent,
      budget,
      rounds: [],
      createdAt: nowMs(),
      sessionId,
    })
    const brief = buildBrief({ team: resolvedTeam, mode: depth, question: text, context: consult.context, budget, domain: activeDomain })
      .replace('\n\n', `\n\n**会诊 ID**：\`${consult.id}\`（用 expert_council 工具写回意见与裁决）\n\n`)
    const saved = await store.upsert(consult)
    log.info?.(
      `convened ${saved.id} · ${team.id} · ${depth} · consent=${saved.consent?.kind ?? 'none'}${via ? `/${via}` : ''}`,
    )
    return {
      ok: true,
      consultId: saved.id,
      team: { id: team.id, name: team.name, custom: team.custom === true, domain: activeDomain?.id ?? null },
      domain: activeDomain ? { id: activeDomain.id, name: activeDomain.name } : null,
      mode: depth,
      modeLabel: modeLabel(depth),
      budget: saved.budget,
      consent: saved.consent,
      brief,
      next:
        depth === 'lean'
          ? '可执行真实会诊：expert_council({action:"run", id:"' + saved.id + '"})；或按简报人工检查后 verdict。'
          : '可执行真实会诊：expert_council({action:"run", id:"' + saved.id + '"})，Host 会并行调用每位专家。',
    }
  }

  /** Append one opinion round and compute the cross-examination agenda. */
  async function record({ id, round = null, opinions = [], note = null } = {}) {
    const consult = await requireConsult(id)
    if (consult.status !== 'open') throw fail(`会诊已${consult.status === 'verdict' ? '裁决' : '归档'}，不能再写意见；先新建一次会诊。`)
    const { teamMap, expertMap } = await catalog()
    const team = teamMap.get(consult.teamId)
    if (!team) throw fail(`会诊引用的团队不存在：${consult.teamId}`)
    const memberIds = team.members.map((member) => member.id)
    const normalized = asArray(opinions)
      .slice(0, LIMITS.opinionsMaxPerRound)
      .map((opinion) => normalizeOpinion(opinion, { teamIds: memberIds }))
    if (normalized.length === 0) throw fail('opinions 为空：至少写一位专家的意见。')
    const outsiders = normalized.filter((opinion) => !opinion.inTeam)
    if (outsiders.length > 0) {
      throw fail(`专家不在本团：${outsiders.map((item) => item.expert || '（空）').join('、')}；本团成员：${memberIds.join('、')}`)
    }
    const index = Math.max(1, Math.trunc(Number(round) || consult.rounds.length + 1))
    if (index > LIMITS.roundsMax) throw fail(`最多 ${LIMITS.roundsMax} 轮；超过就应当裁决。`)
    if (index > 1 && consult.rounds.length < index - 1) throw fail(`第 ${index} 轮之前缺少第 ${index - 1} 轮意见。`)
    const normalizedRound = normalizeRound({ round: index, at: nowMs(), opinions: normalized, tokens: 0, note }, index - 1)
    normalizedRound.opinions = normalized
    normalizedRound.tokens = normalized.reduce((sum, opinion) => sum + opinion.tokens, 0)
    const existing = consult.rounds.filter((item) => item.round !== index)
    const rounds = [...existing, normalizedRound].sort((a, b) => a.round - b.round)
    // Cross-examination targets the *current* round: a point already answered in
    // round 1 must not reappear as a fresh disagreement in round 2, and one lens
    // revising itself across rounds is a revision rather than a conflict.
    const disagreements = detectDisagreements(normalized)
    const evidence = normalized.map((opinion) => ({ expert: opinion.expert, warnings: auditOpinion(opinion).warnings }))
    const evidenceWarnings = evidence.filter((item) => item.warnings.length > 0)
    const updated = normalizeConsult({
      ...consult,
      rounds,
      disagreements,
      tokens: rounds.reduce((sum, item) => sum + item.tokens, 0),
      updatedAt: nowMs(),
    })
    await store.upsert(updated)
    return {
      ok: true,
      consultId: updated.id,
      round: index,
      opinions: normalized.length,
      tokens: updated.tokens,
      overBudget: updated.tokens > updated.budget.cap * (1 + LIMITS.maxTokenOverrun),
      disagreements,
      evidenceWarnings,
      next:
        disagreements.length > 0 && index < LIMITS.roundsMax
          ? `有 ${disagreements.length} 处分歧：让涉及的专家做一轮交叉质询（只谈分歧），或直接裁决并逐条写 dissent。`
          : '可以裁决：调用 expert_council action=verdict。',
    }
  }

  /** Write the final verdict after the gates pass. */
  async function verdict({ id, decision, confidence = 0.7, rationale, dissent = [], unresolved = [], reversalTriggers = [], actions = [], artifactNotes = [], force = false } = {}) {
    const consult = await requireConsult(id)
    if (consult.status === 'archived') throw fail('会诊已归档，不能再裁决。')
    if (consult.status === 'verdict') throw fail('该会诊已经裁决过了；要改结论请新建一次会诊（保留历史）。')
    const totalOpinions = consult.rounds.reduce((sum, round) => sum + round.opinions.length, 0)
    if (consult.mode !== 'lean' && totalOpinions === 0) {
      throw fail('标准/深会诊还没有专家意见：先 record 至少一轮意见，否则裁决没有依据。')
    }
    if (!decision || String(decision).trim().length < 4) throw fail('裁决内容太短：写清「做/不做/有条件做」。')
    if (!rationale || String(rationale).trim().length < 10) throw fail('裁决理由太短（至少 10 个字），否则无法复核。')
    if (consult.disagreements.length > 0 && (!Array.isArray(dissent) || dissent.length === 0) && !force) {
      throw fail(`存在 ${consult.disagreements.length} 处分歧，必须逐条写 dissent（谁、反对什么、依据），或带 force 并说明理由。`)
    }
    const allOpinions = consult.rounds.flatMap((round) => round.opinions)
    const coverage =
      allOpinions.length === 0
        ? 0
        : allOpinions.reduce((sum, opinion) => sum + auditOpinion(opinion).coverage, 0) / allOpinions.length
    const verdictText = normalizeVerdict({ decision, confidence, rationale, dissent, unresolved, reversalTriggers, actions, artifactNotes })
    const tokens = consult.tokens + estimateTokens(JSON.stringify(verdictText))
    const warnings = []
    if (coverage < 0.6) warnings.push(`证据覆盖率 ${(coverage * 100).toFixed(0)}%，裁决风险偏高；建议补证据或降低置信度。`)
    if (verdictText.confidence > 0.9 && coverage < 0.75) warnings.push('置信度 > 0.9 但证据覆盖不足，建议下调到 0.8 或补证据。')
    if (verdictText.dissent.length === 0 && consult.disagreements.length > 0 && !force) warnings.push('应当有异议记录。')
    if (tokens > consult.budget.cap * (1 + LIMITS.maxTokenOverrun)) warnings.push(`已超预算（${tokens} / ${consult.budget.cap} token）。`)
    const updated = normalizeConsult({
      ...consult,
      status: 'verdict',
      verdict: verdictText,
      tokens,
      updatedAt: nowMs(),
    })
    await store.upsert(updated)
    log.info?.(`verdict ${updated.id} · ${truncate(verdictText.decision, 60)}`)
    return {
      ok: true,
      consultId: updated.id,
      decision: verdictText.decision,
      confidence: verdictText.confidence,
      dissentCount: verdictText.dissent.length,
      uncovered: consult.disagreements.length,
      tokens,
      budget: consult.budget.cap,
      warnings,
      summary: summarizeConsult(updated),
    }
  }

  async function requireConsult(id) {
    const key = typeof id === 'string' ? id.trim() : ''
    if (!key) throw fail('缺少会诊 id；先 convene。')
    const consult = normalizeConsult(await store.get(key))
    if (!consult.id) throw fail(`找不到会诊：${key}`)
    return consult
  }

  async function get(id) {
    const consult = await requireConsult(id)
    const { teamMap, expertMap, custom } = await catalog()
    const team = teamMap.get(consult.teamId)
    const described = team ? describeTeam(team, expertMap) : null
    const domain = consult.domainId ? getDomain(consult.domainId) : team?.domain ? getDomain(team.domain) : null
    return {
      ok: true,
      consult,
      team: described,
      domain: domain
        ? {
            id: domain.id,
            name: domain.name,
            tagline: domain.tagline,
            evidence: domain.evidence,
            artifacts: domain.artifacts,
            agenda: domain.agenda,
          }
        : null,
      reportAvailable: Boolean(consult.run?.runId && consult.run?.reportPath),
      customization: summarizeCustomization(custom),
    }
  }

  async function list() {
    const all = await store.list()
    return all.map((consult) => summarizeConsult(normalizeConsult(consult)))
  }

  async function archive(id) {
    const consult = await requireConsult(id)
    const archived = await store.archive(consult.id)
    return { ok: true, consult: summarizeConsult(normalizeConsult(archived)) }
  }

  // -------------------------------------------------------------------------
  // Real multi-model execution
  // -------------------------------------------------------------------------

  const activeByConsult = new Map()

  function sleepLocal(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
  }

  /** Race one promise against a timeout without leaving a live timer behind. */
  function raceTimeout(promise, ms, fallback) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(fallback()), Math.max(0, ms))
      promise.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  }

  function runtimeServices(options = {}) {
    const llm = options.llm ?? (ctx && typeof ctx.get === 'function' ? ctx.get('llm') : null)
    let selection = options.selection ?? null
    if (!selection && ctx && typeof ctx.get === 'function') {
      try {
        selection = ctx.get('agentDefaultModel')?.currentSelection?.() ?? null
      } catch {
        selection = null
      }
    }
    return { llm, selection }
  }

  function snapshotToSummary(snapshot) {
    return {
      runId: snapshot.runId,
      status: snapshot.status,
      stage: snapshot.stage,
      provider: snapshot.provider,
      model: snapshot.model,
      tokens: snapshot.usage?.totalTokens ?? 0,
      budget: snapshot.budget ?? 0,
      durationMs: Math.max(0, (snapshot.finishedAt ?? Date.now()) - (snapshot.startedAt ?? Date.now())),
      experts: snapshot.experts?.length ?? 0,
      failedExperts: (snapshot.experts ?? []).filter((entry) => entry.status === 'failed').length,
      expertStatuses: (snapshot.experts ?? []).slice(0, 24).map((entry) => ({
        expert: entry.expert ?? '',
        expertName: entry.expertName ?? '',
        kind: entry.kind ?? '',
        status: entry.status ?? 'failed',
        tokens: entry.tokens ?? 0,
        latencyMs: entry.latencyMs ?? 0,
      })),
      reportPath: snapshot.reportPath ?? null,
      startedAt: snapshot.startedAt ?? null,
      finishedAt: snapshot.finishedAt ?? null,
      error: snapshot.error ?? null,
    }
  }

  async function persistRunSummary(consultId, summary) {
    try {
      const current = await store.get(consultId)
      if (!current) return
      current.run = summary
      current.updatedAt = nowMs()
      await store.upsert(current)
    } catch (error) {
      log.warn?.(`run summary persist failed: ${error?.message ?? error}`)
    }
  }

  /** Start a real panel run. Returns a progress snapshot unless wait=false. */
  async function run(id, options = {}) {
    const consult = await requireConsult(id)
    const existingId = activeByConsult.get(consult.id)
    if (existingId) {
      const entry = activeRuns.get(existingId)
      return { ok: true, alreadyRunning: true, runId: existingId, consultId: consult.id, snapshot: entry?.snapshot ?? null }
    }
    if (consult.status !== 'open') {
      throw fail('该会诊已裁决或归档，不能再执行真实会诊；请新建一次会诊。')
    }
    if (consult.rounds.length > 0) {
      throw fail('该会诊已经有人工意见轮次；真实会诊需要一次干净的会诊（避免混写）。请新建一次会诊。')
    }
    const { teamMap, expertMap } = await catalog()
    const team = teamMap.get(consult.teamId)
    if (!team) throw fail(`会诊引用的团队不存在：${consult.teamId}`)
    const domain = consult.domainId ? getDomain(consult.domainId) : team.domain ? getDomain(team.domain) : null
    const resolvedTeam = { ...team, members: team.members.map((member) => ({ ...member, expert: expertMap.get(member.id) })) }
    const { llm, selection } = runtimeServices(options)
    if (!llmAvailable(llm)) {
      throw fail(
        '真实会诊需要 Host 侧 llm 服务与默认模型（当前不可用）。请先在 DSH 选择默认模型，或在设置里给插件配置 provider/model。',
      )
    }
    const runId = `run-${consult.id.replace(/^ec-/, '')}-${nowMs().toString(36)}`
    const controller = new AbortController()
    const entry = {
      runId,
      consultId: consult.id,
      controller,
      startedAt: nowMs(),
      waiters: [],
      snapshot: {
        runId,
        consultId: consult.id,
        stage: 'starting',
        status: 'running',
        mode: consult.mode,
        domainId: domain?.id ?? null,
        provider: null,
        model: null,
        startedAt: nowMs(),
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        budget: consult.budget?.cap ?? 0,
        experts: [],
      },
    }
    entry.done = new Promise((resolve) => {
      entry.resolveDone = resolve
    })
    let lastStage = 'starting'
    const timeoutTimer = setTimeout(() => controller.abort(), runConfig.runTimeoutMs)
    activeRuns.set(runId, entry)
    activeByConsult.set(consult.id, runId)
    const lifecycle = {
      recordRound: async ({ round, opinions, note }) => record({ id: consult.id, round, opinions, note }),
      writeVerdict: async (verdictInput) => {
        const written = await verdict({ ...verdictInput, id: consult.id })
        return { verdict: normalizeVerdict({ ...verdictInput, at: nowMs() }), warnings: written.warnings ?? [] }
      },
      saveRun: async (runData) => store.saveRun(runData),
      saveReport: async (runData, markdown) => store.saveReport(runData.runId, markdown),
    }
    const execution = executor
      .executeRun({
        runId,
        consult,
        team: resolvedTeam,
        domain,
        llm,
        selection,
        provider: options.provider ?? runConfig.provider,
        model: options.model ?? runConfig.model,
        reasoningEffort: options.reasoningEffort ?? runConfig.reasoningEffort,
        temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : runConfig.temperature,
        lifecycle,
        signal: controller.signal,
        maxParallel: clampInt(options.maxParallel, 1, 8, runConfig.maxParallel),
        callTimeoutMs: clampInt(options.callTimeoutMs, 5000, 300000, runConfig.callTimeoutMs),
        onProgress: (snapshot) => {
          entry.snapshot = snapshot
          if (snapshot.stage !== lastStage) {
            lastStage = snapshot.stage
            void persistRunSummary(consult.id, snapshotToSummary(snapshot))
          }
          const waiters = entry.waiters.splice(0)
          for (const waiter of waiters) {
            try {
              waiter(snapshot)
            } catch {
              /* ignore */
            }
          }
        },
      })
      .then(async (snapshot) => {
        clearTimeout(timeoutTimer)
        activeRuns.delete(runId)
        activeByConsult.delete(consult.id)
        entry.snapshot = snapshot
        await persistRunSummary(consult.id, snapshotToSummary(snapshot))
        entry.resolveDone({ ok: true, snapshot })
        return snapshot
      })
      .catch(async (error) => {
        clearTimeout(timeoutTimer)
        activeRuns.delete(runId)
        activeByConsult.delete(consult.id)
        const fallback = error?.run
          ? {
              ...entry.snapshot,
              stage: error.run.stage,
              status: error.run.status,
              usage: error.run.usage,
              experts: (error.run.experts ?? []).map((item) => ({ kind: item.kind, expert: item.expert, expertName: item.expertName, status: item.status, tokens: item.tokens ?? 0 })),
              warnings: error.run.warnings ?? [],
              error: String(error?.message ?? error),
              finishedAt: error.run.finishedAt,
              reportPath: null,
            }
          : { ...entry.snapshot, status: 'failed', error: String(error?.message ?? error) }
        entry.snapshot = fallback
        await persistRunSummary(consult.id, snapshotToSummary(fallback))
        entry.resolveDone({
          ok: false,
          error: { message: String(error?.message ?? error), code: error?.code ?? 'RUN_FAILED' },
          snapshot: fallback,
        })
        return null
      })
    entry.execution = execution
    log.info?.(`run started ${runId} · ${consult.id} · ${resolvedTeam.id} · ${domain?.id ?? 'no-domain'}`)
    if (options.wait === false) {
      return { ok: true, started: true, runId, consultId: consult.id, snapshot: entry.snapshot }
    }
    const waitMs = clampInt(options.waitMs, 1000, 600000, runConfig.waitMs)
    const result = await raceTimeout(entry.done, waitMs, () => ({ ok: true, running: true, snapshot: entry.snapshot }))
    if (result.running) {
      return {
        ok: true,
        running: true,
        runId,
        consultId: consult.id,
        snapshot: result.snapshot,
        next: '仍在运行：用 action=run_status 查询进度，或 action=cancel_run 取消。',
      }
    }
    if (!result.ok) {
      const error = fail(result.error?.message ?? '真实会诊失败')
      error.code = result.error?.code
      error.snapshot = result.snapshot
      throw error
    }
    const snapshot = result.snapshot
    const fresh = await requireConsult(consult.id)
    return {
      ok: true,
      runId,
      consultId: consult.id,
      status: snapshot.status,
      verdict: fresh.verdict,
      snapshot,
      reportPath: snapshot.reportPath,
      tokens: snapshot.usage?.totalTokens ?? 0,
      durationMs: Math.max(0, (snapshot.finishedAt ?? nowMs()) - (snapshot.startedAt ?? nowMs())),
      warnings: snapshot.warnings ?? [],
    }
  }

  /** Progress/outcome for one run id or consult id. */
  async function runStatus(id) {
    const key = typeof id === 'string' ? id.trim() : ''
    if (!key) throw fail('缺少会诊或 run id')
    const entry = activeRuns.get(key) ?? (activeByConsult.has(key) ? activeRuns.get(activeByConsult.get(key)) : null)
    if (entry) return { ok: true, running: true, snapshot: entry.snapshot }
    const consult = normalizeConsult(await store.get(key))
    if (consult.id) return { ok: true, running: consult.run?.status === 'running', consultId: consult.id, run: consult.run }
    const runData = await store.readRun(key)
    if (runData) {
      return {
        ok: true,
        running: false,
        runId: runData.runId,
        consultId: runData.consultId,
        status: runData.status,
        stage: runData.stage,
        usage: runData.usage,
        reportPath: runData.reportPath ?? null,
        error: runData.error ?? null,
      }
    }
    throw fail(`找不到会诊或运行记录：${key}`)
  }

  /** Abort an in-flight run. The consult stays open so it can be re-run. */
  async function cancelRun(id) {
    const key = typeof id === 'string' ? id.trim() : ''
    const entry = activeRuns.get(key) ?? (activeByConsult.has(key) ? activeRuns.get(activeByConsult.get(key)) : null)
    if (!entry) throw fail('没有正在运行的真实会诊（或它已经结束）。')
    entry.controller.abort()
    const result = await raceTimeout(entry.done, 10000, () => ({ ok: true, running: true, snapshot: entry.snapshot }))
    return {
      ok: true,
      canceled: !result.running,
      runId: entry.runId,
      consultId: entry.consultId,
      snapshot: result.snapshot ?? entry.snapshot,
    }
  }

  /** Read the professional report for a finished run. */
  async function report(id) {
    const consult = await requireConsult(id)
    const runId = consult.run?.runId
    if (!runId) throw fail('该会诊还没有真实会诊报告；先执行 action=run。')
    const markdown = await store.readReport(runId)
    if (!markdown) throw fail(`报告文件不存在：${runId}`)
    return { ok: true, consultId: consult.id, runId, reportPath: consult.run?.reportPath ?? null, markdown }
  }

  async function state() {
    const { custom, experts: expertList, teams: teamList, expertMap } = await catalog()
    const { llm } = runtimeServices()
    return {
      ok: true,
      teams: teamList.map((team) => describeTeam(team, expertMap)),
      experts: expertList.map(describeExpert),
      domains: await domains(),
      protocol: protocol(),
      consults: await list(),
      stats: await store.stats(),
      customization: summarizeCustomization(custom),
      policy: getPolicy(),
      runtime: {
        llmAvailable: llmAvailable(llm),
        activeRuns: [...activeRuns.values()].map((entry) => entry.snapshot),
        config: { maxParallel: runConfig.maxParallel, callTimeoutMs: runConfig.callTimeoutMs, runTimeoutMs: runConfig.runTimeoutMs },
      },
    }
  }

  /** Save (create or override) one expert. */
  async function saveExpert(raw, { actor = 'user', requestQuote = null } = {}) {
    const quote = requireMutationConsent(actor, requestQuote)
    const clean = cleanExpertInput(raw)
    if (!clean.ok) throw fail(clean.error)
    const custom = await loadCustom()
    const isNew = !baseExperts().some((expert) => expert.id === clean.value.id) && !custom.experts[clean.value.id]
    if (isNew && Object.keys(custom.experts).length >= MAX_CUSTOM_EXPERTS) {
      throw fail(`自定义专家上限 ${MAX_CUSTOM_EXPERTS} 个；先删掉不用的。`)
    }
    const value = { ...clean.value, updatedAt: nowMs(), updatedBy: actor }
    custom.experts[clean.value.id] = value
    custom.hiddenExperts = custom.hiddenExperts.filter((id) => id !== clean.value.id)
    addHistoryEntry(custom, {
      at: nowMs(),
      actor,
      action: isNew ? 'expert-create' : 'expert-override',
      id: clean.value.id,
      request: quote,
      summary: `${isNew ? '新增' : '覆盖'}专家 ${clean.value.id}（${clean.value.name.zh}）`,
    })
    const saved = await store.saveCustomization(custom)
    log.info?.(`saved expert ${clean.value.id}${actor === 'user' ? ' (panel)' : ''}`)
    return {
      ok: true,
      kind: 'expert',
      id: clean.value.id,
      overridden: !isNew,
      expert: describeExpert({ ...value, custom: true, preset: !isNew }),
      customization: summarizeCustomization(saved),
    }
  }

  /** Save (create or override) one team. */
  async function saveTeam(raw, { actor = 'user', requestQuote = null } = {}) {
    const quote = requireMutationConsent(actor, requestQuote)
    const { experts: expertList, custom } = await catalog()
    const clean = cleanTeamInput(raw, { expertIds: expertList.map((expert) => expert.id) })
    if (!clean.ok) throw fail(clean.error)
    const isNew = !baseTeams().some((team) => team.id === clean.value.id) && !custom.teams[clean.value.id]
    if (isNew && Object.keys(custom.teams).length >= MAX_CUSTOM_TEAMS) {
      throw fail(`自定义团队上限 ${MAX_CUSTOM_TEAMS} 个；先删掉不用的。`)
    }
    const value = { ...clean.value, updatedAt: nowMs(), updatedBy: actor }
    custom.teams[clean.value.id] = value
    custom.hiddenTeams = custom.hiddenTeams.filter((id) => id !== clean.value.id)
    addHistoryEntry(custom, {
      at: nowMs(),
      actor,
      action: isNew ? 'team-create' : 'team-override',
      id: clean.value.id,
      request: quote,
      summary: `${isNew ? '新增' : '覆盖'}团队 ${clean.value.id}（${clean.value.name.zh}，${clean.value.members.length} 人）`,
    })
    const saved = await store.saveCustomization(custom)
    const expertMap = new Map(expertList.map((expert) => [expert.id, expert]))
    log.info?.(`saved team ${clean.value.id}${actor === 'user' ? ' (panel)' : ''}`)
    return {
      ok: true,
      kind: 'team',
      id: clean.value.id,
      overridden: !isNew,
      team: describeTeam({ ...value, custom: true, preset: !isNew }, expertMap),
      customization: summarizeCustomization(saved),
    }
  }

  /**
   * Delete a custom entry, or hide a preset. Deleting an expert also prunes it
   * from custom teams (and reports which teams were affected).
   */
  async function deleteEntity(kind, id, { actor = 'user', requestQuote = null } = {}) {
    const quote = requireMutationConsent(actor, requestQuote)
    const key = typeof id === 'string' ? id.trim() : ''
    if (!key) throw fail('缺少要删除的 id')
    const custom = await loadCustom()
    if (kind === 'expert') {
      const preset = baseExperts().some((expert) => expert.id === key)
      const overridden = Boolean(custom.experts[key])
      if (!preset && !overridden) throw fail(`找不到专家：${key}`)
      delete custom.experts[key]
      // Only presets need hiding; a custom-only expert is simply removed.
      if (preset && !custom.hiddenExperts.includes(key)) custom.hiddenExperts.push(key)
      const affectedTeams = []
      for (const [teamId, team] of Object.entries(custom.teams)) {
        const before = team.members?.length ?? 0
        team.members = asArray(team.members).filter((member) => member?.id !== key)
        if ((team.members?.length ?? 0) !== before) affectedTeams.push(teamId)
      }
      addHistoryEntry(custom, {
        at: nowMs(),
        actor,
        action: preset ? 'expert-hide' : 'expert-delete',
        id: key,
        request: quote,
        summary: `${preset ? '隐藏' : '删除'}专家 ${key}${affectedTeams.length > 0 ? `，影响团队：${affectedTeams.join('、')}` : ''}`,
      })
      const saved = await store.saveCustomization(custom)
      log.info?.(`deleted expert ${key}`)
      return {
        ok: true,
        kind,
        id: key,
        hidden: preset,
        affectedTeams,
        customization: summarizeCustomization(saved),
      }
    }
    if (kind === 'team') {
      const preset = baseTeams().some((team) => team.id === key)
      const overridden = Boolean(custom.teams[key])
      if (!preset && !overridden) throw fail(`找不到团队：${key}`)
      delete custom.teams[key]
      if (!custom.hiddenTeams.includes(key)) custom.hiddenTeams.push(key)
      addHistoryEntry(custom, {
        at: nowMs(),
        actor,
        action: preset ? 'team-hide' : 'team-delete',
        id: key,
        request: quote,
        summary: `${preset ? '隐藏' : '删除'}团队 ${key}`,
      })
      const saved = await store.saveCustomization(custom)
      log.info?.(`deleted team ${key}`)
      return { ok: true, kind, id: key, hidden: preset, affectedTeams: [], customization: summarizeCustomization(saved) }
    }
    throw fail(`未知类型：${kind}（expert | team）`)
  }

  /** Wipe all customisation back to the shipped catalog. */
  async function resetCustomization({ confirm = false, actor = 'user', requestQuote = null } = {}) {
    if (confirm !== true) throw fail('重置需要显式确认：传 confirm:true（会清空所有自定义专家与团队）')
    const quote = requireMutationConsent(actor, requestQuote)
    const fresh = emptyCustomization()
    addHistoryEntry(fresh, {
      at: nowMs(),
      actor,
      action: 'reset',
      id: null,
      request: quote,
      summary: '恢复出厂目录（清空所有自定义专家/团队）',
    })
    const saved = await store.saveCustomization(fresh)
    log.info?.('customization reset')
    return { ok: true, kind: 'customization', reset: true, by: actor, customization: summarizeCustomization(saved) }
  }

  /** Resolve one team for the brief builder (used by tests and the command). */
  async function resolveTeamFor(teamId) {
    const { teamMap, expertMap } = await catalog()
    const team = teamMap.get(teamId)
    if (!team) throw fail(`未知团队：${teamId || '（空）'}`)
    return { ...team, members: team.members.map((member) => ({ ...member, expert: expertMap.get(member.id) })) }
  }

  return {
    teams,
    experts,
    domains,
    protocol,
    policy: getPolicy,
    convene,
    record,
    verdict,
    run,
    runStatus,
    cancelRun,
    report,
    get,
    list,
    archive,
    state,
    runtime: () => runtimeServices(),
    customization: customizationState,
    customizationBrief,
    saveExpert,
    saveTeam,
    deleteEntity,
    resetCustomization,
    resolveTeamFor,
    describeTeam,
    loadCustom,
    errorMessage: (error) => error?.userMessage ?? error?.message ?? String(error),
  }
}

export { teamName, expertName, roundsFor }
