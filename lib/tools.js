/**
 * `expert_council` — the model-facing half of the plugin.
 *
 * One tool, one lifecycle. The description carries the operating manual and a
 * hard token-discipline rule: lean first, only escalate when the decision is
 * expensive to get wrong. Action results carry the next step so a small model
 * cannot get lost between stages.
 */

import { DEFAULT_MODE, MODES } from './protocol.js'
import { summarizeConsult } from './records.js'

const DESCRIPTION = [
  'USER-GATED EXPERT PANEL — do not use it on your own initiative.',
  '',
  'Only call this tool when the user explicitly asks for it: they name it (专家团 / 专家会诊 / Expert Council), use the `/experts`',
  'command, or start a consult from the sidebar panel. Do not volunteer a panel for general work, do not use it to "add value",',
  'and never call it just because a decision looks important. If the user did not explicitly ask, do nothing.',
  '',
  'This is NOT the built-in DSH Agent Teams. It never spawns teammates, never calls spawn_teammate / team_task_* / send_message,',
  'and never touches agent-team state. A "team" here is a set of expert lenses plus a protocol, evaluated by the calling model.',
  '',
  'The panel is not N chatbots. Independent opinions first, evidence required, cross-examination only on proven disagreement,',
  'a chair who must answer every dissent, explicit reversal triggers, and a durable consult ledger. Each expert is a lens with a',
  'fixed mandate, must-ask questions, red lines, and known blind spots; the brief only loads the lenses of the chosen team.',
  '',
  'Lifecycle — write each stage back before moving on:',
  '1. teams / experts: list presets and the user\'s custom entries. Read-only; call once per task, not per step.',
  '2. convene: team_id + question (+ context, mode, budget_cap). A model-initiated convene MUST carry explicit_request:true and',
  '   request_quote (the user\'s own words); otherwise it is refused. Returns a compact brief: agenda, protocol, lens cards,',
  '   contracts and budget. Follow that brief; do not re-derive the protocol.',
  '3. record: id + opinions[] (expert id, stance support|oppose|conditional, confidence 0–1, claims[] with evidence, changes,',
  '   unknowns). The tool normalises, counts tokens, and computes real disagreements (current round only).',
  '4. verdict: id + decision, confidence, rationale, dissent[], unresolved[], reversalTriggers[], next_actions[]. In standard/deep',
  '   mode a verdict without recorded opinions is rejected; a verdict that ignores a proven disagreement is rejected unless force.',
  '5. get/list: re-check before reporting; archive when the decision is superseded.',
  '',
  'Customisation (only when the user asks to adjust the panel): customize hands a plain-language request back as a field-level brief',
  '(current catalogue + allowed actions + rules), so a user who does not know the config can just describe what they want. Then save_expert /',
  'save_team create or override one entry (presets are code, overrides are data; a preset override keeps its id and marks custom:true);',
  'delete hides a preset or removes a custom entry; reset restores the shipped catalog (requires confirm:true). Every model-side catalogue',
  'write needs request_quote (the user\'s own words). A team needs existing experts and exactly one chair.',
  '',
  'Token discipline: prefer mode=lean for routine checks; standard when the user wants a real review; deep only for irreversible',
  'decisions. Never paste the whole brief back; report verdict, strongest dissent and reversal triggers.',
].join('\n')

const ACTIONS = [
  'teams',
  'experts',
  'convene',
  'record',
  'verdict',
  'get',
  'list',
  'archive',
  'save_expert',
  'save_team',
  'delete',
  'reset',
  'customization',
  'customize',
]

/**
 * dsh-tools requires every definition to declare an output contract; a tool
 * without one is rejected at registration time (silently, if the caller catches
 * the error). Keep this next to the definition so the contract cannot rot.
 */
const OUTPUT = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

const OPINION_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    expert: { type: 'string', description: 'lens id from the team, e.g. architect' },
    stance: { type: 'string', enum: ['support', 'oppose', 'conditional'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          claim: { type: 'string' },
          evidence: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    changes: { type: 'string', description: 'what evidence would flip this opinion' },
    unknowns: { type: 'array', items: { type: 'string' } },
  },
}

