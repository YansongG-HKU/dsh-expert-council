/**
 * Customisation layer for the expert council.
 *
 * The built-in roster is code; the user's changes are data. This module owns
 * the merge and the validation so a malformed panel/tool payload can never
 * corrupt the catalog:
 *   - every preset can be overridden (same id, `custom: true`)
 *   - new experts/teams can be added
 *   - presets can be hidden, custom entries can be deleted
 *   - a team must reference existing experts and have exactly one chair
 *
 * `customization.json` shape:
 *   { version, experts: {id: Expert}, teams: {id: Team}, hiddenExperts: [], hiddenTeams: [], updatedAt }
 */

import { asArray, clamp, isPlainObject, nullableString, truncate } from './util.js'

export const ID_PATTERN = /^[a-z][a-z0-9-]{1,40}$/
export const MAX_CUSTOM_EXPERTS = 40
export const MAX_CUSTOM_TEAMS = 40
export const MAX_HISTORY = 80

export function emptyCustomization() {
  return { version: 1, experts: {}, teams: {}, hiddenExperts: [], hiddenTeams: [], history: [], updatedAt: 0 }
}

/** Append one audit entry (bounded) to the customisation history. */
export function addHistoryEntry(custom, entry) {
  const history = asArray(custom.history).filter(isPlainObject).slice(-(MAX_HISTORY - 1))
  custom.history = [
    ...history,
    {
      at: Number(entry.at) || Date.now(),
      actor: entry.actor === 'agent' ? 'agent' : 'user',
      action: truncate(String(entry.action ?? ''), 40),
      id: entry.id ? truncate(String(entry.id), 60) : null,
      request: entry.request ? truncate(String(entry.request), 300) : null,
      summary: truncate(String(entry.summary ?? ''), 300),
    },
  ]
  return custom
}

export function normalizeCustomization(raw) {
  const source = isPlainObject(raw) ? raw : {}
  const experts = {}
  for (const [id, expert] of Object.entries(isPlainObject(source.experts) ? source.experts : {})) {
    if (ID_PATTERN.test(id) && isPlainObject(expert)) experts[id] = expert
  }
  const teams = {}
  for (const [id, team] of Object.entries(isPlainObject(source.teams) ? source.teams : {})) {
    if (ID_PATTERN.test(id) && isPlainObject(team)) teams[id] = team
  }
  return {
    version: 1,
    experts,
    teams,
    hiddenExperts: asArray(source.hiddenExperts).filter((id) => typeof id === 'string'),
    hiddenTeams: asArray(source.hiddenTeams).filter((id) => typeof id === 'string'),
    history: asArray(source.history)
      .filter(isPlainObject)
      .slice(-MAX_HISTORY)
      .map((entry) => ({
        at: Number(entry.at) || 0,
        actor: entry.actor === 'agent' ? 'agent' : 'user',
        action: truncate(String(entry.action ?? ''), 40),
        id: entry.id ? truncate(String(entry.id), 60) : null,
        request: entry.request ? truncate(String(entry.request), 300) : null,
        summary: truncate(String(entry.summary ?? ''), 300),
      })),
    updatedAt: Number(source.updatedAt) || 0,
  }
}

function cleanName(raw, fallback) {
  const source = isPlainObject(raw) ? raw : {}
  const zh = truncate(String(source.zh ?? '').trim(), 40)
  const en = truncate(String(source.en ?? '').trim(), 60)
  return { zh: zh || fallback, en: en || zh || fallback }
}

/** Validate + normalise one expert. @returns {{ok:true,value}|{ok:false,error}} */
export function cleanExpertInput(raw) {
  const source = isPlainObject(raw) ? raw : {}
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  if (!ID_PATTERN.test(id)) return { ok: false, error: `专家 id 不合法：${id || '（空）'}（小写字母开头，可含数字与 -，2–41 字符）` }
  const name = cleanName(source.name, id)
  if (name.zh.length < 2) return { ok: false, error: '专家至少需要一个 2 字以上的中文名' }
  const mandate = truncate(String(source.mandate ?? '').trim(), 500)
  if (mandate.length < 8) return { ok: false, error: '职责（mandate）至少 8 个字，要说明这个专家管什么' }
  const lens = truncate(String(source.lens ?? '').trim(), 200)
  if (lens.length < 2) return { ok: false, error: '镜头（lens）不能为空' }
  const asks = asArray(source.asks)
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .slice(0, 6)
    .map((item) => truncate(item.trim(), 300))
  if (asks.length < 1) return { ok: false, error: '至少要有一个「必问」问题' }
  const redLines = asArray(source.redLines)
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .slice(0, 6)
    .map((item) => truncate(item.trim(), 300))
  if (redLines.length < 1) return { ok: false, error: '至少要有一条红线（触发即否决）' }
  const misses = truncate(String(source.misses ?? '').trim(), 300)
  if (misses.length < 2) return { ok: false, error: '「易漏/盲区」不能为空：每个镜头都有系统性偏差' }
  const budget = isPlainObject(source.budget) ? source.budget : {}
  const standard = clamp(Math.trunc(Number(budget.standard) || 120), 40, 4000)
  const deep = clamp(Math.trunc(Number(budget.deep) || standard * 1.5), standard, 6000)
  return {
    ok: true,
    value: {
      id,
      name,
      group: ['structure', 'risk', 'user', 'execution'].includes(source.group) ? source.group : 'execution',
      mandate,
      lens,
      asks,
      redLines,
      misses,
      pairs: asArray(source.pairs).filter((item) => typeof item === 'string').slice(0, 8),
      conflicts: asArray(source.conflicts).filter((item) => typeof item === 'string').slice(0, 8),
      budget: { standard, deep },
      custom: true,
    },
  }
}

