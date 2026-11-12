# 专家团 · 规格与机制

本文是 `dsh-expert-council` 的实现契约。所有条目都能在代码或测试里找到对应位置。

## 1. 数据模型

### 1.1 专家镜头（`lib/experts.js`）

```js
{
  id,                       // 稳定 id，进台账与意见
  name: { zh, en },
  group,                    // structure | risk | user | execution
  mandate,                  // 一句话职责：管什么
  lens,                     // 优化的目标
  asks: [..],               // 必问问题（3–6）
  redLines: [..],           // 触发即否决（2+）
  misses,                   // 系统性盲区（必须写，否则镜头不完整）
  pairs: [..],              // 互补镜头
  conflicts: [..],          // 天然张力（如 security vs velocity）
  budget: { standard, deep } // 单人 token 参考额度
}
```

`tests/core.test.mjs` 逐条校验：id 唯一、职责/必问/红线/盲区齐全、pairs 指向真实镜头。

### 1.2 团队预置（`lib/teams.js`）

```js
{
  id, name, tagline, intent,
  defaultMode,              // lean | standard | deep
  members: [{ id, role: 'lead' | 'member' }],
  agenda: [..],             // 4 条议程，防止跑题
  artifacts: [..],          // 产出物
  budget: { lean, standard, deep }  // 整场会诊 token 预算
}
```

约束：恰好一个 `lead`（主持），成员 ≥3，预算严格递增。

### 1.3 会诊台账（`lib/store.js`）

`$DSH_HOME/expert-council/consults.json`：

```js
{ version: 1, consults: [{ id, teamId, mode, question, context, status, budget, rounds, disagreements, verdict, tokens, createdAt, updatedAt }] }
```

- 原子写入（temp + rename）；
- 上限 200 条；
- `status = open | verdict | archived`。

## 2. 协议（`lib/protocol.js`）

7 条铁律：独立先行、证据门槛、只谈分歧、异议留档、越权降权、预算硬顶、留痕可复查。

4 个阶段：`define → independent → cross → verdict`（lean 为 `define → lenses → verdict`，deep 增加 `anonymous-peer`）。

### 输出契约

意见：

```json
{"expert":"architect","stance":"support|oppose|conditional","confidence":0.0,
 "claims":[{"claim":"…","evidence":"文件:行 / 命令输出 / 数据 / 引用","confidence":0.0}],
 "changes":"什么证据会改变结论","unknowns":["…"]}
```

裁决：

```json
{"decision":"做|不做|有条件做（条件）","confidence":0.0,"rationale":"…",
 "dissent":[{"expert":"…","point":"…","evidence":"…"}],
 "unresolved":["…"],"reversalTriggers":["…"],"actions":["负责人 + 动作 + 期限"]}
```

### 预算模型

```
cap = team.budget[mode] 或调用方 budget_cap
opinionBudget = cap × (lean ? 0.55 : 0.62)
perExpert = opinionBudget / 成员数
verdictReserve = cap − opinionBudget
```

`record` 统计实际 token；超过 `cap × 1.2` 标记 `overBudget`；`verdict` 汇总并告警。

## 3. 流程与门禁（`lib/service.js`）

| 步骤 | 方法 | 门禁 |
| --- | --- | --- |
| 立案 | `convene` | **显式同意**（见 3.1）；团队存在且不完整拒绝；问题 ≥8 字；档位合法；预算 200–20000 |
| 写意见 | `record` | 会诊未裁决/未归档；专家必须在团内；轮次连续且 ≤4；空意见拒绝 |
| 裁决 | `verdict` | 标准/深会诊必须已有意见；存在分歧必须有 dissent（否则 403，force 需书面理由）；理由 ≥10 字；**不允许覆盖已裁决会诊** |
| 归档 | `archive` | 会诊存在 |
| 查询 | `get/list/state` | — |
| 自定义 | `saveExpert/saveTeam/deleteEntity/resetCustomization` | 见 3.2 |
| 重置 | `resetCustomization` | 必须 `confirm:true` |

