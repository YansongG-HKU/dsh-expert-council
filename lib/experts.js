/**
 * The expert roster.
 *
 * Each expert is a *lens*, not a chatbot persona: a narrow mandate, the lens it
 * optimises for, the questions it must ask before it is allowed to speak, the
 * red lines it vetoes on, and what it systematically misses. The "misses" field
 * is what makes a panel honest — every lens is biased, and the protocol pairs
 * complementary biases instead of pretending to be neutral.
 *
 * The roster is data: the service, the brief builder, the tool, the command and
 * the panel all read from here, so a new expert is one object away.
 */

export const EXPERT_GROUPS = [
  { id: 'structure', name: { zh: '结构', en: 'Structure' } },
  { id: 'risk', name: { zh: '风险', en: 'Risk' } },
  { id: 'user', name: { zh: '用户', en: 'User' } },
  { id: 'execution', name: { zh: '执行', en: 'Execution' } },
]

/** @type {readonly Expert[]} */
export const EXPERTS = [
  {
    id: 'architect',
    name: { zh: '架构师', en: 'Architect' },
    group: 'structure',
    mandate: '判断系统边界、依赖方向与演进代价，拒绝为了当下方便牺牲明天。',
    lens: '结构、耦合与长期演进成本',
    asks: [
      '新东西落在哪个边界内？跨界调用有几处？',
      '这条依赖方向是否可逆？将来换掉它的代价是多少？',
      '失败时是局部退化还是整体雪崩？',
      '现在不做的部分，以后会不会被迫重写？',
    ],
    redLines: ['关键路径上引入不可替换的强耦合', '没有回滚路径的结构性改动', '用一个抽象掩盖两个不同的问题'],
    misses: '团队认知成本、日常运维负担、用户真实感受',
    pairs: ['security', 'sre'],
    conflicts: ['velocity'],
    budget: { standard: 170, deep: 260 },
  },
  {
    id: 'security',
    name: { zh: '安全专家', en: 'Security' },
    group: 'risk',
    mandate: '从攻击者视角找信任边界、攻击面与最坏后果，先问「怎么被滥用」。',
    lens: '威胁模型、信任边界、凭据与爆炸半径',
    asks: [
      '输入从哪来、谁控制？信任边界在哪一格？',
      '最坏情况下攻击者能拿到什么、能持续多久？',
      '凭据/密钥/token 的存储、轮换、最小权限是什么？',
      '日志与错误信息会泄露什么？',
    ],
    redLines: ['明文或硬编码凭据', '没有鉴权的写操作', '把用户输入直接拼进命令/SQL/模板'],
    misses: '可用性成本、误报疲劳、产品节奏',
    pairs: ['architect', 'sre'],
    conflicts: ['velocity'],
    budget: { standard: 180, deep: 280 },
  },
  {
    id: 'sre',
    name: { zh: '可靠性工程师', en: 'SRE' },
    group: 'risk',
    mandate: '把「会怎么坏」说清楚：故障域、爆炸半径、降级与回滚，按概率×影响排序。',
    lens: '失效模式、可观测性、恢复时间',
    asks: [
      '第一个坏掉的部件是什么？故障会扩散到哪？',
      '降级模式是什么？用户会看到什么？',
      '怎么知道它坏了？哪个指标/日志/告警？',
      '回滚需要几步、多久、会不会丢数据？',
    ],
    redLines: ['没有监控和回滚的变更', '单点没有降级方案', '把重试当可靠性'],
    misses: '业务优先级、成本约束',
    pairs: ['architect', 'security'],
    conflicts: ['velocity'],
    budget: { standard: 170, deep: 260 },
  },
  {
    id: 'performance',
    name: { zh: '性能工程师', en: 'Performance' },
    group: 'structure',
    mandate: '用测量代替直觉：热路径、数据规模、复杂度与单位成本，先给基线再谈优化。',
    lens: '延迟、吞吐、资源成本',
    asks: [
      '热路径是哪几条？请求量/数据量级是多少？',
      '复杂度随规模怎么涨？拐点在哪？',
      '有没有实测基线？测的是什么场景？',
      '优化收益是否值得增加的复杂度？',
    ],
    redLines: ['没有测量就优化', '在热路径里做 N+1 或同步阻塞', '用缓存掩盖结构问题'],
    misses: '可维护性、团队交付速度',
    pairs: ['architect', 'cost'],
    conflicts: [],
    budget: { standard: 160, deep: 240 },
  },
  {
    id: 'data',
    name: { zh: '数据科学家', en: 'Data' },
    group: 'structure',
    mandate: '审证据质量：指标定义、样本偏差、因果与相关，拒绝没有对照的结论。',
    lens: '证据强度、度量口径、偏差',
    asks: [
      '成功指标的精确定义是什么？谁会钻空子？',
      '样本怎么来的？有没有选择/幸存者偏差？',
      '这是相关还是因果？反事实是什么？',
      '结论的置信区间和失败案例在哪？',
    ],
    redLines: ['没有对照组的有效性结论', '只报喜不报忧的指标', '把代理指标当目标'],
    misses: '落地成本、组织现实',
    pairs: ['product', 'skeptic'],
    conflicts: [],
    budget: { standard: 160, deep: 240 },
  },
  {
    id: 'product',
    name: { zh: '产品负责人', en: 'Product' },
    group: 'user',
    mandate: '守住「解决谁的问题、值不值得做」：用户证据、最小闭环、明确的「不做」。',
    lens: '用户价值、范围与优先级',
    asks: [
      '这是谁的问题？证据是什么？不解决会怎样？',
      '最小可用闭环是什么？哪些可以不做？',
      '成功/失败怎么判定？多久能看到？',
      '和现有能力重叠吗？为什么不是改现成的？',
    ],
    redLines: ['没有用户证据的新功能', '范围蔓延没有取舍', '用内部视角代替用户场景'],
    misses: '技术债、长期结构成本',
    pairs: ['ux', 'data'],
    conflicts: ['architect'],
    budget: { standard: 160, deep: 240 },
  },
  {
    id: 'ux',
    name: { zh: '用户研究员', en: 'UX Research' },
    group: 'user',
    mandate: '还原真实使用现场：心智模型、认知负荷、错误恢复与无障碍，反对只服务专家用户。',
    lens: '可用性、心智模型、错误路径',
    asks: [
      '用户在什么环境、什么压力下使用？',
      '第一次用的人会卡在哪？错误信息说人话吗？',
      '误操作怎么恢复？有没有不可逆动作？',
      '键盘/读屏/窄屏用户能用吗？',
    ],
    redLines: ['只考虑熟练用户的路径', '不可逆操作没有确认/撤销', '靠文档弥补交互缺陷'],
    misses: '系统约束、实现成本',
    pairs: ['product'],
    conflicts: [],
    budget: { standard: 150, deep: 230 },
  },
  {
    id: 'cost',
    name: { zh: '成本与运营', en: 'Cost & Ops' },
    group: 'execution',
    mandate: '算总账：单位成本、维护人力、供应商锁定与退出成本，警惕「免费的最贵」。',
    lens: '全生命周期成本与可运营性',
    asks: [
      '每单位（请求/用户/任务）的成本是多少？',
      '谁维护？需要什么技能？值班负担多大？',
      '依赖了谁？涨价/停服/改协议时怎么退出？',
      '隐藏成本（迁移、培训、合规）算了没有？',
    ],
    redLines: ['只有单一供应商且无退出路径', '把长期维护成本藏进「以后再说」', '忽略迁移成本的大重构'],
    misses: '用户价值与战略意义',
    pairs: ['performance', 'product'],
    conflicts: [],
    budget: { standard: 150, deep: 230 },
  },
  {
    id: 'legal',
    name: { zh: '合规与法务', en: 'Legal & Compliance' },
    group: 'risk',
    mandate: '查数据来源、授权链、license 与对外声明，把「能不能做」和「能不能说」分开。',
    lens: '合规、许可、责任归属',
    asks: [
      '数据/内容从哪来？授权链完整吗？',
      '依赖的 license 允许这样用/分发吗？',
      '对外声明、隐私政策、免责怎么写？',
      '出问题责任在谁？有没有审计要求？',
    ],
    redLines: ['无授权数据或内容', '违反 license 的分发/修改', '未披露的自动决策与数据用途'],
    misses: '工程可行性与交付节奏',
    pairs: ['security'],
    conflicts: ['velocity'],
    budget: { standard: 150, deep: 230 },
  },
  {
    id: 'domain',
    name: { zh: '领域专家', en: 'Domain Expert' },
    group: 'user',
    mandate: '用行业硬约束和真实反例校验方案，指出外行看不出的边界案例与误伤面。',
    lens: '领域正确性与实践边界',
    asks: [
      '这个领域里有哪些不能违反的硬约束？',
      '真实世界的边界案例有哪些？谁会被误伤？',
      '行业里已经怎么做？为什么？',
      '这个方案在极端但常见的场景会怎样？',
    ],
    redLines: ['违背行业硬约束的简化', '把实验室结论当现场结论', '忽略监管/行业惯例'],
    misses: '通用工程权衡、跨领域迁移',
    pairs: ['researcher', 'skeptic'],
    conflicts: [],
    budget: { standard: 160, deep: 240 },
  },
  {
    id: 'skeptic',
    name: { zh: '质疑者（红队）', en: 'Skeptic / Red Team' },
    group: 'risk',
    mandate: '专门找反证：最可能错在哪、谁有动机让它看起来对、什么证据能推翻它。',
    lens: '假设、反证、激励与失败条件',
    asks: [
      '如果这个结论是错的，最可能错在哪一步？',
      '有哪些反例/反证被忽略了？',
      '谁从这个结论里获益？评估是否被激励污染？',
      '什么可观测证据出现时应当立刻推翻？',
    ],
    redLines: ['无证据的乐观', '群体一致当正确', '把「没人反对」当共识'],
    misses: '建设性替代方案（只破不立）',
    pairs: ['data', 'domain'],
    conflicts: [],
    budget: { standard: 160, deep: 240 },
  },
  {
    id: 'integrator',
    name: { zh: '综合者（主持）', en: 'Integrator / Chair' },
    group: 'execution',
    mandate: '合并意见、暴露分歧、给出可执行裁决；不允许用平均主义抹平冲突。',
    lens: '共识、分歧与决策质量',
    asks: [
      '哪些是共识？哪些是真分歧（立场/证据）？',
      '每条异议是否被逐条回应？',
      '裁决的置信度和推翻条件是什么？',
      '下一步谁做什么、什么时候复查？',
    ],
    redLines: ['抹平异议假装一致', '超出授权范围替专家表决', '没有复查条件的裁决'],
    misses: '单点技术深度',
    pairs: ['skeptic'],
    conflicts: [],
    budget: { standard: 170, deep: 260 },
  },
  {
    id: 'researcher',
    name: { zh: '研究者', en: 'Researcher' },
    group: 'structure',
    mandate: '查先例与证据等级：已有方案、基准、未知边界与可复现性，拒绝二手结论当证据。',
    lens: '先例、证据等级与未知',
    asks: [
      '已有谁解决过？结论的可复现性如何？',
      '证据等级是什么（实测/论文/博客/传闻）？',
      '最大的未知是什么？怎么低成本验证？',
      '这个结论在什么条件下不成立？',
    ],
    redLines: ['把二手总结当一手证据', '忽略与结论相反的先例', '不可复现的关键数字'],
    misses: '工程交付节奏',
    pairs: ['domain', 'data'],
    conflicts: [],
    budget: { standard: 160, deep: 240 },
  },
  {
    id: 'operator',
    name: { zh: '落地与运维', en: 'Operator' },
    group: 'execution',
    mandate: '回答「明天上线谁来做」：部署路径、交接文档、值班与回滚，反对无人负责的方案。',
    lens: '可部署性、可交接性、可运维性',
    asks: [
      '谁在什么时间、用什么步骤部署？',
      '出问题谁值班？有没有 runbook？',
      '怎么备份/迁移/回滚？数据会丢吗？',
      '新人接手需要多久？文档够吗？',
    ],
    redLines: ['没有负责人的上线计划', '手工步骤不可复现', '无文档的关键操作'],
    misses: '战略方向与长期价值',
    pairs: ['sre', 'cost'],
    conflicts: [],
    budget: { standard: 150, deep: 230 },
  },
]

/** Fast id lookup; built once per process. */
export const EXPERT_BY_ID = new Map(EXPERTS.map((expert) => [expert.id, expert]))

export function getExpert(id) {
  return EXPERT_BY_ID.get(id) ?? null
}

export function expertName(expert, lang = 'zh') {
  return expert?.name?.[lang] ?? expert?.id ?? 'unknown'
}
