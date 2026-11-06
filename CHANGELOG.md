# Changelog

All notable changes to `dsh-expert-council` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

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
