/**
 * Prompt builders for real multi-model panels.
 *
 * Every prompt is deliberately narrow: one lens, one JSON contract, explicit
 * evidence requirements, and a hard output budget. The calling model is not in
 * this loop at all — the Host sends these prompts to the model, so opinions are
 * genuinely independent answers rather than one answer role-playing a panel.
 */

const MAX_CASE_CHARS = 6000

function caseBlock(question, context) {
  const q = String(question ?? '').trim()
  const c = String(context ?? '').trim()
  const lines = [`## 案件`, q]
  if (c) lines.push('', '## 已知背景', c.length > MAX_CASE_CHARS ? `${c.slice(0, MAX_CASE_CHARS)}…（截断）` : c)
  return lines.join('\n')
}

function list(items, fallback = '（无）') {
  const clean = (Array.isArray(items) ? items : []).filter((item) => typeof item === 'string' && item.trim())
  return clean.length > 0 ? clean.map((item) => `- ${item.trim()}`).join('\n') : fallback
}

function evidenceBlock(domain) {
  if (!domain?.evidence) return ''
  const levels = (domain.evidence.levels ?? []).map((level) => `${level.id}=${level.label}（${level.meaning}）`).join('；')
  return [
    '## 本领域证据标准',
    levels ? `证据等级：${levels}` : '',
    domain.evidence.required?.length ? `必须核验：${domain.evidence.required.join('；')}` : '',
    domain.evidence.redFlags?.length ? `红旗（出现即降级）：${domain.evidence.redFlags.join('；')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function domainBlock(domain) {
  if (!domain) return ''
  return [
    `## 领域`,
    `${domain.name.zh}：${domain.tagline}`,
    domain.artifacts?.length ? `本领域交付物：${domain.artifacts.join('、')}` : '',
    evidenceBlock(domain),
  ]
    .filter(Boolean)
    .join('\n')
}

export const EXPERT_SCHEMA =
  '{"expert":"<id>","stance":"support|oppose|conditional","confidence":0-1,'
  + '"claims":[{"claim":"<=60字","evidence":"[A|B|C|D] 具体依据","confidence":0-1}],'
  + '"changes":"什么证据会改变你的结论","unknowns":[""]}'

export const CROSS_SCHEMA =
  '{"expert":"<id>","responses":[{"opponent":"A|B","agree_with_opponent":true|false,'
  + '"reason":"为什么","evidence":"[A|B|C|D] 依据"}],"final_stance":"support|oppose|conditional",'
  + '"confidence":0-1,"changes":""}'

export const PEER_SCHEMA =
  '{"expert":"<id>","reviews":[{"peer":"A|B","agree":true|false,"flag":"最强的反对点或遗漏",'
  + '"evidence":"[A|B|C|D] 依据"}],"revision":"如果重写，你会改哪一句"}'

export const CHAIR_SCHEMA =
  '{"decision":"做|不做|有条件做（写清条件）","confidence":0-1,"rationale":"逐条对应证据",'
  + '"dissent":[{"expert":"<id>","point":"反对什么","evidence":"依据"}],'
  + '"unresolved":[""],"reversalTriggers":["出现什么证据就应推翻"],"actions":["负责人+动作+期限"],'
  + '"artifactNotes":["按本领域交付物清单还缺什么"]}'

export const LEAN_SCHEMA =
  '{"lensChecks":[{"lens":"<镜头>","risk":"这个镜头看到的最大风险","evidence":"[A|B|C|D] 依据"}],'
  + '"decision":"做|不做|有条件做（条件）","confidence":0-1,"rationale":"","dissent":[],"unresolved":[],'
  + '"reversalTriggers":[],"actions":[]}'

