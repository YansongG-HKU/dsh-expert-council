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
