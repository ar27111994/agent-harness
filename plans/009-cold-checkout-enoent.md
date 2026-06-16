# Plan 009 — Fix cold-checkout ENOENT in resolveBundleLocks (#298)

## Problem

Running `install refresh` on a fresh CI checkout crashed with:

```
ENOENT: no such file or directory, open '...mirror/bundles/opencode-global.lock.json'
```

`mirror/bundles/` is gitignored. On cold checkout it does not exist.
The maintenance workflow called `install refresh` without first running
`mirror locks/acquire` to generate the bundle lock files, so they were
always absent.

## Root cause

`resolveBundleLocks` (src/mirror/bundles.ts) called `readJsonFile` (throws on
ENOENT) rather than `readJsonFileOrNull` (returns null on ENOENT). All other
bundle-lock read sites in the codebase already used `readJsonFileOrNull`.

## Fix

Changed `resolveBundleLocks` to use `readJsonFileOrNull` with `assertBundleLock`
validation. When a lock file is absent the entry is silently skipped with a
comment explaining the cold-checkout scenario. No behaviour change when files
exist.

Also added the `assertBundleLock` import (previously not needed in this file)
and `readJsonFileOrNull` import.

## Test

Added to `src/tests/mirror-plan-bundles-inspect.test.ts`:

> "resolveBundleLocks silently skips bundle IDs whose lock files do not exist
> (cold checkout)"

Creates an empty temp dir, calls `resolveBundleLocks` with three bundle IDs
whose lock files don't exist, and asserts `doesNotReject`.

## Outcome

17/17 tests pass in mirror-plan-bundles-inspect. Cold-checkout reproduction
(`node dist/cli.js install refresh --host copilot-vscode`) exits 0 with an
informative report rather than crashing.