分歧检测：立场不同，或同一问题置信度差 ≥0.45；只看当前轮、跳过同一专家、按对去重。

证据审计：每条 claim 的 `evidence` 为空 → 计入 `missing`，意见覆盖率下降；`verdict` 在覆盖率 <60% 时告警。

### 3.1 显式调用（consent）

```
actor='user'（/experts 命令、面板）        → consent.kind = 'user-action'，放行
actor='agent'（模型工具）:
  requireExplicitConsent（默认 true）
    explicit_request !== true               → 拒绝：「专家团只在你明确呼叫时使用」
    request_quote 为空/<2 字                → 拒绝：要求用户原话留痕
    否则                                    → consent.kind = 'explicit-request'，写入台账
requireExplicitConsent=false（配置关闭）    → 放行（不推荐，记录 via:'config'）
```

consent 会持久化在 consult 上：`{kind, via, quote, at}`；面板/工具/命令都读到同一字段。

### 3.2 自定义目录（`lib/custom.js` + `customization.json`）

- 目录 = 内置常量（`lib/experts.js`、`lib/teams.js`）+ 覆盖层（`experts` / `teams` / `hiddenExperts` / `hiddenTeams`）。
- 覆盖内置：同 id 写入 → `custom:true` + `preset:true`；新增：`custom:true` + `preset:false`；删除内置 = 隐藏，删除自定义 = 移除；`reset({confirm:true})` 清空覆盖层。
- 校验：专家 id 格式、中文名、职责 ≥8 字、镜头/必问/红线/盲区非空、预算区间；团队 id、成员必须存在、恰好一个主持（缺省自动取第一个）、议程 ≥1、预算单调（lean ≤ standard ≤ deep）。
- 删除专家会从自定义团队中摘除该成员并返回 `affectedTeams`；团队清空后 `incomplete:true`，`convene` 拒绝。
- 上限：自定义专家 40、自定义团队 40。

### 3.3 与内置 Agent Teams 的隔离

`lib/isolation.js` 是唯一命名来源：`expert_council`（工具）、`experts`（命令）、`dsh-expert-council`（面板/主视图）、`expert-council`（数据目录）、`ec-`（会诊 id）。`BUILTIN_AGENT_TEAM_NAMES` 列出内置 Agent Teams 的工具名，`checkIsolation()` 断言零碰撞，测试固定该边界。插件不 import 任何 agent-team 服务，不调用 `spawn_teammate` / `team_task_*`，不创建子代理。

### 3.4 自然语言调整（`customize`）

目标：用户不需要懂字段/预算/主持人，直接用一句话描述要加/改什么。

```
用户原话（面板「用一句话调整」/ `/experts 调整 …` / 对话里说）
        │
        ▼
service.customizationBrief({request})  ← 只读，不改目录
  返回：原话 + 当前目录快照 + 四种动作 + 字段速查 + 规则 + 示例
        │
        ▼
模型按简报调用 save_expert / save_team / delete（必须带 request_quote=用户原话）
        │
        ▼
customization.json 写入 + history 记一条（谁、什么动作、原话、影响）
        │
        ▼
面板 3 秒轮询刷新 + 「最近调整」展示
```

- 面板：`POST /expert-council/api/action {action:'nl-request', text}` → 简报；客户端用现有 `startSessionWithBrief` 开会话。
- 命令：`/experts 调整 <一句话>` → 同一份简报（只读，不落库）。
- 工具：`{action:'customize', request}` → 同一份简报；写调用必须带 `request_quote`，否则拒绝。
- `history` 字段：`{at, actor, action, id, request, summary}`，最多 80 条，`state.customization.history` 返回最新 12 条。
- 破坏性操作（删除/重置/覆盖内置）在简报规则里要求先说明影响；用户没有明确要求时选可回退做法。

## 4. 三个入口（同一 service）

