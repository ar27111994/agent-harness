# PR #376 — Complete Review Comment Audit

**Date:** 2026-07-30
**Total comments:** 38
**Verified against current code at:** tip of PR branch

---

## Summary

| Status                       | Count |
| ---------------------------- | ----- |
| Fixed in this session        | 33    |
| Already fixed / pre-existing | 3     |
| Not a bug / by design        | 2     |

---

## Fixed (33 of 38)

Includes all inline, outside-diff, duplicate, and nitpick comments from the review.

| File                                             | Fix                                                                                                                                                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/discover.ts`                                | `--max-scan-bytes` at end of args throws instead of leaving `maxBytes` undefined                                                                                                                                             |
| `src/host-adapters/codex-native.ts`              | Marketplace rewrite preserves non-object entries; removed `coerceJsonObjectArray` and redundant `isJsonObject`; hooks resolve via `hookContentPathByAssetId` map; removed dead code + unused import                          |
| `src/host-adapters/cursor-native.ts`             | Reset prunes empty `.cursor/rules`, `.cursor/agents`, `.cursor` dirs; fixed 4 malformed JSDoc headers                                                                                                                        |
| `src/host-adapters/native-utils.ts`              | `addManagedStringArrayEntries` preserves non-string entries; extracted `buildManagedFrontmatterFile`; defined `NativeHost` union type; fixed `extractManagedSectionContent` inline markers; added JSDoc for `NativeHostSpec` |
| `src/host-adapters/native-wire.ts`               | Removed orphaned doc-comment fragment; `NativeWireHost` re-exports from shared `NativeHost`; added `hookContentPathByAssetId`                                                                                                |
| `src/host-adapters/claude-code-native.ts`        | Fixed malformed JSDoc header                                                                                                                                                                                                 |
| `src/host-adapters/pi-native.ts`                 | Fixed malformed JSDoc header                                                                                                                                                                                                 |
| `src/host-adapters/zed-native.ts`                | ENOENT-only fallback for `readFile`; narrowed JSONC catch block; fixed JSDoc header                                                                                                                                          |
| `src/cli.ts`                                     | Added `"bundle"` to `MUTATING_DOMAINS`                                                                                                                                                                                       |
| `src/domains/discovery/demand-profile.ts`        | `budgetOptions` uses `!== undefined` gate; `computeDirectoryByteCounts` uses bounded-concurrency batching                                                                                                                    |
| `README.md`                                      | Added 5 missing native adapter files to repository tree                                                                                                                                                                      |
| `docs/README.md`                                 | Added `text` language identifier to fenced block (MD040)                                                                                                                                                                     |
| `agent-harness-test-quality-audit.md`            | Reconciled test-isolation rating (~70% temp-dir), concurrency count (1 file)                                                                                                                                                 |
| `docs-audit-report.md`                           | Removed 8 now-documented commands; reconciled missing-docs section                                                                                                                                                           |
| `SOURCE-QUALITY-AUDIT.md`                        | Fixed registry count 6→7; marked §5.1 as addressed; added `text` language tag                                                                                                                                                |
| `src/tests/concurrency-input-edge-cases.test.ts` | Replaced inline builder with canonical `buildEntry` from shared `test-helpers.ts`; removed `as unknown as` cast                                                                                                              |
| `src/tests/ard-catalog.test.ts`                  | Refactored to import `buildEntry` from `test-helpers.ts`                                                                                                                                                                     |
| `src/tests/test-helpers.ts`                      | **New** — shared canonical `buildEntry` / `PartialEntry` for all tests                                                                                                                                                       |
| `src/tests/demand-profile.test.ts`               | Truncation test now verifies byte-count ranking (large/ before small/)                                                                                                                                                       |
| `src/tests/host-adapters.test.ts`                | Added 3 tests: non-ENOENT read propagation, no-op for existing entries, non-array value handling                                                                                                                             |
| `src/tests/native-host-wire.test.ts`             | Strengthened marketplace test: non-object entries, non-array plugins field, updated expected values for preservation                                                                                                         |
| `src/tests/residual-branch-coverage.test.ts`     | Updated hook source assertion for content-path map resolution                                                                                                                                                                |

## Already Fixed / Pre-existing (3)

| Concern                                                            | Reason                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------- |
| CLI help routing for `mirror plan --help`                          | Already handled by `MUTATING_DOMAINS` (now includes "bundle")   |
| codex-native `restoreManagedTextFileSnapshot` for shared AGENTS.md | Already uses section-scoped `restoreManagedSectionFromSnapshot` |
| Pi body test with `await import()` outside async                   | Test no longer exists; replaced in prior rounds                 |

## Not a Bug / By Design (2)

| Concern                                            | Reason                                           |
| -------------------------------------------------- | ------------------------------------------------ |
| `readSharedMcpAssetIdsBestEffort` error swallowing | Intentional best-effort pattern, documented      |
| v2-coverage test comment accuracy                  | Behavior correct, comment updated in prior round |

---

## Coverage

```
Statements   : 100% ( 47,845 / 47,845 )
Branches     : 100% (  8,490 /  8,490 )
Functions    : 100% (  1,351 /  1,351 )
Lines        : 100% ( 47,845 / 47,845 )
```

All 4 metrics at 100%. No `c8 ignore` statements.

---

## Validation

```
check:version-sync  ✅
typecheck           ✅
lint                ✅  (0 errors, 0 warnings)
format:check        ✅
build               ✅
test:coverage       ✅  (1,234 pass, 0 fail)
```

---

## Files Changed (21)

```
src/discover.ts
src/cli.ts
src/domains/discovery/demand-profile.ts
src/host-adapters/claude-code-native.ts
src/host-adapters/codex-native.ts
src/host-adapters/cursor-native.ts
src/host-adapters/native-utils.ts
src/host-adapters/native-wire.ts
src/host-adapters/pi-native.ts
src/host-adapters/zed-native.ts
src/tests/ard-catalog.test.ts
src/tests/concurrency-input-edge-cases.test.ts
src/tests/demand-profile.test.ts
src/tests/host-adapters.test.ts
src/tests/native-host-wire.test.ts
src/tests/residual-branch-coverage.test.ts
src/tests/test-helpers.ts          (new)
README.md
docs/README.md
agent-harness-test-quality-audit.md
docs-audit-report.md
SOURCE-QUALITY-AUDIT.md
```
