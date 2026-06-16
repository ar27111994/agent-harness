# Plan 005: Harden install-refresh tests against ambient VS Code CLI dependency

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ca36be9..HEAD -- src/tests/install-refresh.test.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code; treat any mismatch as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `ca36be9`, 2026-06-15

## Why this matters

`npm test` (the project's one-command verification) currently fails on any machine without a working `code` CLI (VS Code not installed, or CLI not in PATH) because `install-refresh.test.ts` exercises a path that probes the host via `code --version` / `code --list-extensions`. When the CLI is absent, the test fails at preflight rather than at the assertion it was written to test — a test failure with the wrong error, which is worse than no test because it obscures real breakage.

The project's README and CI advertise `npm test` as the baseline verification. Ambient tool dependencies silently break this contract. The fix is to stub the host-CLI probe in the test rather than invoking a real binary.

## Current state

File: `src/tests/install-refresh.test.ts` (line 1196 area):

The test at line 1196 sets up an `InstalledBundleManifest` with a `copilot-vscode` host entry and asserts an invalid extension ID error. However, before reaching that assertion, the refresh path calls something equivalent to `code --version` or `code --list-extensions` to validate the host CLI is present. On machines without VS Code, this probe times out or throws, never reaching the invalid-ID assertion.

The repo's existing pattern for stubbing external commands: look at the dependency injection pattern used in `src/mirror/acquire.ts` — `acquireMirrorArtifacts` accepts an optional `dependencies` parameter with `materializeArtifact` injectable. The extension installer should support a similar injection for the CLI runner.

Check whether `src/host-adapters/extension-installer.ts` already has a CLI-runner injection parameter:

```
grep -n "dependencies\|cliRunner\|execCommand\|spawnCommand" src/host-adapters/extension-installer.ts | head -10
```

If it does: use that injection in the test to substitute a no-op or predictable stub.
If it doesn't: the fix is to add one (see Steps).

## Commands you will need

| Purpose   | Command             | Expected on success |
| --------- | ------------------- | ------------------- |
| Build     | `npm run build`     | exit 0              |
| Typecheck | `npm run typecheck` | exit 0, no errors   |
| Tests     | `npm test`          | exit 0, all pass    |
| Lint      | `npm run lint`      | exit 0              |

## Scope

**In scope**:

- `src/tests/install-refresh.test.ts` — the specific test at ~line 1196 (and any nearby tests with the same dependency)
- `src/host-adapters/extension-installer.ts` — **only if** it has no existing CLI injection point (see check in Current state)
- If the extension installer needs a new injection parameter: only the minimal change to thread it through to the callers used in the test

**Out of scope**:

- Changing real CLI behavior
- Adding any new production logic beyond the injection seam
- Any other test files

## Git workflow

- Branch: `fix/005-refresh-test-cli-stub`
- Commit message: `fix(tests): stub VS Code CLI probe in install-refresh tests`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Investigate the existing injection surface

Run:

```bash
grep -n "dependencies\|cliRunner\|execCommand\|spawnCommand\|nativeCommand" src/host-adapters/extension-installer.ts | head -20
```

**If an injection point exists**: skip to Step 3.
**If no injection point exists**: proceed to Step 2.

### Step 2: (only if needed) Add a minimal CLI-runner injection seam

In `src/host-adapters/extension-installer.ts`, add an optional `cliRunner` parameter to the function(s) that invoke `code --version` / `code --list-extensions`. The type should be:

```typescript
type CliRunner = (
  cmd: string,
  args: string[],
) => Promise<{ stdout: string; exitCode: number }>;
```

Default value: the real `execFile`/`spawn`-based runner already in use.

Keep the change minimal — do not refactor the entire file, only thread the parameter to the two or three call sites that probe the VS Code CLI.

**Verify**: `npm run typecheck` → exit 0

### Step 3: Update the failing test to inject a stub CLI runner

In `src/tests/install-refresh.test.ts` at the test around line 1196:

- Inject a stub `cliRunner` that immediately returns `{ stdout: "", exitCode: 0 }` for any `--version` or `--list-extensions` probe
- The stub should be specific: only stub the preflight/list calls, not any actual install/uninstall commands (those should remain as assertions)

This ensures the test reaches its intended assertion (the invalid extension ID error) regardless of whether VS Code is installed on the machine.

**Verify**: `npm run build && npm test` → exit 0, test previously failing now passes

### Step 4: Lint

**Verify**: `npm run lint` → exit 0

## Test plan

This plan itself is a test fix. After the change:

- The previously failing test at line 1196 must pass on a machine without VS Code in PATH
- A new optional integration-only test (tagged `@integration` or similar) can be added to `src/tests/install-refresh.integration.test.ts` that exercises the real CLI path — but this is NOT required for this plan's done criteria

## Done criteria

- [ ] `npm test` exits 0 on a machine without `code` in PATH (or in CI where VS Code is not installed)
- [ ] The test at line 1196 now asserts the invalid-extension-ID error as intended
- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] Only the in-scope files are modified
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

Stop and report if:

- The test failure on your machine is different from "CLI probe timeout/not-found" — report the actual error.
- The extension installer has no injection seam AND threading one requires changing more than 3 call sites.
- Stubbing the CLI runner changes the semantics of the test in a way that no longer covers the intended behavior.

## Maintenance notes

- The existence of ambient-tool dependencies in unit tests is a systemic pattern risk. After this fix, grep for `execFile\|spawnSync\|exec(` in `src/tests/` and apply the same injection pattern wherever they appear.
- Keep one real integration test path that exercises the actual CLI — stub tests don't catch the case where the CLI output format changes.
