/**
 * Entry-point tests: the model tool, the slash command, and the loopback panel
 * route must all reach the same service and all fail without throwing.
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

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'expert-council-api-'))
  const store = createStore({ dir, log: { warn() {}, info() {} } })
  const service = createExpertCouncilService({ store, log: { warn() {}, info() {} } })
  return { service, dir, dispose: () => rm(dir, { recursive: true, force: true }) }
}

test('expert_council tool exposes teams, convenes, records and judges', async () => {
  const { service, dispose } = await setup()
  try {
    const tool = createExpertCouncilTool(service)
    assert.equal(tool.name, 'expert_council')
    assert.ok(tool.description.includes('lean'))
    assert.ok(tool.parameters.properties.action.enum.includes('verdict'))
    // dsh-tools rejects a definition without an output contract at registration
    // time; without this assertion a missing contract only shows up as a silent
    // "unknown tool" in a live session.
    assert.equal(tool.output?.schema?.type, 'object')
    assert.equal(typeof tool.output.render, 'function')
    const rendered = tool.output.render({}, { ok: true })
    assert.equal(rendered[0].type, 'text')
    assert.equal(JSON.parse(rendered[0].text).ok, true)

    const teams = await tool.execute({ action: 'teams' })
    assert.ok(teams.ok)
    assert.ok(teams.teams.length >= 8)
    assert.ok(teams.teams[0].members.length >= 3)

    const experts = await tool.execute({ action: 'experts' })
    assert.ok(experts.experts.length >= 12)

    const convened = await tool.execute({
      action: 'convene',
      team_id: 'code-review',
      question: '这次重构引入的抽象是否值得？',
      mode: 'lean',
      explicit_request: true,
      request_quote: '用专家团评审一下这次重构的抽象是否值得',
    })
    assert.ok(convened.consultId)
    assert.ok(convened.brief.includes(convened.consultId))
    assert.equal(convened.consent.kind, 'explicit-request')

    const recorded = await tool.execute({
      action: 'record',
      id: convened.consultId,
      opinions: [
        {
          expert: 'architect',
          stance: 'conditional',
          confidence: 0.6,
          claims: [{ claim: '抽象值得，但需要两个实现', evidence: 'src/export.js:40' }],
        },
      ],
    })
    assert.ok(recorded.ok)
    assert.equal(recorded.round, 1)

    const judged = await tool.execute({
      action: 'verdict',
      id: convened.consultId,
      decision: '有条件合并',
      confidence: 0.7,
      rationale: '抽象只有一个实现时是负担，补第二个实现后再合并',
      unresolved: ['第二个实现的时机'],
      reversal_triggers: ['发现第二个实现短期不会出现'],
      next_actions: ['架构师：两周内确认第二个实现计划'],
    })
    assert.ok(judged.ok)
    assert.equal(judged.consultId, convened.consultId)

    const got = await tool.execute({ action: 'get', id: convened.consultId })
    assert.equal(got.consult.status, 'verdict')
    assert.ok(got.consult.verdict)

    const unknown = await tool.execute({ action: 'nope' })
    assert.equal(unknown.ok, false)
    assert.match(unknown.error, /未知操作/)
  } finally {
    await dispose()
  }
})

test('the /experts command lists teams, shows a team, and convenes a consult', async () => {
  const { service, dispose } = await setup()
  try {
    const command = createExpertsCommand(service)
    assert.equal(command.name, 'experts')

    const list = await command.handler({ rawInput: '' })
    assert.equal(list.kind, 'success')
    assert.ok(list.text.includes('architecture'))

    const detail = await command.handler({ rawInput: 'architecture' })
    assert.ok(detail.text.includes('架构评审团'))
    assert.ok(detail.text.includes('议程'))

    const convened = await command.handler({ rawInput: 'security-review 上线前的凭据管理是否有硬伤？' })
    assert.equal(convened.kind, 'success')
    assert.match(convened.text, /^已由你立案：\*\*ec-/)
    assert.ok(convened.text.includes('会诊简报'))
    assert.ok(convened.text.includes('expert_council'), 'command output must carry the next-step tool hint')

    const unknown = await command.handler({ rawInput: 'nope 这是一个问题' })
    assert.equal(unknown.kind, 'error')
    assert.match(unknown.text, /未知团队/)

    const experts = await command.handler({ rawInput: 'experts' })
    assert.ok(experts.text.includes('架构师'))
  } finally {
    await dispose()
  }
})

function fakeWebServer(port = 43123) {
  return { port, protocol: 'http:', register: () => () => {} }
}

function fakeRequest({ method = 'GET', url = '/', headers = {}, body = null }) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:43123', 'x-expert-council': '1', ...headers }
  process.nextTick(() => {
    if (body !== null) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
  return req
}

function fakeResponse() {
  const res = new EventEmitter()
  res.statusCode = 0
  res.headers = {}
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

test('the panel route answers state, rejects bad headers, and convenes', async () => {
  const { service, dispose } = await setup()
  try {
    let handler = null
    const webServer = {
      port: 43123,
      protocol: 'http:',
      register: (spec) => {
        handler = spec.handler
        return () => {}
      },
    }
    const ctx = { inject: (_deps, callback) => callback({ webServer, effect: (fn) => fn() }) }
    registerPanel(ctx, { service, log: { warn() {}, info() {} } })
    assert.equal(typeof handler, 'function')

    async function request({ method = 'GET', url = '/expert-council/api/state', headers = {}, body = null }) {
      const req = fakeRequest({ method, url, headers, body })
      const res = fakeResponse()
      handler(req, res)
      await Promise.race([res.done, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('panel timeout')), 2000))])
      return res
    }

    const state = await request({})
    assert.equal(state.statusCode, 200)
    const stateBody = JSON.parse(state.body)
    assert.ok(stateBody.ok)
    assert.ok(stateBody.teams.length >= 8)
    assert.ok(stateBody.protocol.rules.length === 7)
    assert.ok(stateBody.stats)

    const denied = await request({ headers: { 'x-expert-council': '0' } })
    assert.equal(denied.statusCode, 403)

    const convened = await request({
      method: 'POST',
      url: '/expert-council/api/action',
      body: { action: 'convene', teamId: 'product-decision', question: '要不要现在做离线模式？' },
    })
    const convenedBody = JSON.parse(convened.body)
    assert.ok(convenedBody.ok, convenedBody.error)
    assert.match(convenedBody.consultId, /^ec-/)

    const bad = await request({ method: 'POST', url: '/expert-council/api/action', body: { action: 'nope' } })
    assert.equal(bad.statusCode, 404)
  } finally {
    await dispose()
  }
})
