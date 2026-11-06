/**
 * Domain pack integrity tests.
 *
 * Domain packs are data too, so these are contract checks: six fields in a
 * fixed order, five genuinely distinct lenses each, one coherent team with a
 * single chair, an evidence ladder that runs strong (A) to weak, mandatory
 * evidence and red flags, and no id collisions with the core roster or the
 * core teams. The flat exports must stay exactly in sync with the packs.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { EXPERTS } from '../lib/experts.js'
import { TEAMS } from '../lib/teams.js'
import {
  DOMAIN_BY_ID,
  DOMAIN_EXPERTS,
  DOMAIN_PACKS,
  DOMAIN_TEAMS,
  domainForTeam,
  getDomain,
} from '../lib/domains.js'

const PACK_IDS = ['finance', 'legal', 'healthcare', 'engineering', 'research', 'security']

/** Expert id namespace per pack (healthcare uses `health-*`, not `healthcare-*`). */
const PREFIX = {
  finance: 'finance',
  legal: 'legal',
  healthcare: 'health',
  engineering: 'eng',
  research: 'research',
  security: 'sec',
}

const EVIDENCE_IDS = ['A', 'B', 'C', 'D', 'E']
const GROUPS = ['structure', 'risk', 'user', 'execution']
const MODES = ['lean', 'standard', 'deep']
const ID_PATTERN = /^[a-z][a-z0-9-]+$/

const CORE_EXPERT_IDS = new Set(EXPERTS.map((expert) => expert.id))
const CORE_TEAM_IDS = new Set(TEAMS.map((team) => team.id))
const DOMAIN_TEAM_IDS = new Set(DOMAIN_TEAMS.map((team) => team.id))

function expertIdsOf(pack) {
  return new Set(pack.experts.map((expert) => expert.id))
}

test('six domain packs in the agreed order, with identity fields', () => {
  assert.equal(DOMAIN_PACKS.length, 6)
  assert.deepEqual(
    DOMAIN_PACKS.map((pack) => pack.id),
    PACK_IDS,
  )
  const zhNames = new Set()
  for (const pack of DOMAIN_PACKS) {
    assert.match(pack.id, /^[a-z]+$/)
    assert.ok(pack.name && pack.name.zh && pack.name.en, `${pack.id} name`)
    assert.ok(pack.name.zh.length >= 2, `${pack.id} zh name`)
    assert.ok(pack.name.en.length >= 3, `${pack.id} en name`)
    assert.ok(!zhNames.has(pack.name.zh), `${pack.id} zh name is unique`)
    zhNames.add(pack.name.zh)
    assert.ok(pack.tagline.length >= 10, `${pack.id} tagline`)
    assert.ok(pack.description.length >= 40, `${pack.id} description`)
    assert.ok(pack.keywords.length >= 4 && pack.keywords.length <= 6, `${pack.id} keywords`)
    assert.equal(new Set(pack.keywords).size, pack.keywords.length, `${pack.id} keywords unique`)
    for (const keyword of pack.keywords) {
      assert.ok(keyword.length >= 2 && /[\u4e00-\u9fff]/.test(keyword), `${pack.id} keyword ${keyword}`)
    }
    assert.ok(MODES.includes(pack.defaultMode), `${pack.id} default mode`)
    assert.equal(pack.defaultMode, 'standard')
  }
  assert.ok(DOMAIN_BY_ID instanceof Map)
  assert.equal(DOMAIN_BY_ID.size, 6)
  assert.equal(getDomain('finance'), DOMAIN_PACKS[0])
  assert.equal(getDomain('security'), DOMAIN_PACKS[5])
  assert.equal(DOMAIN_BY_ID.get('legal'), DOMAIN_PACKS[1])
  assert.equal(getDomain('unknown'), null)
  assert.equal(getDomain(''), null)
  assert.equal(getDomain(undefined), null)
})