const PARAMETERS = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ACTIONS, description: 'Lifecycle stage to run.' },
    id: { type: 'string', description: 'Consult id (ec-…). Required for record/verdict/get/archive.' },
    team_id: { type: 'string', description: 'convene: team preset id from action=teams.' },
    question: { type: 'string', description: 'convene: the decision/review question, one clear paragraph.' },
    context: { type: 'string', description: 'convene: optional background, constraints, links, pasted evidence.' },
    mode: { type: 'string', enum: MODES.map((mode) => mode.id), description: 'convene: depth; defaults to the team default.' },
    budget_cap: { type: 'integer', description: 'convene: override the whole-consult token cap (200–20000).' },
    round: { type: 'integer', description: 'record: round number; defaults to next round.' },
    opinions: { type: 'array', items: OPINION_SCHEMA, description: 'record: one opinion per expert.' },
    decision: { type: 'string', description: 'verdict: 做 / 不做 / 有条件做（写清条件）.' },
    confidence: { type: 'number', minimum: 0, maximum: 1, description: 'verdict: calibrated confidence.' },
    rationale: { type: 'string', description: 'verdict: why, mapped to evidence.' },
    dissent: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          expert: { type: 'string' },
          point: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
      description: 'verdict: minority opinions that must be answered.',
    },
    unresolved: { type: 'array', items: { type: 'string' }, description: 'verdict: what is still unknown.' },
    reversal_triggers: { type: 'array', items: { type: 'string' }, description: 'verdict: evidence that would overturn this decision.' },
    next_actions: { type: 'array', items: { type: 'string' }, description: 'verdict: owner + action + deadline.' },
    note: { type: 'string', description: 'record/archive: short note.' },
    force: { type: 'boolean', description: 'verdict: override the dissent gate only with a written reason.' },
    explicit_request: {
      type: 'boolean',
      description:
        'convene: set true only when the user explicitly asked for the panel (named 专家团 / Expert Council). Model-initiated convenes are refused without it.',
    },
    request_quote: {
      type: 'string',
      description: 'convene: the user\'s own words that asked for the panel; stored in the consult ledger as consent evidence.',
    },
    expert: {
      type: 'object',
      additionalProperties: true,
      description:
        'save_expert: {id, name:{zh,en}, group, mandate, lens, asks[], redLines[], misses, pairs[], budget:{standard,deep}}. Reusing a preset id overrides it.',
    },
    team: {
      type: 'object',
      additionalProperties: true,
      description:
        'save_team: {id, name:{zh,en}, tagline, intent, defaultMode, members:[{id,role}], agenda[], artifacts[], budget:{lean,standard,deep}}. Reusing a preset id overrides it.',
    },
    kind: {
      type: 'string',
      enum: ['expert', 'team'],
      description: 'delete: which catalogue entry to remove (a preset is hidden, a custom entry is deleted).',
    },
    confirm: { type: 'boolean', description: 'reset: must be true to wipe all custom experts/teams.' },
    request: {
      type: 'string',
      description:
        'customize: the user\'s plain-language request, e.g. "加一个只看数据授权的合规专家" or "建一个上线前检查团：SRE 主持，产品和安全参加".',
    },
    limit: { type: 'integer', description: 'list: max rows (default 20).' },
  },
  required: ['action'],
}

function compactConsult(consult) {
  return {
    id: consult.id,
    teamId: consult.teamId,
    mode: consult.mode,
    status: consult.status,
    question: consult.question,
    context: consult.context,
    budget: consult.budget,
    tokens: consult.tokens,
    rounds: consult.rounds.map((round) => ({
      round: round.round,
      tokens: round.tokens,
      opinions: round.opinions.map((opinion) => ({
        expert: opinion.expert,
        stance: opinion.stance,
        confidence: opinion.confidence,
        claims: opinion.claims,
        changes: opinion.changes,
        unknowns: opinion.unknowns,
      })),
    })),
    disagreements: consult.disagreements,
    verdict: consult.verdict,
    createdAt: consult.createdAt,
    updatedAt: consult.updatedAt,
  }
}