function expertSystem(expert, domain) {
  return [
    `你是「${expert.name.zh}」（${expert.id}），${domain?.name?.zh ?? '专家团'}的${expert.mandate}`,
    `镜头：${expert.lens}`,
    '',
    '## 你必须先问',
    list(expert.asks),
    '',
    '## 红线（触发即否决）',
    list(expert.redLines),
    '',
    `## 你的已知盲区`,
    expert.misses,
    '',
    domainBlock(domain),
    '',
    '## 作答规则',
    '- 只从你的镜头出发；不要替其他专家说话，也不要假设他们会说什么。',
    '- 每条 claim 必须绑定可核验证据，并以证据等级开头（如 `[B] 2025Q3 回测，样本外 12 个月`）。',
    '- 证据不足时把置信度压到 0.7 以下，并在 unknowns 里写清缺什么。',
    '- 只输出一个 JSON 对象，不要 markdown 代码块、不要前后解释。',
    `- 输出契约：${EXPERT_SCHEMA}`,
    '- 最多 3 条 claim，总字数不超过 260 个中文字。',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

export function buildExpertPrompt({ expert, domain = null, question, context = '', mode = 'standard', maxTokens = 420 }) {
  return {
    system: expertSystem(expert, domain),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              caseBlock(question, context),
              '',
              '## 本次会诊议程',
              list(domain?.agenda ?? []),
              '',
              '请独立成稿：从你的镜头给出立场、置信度、最多 3 条带证据的主张，以及什么证据会改变你的结论。',
            ].join('\n'),
          },
        ],
      },
    ],
    maxTokens: Math.max(220, Math.min(1600, Math.trunc(maxTokens))),
    temperature: 0.55,
  }
}

export function buildCrossExamPrompt({
  expert,
  domain = null,
  question,
  context = '',
  own,
  opponents = [],
  maxTokens = 340,
}) {
  const opponentText = opponents
    .map((entry) =>
      [
        `### 专家 ${entry.label}（匿名）`,
        `立场：${entry.stance}；置信度：${Number(entry.confidence).toFixed(2)}`,
        ...(entry.claims ?? []).map((claim) => `- 主张：${claim.claim}\n  证据：${claim.evidence}`),
      ].join('\n'),
    )
    .join('\n\n')
  return {
    system: [
      `你是「${expert.name.zh}」（${expert.id}），现在只做交叉质询。`,
      `你的镜头：${expert.lens}`,
      '',
      domainBlock(domain),
      '',
      '## 交叉质询规则',
      '- 只回应下面列出的分歧点，不要重复共识，不要引入新话题。',
      '- 对方观点是匿名的（A/B），只按证据强弱判断，不要猜测对方是谁。',
      '- 可以坚持，也可以修改立场，但修改必须给出证据或明确指出对方证据的缺陷。',
      '- 只输出一个 JSON 对象，不要代码块、不要解释。',
      `- 输出契约：${CROSS_SCHEMA}`,
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              caseBlock(question, context),
              '',
              '## 你上一轮的意见',
              `立场：${own.stance}；置信度：${Number(own.confidence).toFixed(2)}`,
              ...(own.claims ?? []).map((claim) => `- 主张：${claim.claim}\n  证据：${claim.evidence}`),
              '',
              '## 与你冲突的匿名意见',
              opponentText || '（无）',
            ].join('\n'),
          },
        ],
      },
    ],
    maxTokens: Math.max(180, Math.min(900, Math.trunc(maxTokens))),
    temperature: 0.5,
  }
}

export function buildPeerReviewPrompt({ expert, domain = null, question, peers = [], maxTokens = 320 }) {
  return {
    system: [
      `你是「${expert.name.zh}」，现在做匿名同行评议。`,
      `你的镜头：${expert.lens}`,
      '',
      domainBlock(domain),
      '',
      '## 规则',
      '- 对匿名的 A/B 意见只做三件事：是否同意其核心判断、指出最强反对点或遗漏、给出依据。',
      '- 不按身份评判，只按证据与推理评判。',
      '- 只输出一个 JSON 对象，不要代码块、不要解释。',
      `- 输出契约：${PEER_SCHEMA}`,
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              caseBlock(question, ''),
              '',
              '## 待评议的匿名意见',
              ...peers.map((peer) =>
                [
                  `### 专家 ${peer.label}`,
                  `立场：${peer.stance}；置信度：${Number(peer.confidence).toFixed(2)}`,
                  ...(peer.claims ?? []).map((claim) => `- ${claim.claim}（证据：${claim.evidence}）`),
                ].join('\n'),
              ),
            ].join('\n'),
          },
        ],
      },
    ],
    maxTokens: Math.max(180, Math.min(900, Math.trunc(maxTokens))),
    temperature: 0.45,
  }
}

