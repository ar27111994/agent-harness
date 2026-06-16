# Plan 012 — Recommend fast-fail when catalog absent (#303)

## Problem

`recommend report` (and `recommend ai-review`) would hang or silently score
zero entries when `discover/output/catalog.selected.jsonl` was absent or empty.
The root cause was `readJsonLinesFile` returning `[]` on ENOENT and passing
the empty slice into `buildRecommendationReport`, which ran the full scoring
loop — including a cold policy load from disk — against nothing.

In the agent-harness own repository this produced the symptom described in
#303: the command appeared to hang for tens of seconds before printing an
empty report.

## Fix

### `src/recommend/report.ts`

1. Added `CatalogEmptyError extends Error` — a named error class with a
   machine-readable `catalogPath` field and a user-actionable message
   referencing `discover full` / `discover select`.

2. Moved the catalog read to the **top** of `writeRecommendationReport`,
   before policy load and demand-profile read. This means the function
   throws `CatalogEmptyError` immediately when the catalog is absent or
   empty, avoiding all downstream I/O.

### `src/recommend/commands.ts`

Both `report` and `ai-review` sub-commands now wrap `writeRecommendationReport`
in a `CatalogEmptyError` catch block that:

- writes `error: <message>` to `process.stderr`
- returns exit code `1`

All other errors are re-thrown unchanged.

## Tests

| File                                   | Tests added                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/tests/recommend-report.test.ts`   | `CatalogEmptyError` thrown when catalog absent; thrown when catalog empty; both complete in < 1 s |
| `src/tests/recommend-commands.test.ts` | `runRecommend report` returns exit code 1 and writes actionable stderr when catalog absent        |

## Result

- `recommend report` with no catalog exits in ~10 ms instead of hanging.
- Exit code is `1`; stderr message guides user to run `discover full` or
  `discover select`.
- 40/40 targeted tests pass (19 report + 21 commands).
