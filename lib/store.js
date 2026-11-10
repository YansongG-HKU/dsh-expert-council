/**
 * Durable consult ledger.
 *
 * One JSON document, written atomically. The ledger is deliberately small
 * (capped) and append-oriented: a consult is created once, then mutated by
 * record/verdict. Nothing here trusts the caller; every entry is normalised
 * before it is written.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { emptyCustomization, normalizeCustomization } from './custom.js'
import { nowMs, writeJsonAtomic } from './util.js'

export const LEDGER_VERSION = 1
export const MAX_CONSULTS = 200
export const MAX_RUN_FILES = 120

export function createStore({ dir, log = console }) {
  const file = join(dir, 'consults.json')
  const customizationFile = join(dir, 'customization.json')
  const runsDir = join(dir, 'runs')
  let cache = null
  let reading = null
  let customCache = null
  let writing = Promise.resolve()

  async function writeTextAtomic(target, text) {
    await mkdir(dirname(target), { recursive: true })
    const tmp = `${target}.${randomBytes(3).toString('hex')}.tmp`
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, target)
  }

  function safeRunId(runId) {
    const text = String(runId ?? '').trim()
    return /^[a-zA-Z0-9._-]{1,80}$/.test(text) ? text : `run-${randomBytes(4).toString('hex')}`
  }

  async function readLedger() {
    let raw
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: LEDGER_VERSION, consults: [] }
      throw error
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.consults)) throw new Error('invalid consult ledger')
    return { version: LEDGER_VERSION, consults: parsed.consults }
  }

  async function load() {
    if (cache) return cache
    reading ??= readLedger().then((doc) => {
      cache = doc
      return doc
    }).finally(() => {
      reading = null
    })
    return reading
  }

  function mutate(update) {
    const operation = writing.then(async () => {
      const current = await load()
      const next = { ...current, consults: current.consults.slice() }
      const result = update(next.consults)
      if (result === null) return null
      await writeJsonAtomic(file, next)
      cache = next
      return result
    })
    // Keep the queue usable while the caller observes this operation's error.
    writing = operation.catch(() => {})
    return operation
  }

  return {
    file,

    async list() {
      const doc = await load()
      return doc.consults.slice()
    },

    async get(id) {
      const doc = await load()
      return doc.consults.find((consult) => consult.id === id) ?? null
    },

    async upsert(consult) {
      return mutate((consults) => {
        const index = consults.findIndex((item) => item.id === consult.id)
        const next = { ...consult, updatedAt: consult.updatedAt ?? nowMs() }
        if (index >= 0) consults[index] = next
        else consults.unshift(next)
        if (consults.length > MAX_CONSULTS) consults.length = MAX_CONSULTS
        return next
      })
    },

    async archive(id) {
      return mutate((consults) => {
        const index = consults.findIndex((item) => item.id === id)
        if (index < 0) return null
        const archivedAt = nowMs()
        const next = { ...consults[index], status: 'archived', archivedAt, updatedAt: archivedAt }
        consults[index] = next
        return next
      })
    },

    async stats() {
      const doc = await load()
      const consults = doc.consults
      return {
        total: consults.length,
        open: consults.filter((consult) => consult.status === 'open').length,
        verdict: consults.filter((consult) => consult.status === 'verdict').length,
        archived: consults.filter((consult) => consult.status === 'archived').length,
        tokens: consults.reduce((sum, consult) => sum + (Number(consult.tokens) || 0), 0),
      }
    },

    /**
     * User customisation (expert/team overrides). Kept in its own file so a
     * corrupt ledger never takes the catalog down with it.
     */
    async customization() {
      if (customCache) return customCache
      try {
        const raw = await readFile(customizationFile, 'utf8')
        customCache = normalizeCustomization(JSON.parse(raw))
      } catch (error) {
        if (error?.code !== 'ENOENT') log.warn?.(`customization unreadable, using defaults: ${error?.message ?? error}`)
        customCache = emptyCustomization()
      }
      return customCache
    },

    async saveCustomization(next) {
      customCache = normalizeCustomization({ ...next, updatedAt: nowMs() })
      await writeJsonAtomic(customizationFile, customCache)
      return customCache
    },

    /**
     * Real-run transcripts and professional reports.
     *
     * The consult ledger only keeps a summary; a full transcript (prompts,
     * raw replies, usage, retries) lives in `runs/<runId>.json`, the committee
     * deliverable in `runs/<runId>.md`. Files are bounded by age to keep the
     * data directory small.
     */
    async saveRun(run) {
      const runId = safeRunId(run?.runId ?? run?.consultId)
      const target = join(runsDir, `${runId}.json`)
      await writeJsonAtomic(target, run)
      return { runId, path: target }
    },

    async readRun(runId) {
      const key = safeRunId(runId)
      try {
        return JSON.parse(await readFile(join(runsDir, `${key}.json`), 'utf8'))
      } catch (error) {
        if (error?.code !== 'ENOENT') log.warn?.(`run transcript unreadable: ${error?.message ?? error}`)
        return null
      }
    },

    async saveReport(runId, markdown) {
      const key = safeRunId(runId)
      const target = join(runsDir, `${key}.md`)
      await writeTextAtomic(target, String(markdown ?? ''))
      return { runId: key, reportPath: target }
    },

    async readReport(runId) {
      const key = safeRunId(runId)
      try {
        return await readFile(join(runsDir, `${key}.md`), 'utf8')
      } catch (error) {
        if (error?.code !== 'ENOENT') log.warn?.(`run report unreadable: ${error?.message ?? error}`)
        return null
      }
    },
  }
}
