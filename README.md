# 专家团 · dsh-expert-council

[![CI](https://github.com/YansongG-HKU/dsh-expert-council/actions/workflows/ci.yml/badge.svg)](https://github.com/YansongG-HKU/dsh-expert-council/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](package.json)

> 一句话，召集一群专家给你做一次**有纪律**的评审。不是多开几个聊天，而是一套协议：独立成稿、证据门槛、只谈分歧、异议留档、裁决可复查。

[English](README.en.md) · [规格](docs/SPEC.md) · [更新日志](CHANGELOG.md) · [贡献指南](CONTRIBUTING.md)

DeepSeek Harness 插件（MIT 开源）：https://github.com/YansongG-HKU/dsh-expert-council

> **兼容性（DSH 0.2.2-rc.1）**：只读了 0.2.2 的公开接口变更（tools / systemPrompt / commands / webServer / slots / locale）并逐条核对，无破坏性变化；37/37 测试通过，真实桌面运行时正常注册 `expert_council` 工具、`/experts` 命令与面板。

Host 拥有专家镜头名册、用户自定义层、合作规范、token 预算与决策台账；Client 提供侧边栏面板与详情页；模型侧有一个工具 `expert_council`，人类侧有一条命令 `/experts`。三者写同一份台账。

**三条硬规则：** ① 只在你明确呼叫时使用（模型不得主动召开，工具层会拒绝）；② 专家角色与团队构成可以随时改、改完即时生效、可重置；③ 与 DSH 自带的智能体团队（Agent Teams）完全隔离，不共用名字、不创建子代理。

## 截图

![概览：模板、专家、会诊与一句话调整](docs/assets/overview.png)
![一句话调整与最近调整](docs/assets/recent-changes.png)
![团队编辑器：成员多选、唯一主持、三档预算](docs/assets/team-editor.png)
![会诊裁决：结论、置信度、异议与推翻条件](docs/assets/verdict.png)

## 为什么它不是「表面好看」

| 机制 | 落地方式（不是提示词口号） |
| --- | --- |
| 专家定义 | 14 个镜头，每个都有 `mandate / lens / asks / redLines / misses / budget`；`misses` 明确写出每个镜头的盲区，面板把盲区作为「其他镜头会补」展示 |
| 独立先行 | 标准/深会诊先逐位成稿，深会诊用匿名编号互评；意见落库时记录 stance/confidence/claims |
| 证据门槛 | 每条 claim 必须带 `evidence`；无证据的意见被降级为「假设」，工具返回 `evidenceWarnings` 并在裁决时计入覆盖率 |
| 只谈分歧 | `record` 自动检测立场冲突与置信度差距（≥0.45），产出 `disagreements`；裁决时存在分歧却无 `dissent` 会被**拒绝**（带 force 也要写明理由） |
| 异议留档 | 裁决 JSON 必含 `dissent / unresolved / reversalTriggers / actions`；存在分歧时 dissent 不可为空 |
| 越权降权 | 专家只能在自己的镜头内计票；越界意见标 out-of-scope（协议第 5 条） |
| 预算硬顶 | 三档预算（lean/standard/deep），按团队与人数计算每人额度；`record` 统计实际 token，超支 20% 返回 `overBudget`；brief 里写明到顶即停 |
| 决策台账 | 会诊持久化到 `consults.json`：轮次、意见、分歧、裁决、token；`get/list/archive` 可复查；禁止覆盖已裁决的会诊 |
| 三入口一致 | `/experts`、面板、`expert_council` 工具全部调用同一个 `service`，门禁只有一份实现 |
| 显式调用门禁 | 模型主动 `convene` 会被拒绝；必须带 `explicit_request:true` + `request_quote`（用户原话），或由 `/experts` / 面板发起；同意记录写入 consult 台账 |
| 可自定义 | 专家与团队是「预置代码 + 用户数据」两层：可新增、可覆盖内置、可隐藏、可重置；面板编辑或 `save_expert` / `save_team` 写入 `customization.json`，立即生效 |
| 与内置团队隔离 | 独立命名空间（`expert_council` / `/experts` / `dsh-expert-council` / `expert-council`）；不 import Agent Teams 服务、不调用 `spawn_teammate` / `team_task_*`、不创建子代理；`checkIsolation()` 有测试兜底 |

## 谁能用、什么时候用（显式调用）

- 你明确发起才算数：`/experts <团队> <问题>`、面板「召开会诊」、或对话里点名「用专家团…」。
- 模型不能自作主张：默认提示词是**被动**的；工具 `convene` 不带 `explicit_request` + `request_quote` 会被拒绝，错误信息会要求它改由你发起。
- 每次会诊的 `consent` 都记进台账（`user-action` / `explicit-request` + 原话），事后可查是谁发起的。
- 读动作（`teams/experts/get/list`）不受门禁影响；它们只用于回答你的点名请求。

## 三种打开方式

1. **斜杠命令**（会话里最轻）：
   - `/experts` — 看团队清单与玩法
   - `/experts experts` — 看全部专家镜头定义
   - `/experts architecture` — 看团队议程/成员/预算
   - `/experts architecture 要不要把导出拆成独立进程？` — 直接立案，拿到会诊简报（由你发起）
2. **面板**：侧边栏「专家团」→ 选团队 → 填问题（可选背景/档位/预算上限）→「召开会诊」→ 新会话带着简报开始，模型按协议逐轮写回。
3. **模型工具**：会话里点名「叫专家团评审一下 X」后，模型调用
   `expert_council({action:'convene', team_id, question, explicit_request:true, request_quote:'<你的原话>'})` → `record` → `verdict`。
   不点名就不会发生：模型主动调用会被工具层拒绝。

## 自定义专家与团队

- 面板里可以：新建/编辑专家（职责、镜头、必问、红线、**盲区**、互补、预算）、新建/编辑团队（成员、恰好一个主持、议程、产出物、三档预算）、隐藏内置模板、重置回出厂。
- 数据落在 `$DSH_HOME/expert-council/customization.json`；内置名册仍由代码提供，改内置=写入同 id 的覆盖层（标记 `custom:true`，`preset:true`），不会修改代码。
- 模型侧也可写：`expert_council({action:'save_expert', expert:{...}, request_quote:'<你的原话>'})`、`save_team`、`delete`、`reset({confirm:true})`；校验在 service 层（id、必填、成员存在、单主持、预算单调）。
- 删除专家会自动从自定义团队里摘除并报告受影响团队；团队没人时会标记 `incomplete` 且拒绝召开。
- 每次改动都会写入 `history`（谁、什么动作、你的原话、影响），面板「最近调整」可查。

## 用一句话调整（不用懂配置）

不会字段/预算/主持人这些概念也没关系：直接用自然语言描述你要什么。

1. **面板**：列表页「用一句话调整」→ 填一句话（或点示例 chip）→「交给专家团助手」→ 新会话带着字段级简报开工，模型用工具把改动落到目录里，面板 3 秒内自动刷新；「最近调整」会记录改了什么、依据你哪句话。
2. **命令**：`/experts 调整 加一个只看数据授权的合规专家，并放进安全评审团` —— 直接返回同一份简报，交给模型执行即可。
3. **模型工具**：`expert_council({action:'customize', request:'<你的原话>'})` 拿到简报，再用 `save_expert` / `save_team` / `delete`（均带 `request_quote`）落库。

安全边界：模型侧任何目录写入同样需要 `request_quote`（你的原话）；破坏性操作（删除/重置/覆盖内置）在简报规则里要求先说明影响；所有改动可一键重置回出厂。

## 团队预置（8 个）

| id | 名称 | 成员 | 默认档 |
| --- | --- | --- | --- |
| `architecture` | 架构评审团 | architect / security / sre / performance / cost | standard |
| `security-review` | 安全评审团 | security / skeptic / sre / legal | standard |
| `product-decision` | 产品决策团 | product / ux / data / cost / skeptic | standard |
| `code-review` | 代码评审团 | architect / security / performance / skeptic | lean |
| `research-review` | 研究评议团 | domain / researcher / data / skeptic | standard |
| `incident-retro` | 事故复盘团 | sre / security / operator / data | standard |
| `shipping` | 上线评审团 | operator / sre / security / product | lean |
| `debate` | 红蓝对抗团 | skeptic / domain / architect / integrator | deep |

## 专家镜头（14 个）

结构：`architect` 架构师、`performance` 性能工程师、`data` 数据科学家、`researcher` 研究者；
风险：`security` 安全专家、`sre` 可靠性工程师、`legal` 合规与法务、`skeptic` 质疑者（红队）；
用户：`product` 产品负责人、`ux` 用户研究员、`domain` 领域专家；
执行：`cost` 成本与运营、`integrator` 综合者（主持）、`operator` 落地与运维。

每个镜头的完整定义在 `lib/experts.js`；团队在 `lib/teams.js`；两者都是数据，加人/加团队不改流程代码。

## Token 经济

- **只加载选中的镜头**：brief 只渲染本团专家卡，不加载 14 个镜头全集。
- **三档**：`lean`（单轮多镜头，约 34% 预算）、`standard`（独立意见 + 一轮交叉质询）、`deep`（并行独立 + 匿名互评，约 2.6×）。
- **可调**：`budget_cap` 覆盖总量（200–20000 token）；brief 给出每人额度与裁决预留。
- **记账**：每次 `record` 返回实际 token、`overBudget`；`verdict` 汇总总量并告警。
- 默认建议：日常评审用 lean；只有不可逆/高成本决策才升 standard/deep。

## 安装与启用

```bash
# 在工作区安装（link: 或本地 spec），随后在 profile 里启用 bundle
pnpm --dir <profile> add link:F:\dsh插件创造\workspace\dsh-expert-council
```

启用后：侧边栏出现「专家团」，`/experts` 可用，`expert_council` 工具注册到所有会话。

## 数据

- `$DSH_HOME/expert-council/consults.json`：会诊台账，含 `consent`（谁发起、原话）、`budget`、`rounds`、`disagreements`、`verdict`、`tokens`；原子写入、上限 200 条。
- `$DSH_HOME/expert-council/customization.json`：你的专家/团队覆盖层（`experts` / `teams` / `hiddenExperts` / `hiddenTeams`），与台账分开存，坏一个不影响另一个。

## 验收

```bash
node --check index.js
node --test "test/*.test.mjs"
```

## 设计来源（集百家之长，代码原创）

- 独立先写、匿名互评：Karpathy 式 LLM Council（[council-review](https://github.com/ngmeyer/council-review)）的思想；
- 角色/职责拆分：BMAD-METHOD（[bmad-method](https://www.npmjs.com/package/bmad-method)）的 agent persona 思路；
- 证据门槛、异议档案、推翻条件：工程评审与审计实践。

均未复制代码；本插件为独立实现（MIT）。

## 本轮验收证据

- 自动化：`node --test "test/*.test.mjs"` → **37/37**（core 6 + service 6 + api 3 + custom 6 + customize 6 + client 10）；`smith verify` L0 20 文件语法 + L1 全过。
- 活体（已装入 desktop profile，真实模型 + 真实工具）：
  - **自然语言调整**：面板 `nl-request` 返回 2,139 字符字段级简报（原话 + 目录 + 四种动作 + 规则 + 示例），不改目录；工具 `customize` 返回同一份；隔离实例点示例 chip → 填入 → 立案 → 新会话带简报（截图 `docs/assets/`）。
  - **写入门禁**：模型 `save_expert` 不带 `request_quote` 被拒（原文：「调整专家团也需要你的原话…」）；带原话成功并写 `history{actor:'agent', action:'expert-create', request:…}`；`delete` 同样留痕（`expert-delete`）。
  - **显式调用**（V0.2 已验，仍有效）：模型无原话 `convene` 被拒；带 `explicit_request:true` + `request_quote` 放行并落 `consent`。
  - **自定义**（V0.2 已验）：保存专家/团队、覆盖内置、隐藏、`reset-custom` 回 14/8 默认，`history` 记录重置。
  - **隔离**：`checkIsolation()` 零碰撞；面板/brief/提示词均写明与内置 Agent Teams 无关。
- 浏览器验收（隔离实例，仓库内截图 `docs/assets/`）：团队/专家编辑器、被动同意条、一句话调整区、最近调整（9 种动作标签、原话、actor、时间）、375 同序堆叠。
- 过程中发现并修复的机制问题：工具缺 `output` 契约会被 dsh-tools 静默拒绝；分歧检测跨轮累积；删除自定义专家会误加 hidden 列表（均已补测试）。

## 与 DSH 智能体团队的边界

- 本插件**不是** Agent Teams：不注册/不调用 `spawn_teammate`、`team_task_*`、`send_message` 等内置工具，不创建、不调度、不结束任何子代理。
- 这里的「团队」只是镜头集合 + 会诊协议，每次会诊由当前会话的主模型按镜头逐条写成，不产生并行代理。
- 命名空间独立：工具 `expert_council`、命令 `/experts`、面板 id `dsh-expert-council`、数据目录 `expert-council`、会诊 id 前缀 `ec-`；`lib/isolation.js` 集中声明并用测试断言不与内置 Agent Teams 名字冲突。
- 若将来内置 Agent Teams 也提供「专家团」类面板，两者数据、入口、台账完全独立，不会互相覆盖。

## 边界

- 不做「自动投票取胜」：裁决由主持给出并必须回应异议，分歧不会被平均掉。
- 不替代真实专家：`deep` 模式下的并行子代理仍由调用方决定（本插件负责协议、预算与落账）。
- 不碰网络、不执行第三方代码；审计/令牌只做本地统计。

## 版本

- `0.3.0`：自然语言调整（面板「用一句话调整」/ `/experts 调整` / `customize` 简报 + 变更历史），界面分区捋顺。
- `0.2.0`：显式调用门禁（consent 落库）、专家/团队自定义（面板 + 工具，覆盖内置、隐藏、重置）、与内置 Agent Teams 的隔离边界。
- `0.1.0`：首次发布（14 镜头、8 团队、7 铁律、三档预算、三入口、决策台账）。

