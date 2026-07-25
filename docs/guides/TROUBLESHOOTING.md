# Troubleshooting Guide

This guide covers common failure modes, error messages, and recovery steps for
`agent-harness` commands. Each section links to the relevant command and describes
what to check before filing an issue.

---

## `setup doctor` — host CLI not found on PATH

**Symptom:** `setup doctor` reports a warning such as:

```
warning: copilot-vscode — VS Code CLI (code) not found on PATH
```

**Cause:** The host's CLI binary is not installed or not on the system `PATH`.

**Fix by host:**

| Host                        | Binary     | Install                                                                    |
| --------------------------- | ---------- | -------------------------------------------------------------------------- |
| `copilot-vscode` / `cursor` | `code`     | Open VS Code / Cursor → Command Palette → _Install 'code' command in PATH_ |
| `opencode`                  | `opencode` | `npm install -g @opencode/opencode`                                        |
| `zed`                       | `zed`      | From Zed → _Install CLI_ in the menu                                       |
| `pi`                        | `pi`       | Install from [pi.ai developer docs](https://pi.ai/developers)              |
| `codex`                     | `codex`    | `npm install -g @openai/codex`                                             |

After installing, open a **new** terminal (PATH changes are not inherited by the
current shell) and re-run `setup doctor`.

---

## `setup doctor` — version check fails

**Symptom:**

```
warning: opencode — version requirement not satisfied (found 0.1.x, need ≥0.2.0)
```

**Fix:** Upgrade the host CLI:

```bash
npm update -g opencode        # opencode
npm update -g @openai/codex   # codex
```

For VS Code / Cursor, use _Check for Updates_ in the application menu.

---

## `setup doctor` — hangs indefinitely

**Fixed in v2.0.0 (#302, commit `3f02b7c`).** If you are on an earlier version,
upgrade to v2.0.0.

Each host adapter now has a per-adapter timeout (default 5 s, overridable via
`AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS`). If a host CLI probe blocks, the
doctor emits a timeout warning and continues. If `setup doctor` still hangs after
upgrading, try:

```bash
# Increase timeout for slow CLIs
AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS=60000 agent-harness setup doctor
```

---

## `recommend report` — fails immediately with "no selected catalog entries"

**Fixed in v2.0.0 (#303, commit `5aaa726`).** This fast-fail was added so the
command exits immediately instead of hanging.

**Cause:** `discover/output/catalog.selected.jsonl` is absent or empty.

**Fix:** Run discovery first:

```bash
agent-harness discover full     # full pipeline: sync → catalog → select
# or, step by step:
agent-harness discover sync
agent-harness discover catalog
agent-harness discover select
```

---

## `install refresh` — crashes with ENOENT on `mirror/bundles/*.lock.json`

**Fixed in v2.0.0 (#298, commit `a917544`).** On a clean checkout with no lock
files present, `install refresh` previously crashed with:

```
Error: ENOENT: no such file or directory, open 'mirror/bundles/shared.lock.json'
```

After upgrading, missing lock files are gracefully skipped. If you still see this
on v2.0.0+, ensure you are running the latest CLI:

```bash
node dist/cli.js --version
# should print 2.0.0 or later
```

---

## `setup doctor` output references a missing file

**Symptom:** Doctor output includes `docs/guides/TROUBLESHOOTING.md` but following
the path produces a 404.

**Fix:** This file (the one you are reading) was added in v2.0.0 (#305). If you
are on an earlier release, upgrade to v2.0.0.

---

## MCP server auth — provider credentials

MCP servers that require provider API keys (Anthropic, OpenAI, etc.) read from
environment variables. Set the appropriate variable before running `wire --apply`:

| Provider           | Environment variable              |
| ------------------ | --------------------------------- |
| Anthropic / Claude | `ANTHROPIC_API_KEY`               |
| OpenAI / Codex     | `OPENAI_API_KEY`                  |
| GitHub Copilot     | Authenticate with `gh auth login` |

For detailed per-provider instructions, run:

```bash
agent-harness setup login --provider <name>
```

where `<name>` is one of `anthropic`, `openai`, `github`.

---

## Concurrent `discover` runs corrupt JSONL output

**Fixed in v2.0.0 (#306, #316, commits `5a6acea` and `ddcfdcd`).**

Running two `discover catalog` or `discover full` processes simultaneously against
the same state root previously risked JSONL file corruption because the write path
included a pre-delete step before the atomic rename. The pre-delete has been
removed — `rename(tempPath, filePath)` is now the sole write-path operation, which
is atomic on all supported platforms.

Concurrent runs are still not recommended because both processes produce independent
snapshots and the last rename wins silently. Use a process-level guard (cron lock
file, CI job exclusion) to prevent overlapping runs against the same state root.

---

## Packagist / PHP assets dominating recommendations for TypeScript workspaces

**Fixed in v2.0.0 (#278, #304, commits `42e0474` and `53e9772`).**

Two fixes address this:

1. **Ecosystem-affinity penalty strengthened** (#278): PHP Packagist entries
   now receive a doubled mismatch penalty when the workspace has package-manager
   signals that do not include PHP/Composer.
2. **Per-source entry cap** (#304): No single source may contribute more than 200
   entries (default) to the selected catalog. Override with:
   ```bash
   AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE=100 agent-harness discover select
   ```

---

## Filing an issue

Before filing, include:

1. `agent-harness --version` output
2. `node --version` and OS
3. The full command you ran
4. The full terminal output (stdout + stderr)
5. The relevant report file (e.g. `discover/output/selection-report.json`)
   if the issue is discovery-related

File issues at:
<https://github.com/ar27111994/agent-harness/issues>

---

## Related guides

- [v2 Safe Defaults](./SAFE-DEFAULTS.md) — what the CLI does (and does not do) by default
- [Security and Trust Center](./TRUST-CENTER.md) — trust tiers, quarantine, and review-required paths
- [v1 to v2 Upgrade Guide](./V1-TO-V2-UPGRADE.md) — how to regenerate state after upgrading
- [Harness Maintenance Guide](./HARNESS-MAINTENANCE-GUIDE.md) — weekly safe-refresh loop
