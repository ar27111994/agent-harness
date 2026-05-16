# Coverage 100% Roadmap

Issue: [#207](https://github.com/ar27111994/agent-harness/issues/207)

## Current status

`npm run test:coverage` now exercises the release recommendation fixtures and the focused coverage-hardening suites added during the #207 pass. The latest verified local Windows run reports:

- statements: `99.22%` (`37148/37439`)
- branches: `94.63%` (`6294/6651`)
- functions: `99.90%` (`1102/1103`)
- lines: `99.22%` (`37148/37439`)
- tests: `591/591` passing

The `.c8rc.json` gate currently remains at statements `75`, branches `76`, functions `76`, and lines `75` because #207 is not complete until the intended covered runtime surface reaches a clean 100%. The gap ledger is now small enough to drive the rest of the work directly from uncovered line/branch/function IDs, but the policy is unchanged: do not reach 100% by excluding broad runtime surfaces.

## Reproducible gap inventory

After running coverage, generate the exact uncovered line/function/branch ledger with:

```bash
npm run test:coverage
npm run coverage:gaps
```

For the normal coverage gate, `npm run validate:coverage` builds, runs coverage, and refreshes the gap ledger in one command.

The generated file is written to `coverage/coverage-gaps.md` and is intentionally ignored with the rest of the coverage output. It lists every file with uncovered lines, uncovered function names, and uncovered branch ids from `coverage/lcov.info`.

Latest remaining high-value focus areas from the 99.22% run are:

- discovery ranking/detection residuals: `catalog-selection.ts`, `demand-signals.ts`, `local-harvesters.ts`, `reference-harvesters.ts`, `official-index-harvester.ts`, and `source-sync.ts`
- host/install/mirror edge branches: `native-wire.ts`, `opencode.ts`, `vscode.ts`, `install/bundle.ts`, `install/refresh.ts`, and `mirror/acquire.ts`
- recommendation residuals: `recommend/ai-review.ts`, `recommend/commands.ts`, `recommend/policy.ts`, and `recommend/selection.ts`
- branch-only utility gaps: `files.ts`, `github.ts`, `official-index.ts`, `lib/http.ts`, `lib/preflight.ts`, `lib/asset-prerequisites.ts`, and `lib/session-intent.ts`

## Gap classification

| Priority | Gap class                                                  | Files                                                                                                                                                                                                                                                                                                                                              | Expected fix                                                                                                                                                   |
| -------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Host/runtime orchestration with very low function coverage | `src/host-adapters/vscode.ts`, `src/install/bundle.ts`, `src/install/generations.ts`, `src/install/native.ts`, `src/install/state.ts`, `src/mirror/plan.ts`, `src/mirror/inspect.ts`, `src/asset-content.ts`, `src/pipeline.ts`                                                                                                                    | Add temp-state integration tests for plan/build/write/reset paths; remove unreachable branches discovered by those tests.                                      |
| P0       | CLI command modules with untested success/error branches   | `src/recommend/commands.ts`, `scripts/check-version-sync.mjs`, `scripts/sync-github-release.mjs`                                                                                                                                                                                                                                                   | Add command-level tests with mocked filesystem/env/process boundaries; keep actual network/GitHub writes mocked.                                               |
| P1       | External I/O adapters and harvesters                       | `src/github.ts`, `src/lib/http.ts`, `src/domains/discovery/github-harvester.ts`, `src/domains/discovery/package-registry-harvester.ts`, `src/domains/discovery/official-index-harvester.ts`, `src/domains/discovery/reference-source-harvester.ts`, `src/domains/discovery/source-sync.ts`, `src/mirror/acquire.ts`, `src/mirror/acquire-state.ts` | Expand deterministic fake-fetch/DNS/filesystem tests for timeout, retry, cache, stale-state, partial-failure, cap, and degraded-mode branches.                 |
| P1       | Recommendation/enrichment workflow coverage                | `src/recommend/ai-review.ts`, `src/recommend/evaluation.ts`, `src/recommend/policy.ts`, `src/recommend/report.ts`, `src/recommend/selection.ts`, `src/recommend/candidates.ts`, `src/recommend/signals.ts`, `src/recommend-fixtures.ts` branch coverage                                                                                            | Add scenario fixtures for every reason/confidence/override branch; keep policy tuning evidence-driven with `recommend explain` and `validate:recommendations`. |
| P1       | Manifest/discovery validators and classifiers              | `src/manifest-validation/*.ts`, `src/domains/discovery/demand-signals.ts`, `src/domains/discovery/catalog-selection.ts`, `src/domains/discovery/catalog-utils.ts`, `src/domains/discovery/source-index.ts`, `src/domains/discovery/source-utilization.ts`, `src/domains/discovery/technology-signatures.ts`                                        | Add table-driven malformed/minimal/legacy manifest cases and false-positive/false-negative detection fixtures.                                                 |
| P2       | Host adapter edge branches                                 | `src/host-adapters/native-config.ts`, `src/host-adapters/native-wire.ts`, `src/host-adapters/opencode.ts`, `src/host-adapters/registry.ts`, `src/host-adapters/vscode-settings.ts`, `src/host-adapters/extension-installer.ts`                                                                                                                     | Add fixture-backed tests for every host-native file bucket, unsupported kind, reset, merge, conflict, and CLI verification path.                               |
| P2       | Utility branch completion                                  | `src/files.ts`, `src/config/env-file.ts`, `src/config/runtime.ts`, `src/lib/asset-prerequisites.ts`, `src/lib/cli-output.ts`, `src/lib/paths.ts`, `src/lib/preflight.ts`, `src/lib/safe-paths.ts`, `src/lib/session-intent.ts`, `src/lib/shared-mcp.ts`, `src/package-registries.ts`, `scripts/release-notes.mjs`                                  | Add small table-driven tests for missing input, invalid input, platform/path differences, and optional-field branches.                                         |

## Exclusion policy

Current `.c8rc.json` exclusions are limited to:

- generated test/type files under `dist/tests/**` and `dist/types/**`
- top-level compiled CLI entrypoints under `dist/*.js` that only dispatch into tested modules

Do not add runtime module exclusions to make the percentage green. If a file appears impossible to cover cleanly, first classify it as:

1. legitimate dead code to remove,
2. a testability gap requiring dependency injection/refactor,
3. missing regression coverage, or
4. generated/dispatch-only code that belongs in `.c8rc.json` with a documented reason.

## Completion checklist for closing #207

- `npm run coverage:gaps` reports no uncovered lines, functions, or branches for the intended covered runtime surface.
- Any newly excluded file is documented above with a concrete reason and is dispatch-only/generated rather than runtime logic.
- `.c8rc.json` thresholds are raised to `100` for statements, branches, functions, and lines only after the report is clean.
- `npm run test:coverage` passes locally on Windows and in CI.
- `npm run validate:release` passes after the threshold change.
