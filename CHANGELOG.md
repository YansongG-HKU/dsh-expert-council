# Changelog

All notable changes to `dsh-expert-council` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [0.4.0] — 2026-11-07

### Added

- **真实会诊（real panel execution）**：`action=run` 不再让调用模型角色扮演，Host 自己按镜头为每位专家并行发起一次独立模型调用；随后只对**已证实的分歧**做交叉质询（最多 4 位）、深会诊再加匿名同行评议，最后主持模型输出裁决。每次调用都有超时、重试、JSON 契约与一次修复重试。
- **6 个专业领域评审团**（`finance / legal / healthcare / engineering / research / security`）：每个领域 5 位专家、独立证据等级阶梯（A–E）、必须核验项、红旗清单和交付物清单；`domains` 动作、面板领域卡与 `/experts domains` 都能看到。领域团队 id 如 `finance-review`。
- **会诊报告（Markdown）**：8 节完整报告（结论、专家意见表、分歧与交叉质询、异议、未决/推翻条件、行动项、领域交付物核对、运行明细），落盘到 `runs/<runId>.md`，可通过 `action=report`、面板「查看/下载 Markdown」或 `GET /expert-council/api/report?id=` 获取。
- **可观测与可恢复**：运行阶段进度（独立成稿 → 交叉质询 → 同行评议 → 主持裁决）、逐专家状态/耗时/用量、法定人数、失败专家、超预算与降级告警；`run_status` 轮询、`cancel_run` 取消；主持输出不可解析时先尝试从截断 JSON 抢救结论，再退回按意见统计的「降级裁决」（报告中显式标注，需人工复核）。
- **推理模型适配**：识别"输出额度全部被推理占用、无可见文本"的情况，自动提高输出预算并降低推理强度重试一次；对不支持 reasoning effort 的适配器自动降级。
- `/experts run <领域|团队> <问题>`：一条命令完成立案 + 真实会诊；`/experts domains` 列出专业领域。

### Changed

- 专家/团队目录合并为 8 个通用团队 + 6 个领域团队、14 个通用专家 + 30 个领域专家（共 44 个镜头）；自定义层与原有接口保持兼容。
- 面板新增专业领域区、真实会诊时间线、取消、报告弹窗与下载、逐专家状态表；最近会诊显示领域/运行状态/用量/报告标记；自定义专家可标注所属领域。
- 会诊简报说明真实执行方式（Host 并行调用，不是子代理），并明确预算为软上限、推理 token 计入实际用量。
- `consult.run` 增加 `expertStatuses` 与 `reportAvailable`，面板不再需要推断。

### Fixed

- `prepared.stream()` 必须携带 prepareCall 的 resolved config（含适配器默认值），修复真实模型 "prepared LLM call config changed"。
- 修复重试不再伪造 assistant 消息（缺少 provider replay metadata 会导致适配器 `replayState` 报错），改为把草稿作为 user 反馈。
- 真实会诊给每位专家/主持留出足够输出额度（专家 ≥1200、主持 ≥3500），避免推理模型把额度烧在思考上导致空回复。

### Verified

- `node --test "test/*.test.mjs"` → **58/58**（新增 14 项真实运行编排测试：并行独立性、JSON 修复、法定人数、取消、主持强制异议修复、lean、报告落盘、工具链路、领域元数据、空文本重试、截断裁决抢救、降级裁决、领域字段持久化等）。
- 真实桌面运行时（DSH 0.2.2-rc.1 + deepseek-account/deepseek-flash）的标准金融会诊：5 位专家并行 + 4 路交叉质询 + 主持裁决，45.5s、16,857 tok，产出「不做」裁决、3 处分歧、1 条异议、推翻条件与行动项，报告 8 节完整落盘。

## [0.3.1] — 2026-11-06

### Changed

- **DSH 0.2.2-rc.1 compatibility.** Declared `engines.dsh: ">=0.2.2-rc.1"`; README states the verified compatibility line.
- No behavioural change: `tools.register`, `systemPrompt.section`, `commands.register`, `webServer.register`, `slots` and `locale` are unchanged in 0.2.2-rc.1.

### Verified

- 37/37 tests pass; the `expert_council` tool, `/experts` command and sidebar panel register on the live 0.2.2-rc.1 desktop runtime.

## [0.3.0] — 2026-11-05

### Added

- **Plain-language customisation**: describe what you want ("add a privacy expert and put them in the security panel") instead of editing fields. The panel's 「用一句话调整」 box, `/experts 调整 <sentence>`, and the `customize` tool action all return the same field-level brief (your words, current catalogue, allowed actions, field reference, rules, examples), then the model applies it through the guarded write actions.
- **Customisation history**: every catalogue write (create/override/delete/hide/reset) appends `{actor, action, id, request, summary}` to `customization.json`; the panel shows 「最近调整」 with the user's own words.
- Panel layout regrouped into 概览 → 用一句话调整 → 最近调整 → 专家团模板 → 最近会诊.

### Changed

- Model-side catalogue writes now require `request_quote` (the user's own words), matching the convene consent model.
- Deleting a custom-only expert no longer pollutes the hidden-preset list.

## [0.2.0] — 2026-11-05

### Added

- **Explicit-use consent gate**: the model cannot convene a panel on its own; `convene` requires `explicit_request:true` + `request_quote` unless the user started it via `/experts` or the panel. Consent is stored on the consult record.
- **Editable experts and teams**: create/override/hide/reset from the panel or via `save_expert` / `save_team` / `delete` / `reset`; presets stay in code, user changes are an override layer in `customization.json`.
- **Isolation boundary** against DSH's built-in Agent Teams (`lib/isolation.js`): separate names, no agent-team service imports, no teammate spawning, tested zero collision.

### Fixed

- Tool silently failing to register when `definition.output` was missing (dsh-tools rejects such definitions).
- Disagreement detection accumulating across rounds (duplicate pairs / self-pairs).

## [0.1.0] — 2026-11-05

### Added

- 14 expert lenses (mandate, lens, must-ask questions, red lines, known blind spots, budget) and 8 team presets with exactly one chair.
- 7 protocol rules, 4 stages (define → independent → cross → verdict; lean/deep variants), opinion/verdict JSON contracts.
- Token economy: three depths (lean/standard/deep), per-expert budgets, hard caps, only the selected lenses are loaded into the brief.
- Three entry points over one service: `expert_council` tool, `/experts` command, sidebar panel with the same catalogue and ledger.
- Durable consult ledger (`consults.json`), archive/read actions, no overwriting a verdict.
