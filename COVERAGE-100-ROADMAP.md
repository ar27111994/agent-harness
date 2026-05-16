# Coverage 100% Roadmap

Issue: [#207](https://github.com/ar27111994/agent-harness/issues/207)

## Current status

`npm run test:coverage` now exercises the release recommendation fixtures and the focused coverage-hardening suites added during the #207 pass. The latest verified local Windows run reports:

- statements: `99.70%` (`37297/37407`)
- branches: `98.32%` (`6628/6741`)
- functions: `100%` (`1105/1105`)
- lines: `99.70%` (`37297/37407`)
- tests: `642/642` passing

The generated gap ledger is down to `25` files with `110` uncovered lines and `113` uncovered branch edges. The `.c8rc.json` gate currently remains at statements `75`, branches `76`, functions `76`, and lines `75` because #207 is not complete until the intended covered runtime surface has a clearly justified target and branch coverage is no longer the limiting metric. The policy is unchanged: do not reach a target by excluding broad runtime surfaces.

## Target recommendation

Use staged coverage targets rather than jumping straight from the current floor to mandatory 100% on every metric:

1. **Next ratchet: `>=99.5%` across statements, branches, functions, and lines.** This is the best near-term quality gate because statements/lines/functions already support it, and branch coverage needs a focused but realistic residual pass.
2. **Follow-up ratchet: `>=99.9%` across all four metrics once the remaining branch ledger is mostly platform/I/O edge behavior.** This keeps pressure on real reliability gaps without rewarding brittle tests.
3. **Final state: `100%` only after `coverage/coverage-gaps.md` is empty for the intended covered runtime surface or every remaining non-runtime dispatch/generated gap has a narrow documented exclusion.** Do not set 100% thresholds while branch gaps still require impossible-state tests.

`>99%` is now too low to be a meaningful next checkpoint because statements and lines already exceed it and branch coverage is close enough that `>=99.5%` is the sharper target. `100%` remains the long-term cleanup objective, not the next safe threshold move.

## Reproducible gap inventory

After running coverage, generate the exact uncovered line/function/branch ledger with:

```bash
npm run test:coverage
npm run coverage:gaps
```

For the normal coverage gate, `npm run validate:coverage` builds, runs coverage, and refreshes the gap ledger in one command.

The generated file is written to `coverage/coverage-gaps.md` and is intentionally ignored with the rest of the coverage output. It lists every file with uncovered lines, uncovered function names, and uncovered branch ids from `coverage/lcov.info`.

Latest remaining high-value focus areas from the 99.70% / 98.32% branch run are:

- host/install/mirror line-and-branch residuals: `native-wire.ts`, `opencode.ts`, `vscode.ts`, `install/refresh.ts`, `install/bundle.ts`, and `mirror/acquire.ts`
- recommendation residuals: `recommend/policy.ts`, `recommend/commands.ts`, `recommend/ai-review.ts`, `recommend/evaluation.ts`, and `recommend/selection.ts`
- discovery branch-only and small line residuals: `github-harvester.ts`, `local-harvesters.ts`, `package-registry-harvester.ts`, `technology-signatures.ts`, `ai-enrichment.ts`, `catalog-selection.ts`, `official-index-harvester.ts`, `reference-source-harvester.ts`, and `source-sync.ts`
- utility branch-only gaps: `files.ts`, `lib/preflight.ts`, `lib/asset-prerequisites.ts`, and `lib/http.ts`

## Gap classification

| Priority | Gap class                                     | Current files                                                                                                                                                                                                                                                                                                                                                                                                                                 | Expected fix                                                                                                                                                                         |
| -------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0       | Host/install/mirror line-and-branch residuals | `src/host-adapters/native-wire.ts`, `src/host-adapters/opencode.ts`, `src/host-adapters/vscode.ts`, `src/install/refresh.ts`, `src/install/bundle.ts`, `src/mirror/acquire.ts`                                                                                                                                                                                                                                                                | Add temp-state integration tests for reset/rollback/conflict/preview branches; remove any duplicate defensive branches revealed as unreachable.                                      |
| P0       | Recommendation command and policy residuals   | `src/recommend/policy.ts`, `src/recommend/commands.ts`, `src/recommend/ai-review.ts`, `src/recommend/evaluation.ts`, `src/recommend/selection.ts`                                                                                                                                                                                                                                                                                             | Add command-level and policy-scenario tests for existing observable behavior; keep selection simplifications source-driven rather than relaxed fallback hacks.                       |
| P1       | Discovery harvester/classifier residuals      | `src/domains/discovery/ai-enrichment.ts`, `src/domains/discovery/catalog-selection.ts`, `src/domains/discovery/github-harvester.ts`, `src/domains/discovery/local-harvesters.ts`, `src/domains/discovery/official-index-harvester.ts`, `src/domains/discovery/package-registry-harvester.ts`, `src/domains/discovery/reference-source-harvester.ts`, `src/domains/discovery/source-sync.ts`, `src/domains/discovery/technology-signatures.ts` | Add deterministic fake-fetch and manifest fixtures for sparse, malformed, fallback, and no-result cases; remove branches that only defend against already-normalized internal state. |
| P1       | Utility branch-only residuals                 | `src/files.ts`, `src/lib/preflight.ts`, `src/lib/asset-prerequisites.ts`, `src/lib/http.ts`                                                                                                                                                                                                                                                                                                                                                   | Add table-driven tests for platform/path variants, optional diagnostics, and guarded-network failure shapes.                                                                         |
| P2       | Final 99.9% / 100% cleanup                    | Whatever remains after the `>=99.5%` ratchet                                                                                                                                                                                                                                                                                                                                                                                                  | Classify every remaining edge as reachable behavior, dead code, testability refactor, or narrow generated/dispatch-only exclusion before changing thresholds.                        |

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
