/**
 * Real-run orchestration tests with a scripted fake `llm` service.
 *
 * These tests are the acceptance contract for "really runs a panel": experts
 * are independent parallel calls, replies are parsed/repaired, disagreement is
 * cross-examined, the chair must answer dissent, the service gates still apply,
 * the report is persisted, and cancel/quorum failures behave predictably.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../lib/store.js'
import { createExpertCouncilService } from '../lib/service.js'
import { createExpertCouncilTool } from '../lib/tools.js'
import { DOMAIN_PACKS } from '../lib/domains.js'

const quiet = { warn() {}, info() {} }
const SELECTION = { provider: 'fake', model: 'fake-1' }
const QUESTION = '是否把面向零售客户的跨境理财产品推荐改成基于大模型的个性化推荐？'

/** Scripted model: decides the reply from the prompt kind + expert id. */
function makeFakeLlm(script) {
  const state = {
    calls: [],
    active: 0,
    maxActive: 0,
    aborted: false,
  }
  function replyFor({ system, user, callIndex }) {
    if (/总集成者/.test(system)) {
      return script.merge?.({ system, user, callIndex }) ?? {
        text: JSON.stringify({
          title: '合并成果：可执行方案',
          summary: '合并了各位专家的产出，形成一份可直接使用的方案。',
          artifact: '# 合并成果：可执行方案\n\n## 目标\n\n完成用户交办的任务。\n\n## 步骤\n\n1. 执行第一步\n2. 执行第二步\n\n## 验证\n\n运行验证脚本。',
          deliverables: [
            { expert: 'finance-cro', title: '风险边界', contribution: '给出风险上限' },
            { expert: 'finance-compliance', title: '合规清单', contribution: '给出合规检查项' },
          ],
          assumptions: ['默认在本地环境执行'],
          risks: ['样本数据有限'],
          openQuestions: ['是否需要多环境部署？'],
          nextActions: ['召集人：评审后执行'],
        }),
      }
    }
    if (/任务会诊/.test(system)) {
      const expert = (system.match(/（([a-z-]+)）/) ?? [])[1] ?? 'unknown'
      return script.taskExpert?.({ expert, system, user, callIndex }) ?? {
        text: JSON.stringify({
          expert,
          deliverable: `${expert} 的完整产出`,
          content: `完整产出：${expert} 交付的可直接使用的内容。\n\n1. 第一步\n2. 第二步`,
          assumptions: ['假设本地可运行'],
          risks: ['未在生产验证'],
          handoff: ['交给集成者合并'],
        }),
      }
    }
    if (/交叉质询/.test(system)) {
      const expert = (system.match(/「[^」]+」（([a-z-]+)）/) ?? [])[1] ?? 'unknown'
      return script.cross?.({ expert, system, user, callIndex }) ?? {
        text: JSON.stringify({
          expert,
          responses: [{ opponent: 'A', agree_with_opponent: false, reason: '对方的样本口径不成立', evidence: '[B] 样本外回测 12 个月' }],
          final_stance: 'conditional',
          confidence: 0.62,
          changes: '如果对方能提供独立样本外验证，我会改变',
        }),
      }
    }
    if (/匿名同行评议/.test(system)) {
      const expert = (system.match(/「[^」]+」（([a-z-]+)）/) ?? [])[1] ?? 'unknown'
      return script.peer?.({ expert, system, user, callIndex }) ?? {
        text: JSON.stringify({ expert, reviews: [{ peer: 'A', agree: false, flag: '缺少客户适当性证据', evidence: '[A] 监管条文' }], revision: '补适当性章节' }),
      }
    }
    if (/综合评审主持/.test(system)) {
      return script.lean?.({ system, user, callIndex }) ?? { text: 'not-json' }
    }
    if (/主持/.test(system)) {
      return script.chair?.({ system, user, callIndex }) ?? {
        text: JSON.stringify({
          decision: '有条件推进：先做客户适当性评估与影子回测',
          confidence: 0.72,
          rationale: '样本外证据不足但方向可行；合规反对意见成立，先补适当性与影子验证',
          dissent: [{ expert: 'finance-compliance', point: '推荐算法可能触发适当性义务', evidence: '[A] 监管条文' }],
          unresolved: ['客户风险画像覆盖率未知'],
          reversalTriggers: ['影子回测显示适当性违规案例>0'],
          actions: ['风险官：两周内出适当性评估方案'],
          artifactNotes: ['投委会备忘录需补监管条款引用'],
        }),
      }
    }
    const expert = (system.match(/（([a-z-]+)）/) ?? [])[1]
    return script.expert?.({ expert, system, user, callIndex }) ?? {
      text: JSON.stringify({
        expert,
        stance: 'support',
        confidence: 0.6,
        claims: [{ claim: '方向可行', evidence: '[B] 同类产品样本外回测', confidence: 0.6 }],
        changes: '如果样本外回测失效则反对',
        unknowns: [],
      }),
    }
  }
  const llm = {
    async prepareCall(config) {
      return {
        config,
        stream: (options) => streamFor(options),
      }
    },
    stream: (options) => streamFor(options),
  }
  async function* streamFor(options) {
    const callIndex = state.calls.length
    const system = options.system ?? ''
    const user = (options.messages ?? [])
      .map((message) => (Array.isArray(message.content) ? message.content.map((block) => block?.text ?? '').join('') : String(message.content ?? '')))
      .join('\n')
    state.calls.push({ system, user, maxTokens: options.maxTokens })
    const fail = script.fail?.(system, state) === true
    const delay = script.delay ?? 8
    state.active += 1
    state.maxActive = Math.max(state.maxActive, state.active)
    try {
      await wait(delay, options.signal)
      if (fail) throw new Error('scripted provider failure')
      if (options.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      const reply = replyFor({ system, user, callIndex })
      const text = typeof reply === 'string' ? reply : reply.text
      const usage = { inputTokens: 40, outputTokens: 12 }
      yield* chunks(text, usage)
    } finally {
      state.active -= 1
    }
  }
  return { llm, state }
}

async function* chunks(text, usage) {
  const middle = Math.max(1, Math.floor(String(text).length / 2))
  yield { type: 'text-delta', index: 0, text: String(text).slice(0, middle) }
  yield { type: 'text-delta', index: 0, text: String(text).slice(middle) }
  yield { type: 'usage', usage }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

async function setup(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'expert-council-run-'))
  const store = createStore({ dir, log: quiet })
  const { llm, state } = makeFakeLlm(options.script ?? {})
  const ctx = {
    get: (name) => {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') return { currentSelection: () => SELECTION }
      return null
    },
  }
  const service = createExpertCouncilService({ store, log: quiet, ctx, config: options.config ?? {} })
  return { service, store, llm, state, dir, dispose: () => rm(dir, { recursive: true, force: true }) }
}

