/**
 * Small shared helpers for dsh-expert-council.
 *
 * Everything here is dependency-free so the Host half can be exercised by the
 * test suite without a Harness runtime.
 */

import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export function nowMs() {
  return Date.now()
}

/**
 * Compact, sortable consult id: `ec-YYYYMMDD-HHMMSS-xxxx`.
 * Deterministic prefix + random suffix so two convenes in one second never collide.
 */
export function consultId(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
  return `ec-${stamp}-${randomBytes(2).toString('hex')}`
}

export function errorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error ?? 'unknown error')
}

export function truncate(value, max) {
  if (typeof value !== 'string') return ''
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/**
 * Token estimate for mixed Chinese/English prose.
 *
 * Chinese is roughly 1 token per character on modern BPE vocabularies, Latin
 * words are roughly 1 token per 4 characters. We deliberately over-estimate a
 * little so budgets stay conservative.
 */
export function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0
  let cjk = 0
  let latin = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk += 1
    } else if (/\s/.test(char)) {
      continue
    } else {
      latin += 1
    }
  }
  return Math.ceil(cjk + latin / 4)
}

/** JSON.stringify for report values, never throws. */
export function jsonText(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return '"[unserializable]"'
  }
}

/** Atomic JSON write: write to a sibling temp file, then rename over the target. */
export async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${randomBytes(3).toString('hex')}.tmp`
  try {
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(tmp, file)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}

export function clamp(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.min(max, Math.max(min, number))
}

export function asArray(value) {
  return Array.isArray(value) ? value : []
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function nullableString(value, max = 2000) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length === 0 ? null : truncate(text, max)
}

export function stringList(value, maxItems = 20, maxLength = 600) {
  return asArray(value)
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .slice(0, maxItems)
    .map((item) => truncate(item.trim(), maxLength))
}

/**
 * Normalize a model selection to the fields the executor actually consumes.
 *
 * `ToolRunContext.agent.model.current()` returns `{provider, model, reasoningEffort?}`
 * and `Session.requestHeader().config` returns the full `LlmCallConfig`; only the
 * route (and the optional effort) matter here, and an incomplete selection is
 * no selection at all.
 */
export function normalizeSelection(selection) {
  if (!selection || typeof selection !== 'object') return null
  const provider = typeof selection.provider === 'string' ? selection.provider.trim() : ''
  const model = typeof selection.model === 'string' ? selection.model.trim() : ''
  if (!provider || !model) return null
  const normalized = { provider, model }
  if (typeof selection.reasoningEffort === 'string' && selection.reasoningEffort.trim()) {
    normalized.reasoningEffort = selection.reasoningEffort.trim()
  }
  return normalized
}

/**
 * Whether the effective route has reasoning enabled.
 *
 * Providers apply their own default effort when the caller omits one; this can
 * only mirror the selection we hold. An explicit `reasoningEffort` argument
 * beats the selection, and `'off'` (case-insensitive) means no reasoning.
 */
export function routeReasoningActive({ selection = null, reasoningEffort = null } = {}) {
  const explicit = typeof reasoningEffort === 'string' && reasoningEffort.trim() ? reasoningEffort.trim() : null
  const inherited = explicit ?? normalizeSelection(selection)?.reasoningEffort ?? null
  if (!inherited) return false
  return inherited.toLowerCase() !== 'off'
}

/**
 * Minimum output budget per stage when the route spends tokens on reasoning.
 *
 * A reasoning model's hidden thinking counts against `maxTokens`, so the old
 * 1200/1000-token budgets could be exhausted before any visible JSON appeared,
 * which looked like an "empty" expert and could drop the run below quorum.
 */
export const REASONING_OUTPUT_FLOORS = Object.freeze({
  expert: 2400,
  cross: 1800,
  chair: 1800,
  lean: 2400,
  task: 2400,
  taskMerge: 6000,
})

export function reasoningOutputFloor(stage, reasoningActive) {
  if (!reasoningActive) return 0
  const floor = REASONING_OUTPUT_FLOORS[stage]
  return Number.isFinite(floor) ? floor : 0
}

/** `max(base, floor)` for the stage; a no-op when reasoning is not active. */
export function raisedOutputBudget(stage, reasoningActive, maxTokens) {
  const base = Number.isFinite(Number(maxTokens)) ? Math.trunc(Number(maxTokens)) : 0
  return Math.max(base, reasoningOutputFloor(stage, reasoningActive))
}

/** Default per-call timeout for a non-reasoning route. */
export const DEFAULT_CALL_TIMEOUT_MS = 90000
/** Default per-call timeout floor for a reasoning route (single-slot endpoints are slow). */
export const REASONING_CALL_TIMEOUT_MS = 180000

/**
 * Per-call timeout: an explicit configuration always wins; otherwise reasoning
 * routes get a wider floor because thinking tokens and single-slot queues make
 * 90s too tight.
 */
export function effectiveCallTimeout(configuredMs, reasoningActive) {
  const configured = Number(configuredMs)
  if (Number.isFinite(configured) && configured > 0) return Math.trunc(configured)
  return reasoningActive ? REASONING_CALL_TIMEOUT_MS : DEFAULT_CALL_TIMEOUT_MS
}
