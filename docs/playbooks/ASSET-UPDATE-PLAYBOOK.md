# Asset Update Playbook

Use this playbook when you want to review or apply updates to already installed assets.

This guide is about the `install refresh` lifecycle, not first-time setup.

Use it when:

- installed assets may be stale compared with the latest mirrored bundle state
- you want report-only update checks before mutating anything
- you want due-based background checks
- you want stale VS Code-family extension installs to stay in sync with refreshed bundle state

## What `install refresh` does

`install refresh` compares the installed upstream fingerprint recorded in each install manifest against the latest bundle-lock mirror state.

Artifacts:

- `state/install/refresh-report.json`
- `state/install/refresh-state.json`

Important behavior:

- `--due-only` skips the run unless the configured refresh interval is due
- `--apply` only mutates when the refresh policy and report both allow it
- refresh reports classify each stale asset as report-only, stage-only, low-risk apply, review-required, or quarantined
- executable/native assets can be staged, but host-native activation/install remains review-gated

## Manual scenarios

### Scenario 1. Report only

```bash
agent-harness install refresh --host copilot-vscode
```

Use this first when you want to see what is stale without changing anything.

### Scenario 2. Safe apply after review

```bash
AGENT_HARNESS_INSTALL_REFRESH_POLICY=apply-safe
agent-harness install refresh --host copilot-vscode --apply
```

### Scenario 3. Due-based background checks

```bash
AGENT_HARNESS_INSTALL_REFRESH_INTERVAL_MS=21600000
agent-harness install refresh --host copilot-vscode --due-only
```

This is the right mode for cron/background polling.

## Refresh policy tiers

| Tier                    | Decision                   | Mutates with `--apply`?      | Use for                                                                     |
| ----------------------- | -------------------------- | ---------------------------- | --------------------------------------------------------------------------- |
| `auto-report-only`      | `ignore`, `notify`, `plan` | No                           | current, pinned, manual, or report-only checks                              |
| `auto-stage`            | `stage-only`               | Stages harness material only | activation-eligible or executable/native assets after policy checks         |
| `auto-refresh-low-risk` | `apply`                    | Yes                          | verified, low-risk, non-executable, non-activating assets                   |
| `review-required`       | `review-required`          | No                           | trust, publisher, risk, compatibility, or conflicting-fingerprint ambiguity |
| `blocked-quarantined`   | `blocked-quarantined`      | No                           | quarantined latest mirrors                                                  |

`stage-only` is intentionally conservative: it can refresh the harness-managed package material, but it does not run host-native extension installs, activate hooks, enable MCP servers, or promote executable assets into a live host surface. Run `wire <host>` as a preview and use explicit native install / quarantine review commands after human approval.

## Recommended review workflow

### Step 1. Inspect current refresh policy

```bash
agent-harness install refresh --host <copilot-vscode|opencode|shared>
```

Then inspect:

- `state/install/refresh-report.json`
- `state/install/refresh-state.json`

### Step 2. Decide whether the run is informational or mutating

- want visibility only -> keep it report-only
- want unattended checks -> use `--due-only`
- want a reviewed safe apply -> set `AGENT_HARNESS_INSTALL_REFRESH_POLICY=apply-safe` and then use `--apply`

### Step 3. Re-verify host-native extension state when relevant

For stale VS Code-family extension assets, refresh apply stages updated harness material only. Use `agent-harness install native --host <host> --operation verify` first, then run the explicit native install command with `--apply` only after review.

## Agent-prompted workflow

```text
You are using agent-harness to review or apply updates for already installed assets.

Workspace root: <workspace-path>
Lifecycle host: <copilot-vscode|opencode|shared>

Goals:
1. Determine whether assets are stale.
2. Separate report-only checks from mutating refresh/apply steps.
3. Explain whether due-only scheduling or safe apply is the right next step.
4. Verify any host-native extension update implications for VS Code-family assets without automatically installing them.

Required workflow:
- Run `agent-harness install refresh --host <host>` first.
- Inspect these files when they exist, relative to the active state root:
  - `state/install/refresh-report.json`
  - `state/install/refresh-state.json`
- If I want unattended checks, show the exact `AGENT_HARNESS_INSTALL_REFRESH_INTERVAL_MS` + `--due-only` command.
- If you recommend a mutating apply run, explain why `AGENT_HARNESS_INSTALL_REFRESH_POLICY=apply-safe` is appropriate before suggesting `--apply`.
- Keep report-only, due-only, and mutating apply recommendations clearly separated.

When ready, give me:
- whether the stale state is real and actionable
- the exact commands you ran
- the exact next command for report-only, due-only, or apply-safe flow
- any explicit host-native follow-up I should verify or approve after apply
```

## Rule of thumb

- Want visibility -> `install refresh --host <host>`
- Want scheduled checks -> `install refresh --host <host> --due-only`
- Want reviewed safe mutation -> `AGENT_HARNESS_INSTALL_REFRESH_POLICY=apply-safe` plus `install refresh --host <host> --apply`
