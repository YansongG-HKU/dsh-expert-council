/**
 * Route-following, reasoning budget and timeout tests.
 *
 * A panel that runs on the Harness default model after the user switched the
 * session model is a correctness bug; so is a reasoning route that burns every
 * expert's output budget on hidden thinking. These tests pin all three layers:
 * the tool's selection extraction, the service's route priority, and the
 * executor's reasoning floors / per-call timeout.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../lib/store.js'
import { createExpertCouncilService } from '../lib/service.js'
import { createExpertCouncilTool, selectionFromExec } from '../lib/tools.js'
import {
  DEFAULT_CALL_TIMEOUT_MS,
  REASONING_CALL_TIMEOUT_MS,
  effectiveCallTimeout,
  normalizeSelection,
  raisedOutputBudget,
  reasoningOutputFloor,
  routeReasoningActive,
} from '../lib/util.js'

const quiet = { warn() {}, info() {} }
const DEFAULT_SELECTION = { provider: 'default-provider', model: 'default-model' }
const QUESTION = '这次改动能否合并：新增并发写路径但只覆盖了主流程测试。'

function expertOf(system) {
  return (system.match(/（([a-z-]+)）/) ?? [])[1] ?? 'unknown'
}

/** Scripted model: reply kind is derived from the prompt system text. */
function makeFakeLlm({ failExpert = false, delay = 3 } = {}) {
  const state = { calls: [] }

  function kindOf(system) {
    if (/综合评审主持/.test(system)) return 'lean'
    if (/交叉质询/.test(system)) return 'cross'
    if (/总集成者/.test(system)) return 'merge'
    if (/任务会诊/.test(system)) return 'task'
    if (/主持/.test(system)) return 'chair'
    return 'expert'
  }

  function replyFor(kind, system) {
    if (kind === 'task') {
      return JSON.stringify({
        expert: expertOf(system),
        deliverable: `${expertOf(system)} 的完整产出`,
        content: '完整产出：可直接使用的步骤清单。\n\n1. 第一步\n2. 第二步\n3. 验证',
        assumptions: ['假设本地可运行'],
        risks: ['未在生产验证'],
        handoff: ['交给集成者合并'],
      })
    }
    if (kind === 'merge') {
      return JSON.stringify({
        title: '合并成果：可执行方案',
        summary: '合并了所有专家产出，形成可直接使用的最终成果。',
        artifact: '# 合并成果\n\n## 步骤\n\n1. 执行第一步\n2. 执行第二步\n\n## 验证\n\n运行验证脚本。',
        deliverables: [{ expert: 'finance-cro', title: '风险边界', contribution: '给出风险上限' }],
        assumptions: ['默认本地执行'],
        risks: ['样本有限'],
        openQuestions: ['是否多环境部署？'],
        nextActions: ['召集人：评审后执行'],
      })
    }
    if (kind === 'lean') {
      return JSON.stringify({
        lensChecks: [{ lens: '结构', risk: '并发边界未测', evidence: '[B] 现有测试清单' }],
        decision: '有条件合并：先补并发边界测试',
        confidence: 0.64,
        rationale: '改动局部但并发路径缺少边界测试，补齐后可合并',
        dissent: [],
        unresolved: ['并发写冲突未验证'],
        reversalTriggers: ['发现写冲突'],
        actions: ['作者：补并发边界测试'],
      })
    }
    if (kind === 'chair') {
      return JSON.stringify({
        decision: '有条件合并：先补并发边界测试',
        confidence: 0.66,
        rationale: '主流程覆盖良好，但并发写路径缺少边界证据，先补测试再合并',
        dissent: [{ expert: 'security', point: '并发写可能引入竞态', evidence: '[B] 代码路径审查' }],
        unresolved: ['并发写冲突概率未知'],
        reversalTriggers: ['压测出现写冲突'],
        actions: ['作者：补并发边界测试'],
      })
    }
    if (kind === 'cross') {
      return JSON.stringify({
        expert: expertOf(system),
        responses: [{ opponent: 'A', agree_with_opponent: false, reason: '对方未给出并发路径证据', evidence: '[B] 现有测试缺口' }],
        final_stance: 'conditional',
        confidence: 0.6,
        changes: '补齐并发测试后可改判',
      })
    }
    const expert = expertOf(system)
    const stance = expert === 'security' ? 'oppose' : 'support'
    return JSON.stringify({
      expert,
      stance,
      confidence: stance === 'oppose' ? 0.35 : 0.65,
      claims: [{ claim: `${expert} 的核心判断`, evidence: '[B] 样本外回测 12 个月', confidence: 0.6 }],
      changes: '如果证据反转则改变',
      unknowns: [],
    })
  }

  const llm = {
    async prepareCall(config) {
      return { config, stream: (options) => streamFor(options) }
    },
    stream: (options) => streamFor(options),
  }

  async function* streamFor(options) {
    const system = options.system ?? ''
    const kind = kindOf(system)
    state.calls.push({
      kind,
      provider: options.provider ?? null,
      model: options.model ?? null,
      maxTokens: options.maxTokens ?? null,
      reasoningEffort: options.reasoningEffort ?? null,
    })
    await new Promise((resolve) => setTimeout(resolve, delay))
    if (failExpert && kind === 'expert') throw new Error('scripted provider failure')
    yield { type: 'text-delta', index: 0, text: replyFor(kind, system) }
    yield { type: 'usage', usage: { inputTokens: 40, outputTokens: 12 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }

  return { llm, state }
}

async function setup({ config = {}, script = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'expert-council-routing-'))
  const store = createStore({ dir, log: quiet })
  const { llm, state } = makeFakeLlm(script)
  const ctx = {
    get: (name) => {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') return { currentSelection: () => DEFAULT_SELECTION }
      return null
    },
  }
  const service = createExpertCouncilService({ store, log: quiet, ctx, config })
  return { service, store, llm, state, dir, dispose: () => rm(dir, { recursive: true, force: true }) }
}

function callsOfKind(state, kind) {
  return state.calls.filter((call) => call.kind === kind)
}

test('effectiveCallTimeout: reasoning widens the default, explicit config always wins', () => {
  assert.equal(effectiveCallTimeout(undefined, false), DEFAULT_CALL_TIMEOUT_MS)
  assert.equal(effectiveCallTimeout(null, false), DEFAULT_CALL_TIMEOUT_MS)
  assert.equal(effectiveCallTimeout(undefined, true), REASONING_CALL_TIMEOUT_MS)
  assert.equal(effectiveCallTimeout(null, true), REASONING_CALL_TIMEOUT_MS)
  assert.equal(effectiveCallTimeout(45000, true), 45000)
  assert.equal(effectiveCallTimeout(300000, false), 300000)
  assert.equal(effectiveCallTimeout(0, true), REASONING_CALL_TIMEOUT_MS, '0 is not a usable explicit value')
})

test('reasoning floors raise every stage; non-reasoning budgets are unchanged', () => {
  assert.equal(raisedOutputBudget('expert', true, 1200), 2400)
  assert.equal(raisedOutputBudget('cross', true, 900), 1800)
  assert.equal(raisedOutputBudget('lean', true, 1400), 2400)
  assert.equal(raisedOutputBudget('task', true, 2400), 2400)
  assert.equal(raisedOutputBudget('taskMerge', true, 4000), 6000)
  assert.equal(raisedOutputBudget('chair', true, 500), 1800)
  assert.equal(raisedOutputBudget('chair', true, 2600), 2600, 'an already-larger chair budget is left alone')

  for (const stage of ['expert', 'cross', 'chair', 'lean', 'task', 'taskMerge']) {
    assert.equal(reasoningOutputFloor(stage, false), 0)
    assert.equal(raisedOutputBudget(stage, false, 1200), 1200)
  }

  assert.equal(routeReasoningActive({ reasoningEffort: 'off' }), false)
  assert.equal(routeReasoningActive({ reasoningEffort: 'high' }), true)
  assert.equal(routeReasoningActive({ selection: { provider: 'p', model: 'm', reasoningEffort: 'medium' } }), true)
  assert.equal(routeReasoningActive({ selection: { provider: 'p', model: 'm' } }), false)
})

test('selectionFromExec: agent model.current wins, request header is the fallback, no agent stays null', () => {
  const live = selectionFromExec({
    agent: {
      model: { current: () => ({ provider: 'agent-provider', model: 'agent-model', reasoningEffort: 'high', temperature: 0.2 }) },
      session: { requestHeader: () => ({ config: { provider: 'header', model: 'header-model' } }) },
    },
  })
  assert.deepEqual(live, { provider: 'agent-provider', model: 'agent-model', reasoningEffort: 'high' })

  const fallback = selectionFromExec({
    agent: {
      model: { current: () => { throw new Error('no live agent') } },
      session: { requestHeader: () => ({ config: { provider: 'header', model: 'header-model', reasoningEffort: 'low', temperature: 0.3 } }) },
    },
  })
  assert.deepEqual(fallback, { provider: 'header', model: 'header-model', reasoningEffort: 'low' })

  const partial = selectionFromExec({ agent: { model: { current: () => ({ provider: 'only-provider' }) } } })
  assert.equal(partial, null, 'an incomplete selection is no selection')
  assert.equal(selectionFromExec(undefined), null)
  assert.deepEqual(normalizeSelection({ provider: ' p ', model: ' m ' }), { provider: 'p', model: 'm' })
})

test('tool run forwards the calling agent selection (old callers without exec stay compatible)', async () => {
  const seen = []
  const fakeService = {
    async run(id, options) {
      seen.push({ id, options })
      return { ok: true, runId: 'run-1', consultId: id, running: false }
    },
  }
  const tool = createExpertCouncilTool(fakeService)
  const agentSelection = { provider: 'agent-provider', model: 'agent-model', reasoningEffort: 'high' }
  await tool.execute(
    { action: 'run', id: 'ec-test', wait: false },
    { agent: { model: { current: () => agentSelection } } },
  )
  assert.equal(seen[0].id, 'ec-test')
  assert.deepEqual(seen[0].options.agentSelection, agentSelection)

  await tool.execute({ action: 'run', id: 'ec-legacy' })
  assert.equal(seen[1].options.agentSelection, null)
})

test('runtimeServices priority: explicit selection > agent selection > harness default', async () => {
  const { service, dispose } = await setup()
  try {
    assert.equal(service.runtime().selection.provider, DEFAULT_SELECTION.provider)
    assert.equal(service.runtime().selection.model, DEFAULT_SELECTION.model)

    const agentTier = service.runtime({ agentSelection: { provider: 'agent-provider', model: 'agent-model' } })
    assert.equal(agentTier.selection.provider, 'agent-provider')

    const explicitTier = service.runtime({
      selection: { provider: 'explicit-provider', model: 'explicit-model' },
      agentSelection: { provider: 'agent-provider', model: 'agent-model' },
    })
    assert.equal(explicitTier.selection.provider, 'explicit-provider')
    assert.equal(explicitTier.selection.model, 'explicit-model')
  } finally {
    await dispose()
  }
})

test('a real run follows the calling agent route instead of the harness default', async () => {
  const { service, state, dispose } = await setup()
  try {
    const convened = await service.convene({ teamId: 'code-review', mode: 'lean', question: QUESTION, actor: 'user' })
    const tool = createExpertCouncilTool(service)
    const result = await tool.execute(
      { action: 'run', id: convened.consultId, wait: true },
      { agent: { model: { current: () => ({ provider: 'agent-provider', model: 'agent-model', reasoningEffort: 'high' }) } } },
    )
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.ok(state.calls.length > 0)
    assert.ok(
      state.calls.every((call) => call.provider === 'agent-provider' && call.model === 'agent-model'),
      'every model call used the agent route',
    )
    assert.equal(result.snapshot.provider, 'agent-provider')
    assert.equal(result.snapshot.model, 'agent-model')
    assert.equal(result.snapshot.reasoning, true)
    assert.equal(result.snapshot.callTimeoutMs, REASONING_CALL_TIMEOUT_MS)
  } finally {
    await dispose()
  }
})

test('a reasoning route widens every stage output budget; an off route keeps today\'s values', async () => {
  const reasoning = await setup({ config: { reasoningEffort: 'high' } })
  const off = await setup({ config: { reasoningEffort: 'off' } })
  try {
    for (const env of [reasoning, off]) {
      const convened = await env.service.convene({ teamId: 'code-review', mode: 'standard', question: QUESTION, actor: 'user' })
      const result = await env.service.run(convened.consultId)
      assert.equal(result.ok, true, JSON.stringify(result))
    }

    const reasoningExperts = callsOfKind(reasoning.state, 'expert')
    const reasoningCross = callsOfKind(reasoning.state, 'cross')
    const reasoningChair = callsOfKind(reasoning.state, 'chair')
    assert.equal(reasoningExperts.length, 4)
    assert.ok(reasoningExperts.every((call) => call.maxTokens === 2400), 'reasoning experts get 2400')
    assert.ok(reasoningCross.length > 0, 'the disagreement triggered cross-examination')
    assert.ok(reasoningCross.every((call) => call.maxTokens === 1800), 'reasoning cross-exam gets 1800')
    assert.ok(reasoningChair.length > 0)
    assert.ok(reasoningChair.every((call) => call.maxTokens === 2600), 'chair keeps its larger budget')

    const offExperts = callsOfKind(off.state, 'expert')
    const offCross = callsOfKind(off.state, 'cross')
    const offChair = callsOfKind(off.state, 'chair')
    assert.ok(offExperts.every((call) => call.maxTokens === 1200), 'non-reasoning experts keep 1200')
    assert.ok(offCross.every((call) => call.maxTokens === 900), 'non-reasoning cross-exam keeps 900')
    assert.ok(offChair.every((call) => call.maxTokens === 2600), 'chair budget is unchanged')
    assert.ok(off.state.calls.every((call) => call.reasoningEffort === 'off'))
  } finally {
    await reasoning.dispose()
    await off.dispose()
  }
})

test('lean runs widen the single synthesis call on reasoning routes', async () => {
  const env = await setup({ config: { reasoningEffort: 'high' } })
  try {
    const convened = await env.service.convene({ teamId: 'code-review', mode: 'lean', question: QUESTION, actor: 'user' })
    const result = await env.service.run(convened.consultId)
    assert.equal(result.ok, true)
    assert.ok(callsOfKind(env.state, 'lean').every((call) => call.maxTokens === 2400))
  } finally {
    await env.dispose()
  }
})

test('task mode widens expert artifact and merge budgets on reasoning routes', async () => {
  const env = await setup({ config: { reasoningEffort: 'high' } })
  try {
    const convened = await env.service.convene({
      domain: 'finance',
      intent: 'task',
      question: '交付一份可直接执行的风险检查方案，包含步骤、验证与回滚。',
      actor: 'user',
    })
    const result = await env.service.run(convened.consultId)
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.ok(callsOfKind(env.state, 'task').length >= 3)
    assert.ok(callsOfKind(env.state, 'task').every((call) => call.maxTokens === 2400))
    assert.ok(callsOfKind(env.state, 'merge').every((call) => call.maxTokens === 6000))
  } finally {
    await env.dispose()
  }
})

test('effectiveCallTimeout reaches the run: reasoning default vs off vs explicit config', async () => {
  const cases = [
    { config: {}, expected: REASONING_CALL_TIMEOUT_MS, label: 'default reasoning route' },
    { config: { reasoningEffort: 'off' }, expected: DEFAULT_CALL_TIMEOUT_MS, label: 'reasoning off' },
    { config: { callTimeoutMs: 45000 }, expected: 45000, label: 'explicit timeout is respected' },
    { config: { callTimeoutMs: 300000, reasoningEffort: 'off' }, expected: 300000, label: 'explicit off-route timeout' },
  ]
  for (const item of cases) {
    const env = await setup({ config: item.config })
    try {
      const convened = await env.service.convene({ teamId: 'code-review', mode: 'lean', question: QUESTION, actor: 'user' })
      const result = await env.service.run(convened.consultId)
      assert.equal(result.ok, true, item.label)
      assert.equal(result.snapshot.callTimeoutMs, item.expected, item.label)
    } finally {
      await env.dispose()
    }
  }
})

test('a quorum failure names the provider/model and the remediation', async () => {
  const { service, dispose } = await setup({ script: { failExpert: true } })
  try {
    const convened = await service.convene({ teamId: 'code-review', mode: 'standard', question: QUESTION, actor: 'user' })
    await assert.rejects(
      () => service.run(convened.consultId),
      (error) => {
        assert.match(error.message, /法定人数|独立意见不足/)
        assert.match(error.message, /default-provider\/default-model/)
        assert.match(error.message, /max_parallel:1/)
        assert.match(error.message, /reasoning effort/)
        assert.equal(error.code, 'QUORUM_FAILED')
        return true
      },
    )
  } finally {
    await dispose()
  }
})