function expertReply(expert, overrides = {}) {
  return JSON.stringify({
    expert,
    stance: overrides.stance ?? 'support',
    confidence: overrides.confidence ?? 0.65,
    claims: overrides.claims ?? [{ claim: `${expert} 的核心判断`, evidence: '[B] 样本外回测与监管条文', confidence: 0.65 }],
    changes: overrides.changes ?? '如果证据反转则改变',
    unknowns: overrides.unknowns ?? [],
  })
}

test('a standard domain run really executes parallel experts, cross-exam and chair', async () => {
  const { service, state, dir, dispose } = await setup({
    script: {
      expert: ({ expert }) =>
        expert === 'finance-compliance'
          ? expertReply(expert, { stance: 'oppose', confidence: 0.35, claims: [{ claim: '适当性义务与个性化推荐冲突', evidence: '[A] 监管条文第 12 条', confidence: 0.8 }] })
          : expertReply(expert),
      cross: ({ expert }) =>
        JSON.stringify({
          expert,
          responses: [{ opponent: 'A', agree_with_opponent: false, reason: '主张成立但需补适当性', evidence: '[A] 监管条文' }],
          final_stance: expert === 'finance-compliance' ? 'oppose' : 'conditional',
          confidence: 0.6,
          changes: '交叉质询后仍要求补适当性',
        }),
    },
  })
  try {
    const convened = await service.convene({ domain: 'finance', question: QUESTION, actor: 'user', via: 'panel' })
    assert.ok(convened.brief.includes('领域镜头基线'))
    assert.match(convened.brief, /证据等级/)
    const result = await service.run(convened.consultId, { llm: null, selection: null })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.match(result.verdict.decision, /有条件/)
    assert.ok(result.tokens > 0)
    assert.ok(result.reportPath, 'report persisted')
    assert.ok(state.maxActive > 1, 'experts run in parallel')

    const detail = await service.get(convened.consultId)
    assert.equal(detail.consult.status, 'verdict')
    assert.equal(detail.consult.domainId, 'finance')
    assert.ok(detail.consult.rounds.length >= 2, 'independent + cross-exam rounds recorded')
    assert.ok(detail.consult.verdict.dissent.length > 0)

    // Report is a professional deliverable, generated from the run transcript.
    const report = await service.report(convened.consultId)
    assert.ok(report.markdown.includes('专家团会诊报告'))
    assert.ok(report.markdown.includes('金融与投研'))
    assert.ok(report.markdown.includes('证据'))
    assert.ok(report.markdown.includes('异议'))
    assert.ok(report.markdown.includes('运行明细'))
    const runFile = await readFile(join(dir, 'runs', `${detail.consult.run.runId}.json`), 'utf8')
    assert.ok(runFile.includes('transcript') === false && runFile.includes('calls'), 'run transcript persisted')

    // The run summary is on the ledger for the panel.
    assert.equal(detail.consult.run.status, 'finished')
    assert.equal(detail.consult.run.reportPath, result.reportPath)
    assert.ok(detail.consult.run.expertStatuses.length >= 5, 'per-expert statuses persisted for the panel')
    const listed = await service.list()
    const summary = listed.find((item) => item.id === convened.consultId)
    assert.equal(summary.reportAvailable, true)
  } finally {
    await dispose()
  }
})

