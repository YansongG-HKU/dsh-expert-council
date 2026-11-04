# Expert Council · dsh-expert-council

> One sentence, a panel of experts, and a decision you can audit. Not "several chatbots": a protocol — independent opinions, evidence gates, cross-examination only on disagreement, recorded dissent, reversal triggers.

A plugin for [DeepSeek Harness](https://github.com/YansongG-HKU). The Host owns the expert roster, the user's customisation layer, the collaboration protocol, token budgets and the consult ledger; the Client renders the sidebar panel; the model gets one tool (`expert_council`), the human gets one command (`/experts`). All three write the same ledger.

**Three hard rules**

1. **User-gated only**: the model cannot convene a panel by itself. `/experts` and the panel are user actions; a model-initiated convene must carry `explicit_request:true` + `request_quote` (your own words) and is recorded as consent.
2. **Editable**: experts and team compositions can be changed any time — including in plain language, without knowing the fields.
3. **Isolated**: not the built-in DSH Agent Teams. It never spawns teammates, never calls `spawn_teammate` / `team_task_*`, and its "teams" are expert lenses plus a protocol.

## Why it is not just pretty UI

| Mechanism | How it is enforced |
| --- | --- |
| Expert definition | 14 lenses, each with `mandate / lens / asks / redLines / misses / budget`; `misses` records the lens's known bias, the panel shows it as "other lenses will cover this" |
| Independent first | Standard/deep panels write each lens separately; deep panels use anonymous peer review |
| Evidence gate | Every claim needs evidence; unevidenced claims are downgraded to assumptions and lower the verdict's coverage score |
| Disagreement only | `record` detects stance conflicts and confidence gaps (≥0.45); a verdict that ignores a proven disagreement is rejected unless `force` is set |
| Dissent on record | Verdicts must carry `dissent / unresolved / reversalTriggers / actions`; dissent cannot be empty when a disagreement was proven |
| Budget hard cap | Three depths with per-expert budgets, whole-consult caps, over-budget warnings, and only the selected lenses are loaded |
| Decision ledger | Consults are persisted (`consults.json`) with rounds, opinions, disagreements, verdict, tokens; a verdict can never be overwritten |
| Three entry points, one service | Tool, command and panel call the same `service` — one gate implementation, no drift |

## Screenshots

![Overview: templates, panel sizes, NL adjustment](docs/assets/overview.png)
![One-sentence adjustment and recent changes](docs/assets/recent-changes.png)
![Team editor: members, single chair, three budgets](docs/assets/team-editor.png)
![Consult verdict: decision, confidence, dissent](docs/assets/verdict.png)

## Usage

### In a session

- `/experts` — list teams and how to use them
- `/experts experts` — list all expert lenses
- `/experts architecture` — inspect a team (members, agenda, budgets)
- `/experts architecture should we split export into a service?` — open a consult, get the brief
- `/experts 调整 add a privacy expert and put them in the security panel` — plain-language customisation brief

### From the panel

Sidebar 「专家团」 → pick a team → fill the question (optional context / depth / budget cap) → convene: a new session starts with the brief. Or use 「用一句话调整」 to describe a change and let the assistant apply it.

### Plain-language customisation

You do not need to know the config. Say what you want; the plugin turns it into a field-level brief (your words + current catalogue + allowed actions + field reference + rules + examples) and the model applies it through guarded writes:

- Panel: 「用一句话调整」 → 「交给专家团助手」
- Command: `/experts 调整 <one sentence>`
- Tool: `expert_council({action:'customize', request:'<your sentence>'})`

Model-side catalogue writes require `request_quote`; every change is recorded in `customization.json` history and shown under 「最近调整」; reset restores the shipped catalogue.

## Teams and experts

8 presets: architecture review, security review, product decision, code review, research review, incident retro, shipping review, red/blue debate.
14 lenses: architect, security, SRE, performance, data, product, UX research, cost & ops, legal & compliance, domain expert, skeptic / red team, integrator (chair), researcher, operator.

Presets are data in `lib/experts.js` / `lib/teams.js`; user changes live in an override layer.

## Token economy

- Only the chosen team's lenses are rendered into the brief.
- Three depths: `lean` (single pass, ~34% of the standard budget), `standard` (independent opinions + one cross-examination round), `deep` (parallel independent + anonymous peer review, ~2.6×).
- `budget_cap` overrides the whole-consult cap (200–20000); every `record` reports real tokens and `overBudget`; `verdict` summarises and warns.
- Default advice: lean for routine reviews, standard for real decisions, deep only for irreversible/high-cost ones.

## Install

```bash
# install into your DSH profile and enable the bundle
pnpm --dir <profile> add link:/path/to/dsh-expert-council
```

Then add `dsh-expert-council` to `dsh.profile.bundles` in the profile `package.json` (or let the plugin manager do it). After a reload: the sidebar panel appears, `/experts` works, and the `expert_council` tool is registered for new sessions.

## Tests

```bash
node --check index.js client.js
node --test "test/*.test.mjs"
```

37 tests cover protocol gates, budgets, consent, customisation, isolation, the tool, the command, the panel route and the client registration.

## Boundaries

- It does not do "majority vote wins": the chair decides and must answer every dissent.
- It is not an agent orchestrator; `deep` panels never spawn subagents silently.
- No network access, no third-party code execution; all state is local files under `$DSH_HOME/expert-council/`.

## Design lineage

Independent-first review and anonymous peer review follow the LLM-council idea ([council-review](https://github.com/ngmeyer/council-review)); role/mandate separation follows BMAD-METHOD's agent-persona approach; evidence gates, dissent records and reversal triggers come from engineering review and audit practice. No code was copied; this is an independent MIT implementation.

## License

MIT © YansongG-HKU