test('every pack has a descending evidence ladder and mandatory evidence rules', () => {
  for (const pack of DOMAIN_PACKS) {
    const { levels, required, redFlags } = pack.evidence
    assert.ok(levels.length >= 3 && levels.length <= 5, `${pack.id} evidence level count`)
    assert.deepEqual(
      levels.map((level) => level.id),
      EVIDENCE_IDS.slice(0, levels.length),
      `${pack.id} evidence levels run A..`,
    )
    for (const level of levels) {
      assert.ok(level.label.length >= 2, `${pack.id} level ${level.id} label`)
      assert.ok(level.meaning.length >= 8, `${pack.id} level ${level.id} meaning`)
    }
    assert.ok(required.length >= 3 && required.length <= 4, `${pack.id} required evidence items`)
    for (const item of required) assert.ok(item.length >= 2, `${pack.id} required item ${item}`)
    assert.ok(redFlags.length >= 3 && redFlags.length <= 5, `${pack.id} red flags`)
    for (const flag of redFlags) assert.ok(flag.length >= 4, `${pack.id} red flag ${flag}`)
  }
})

test('artifacts are real deliverables and budgets increase with depth', () => {
  for (const pack of DOMAIN_PACKS) {
    assert.ok(pack.artifacts.length >= 2 && pack.artifacts.length <= 4, `${pack.id} artifacts`)
    assert.equal(new Set(pack.artifacts).size, pack.artifacts.length, `${pack.id} artifacts unique`)
    for (const artifact of pack.artifacts) assert.ok(artifact.length >= 4, `${pack.id} artifact ${artifact}`)
    const { lean, standard, deep } = pack.budget
    assert.ok(Number.isInteger(lean) && Number.isInteger(standard) && Number.isInteger(deep), `${pack.id} budget ints`)
    assert.ok(lean < standard && standard < deep, `${pack.id} budget order`)
    assert.ok(lean >= 400 && lean <= 1500, `${pack.id} lean scale`)
    assert.ok(standard >= 1200 && standard <= 5000, `${pack.id} standard scale`)
    assert.ok(deep >= 3000 && deep <= 10000, `${pack.id} deep scale`)
  }
})

test('every pack fields five complete, distinct domain experts', () => {
  const seen = new Set()
  for (const pack of DOMAIN_PACKS) {
    assert.equal(pack.experts.length, 5, `${pack.id} has exactly five experts`)
    const ownIds = expertIdsOf(pack)
    assert.equal(ownIds.size, 5, `${pack.id} expert ids unique`)
    for (const expert of pack.experts) {
      assert.match(expert.id, ID_PATTERN, `${expert.id} id pattern`)
      assert.ok(expert.id.startsWith(`${PREFIX[pack.id]}-`), `${expert.id} is prefixed ${PREFIX[pack.id]}-`)
      assert.ok(!seen.has(expert.id), `duplicate domain expert id ${expert.id}`)
      seen.add(expert.id)
      assert.ok(!CORE_EXPERT_IDS.has(expert.id), `${expert.id} collides with a core expert`)
      assert.ok(!CORE_TEAM_IDS.has(expert.id), `${expert.id} collides with a core team`)
      assert.ok(!DOMAIN_TEAM_IDS.has(expert.id), `${expert.id} collides with a domain team`)
      assert.ok(expert.name.zh.length >= 2 && expert.name.en.length >= 2, `${expert.id} names`)
      assert.ok(GROUPS.includes(expert.group), `${expert.id} group ${expert.group}`)
      assert.ok(expert.mandate.length >= 12, `${expert.id} mandate`)
      assert.ok(expert.lens.length >= 4, `${expert.id} lens`)
      assert.equal(expert.asks.length, 4, `${expert.id} asks`)
      for (const ask of expert.asks) assert.ok(ask.length >= 8, `${expert.id} ask ${ask}`)
      assert.ok(expert.redLines.length >= 3, `${expert.id} red lines`)
      for (const line of expert.redLines) assert.ok(line.length >= 6, `${expert.id} red line ${line}`)
      assert.ok(expert.misses.length >= 4, `${expert.id} misses`)
      assert.ok(Array.isArray(expert.pairs) && expert.pairs.length >= 1, `${expert.id} pairs`)
      for (const pair of expert.pairs) {
        assert.ok(ownIds.has(pair), `${expert.id} pairs ${pair} inside the same pack`)
        assert.notEqual(pair, expert.id, `${expert.id} must not pair with itself`)
      }
      if (expert.conflicts !== undefined) {
        assert.ok(Array.isArray(expert.conflicts), `${expert.id} conflicts array`)
        for (const conflict of expert.conflicts) {
          assert.ok(ownIds.has(conflict), `${expert.id} conflicts ${conflict} inside the same pack`)
        }
      }
      assert.ok(Number.isInteger(expert.budget.standard) && Number.isInteger(expert.budget.deep), `${expert.id} budget ints`)
      assert.ok(expert.budget.standard >= 150 && expert.budget.standard <= 320, `${expert.id} standard budget`)
      assert.ok(expert.budget.deep >= 230 && expert.budget.deep <= 450, `${expert.id} deep budget`)
      assert.ok(expert.budget.deep > expert.budget.standard, `${expert.id} deep budget exceeds standard`)
    }
    // A domain pack is useless if the five lenses are copy-paste clones.
    for (const field of ['zh', 'en']) {
      assert.equal(new Set(pack.experts.map((expert) => expert.name[field])).size, 5, `${pack.id} ${field} names distinct`)
    }
    assert.equal(new Set(pack.experts.map((expert) => expert.mandate)).size, 5, `${pack.id} mandates distinct`)
    assert.equal(new Set(pack.experts.map((expert) => expert.lens)).size, 5, `${pack.id} lenses distinct`)
  }
  assert.equal(seen.size, 30)
})