export function createExpertCouncilTool(service) {
  return {
    name: 'expert_council',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: OUTPUT,
    execute: async (args) => {
      const action = String(args?.action ?? '')
      switch (action) {
        case 'teams': {
          const teams = await service.teams()
          return {
            ok: true,
            teams: teams.map((team) => ({
              id: team.id,
              name: team.name,
              tagline: team.tagline,
              intent: team.intent,
              defaultMode: team.defaultMode,
              custom: team.custom === true,
              preset: team.preset === true,
              incomplete: team.incomplete === true,
              members: team.members.map((member) => ({ id: member.id, role: member.role, name: member.name.zh })),
              estimates: team.estimates,
            })),
            next: 'Pick a team, then action=convene with team_id + question (lean first) and, unless the user ran /experts or the panel, explicit_request:true + request_quote.',
          }
        }
        case 'experts': {
          const experts = await service.experts()
          return {
            ok: true,
            experts: experts.map((expert) => ({
              id: expert.id,
              name: expert.name.zh,
              group: expert.group,
              mandate: expert.mandate,
              redLines: expert.redLines,
              custom: expert.custom === true,
              preset: expert.preset === true,
            })),
            next: 'Teams are compositions of these lenses; action=teams to see presets. Adjust them only when the user asks (save_expert / save_team).',
          }
        }
        case 'convene': {
          return service.convene({
            teamId: args.team_id,
            question: args.question,
            context: args.context,
            mode: args.mode ?? null,
            budgetCap: args.budget_cap ?? null,
            explicitRequest: args.explicit_request === true,
            requestQuote: args.request_quote ?? null,
            actor: 'agent',
          })
        }
        case 'record': {
          return service.record({ id: args.id, round: args.round, opinions: args.opinions, note: args.note })
        }
        case 'verdict': {
          return service.verdict({
            id: args.id,
            decision: args.decision,
            confidence: args.confidence,
            rationale: args.rationale,
            dissent: args.dissent,
            unresolved: args.unresolved,
            reversalTriggers: args.reversal_triggers,
            actions: args.next_actions,
            force: args.force === true,
          })
        }
        case 'get': {
          const result = await service.get(args.id)
          return { ok: true, consult: compactConsult(result.consult), team: result.team , next: 'Report verdict + strongest dissent; archive when superseded.' }
        }
        case 'list': {
          const consults = await service.list()
          return { ok: true, consults: consults.slice(0, Math.max(1, Math.min(100, Number(args.limit) || 20))) }
        }
        case 'archive': {
          const result = await service.archive(args.id)
          return { ...result, next: 'Archived. Start a new consult if the decision is revisited.' }
        }
        case 'customization': {
          const [customization, policy] = [await service.customization(), service.policy()]
          return {
            ok: true,
            customization,
            policy,
            next: 'Edit only when the user asks: customize (plain-language brief) → save_expert / save_team / delete / reset (confirm:true), each with request_quote.',
          }
        }
        case 'customize': {
          return service.customizationBrief({ request: args.request ?? args.request_quote })
        }
        case 'save_expert': {
          return service.saveExpert(args.expert, { actor: 'agent', requestQuote: args.request_quote })
        }
        case 'save_team': {
          return service.saveTeam(args.team, { actor: 'agent', requestQuote: args.request_quote })
        }
        case 'delete': {
          return service.deleteEntity(args.kind, args.id, { actor: 'agent', requestQuote: args.request_quote })
        }
        case 'reset': {
          return service.resetCustomization({ confirm: args.confirm === true, actor: 'agent', requestQuote: args.request_quote })
        }
        default:
          return { ok: false, error: `未知操作：${action || '（空）'}；可用：${ACTIONS.join('、')}` }
      }
    },
  }
}

export { DEFAULT_MODE, summarizeConsult }
