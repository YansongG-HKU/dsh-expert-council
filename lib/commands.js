/**
 * `/experts` — the human-facing command.
 *
 * A command is the shortest path from "I want a panel" to "a panel exists":
 *   /experts                        list teams + how to convene
 *   /experts experts                list the lens roster
 *   /experts architecture           team detail (members, agenda, budget)
 *   /experts architecture 要不要做…  create a consult and print its brief
 *
 * The command never writes opinions or verdicts — that is the model's job
 * through the tool — it only creates the consult and hands over the protocol.
 */

import { TEAMS, teamName } from './teams.js'
import { EXPERTS } from './experts.js'
import { MODES } from './protocol.js'

const MAX_TEXT = 14000

function teamLine(team) {
  const members = team.members.map((member) => member.id).join('/')
  return `- \`${team.id}\` · ${team.name.zh} — ${team.tagline}（成员：${members}；默认档：${team.defaultMode}；预算：轻 ${team.budget.lean} / 标 ${team.budget.standard} / 深 ${team.budget.deep} token）`
}

function teamsText() {
  return [
    '## 专家团',
    ...TEAMS.map(teamLine),
    '',
    '用法：',
    '- `/experts <团队id> <问题>` — 直接立案，返回会诊简报（发给模型或让模型读 `expert_council`）。',
    '- `/experts <团队id>` — 看成员、议程与预算。',
    '- `/experts experts` — 看全部专家镜头定义。',
    '- 也可以从侧边栏「专家团」面板选团队、填问题，一键在新会话里开会诊。',
    '- 不会配置也没关系：面板「用一句话调整」或 `/experts 调整 <一句话>`，直接用自然语言描述要加/改什么专家或团队。',
    '- 调整专家角色或团队构成：在侧边栏「专家团」面板里新建/编辑（保存后立即生效，内置预置也可覆盖）。',
    '- 专家团只在你明确发起时使用：模型不会主动调用它；/experts 与面板就是你的明确发起动作。',
  ].join('\n')
}

function expertsText() {
  return [
    '## 专家镜头',
    ...EXPERTS.map(
      (expert) =>
        `- \`${expert.id}\` · ${expert.name.zh}（${expert.group}）— ${expert.mandate} 红线：${expert.redLines.join('；')}`,
    ),
    '',
    '专家是镜头不是人设：每个镜头只在自己的范围内计票，越界意见降权。',
  ].join('\n')
}

function teamDetail(team) {
  const modes = MODES.map((mode) => `${mode.label}（${team.budget[mode.id]} token）：${mode.when}`).join('\n')
  return [
    `## ${team.name.zh} · \`${team.id}\``,
    team.intent,
    '',
    `**成员**：${team.members.map((member) => `${member.id}${member.role === 'lead' ? '（主持）' : ''}`).join('、')}`,
    '',
    '**议程**：',
    ...team.agenda.map((item) => `- ${item}`),
    '',
    '**档位与预算**：',
    modes,
    '',
    `直接开会诊：\`/experts ${team.id} <一句话写清要决定的事>\``,
  ].join('\n')
}

export function createExpertsCommand(service) {
  return {
    name: 'experts',
    description: '召集专家团：列出团队/专家，或直接用 <团队id> <问题> 立案并拿到会诊简报。',
    input: { hint: '<团队id> <问题>｜teams｜experts' },
    handler: async ({ rawInput = '' } = {}) => {
      const text = String(rawInput ?? '').trim()
      if (text.length === 0 || /^(teams|list|ls)$/i.test(text)) {
        return { kind: 'success', text: teamsText() }
      }
      if (/^(experts|lenses|专家)$/i.test(text)) {
        return { kind: 'success', text: expertsText() }
      }
      // Plain-language customisation, no schema knowledge needed.
      if (/^(调整|改|助手|customize|nl)$/i.test(text.split(/\s+/)[0] ?? '')) {
        const request = text.split(/\s+/).slice(1).join(' ').trim()
        if (request.length < 2) {
          return {
            kind: 'error',
            text: '用法：`/experts 调整 <用一句话描述你想怎么改>`\n例如：`/experts 调整 加一个只看数据授权的合规专家，并在安全评审团里用上他`。',
          }
        }
        try {
          const result = await service.customizationBrief({ request })
          const prefix = '已生成自然语言调整简报。把下面内容交给模型（或新会话里让它按简报执行），它会用工具把改动落到目录里：\n\n'
          return { kind: 'success', text: `${prefix}${result.brief}`.slice(0, MAX_TEXT) }
        } catch (error) {
          return { kind: 'error', text: String(error?.userMessage ?? error?.message ?? error) }
        }
      }
      const [teamId, ...rest] = text.split(/\s+/)
      const team = TEAMS.find((item) => item.id === teamId)
      if (!team) {
        return {
          kind: 'error',
          text: `未知团队：${teamId}\n可用团队：${TEAMS.map((item) => item.id).join('、')}\n查看全部：/experts`,
        }
      }
      const question = rest.join(' ').trim()
      if (question.length === 0) return { kind: 'success', text: teamDetail(team) }
      try {
        const result = await service.convene({ teamId: team.id, question, actor: 'user', via: 'command' })
        const text = `已由你立案：**${result.consultId}** · ${teamName(team)} · ${result.modeLabel}\n\n${result.brief}`
        return { kind: 'success', text: text.slice(0, MAX_TEXT) }
      } catch (error) {
        return { kind: 'error', text: String(error?.userMessage ?? error?.message ?? error) }
      }
    },
  }
}
