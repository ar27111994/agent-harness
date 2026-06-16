# Plan 014 — Per-source entry cap in catalog selection (#304)

## Problem

When a project workspace was synced against an indexed package registry that
happened to contribute a very large number of entries (e.g. a Packagist sync
run before the `SOURCE_SYNC_INDEXED_REGISTRY_ENTRY_CAP` fix in `#286` landed),
the `discover select` output could be dominated by a single source. Even with
the score-based sort, a source contributing 80%+ of the selected set degraded
diversity noticeably and caused downstream recommendation noise.

## Root cause

`generateSelectionOutputs` applied demand-relevance filtering and deduplication
but had no per-source ceiling. A source with tens of thousands of
demand-relevant entries could flood `catalog.selected.jsonl`.

## Fix

### New env variable

`AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE` (default **200**) — positive integer.
Parsed with `parseSelectionPositiveIntegerEnv`, which falls back to the default
for absent, empty, zero, negative, or non-integer values.

### Implementation — `src/discover.ts`

Two pure helper functions extracted for direct unit testing:

#### `applyPerSourceCap(entries, maxPerSource)`

Visits entries in insertion order (which is the post-dedup order, maintained
from the upstream demand-relevance filter). For each entry, increments a
per-`sourceId` counter; once the counter reaches `maxPerSource`, the entry is
added to a `capped` array instead of `kept`.

Returns `{ kept, capped }` — `kept` preserves original order; `capped` is an
array of `{ assetId }` objects for rejection-log injection.

Called inside `generateSelectionOutputs` **after** the dedup loop so source-cap
is the last filter, acting on the final ordered set. Each capped entry is
pushed to `rejectionLog` with `reason: "source-cap"`.

#### `computeSourceDiversityWarning(cappedEntries, maxPerSource)`

Scans the already-capped set and returns a human-readable warning string when
any single source exceeds **20%** of the total. Returns `undefined` otherwise
(including when the input is empty).

The warning names the source ID, its percentage, its count/total, and the
current `maxPerSource` value so the operator knows which env var to adjust.

Only the worst offender is reported (first to exceed the threshold in map
iteration order).

### New `rejectionSummary` reason

`"source-cap"` added to the JSDoc on `SelectionReport.rejectionSummary` so
consumers know this reason is stable.

### New optional field

`SelectionReport.sourceDiversityWarning?: string` — populated in the selection
report when `computeSourceDiversityWarning` returns a non-undefined value. The
validator in `assertSelectionReport` accepts the optional field without
requiring it.

### `discoverInternals` export

Both helpers plus the env parser are exported via `discoverInternals` at the
bottom of `src/discover.ts`, following the pattern established by
`candidatesInternals` in `src/recommend/candidates.ts`.

## Tests — `src/tests/discover-source-cap.test.ts`

| #   | Scenario                                                               | Assertion                                                         |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | 5 000-entry source A + 100-entry source B, cap=200                     | `kept` from A = 200; `kept` from B = 100; `capped.length` = 4 800 |
| 2   | Well-diversified 3-source set under cap                                | All 150 entries kept; `capped` empty                              |
| 3   | cap = 1                                                                | Exactly 1 entry per source kept; rest in `capped`                 |
| 4   | Empty input                                                            | Both `kept` and `capped` empty                                    |
| 5   | Insertion order preserved                                              | `kept` IDs match expected order across interleaved sources        |
| 6   | Dominant source (201/300 = 67%) → warning returned                     | Warning contains source ID, "67%", "201/300", and cap value       |
| 7   | 5 equal sources at exactly 20% each                                    | `warning === undefined`                                           |
| 8   | 6 equal sources at 16.7% each                                          | `warning === undefined`                                           |
| 9   | Empty input to `computeSourceDiversityWarning`                         | `warning === undefined`                                           |
| 10  | Valid env values "10", "1", "500"                                      | Parsed correctly                                                  |
| 11  | Invalid env values: `undefined`, `""`, `"0"`, `"-5"`, `"abc"`, `"1.5"` | All fall back to `defaultValue`                                   |

Total: **11 assertions** (several test blocks contain multiple `assert.*` calls).

## Files changed

| File                                    | Change                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/discover.ts`                       | `applyPerSourceCap`, `computeSourceDiversityWarning`, `parseSelectionPositiveIntegerEnv`, `discoverInternals`; call site in `generateSelectionOutputs` |
| `src/types/mirror.ts`                   | `SelectionReport.sourceDiversityWarning?: string`; `"source-cap"` in `rejectionSummary` JSDoc                                                          |
| `src/manifest-validation/discovery.ts`  | `assertSelectionReport` accepts optional `sourceDiversityWarning`                                                                                      |
| `src/tests/discover-source-cap.test.ts` | New — 11 test cases                                                                                                                                    |
| `plans/014-source-diversity-cap.md`     | This file                                                                                                                                              |

## Commit

```
fix(discovery): enforce per-source entry cap in catalog selection (#304)
```
