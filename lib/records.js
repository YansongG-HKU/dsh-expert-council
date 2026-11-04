/**
 * Consult records: schema, normalisation and compact summaries.
 *
 * Every mutation goes through these normalisers so the ledger cannot be
 * corrupted by a malformed tool call (the tool is model-facing input).
 */

import { asArray, clamp, estimateTokens, isPlainObject, nullableString, stringList, truncate } from './util.js'
import { LIMITS, MODE_BY_ID, DEFAULT_MODE } from './protocol.js'

export const CONSULT_STATUSES = ['open', 'verdict', 'archived']

export function normalizeOpinion(raw, { teamIds = [] } = {}) {
  const source = isPlainObject(raw) ? raw : {}
  const expert = typeof source.expert === 'string' ? source.expert.trim() : ''
  const claims = asArray(source.claims)
    .filter(isPlainObject)
    .slice(0, LIMITS.opinionMaxClaims)
    .map((claim) => ({
      claim: truncate(String(claim.claim ?? '').trim(), 500),
      evidence: truncate(String(claim.evidence ?? '').trim(), 500),
      confidence: clamp(claim.confidence, 0, 1),
    }))
    .filter((claim) => claim.claim.length > 0)
  return {
    expert,
    inTeam: teamIds.length === 0 ? true : teamIds.includes(expert),
    stance: ['support', 'oppose', 'conditional'].includes(source.stance) ? source.stance : 'conditional',
    confidence: clamp(source.confidence, 0, 1),
    claims,
    changes: truncate(String(source.changes ?? '').trim(), 500),
    unknowns: stringList(source.unknowns, 6, 300),
    tokens: estimateTokens(JSON.stringify({ claims, stance: source.stance, changes: source.changes })),
  }
}

export function normalizeVerdict(raw) {
  const source = isPlainObject(raw) ? raw : {}
  return {
    decision: truncate(String(source.decision ?? '').trim(), 600),
    confidence: clamp(source.confidence, 0, 1),
    rationale: truncate(String(source.rationale ?? '').trim(), 2000),
    dissent: asArray(source.dissent)
      .filter(isPlainObject)
      .slice(0, 12)
      .map((item) => ({
        expert: truncate(String(item.expert ?? '').trim(), 60),
        point: truncate(String(item.point ?? '').trim(), 500),
        evidence: truncate(String(item.evidence ?? '').trim(), 500),
      }))
      .filter((item) => item.point.length > 0),
    unresolved: stringList(source.unresolved, 10, 400),
    reversalTriggers: stringList(source.reversalTriggers, 10, 400),
    actions: stringList(source.actions, 10, 400),
    at: Number(source.at) || Date.now(),
  }
}

export function normalizeRound(raw, index = 0) {
  const source = isPlainObject(raw) ? raw : {}
  return {
    round: Math.max(1, Math.trunc(Number(source.round) || index + 1)),
    at: Number(source.at) || Date.now(),
    opinions: asArray(source.opinions).filter(isPlainObject).slice(0, LIMITS.opinionsMaxPerRound),
    tokens: Math.max(0, Math.trunc(Number(source.tokens) || 0)),
    note: nullableString(source.note, 600),
  }
}

export function normalizeConsult(raw) {
  const source = isPlainObject(raw) ? raw : {}
  return {
    id: typeof source.id === 'string' ? source.id : '',
    teamId: typeof source.teamId === 'string' ? source.teamId : '',
    mode: MODE_BY_ID.has(source.mode) ? source.mode : DEFAULT_MODE,
    question: truncate(String(source.question ?? '').trim(), LIMITS.questionMax),
    context: nullableString(source.context, LIMITS.contextMax),
    status: CONSULT_STATUSES.includes(source.status) ? source.status : 'open',
    /**
     * Who opened this consult. `user-action` = /experts command or panel click;
     * `explicit-request` = the model declared the user's own words. Both are
     * auditable; a consult without consent cannot exist because convene refuses.
     */
    consent: isPlainObject(source.consent)
      ? {
          kind: source.consent.kind === 'user-action' ? 'user-action' : 'explicit-request',
          via: nullableString(source.consent.via, 20),
          quote: nullableString(source.consent.quote, 300),
          at: Number(source.consent.at) || Date.now(),
        }
      : null,
    budget: isPlainObject(source.budget) ? source.budget : null,
    rounds: asArray(source.rounds).filter(isPlainObject).slice(0, LIMITS.roundsMax),
    disagreements: asArray(source.disagreements).filter(isPlainObject).slice(0, 30),
    verdict: isPlainObject(source.verdict) ? source.verdict : null,
    tokens: Math.max(0, Math.trunc(Number(source.tokens) || 0)),
    createdAt: Number(source.createdAt) || Date.now(),
    updatedAt: Number(source.updatedAt) || Date.now(),
    archivedAt: Number(source.archivedAt) || null,
    sessionId: nullableString(source.sessionId, 120),
  }
}

export function summarizeConsult(consult) {
  const verdict = consult?.verdict ?? null
  return {
    id: consult.id,
    teamId: consult.teamId,
    mode: consult.mode,
    status: consult.status,
    question: truncate(consult.question, 120),
    tokens: consult.tokens,
    roundCount: Array.isArray(consult.rounds) ? consult.rounds.length : 0,
    opinionCount: Array.isArray(consult.rounds)
      ? consult.rounds.reduce((sum, round) => sum + (Array.isArray(round.opinions) ? round.opinions.length : 0), 0)
      : 0,
    decision: verdict?.decision ? truncate(verdict.decision, 160) : null,
    confidence: typeof verdict?.confidence === 'number' ? verdict.confidence : null,
    dissentCount: Array.isArray(verdict?.dissent) ? verdict.dissent.length : 0,
    explicit: consult.consent?.kind === 'explicit-request' || consult.consent?.kind === 'user-action',
    createdAt: consult.createdAt,
    updatedAt: consult.updatedAt,
  }
}
