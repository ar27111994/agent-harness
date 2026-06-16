# Plan 003: Add path-containment check for pkg.manifestPath in readSharedMcpAssetIds

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ca36be9..HEAD -- src/lib/shared-mcp.ts src/files.ts`
> If either file changed since this plan was written, compare excerpts below
> against live code before proceeding; any mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `ca36be9`, 2026-06-15

## Why this matters

`readSharedMcpAssetIds` (in `src/lib/shared-mcp.ts`) reads `pkg.manifestPath` directly from the content of a persisted bundle manifest file — a path that could have been tampered with if the install state directory is writable by an attacker (supply-chain compromise, symlink attack, or crafted bundle).

There is no check that `pkg.manifestPath` stays under the install root. A path like `../../etc/passwd` or an absolute path to a credentials file would be silently read and passed to the validator, potentially leaking content into error messages or influencing downstream MCP asset-ID decisions.

The fix is a one-function addition: validate that the resolved `manifestPath` is a descendant of the expected install root before opening it.

## Current state

File: `src/lib/shared-mcp.ts` (lines 43–57):

```typescript
for (const pkg of packages) {
  if (!activeAssetIds.has(pkg.assetId)) {
    continue;
  }

  const packageManifest = await readJsonFile<InstalledPackageManifest>(
    pkg.manifestPath, // ← opened without path validation
    assertInstalledPackageManifest,
  );
  if (packageManifest.assetKind === "mcp-server") {
    mcpAssetIds.add(packageManifest.assetId);
  }
}
```

`pkg.manifestPath` comes from `InstalledBundleManifest` which is read from disk — it is not a value we generated in this call.

For comparison, the install bundle writer always constructs `manifestPath` via `join(packageRoot, "install-manifest.json")` (see `src/install/bundle.ts:173`) — i.e., always under a known root. The reader must enforce the same constraint.

The install root is available from `projectRoot` parameter:

```typescript
export async function readSharedMcpAssetIds(
  projectRoot: string,    // ← this is the trust boundary
): Promise<string[]> {
```

The expected install root for bundle manifests is `join(projectRoot, "install")`.

The repo's path-safe pattern: use `resolve()` and check `.startsWith()` — see `src/files.ts` generally for the posix-path convention and the `toPosixPath` helper already imported everywhere.

## Commands you will need

| Purpose   | Command             | Expected on success |
| --------- | ------------------- | ------------------- |
| Build     | `npm run build`     | exit 0              |
| Typecheck | `npm run typecheck` | exit 0, no errors   |
| Tests     | `npm test`          | all pass            |
| Lint      | `npm run lint`      | exit 0              |

## Scope

**In scope**:

- `src/lib/shared-mcp.ts` — only the `readSharedMcpAssetIds` function and its helpers

**Out of scope**:

- `src/install/bundle.ts` — the writer is correct; do not change it
- `src/files.ts` — do not add a general helper there; keep the check local to this function

## Git workflow

- Branch: `fix/003-manifest-path-containment`
- Commit message: `fix(security): validate pkg.manifestPath stays under install root in readSharedMcpAssetIds`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add path-containment validation before opening `pkg.manifestPath`

Inside the `for (const pkg of packages)` loop in `readSharedMcpAssetIds`, add this check immediately before the `readJsonFile` call:

```typescript
const allowedRoot = resolve(join(projectRoot, "install"));
const resolvedManifestPath = resolve(pkg.manifestPath);
if (!resolvedManifestPath.startsWith(allowedRoot + sep)) {
  throw new Error(
    `pkg.manifestPath is outside the install root: ${pkg.manifestPath}`,
  );
}
```

Import `sep` from `"node:path"` (alongside existing `join`/`resolve` imports — check the top of the file for what is already imported from `"node:path"`).

`resolve` without a base argument resolves against `process.cwd()`. On this project the cwd is always the project root during CLI runs, but to be safe prefer:

```typescript
const resolvedManifestPath = resolve(projectRoot, pkg.manifestPath);
```

if `pkg.manifestPath` can be relative. Check whether `manifestPath` values in practice are absolute (from `join(packageRoot, ...)` in `install/bundle.ts:173`) or relative. If always absolute, `resolve(pkg.manifestPath)` is sufficient.

**Verify**: `npm run typecheck` → exit 0

### Step 2: Build and run tests

**Verify**: `npm run build` → exit 0
**Verify**: `npm test` → all pass

### Step 3: Lint

**Verify**: `npm run lint` → exit 0

## Test plan

Add tests to `src/tests/shared-mcp.test.ts` (create if absent; model structure after `src/tests/install-refresh.test.ts`):

1. **Happy path**: `readSharedMcpAssetIds` with a valid bundle manifest where all `manifestPath` values are under the install root → returns correct asset IDs
2. **Traversal blocked**: same call with a `manifestPath` pointing outside the install root (e.g., `../../etc/fake`) → throws with the containment error message
3. **Absolute path outside root blocked**: `manifestPath` set to an absolute path not under `join(projectRoot, "install")` → throws

**Verify**: `npm test` → new tests pass

## Done criteria

- [ ] `readSharedMcpAssetIds` validates `pkg.manifestPath` against `join(projectRoot, "install")` before opening
- [ ] A path traversal attempt throws a descriptive error
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, all pass (including new containment tests)
- [ ] `npm run lint` exits 0
- [ ] Only `src/lib/shared-mcp.ts` (and optionally the new test file) are modified
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

Stop and report if:

- The code at lines 43–57 of `src/lib/shared-mcp.ts` doesn't match the excerpt above.
- `manifestPath` values turn out to be relative paths in a form the `resolve(projectRoot, ...)` approach doesn't handle — report an example and stop.
- The fix requires importing a new dependency not already in `package.json`.

## Maintenance notes

- If `InstallBundleManifest.packages[].manifestPath` ever changes to a different type (e.g., a validated branded type), this check may become redundant — but explicit validation at the trust boundary is still worth keeping.
- This pattern should be applied wherever other persisted path values are opened: review all `readJsonFile(somePersistedPath)` calls in `src/lib/` and `src/install/` for similar gaps.