test('each pack ships one coherent review team with exactly one lead', () => {
  assert.equal(DOMAIN_TEAMS.length, 6)
  const teamIds = new Set()
  for (const pack of DOMAIN_PACKS) {
    const team = pack.team
    assert.ok(team, `${pack.id} team`)
    assert.match(team.id, ID_PATTERN, `${team.id} id pattern`)
    assert.ok(team.id.startsWith(`${pack.id}-`), `${team.id} is prefixed ${pack.id}-`)
    assert.ok(!teamIds.has(team.id), `duplicate domain team id ${team.id}`)
    teamIds.add(team.id)
    assert.ok(!CORE_TEAM_IDS.has(team.id), `${team.id} collides with a core team id`)
    assert.ok(team.name.zh.length >= 2 && team.name.en.length >= 2, `${team.id} names`)
    assert.ok(team.tagline.length >= 10, `${team.id} tagline`)
    assert.ok(team.intent.length >= 8, `${team.id} intent`)
    assert.ok(MODES.includes(team.defaultMode), `${team.id} mode`)
    assert.equal(team.defaultMode, pack.defaultMode, `${team.id} default mode matches pack`)

    const ownIds = expertIdsOf(pack)
    assert.equal(team.members.length, 5, `${team.id} has exactly five members`)
    assert.equal(new Set(team.members.map((member) => member.id)).size, 5, `${team.id} members unique`)
    for (const member of team.members) {
      assert.ok(ownIds.has(member.id), `${team.id} member ${member.id} belongs to the pack`)
      assert.ok(['lead', 'member'].includes(member.role), `${team.id} role ${member.role}`)
    }
    assert.deepEqual(
      new Set(team.members.map((member) => member.id)),
      ownIds,
      `${team.id} rosters every expert in the pack`,
    )
    assert.equal(team.members.filter((member) => member.role === 'lead').length, 1, `${team.id} exactly one lead`)
    assert.ok(team.agenda.length >= 3 && team.agenda.length <= 8, `${team.id} agenda`)
    for (const item of team.agenda) assert.ok(item.length >= 8, `${team.id} agenda item ${item}`)
    assert.ok(team.artifacts.length >= 2, `${team.id} artifacts`)
    assert.deepEqual(team.budget, pack.budget, `${team.id} budget equals the pack budget`)
    const { lean, standard, deep } = team.budget
    assert.ok(lean < standard && standard < deep, `${team.id} budget order`)

    const flat = DOMAIN_TEAMS.find((candidate) => candidate.domain === pack.id)
    assert.ok(flat, `${pack.id} team is exported`)
    assert.equal(flat.id, team.id)
  }
  assert.equal(teamIds.size, 6)
})

