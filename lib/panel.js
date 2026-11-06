/**
 * The panel's HTTP surface — one loopback, same-origin, JSON-only route.
 *
 * The Client half is the only intended caller: it sends `x-expert-council: 1`
 * and the Host header must name this process's own port. Mutations are POSTs
 * with a JSON body. No handler throws into the web server: a bad request is a
 * 4xx/`{ok:false,error}` instead of a stack trace.
 */

import { errorMessage } from './util.js'

const ROUTE_PREFIX = '/expert-council'
const STATE_PATH = `${ROUTE_PREFIX}/api/state`
const CONSULT_PATH = `${ROUTE_PREFIX}/api/consult`
const REPORT_PATH = `${ROUTE_PREFIX}/api/report`
const ACTION_PATH = `${ROUTE_PREFIX}/api/action`
const REQUEST_HEADER = 'x-expert-council'
const MAX_BODY_BYTES = 1024 * 1024
const PANEL_ACTIONS = new Set([
  'convene',
  'archive',
  'run',
  'cancel-run',
  'save-team',
  'save-expert',
  'delete',
  'reset-custom',
  'nl-request',
])

export function registerPanel(ctx, { service, log }) {
  return ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.webServer
    webCtx.effect(
      () =>
        webServer.register({
          kind: 'prefix',
          path: ROUTE_PREFIX,
          handler: (req, res) => {
            void handleRequest(webCtx, service, req, res, log)
          },
        }),
      'dsh-expert-council: panel route',
    )
  })
}

function sameOrigin(webServer, req) {
  const headers = req.headers ?? {}
  const host = headers.host
  const port = webServer.port
  if (typeof host !== 'string' || port === undefined) return false
  const expected = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]
  if (!expected.includes(host)) return false
  if (headers[REQUEST_HEADER] !== '1') return false
  const origin = headers.origin
  if (origin === undefined) return true
  const protocol = typeof webServer.protocol === 'string' ? webServer.protocol : 'http:'
  return origin === `${protocol}//${host}`
}

async function handleRequest(webCtx, service, req, res, log) {
  try {
    if (!sameOrigin(webCtx.webServer, req)) {
      sendJson(res, 403, { ok: false, error: 'Same-origin expert-council request required' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const method = req.method ?? 'GET'
    if (url.pathname === STATE_PATH && (method === 'GET' || method === 'HEAD')) {
      sendJson(res, 200, await service.state())
      return
    }
    if (url.pathname === CONSULT_PATH && (method === 'GET' || method === 'HEAD')) {
      const id = url.searchParams.get('id') ?? ''
      sendJson(res, 200, await service.get(id))
      return
    }
    if (url.pathname === REPORT_PATH && (method === 'GET' || method === 'HEAD')) {
      const id = url.searchParams.get('id') ?? ''
      const result = await service.report(id)
      sendText(res, 200, result.markdown, method === 'HEAD')
      return
    }
    if (url.pathname === ACTION_PATH && method === 'POST') {
      const body = await readJsonBody(req)
      const action = typeof body?.action === 'string' ? body.action : ''
      if (!PANEL_ACTIONS.has(action)) {
        sendJson(res, 404, { ok: false, error: `未知操作：${action || '（空）'}` })
        return
      }
      if (action === 'convene') {
        const result = await service.convene({
          teamId: body.teamId,
          domain: body.domainId ?? body.domain ?? null,
          question: body.question,
          context: body.context ?? null,
          mode: body.mode ?? null,
          budgetCap: body.budgetCap ?? null,
          sessionId: body.sessionId ?? null,
          actor: 'user',
          via: 'panel',
        })
        sendJson(res, 200, result)
        return
      }
      if (action === 'run') {
        sendJson(res, 200, await service.run(body.id, { wait: false, maxParallel: body.maxParallel }))
        return
      }
      if (action === 'cancel-run') {
        sendJson(res, 200, await service.cancelRun(body.id))
        return
      }
      if (action === 'nl-request') {
        // Plain-language customisation: the panel hands the user's sentence to
        // the model via a brief; nothing is mutated here.
        sendJson(res, 200, await service.customizationBrief({ request: body.text }))
        return
      }
      if (action === 'save-team') {
        sendJson(res, 200, await service.saveTeam(body.team, { actor: 'user', requestQuote: body.requestQuote ?? null }))
        return
      }
      if (action === 'save-expert') {
        sendJson(res, 200, await service.saveExpert(body.expert, { actor: 'user', requestQuote: body.requestQuote ?? null }))
        return
      }
      if (action === 'delete') {
        sendJson(res, 200, await service.deleteEntity(body.kind, body.id, { actor: 'user', requestQuote: body.requestQuote ?? null }))
        return
      }
      if (action === 'reset-custom') {
        sendJson(
          res,
          200,
          await service.resetCustomization({ confirm: body.confirm === true, actor: 'user', requestQuote: body.requestQuote ?? null }),
        )
        return
      }
      sendJson(res, 200, await service.archive(body.id))
      return
    }
    if (url.pathname === ACTION_PATH) {
      sendJson(res, 405, { ok: false, error: `Method ${method} is not allowed` })
      return
    }
    sendJson(res, 404, { ok: false, error: 'Unknown expert-council route' })
  } catch (error) {
    const message = errorMessage(error)
    try {
      log?.warn?.(`panel request failed: ${message}`)
    } catch {
      /* ignore */
    }
    try {
      sendJson(res, 200, { ok: false, error: message })
    } catch {
      /* the response may already be gone */
    }
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new Error(`请求体不是合法 JSON：${errorMessage(error)}`))
      }
    })
    req.on('error', (error) => reject(error))
  })
}

function sendJson(res, status, value) {
  if (res.headersSent || res.writableEnded) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value === undefined ? {} : value))
}

function sendText(res, status, text, headOnly = false) {
  if (res.headersSent || res.writableEnded) return
  res.writeHead(status, {
    'content-type': 'text/markdown; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  if (headOnly) {
    res.end()
    return
  }
  res.end(String(text ?? ''))
}
