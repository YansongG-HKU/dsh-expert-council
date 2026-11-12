/**
 * Real panel executor.
 *
 * One run = N independent model calls (one per expert lens), an optional
 * cross-examination round only on detected disagreement, an optional anonymous
 * peer review (deep), and one chair synthesis call. Every call is timeout- and
 * retry-bounded, every reply is parsed against a JSON contract, and the whole
 * transcript is persisted so the report cannot drift from what the model said.
 *
 * The executor deliberately writes its result back through the same service
 * gates used by the manual path (`recordRound` / `writeVerdict`), so a real run
 * cannot bypass evidence, dissent or overwrite rules.
 */

import { completeText, llmAvailable, resolveSelection } from './llm.js'
import {
  buildChairPrompt,
  buildCrossExamPrompt,
  buildExpertPrompt,
  buildLeanPrompt,
  buildPeerReviewPrompt,
  buildTaskExpertPrompt,
  buildTaskMergePrompt,
  CHAIR_SCHEMA,
  CROSS_SCHEMA,
  EXPERT_SCHEMA,
  LEAN_SCHEMA,
  PEER_SCHEMA,
  TASK_MERGE_SCHEMA,
  TASK_SCHEMA,
} from './prompts.js'
import { extractJsonObject } from './json.js'
import { detectDisagreements, auditOpinion, modeLabel } from './protocol.js'
import { normalizeOpinion, normalizeVerdict } from './records.js'
import { buildReport } from './report.js'
import { asArray, clamp, nowMs, raisedOutputBudget, routeReasoningActive, truncate } from './util.js'

export class PanelRunError extends Error {
  constructor(message, { code = 'RUN_FAILED', run = null, aborted = false } = {}) {
    super(message)
    this.name = 'PanelRunError'
    this.code = code
    this.run = run
    this.aborted = aborted
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PanelRunError('运行已取消', { code: 'ABORTED', aborted: true }))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new PanelRunError('运行已取消', { code: 'ABORTED', aborted: true }))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

function usageTotal(usage) {
  return Math.max(0, Number(usage?.totalTokens) || (Number(usage?.inputTokens) || 0) + (Number(usage?.outputTokens) || 0))
}

function addUsage(run, usage) {
  run.usage.inputTokens += Math.max(0, Number(usage?.inputTokens) || 0)
  run.usage.outputTokens += Math.max(0, Number(usage?.outputTokens) || 0)
  run.usage.totalTokens = run.usage.inputTokens + run.usage.outputTokens
}

