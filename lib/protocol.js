/**
 * The collaboration protocol.
 *
 * This module is the "mechanism" half of the plugin: it decides how a panel is
 * allowed to reach a conclusion, what an opinion must look like, how much a
 * panel may spend, and how a brief is rendered. The UI, the tool, the command
 * and the service all render/store the same protocol, so behaviour does not
 * drift between entry points.
 *
 * Design sources (synthesised, not copied): independent-first review and
 * anonymous peer review (Karpathy-style LLM council), role/mandate separation
 * from role-driven delivery methods, and evidence-first decision records with
 * explicit dissent and reversal triggers (internal audit practice).
 */

import { BOUNDARY_NOTE } from './isolation.js'

export const PROTOCOL_RULES = [
  {
    id: 'independent-first',
    title: '独立先行',
    text: '每位专家先独立成稿，不得先看他人结论；深会诊用匿名编号互评，避免权威与锚定效应。',
  },
  {
    id: 'evidence-gate',
    title: '证据门槛',
    text: '每条主张必须绑定可核验证据（文件:行、命令输出、数据、引用）；没有证据的标为假设，不进裁决。',
  },
  {
    id: 'disagreement-only',
    title: '只谈分歧',
    text: '交叉质询只针对立场或证据冲突，不重复共识、不扩新话题；共识部分直接进入裁决。',
  },
  {
    id: 'dissent-on-record',
    title: '异议留档',
    text: '存在分歧时必须写 dissent（谁、反对什么、依据什么）；裁决必须逐条回应，不允许抹平。',
  },
  {
    id: 'stay-in-lens',
    title: '越权降权',
    text: '专家只在自己的镜头内计票；跨镜头意见标注 out-of-scope，供参考但不计入共识。',
  },
  {
    id: 'budget-hard-cap',
    title: '预算硬顶',
    text: '每个阶段有 token 上限；到顶即停，输出当前最佳结论并标注「未完成的检查」。',
  },
  {
    id: 'leavable-trail',
    title: '留痕可复查',
    text: '裁决必须带置信度、未决问题与推翻条件；会诊记录持久化，任何结论都能追溯到意见与证据。',
  },
]

/** Protocol depths. Costs are whole-consult token budgets, not per-call. */
export const MODES = [
  {
    id: 'lean',
    label: '轻会诊',
    english: 'Lean',
    when: '例行检查、低风险、想先听一耳朵',
    stages: ['define', 'lenses', 'verdict'],
    spawns: 0,
    fact: 'lead 用多个镜头在同一轮里逐条检查，输出一条紧凑裁决；不单独写意见 JSON。',
    factor: 0.34,
  },
  {
    id: 'standard',
    label: '标准会诊',
    english: 'Standard',
    when: '重要决策、需要可追溯的意见与异议',
    stages: ['define', 'independent', 'cross', 'verdict'],
    spawns: 0,
    fact: 'Host 为每位专家单独发起一次独立模型调用（并行），再只对分歧做交叉质询，最后由主持裁决。',
    factor: 1,
  },
  {
    id: 'deep',
    label: '深会诊',
    english: 'Deep',
    when: '高风险、不可逆、需要真正独立的并行意见',
    stages: ['define', 'independent', 'anonymous-peer', 'cross', 'verdict'],
    spawns: 0,
    fact: '每位专家独立调用后匿名互评，再只对分歧交叉质询；成本最高，只在必要时升档。',
    factor: 2.6,
  },
]

export const MODE_BY_ID = new Map(MODES.map((mode) => [mode.id, mode]))
export const DEFAULT_MODE = 'standard'

export const LIMITS = {
  questionMin: 8,
  questionMax: 4000,
  contextMax: 6000,
  opinionMaxClaims: 4,
  opinionsMaxPerRound: 10,
  roundsMax: 4,
  maxTokenOverrun: 0.2,
  confidenceExtremeWithoutEvidence: 0.88,
}

/** The JSON shape one expert must return in standard/deep modes. */
export const OPINION_CONTRACT = `{"expert":"<lens id>","stance":"support|oppose|conditional","confidence":0.0,
 "claims":[{"claim":"一句话主张","evidence":"文件:行 / 命令输出 / 数据 / 引用","confidence":0.0}],
 "changes":"什么证据会改变我的结论",
 "unknowns":["我无法验证的点"]}`

/** The JSON shape the chair must return for a verdict. */
export const VERDICT_CONTRACT = `{"decision":"做|不做|有条件做（写条件）","confidence":0.0,
 "rationale":"为什么，逐条对应证据",
 "dissent":[{"expert":"<lens id>","point":"反对什么","evidence":"依据"}],
 "unresolved":["仍未解决的问题"],
 "reversalTriggers":["出现什么证据就应推翻本裁决"],
 "actions":["负责人 + 动作 + 期限"]}`

/**
 * Budget for one consult.
 *
 * @returns {{cap:number, opinionBudget:number, perExpert:number, verdictReserve:number, note:string}}
 */
