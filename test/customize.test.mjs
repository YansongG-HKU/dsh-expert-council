/**
 * The "describe it, don't configure it" path: a plain-language request becomes
 * a field-level brief, the model applies it through the same guarded service,
 * and every change is recorded with the user's own words.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../lib/store.js'
import { createExpertCouncilService } from '../lib/service.js'
import { createExpertCouncilTool } from '../lib/tools.js'
import { createExpertsCommand } from '../lib/commands.js'
import { registerPanel } from '../lib/panel.js'

const quiet = { warn() {}, info() {} }

async function makeService() {
  const dir = await mkdtemp(join(tmpdir(), 'expert-council-nl-'))
  const store = createStore({ dir, log: quiet })
  const service = createExpertCouncilService({ store, log: quiet })
  return { service, store, dir, dispose: () => rm(dir, { recursive: true, force: true }) }
}

const EXPERT = {
  id: 'privacy-officer',
  name: { zh: '数据合规官', en: 'Privacy Officer' },
  group: 'risk',
  mandate: '只审数据授权链与最小权限，拒绝说不清来源的数据。',
  lens: '数据来源、授权与最小权限',
  asks: ['数据从哪来？授权链完整吗？', '真的需要这么多权限吗？'],
  redLines: ['无授权的数据使用'],
  misses: '产品节奏',
  budget: { standard: 150, deep: 220 },
}

test('customize turns a plain-language sentence into a safe field-level brief', async () => {
  const { service, dispose } = await makeService()
  try {
    await assert.rejects(() => service.customizationBrief({ request: ' ' }), /自然语言/)
    const result = await service.customizationBrief({ request: '加一个只看数据授权的合规专家' })
    assert.equal(result.ok, true)
    assert.ok(result.brief.includes('加一个只看数据授权的合规专家'))
    assert.ok(result.brief.includes('save_expert'))
    assert.ok(result.brief.includes('save_team'))
    assert.ok(result.brief.includes('delete'))
    assert.ok(result.brief.includes('reset'))
    assert.ok(result.brief.includes('request_quote'))
    assert.ok(result.brief.includes('字段速查'))
    assert.ok(result.brief.includes('architect'), 'current catalog is included')
    assert.ok(result.brief.includes('原话 → 调用'), 'worked examples are included')
    assert.ok(result.expertCount >= 14 && result.teamCount >= 8)
  } finally {
    await dispose()
  }
})

test('model-side catalogue writes require the user\'s own words; user actions do not', async () => {
  const { service, dispose } = await makeService()
  try {
    await assert.rejects(
      () => service.saveExpert(EXPERT, { actor: 'agent' }),
      /需要你的原话/,
    )
    const saved = await service.saveExpert(EXPERT, { actor: 'agent', requestQuote: '加一个只看数据授权的合规专家' })
    assert.equal(saved.ok, true)
    assert.equal(saved.expert.custom, true)
    const state = await service.customization()
    assert.equal(state.history[0].action, 'expert-create')
    assert.equal(state.history[0].request, '加一个只看数据授权的合规专家')
    assert.equal(state.history[0].actor, 'agent')

    // A user/panel action needs no quote but is still audited as a user action.
    await service.saveTeam(
      { id: 'privacy-check', name: { zh: '数据合规检查团' }, members: [{ id: 'privacy-officer', role: 'lead' }], agenda: ['授权链完整吗？'] },
      { actor: 'user' },
    )
    const after = await service.customization()
    assert.equal(after.history[0].action, 'team-create')
    assert.equal(after.history[0].actor, 'user')
    assert.equal(after.history[0].request, null)
  } finally {
    await dispose()
  }
})

test('history records delete and reset, newest first, bounded', async () => {
  const { service, dispose } = await makeService()
  try {
    await service.saveExpert(EXPERT, { actor: 'user', requestQuote: '加一个合规专家' })
    const deleted = await service.deleteEntity('expert', 'privacy-officer', { actor: 'user', requestQuote: '这个专家不要了' })
    assert.equal(deleted.ok, true)
    assert.deepEqual(deleted.customization.hiddenExperts, [], 'a custom-only expert is removed, not added to the hidden presets list')
    let history = (await service.customization()).history
    assert.equal(history[0].action, 'expert-delete')
    assert.equal(history[0].request, '这个专家不要了')
    await service.resetCustomization({ confirm: true, actor: 'user', requestQuote: '恢复原样' })
    history = (await service.customization()).history
    assert.equal(history[0].action, 'reset')
    assert.equal(history[0].request, '恢复原样')
    assert.equal(history.length, 1, 'reset keeps the reset entry as the fresh history')
  } finally {
    await dispose()
  }
})

test('the tool exposes customize and passes the quote to guarded writes', async () => {
  const { service, dispose } = await makeService()
  try {
    const tool = createExpertCouncilTool(service)
    assert.ok(tool.parameters.properties.action.enum.includes('customize'))
    const brief = await tool.execute({ action: 'customize', request: '把代码评审团默认改成标准会诊' })
    assert.equal(brief.ok, true)
    assert.ok(brief.brief.includes('代码评审团默认改成标准会诊'))

    await assert.rejects(
      () => tool.execute({ action: 'save_expert', expert: EXPERT }),
      /需要你的原话/,
    )
    const saved = await tool.execute({
      action: 'save_expert',
      expert: EXPERT,
      request_quote: '加一个只看数据授权的合规专家',
    })
    assert.equal(saved.ok, true)
    const customization = await tool.execute({ action: 'customization' })
    assert.equal(customization.customization.history[0].action, 'expert-create')
  } finally {
    await dispose()
  }
})

test('/experts 调整 returns the brief but does not mutate', async () => {
  const { service, dispose } = await makeService()
  try {
    const command = createExpertsCommand(service)
    const help = await command.handler({ rawInput: '调整' })
    assert.equal(help.kind, 'error')
    assert.ok(help.text.includes('/experts 调整'))

    const result = await command.handler({ rawInput: '调整 加一个上线前检查团，SRE 主持' })
    assert.equal(result.kind, 'success')
    assert.ok(result.text.includes('自然语言调整简报'))
    assert.ok(result.text.includes('save_team'))
    const customization = await service.customization()
    assert.deepEqual(customization.customTeams, [])
  } finally {
    await dispose()
  }
})

function fakeRequest({ method = 'GET', url = '/', headers = {}, body = null }) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:43124', 'x-expert-council': '1', ...headers }
  process.nextTick(() => {
    if (body !== null) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
  return req
}

function fakeResponse() {
  const res = new EventEmitter()
  res.statusCode = 0
  res.headersSent = false
  res.writableEnded = false
  res.writeHead = (status, headers) => {
    res.statusCode = status
    res.headers = headers
    res.headersSent = true
    return res
  }
  res.done = new Promise((resolve) => {
    res._resolve = resolve
  })
  res.end = (payload = '') => {
    res.writableEnded = true
    res.body = payload
    res._resolve(res)
  }
  return res
}

test('panel nl-request returns a brief and never writes the catalogue', async () => {
  const { service, dispose } = await makeService()
  try {
    let handler = null
    const webServer = {
      port: 43124,
      protocol: 'http:',
      register: (spec) => {
        handler = spec.handler
        return () => {}
      },
    }
    const ctx = { inject: (_deps, callback) => callback({ webServer, effect: (fn) => fn() }) }
    registerPanel(ctx, { service, log: quiet })
    assert.equal(typeof handler, 'function')

    async function request({ method = 'GET', url = '/expert-council/api/state', body = null }) {
      const res = fakeResponse()
      handler(fakeRequest({ method, url, body }), res)
      await Promise.race([
        res.done,
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('panel timeout')), 2000)),
      ])
      return res
    }

    const nl = await request({
      method: 'POST',
      url: '/expert-council/api/action',
      body: { action: 'nl-request', text: '把安全评审团改成三个人：安全、合规、质疑者' },
    })
    const payload = JSON.parse(nl.body)
    assert.equal(payload.ok, true)
    assert.ok(payload.brief.includes('安全评审团改成三个人'))
    const customization = await service.customization()
    assert.deepEqual(customization.customTeams, [])
    assert.deepEqual(customization.customExperts, [])
  } finally {
    await dispose()
  }
})
