# Plan 015 — Remove pre-delete from writeJsonLinesFile (#306)

## Problem

`writeJsonLinesFile` in `src/files.ts` included a `rm(filePath, { force: true })`
call immediately before `rename(tempPath, filePath)`. This is the JSONL analog of
the JSON-file atomicity bug fixed for `writeJsonFileAtomically` in Plan 001 / #316.

The pre-delete breaks the atomic-write guarantee: a crash or concurrent invocation
between the `rm` and the `rename` leaves the JSONL file missing entirely. Since
catalog JSONL files (`catalog.assets.jsonl`, `catalog.selected.jsonl`,
`catalog.rejected.jsonl`) are the primary discovery outputs, a missed rename results
in an empty catalog that is indistinguishable from a successful empty run.

## Root Cause

The `rm` was copied from an older pattern that predated atomic temp-rename semantics.
On all Node-supported platforms (Windows, macOS, Linux), `fs.rename` atomically
replaces the destination file when source and destination are on the same filesystem.
No pre-delete is required; it only adds a window for data loss.

## Fix

Remove the single `await rm(filePath, { force: true })` line before `rename`.
The temp file (`<path>.tmp-<ts>-<rand>`) is still cleaned up in the `catch` block,
so there is no resource leak on error.

## Files Changed

| File           | Change                                    |
| -------------- | ----------------------------------------- |
| `src/files.ts` | Remove pre-delete in `writeJsonLinesFile` |

## Tests

`core-files-coverage.test.js` — 7/7 pass (file-helper tests exercise
`writeJsonLinesFile` indirectly through snapshot/JSONL roundtrips).

## Commit

```
fix(files): remove pre-delete from writeJsonLinesFile — restores atomic-write guarantee (#306)
```