test('flat exports stay in sync with the packs and lookups resolve', () => {
  assert.equal(DOMAIN_EXPERTS.length, 30)
  assert.equal(DOMAIN_TEAMS.length, 6)
  assert.equal(new Set(DOMAIN_EXPERTS.map((expert) => expert.id)).size, 30)
  assert.deepEqual(
    DOMAIN_TEAMS.map((team) => team.domain),
    PACK_IDS,
  )
  const packsById = new Map(DOMAIN_PACKS.map((pack) => [pack.id, pack]))
  for (const expert of DOMAIN_EXPERTS) {
    assert.ok(packsById.has(expert.domain), `${expert.id} domain ${expert.domain}`)
    assert.ok(packsById.get(expert.domain).experts.some((entry) => entry.id === expert.id), `${expert.id} belongs to ${expert.domain}`)
  }
  for (const pack of DOMAIN_PACKS) {
    for (const expert of pack.experts) {
      const flat = DOMAIN_EXPERTS.find((candidate) => candidate.id === expert.id)
      assert.ok(flat, `${expert.id} is flattened`)
      assert.deepEqual(flat, { ...expert, domain: pack.id }, `${expert.id} flat shape`)
    }
    const team = DOMAIN_TEAMS.find((candidate) => candidate.id === pack.team.id)
    assert.deepEqual(team, { ...pack.team, domain: pack.id }, `${pack.team.id} flat shape`)
  }
  assert.equal(domainForTeam('finance-review'), DOMAIN_PACKS[0])
  assert.equal(domainForTeam('security-operations'), DOMAIN_PACKS[5])
  assert.equal(domainForTeam('legal-review'), DOMAIN_PACKS[1])
  assert.equal(domainForTeam('architecture'), null, 'core teams have no domain')
  assert.equal(domainForTeam('research-review'), null, 'the core research-review team has no domain')
  assert.equal(domainForTeam('unknown'), null)
  assert.equal(DOMAIN_TEAMS.find((team) => team.domain === 'finance').id, getDomain('finance').team.id)
})

test('the whole catalog is collision free across id namespaces', () => {
  const coreExpertIds = EXPERTS.map((expert) => expert.id)
  const coreTeamIds = TEAMS.map((team) => team.id)
  const domainExpertIds = DOMAIN_EXPERTS.map((expert) => expert.id)
  const domainTeamIds = DOMAIN_TEAMS.map((team) => team.id)

  for (const list of [coreExpertIds, coreTeamIds, domainExpertIds, domainTeamIds]) {
    assert.equal(new Set(list).size, list.length, 'ids unique within a namespace')
  }
  assert.equal(
    new Set([...coreExpertIds, ...domainExpertIds]).size,
    coreExpertIds.length + domainExpertIds.length,
    'no domain expert shadows a core expert',
  )
  assert.equal(
    new Set([...coreTeamIds, ...domainTeamIds]).size,
    coreTeamIds.length + domainTeamIds.length,
    'no domain team shadows a core team',
  )
  for (const domainExpertId of domainExpertIds) {
    assert.ok(!coreTeamIds.includes(domainExpertId), `expert ${domainExpertId} must not collide with a core team id`)
    assert.ok(!domainTeamIds.includes(domainExpertId), `expert ${domainExpertId} must not collide with a domain team id`)
  }
  for (const domainTeamId of domainTeamIds) {
    assert.ok(!coreExpertIds.includes(domainTeamId), `team ${domainTeamId} must not collide with a core expert id`)
  }
})