1. **工具** `expert_council`（`lib/tools.js`）：`teams` / `experts` / `convene` / `record` / `verdict` / `get` / `list` / `archive` / `customize` / `save_expert` / `save_team` / `delete` / `reset` / `customization`。
2. **命令** `/experts`（`lib/commands.js`）：`teams` / `experts` / `<team>` / `<team> <问题>` / `调整 <一句话>`；立案即用户动作，返回值不含裁决。
3. **面板**（`lib/panel.js` + `client.js`）：
   - `GET /expert-council/api/state`
   - `GET /expert-council/api/consult?id=`
   - `POST /expert-council/api/action` `{action:'convene'|'archive'|'save-team'|'save-expert'|'delete'|'reset-custom'|'nl-request', …}`
   - 同源校验：Host 头必须等于本机端口，必须带 `x-expert-council: 1`。

## 5. Token 纪律（写给模型和用户）

- 默认 `lean`；只有不可逆/高成本才升档。
- 简报只含本团镜头，不加载全量名册。
- 每个专家写到额度即停；到顶输出「未完成的检查」而不是继续烧 token。
- 汇报只给：裁决、最强异议、推翻条件；不复述简报。

## 6. 质量清单（验收时逐条核对）

- [x] 14 个镜头定义完整，含盲区与红线
- [x] 8 个团队预置，成员合法、恰好一个主持
- [x] 7 条铁律，4 阶段流程，输出契约 JSON
- [x] 无意见不可裁决（标准/深会诊）
- [x] 有分歧必须写 dissent；禁止重裁
- [x] 三档预算 + 超支告警 + 覆盖统计
- [x] 三入口共享同一 service 与台账
- [x] 显式调用门禁：模型无 consent 拒绝、原话留痕、命令/面板放行
- [x] 自定义：新增/覆盖/隐藏/重置，持久化、校验、立即生效
- [x] 自然语言调整：customize 简报、nl-request、/experts 调整、模型写入需 request_quote
- [x] 变更历史：每次保存/删除/重置记 history（谁、动作、原话、影响）
- [x] 与内置 Agent Teams 零命名碰撞、零调用、不创建子代理
- [x] 测试覆盖门禁、预算、命令、工具、面板、自定义、隔离、自然语言路径

## 7. V0.4 真实会诊（real panel execution）

### 7.1 执行器（lib/executor.js）

- 每位专家一次独立 `llm.prepareCall → stream` 调用，互不可见；`maxParallel` 默认 4（单槽自部署端点建议 1）。
- 路由：`run` 使用调用 agent 的 selection（`exec.agent.model.current()`，回落到 `session.requestHeader().config`），service 优先级为「显式 `options.selection` > agent selection > `agentDefaultModel`」。
- 推理路由（`reasoningEffort` 存在且非 `off`）抬高各阶段输出下限：独立意见 2400、交叉质询 1800、主持 1800、lean 2400、任务 2400 / 合并 6000 token；非推理路由与旧版一致。
- 调用超时：未显式配置时推理路由 180s、非推理 90s；显式 `callTimeoutMs` 优先。该值进入每次模型调用与 `run.callTimeoutMs` 快照。
- 仅当检测到 stance/confidence 分歧时，对最多 4 位涉及专家做交叉质询并写回第 2 轮修订。
- `deep` 追加匿名同行评议（最多 4 位），再进入主持裁决。
- 主持输出契约：`decision/confidence/rationale/dissent/unresolved/reversalTriggers/actions/artifactNotes`；存在分歧而 dissent 为空会触发一次强制修复。
- 失败路径：单次调用超时/重试 → 专家记 failed；成功数低于法定人数（ceil(N/2)）则整轮失败并保留 open 状态；`QUORUM_FAILED` 等运行失败信息附 `provider/model`、推理开关与建议（降低 effort / 单槽端点 `max_parallel:1`）；主持 JSON 不可解析 → 先抢救截断字段，再退回按意见统计的降级裁决（报告标注需人工复核）。
- 推理模型适配：finish=max-tokens 且无可见文本时自动提高输出额度并降低推理强度重试一次。

### 7.2 领域包（lib/domains.js）

`finance / legal / healthcare / engineering / research / security`；每包 5 位专家、证据等级阶梯、必须核验项、红旗、交付物、三档预算；团队 id `<domain>-review`，恰好一个主持。