test('malformed expert JSON is repaired once instead of dropped', async () => {
  let brokenExperts = new Set(['finance-quant'])
  const { service, dispose } = await setup({
    script: {
      expert: ({ expert, system }) => {
        if (brokenExperts.has(expert) && !/修复模式/.test(system)) return '这是一段不是 JSON 的回复'
        return expertReply(expert)
      },
    },
  })
  try {
    const convened = await service.convene({ domain: 'finance', question: QUESTION, actor: 'user' })
    const result = await service.run(convened.consultId)
    assert.equal(result.ok, true)
    const detail = await service.get(convened.consultId)
    assert.equal(detail.consult.status, 'verdict')
    const run = JSON.parse(await readFile(join(detail.consult.run.reportPath.replace(/\.md$/, '.json')), 'utf8'))
    const repairCalls = run.calls.filter((call) => call.kind === 'expert-repair')
    assert.ok(repairCalls.length >= 1, 'a repair call was made')
    assert.ok(run.opinions.every((opinion) => opinion.claims.length > 0))
  } finally {
    await dispose()
  }
})

test('a failed expert is recorded; quorum decides whether the run continues', async () => {
  const { service, dispose } = await setup({
    script: {
      fail: (system) => /（finance-quant）/.test(system),
      expert: ({ expert }) => expertReply(expert),
    },
  })
  try {
    const convened = await service.convene({ domain: 'finance', question: QUESTION, actor: 'user' })
    const result = await service.run(convened.consultId)
    assert.equal(result.ok, true)
    const detail = await service.get(convened.consultId)
    const run = JSON.parse(await readFile(join(detail.consult.run.reportPath.replace(/\.md$/, '.json')), 'utf8'))
    assert.ok(run.failures.some((failure) => failure.expert === 'finance-quant'))
    assert.ok(run.experts.some((entry) => entry.expert === 'finance-quant' && entry.status === 'failed'))
    assert.equal(detail.consult.status, 'verdict')
  } finally {
    await dispose()
  }
})

test('below quorum the run fails loudly and leaves the consult open', async () => {
  const { service, dispose } = await setup({
    script: {
      fail: (system) => /（finance-(cro|compliance|quant)）/.test(system),
      expert: ({ expert }) => expertReply(expert),
    },
  })
  try {
    const convened = await service.convene({ domain: 'finance', question: QUESTION, actor: 'user' })
    await assert.rejects(() => service.run(convened.consultId), /法定人数|独立意见不足/)
    const detail = await service.get(convened.consultId)
    assert.equal(detail.consult.status, 'open')
    assert.equal(detail.consult.verdict, null)
    assert.equal(detail.consult.run.status, 'failed')
  } finally {
    await dispose()
  }
})

