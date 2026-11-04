/**
 * Isolation boundary against DSH's built-in Agent Teams.
 *
 * Expert Council is a *protocol layer over lenses*, not an agent orchestrator:
 * it never spawns teammates, never calls `team_task_*` / `spawn_teammate`, and
 * keeps its own tool, command, panel id, data directory and id prefix. This
 * module is the single place that names those identifiers, so tests and the
 * prompt can assert the boundary instead of re-stating it in prose.
 */

/** Names that belong to the built-in Agent Teams surface; we must never squat on them. */
export const BUILTIN_AGENT_TEAM_NAMES = [
  'spawn_teammate',
  'list_agents',
  'send_message',
  'interrupt_agent',
  'wait_agent',
  'team_task_create',
  'team_task_list',
  'team_task_get',
  'team_task_update',
  'agent_team',
  'agent_teams',
]

/** Everything this plugin owns. Keep in sync with the registration sites. */
export const OWN_NAMES = {
  tool: 'expert_council',
  command: 'experts',
  panelId: 'dsh-expert-council',
  sidebarSlot: 'sidebar.panellist',
  mainSlot: 'dsh-expert-council',
  dataDir: 'expert-council',
  consultPrefix: 'ec-',
}

/** One-line contract rendered into the prompt and the brief. */
export const BOUNDARY_NOTE =
  '本插件与 DSH 内置的智能体团队（Agent Teams）互相独立：它不会创建、调度或结束任何子代理，' +
  '不使用 spawn_teammate / team_task_* 等内置工具，也不会写入 Agent Teams 的状态；' +
  '这里的「团队」只是专家镜头（lenses）与会诊协议，不产生真实的并行代理。'

/**
 * @returns {{ok: boolean, collisions: string[]}}
 */
export function checkIsolation() {
  const own = new Set([OWN_NAMES.tool, OWN_NAMES.command, OWN_NAMES.panelId, OWN_NAMES.dataDir])
  const collisions = BUILTIN_AGENT_TEAM_NAMES.filter((name) => own.has(name))
  return { ok: collisions.length === 0, collisions }
}
