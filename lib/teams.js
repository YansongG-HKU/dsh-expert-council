/**
 * Team presets — the composition layer.
 *
 * A team is a small, opinionated group with one chair (the integrator role is
 * represented by the team's `lead`), a default protocol depth, an agenda, and a
 * token budget per depth. Presets exist so the user never has to pick experts
 * from scratch, and so the same question gets a comparable panel across runs.
 */

export const TEAMS = [
  {
    id: 'architecture',
    name: { zh: '架构评审团', en: 'Architecture Review' },
    tagline: '结构、安全、可靠性、性能、成本，五镜头看一个设计。',
    intent: '做架构/方案设计评审、技术选型、重构建模时用。',
    defaultMode: 'standard',
    members: [
      { id: 'architect', role: 'lead' },
      { id: 'security', role: 'member' },
      { id: 'sre', role: 'member' },
      { id: 'performance', role: 'member' },
      { id: 'cost', role: 'member' },
    ],
    agenda: ['这个设计要解决的核心问题是什么？', '关键假设有哪些，错了会怎样？', '最可能的失败模式与回滚路径？', '现在必须做 vs 可以推迟的边界？'],
    artifacts: ['决策记录（裁决 + 异议 + 推翻条件）', '风险清单（按概率×影响排序）'],
    budget: { lean: 700, standard: 2100, deep: 5200 },
  },
  {
    id: 'security-review',
    name: { zh: '安全评审团', en: 'Security Review' },
    tagline: '攻击面、怀疑者、可靠性、合规，先问怎么被滥用。',
    intent: '上线前安全评审、权限模型/凭据设计、对外接口与数据处理评审。',
    defaultMode: 'standard',
    members: [
      { id: 'security', role: 'lead' },
      { id: 'skeptic', role: 'member' },
      { id: 'sre', role: 'member' },
      { id: 'legal', role: 'member' },
    ],
    agenda: ['信任边界在哪，谁控制输入？', '最坏情况爆炸半径多大？', '最小权限与凭据轮换怎么落实？', '哪些声明/数据用途需要披露？'],
    artifacts: ['威胁清单（资产 × 攻击路径 × 缓解）', '上线前必须修的硬项'],
    budget: { lean: 650, standard: 2000, deep: 5000 },
  },
  {
    id: 'product-decision',
    name: { zh: '产品决策团', en: 'Product Decision' },
    tagline: '用户价值、体验、数据、成本、反方，一次把「做不做」问清楚。',
    intent: '功能取舍、优先级、要不要做某件事、范围裁剪时用。',
    defaultMode: 'standard',
    members: [
      { id: 'product', role: 'lead' },
      { id: 'ux', role: 'member' },
      { id: 'data', role: 'member' },
      { id: 'cost', role: 'member' },
      { id: 'skeptic', role: 'member' },
    ],
    agenda: ['这是谁的问题，证据是什么？', '最小闭环是什么，明确不做什么？', '成功/失败怎么度量？', '如果结论错了，最可能错在哪？'],
    artifacts: ['决策：做 / 不做 / 有条件做（含范围）', '验证计划与复查触发条件'],
    budget: { lean: 700, standard: 2100, deep: 5200 },
  },
  {
    id: 'code-review',
    name: { zh: '代码评审团', en: 'Code Review' },
    tagline: '结构、安全、性能、反例，针对一次具体改动。',
    intent: '重要 PR / 模块设计评审；比单人 review 多镜头、但控制成本。',
    defaultMode: 'lean',
    members: [
      { id: 'architect', role: 'lead' },
      { id: 'security', role: 'member' },
      { id: 'performance', role: 'member' },
      { id: 'skeptic', role: 'member' },
    ],
    agenda: ['这次改动引入/破坏了什么边界？', '有没有安全或性能硬伤？', '最可能出 bug 的边界条件？', '测试覆盖了哪些、漏了哪些？'],
    artifacts: ['按严重度排序的问题清单（含文件/行证据）', '合并前必须修复项'],
    budget: { lean: 550, standard: 1500, deep: 3800 },
  },
  {
    id: 'research-review',
    name: { zh: '研究评议团', en: 'Research Review' },
    tagline: '领域正确性、先例证据、数据强度、反方，给结论分证据等级。',
    intent: '评估一份研究结论/报告/方案的可信度与可复现性。',
    defaultMode: 'standard',
    members: [
      { id: 'domain', role: 'lead' },
      { id: 'researcher', role: 'member' },
      { id: 'data', role: 'member' },
      { id: 'skeptic', role: 'member' },
    ],
    agenda: ['核心结论是什么，证据等级多少？', '先例/基准是什么，和它比如何？', '最大未知与最便宜的反证实验？', '什么条件下结论不成立？'],
    artifacts: ['证据等级表（结论 × 证据 × 置信）', '需要补的实验/数据'],
    budget: { lean: 650, standard: 2000, deep: 5000 },
  },
  {
    id: 'incident-retro',
    name: { zh: '事故复盘团', en: 'Incident Retro' },
    tagline: '可靠性、安全、落地、数据，把「为什么坏」和「怎么不再坏」分开。',
    intent: '线上事故复盘、重大故障归因、改进项排序。',
    defaultMode: 'standard',
    members: [
      { id: 'sre', role: 'lead' },
      { id: 'security', role: 'member' },
      { id: 'operator', role: 'member' },
      { id: 'data', role: 'member' },
    ],
    agenda: ['时间线里第一个异常是什么？', '为什么没有更早发现/拦住？', '哪些改进项真正降低复发概率？', '谁负责、什么时候验证有效？'],
    artifacts: ['时间线 + 根因（区分触发因素与系统性原因）', '改进项（负责人 × 期限 × 验证方式）'],
    budget: { lean: 650, standard: 2000, deep: 5000 },
  },
  {
    id: 'shipping',
    name: { zh: '上线评审团', en: 'Shipping Review' },
    tagline: '落地、可靠性、安全、产品，回答「明天能不能上、上了谁管」。',
    intent: '发布前 gate：上线可行性、值班、回滚、用户影响。',
    defaultMode: 'lean',
    members: [
      { id: 'operator', role: 'lead' },
      { id: 'sre', role: 'member' },
      { id: 'security', role: 'member' },
      { id: 'product', role: 'member' },
    ],
    agenda: ['部署与回滚步骤是否可复现？', '上线后谁值班、看什么指标？', '有没有安全/合规阻塞项？', '用户会感知到什么变化？'],
    artifacts: ['Go / No-Go 裁决 + 阻塞项', '上线 checklist 与回滚点'],
    budget: { lean: 500, standard: 1500, deep: 3600 },
  },
  {
    id: 'debate',
    name: { zh: '红蓝对抗团', en: 'Red/Blue Debate' },
    tagline: '质疑者 vs 综合者+领域，强制把最强反对意见说完整。',
    intent: '已有倾向但需要压力测试；重大不可逆决策前的反方演练。',
    defaultMode: 'deep',
    members: [
      { id: 'skeptic', role: 'lead' },
      { id: 'domain', role: 'member' },
      { id: 'architect', role: 'member' },
      { id: 'integrator', role: 'member' },
    ],
    agenda: ['支持方的三个最强论据是什么？', '反方最强反驳是什么？', '什么证据能一锤定音？', '若必须现在决定，最小后悔的选择是什么？'],
    artifacts: ['正方/反方最强论据对照', '可推翻结论的证据清单'],
    budget: { lean: 750, standard: 2300, deep: 5600 },
  },
]

export const TEAM_BY_ID = new Map(TEAMS.map((team) => [team.id, team]))

export function getTeam(id) {
  return TEAM_BY_ID.get(id) ?? null
}

export function teamName(team, lang = 'zh') {
  return team?.name?.[lang] ?? team?.id ?? 'unknown'
}
