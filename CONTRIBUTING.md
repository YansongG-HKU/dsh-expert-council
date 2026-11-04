# Contributing

Thanks for taking the time to improve Expert Council for DeepSeek Harness.

## Ground rules

- One plugin, one source of truth: the catalogue and the ledger live in the Host (`lib/`); the panel (`client.js`) and the tool (`lib/tools.js`) must call the same `service` methods instead of re-implementing gates.
- Guards are product, not suggestions: if you add a rule (consent, evidence, budget, uniqueness), implement it in `lib/service.js` / `lib/custom.js` and add a test. Do not rely on prompt wording for correctness.
- Keep the token economy: the brief must only load the selected team's lenses; new content should be compact.
- Do not add a dependency unless it is unavoidable. The package currently ships with zero runtime dependencies.

## Development

```bash
# Node >= 22
node --check index.js client.js
node --test "test/*.test.mjs"
```

The test suite is the acceptance contract: 37 tests cover the protocol gates, budgets, customisation, consent, isolation, the tool, the command, the panel route and the client registration (static).

## What a good PR looks like

1. Write the failing test first (or alongside).
2. Implement the smallest mechanism that satisfies it.
3. Update `README.md` / `README.en.md` / `docs/SPEC.md` when behaviour or the contract changes.
4. Add a `CHANGELOG.md` entry under `[Unreleased]`.
5. Keep commits focused and describe the *why* in the body.

## Scope boundaries

- Expert Council is not an agent orchestrator: it never spawns DSH teammates and never uses Agent Teams tools. PRs that add agent-team coupling will be declined.
- The plugin stays user-gated: no feature may make the model convene a panel or edit the catalogue without an explicit user action or the user's own words.

## Reporting issues

Include: DSH version, plugin version, the exact command/tool call, what you expected, and the relevant ledger fragment (redact anything private). Security-relevant issues: please open a minimal private advisory via GitHub Security instead of a public issue.
