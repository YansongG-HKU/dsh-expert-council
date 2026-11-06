/**
 * Professional deliverable for one real panel run.
 *
 * The report is the artifact a user can hand to a committee: decision, evidence
 * table, disagreements and dissent, unresolved questions, reversal triggers,
 * actions, the domain's own required checks, and a full run ledger (calls,
 * tokens, latency, retries). It is generated from the persisted run transcript,
 * not from the model's prose, so it cannot drift from what was actually said.
 */

function fmtTokens(value) {
  return `${Math.max(0, Math.round(value)).toLocaleString('en-US')} tok`
}

function fmtMs(value) {
  if (!Number.isFinite(value)) return '—'
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(1)}s`
}

function cell(text, max = 120) {
  const value = String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export function buildReport({ consult, team, domain = null, run, verdict }) {
  if (run.intent === 'task') return buildTaskReport({ consult, team, domain, run, verdict })
  const lines = []
  const duration = (run.finishedAt ?? Date.now()) - run.startedAt
  lines.push(`# 专家团会诊报告 · ${team?.name?.zh ?? consult.teamId}`)
  lines.push('')
  lines.push(
    `> 会诊 \`${consult.id}\` · ${domain ? `${domain.name.zh} · ` : ''}${consult.modeLabel ?? consult.mode} · 模型 ${run.provider}/${run.model}`,
  )
  lines.push(
    `> 耗时 ${fmtMs(duration)} · 用量 ${fmtTokens(run.usage?.totalTokens ?? 0)} · 预算 ${fmtTokens(consult.budget?.cap ?? 0)}`,
  )
  lines.push('')
  lines.push('## 一、结论')
  lines.push('')
  lines.push(`**${verdict?.decision ?? '（未形成裁决）'}**   置信度：${verdict?.confidence ?? '—'}`)
  lines.push('')
  if (verdict?.rationale) {
    lines.push(verdict.rationale)
    lines.push('')
  }

  const opinions = run.opinions ?? []
  lines.push('## 二、专家独立意见')
  lines.push('')
  if (opinions.length === 0) {
    lines.push('_本轮为轻会诊，未逐位专家成稿。_')
  } else {
    lines.push('| 专家 | 立场 | 置信 | 关键主张 | 证据 |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const opinion of opinions) {
      const first = opinion.claims?.[0]
      lines.push(
        `| ${cell(opinion.expertName, 20)} | ${opinion.stance} | ${Number(opinion.confidence).toFixed(2)} | ${cell(first?.claim, 60)} | ${cell(first?.evidence, 60)} |`,
      )
    }
  }
  lines.push('')

  lines.push('## 三、分歧与交叉质询')
  lines.push('')
  if ((run.disagreements ?? []).length === 0) {
    lines.push('未发现立场级或置信度级分歧。')
  } else {
    for (const item of run.disagreements) lines.push(`- ${item.a} ↔ ${item.b}（${item.kind}）：${item.reason}`)
    if ((run.crossExam ?? []).length > 0) {
      lines.push('')
      lines.push('交叉质询结果：')
      for (const entry of run.crossExam) lines.push(`- ${entry.expert}：${entry.summary}`)
    }
  }
  lines.push('')

  lines.push('## 四、异议（不抹平）')
  lines.push('')
  const dissent = verdict?.dissent ?? []
  if (dissent.length === 0) lines.push('无记录的异议。')
  else for (const item of dissent) lines.push(`- **${item.expert}**：${item.point}（证据：${item.evidence || '未提供'}）`)
  lines.push('')

  lines.push('## 五、未决问题与推翻条件')
  lines.push('')
  lines.push('未决问题：')
  if ((verdict?.unresolved ?? []).length === 0) lines.push('- （无）')
  else for (const item of verdict.unresolved) lines.push(`- ${item}`)
  lines.push('')
  lines.push('推翻条件：')
  if ((verdict?.reversalTriggers ?? []).length === 0) lines.push('- （无）')
  else for (const item of verdict.reversalTriggers) lines.push(`- ${item}`)
  lines.push('')

  lines.push('## 六、行动项')
  lines.push('')
  if ((verdict?.actions ?? []).length === 0) lines.push('- （无）')
  else for (const item of verdict.actions) lines.push(`- ${item}`)
  lines.push('')

  if (domain) {
    lines.push(`## 七、领域交付物核对（${domain.name.zh}）`)
    lines.push('')
    lines.push(`交付物：${domain.artifacts.join('、')}`)
    lines.push('')
    lines.push('必须核验的证据项：')
    for (const item of domain.evidence?.required ?? []) lines.push(`- [ ] ${item}`)
    lines.push('')
    lines.push('红旗清单：')
    for (const item of domain.evidence?.redFlags ?? []) lines.push(`- [ ] ${item}（出现即降级）`)
    const notes = verdict?.artifactNotes ?? []
    if (notes.length > 0) {
      lines.push('')
      lines.push('主持备注：')
      for (const item of notes) lines.push(`- ${item}`)
    }
    lines.push('')
  }

  lines.push('## 八、运行明细')
  lines.push('')
  lines.push('| 调用 | 专家 | 状态 | 尝试 | 用量 | 耗时 |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const entry of run.experts ?? []) {
    lines.push(
      `| ${entry.kind ?? 'independent'} | ${cell(entry.expertName ?? entry.expert, 24)} | ${entry.status} | ${entry.attempts ?? 1} | ${fmtTokens(entry.tokens ?? 0)} | ${fmtMs(entry.latencyMs ?? 0)} |`,
    )
  }
  lines.push('')
  if ((run.warnings ?? []).length > 0) {
    lines.push('## 九、告警')
    lines.push('')
    for (const item of run.warnings) lines.push(`- ${item}`)
    lines.push('')
  }
  lines.push('---')
  lines.push(`生成时间：${new Date(run.finishedAt ?? Date.now()).toISOString()}`)
  lines.push('')
  return lines.join('\n')
}