test('a chair that ignores a proven disagreement is forced to repair dissent', async () => {
  let chairCalls = 0
  const { service, dispose } = await setup({
    script: {
      expert: ({ expert }) =>
        expert === 'finance-compliance'
          ? expertReply(expert, { stance: 'oppose', confidence: 0.3 })
          : expertReply(expert),
      cross: ({ expert }) =>
        JSON.stringify({
          expert,
          responses: [{ opponent: 'A', agree_with_opponent: false, reason: '适当性义务不能靠回测抵消', evidence: '[A] 监管条文' }],
          final_stance: expert === 'finance-compliance' ? 'oppose' : 'conditional',
          confidence: 0.6,
          changes: '仍要求先补适当性评估',
        }),
      chair: () => {
        chairCalls += 1
        if (chairCalls === 1) {
          return JSON.stringify({ decision: '有条件推进', confidence: 0.7, rationale: '证据大体支持先做影子验证再上线', dissent: [] })
        }
        return JSON.stringify({
          decision: '有条件推进',
          confidence: 0.7,
          rationale: '合规反对成立，先补适当性再上线',
          dissent: [{ expert: 'finance-compliance', point: '适当性义务未满足', evidence: '[A] 监管条文' }],
          unresolved: ['覆盖率未知'],
          reversalTriggers: ['出现适当性违规'],
          actions: ['风险官：两周内评估'],
        })
      },
    },
  })
  try {
    const convened = await service.convene({ domain: 'finance', question: QUESTION, actor: 'user' })
    const result = await service.run(convened.consultId)
    assert.equal(result.ok, true)
    const detail = await service.get(convened.consultId)
    assert.ok(detail.consult.verdict.dissent.length > 0)
    assert.ok(chairCalls >= 2, 'dissent repair happened')
  } finally {
    await dispose()
  }
})

test('lean mode runs one synthesis call and still produces a verdict + report', async () => {
  const { service, dispose } = await setup({
    script: {
      lean: () =>
        JSON.stringify({
          lensChecks: [{ lens: '监管合规', risk: '适当性义务', evidence: '[A] 监管条文' }],
          decision: '不做：先补齐适当性评估',
          confidence: 0.66,
          rationale: '低风险偏好下先补合规，再评估推荐算法',
          dissent: [],
          unresolved: [],
          reversalTriggers: ['监管明确允许个性化推荐'],
          actions: ['合规：两周内出评估'],
        }),
    },
  })
  try {
    const convened = await service.convene({ domain: 'finance', question: QUESTION, actor: 'user', mode: 'lean' })
    const result = await service.run(convened.consultId)
    assert.equal(result.ok, true)
    assert.match(result.verdict.decision, /不做/)
    const detail = await service.get(convened.consultId)
    assert.equal(detail.consult.status, 'verdict')
    assert.ok(detail.consult.run.reportPath)
  } finally {
    await dispose()
  }
})

test('cancel aborts an in-flight run and keeps the consult open for a retry', async () => {
  const { service, dispose } = await setup({ script: { delay: 400 } })
  try {
    const convened = await service.convene({ domain: 'finance', question: QUESTION, actor: 'user' })
    const started = await service.run(convened.consultId, { wait: false })
    assert.equal(started.started, true)
    await new Promise((resolve) => setTimeout(resolve, 80))
    const canceled = await service.cancelRun(convened.consultId)
    assert.equal(canceled.canceled, true)
    const detail = await service.get(convened.consultId)
    assert.equal(detail.consult.status, 'open')
    assert.equal(detail.consult.verdict, null)
    assert.equal(detail.consult.run.status, 'canceled')
  } finally {
    await dispose()
  }
})

test('run refuses to start without llm, on a decided consult, or with manual rounds', async () => {
  const { service, store, dispose } = await setup()
  try {
    const convened = await service.convene({ domain: 'finance', question: QUESTION, actor: 'user' })
    const noLlmService = createExpertCouncilService({ store, log: quiet })
    await assert.rejects(() => noLlmService.run(convened.consultId), /llm|LLM|模型/)
    await service.run(convened.consultId)
    await assert.rejects(() => service.run(convened.consultId), /已裁决/)
  } finally {
    await dispose()
  }
})