### 7.3 数据与接口

- 台账 `consult.run` 额外保存 `provider/model/tokens/budget/durationMs/experts/failedExperts/expertStatuses/reportPath/error`；run 转录另含 `reasoning/callTimeoutMs`。
- `runs/<runId>.json` 完整转录；`runs/<runId>.md` 8 节报告。
- 工具动作新增：`domains` / `run`（id 或 domain+question，`wait` 可 false）/ `run_status` / `cancel_run` / `report`。
- 面板新增：`GET /expert-council/api/report?id=`（text/markdown）、`POST action=run|cancel-run`、state 返回 `domains` 与 `runtime{llmAvailable,activeRuns,config}`。
- 命令新增：`/experts domains`、`/experts run <领域|团队> <问题>`。

### 7.4 V0.4 质量清单

- [x] 真实并行：每位专家一次独立调用，`maxActive > 1` 有测试断言
- [x] 交叉质询只在有分歧时触发，且只针对涉及专家
- [x] 主持强制回应分歧（dissent 修复）
- [x] 法定人数不足 → 明确失败且会诊保持 open
- [x] 取消 → AbortController 中断、run 记为 canceled、会诊可重试
- [x] 主持输出截断 → 抢救/降级，不丢失整次会诊
- [x] 推理模型空输出 → 自动加预算重试
- [x] 8 节报告落盘，含专家表、分歧、异议、推翻条件、交付物核对、运行明细
- [x] `consult.run.expertStatuses` 与 `reportAvailable` 持久化
- [x] 领域包进入 brief / 专家 system prompt / 报告核对表
- [x] 与 Agent Teams 的对照与评分见 `docs/BENCHMARK.md`

## 8. V0.5 无任务边界（task intent + unbounded scope）

### 8.1 两种意图

- `intent="review"`（默认）：原有评审协议——独立意见、分歧交叉质询、主持裁决（dissent/unresolved/reversalTriggers）。
- `intent="task"`：每位专家并行交付完整可用产出（代码/方案/文案/设计/攻击面/模型/剧本…），总集成者合并为一份最终成果；不投票、不要求异议结构。
- `consult.intent` 持久化；`state.protocol.intents` 与 `state.consults[].intent` 供面板消费；工具/命令/面板均可传 intent。

### 8.2 解除任务边界

- 删除 `stay-in-lens（越权降权）` 规则，替换为 `no-task-boundary（全域无界）`：任何主题、任何产出都可以；专家可越过镜头/领域，不因跨域、敏感、非常规而降权、拒答或缩水。
- 专家 prompt 新增「没有任务边界」段；镜头是起点不是边界；评审类证据门槛不适用于创作/执行类产出（假设与风险必须写清）。
- 领域包改为「领域镜头基线（可越过）」；取消 team 与 domain 的归属一致性校验，任意团队/领域可组合用于任意任务。
- 任务 prompt：`buildTaskExpertPrompt` → `TASK_SCHEMA`；`buildTaskMergePrompt` → `TASK_MERGE_SCHEMA`；合并失败自动拼接并告警。

### 8.3 任务模式执行与留痕

- executor task 路径：并行 `work` 阶段 → `merge` 阶段 → `completeTask` 落库；报告为「专家团任务报告」（最终成果/分工/各专家交付物/假设风险/未决下一步/运行明细）。
- 任务会诊拒绝人工 `record`；`completeTask` 不走评审裁决的 dissent/证据门禁（产出语义不同）。
- 任务默认预算 = 团队档位 ×1.5（≤20000）；专家输出额度 ≥2400、合并 ≥4000 token。

### 8.4 V0.5 质量清单

- [x] task intent 全链路（convene/run/记录/报告/面板）
- [x] 并行产出 + 合并最终成果；合并失败自动拼接
- [x] 任务空产出明确失败；任务拒绝人工 record
- [x] 删除越权降权/out-of-scope/只从镜头出发等边界文案，测试断言
- [x] 任意 team × domain 组合可用
- [x] 62/62 测试通过（新增 4 项任务模式/无边界测试）
