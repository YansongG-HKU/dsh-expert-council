/**
 * Roster / team / protocol integrity tests.
 *
 * The roster is data, so the tests are schema + coherence checks: every lens
 * must be complete enough to be usable, every team must reference real lenses,
 * budgets must be monotonic across depths, and the brief must actually contain
 * the selected lenses (and only them).
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { EXPERTS, EXPERT_GROUPS, getExpert } from '../lib/experts.js'
import { TEAMS, getTeam } from '../lib/teams.js'
import { MODES, PROTOCOL_RULES, buildBrief, detectDisagreements, estimateBudget, modeLabel, roundsFor } from '../lib/protocol.js'

test('every expert has a complete, usable definition', () => {
  assert.ok(EXPERTS.length >= 12, 'roster is large enough for real panels')
  const ids = new Set()
  for (const expert of EXPERTS) {
    assert.match(expert.id, /^[a-z][a-z-]+$/)
    assert.ok(!ids.has(expert.id), `duplicate expert id ${expert.id}`)
    ids.add(expert.id)
    assert.ok(expert.name.zh.length >= 2 && expert.name.en.length >= 2)
    assert.ok(EXPERT_GROUPS.some((group) => group.id === expert.group), `${expert.id} group`)
    assert.ok(expert.mandate.length >= 12, `${expert.id} mandate`)
    assert.ok(expert.lens.length >= 4, `${expert.id} lens`)
    assert.ok(expert.asks.length >= 3 && expert.asks.length <= 6, `${expert.id} asks`)
    assert.ok(expert.redLines.length >= 2, `${expert.id} red lines`)
    assert.ok(expert.misses.length >= 4, `${expert.id} misses`)
    assert.ok(expert.budget.standard > 60 && expert.budget.deep >= expert.budget.standard)
    for (const pair of expert.pairs) assert.ok(getExpert(pair), `${expert.id} pairs ${pair}`)
  }
})

test('every team is coherent and covers its lead', () => {
  assert.ok(TEAMS.length >= 7)
  for (const team of TEAMS) {
    assert.match(team.id, /^[a-z][a-z-]*$/)
    assert.ok(team.members.length >= 3 && team.members.length <= 6, `${team.id} size`)
    const leads = team.members.filter((member) => member.role === 'lead')
    assert.equal(leads.length, 1, `${team.id} has exactly one lead`)
    for (const member of team.members) {
      assert.ok(getExpert(member.id), `${team.id} member ${member.id}`)
    }
    assert.ok(team.agenda.length >= 3)
    assert.ok(team.artifacts.length >= 1)
    assert.ok(['lean', 'standard', 'deep'].includes(team.defaultMode))
    assert.ok(team.budget.lean < team.budget.standard && team.budget.standard < team.budget.deep, `${team.id} budget order`)
  }
  assert.ok(getTeam('architecture') && getTeam('security-review'))
})

test('mode budgets are monotonic and estimates fit the declared cap', () => {
  for (const team of TEAMS) {
    const lean = estimateBudget(team, 'lean')
    const standard = estimateBudget(team, 'standard')
    const deep = estimateBudget(team, 'deep')
    assert.ok(lean.cap < standard.cap && standard.cap < deep.cap)
    for (const plan of [lean, standard, deep]) {
      assert.equal(plan.cap, team.budget[plan === lean ? 'lean' : plan === standard ? 'standard' : 'deep'])
      assert.ok(plan.opinionBudget + plan.verdictReserve === plan.cap)
      assert.ok(plan.perExpert >= 60)
    }
  }
  assert.deepEqual(roundsFor('lean'), ['define', 'lenses', 'verdict'])
  assert.deepEqual(roundsFor('deep'), ['define', 'independent', 'anonymous-peer', 'cross', 'verdict'])
  assert.equal(modeLabel('standard'), '标准会诊')
})

test('the brief loads only the selected lenses and carries the protocol + budget', () => {
  const team = getTeam('architecture')
  const resolved = { ...team, members: team.members.map((member) => ({ ...member, expert: getExpert(member.id) })) }
  const brief = buildBrief({ team: resolved, mode: 'standard', question: '要不要现在引入消息队列？' })
  for (const member of team.members) {
    assert.ok(brief.includes(member.id), `brief must mention ${member.id}`)
  }
  for (const expert of EXPERTS) {
    if (!team.members.some((member) => member.id === expert.id)) {
      assert.ok(!brief.includes(`### ${expert.name.zh}`), `brief must not load unrelated lens ${expert.id}`)
    }
  }
  for (const rule of PROTOCOL_RULES) assert.ok(brief.includes(rule.title), `rule ${rule.title}`)
  assert.ok(brief.includes('输出契约'))
  assert.ok(brief.includes('token'))
  assert.ok(brief.includes('verdict'))
  const leanBrief = buildBrief({ team: resolved, mode: 'lean', question: '小改动要不要合并？' })
  assert.ok(!leanBrief.includes('输出契约'), 'lean mode omits the per-expert JSON contract')
})

test('protocol rules and modes are complete', () => {
  assert.equal(PROTOCOL_RULES.length, 7)
  for (const rule of PROTOCOL_RULES) {
    assert.ok(rule.title.length >= 3 && rule.text.length >= 12)
  }
  assert.deepEqual(
    MODES.map((mode) => mode.id),
    ['lean', 'standard', 'deep'],
  )
  for (const mode of MODES) {
    assert.ok(mode.stages.length >= 3)
    assert.ok(mode.factor > 0)
  }
})

test('disagreements skip a lens revising itself and never duplicate a pair', () => {
  const round1 = [
    { expert: 'sre', stance: 'support', confidence: 0.7 },
    { expert: 'cost', stance: 'oppose', confidence: 0.6 },
  ]
  const detected = detectDisagreements(round1)
  assert.equal(detected.length, 1)
  assert.equal(detected[0].kind, 'stance')

  const revised = [...round1, { expert: 'sre', stance: 'conditional', confidence: 0.7 }, { expert: 'cost', stance: 'oppose', confidence: 0.6 }]
  const again = detectDisagreements(revised)
  assert.ok(again.every((item) => item.a !== item.b), 'no self-pair across rounds')
  assert.equal(new Set(again.map((item) => [item.a, item.b].sort().join('|'))).size, again.length)
  assert.equal(again.length, 1, 'one deduped pair for the same two lenses')

  const confidenceOnly = detectDisagreements([
    { expert: 'architect', stance: 'support', confidence: 0.9 },
    { expert: 'security', stance: 'support', confidence: 0.3 },
  ])
  assert.equal(confidenceOnly[0].kind, 'confidence')
})
