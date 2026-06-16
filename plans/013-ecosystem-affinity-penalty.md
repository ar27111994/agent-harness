# Plan 013 — Strengthen Ecosystem Affinity Penalty (#278)

## Problem

Packagist PHP assets were appearing in the top-5 recommendations for
TypeScript/npm workspaces. The existing `ecosystemMismatchPenalty` (40 points,
configured in the policy) was applied as a flat value — but with `demandMatchCap
= 40`, a PHP package whose display name contains common JS tool tokens (eslint,
jest, node, lint) could reach a pre-penalty score of ~84 (8 authority + 30
compatibility + 40 demand + 6 source-priority), leaving a net score of 44 after
the 40-point deduction. That was high enough to beat lower-demand npm entries and
flood the top-20 across all hosts.

## Root Cause

`computeEcosystemMismatchPenalty` in `src/recommend/candidates.ts` returned
`penalty` (flat) whenever the workspace's detected package managers contained no
entry matching the registry's ecosystem family. A _total mismatch_ (workspace has
PM signals, none of which are from the wrong registry's ecosystem) was treated
identically to a _partial_ one. Since the demand cap can fully saturate the demand
score, the flat penalty was insufficient for registries with large entry counts and
semantically-overlapping package names.

## Fix

When a total mismatch is confirmed — i.e. the workspace _has_ PM signals
(`demandContext.packageManagers.size > 0`) AND none of them belong to the
registry's ecosystem — return `penalty * 2` instead of `penalty`.

**Effect with policy defaults (`ecosystemMismatchPenalty = 40`):**

| Entry type      | Pre-penalty score | Penalty | Net score |
| --------------- | ----------------- | ------- | --------- |
| PHP / packagist | 84 (max)          | 80      | 4         |
| PHP / packagist | 44 (typical)      | 80      | −36       |
| npm / correct   | 84 (max)          | 0       | 84        |

A PHP entry can no longer outrank an npm entry for an npm workspace.

**Backward compatibility:** The change only affects entries where
`sourceKind === "package-registry"`, `packageManagers.size > 0`, and the
workspace has _no_ matching PM signal. Partial-match workspaces (e.g. npm +
composer) are unaffected — PHP entries are correctly unpunished when the
workspace declares `composer`.

## Files Changed

- `src/recommend/candidates.ts` — `computeEcosystemMismatchPenalty` now returns
  `penalty * 2` for total mismatches; new `candidatesInternals` export exposes
  the function for focused unit tests.
- `src/tests/recommend-ecosystem-penalty.test.ts` — 10 tests covering:
  - 2× penalty for packagist, pypi, cargo in an npm workspace
  - 0 penalty when workspace has no PM signals (conservative / new workspace)
  - 0 penalty when registry matches workspace PM (npm ↔ npm, pip ↔ pypi)
  - 0 penalty for non-package-registry source kinds
  - 0 penalty for unmapped sourceIds
  - 0 penalty for partial match (npm + composer → packagist OK)
  - Report-level integration: 10 packagist entries with heavy keyword overlap
    do NOT appear in top 20 for any host; 5 npm entries do appear.

## Verification

```bash
node ./scripts/build.mjs
node --test dist/tests/recommend-ecosystem-penalty.test.js   # 10/10 pass
node --test dist/tests/recommend-report.test.js dist/tests/recommend-ecosystem-penalty.test.js dist/tests/recommend-evaluation.test.js dist/tests/recommend-fixtures.test.js dist/tests/recommend-counts.test.js   # 39/39 pass
npx eslint src/recommend/candidates.ts src/tests/recommend-ecosystem-penalty.test.ts --max-warnings=0   # clean
```

## Commit

```
fix(recommend): strengthen ecosystem-mismatch penalty for total registry mismatch (#278)
```
