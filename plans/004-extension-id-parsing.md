# Plan 004: Fix extension-ID parsing to strip only trailing @version suffix

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ca36be9..HEAD -- src/host-adapters/extension-installer.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live code; treat any mismatch as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ca36be9`, 2026-06-15

## Why this matters

`verifyVsCodeExtensionInstalled` parses `code --list-extensions` output to check whether an extension is installed. It strips the version by doing:

```typescript
line.trim().split("@")[0]!.toLowerCase();
```

VS Code extension IDs are `publisher.extensionName`. If either segment contains `@` (which scoped npm-style extension IDs like `@scope/name` and some marketplace IDs can), this split truncates the ID at the first `@`, producing a false negative: the extension appears not installed even though it is, triggering unnecessary reinstalls or verification failures.

The correct pattern is to strip only a **trailing** `@semver` suffix.

## Current state

File: `src/host-adapters/extension-installer.ts`, line 224:

```typescript
    .map((line) => line.trim().split("@")[0]!.toLowerCase())
```

This is inside `verifyVsCodeExtensionInstalled` which reads lines from `code --list-extensions --show-versions` (or similar) and builds a Set of installed IDs.

The repo uses standard TypeScript; regex replacements follow the pattern `str.replace(/pattern/u, "")` — note the `u` (unicode) flag used throughout (`src/files.ts`, `src/lib/http.ts`, etc.).

## Commands you will need

| Purpose   | Command             | Expected on success |
| --------- | ------------------- | ------------------- |
| Build     | `npm run build`     | exit 0              |
| Typecheck | `npm run typecheck` | exit 0, no errors   |
| Tests     | `npm test`          | all pass            |
| Lint      | `npm run lint`      | exit 0              |

## Scope

**In scope**:

- `src/host-adapters/extension-installer.ts` — only the one line at line 224

**Out of scope**:

- Any other file — this is a surgical one-line fix

## Git workflow

- Branch: `fix/004-extension-id-parsing`
- Commit message: `fix(host-adapters): strip only trailing @version from extension IDs`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Replace the `split("@")[0]` pattern with a regex that strips only a trailing version

Change line 224 from:

```typescript
    .map((line) => line.trim().split("@")[0]!.toLowerCase())
```

To:

```typescript
    .map((line) => line.trim().replace(/@[^@]+$/u, "").toLowerCase())
```

Explanation: `@[^@]+$` matches the last `@` followed by one or more non-`@` characters at the end of the string — i.e., the version suffix. It leaves any `@` in the publisher or name segments untouched.

**Verify**: `npm run typecheck` → exit 0

### Step 2: Build and test

**Verify**: `npm run build` → exit 0
**Verify**: `npm test` → all pass

### Step 3: Lint

**Verify**: `npm run lint` → exit 0

## Test plan

Add or extend tests in `src/tests/host-adapters.test.ts` (or a focused extension-installer test file if one exists):

1. **Standard ID**: `"publisher.name@1.2.3"` → `"publisher.name"`
2. **No version suffix**: `"publisher.name"` → `"publisher.name"` (no change)
3. **Scoped-style ID with @**: `"@scope.ext@0.0.1"` → `"@scope.ext"` (not truncated at the first @)
4. **Multiple @ chars**: `"pub@lisher.name@2.0.0"` → `"pub@lisher.name"`

Model structure after existing tests in `src/tests/host-adapters.test.ts`.

**Verify**: `npm test` → new tests pass (or existing coverage confirms all cases)

## Done criteria

- [ ] `split("@")[0]` no longer appears in `verifyVsCodeExtensionInstalled`
- [ ] `grep -n 'split.*"@"' src/host-adapters/extension-installer.ts` returns no match in the map call
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0
- [ ] `npm run lint` exits 0
- [ ] Only `src/host-adapters/extension-installer.ts` is modified (plus optional test file)
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

Stop and report if:

- Line 224 doesn't match `split("@")[0]!.toLowerCase()` in the live file.
- The regex replacement changes behavior for IDs that never contained `@` — confirm with a quick test before committing.

## Maintenance notes

- If `code --list-extensions` output format ever changes (e.g., stops including `@version`), the `replace(/@[^@]+$/u, "")` is still safe — it just becomes a no-op.
- The same split-on-@ pattern may exist in related extension helpers in the same file — search for `split("@")` across `src/host-adapters/` after this fix and apply the same treatment.