export function createPanelExecutor({ log = console } = {}) {
  /**
   * @param {object} spec
   * @param {object} spec.consult  normalized consult (has id, question, mode, budget)
   * @param {object} spec.team     resolved team whose members carry `expert`
   * @param {object|null} spec.domain domain pack or null
   * @param {object} spec.llm      Harness llm service
   * @param {object|null} spec.selection default model selection
   * @param {object} spec.lifecycle { recordRound, writeVerdict, saveRun, saveReport }
   * @param {AbortSignal|null} spec.signal
   * @param {(snapshot:object)=>void} spec.onProgress
   */
  async function executeRun(spec) {
    const {
      runId,
      consult,
      team,
      domain = null,
      llm,
      selection = null,
      provider = null,
      model = null,
      reasoningEffort = null,
      temperature = 0.55,
      lifecycle,
      signal = null,
      onProgress = null,
      maxParallel = 4,
      callTimeoutMs = 90000,
      maxRepairAttempts = 1,
    } = spec
    if (!llmAvailable(llm)) {
      throw new PanelRunError('Host 没有可用的 llm 服务，无法执行真实专家会诊。', { code: 'LLM_UNAVAILABLE' })
    }
    if (!team || !Array.isArray(team.members)) throw new PanelRunError('团队解析失败', { code: 'TEAM_INVALID' })
    const members = team.members
      .filter((member) => member?.expert)
      .map((member) => ({ ...member, expert: member.expert, role: member.role === 'lead' ? 'lead' : 'member' }))
    if (members.length === 0) throw new PanelRunError('团队没有可用专家', { code: 'TEAM_EMPTY' })

    // Resolve the effective route once: it decides both the reasoning budget
    // floors and the provider/model shown in failure diagnostics. A reasoning
    // route spends hidden thinking tokens from the same `maxTokens` budget, so
    // every stage needs a floor high enough to still produce visible output.
    let route = null
    try {
      route = resolveSelection({ selection, provider, model, reasoningEffort })
    } catch {
      route = null
    }
    const reasoningActive = routeReasoningActive({ selection, reasoningEffort })
    const routeProvider = route?.provider ?? provider ?? selection?.provider ?? null
    const routeModel = route?.model ?? model ?? selection?.model ?? null
    /** Raise one prompt's output budget to the reasoning floor for its stage. */
    const withReasoningFloor = (stage, prompt) => {
      prompt.maxTokens = raisedOutputBudget(stage, reasoningActive, prompt.maxTokens)
      return prompt
    }

    const mode = consult.mode === 'lean' || consult.mode === 'deep' ? consult.mode : 'standard'
    const intent = consult.intent === 'task' ? 'task' : 'review'
    const cap = Math.max(200, Number(consult.budget?.cap) || 2000)
    const run = {
      runId,
      consultId: consult.id,
      domainId: domain?.id ?? null,
      teamId: team.id,
      mode,
      modeLabel: modeLabel(mode),
      intent,
      provider: routeProvider,
      model: routeModel,
      reasoning: reasoningActive,
      startedAt: nowMs(),
      finishedAt: null,
      stage: 'starting',
      status: 'running',
      experts: [],
      calls: [],
      opinions: [],
      crossExam: [],
      peerReviews: [],
      lensChecks: [],
      taskResult: null,
      disagreements: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      budget: cap,
      warnings: [],
      failures: [],
      quorum: { required: Math.ceil(members.length / 2), success: 0, ok: false },
      verdict: null,
      reportPath: null,
    }
    const emit = (stage) => {
      run.stage = stage
      try {
        onProgress?.(snapshot(run))
      } catch {
        /* progress must never break a run */
      }
    }
    emit('starting')

    const callTimeout = Math.max(5000, Math.min(300000, Number(callTimeoutMs) || 90000))
    run.callTimeoutMs = callTimeout

    /** Route label + remediation appended to run-level failures (quorum, empty output, generic failure). */
    function routeSummary() {
      const provider = run.provider ?? routeProvider ?? 'unknown'
      const model = run.model ?? routeModel ?? 'unknown'
      return `模型路由 ${provider}/${model}（${reasoningActive ? '推理开启' : '推理关闭'}）`
    }
    function failureHint() {
      return `${routeSummary()}；建议：降低 reasoning effort 或换非推理模型；单槽自部署端点请设 max_parallel:1 串行执行，并适当提高 call_timeout_ms。`
    }

    /** One model call with timeout + one retry, recorded in run.calls. */
    async function callModel(kind, expertId, prompt, { attempts = 2, maxTokens }) {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (signal?.aborted) throw new PanelRunError('运行已取消', { code: 'ABORTED', aborted: true, run })
        const controller = new AbortController()
        let timedOut = false
        const onAbort = () => controller.abort()
        signal?.addEventListener?.('abort', onAbort, { once: true })
        const timer = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, callTimeout)
        const startedAt = nowMs()
        try {
          const reply = await completeText({
            llm,
            selection,
            provider,
            model,
            reasoningEffort,
            system: prompt.system,
            messages: prompt.messages,
            maxTokens: maxTokens ?? prompt.maxTokens,
            temperature: Number.isFinite(Number(prompt.temperature)) ? Number(prompt.temperature) : temperature,
            signal: controller.signal,
            purpose: 'expert-council',
          })
          run.provider = run.provider ?? reply.provider
          run.model = run.model ?? reply.model
          addUsage(run, reply.usage)
          run.calls.push({
            kind,
            expert: expertId,
            attempt,
            ok: true,
            tokens: usageTotal(reply.usage),
            latencyMs: reply.latencyMs,
          })
          return { ...reply, attempt }
        } catch (error) {
          const aborted = error?.aborted === true || signal?.aborted === true
          if (aborted) throw new PanelRunError('运行已取消', { code: 'ABORTED', aborted: true, run })
          run.calls.push({
            kind,
            expert: expertId,
            attempt,
            ok: false,
            tokens: 0,
            latencyMs: nowMs() - startedAt,
            error: timedOut ? '调用超时' : String(error?.message ?? error),
          })
          if (attempt >= attempts) throw error instanceof PanelRunError ? error : new PanelRunError(
            `模型调用失败（${kind}${expertId ? ` · ${expertId}` : ''}）：${timedOut ? '超时' : error?.message ?? error}`,
            { code: 'CALL_FAILED', run },
          )
          await sleep(600 * attempt, signal)
        } finally {
          clearTimeout(timer)
          signal?.removeEventListener?.('abort', onAbort)
        }
      }
      throw new PanelRunError('模型调用失败', { code: 'CALL_FAILED', run })
    }

    /** Parse, then one repair call, then give up (returns null). */
    async function callJson(kind, expertId, prompt, { schema, maxTokens, attempts = 2, validate }) {
      let reply = await callModel(kind, expertId, prompt, { attempts, maxTokens })
      let parsed = extractJsonObject(reply.text)
      if (parsed && (!validate || validate(parsed))) return { parsed, reply }
      for (let repair = 0; repair < maxRepairAttempts; repair += 1) {
        const repaired = await callModel(
          `${kind}-repair`,
          expertId,
          {
            system: `${prompt.system}\n\n你现在处于修复模式：只输出一个合法 JSON 对象，不要任何解释。`,
            messages: [
              ...prompt.messages,
              {
                // Never fabricate an assistant turn here: a hand-built assistant
                // message has no provider replay metadata and the adapter rejects
                // it. Put the draft back as user-visible feedback instead.
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `你上一版回复（作为你的草稿）：\n${truncate(reply.text || '（空回复）', 3000)}\n\n上面的回复不是合法或完整的 JSON。请严格按以下契约重新输出一个 JSON 对象，不要代码块：\n${schema}`,
                  },
                ],
              },
            ],
            temperature: 0.2,
          },
          { attempts: 1, maxTokens },
        )
        reply = repaired
        parsed = extractJsonObject(reply.text)
        if (parsed && (!validate || validate(parsed))) return { parsed, reply }
      }
      return { parsed: null, reply }
    }

    /**
     * Deterministic last resort when the chair model returns unusable JSON.
     * It never invents new claims: the decision is the stance distribution of
     * the actual opinions, and the record is explicitly marked as degraded so
     * a human must review it before acting.
     */
    function fallbackVerdict(latest, runState) {
      const list = asArray(latest).filter((opinion) => opinion && opinion.expert)
      const counts = { support: 0, oppose: 0, conditional: 0 }
      for (const opinion of list) {
        const stance = counts[opinion.stance] === undefined ? 'conditional' : opinion.stance
        counts[stance] += 1
      }
      const total = list.length || 1
      const averageConfidence = list.reduce((sum, opinion) => sum + (Number(opinion.confidence) || 0), 0) / total
      let decision = '有条件做（按专家意见统计的降级裁决）'
      if (counts.oppose > total / 2) decision = '不做（按专家意见统计的降级裁决）'
      else if (counts.support > total / 2) decision = '做（按专家意见统计的降级裁决）'
      const dissent = asArray(runState.disagreements)
        .slice(0, 4)
        .map((item) => ({
          expert: item.a,
          point: `与 ${item.b} 存在分歧：${item.reason}`,
          evidence: '见意见与交叉质询记录',
        }))
      return normalizeVerdict({
        decision,
        confidence: clamp(averageConfidence * 0.75, 0.3, 0.8),
        rationale: `主持模型未返回可解析 JSON（已尝试修复）。本条为按 ${list.length} 位专家实际意见统计的降级裁决：支持 ${counts.support}、反对 ${counts.oppose}、有条件 ${counts.conditional}。该结论未经主持综合，必须人工复核后使用。`,
        dissent,
        unresolved: ['主持裁决缺失，本结论为降级合成，未逐条回应分歧'],
        reversalTriggers: ['主持复核后可能推翻本裁决', '出现新的关键证据'],
        actions: ['召集人：复核意见记录并重跑一次真实会诊'],
      })
    }

    /**
     * Recover a truncated chair reply. Reasoning models sometimes emit a valid
     * opening (decision/confidence/rationale) and then run out of output budget
     * mid-object. The extracted fields are still the chair's own words, so we
     * keep them and mark the record as partially recovered.
     */
    function salvagedVerdict(text, runState) {
      const raw = String(text ?? '')
      if (!raw) return null
      const field = (name, max) => {
        const match = raw.match(new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.){1,${max}})"`))
        return match ? match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : null
      }
      const decision = field('decision', 300)
      const rationale = field('rationale', 1200)
      if (!decision || !rationale) return null
      const confidenceMatch = raw.match(/"confidence"\s*:\s*([0-9.]+)/)
      const dissent = asArray(runState.disagreements)
        .slice(0, 4)
        .map((item) => ({ expert: item.a, point: `与 ${item.b} 存在分歧：${item.reason}`, evidence: '见意见与交叉质询记录' }))
      return normalizeVerdict({
        decision,
        confidence: confidenceMatch ? Number(confidenceMatch[1]) : 0.6,
        rationale,
        dissent,
        unresolved: ['主持输出被截断，裁决文本为抢救提取，可能缺少部分未决项'],
        reversalTriggers: ['复核主持原始输出后可能调整'],
        actions: ['召集人：复核主持原文并补全行动项'],
      })
    }

    function opinionFromParsed(parsed, member) {
      const rawOpinion = {
        expert: parsed.expert || member.expert.id,
        stance: parsed.stance,
        confidence: parsed.confidence,
        claims: asArray(parsed.claims),
        changes: parsed.changes,
        unknowns: parsed.unknowns,
      }
      const normalized = normalizeOpinion(rawOpinion, { teamIds: members.map((entry) => entry.expert.id) })
      return {
        ...normalized,
        expertName: member.expert.name.zh,
        tokens: normalized.tokens,
        status: 'ok',
      }
    }

    /** Concatenate expert artifacts when the merge call fails. */
    function fallbackTaskMerge(works, questionText) {
      const sections = works.map((work, index) => `## ${index + 1}. ${work.title || work.expertName}\n\n${work.content}`)
      return {
        title: `合并成果：${truncate(questionText, 60)}`,
        summary: '主持合并调用失败，按专家交付物自动拼接（需人工整理）。',
        artifact: sections.join('\n\n---\n\n'),
        deliverables: works.map((work) => ({
          expert: work.expert,
          title: work.title || '',
          contribution: truncate(work.content, 200),
        })),
        assumptions: works.flatMap((work) => asArray(work.assumptions)).slice(0, 10),
        risks: works.flatMap((work) => asArray(work.risks)).slice(0, 10),
        openQuestions: ['主持合并缺失，拼接成果需人工复核'],
        nextActions: ['召集人：复核产出并补一次完整合并'],
      }
    }

    try {
      if (intent === 'task') {
        emit('work')
        const perExpert = clamp(Math.round((cap * 0.9) / members.length), 2400, 8000)
        const works = []
        await mapLimit(members, maxParallel, async (member) => {
          const entry = {
            kind: 'task',
            expert: member.expert.id,
            expertName: member.expert.name.zh,
            role: member.role,
            status: 'pending',
            tokens: 0,
            latencyMs: 0,
          }
          try {
            const prompt = withReasoningFloor(
              'task',
              buildTaskExpertPrompt({
                expert: member.expert,
                domain,
                question: consult.question,
                context: consult.context,
                maxTokens: perExpert,
              }),
            )
            const { parsed, reply } = await callJson('task', member.expert.id, prompt, {
              schema: TASK_SCHEMA,
              maxTokens: prompt.maxTokens,
              validate: (value) => typeof value.content === 'string' && value.content.trim().length >= 20,
            })
            entry.status = parsed ? 'ok' : 'failed'
            entry.tokens = usageTotal(reply.usage)
            entry.latencyMs = reply.latencyMs
            run.experts.push(entry)
            if (!parsed) {
              run.failures.push({ expert: member.expert.id, stage: 'task', error: '产出不符合契约' })
              return null
            }
            works.push({
              expert: member.expert.id,
              expertName: member.expert.name.zh,
              title: truncate(String(parsed.deliverable ?? ''), 160),
              content: String(parsed.content ?? '').trim(),
              assumptions: asArray(parsed.assumptions).map((item) => String(item)).filter(Boolean).slice(0, 6),
              risks: asArray(parsed.risks).map((item) => String(item)).filter(Boolean).slice(0, 6),
              handoff: asArray(parsed.handoff).map((item) => String(item)).filter(Boolean).slice(0, 6),
            })
          } catch (error) {
            if (error?.aborted) throw error
            entry.status = 'failed'
            entry.error = String(error?.message ?? error)
            run.experts.push(entry)
            run.failures.push({ expert: member.expert.id, stage: 'task', error: entry.error })
          }
          return null
        })
        run.quorum = { required: 1, success: works.length, ok: works.length > 0 }
        if (works.length === 0) {
          throw new PanelRunError(`任务会诊没有产出：所有专家调用失败或产出为空。${failureHint()}`, { code: 'TASK_EMPTY', run })
        }
        emit('merge')
        let merged = null
        try {
          const prompt = withReasoningFloor(
            'taskMerge',
            buildTaskMergePrompt({
              team,
              domain,
              question: consult.question,
              context: consult.context,
              works,
              maxTokens: clamp(Math.round(cap), 4000, 12000),
            }),
          )
          const { parsed } = await callJson('task-merge', 'chair', prompt, {
            schema: TASK_MERGE_SCHEMA,
            maxTokens: prompt.maxTokens,
            validate: (value) => typeof value.artifact === 'string' && value.artifact.trim().length >= 20,
          })
          merged = parsed
        } catch (error) {
          if (error?.aborted) throw error
          run.failures.push({ stage: 'merge', error: String(error?.message ?? error) })
          run.warnings.push('主持合并失败，已按专家产出自动拼接，需人工复核')
        }
        if (!merged) merged = fallbackTaskMerge(works, consult.question)
        const list = (input, max) =>
          asArray(input)
            .map((item) => String(item).trim())
            .filter(Boolean)
            .slice(0, max)
        run.taskResult = {
          title: truncate(String(merged.title ?? ''), 200) || '专家团任务成果',
          summary: truncate(String(merged.summary ?? ''), 2000),
          artifact: String(merged.artifact ?? '').trim(),
          deliverables: asArray(merged.deliverables)
            .filter((item) => item && typeof item === 'object')
            .slice(0, 24)
            .map((item) => ({
              expert: truncate(String(item.expert ?? ''), 60),
              title: truncate(String(item.title ?? ''), 160),
              contribution: truncate(String(item.contribution ?? ''), 500),
            })),
          assumptions: list(merged.assumptions, 12),
          risks: list(merged.risks, 12),
          openQuestions: list(merged.openQuestions, 12),
          nextActions: list(merged.nextActions, 12),
          works: works.map((work) => ({
            expert: work.expert,
            expertName: work.expertName,
            title: work.title,
            content: work.content,
          })),
        }
        const written = await lifecycle.writeTaskResult(run.taskResult, { source: 'run', runId })
        run.verdict = written.verdict
        mergeWarnings(run, written.warnings)
        return finishRun(run, consult, team, domain, lifecycle, emit)
      }
      if (mode === 'lean') {
        emit('lean-check')
        const lenses = members.map((member) => member.expert)
        const prompt = withReasoningFloor(
          'lean',
          buildLeanPrompt({
            team,
            domain,
            question: consult.question,
            context: consult.context,
            lenses,
            maxTokens: clamp(Math.round(cap * 0.75), 1400, 2800),
          }),
        )
        const { parsed } = await callJson('lean', 'chair', prompt, {
          schema: LEAN_SCHEMA,
          maxTokens: prompt.maxTokens,
          validate: (value) => typeof value.decision === 'string' && value.decision.trim().length >= 4,
        })
        if (!parsed) throw new PanelRunError('轻会诊未能返回可解析的裁决 JSON（已重试修复）。', { code: 'LEAN_PARSE_FAILED', run })
        run.lensChecks = asArray(parsed.lensChecks).map((item) => ({
          lens: truncate(String(item?.lens ?? ''), 60),
          risk: truncate(String(item?.risk ?? ''), 400),
          evidence: truncate(String(item?.evidence ?? ''), 400),
        }))
        const verdict = normalizeVerdict({
          decision: parsed.decision,
          confidence: parsed.confidence,
          rationale: parsed.rationale,
          dissent: parsed.dissent,
          unresolved: parsed.unresolved,
          reversalTriggers: parsed.reversalTriggers,
          actions: parsed.actions,
        })
        emit('verdict')
        const written = await lifecycle.writeVerdict(verdict, { source: 'run', runId })
        run.verdict = written.verdict ?? verdict
        mergeWarnings(run, written.warnings)
        return finishRun(run, consult, team, domain, lifecycle, emit)
      }

      // ---- independent opinions -------------------------------------------
      emit('independent')
      const perExpertTokens = clamp(Math.round((consult.budget?.perExpert ?? 260) * 1.4), 1200, 2400)
      const independent = await mapLimit(members, maxParallel, async (member, index) => {
        const entry = {
          kind: 'independent',
          expert: member.expert.id,
          expertName: member.expert.name.zh,
          role: member.role,
          status: 'pending',
          attempts: 0,
        }
        run.experts.push(entry)
        const prompt = withReasoningFloor(
          'expert',
          buildExpertPrompt({
            expert: member.expert,
            domain,
            question: consult.question,
            context: consult.context,
            mode,
            maxTokens: perExpertTokens,
          }),
        )
        try {
          const { parsed, reply } = await callJson('expert', member.expert.id, prompt, {
            schema: EXPERT_SCHEMA,
            maxTokens: prompt.maxTokens,
            validate: (value) => Array.isArray(value.claims) && value.claims.length > 0 && typeof value.stance === 'string',
          })
          entry.attempts = reply.attempt ?? 1
          entry.tokens = usageTotal(reply.usage)
          entry.latencyMs = reply.latencyMs
          if (!parsed) {
            entry.status = 'degraded'
            run.warnings.push(`${member.expert.name.zh} 未返回结构化 JSON，已用原始回复降级为一条假设`)
            const fallback = normalizeOpinion(
              {
                expert: member.expert.id,
                stance: 'conditional',
                confidence: 0.35,
                claims: [
                  {
                    claim: truncate(reply.text || '（空回复）', 120),
                    evidence: '[D] 模型未返回结构化主张，原始文本替代',
                    confidence: 0.3,
                  },
                ],
                changes: '',
                unknowns: ['该专家输出未满足 JSON 契约'],
              },
              { teamIds: members.map((item) => item.expert.id) },
            )
            return { ...fallback, expertName: member.expert.name.zh, tokens: entry.tokens, status: 'degraded' }
          }
          entry.status = 'ok'
          return opinionFromParsed(parsed, member)
        } catch (error) {
          if (error?.aborted) throw error
          entry.status = 'failed'
          entry.error = String(error?.message ?? error)
          run.failures.push({ expert: member.expert.id, stage: 'independent', error: entry.error })
          return null
        }
      })
      const opinions = independent.filter(Boolean)
      run.opinions = opinions
      run.quorum.success = opinions.length
      run.quorum.ok = opinions.length >= run.quorum.required
      emit('independent-done')
      if (!run.quorum.ok) {
        throw new PanelRunError(
          `独立意见不足法定人数：${opinions.length}/${members.length} 成功（需要 ${run.quorum.required}）。${failureHint()}`,
          { code: 'QUORUM_FAILED', run },
        )
      }

      // ---- write round 1 through the service gates ------------------------
      let recorded = await lifecycle.recordRound({
        round: 1,
        opinions: opinions.map(stripForRecord),
        note: `真实会诊 · ${run.provider}/${run.model} · 独立成稿`,
      })
      run.disagreements = asArray(recorded?.disagreements)
      emit('independent-recorded')

      // ---- cross-examination ----------------------------------------------
      if (mode !== 'lean' && run.disagreements.length > 0) {
        emit('cross-exam')
        const byExpert = new Map()
        for (const item of run.disagreements) {
          if (!byExpert.has(item.a)) byExpert.set(item.a, new Set())
          if (!byExpert.has(item.b)) byExpert.set(item.b, new Set())
          byExpert.get(item.a).add(item.b)
          byExpert.get(item.b).add(item.a)
        }
        const targets = [...byExpert.entries()]
          .filter(([, opponents]) => opponents.size > 0)
          .slice(0, Math.min(4, run.disagreements.length + 1))
        const revisions = []
        await mapLimit(targets, maxParallel, async ([expertId, opponentSet], index) => {
          const member = members.find((entry) => entry.expert.id === expertId)
          const own = opinions.find((opinion) => opinion.expert === expertId)
          if (!member || !own) return null
          const opponents = [...opponentSet]
            .map((id, opponentIndex) => {
              const opinion = opinions.find((entry) => entry.expert === id)
              if (!opinion) return null
              return {
                label: String.fromCharCode(65 + (opponentIndex % 6)),
                expert: id,
                stance: opinion.stance,
                confidence: opinion.confidence,
                claims: opinion.claims,
              }
            })
            .filter(Boolean)
          if (opponents.length === 0) return null
          const prompt = withReasoningFloor(
            'cross',
            buildCrossExamPrompt({
              expert: member.expert,
              domain,
              question: consult.question,
              context: consult.context,
              own,
              opponents,
              maxTokens: clamp(Math.round(perExpertTokens * 0.8), 1000, 1600),
            }),
          )
          try {
            const { parsed, reply } = await callJson('cross', expertId, prompt, {
              schema: CROSS_SCHEMA,
              maxTokens: prompt.maxTokens,
              validate: (value) => Array.isArray(value.responses),
            })
            run.experts.push({
              kind: 'cross',
              expert: expertId,
              expertName: member.expert.name.zh,
              status: parsed ? 'ok' : 'degraded',
              attempts: reply.attempt ?? 1,
              tokens: usageTotal(reply.usage),
              latencyMs: reply.latencyMs,
            })
            const changed = parsed ? String(parsed.final_stance ?? own.stance) !== String(own.stance) : false
            const reason = parsed?.responses?.map((item) => `${item.opponent}:${item.reason}`).join('；')
            run.crossExam.push({
              expert: expertId,
              label: expertId,
              summary: truncate(reason || '坚持原立场（未返回可用交叉质询）', 400),
              changed,
              parsed: parsed ?? null,
            })
            if (!parsed) {
              run.warnings.push(`${member.expert.name.zh} 的交叉质询未返回可解析 JSON，保留原意见`)
              return null
            }
            const evidence = parsed.responses?.map((item) => item.evidence).find(Boolean) || '[D] 交叉质询未给出证据'
            const revised = normalizeOpinion(
              {
                expert: expertId,
                stance: parsed.final_stance ?? own.stance,
                confidence: parsed.confidence ?? own.confidence,
                claims: [
                  {
                    claim: truncate(reason || '交叉质询后维持原判断', 200),
                    evidence,
                    confidence: parsed.confidence ?? own.confidence,
                  },
                ],
                changes: parsed.changes,
              },
              { teamIds: members.map((item) => item.expert.id) },
            )
            revisions.push({ ...revised, expertName: member.expert.name.zh, round: 2 })
            return null
          } catch (error) {
            if (error?.aborted) throw error
            run.experts.push({ kind: 'cross', expert: expertId, expertName: member.expert.name.zh, status: 'failed', attempts: 1, tokens: 0, error: String(error?.message ?? error) })
            run.failures.push({ expert: expertId, stage: 'cross-exam', error: String(error?.message ?? error) })
            run.warnings.push(`${member.expert.name.zh} 的交叉质询失败`)
            return null
          }
        })
        if (revisions.length > 0) {
          try {
            recorded = await lifecycle.recordRound({
              round: 2,
              opinions: revisions.map(stripForRecord),
              note: `真实会诊 · 交叉质询修订`,
            })
            run.disagreements = asArray(recorded?.disagreements)
          } catch (error) {
            run.warnings.push(`交叉质询修订未能写回台账：${error?.message ?? error}`)
          }
        }
        emit('cross-exam-done')
      }

      // ---- anonymous peer review (deep only) -------------------------------
      if (mode === 'deep' && run.usage.totalTokens < cap * 1.35) {
        emit('peer-review')
        const reviewers = opinions.slice(0, 4)
        const peerEntries = []
        await mapLimit(reviewers, maxParallel, async (opinion) => {
          const member = members.find((entry) => entry.expert.id === opinion.expert)
          if (!member) return null
          const peers = opinions
            .filter((entry) => entry.expert !== opinion.expert)
            .slice(0, 2)
            .map((entry, index) => ({ label: String.fromCharCode(65 + index), ...entry }))
          if (peers.length === 0) return null
          const prompt = buildPeerReviewPrompt({
            expert: member.expert,
            domain,
            question: consult.question,
            peers,
            maxTokens: clamp(Math.round(perExpertTokens * 0.7), 900, 1400),
          })
          try {
            const { parsed, reply } = await callJson('peer', opinion.expert, prompt, {
              schema: PEER_SCHEMA,
              maxTokens: prompt.maxTokens,
              validate: (value) => Array.isArray(value.reviews),
            })
            run.experts.push({ kind: 'peer', expert: opinion.expert, expertName: member.expert.name.zh, status: parsed ? 'ok' : 'degraded', attempts: reply.attempt ?? 1, tokens: usageTotal(reply.usage), latencyMs: reply.latencyMs })
            if (parsed) {
              peerEntries.push({
                expert: opinion.expert,
                summary: truncate(asArray(parsed.reviews).map((item) => `${item.peer}:${item.flag}`).join('；'), 400),
                parsed,
              })
            }
          } catch (error) {
            if (error?.aborted) throw error
            run.failures.push({ expert: opinion.expert, stage: 'peer-review', error: String(error?.message ?? error) })
            run.warnings.push(`${member.expert.name.zh} 的同行评议失败`)
          }
          return null
        })
        run.peerReviews = peerEntries
        emit('peer-review-done')
      }

      // ---- chair synthesis -------------------------------------------------
      emit('verdict')
      const latestOpinions = mergeLatestOpinions(opinions, run.crossExam, members)
      const chairPrompt = withReasoningFloor(
        'chair',
        buildChairPrompt({
          team,
          domain,
          question: consult.question,
          context: consult.context,
          opinions: latestOpinions,
          disagreements: run.disagreements,
          crossExam: run.crossExam,
          peerReviews: run.peerReviews,
          maxTokens: clamp(Math.round(cap * 0.8), 3500, 6000),
        }),
      )
      let chair = await callJson('chair', 'chair', chairPrompt, {
        schema: CHAIR_SCHEMA,
        maxTokens: chairPrompt.maxTokens,
        validate: (value) => typeof value.decision === 'string' && value.decision.trim().length >= 4 && typeof value.rationale === 'string',
      })
      let parsed = chair.parsed
      if (parsed && run.disagreements.length > 0 && (!Array.isArray(parsed.dissent) || parsed.dissent.length === 0)) {
        run.warnings.push('主持初稿未回应分歧，触发一次强制异议修复')
        const forced = await callJson(
          'chair-repair',
          'chair',
          {
            system: `${chairPrompt.system}\n\n必须逐条回应分歧并写入 dissent；dissent 不能为空。`,
            messages: [
              ...chairPrompt.messages,
              { role: 'assistant', content: [{ type: 'text', text: truncate(chair.reply?.text ?? '', 3000) }] },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `存在 ${run.disagreements.length} 处分歧，你上一版裁决没有 dissent。请重新输出裁决 JSON，dissent 至少包含 ${run.disagreements.length} 条，逐条写清谁、反对什么、依据。`,
                  },
                ],
              },
            ],
            temperature: 0.3,
          },
          { schema: CHAIR_SCHEMA, maxTokens: chairPrompt.maxTokens, validate: (value) => typeof value.decision === 'string' && value.decision.trim().length >= 4 },
        )
        if (forced.parsed) parsed = forced.parsed
        if (!parsed) {
          const text = forced.reply?.text || chair.reply?.text || ''
          const salvaged = salvagedVerdict(text, run)
          if (salvaged) {
            parsed = salvaged
            run.warnings.push('主持裁决 JSON 不完整（已尝试修复），已从文本中抢救出结论；建议人工复核主持原文')
          } else {
            run.warnings.push('主持未能返回可解析的裁决 JSON，已退回到「按专家意见统计」的降级裁决；该结论需人工复核')
            parsed = fallbackVerdict(latestOpinions, run)
          }
          run.failures.push({
            stage: 'verdict',
            error: '主持裁决 JSON 解析失败（已尝试修复）',
            replyPreview: truncate(text, 1200),
          })
        }
      }
      if (!parsed) {
        const text = chair.reply?.text ?? ''
        const salvaged = salvagedVerdict(text, run)
        if (salvaged) {
          parsed = salvaged
          run.warnings.push('主持裁决 JSON 不完整，已从文本中抢救出结论；建议人工复核主持原文')
        } else {
          run.warnings.push('主持未能返回可解析的裁决 JSON，已退回到「按专家意见统计」的降级裁决；该结论需人工复核')
          parsed = fallbackVerdict(latestOpinions, run)
        }
        run.failures.push({ stage: 'verdict', error: '主持裁决 JSON 解析失败', replyPreview: truncate(text, 1200) })
      }
      const verdict = normalizeVerdict({
        decision: parsed.decision,
        confidence: parsed.confidence,
        rationale: parsed.rationale,
        dissent: parsed.dissent,
        unresolved: parsed.unresolved,
        reversalTriggers: parsed.reversalTriggers,
        actions: parsed.actions,
        artifactNotes: parsed.artifactNotes,
      })
      const written = await lifecycle.writeVerdict(verdict, { source: 'run', runId })
      run.verdict = written.verdict ?? verdict
      mergeWarnings(run, written.warnings)
      return finishRun(run, consult, team, domain, lifecycle, emit)
    } catch (error) {
      run.finishedAt = nowMs()
      run.status = error?.aborted ? 'canceled' : 'failed'
      const baseMessage = String(error?.message ?? error)
      // Every failed run names its route and the two proven mitigations.
      const message =
        run.status === 'failed' && !baseMessage.includes('模型路由') ? `${baseMessage}；${failureHint()}` : baseMessage
      run.error = message
      run.failures.push({ stage: run.stage, error: message })
      try {
        await lifecycle.saveRun(run)
      } catch (saveError) {
        log.warn?.(`failed to persist aborted run: ${saveError?.message ?? saveError}`)
      }
      try {
        emit('failed')
      } catch {
        /* ignore */
      }
      if (error instanceof PanelRunError) {
        error.run = run
        if (error.message !== message) error.message = message
        throw error
      }
      throw new PanelRunError(message, { code: 'RUN_FAILED', run, aborted: Boolean(error?.aborted) })
    }
  }

  async function finishRun(run, consult, team, domain, lifecycle, emit) {
    run.finishedAt = nowMs()
    run.status = 'finished'
    if (run.usage.totalTokens > run.budget * 1.2) {
      run.warnings.push(
        `实际用量 ${run.usage.totalTokens} token 超过预算 ${run.budget}（推理模型的思考 token 也计入）；结论有效，但下次可降档或缩短问题。`,
      )
    }
    emit('report')
    const report = buildReport({ consult, team, domain, run, verdict: run.verdict })
    const saved = await lifecycle.saveReport(run, report)
    run.reportPath = saved?.reportPath ?? null
    await lifecycle.saveRun(run)
    emit('finished')
    return snapshot(run)
  }

  function snapshot(run) {
    return {
      runId: run.runId,
      consultId: run.consultId,
      stage: run.stage,
      status: run.status,
      mode: run.mode,
      intent: run.intent ?? 'review',
      domainId: run.domainId,
      provider: run.provider,
      model: run.model,
      reasoning: run.reasoning === true,
      callTimeoutMs: run.callTimeoutMs ?? null,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      usage: { ...run.usage },
      budget: run.budget,
      quorum: { ...run.quorum },
      experts: run.experts.map((entry) => ({
        kind: entry.kind,
        expert: entry.expert,
        expertName: entry.expertName,
        status: entry.status,
        tokens: entry.tokens ?? 0,
        latencyMs: entry.latencyMs ?? 0,
      })),
      disagreements: run.disagreements.length,
      taskTitle: run.taskResult?.title ?? null,
      taskChars: run.taskResult?.artifact?.length ?? 0,
      warnings: run.warnings.slice(0, 8),
      error: run.error ?? null,
      reportPath: run.reportPath,
    }
  }

  return { executeRun }
}

function stripForRecord(opinion) {
  return {
    expert: opinion.expert,
    stance: opinion.stance,
    confidence: opinion.confidence,
    claims: opinion.claims,
    changes: opinion.changes,
    unknowns: opinion.unknowns,
  }
}

function mergeLatestOpinions(opinions, crossExam, members) {
  return opinions.map((opinion) => {
    const cross = crossExam.find((entry) => entry.expert === opinion.expert)
    if (!cross) return opinion
    const changed = cross.parsed?.final_stance ? cross.parsed.final_stance : null
    return changed ? { ...opinion, stance: changed, changes: cross.parsed?.changes || opinion.changes } : opinion
  })
}

function mergeWarnings(run, warnings) {
  for (const warning of asArray(warnings)) {
    if (typeof warning === 'string' && warning.trim()) run.warnings.push(warning)
  }
}

