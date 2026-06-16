# Plan 011 — `recommendations` key absent from `state/recommendations.json` (#283)

## Problem

`state/recommendations.json` was missing the top-level `recommendations` array
when read by any consumer that checked for the key directly. The file always
contained `topByHost`, `hostSummaries`, and `suggestedBundles` — but
`recommendations` was never asserted to be present by any test.

`assertRecommendationReport` silently backfilled `recommendations: []` when the
key was absent (a legacy shim for pre-v2.0.0 state files), masking any write-path
regression from tests. The self-hosting smoke test only checked `topByHost`.

## Root Cause

The write path (`buildRecommendationReport` → `writeRecommendationReport`) was
correct and always included `recommendations` in the returned object. The bug
was the absence of any test that verified the key was present _in the written
file_ before the validator's backfill applied. A write-path regression would
have been invisible.

## Fix

1. **`recommend-report.test.ts`** — in the existing
   `writeRecommendationReport persists built report` test, added two assertions
   before calling `assertRecommendationReport` on the raw parsed JSON:
   - `hasOwnProperty(persisted, "recommendations")` — key must be present in
     the file (before any backfill)
   - `Array.isArray(persisted.recommendations)` — must be an array

2. **`self-hosting.ts`** — added `recommendations?: unknown[]` to
   `SelfHostingRecommendationReport` and added an `Array.isArray` assertion
   to the self-hosting smoke test.

3. **`recommendation.ts` (validator)** — updated the backfill comment to
   explain that the shim exists for pre-v2.0.0 state files (activate.ts compat)
   and that new writes must always include the key (enforced by write-path tests).

## No behavior change

The validator backfill is intentionally preserved — `activate.ts` reads
`state/recommendations.json` with `readJsonFileOrNull` and must handle old files
gracefully. The fix adds enforcement at the write-path test level.

## Validation

- Build clean
- 17/17 `recommend-report.test.js` tests pass (includes the new key-presence assertions)
- ESLint clean on all 3 changed files
