/**
 * `/experts` — the human-facing command.
 *
 *   /experts                         teams + how to convene
 *   /experts experts                 lens roster
 *   /experts domains                 professional domain packs
 *   /experts <team|domain>           inspect a panel
 *   /experts <team|domain> <q>       open a consult (returns the brief)
 *   /experts run <team|domain> <q>   open a consult and execute a REAL panel run
 *   /experts 调整 <sentence>          plain-language customisation brief
 *
 * The command never writes opinions or verdicts by hand; the real path is the
 * Host executor (`action=run`), which calls the model once per expert.
 */

import { MODES } from './protocol.js'

const MAX_TEXT = 14000

function teamBudget(team) {
  const budget = team.budget ?? {}
  const estimates = team.estimates ?? {}
  return `轻 ${budget.lean ?? estimates.lean ?? '?'} / 标 ${budget.standard ?? estimates.standard ?? '?'} / 深 ${budget.deep ?? estimates.deep ?? '?'} token`
}

function teamLine(team) {
  const members = (team.members ?? []).map((member) => `${member.id}${member.role === 'lead' ? '（主持）' : ''}`).join('/')
  return `- \`${team.id}\` · ${team.name.zh} — ${team.tagline}（成员：${members}；默认档：${team.defaultMode}；预算：${teamBudget(team)}${team.domain ? `；领域：${team.domain}` : ''}）`
}

function teamsText(teams) {
  return [
    '## 专家团',
    ...teams.map(teamLine),
    '',
    '用法：',
    '- `/experts <团队id|领域id> <问题>` — 立案，返回会诊简报。',
    '- `/experts run <团队id|领域id> <问题>` — 立案并立即执行真实会诊（Host 并行调用每位专家，出一份报告）。',
    '- `/experts domains` — 看 6 个专业领域评审团（金融/法律/医疗/工程/科研/安全）。',
    '- `/experts 调整 <一句话>` — 用自然语言描述要加/改什么专家或团队。',
  ].join('\n')
}

function expertsText(experts) {
  return [
    '## 专家镜头',
    ...experts.map(
      (expert) =>
        `- \`${expert.id}\` · ${expert.name.zh}（${expert.group}${expert.domain ? ` · ${expert.domain}` : ''}）— ${expert.mandate} 红线：${(expert.redLines ?? []).join('；')}`,
    ),
    '',
    '专家是镜头不是人设：每个镜头只在自己的范围内计票，越界意见降权。',
  ].join('\n')
}

function domainsText(domains) {
  return [
    '## 专业领域评审团',
    ...domains.map(
      (domain) =>
        `- \`${domain.id}\` · ${domain.name.zh} — ${domain.tagline}\n  成员：${domain.team.members.map((member) => `${member.id}${member.role === 'lead' ? '（主持）' : ''}`).join('/')}；交付物：${domain.artifacts.join('、')}`,
    ),
    '',
    '用 `/experts run finance <问题>` 直接跑一次真实会诊；或在面板选领域、填问题、点「真实会诊」。',
  ].join('\n')
}

function modesText(team) {
  const budget = team.budget ?? {}
  return MODES.map((mode) => `${mode.label}（${budget[mode.id] ?? '?'} token）：${mode.when}`).join('\n')
}

function teamDetail(team) {
  return [
    `## ${team.name.zh} · \`${team.id}\``,
    team.intent ?? '',
    '',
    `**成员**：${(team.members ?? []).map((member) => `${member.id}${member.role === 'lead' ? '（主持）' : ''}`).join('、')}`,
    '',
    '**议程**：',
    ...(team.agenda ?? []).map((item) => `- ${item}`),
    '',
    '**档位与预算**：',
    modesText(team),
    '',
    `开会诊：\`/experts ${team.id} <一句话写清要决定的事>\``,
    `直接跑真实会诊：\`/experts run ${team.id} <问题>\``,
  ].join('\n')
}

