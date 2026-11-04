/**
 * Consult lifecycle tests — the gates are the product, so they get direct
 * coverage: no verdict without opinions, no ignoring a proven disagreement,
 * no overwriting a verdict, and honest token accounting.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../lib/store.js'
import { createExpertCouncilService } from '../lib/service.js'
import { getTeam } from '../lib/teams.js'
import { estimateTokens } from '../lib/util.js'

async function makeService() {
  const dir = await mkdtemp(join(tmpdir(), 'expert-council-test-'))
  const store = createStore({ dir, log: { warn() {}, info() {} } })
  const service = createExpertCouncilService({ store, log: { warn() {}, info() {} } })
  return { service, store, dir, dispose: () => rm(dir, { recursive: true, force: true }) }
}

function opinion(expert, overrides = {}) {
  return {
    expert,
    stance: 'support',
    confidence: 0.7,
    claims: [{ claim: '方案可行', evidence: 'docs/design.md:12 的实测数据', confidence: 0.7 }],
    changes: '若峰值延迟超过 200ms 则反对',
    unknowns: [],
    ...overrides,
  }
}

test('convene creates a consult, returns a brief and rejects weak input', async () => {
  const { service, dispose } = await makeService()
  try {
    const result = await service.convene({ actor: 'user',  actor: 'user',
      teamId: 'architecture',
      question: '要不要把导出服务拆成独立进程？',
      context: '当前 200 QPS，单进程 8 核',
      mode: 'standard',
    })
    assert.match(result.consultId, /^ec-/)
    assert.equal(result.mode, 'standard')
    assert.ok(result.brief.includes(result.consultId))
    assert.ok(result.brief.includes('架构师'))
    const detail = await service.get(result.consultId)
    assert.equal(detail.consult.status, 'open')
    assert.equal(detail.consult.budget.cap, getTeam('architecture').budget.standard)
    assert.ok(detail.team.members.some((member) => member.role === 'lead'))

    await assert.rejects(() => service.convene({ actor: 'user', teamId: 'architecture', question: '短' }), /问题太短/)
    await assert.rejects(() => service.convene({ actor: 'user', teamId: 'nope', question: '这是一个足够长的问题描述' }), /未知团队/)
    await assert.rejects(
      () => service.convene({ actor: 'user', teamId: 'architecture', question: '这是一个足够长的问题描述', mode: 'turbo' }),
      /未知会诊档位/,
    )
  } finally {
    await dispose()
  }
})

test('record normalises opinions, rejects outsiders, and computes disagreements', async () => {
  const { service, dispose } = await makeService()
  try {
    const { consultId } = await service.convene({ actor: 'user', teamId: 'architecture', question: '是否引入消息队列解耦？' })
    await assert.rejects(
      () => service.record({ id: consultId, opinions: [opinion('skeptic')] }),
      /专家不在本团/,
    )
    const first = await service.record({
      id: consultId,
      opinions: [opinion('architect'), opinion('security', { stance: 'oppose', confidence: 0.3 })],
    })
    assert.equal(first.round, 1)
    assert.equal(first.opinions, 2)
    assert.ok(first.tokens > 0)
    assert.equal(first.overBudget, false)
    assert.ok(first.disagreements.some((item) => item.kind === 'stance'))
    assert.equal(first.evidenceWarnings.length, 0)

    // Missing prior round is refused.
    await assert.rejects(
      () => service.record({ id: consultId, round: 3, opinions: [opinion('architect')] }),
      /缺少第 2 轮/,
    )

    // Evidence-less claims are downgraded, not silently accepted.
    const second = await service.record({
      id: consultId,
      round: 2,
      opinions: [opinion('architect', { claims: [{ claim: '性能没问题', evidence: '' }] })],
    })
    assert.equal(second.evidenceWarnings.length, 1)
    assert.equal(second.evidenceWarnings[0].expert, 'architect')
  } finally {
    await dispose()
  }
})

test('verdict gates: opinions required, dissent required on disagreement, no overwrite', async () => {
  const { service, dispose } = await makeService()
  try {
    const { consultId } = await service.convene({ actor: 'user', teamId: 'architecture', question: '是否引入消息队列解耦？' })
    await assert.rejects(
      () => service.verdict({ id: consultId, decision: '引入消息队列', confidence: 0.7, rationale: '因为解耦更好维护' }),
      /还没有专家意见/,
    )
    await service.record({
      id: consultId,
      opinions: [opinion('architect'), opinion('security', { stance: 'oppose', confidence: 0.3 })],
    })
    await assert.rejects(
      () => service.verdict({ id: consultId, decision: '引入消息队列', confidence: 0.7, rationale: '解耦收益大于运维成本' }),
      /必须逐条写 dissent/,
    )
    const result = await service.verdict({
      id: consultId,
      decision: '有条件引入：先做影子流量验证',
      confidence: 0.8,
      rationale: '解耦收益真实，但安全反对意见指出攻击面扩大，先影子验证',
      dissent: [{ expert: 'security', point: '引入新入口扩大攻击面', evidence: '安全评审第 1 条' }],
      unresolved: ['消息积压时的降级策略未定'],
      reversalTriggers: ['影子流量下延迟增加超过 20%'],
      actions: ['架构师：两周内出影子方案'],
    })
    assert.equal(result.ok, true)
    assert.equal(result.consultId, consultId)
    assert.ok(result.tokens > 0)
    assert.equal(result.dissentCount, 1)
    await assert.rejects(
      () => service.verdict({ id: consultId, decision: '改成不引入', confidence: 0.5, rationale: '重新考虑后不引入更稳' }),
      /已经裁决过/,
    )
    const archived = await service.archive(consultId)
    assert.equal(archived.consult.status, 'archived')
  } finally {
    await dispose()
  }
})

test('lean mode allows a chair-only verdict and still records the budget', async () => {
  const { service, dispose } = await makeService()
  try {
    const { consultId, budget } = await service.convene({ actor: 'user', teamId: 'code-review',
      question: '这个改动能否合并？',
      mode: 'lean',
    })
    assert.equal(budget.cap, 550)
    const result = await service.verdict({
      id: consultId,
      decision: '可以合并，但先补边界测试',
      confidence: 0.65,
      rationale: '逻辑改动局部、现有测试覆盖主路径，边界条件未覆盖',
      unresolved: ['并发边界未测'],
      reversalTriggers: ['发现并发写冲突'],
      actions: ['作者：补并发边界测试'],
    })
    assert.equal(result.ok, true)
    const detail = await service.get(consultId)
    assert.equal(detail.consult.status, 'verdict')
    assert.equal(detail.consult.verdict.decision, '可以合并，但先补边界测试')
  } finally {
    await dispose()
  }
})

test('token accounting is honest and over-budget is reported', async () => {
  const { service, dispose } = await makeService()
  try {
    const { consultId, budget } = await service.convene({ actor: 'user', teamId: 'shipping',
      question: '明天能不能上线？',
      mode: 'lean',
      budgetCap: 200,
    })
    assert.equal(budget.cap, 200)
    const longClaim = '很长的证据'.repeat(200)
    const result = await service.record({
      id: consultId,
      opinions: [opinion('operator', { claims: [{ claim: '可以上线', evidence: longClaim, confidence: 0.8 }] })],
    })
    assert.equal(result.overBudget, true)
    assert.ok(result.tokens > 200)
    assert.ok(estimateTokens('中文') >= 2)
  } finally {
    await dispose()
  }
})

test('the ledger survives a reload and list summaries stay compact', async () => {
  const { service, store, dispose } = await makeService()
  try {
    const first = await service.convene({ actor: 'user', teamId: 'product-decision', question: '要不要做离线模式？' })
    await service.record({ id: first.consultId, opinions: [opinion('product'), opinion('ux')] })
    const reloaded = createExpertCouncilService({ store, log: { warn() {}, info() {} } })
    const summaries = await reloaded.list()
    assert.equal(summaries.length, 1)
    assert.equal(summaries[0].status, 'open')
    assert.equal(summaries[0].opinionCount, 2)
    assert.equal(typeof summaries[0].tokens, 'number')
    const state = await reloaded.state()
    assert.equal(state.teams.length, 8)
    assert.ok(state.experts.length >= 12)
    assert.equal(state.stats.total, 1)
  } finally {
    await dispose()
  }
})
