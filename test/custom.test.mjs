/**
 * V0.2 rules: explicit-use consent, user customisation of experts/teams, and
 * isolation from the built-in Agent Teams.
 *
 * These are product rules, so they are tested at the service level (the same
 * service every entry point calls).
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../lib/store.js'
import { createExpertCouncilService } from '../lib/service.js'
import { checkIsolation, BUILTIN_AGENT_TEAM_NAMES, OWN_NAMES } from '../lib/isolation.js'

const quiet = { warn() {}, info() {} }

async function makeService(config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'expert-council-custom-'))
  const store = createStore({ dir, log: quiet })
  const service = createExpertCouncilService({ store, log: quiet, config })
  return { service, store, dir, dispose: () => rm(dir, { recursive: true, force: true }) }
}

const QUESTION = '要不要现在把默认档位从 lean 切成 standard？'

test('explicit-use gate: a model-initiated convene is refused without consent', async () => {
  const { service, dispose } = await makeService()
  try {
    await assert.rejects(() => service.convene({ teamId: 'architecture', question: QUESTION }), /明确呼叫/)
    await assert.rejects(
      () => service.convene({ teamId: 'architecture', question: QUESTION, explicitRequest: true }),
      /request_quote/,
    )
    const result = await service.convene({
      teamId: 'architecture',
      question: QUESTION,
      explicitRequest: true,
      requestQuote: '帮我用专家团评审一下',
    })
    assert.equal(result.consent.kind, 'explicit-request')
    assert.equal(result.consent.quote, '帮我用专家团评审一下')
    const detail = await service.get(result.consultId)
    assert.equal(detail.consult.consent.kind, 'explicit-request')

    // A user action (/experts or panel) is explicit by definition.
    const userAction = await service.convene({ teamId: 'architecture', question: QUESTION, actor: 'user', via: 'panel' })
    assert.equal(userAction.consent.kind, 'user-action')
    assert.equal(userAction.consent.via, 'panel')

    // The policy is visible to the panel so it can explain the rule.
    const state = await service.state()
    assert.equal(state.policy.requireExplicitConsent, true)
    assert.equal(state.policy.isolation.ok, true)
    assert.ok(state.policy.boundary.includes('内置'))
  } finally {
    await dispose()
  }
})

test('a user can add and edit experts; presets can be overridden and hidden', async () => {
  const { service, dispose } = await makeService()
  try {
    const created = await service.saveExpert({
      id: 'risk-officer',
      name: { zh: '风控官', en: 'Risk Officer' },
      group: 'risk',
      mandate: '盯住最坏情况的损失上限，先问最坏能亏多少。',
      lens: '损失上限与止损条件',
      asks: ['最坏能亏多少？', '止损线在哪？'],
      redLines: ['没有止损线的下注'],
      misses: '机会成本、速度',
      pairs: ['cost'],
      budget: { standard: 150, deep: 220 },
    })
    assert.equal(created.ok, true)
    assert.equal(created.expert.custom, true)
    assert.equal(created.expert.preset, false)
    let experts = await service.experts()
    assert.ok(experts.some((expert) => expert.id === 'risk-officer' && expert.custom))

    // Override a preset: same id, custom:true, preset:true.
    const overridden = await service.saveExpert({
      ...(await service.experts()).find((expert) => expert.id === 'architect'),
      mandate: '（用户改）先看能不能用更小的结构解决问题，再看演进代价。',
    })
    assert.equal(overridden.overridden, true)
    assert.equal(overridden.expert.preset, true)
    assert.equal(overridden.expert.custom, true)
    experts = await service.experts()
    const architect = experts.find((expert) => expert.id === 'architect')
    assert.match(architect.mandate, /用户改/)

    // Validation is real.
    await assert.rejects(() => service.saveExpert({ id: 'Bad ID', name: { zh: '坏' } }), /id 不合法/)
    await assert.rejects(
      () =>
        service.saveExpert({
          id: 'no-misses',
          name: { zh: '无盲区' },
          mandate: '不写盲区的专家定义不完整',
          lens: '镜头',
          asks: ['a'],
          redLines: ['b'],
        }),
      /易漏/,
    )
  } finally {
    await dispose()
  }
})

test('a user can compose teams from existing lenses, with one chair enforced', async () => {
  const { service, dispose } = await makeService()
  try {
    const saved = await service.saveTeam({
      id: 'launch-check',
      name: { zh: '发布前检查团', en: 'Launch Check' },
      tagline: '上线前最后一道门。',
      intent: '发版前 30 分钟用。',
      defaultMode: 'lean',
      members: [
        { id: 'operator', role: 'member' },
        { id: 'sre', role: 'lead' },
      ],
      agenda: ['回滚步骤是否可复现？'],
      artifacts: ['Go / No-Go'],
      budget: { lean: 500, standard: 1200, deep: 3000 },
    })
    assert.equal(saved.ok, true)
    assert.equal(saved.team.members.filter((member) => member.role === 'lead').length, 1)

    // No lead given: the first member becomes the chair.
    const autoLead = await service.saveTeam({
      id: 'auto-lead',
      name: { zh: '自动主持团' },
      members: [{ id: 'architect' }, { id: 'security' }],
      agenda: ['边界在哪？'],
      budget: { lean: 400, standard: 900, deep: 2000 },
    })
    assert.equal(autoLead.team.members.filter((member) => member.role === 'lead').length, 1)

    // Two chairs are rejected; unknown lenses are rejected.
    await assert.rejects(
      () =>
        service.saveTeam({
          id: 'two-chairs',
          name: { zh: '双主持团' },
          members: [
            { id: 'architect', role: 'lead' },
            { id: 'security', role: 'lead' },
          ],
          agenda: ['x'],
        }),
      /只能有一个主持/,
    )
    await assert.rejects(
      () => service.saveTeam({ id: 'ghost-team', name: { zh: '幽灵团' }, members: [{ id: 'nobody' }], agenda: ['x'] }),
      /不存在的专家/,
    )

    // The custom team is convenable and its budget clamps monotonically.
    const convened = await service.convene({ teamId: 'launch-check', question: QUESTION, actor: 'user' })
    assert.equal(convened.team.custom, true)
    assert.equal(convened.budget.cap, 500)
    const teams = await service.teams()
    const auto = teams.find((team) => team.id === 'auto-lead')
    assert.deepEqual(auto.budget, { lean: 400, standard: 900, deep: 2000 })
  } finally {
    await dispose()
  }
})

test('deleting an expert prunes custom teams and a deleted preset can be restored by reset', async () => {
  const { service, dispose } = await makeService()
  try {
    await service.saveExpert({
      id: 'temp-expert',
      name: { zh: '临时专家' },
      mandate: '只在这个团队里出现一次。',
      lens: '临时镜头',
      asks: ['问题'],
      redLines: ['红线'],
      misses: '盲区',
    })
    await service.saveTeam({
      id: 'temp-team',
      name: { zh: '临时团' },
      members: [{ id: 'temp-expert', role: 'lead' }],
      agenda: ['问题'],
    })
    const deleted = await service.deleteEntity('expert', 'temp-expert')
    assert.equal(deleted.ok, true)
    assert.deepEqual(deleted.affectedTeams, ['temp-team'])
    const teams = await service.teams()
    assert.equal(teams.find((team) => team.id === 'temp-team').incomplete, true)
    await assert.rejects(() => service.convene({ teamId: 'temp-team', question: QUESTION, actor: 'user' }), /没有可用专家/)

    // Hiding a preset removes it from the catalog; reset brings it back.
    await service.deleteEntity('team', 'architecture')
    let names = (await service.teams()).map((team) => team.id)
    assert.ok(!names.includes('architecture'))
    const reset = await service.resetCustomization({ confirm: true })
    assert.equal(reset.ok, true)
    names = (await service.teams()).map((team) => team.id)
    assert.ok(names.includes('architecture'))
    const experts = await service.experts()
    assert.ok(experts.some((expert) => expert.id === 'architect' && expert.preset))
  } finally {
    await dispose()
  }
})

test('customisation persists across service restarts', async () => {
  const { service, store, dispose } = await makeService()
  try {
    await service.saveTeam({
      id: 'persisted-team',
      name: { zh: '持久化团队' },
      members: [{ id: 'skeptic', role: 'lead' }],
      agenda: ['真的吗？'],
    })
    const reloaded = createExpertCouncilService({ store, log: quiet })
    const teams = await reloaded.teams()
    assert.ok(teams.some((team) => team.id === 'persisted-team' && team.custom))
    const state = await reloaded.state()
    assert.ok(state.customization.customTeams.includes('persisted-team'))
  } finally {
    await dispose()
  }
})

test('the plugin does not squat on built-in Agent Teams names', () => {
  const isolation = checkIsolation()
  assert.equal(isolation.ok, true)
  assert.deepEqual(isolation.collisions, [])
  const own = Object.values(OWN_NAMES)
  for (const name of BUILTIN_AGENT_TEAM_NAMES) {
    assert.ok(!own.includes(name), `own namespace must not reuse ${name}`)
  }
  assert.equal(OWN_NAMES.tool, 'expert_council')
  assert.equal(OWN_NAMES.command, 'experts')
})