function domainDetail(domain) {
  return [
    `## ${domain.name.zh} · \`${domain.id}\``,
    domain.description ?? domain.tagline,
    '',
    '**专家**：',
    ...domain.experts.map((expert) => `- \`${expert.id}\` ${expert.name.zh} — ${expert.mandate}`),
    '',
    '**证据标准**：',
    ...(domain.evidence?.levels ?? []).map((level) => `- ${level.id} ${level.label}：${level.meaning}`),
    '',
    '**必须核验**：',
    ...(domain.evidence?.required ?? []).map((item) => `- ${item}`),
    '',
    '**红旗**：',
    ...(domain.evidence?.redFlags ?? []).map((item) => `- ${item}`),
    '',
    `**交付物**：${domain.artifacts.join('、')}`,
    '',
    `开会诊：\`/experts ${domain.id} <问题>\``,
    `直接跑真实会诊：\`/experts run ${domain.id} <问题>\``,
  ].join('\n')
}

async function resolveTarget(service, token) {
  const domains = await service.domains()
  const domain = domains.find((item) => item.id === token)
  if (domain) {
    const teams = await service.teams()
    return { domain, team: teams.find((team) => team.id === domain.team.id) ?? null }
  }
  const teams = await service.teams()
  const team = teams.find((item) => item.id === token)
  return { domain: null, team: team ?? null }
}

export function createExpertsCommand(service) {
  return {
    name: 'experts',
    description: '召集专家团：列团队/领域/专家，或直接立案、跑真实会诊（Host 并行调用每位专家）。',
    input: { hint: '<团队id|领域id> <问题>｜run <目标> <问题>｜domains｜experts｜调整 <一句话>' },
    handler: async ({ rawInput = '' } = {}) => {
      const text = String(rawInput ?? '').trim()
      if (text.length === 0 || /^(teams|list|ls)$/i.test(text)) {
        return { kind: 'success', text: teamsText(await service.teams()) }
      }
      if (/^(experts|lenses|专家)$/i.test(text)) {
        return { kind: 'success', text: expertsText(await service.experts()) }
      }
      if (/^(domains|domain|领域)$/i.test(text)) {
        return { kind: 'success', text: domainsText(await service.domains()) }
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

      const tokens = text.split(/\s+/)
      let command = 'consult'
      if (/^(run|真实|执行)$/i.test(tokens[0])) {
        command = 'run'
        tokens.shift()
      }
      const [targetId, ...rest] = tokens
      const question = rest.join(' ').trim()
      try {
        const target = await resolveTarget(service, targetId)
        if (!target.team && !target.domain) {
          const [teams, domains] = [await service.teams(), await service.domains()]
          return {
            kind: 'error',
            text: `未知团队/领域：${targetId}\n团队：${teams.map((team) => team.id).join('、')}\n领域：${domains.map((domain) => domain.id).join('、')}\n查看全部：/experts`,
          }
        }
        if (!question) {
          return { kind: 'success', text: target.domain ? domainDetail(target.domain) : teamDetail(target.team) }
        }
        const convened = await service.convene({
          teamId: target.team?.id,
          domain: target.domain?.id,
          question,
          actor: 'user',
          via: 'command',
        })
        if (command === 'run') {
          const started = await service.run(convened.consultId, { wait: false })
          return {
            kind: 'success',
            text: [
              `已开始真实会诊：**${convened.consultId}** · ${convened.team.name.zh}${convened.domain ? ` · ${convened.domain.name.zh}` : ''}`,
              '',
              'Host 会并行调用每位专家，再做交叉质询/同行评议与主持裁决。进度看面板「最近会诊」，或让模型调用 `expert_council({action:"run_status", id:"' + convened.consultId + '"})`；完成后报告在 `action=report`。',
              started?.runId ? `运行 ID：\`${started.runId}\`` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          }
        }
        const after = '可让模型执行 `expert_council({action:"run", id:"' + convened.consultId + '"})` 跑真实会诊，或按简报人工推进。'
        return { kind: 'success', text: `已由你立案：**${convened.consultId}** · ${convened.team.name.zh} · ${convened.modeLabel}\n\n${after}\n\n${convened.brief}`.slice(0, MAX_TEXT) }
      } catch (error) {
        return { kind: 'error', text: String(error?.userMessage ?? error?.message ?? error) }
      }
    },
  }
}
