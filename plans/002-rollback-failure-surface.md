# Plan 002: Expose rollback failure in replaceRuntimeRoot instead of silently swallowing it

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ca36be9..HEAD -- src/activate.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; treat any mismatch as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ca36be9`, 2026-06-15

## Why this matters

`replaceRuntimeRoot` (in `src/activate.ts`) swaps the live runtime root in three steps:

1. Rename current root → backup
2. Rename staging root → live root
3. On failure in step 2: try to restore the backup → live

If the restoration in step 3 also fails (disk full, permission error, concurrent process), the failure is silently swallowed with `.catch(() => undefined)`. The caller only sees the original step-2 error, has no way to know the restoration failed, and the install is left in a state where neither the backup nor the staging root occupies the live slot — the runtime root is missing.

This is the most destructive failure mode in the entire codebase: the user's active agent configuration is gone, and the diagnostic surface shows only half the story.

## Current state

File: `src/activate.ts`

```typescript
// lines 433–449 (replaceRuntimeRoot, partial)
  if (hadRuntimeRoot) {
    await rename(runtimeRoot, backupRuntimeRoot);
  }

  try {
    await rename(stagingRuntimeRoot, runtimeRoot);
  } catch (error) {
    if (hadRuntimeRoot && !(await pathExists(runtimeRoot))) {
      await rename(backupRuntimeRoot, runtimeRoot).catch(() => undefined);  // ← BUG
    }
    throw error;
  }

  await removePath(backupRuntimeRoot);
}
```

The repo convention for compound error surfaces: throw an `AggregateError` or a chained `Error` with `{ cause }`. See `src/files.ts:139` for the `{ cause: error }` pattern and `src/activate.ts` generally for how errors are re-thrown.

## Commands you will need

| Purpose   | Command             | Expected on success |
| --------- | ------------------- | ------------------- |
| Build     | `npm run build`     | exit 0              |
| Typecheck | `npm run typecheck` | exit 0, no errors   |
| Tests     | `npm test`          | all pass            |
| Lint      | `npm run lint`      | exit 0              |

## Scope

**In scope**:

- `src/activate.ts` — only the `replaceRuntimeRoot` function (lines ~430–449)

**Out of scope** (do NOT touch):

- Any other function in `src/activate.ts`
- Any test files — see test plan below for the one new test to add

## Git workflow

- Branch: `fix/002-rollback-failure-surface`
- Commit message: `fix(activate): surface rollback failure in replaceRuntimeRoot`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Replace the silent `.catch(() => undefined)` with explicit error capture and re-throw

Replace the `catch` block (lines 441–446) with this pattern:

```typescript
  } catch (applyError) {
    if (hadRuntimeRoot && !(await pathExists(runtimeRoot))) {
      try {
        await rename(backupRuntimeRoot, runtimeRoot);
      } catch (rollbackError) {
        throw new AggregateError(
          [applyError, rollbackError],
          "Activation apply failed and rollback also failed — runtime root may be missing",
        );
      }
    }
    throw applyError;
  }
```

`AggregateError` is available in Node >=15 (this repo requires Node >=22) with no import.

**Verify**: `npm run typecheck` → exit 0

### Step 2: Build and test

**Verify**: `npm run build` → exit 0
**Verify**: `npm test` → all pass

### Step 3: Lint

**Verify**: `npm run lint` → exit 0

## Test plan

Add one test to `src/tests/activate.test.ts` (or create it if it doesn't exist, modelling structure after `src/tests/install-refresh.test.ts`):

**Test: "replaceRuntimeRoot surfaces AggregateError when both apply and rollback fail"**

Steps:

1. Set up a temp directory with a fake `runtimeRoot`, `backupRuntimeRoot`, and `stagingRuntimeRoot`
2. Make `stagingRuntimeRoot` unreadable/missing so the apply rename fails
3. Also make the backup-restore path fail (e.g. delete `backupRuntimeRoot` after the first rename)
4. Assert that the thrown error is an `AggregateError` with two nested errors
5. Assert that neither `.errors[0]` nor `.errors[1]` is undefined

This test calls the internals through the exported activation path or, if `replaceRuntimeRoot` is not exported, through a forced error scenario in the full activation flow.

**Verify**: `npm test` → new test passes

## Done criteria

- [ ] `.catch(() => undefined)` no longer appears in `replaceRuntimeRoot` (`grep -n "catch.*undefined" src/activate.ts` returns no match in that function)
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, all pass
- [ ] `npm run lint` exits 0
- [ ] Only `src/activate.ts` (and optionally `src/tests/activate.test.ts`) are modified
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

Stop and report if:

- The lines in "Current state" don't match the live code.
- `AggregateError` is not available in the TypeScript target configured — check `tsconfig.json` lib setting and report back.
- The test requires touching more than `src/activate.ts` and the test file.

## Maintenance notes

- If `replaceRuntimeRoot` is ever extracted to a shared utility module, carry the `AggregateError` pattern forward.
- The `pathExists(runtimeRoot)` check in the catch block is a best-effort guard — it is still susceptible to a TOCTOU race, but that is a separate concern (tracked as BUG-10 in the audit).
- Reviewers: look for any catch clause in `src/activate.ts` that still uses `.catch(() => undefined)` — each one is a candidate for the same treatment.