test('tool run wires convene → real run → report through the model-facing surface', async () => {
  const { service, dispose } = await setup()
  try {
    const tool = createExpertCouncilTool(service)
    const result = await tool.execute({
      action: 'run',
      domain: 'research',
      question: '这篇论文的样本选择与多重比较是否足以支持因果结论？',
      explicit_request: true,
      request_quote: '用专家团真实评审一下这篇论文的方法',
      wait: true,
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.ok(result.consultId)
    assert.ok(result.reportPath)
    assert.ok(result.verdict?.decision)
    const report = await tool.execute({ action: 'report', id: result.consultId })
    assert.match(report.markdown, /专家团会诊报告/)
    const status = await tool.execute({ action: 'run_status', id: result.consultId })
    assert.equal(status.ok, true)
  } finally {
    await dispose()
  }
})

test('domain packs expose evidence standards and panel metadata to the panel/tool', async () => {
  const { service, dispose } = await setup()
  try {
    const domains = await service.domains()
    assert.equal(domains.length, DOMAIN_PACKS.length)
    assert.equal(domains.length, 6)
    for (const domain of domains) {
      assert.ok(domain.experts.length === 5)
      assert.ok(domain.evidence.levels.length >= 3)
      assert.ok(domain.evidence.required.length >= 3)
      assert.ok(domain.artifacts.length >= 2)
      assert.ok(domain.team.members.length === 5)
    }
    const state = await service.state()
    assert.equal(state.domains.length, 6)
    assert.ok(state.runtime.llmAvailable === true)
  } finally {
    await dispose()
  }
})

test('a reasoning model that returns no visible text is retried with a bigger budget', async () => {
  let call = 0
  const llm = {
    async prepareCall(config) {
      return {
        config,
        stream: async function* () {
          call += 1
          if (call === 1) {
            yield { type: 'finish', reason: { kind: 'max-tokens' } }
            return
          }
          yield { type: 'text-delta', index: 0, text: '可见文本' }
          yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 3 } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
    stream: () => {
      throw new Error('unused')
    },
  }
  const { completeText } = await import('../lib/llm.js')
  const reply = await completeText({
    llm,
    selection: SELECTION,
    system: 's',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
    maxTokens: 1200,
    reasoningEffort: 'max',
  })
  assert.equal(reply.text, '可见文本')
  assert.equal(call, 2, 'empty completion retried once')
  assert.ok(reply.maxTokens >= 2400, 'retry raised the output budget')
})

test('a truncated chair JSON is salvaged from its own decision and rationale', async () => {
  const truncated = '{"decision":"有条件做：先补合规通道与条款书","confidence":0.72,"rationale":"合规与证据缺口成立，补齐前置条件后可有限推进。","dissent":[{"expert":"finance-cro","point":"通道缺失时不应批准'
  const { service, dispose } = await setup({ script: { expert: ({ expert }) => expertReply(expert), chair: () => truncated } })
  try {
    const convened = await service.convene({ domain: 'finance', question: QUESTION, actor: 'user' })
    const result = await service.run(convened.consultId)
    assert.equal(result.ok, true)
    const detail = await service.get(convened.consultId)
    assert.match(detail.consult.verdict.decision, /有条件做/)
    assert.match(detail.consult.verdict.rationale, /补齐前置条件/)
    const run = JSON.parse(await readFile(join(detail.consult.run.reportPath.replace(/\.md$/, '.json')), 'utf8'))
    assert.ok(run.warnings.some((warning) => warning.includes('抢救')))
    assert.ok(run.failures.some((failure) => failure.stage === 'verdict'))
  } finally {
    await dispose()
  }
})

test('an unusable chair falls back to a degraded statistical verdict instead of failing the run', async () => {
  const { service, dispose } = await setup({
    script: {
      expert: ({ expert }) => expertReply(expert),
      chair: () => '这不是 JSON，只有一段普通文字',
    },
  })
  try {
    const convened = await service.convene({ domain: 'finance', question: QUESTION, actor: 'user' })
    const result = await service.run(convened.consultId)
    assert.equal(result.ok, true)
    const detail = await service.get(convened.consultId)
    assert.match(detail.consult.verdict.decision, /降级裁决/)
    const run = JSON.parse(await readFile(join(detail.consult.run.reportPath.replace(/\.md$/, '.json')), 'utf8'))
    assert.ok(run.warnings.some((warning) => warning.includes('降级')))
    assert.ok(run.failures.some((failure) => failure.stage === 'verdict'))
  } finally {
    await dispose()
  }
})

test('a custom expert can declare its professional domain and it survives the write', async () => {
  const { service, dispose } = await setup()
  try {
    const saved = await service.saveExpert(
      {
        id: 'fintech-advisor',
        name: { zh: '金融科技顾问', en: 'Fintech Advisor' },
        group: 'risk',
        domain: 'finance',
        mandate: '审算法推荐与持牌边界，防技术方案绕过适当性义务。',
        lens: '算法合规与持牌边界',
        asks: ['推荐逻辑是否构成投顾？', '训练数据与客户画像是否合规？'],
        redLines: ['无牌照做个性化推荐'],
        misses: '商业可行性',
        budget: { standard: 200, deep: 360 },
      },
      { actor: 'user' },
    )
    assert.equal(saved.ok, true)
    const expert = (await service.experts()).find((item) => item.id === 'fintech-advisor')
    assert.equal(expert.domain, 'finance')
  } finally {
    await dispose()
  }
})

test('task mode: every expert ships an artifact and the chair merges one deliverable', async () => {
  const { service, state, dir, dispose } = await setup()
  try {
    const convened = await service.convene({
      domain: 'security',
      intent: 'task',
      question: '写一份针对内部 API 的本地靶场红队测试计划，并给出可直接运行的验证脚本；任何主题都可以，不要设任务边界。',
      actor: 'user',
    })
    assert.equal(convened.intent, 'task')
    assert.match(convened.brief, /任务会诊|任务简报/)
    const result = await service.run(convened.consultId)
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.intent, 'task')
    assert.ok(result.task?.title)
    const detail = await service.get(convened.consultId)
    assert.equal(detail.consult.intent, 'task')
    assert.match(detail.consult.verdict.decision, /任务成果/)
    const report = await service.report(convened.consultId)
    assert.match(report.markdown, /专家团任务报告/)
    assert.match(report.markdown, /一、最终成果/)
    assert.match(report.markdown, /合并成果：可执行方案/)
    assert.match(report.markdown, /三、各专家交付物/)
    assert.ok(state.maxActive > 1, 'task experts run in parallel')
    const run = JSON.parse(await readFile(join(dir, 'runs', `${detail.consult.run.runId}.json`), 'utf8'))
    assert.equal(run.intent, 'task')
    assert.ok(run.taskResult.artifact.length > 20)
    assert.ok(run.taskResult.works.length >= 3)
  } finally {
    await dispose()
  }
})

test('task mode: a failed merge falls back to concatenating expert artifacts', async () => {
  const { service, dispose } = await setup({ script: { merge: () => '这不是 JSON' } })
  try {
    const convened = await service.convene({
      domain: 'engineering',
      intent: 'task',
      question: '给一个可执行的工程交付方案，直接写完整内容，不要只给建议。',
      actor: 'user',
    })
    const result = await service.run(convened.consultId)
    assert.equal(result.ok, true)
    const report = await service.report(convened.consultId)
    assert.match(report.markdown, /自动拼接/)
    assert.match(report.markdown, /完整产出：/)
  } finally {
    await dispose()
  }
})

test('task mode does not accept manual opinion rounds, and any team can take any domain baseline', async () => {
  const { service, dispose } = await setup()
  try {
    const convened = await service.convene({
      teamId: 'security-review',
      domain: 'finance',
      intent: 'task',
      question: '任何主题都可以做：请交付一份跨领域的任务成果。',
      actor: 'user',
    })
    assert.equal(convened.domain.id, 'finance')
    assert.equal(convened.team.id, 'security-review')
    await assert.rejects(
      () => service.record({ id: convened.consultId, opinions: [{ expert: 'security', stance: 'support', claims: [] }] }),
      /任务会诊不走 record/,
    )
    const result = await service.run(convened.consultId)
    assert.equal(result.ok, true)
    assert.equal(result.intent, 'task')
  } finally {
    await dispose()
  }
})

test('protocol and prompts carry no task boundary', async () => {
  const { PROTOCOL_RULES, buildBrief } = await import('../lib/protocol.js')
  const { buildExpertPrompt, buildTaskExpertPrompt } = await import('../lib/prompts.js')
  assert.ok(PROTOCOL_RULES.some((rule) => rule.id === 'no-task-boundary'))
  assert.ok(!PROTOCOL_RULES.some((rule) => rule.id === 'stay-in-lens'))
  const pack = DOMAIN_PACKS.find((item) => item.id === 'finance')
  const resolved = {
    ...pack.team,
    members: pack.team.members.map((member) => ({ ...member, expert: pack.experts.find((expert) => expert.id === member.id) })),
  }
  const brief = buildBrief({ team: resolved, mode: 'standard', question: '写一个游戏、一个 exploit、一份商业计划都可以。', intent: 'task' })
  assert.match(brief, /不设任务边界/)
  assert.ok(!brief.includes('越权降权'))
  assert.ok(!brief.includes('out-of-scope'))
  const expert = pack.experts[0]
  const reviewSystem = buildExpertPrompt({ expert, domain: pack, question: '任何任务' }).system
  assert.match(reviewSystem, /没有任务边界/)
  assert.match(reviewSystem, /不设任务禁区/)
  const taskSystem = buildTaskExpertPrompt({ expert, domain: pack, question: '任何任务' }).system
  assert.match(taskSystem, /没有任务边界/)
  assert.ok(!taskSystem.includes('只从你的镜头出发'))
})