/** Task-mode report: the deliverable itself is the point; reviews are context. */
function buildTaskReport({ consult, team, domain = null, run, verdict }) {
  const task = run.taskResult ?? {}
  const duration = (run.finishedAt ?? Date.now()) - run.startedAt
  const lines = []
  lines.push(`# 专家团任务报告 · ${team?.name?.zh ?? consult.teamId}`)
  lines.push('')
  lines.push(
    `> 任务 \`${consult.id}\` · ${domain ? `${domain.name.zh} · ` : ''}${consult.modeLabel ?? consult.mode} · 模型 ${run.provider}/${run.model}`,
  )
  lines.push(`> 耗时 ${fmtMs(duration)} · 用量 ${fmtTokens(run.usage?.totalTokens ?? 0)} · 预算 ${fmtTokens(consult.budget?.cap ?? 0)}`)
  lines.push('')
  lines.push('## 一、最终成果')
  lines.push('')
  lines.push(`**${task.title || verdict?.decision || '任务成果'}**`)
  lines.push('')
  if (task.summary) {
    lines.push(task.summary)
    lines.push('')
  }
  if (task.artifact) {
    lines.push('---')
    lines.push('')
    lines.push(task.artifact)
    lines.push('')
  } else {
    lines.push('_主持合并未产出最终成果；下面是各专家交付物。_')
    lines.push('')
  }

  lines.push('## 二、参与专家与分工')
  lines.push('')
  const deliverables = task.deliverables ?? []
  if (deliverables.length === 0) {
    lines.push('_没有记录分工。_')
  } else {
    lines.push('| 专家 | 产出 | 贡献 |')
    lines.push('| --- | --- | --- |')
    for (const item of deliverables) {
      lines.push(`| ${cell(item.expert, 24)} | ${cell(item.title, 40)} | ${cell(item.contribution, 100)} |`)
    }
  }
  lines.push('')

  lines.push('## 三、各专家交付物')
  lines.push('')
  const works = task.works ?? []
  if (works.length === 0) {
    lines.push('_没有逐专家交付物（可能全部失败或为 lean 任务）。_')
  } else {
    for (const work of works) {
      lines.push(`### ${work.expertName ?? work.expert}（${work.expert}）— ${work.title || '产出'}`)
      lines.push('')
      lines.push(work.content || '（空）')
      lines.push('')
    }
  }

  lines.push('## 四、假设与风险')
  lines.push('')
  const assumptions = task.assumptions ?? []
  const risks = task.risks ?? []
  if (assumptions.length === 0 && risks.length === 0) lines.push('_未记录假设/风险。_')
  for (const item of assumptions) lines.push(`- 假设：${item}`)
  for (const item of risks) lines.push(`- 风险：${item}`)
  lines.push('')

  lines.push('## 五、未决与下一步')
  lines.push('')
  const openQuestions = task.openQuestions ?? []
  const nextActions = task.nextActions ?? []
  if (openQuestions.length === 0 && nextActions.length === 0) lines.push('_无。_')
  for (const item of openQuestions) lines.push(`- 未决：${item}`)
  for (const item of nextActions) lines.push(`- 下一步：${item}`)
  lines.push('')

  lines.push('## 六、运行明细')
  lines.push('')
  lines.push('| 调用 | 专家 | 状态 | 尝试 | 用量 | 耗时 |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const entry of run.experts ?? []) {
    lines.push(
      `| ${entry.kind ?? 'task'} | ${cell(entry.expertName ?? entry.expert, 24)} | ${entry.status} | ${entry.attempts ?? 1} | ${fmtTokens(entry.tokens ?? 0)} | ${fmtMs(entry.latencyMs ?? 0)} |`,
    )
  }
  lines.push('')
  if ((run.warnings ?? []).length > 0) {
    lines.push('## 七、告警')
    lines.push('')
    for (const item of run.warnings) lines.push(`- ${item}`)
    lines.push('')
  }
  lines.push('---')
  lines.push(`生成时间：${new Date(run.finishedAt ?? Date.now()).toISOString()}`)
  lines.push('')
  return lines.join('\n')
}
