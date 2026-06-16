# Plan 001: Remove pre-delete step from writeJsonFileAtomically to restore atomic-write guarantee

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ca36be9..HEAD -- src/domains/discovery/ai-enrichment.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; treat any mismatch as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ca36be9`, 2026-06-15

## Why this matters

`writeJsonFileAtomically` (the function used to write all discovery JSON artifacts) does:

1. Write to a `<file>.<pid>.<uuid>.tmp` temp path
2. **Force-remove the destination** (`rm(filePath, { force: true })`)
3. `rename(tempPath, filePath)`

Step 2 destroys the guarantee. If the process dies, is OOM-killed, or a permission/antivirus error fires between steps 2 and 3, the destination is gone — no old version, no new version, just missing. On Windows (the primary dev OS), rename-over-existing-file has always been supported since Node 14 via the underlying `MoveFileEx` with `MOVEFILE_REPLACE_EXISTING`, so the pre-delete is not needed and is actively harmful.

This is the write path for every enrichment artifact, catalog entry, and demand profile. Silent data loss during normal failure modes (laptop lid close, AV scanner, low disk) would corrupt the entire discovery state.

## Current state

File: `src/domains/discovery/ai-enrichment.ts`

```typescript
// lines 988–999 (writeJsonFileAtomically)
async function writeJsonFileAtomically(
  filePath: string,
  value: unknown,
): Promise<void> {
  await ensureDirectory(dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(
    tempPath,
    `${JSON.stringify(value, null, PRETTY_JSON_INDENT_SPACES)}\n`,
    "utf8",
  );
  await rm(filePath, { force: true }); // ← BUG: this is the problematic line
  await rename(tempPath, filePath);
}
```

The repo convention for error handling uses try/catch with explicit `throw` — see `src/files.ts:128–149` as the pattern exemplar.

## Commands you will need

| Purpose   | Command             | Expected on success |
| --------- | ------------------- | ------------------- |
| Build     | `npm run build`     | exit 0              |
| Typecheck | `npm run typecheck` | exit 0, no errors   |
| Tests     | `npm test`          | all pass            |
| Lint      | `npm run lint`      | exit 0              |

## Scope

**In scope** (the only file you should modify):

- `src/domains/discovery/ai-enrichment.ts`

**Out of scope** (do NOT touch):

- `src/files.ts` — has its own separate atomic write helpers; do not merge
- Any test files — no test change needed; the rename path is exercised by existing discovery tests
- Any other caller of `writeJsonFileAtomically` (it is private to this file)

## Git workflow

- Branch: `fix/001-atomic-write-pre-delete`
- Commit message: `fix(discovery): remove pre-delete step from writeJsonFileAtomically`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Remove the `rm` line

In `src/domains/discovery/ai-enrichment.ts`, delete line 998:

```typescript
await rm(filePath, { force: true });
```

The function after the edit should look like:

```typescript
async function writeJsonFileAtomically(
  filePath: string,
  value: unknown,
): Promise<void> {
  await ensureDirectory(dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(
    tempPath,
    `${JSON.stringify(value, null, PRETTY_JSON_INDENT_SPACES)}\n`,
    "utf8",
  );
  await rename(tempPath, filePath);
}
```

**Verify**: `grep -n "await rm" src/domains/discovery/ai-enrichment.ts` → no output

### Step 2: Confirm the `rm` import is still needed elsewhere in the file

```
grep -n "\brm\b" src/domains/discovery/ai-enrichment.ts
```

If `rm` appears only in the removed line and nowhere else, also remove it from the import at the top of the file. If it appears in other places, leave the import alone.

**Verify**: `npm run typecheck` → exit 0, no errors

### Step 3: Run full test suite

**Verify**: `npm test` → all pass (no new failures vs. baseline)

### Step 4: Lint

**Verify**: `npm run lint` → exit 0

## Test plan

No new tests required. The existing discovery test suite (including `src/tests/discovery-reporting.test.ts`) exercises the write path. The change is a one-line deletion with no new conditional logic.

If you want to add a regression guard: in `src/tests/discovery-reporting.test.ts` or a new `src/tests/atomic-write.test.ts`, write a test that:

1. Calls `writeJsonFileAtomically` (if exported, otherwise call the higher-level function that uses it) with a valid target
2. Asserts the file exists and contains the expected content after the call
3. Pattern: model after any test in `src/tests/discovery-reporting.test.ts` that writes then reads a discovery artifact

## Done criteria

- [ ] `grep -n "await rm" src/domains/discovery/ai-enrichment.ts` returns no matches
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, all pass
- [ ] `npm run lint` exits 0
- [ ] Only `src/domains/discovery/ai-enrichment.ts` is modified (`git status`)
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

Stop and report if:

- The code at lines 988–999 doesn't match the excerpt above (codebase has drifted).
- `rename` throws on your platform when the destination exists — report the OS and Node version; the fix may need a try/catch fallback for that edge case.
- `npm test` fails with errors unrelated to this change.

## Maintenance notes

- On Windows, `rename(src, dest)` where `dest` exists uses `MoveFileEx` with `MOVEFILE_REPLACE_EXISTING` atomically since Node 14. No OS workaround needed.
- If this function is ever extracted to `src/files.ts` (see ARCH-07/ARCH-08 direction), carry this fix forward.
- Future reviewers: any re-introduction of a pre-delete before rename is a regression of this fix.