export function buildChairPrompt({
  team,
  domain = null,
  question,
  context = '',
  opinions = [],
  disagreements = [],
  crossExam = [],
  peerReviews = [],
  maxTokens = 1100,
}) {
  const opinionText = opinions
    .map((entry, index) =>
      [
        `### 专家 ${index + 1}：${entry.expertName}（${entry.expert}）`,
        `立场：${entry.stance}；置信度：${Number(entry.confidence).toFixed(2)}`,
        ...(entry.claims ?? []).map((claim) => `- 主张：${claim.claim}\n  证据：${claim.evidence}`),
        entry.changes ? `会改变结论的证据：${entry.changes}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n')
  const disagreementText =
    disagreements.length === 0
      ? '无分歧。'
      : disagreements
          .map((item) => `- ${item.a} vs ${item.b}（${item.kind}）：${item.reason}`)
          .join('\n')
  const crossText =
    crossExam.length === 0
      ? '未进行交叉质询。'
      : crossExam
          .map((entry) => `- ${entry.expert}：${entry.summary}${entry.changed ? '（已修改立场）' : '（坚持原立场）'}`)
          .join('\n')
  const peerText =
    peerReviews.length === 0
      ? '未进行匿名同行评议。'
      : peerReviews.map((entry) => `- ${entry.expert}：${entry.summary}`).join('\n')
  return {
    system: [
      `你是本次会诊的主持：${team.members.find((member) => member.role === 'lead')?.expert?.name?.zh ?? team.name.zh}。`,
      '你的职责是合并意见、暴露分歧、给出裁决；不允许用平均主义抹平冲突。',
      '',
      '## 裁决规则',
      '- 没有证据的主张只能作为假设，不能作为裁决依据。',
      '- 存在分歧时必须逐条写 dissent（谁、反对什么、依据什么），并逐条回应。',
      '- 置信度超过 0.9 需要强证据；否则写在 0.6–0.8 并给出推翻条件。',
      '- 裁决必须写清谁、做什么、何时复查。',
      '- 按本领域证据标准检查证据等级；证据不足要在 unresolved 里列出。',
      '- 只输出一个 JSON 对象，不要 markdown 代码块、不要解释。',
      '- 紧凑输出：总长 ≤ 1200 个汉字；rationale ≤ 250 字；dissent 最多 4 条、每条 point ≤ 80 字；不要复述专家原文或证据全文。',
      '- 先写 decision（尽量短），再写 rationale；JSON 必须闭合，宁短勿长。',
      `- 输出契约：${CHAIR_SCHEMA}`,
      domainBlock(domain),
    ]
      .filter((line) => line !== '')
      .join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              caseBlock(question, context),
              '',
              '## 议程',
              list(team.agenda),
              '',
              '## 独立意见',
              opinionText || '（无）',
              '',
              '## 分歧',
              disagreementText,
              '',
              '## 交叉质询结果',
              crossText,
              '',
              '## 匿名同行评议',
              peerText,
              '',
              domain?.artifacts?.length ? `## 交付物要求\n${domain.artifacts.map((item) => `- ${item}`).join('\n')}` : '',
              '',
              '请输出最终裁决 JSON。',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      },
    ],
    maxTokens: Math.max(500, Math.min(2600, Math.trunc(maxTokens))),
    temperature: 0.4,
  }
}

export function buildLeanPrompt({ team, domain = null, question, context = '', lenses = [], maxTokens = 900 }) {
  const lensText = lenses
    .map((expert) => `- ${expert.name.zh}：${expert.lens}；必问：${expert.asks.slice(0, 2).join(' / ')}；红线：${expert.redLines[0]}`)
    .join('\n')
  return {
    system: [
      `你是「${team.name.zh}」的综合评审主持。`, 
      '现在只做一次单轮多镜头检查：用下面的镜头逐条扫一遍案件，标出每个镜头看到的最大风险与证据，然后给出裁决。',
      '',
      '## 规则',
      '- 每个镜头至少给一条检查结论；没有证据的结论标为假设。',
      '- 存在分歧或无法判断时写进 dissent / unresolved，不要抹平。',
      '- 只输出一个 JSON 对象，不要代码块、不要解释。',
      `- 输出契约：${LEAN_SCHEMA}`,
      domainBlock(domain),
    ]
      .filter((line) => line !== '')
      .join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [caseBlock(question, context), '', '## 镜头清单', lensText].join('\n'),
          },
        ],
      },
    ],
    maxTokens: Math.max(400, Math.min(1800, Math.trunc(maxTokens))),
    temperature: 0.45,
  }
}
