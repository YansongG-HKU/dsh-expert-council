import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createStore } from '../lib/store.js'

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'council-ledger-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return { dir, store: createStore({ dir }) }
}

test('all simultaneous cold writes survive reopening the ledger', async (t) => {
  const { dir, store } = await setup(t)
  const ids = Array.from({ length: 20 }, (_, i) => `consult-${i}`)
  await Promise.all(ids.map((id) => store.upsert({ id, status: 'open' })))
  const reopened = createStore({ dir })
  assert.deepEqual(new Set((await reopened.list()).map(({ id }) => id)), new Set(ids))
})

test('a failed commit rejects, retains the last committed cache, and allows retry', async (t) => {
  const { dir, store } = await setup(t)
  await store.upsert({ id: 'existing', status: 'open' })
  await rm(store.file)
  await mkdir(store.file)
  await assert.rejects(store.archive('existing'))
  assert.equal((await store.get('existing')).status, 'open')
  assert.deepEqual(await readdir(dir), ['consults.json'])
  await rm(store.file, { recursive: true })
  await store.archive('existing')
  assert.equal((await createStore({ dir }).get('existing')).status, 'archived')
})

test('an unreadable ledger is preserved until repaired', async (t) => {
  const { store } = await setup(t)
  await writeFile(store.file, '{invalid')
  await assert.rejects(store.upsert({ id: 'new' }), SyntaxError)
  await writeFile(store.file, '{"consults":[{"id":"recovered"}]}')
  await store.upsert({ id: 'new' })
  assert.deepEqual((await store.list()).map(({ id }) => id), ['new', 'recovered'])
})