export function estimateBudget(team, mode = DEFAULT_MODE) {
  const depth = MODE_BY_ID.get(mode) ?? MODE_BY_ID.get(DEFAULT_MODE)
  const base = Math.max(300, Number(team?.budget?.[depth.id]) || 1500)
  const members = Math.max(2, Array.isArray(team?.members) ? team.members.length : 3)
  // Opinion writing gets ~62% of the cap; the chair reserves the rest for
  // cross-examination, synthesis and the decision record.
  const opinionBudget = Math.round(base * (depth.id === 'lean' ? 0.55 : 0.62))
  const perExpert = Math.round(opinionBudget / members)
  const verdictReserve = base - opinionBudget
  return {
    cap: base,
    opinionBudget,
    perExpert,
    verdictReserve,
    note:
      depth.id === 'lean'
        ? '轻会诊不要求逐位专家 JSON；lead 按镜头逐条检查，控制在预算内。'
        : `每位专家约 ${perExpert} token 成稿；主持预留 ${verdictReserve} token 做交叉质询与裁决。`,
  }
}

export function roundsFor(mode = DEFAULT_MODE) {
  const depth = MODE_BY_ID.get(mode) ?? MODE_BY_ID.get(DEFAULT_MODE)
  return depth.stages.slice()
}

function expertCard(expert) {
  const asks = expert.asks.slice(0, 4).map((item) => `- ${item}`).join('\n')
  return [
    `**${expert.name.zh}（${expert.id}）** — 管：${expert.mandate}`,
    `镜头：${expert.lens}`,
    `必问：\n${asks}`,
    `红线（触发即否决）：${expert.redLines.join('；')}`,
    `易漏（其他镜头会补）：${expert.misses}`,
    expert.budget?.standard ? `预算：约 ${expert.budget.standard} token` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Render the convening brief.
 *
 * The brief is the *only* thing the model needs: it is deliberately compact and
 * only contains the selected lenses (progressive disclosure), so a 5-expert
 * panel costs far less than loading the whole roster.
 */
export function buildBrief({
  team,
  mode = DEFAULT_MODE,
  question,
  context,
  budget,
  includeContract = true,
  domain = null,
}) {
  const depth = MODE_BY_ID.get(mode) ?? MODE_BY_ID.get(DEFAULT_MODE)
  const plan = budget ?? estimateBudget(team, depth.id)
  const leads = team.members.filter((member) => member.role === 'lead')
  const lead = leads[0]?.id ?? team.members[0]?.id
  const lines = []
  lines.push(`# 专家团会诊简报 · ${team.name.zh}（${depth.label}）`)
  lines.push('')
  lines.push(`**问题**：${String(question ?? '').trim()}`)
  if (context && String(context).trim().length > 0) {
    lines.push('')
    lines.push('**已知背景**：')
    lines.push(String(context).trim())
  }
  lines.push('')
  if (domain) {
    lines.push(`## 专业领域：${domain.name.zh}（${domain.id}）`)
    lines.push(domain.tagline)
    const levels = (domain.evidence?.levels ?? []).map((level) => `${level.id}=${level.label}`).join('；')
    if (levels) lines.push(`- 证据等级：${levels}`)
    if (domain.evidence?.required?.length) lines.push(`- 必须核验：${domain.evidence.required.join('；')}`)
    if (domain.evidence?.redFlags?.length) lines.push(`- 红旗：${domain.evidence.redFlags.join('；')}`)
    if (domain.artifacts?.length) lines.push(`- 本领域交付物：${domain.artifacts.join('、')}`)
    lines.push('')
  }
  lines.push('## 议程（先定问题，再给结论）')
  for (const item of team.agenda) lines.push(`- ${item}`)
  lines.push('')
  lines.push('## 会诊铁律')
  for (const rule of PROTOCOL_RULES) lines.push(`- **${rule.title}**：${rule.text}`)
  lines.push('')
  lines.push('## 会议流程')
  lines.push(`- 阶段：${depth.stages.join(' → ')}`)
  lines.push(`- 主持：${lead}（负责合并、暴露分歧、给出裁决）`)
  lines.push(`- 模式说明：${depth.fact}`)
  lines.push('')
  lines.push('## 边界（与 DSH 内置智能体团队互不干扰）')
  lines.push(`- ${BOUNDARY_NOTE}`)
  lines.push('- 本次会诊是用户明确发起的一次性协议执行，不会常驻、不会自动触发。')
  lines.push('')
  lines.push('## 专家镜头（只加载本团专家）')
  for (const member of team.members) {
    const expert = member.expert
    if (!expert) continue
    lines.push('')
    lines.push(`${member.role === 'lead' ? '### 主持 / ' : '### '}${expert.name.zh}（${expert.id}）${member.role === 'lead' ? '' : ''}`)
    lines.push(`管：${expert.mandate}`)
    lines.push(`镜头：${expert.lens}`)
    lines.push(`必问：${expert.asks.slice(0, 4).join(' / ')}`)
    lines.push(`红线：${expert.redLines.join('；')}`)
    lines.push(`易漏：${expert.misses}`)
    lines.push(`预算：约 ${member.role === 'lead' ? Math.round(plan.perExpert * 1.2) : plan.perExpert} token`)
  }
  lines.push('')
  if (includeContract && depth.id !== 'lean') {
    lines.push('## 输出契约（每人一份，JSON，不符合即打回）')
    lines.push('```json')
    lines.push(OPINION_CONTRACT)
    lines.push('```')
    lines.push('')
    lines.push('裁决（主持最后输出，必须逐条回应 dissent）：')
    lines.push('```json')
    lines.push(VERDICT_CONTRACT)
    lines.push('```')
    lines.push('')
  }
  lines.push('## 预算与降档')
  lines.push(
    `- 本次会诊预算：约 ${plan.cap} token（成稿 ${plan.opinionBudget}，裁决预留 ${plan.verdictReserve}）；实际用量以运行记录为准，推理模型的思考 token 也计入，超预算只告警不中断。`,
  )
  lines.push(`- ${plan.note}`)
  lines.push('- 真实会诊会给每次调用留出足够输出额度（不低于 1200 token）；推理模型的思考 token 也计入实际用量，超支只告警不中断。')
  lines.push('- 到顶即停：输出当前最佳结论 + 标注「未完成的检查」；不允许超预算继续。')
  lines.push('- 想加人/升档要说明理由；默认保持本档位。')
  lines.push('')
  lines.push('## 落库（用工具写回，别只在聊天里说）')
  lines.push('1. `expert_council({action:"record", id:"<consultId>", opinions:[...]})` — 标准/深会诊逐轮写意见，工具会算分歧与 token。')
  lines.push('2. `expert_council({action:"verdict", id:"<consultId>", decision, confidence, rationale, dissent, unresolved, reversalTriggers, actions})` — 裁决落库。')
  lines.push('3. 收尾：`expert_council({action:"get", id:"<consultId>"})` 复核；把最终裁决用 3–6 行汇报给用户。')
  lines.push('')
  lines.push('## 裁决标准')
  lines.push('- 没有证据的主张只能作为「假设」，不得作为决策依据。')
  lines.push('- 存在分歧时 dissent 不能为空；裁决必须逐条回应异议。')
  lines.push('- 置信度 > 0.9 需要强证据支撑；不确定就写 0.6–0.8 并给推翻条件。')
  lines.push('- 裁决要写清「谁、做什么、何时复查」，否则视为未完成。')
  return lines.join('\n')
}

/** Judge one opinion's evidence coverage and shape. */
export function auditOpinion(opinion) {
  const claims = Array.isArray(opinion?.claims) ? opinion.claims : []
  const missing = claims.filter(
    (claim) => !claim || typeof claim.evidence !== 'string' || claim.evidence.trim().length < 2,
  )
  const coverage = claims.length === 0 ? 0 : (claims.length - missing.length) / claims.length
  const confidence = Number(opinion?.confidence)
  const warnings = []
  if (claims.length === 0) warnings.push('没有主张，无法计入裁决')
  if (missing.length > 0) warnings.push(`${missing.length} 条主张缺证据，降级为假设`)
  if (Number.isFinite(confidence) && confidence > LIMITS.confidenceExtremeWithoutEvidence && coverage < 0.6) {
    warnings.push('高置信度但证据覆盖不足，建议下调置信度')
  }
  return { claims: claims.length, missing: missing.length, coverage, warnings }
}

/**
 * Detect real disagreements between opinions.
 *
 * A disagreement is either a stance conflict or a large confidence gap on the
 * same question. Claim-level semantic conflicts are left to the chair: the
 * protocol only forces cross-examination on signals it can prove.
 */
export function detectDisagreements(opinions) {
  const items = Array.isArray(opinions) ? opinions : []
  const out = []
  const seen = new Set()
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]
      const b = items[j]
      if (!a?.expert || !b?.expert) continue
      // The same lens speaking in two rounds is a revision, not a disagreement.
      if (a.expert === b.expert) continue
      const key = [a.expert, b.expert].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      const stanceA = String(a.stance ?? '')
      const stanceB = String(b.stance ?? '')
      if (stanceA && stanceB && stanceA !== stanceB) {
        out.push({
          a: a.expert,
          b: b.expert,
          kind: 'stance',
          reason: `${a.expert}=${stanceA} vs ${b.expert}=${stanceB}`,
        })
        continue
      }
      const ca = Number(a.confidence)
      const cb = Number(b.confidence)
      if (Number.isFinite(ca) && Number.isFinite(cb) && Math.abs(ca - cb) >= 0.45) {
        out.push({
          a: a.expert,
          b: b.expert,
          kind: 'confidence',
          reason: `置信度差距 ${Math.abs(ca - cb).toFixed(2)}`,
        })
      }
    }
  }
  return out
}

export function modeLabel(mode) {
  return (MODE_BY_ID.get(mode) ?? MODE_BY_ID.get(DEFAULT_MODE)).label
}

