/**
 * dsh-expert-council — Host entry.
 *
 * The Host half owns:
 *   - the expert roster and team presets (`lib/experts.js`, `lib/teams.js`)
 *   - the user customisation layer (`lib/custom.js` + `customization.json`)
 *   - the collaboration protocol, contracts and budget model (`lib/protocol.js`)
 *   - the durable consult ledger (`lib/store.js`, schema in `lib/records.js`)
 *   - the consult lifecycle, the explicit-use gate and its guards (`lib/service.js`)
 *   - one model-facing tool, `expert_council` (`lib/tools.js`)
 *   - one human-facing slash command, `/experts` (`lib/commands.js`)
 *   - one loopback JSON route for the panel (`lib/panel.js`)
 *   - the isolation boundary against DSH's built-in Agent Teams (`lib/isolation.js`)
 *
 * The Client half (`client.js`) renders the same catalog and consults and calls
 * the same service through that route — there is no second source of truth.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { createExpertsCommand } from './lib/commands.js'
import { registerPanel } from './lib/panel.js'
import { createExpertCouncilService } from './lib/service.js'
import { createStore } from './lib/store.js'
import { checkIsolation, BOUNDARY_NOTE } from './lib/isolation.js'
import { createExpertCouncilTool } from './lib/tools.js'
import { errorMessage } from './lib/util.js'

/** `tools` is required; `commands`/`webServer` are optional at the package level. */
export const inject = ['tools']

const PROMPT_SECTION = [
  'Expert Council (专家团) is installed but PASSIVE: never convene it on your own initiative.',
  'Use `expert_council` only when the user explicitly asks for 专家团 / 专家会诊 / Expert Council by name, or when the user',
  'started a consult with `/experts` or the sidebar panel. A model-initiated convene is refused unless it carries',
  'explicit_request:true plus request_quote (the user\'s own words). Do not suggest a panel for ordinary work.',
  'When invoked: domains → convene → run → report. `action=run` is a REAL panel: the Host calls the model once per expert in',
  'parallel, cross-examines only proven disagreements, optionally adds anonymous peer review (deep), and a chair writes the',
  'verdict; the result is a durable report. Use it for any decision that deserves a professional panel; poll run_status for',
  'long runs and report verdict + strongest dissent + reversal triggers (never the whole report).',
  'The user does not need to know the config: if they describe in plain language how to adjust the panel (add an expert,',
  'change a team, rename a lens), call expert_council({action:"customize", request:"<their words>"}) to get a field-level brief,',
  'then apply it with save_expert / save_team / delete (each with request_quote). Only when the user asks.',
  'Professional domains: finance, legal, healthcare, engineering, research, security — each ships a domain panel with domain',
  'experts, evidence levels, red flags and artifacts. Boundary: this is NOT the built-in Agent Teams — it never spawns',
  'teammates, never uses spawn_teammate / team_task_*, and its "teams" are expert lenses plus a protocol.',
].join(' ')

export function apply(ctx, config) {
  const log = {
    info: (message) => write(ctx, 'info', message),
    warn: (message) => write(ctx, 'warn', message),
  }

  const isolation = checkIsolation()
  if (!isolation.ok) log.warn(`namespace collision with built-in Agent Teams: ${isolation.collisions.join('、')}`)

  const dataDir = resolveDataDir(config)
  const store = createStore({ dir: dataDir, log })
  const service = createExpertCouncilService({
    store,
    log,
    ctx,
    config: {
      requireExplicitConsent: config?.requireExplicitConsent !== false,
      ...(config?.run && typeof config.run === 'object' ? config.run : {}),
    },
  })

  // Model-facing tool. Failure must not stop the rest of the plugin from mounting.
  try {
    ctx.effect(() => ctx.tools.register(createExpertCouncilTool(service)), 'dsh-expert-council: expert_council tool')
  } catch (error) {
    log.warn(`could not register expert_council: ${errorMessage(error)}`)
  }

  // Passive prompt section: discoverable, but explicitly not self-invoked.
  try {
    if (typeof ctx.systemPrompt?.section === 'function') {
      ctx.effect(
        () =>
          ctx.systemPrompt.section({
            name: 'dsh-expert-council',
            order: 9150,
            interpolate: false,
            text: () => PROMPT_SECTION,
          }),
        'dsh-expert-council: prompt section',
      )
    }
  } catch (error) {
    log.warn(`could not register the prompt section: ${errorMessage(error)}`)
  }

  // Human-facing command; headless profiles without a command registry stay valid.
  try {
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.effect(
        () => commandCtx.commands.register(createExpertsCommand(service)),
        'dsh-expert-council: /experts command',
      )
    })
  } catch (error) {
    log.warn(`could not register /experts: ${errorMessage(error)}`)
  }

  // Web panel route; profiles without a web server stay valid.
  try {
    registerPanel(ctx, { service, log })
  } catch (error) {
    log.warn(`could not register the panel route: ${errorMessage(error)}`)
  }

  log.info(`active: consult ledger at ${dataDir}; boundary=${isolation.ok ? 'isolated' : 'collision'}; ${BOUNDARY_NOTE}`)
}

function resolveDataDir(config) {
  if (typeof config?.dataDir === 'string' && config.dataDir.trim().length > 0) return config.dataDir.trim()
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'expert-council')
}

function write(ctx, level, message) {
  try {
    const logger = ctx.logger
    if (typeof logger?.[level] === 'function') logger[level](`[dsh-expert-council] ${message}`)
  } catch {
    /* logging must never break mounting */
  }
}