/** Validate + normalise one team against the *merged* expert catalog. */
export function cleanTeamInput(raw, { expertIds = [] } = {}) {
  const source = isPlainObject(raw) ? raw : {}
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  if (!ID_PATTERN.test(id)) return { ok: false, error: `团队 id 不合法：${id || '（空）'}` }
  const zh = truncate(String(source.name?.zh ?? '').trim(), 40)
  if (zh.length < 2) return { ok: false, error: '团队至少需要一个 2 字以上的中文名' }
  const rawMembers = asArray(source.members)
    .filter(isPlainObject)
    .map((member) => ({ id: String(member.id ?? '').trim(), role: member.role === 'lead' ? 'lead' : 'member' }))
  const unknown = rawMembers.map((member) => member.id).filter((memberId) => memberId && !expertIds.includes(memberId))
  if (unknown.length > 0) return { ok: false, error: `团队引用了不存在的专家：${unknown.join('、')}` }
  const members = rawMembers.filter((member) => expertIds.includes(member.id))
  if (members.length < 1) return { ok: false, error: '团队至少需要 1 名专家（推荐 3–5 名）' }
  const leads = members.filter((member) => member.role === 'lead')
  if (leads.length > 1) return { ok: false, error: '团队只能有一个主持（lead）' }
  if (leads.length === 0) members[0].role = 'lead'
  const agenda = asArray(source.agenda)
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .slice(0, 8)
    .map((item) => truncate(item.trim(), 300))
  if (agenda.length < 1) return { ok: false, error: '团队至少要有一条议程' }
  const artifacts = asArray(source.artifacts)
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .slice(0, 8)
    .map((item) => truncate(item.trim(), 300))
  const budgets = isPlainObject(source.budget) ? source.budget : {}
  const lean = clamp(Math.trunc(Number(budgets.lean) || 500), 100, 20000)
  const standard = clamp(Math.trunc(Number(budgets.standard) || 1500), lean, 20000)
  const deep = clamp(Math.trunc(Number(budgets.deep) || standard * 2), standard, 50000)
  return {
    ok: true,
    value: {
      id,
      name: { zh, en: truncate(String(source.name?.en ?? '').trim(), 60) || zh },
      tagline: truncate(String(source.tagline ?? '').trim(), 200) || `${members.length} 位专家的自定义评审团。`,
      intent: truncate(String(source.intent ?? '').trim(), 300) || '自定义评审场景。',
      defaultMode: ['lean', 'standard', 'deep'].includes(source.defaultMode) ? source.defaultMode : 'lean',
      members,
      agenda,
      artifacts: artifacts.length > 0 ? artifacts : ['会诊裁决（含异议与推翻条件）'],
      budget: { lean, standard, deep },
      custom: true,
    },
  }
}

/** Merge defaults with overrides; presets stay in code, overrides are data. */
export function mergeExperts(defaults, custom) {
  const map = new Map()
  for (const expert of defaults) map.set(expert.id, { ...expert, preset: true, custom: false })
  for (const [id, expert] of Object.entries(custom.experts ?? {})) {
    map.set(id, { ...expert, id, preset: map.has(id), custom: true })
  }
  for (const id of custom.hiddenExperts ?? []) map.delete(id)
  return [...map.values()]
}

export function mergeTeams(defaults, custom, experts) {
  const expertIds = new Set(experts.map((expert) => expert.id))
  const map = new Map()
  for (const team of defaults) map.set(team.id, { ...team, preset: true, custom: false })
  for (const [id, team] of Object.entries(custom.teams ?? {})) {
    map.set(id, { ...team, id, preset: map.has(id), custom: true })
  }
  for (const id of custom.hiddenTeams ?? []) map.delete(id)
  const out = []
  for (const team of map.values()) {
    const members = team.members.filter((member) => expertIds.has(member.id))
    const leads = members.filter((member) => member.role === 'lead')
    if (leads.length === 0 && members.length > 0) members[0].role = 'lead'
    out.push({ ...team, members, incomplete: members.length === 0 })
  }
  return out
}

/** Compact customisation summary for the panel/tool. */
export function summarizeCustomization(custom) {
  const history = asArray(custom.history).filter(isPlainObject)
  return {
    customExperts: Object.keys(custom.experts ?? {}),
    customTeams: Object.keys(custom.teams ?? {}),
    hiddenExperts: [...(custom.hiddenExperts ?? [])],
    hiddenTeams: [...(custom.hiddenTeams ?? [])],
    history: history.slice(-12).reverse(),
    updatedAt: Number(custom.updatedAt) || 0,
  }
}

/** Kept for the tool schema description; not used for validation. */
export function describeLimits() {
  return { maxCustomExperts: MAX_CUSTOM_EXPERTS, maxCustomTeams: MAX_CUSTOM_TEAMS }
}

export { nullableString }
