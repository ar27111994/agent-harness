# Workspace Evolution Control-Loop Playbook

Use this after initial `agent-harness workspace <host>` wire-in when the target repository changes. New packages, lockfiles, host configs, MCP manifests, plugins, agent folders, docs, or APIs can introduce new asset demand; this loop turns that drift into reviewable lifecycle state instead of scattered logs.

## Safe recurring loop

Run from the workspace root. Add `--state-root .agent-harness` only when you want to be explicit about the installed-package default.

```bash
agent-harness discover demand-profile
agent-harness discover sources
agent-harness discover sync
agent-harness discover sources
agent-harness discover catalog
agent-harness discover select
agent-harness discover stats
agent-harness recommend report --intent general
agent-harness mirror plan
agent-harness mirror locks
agent-harness mirror diff
agent-harness install refresh --host <copilot-vscode|opencode|shared>
agent-harness wire <host>
```

Keep `wire <host>` in preview mode until the report changes make sense. Use `workspace <host> --intent <intent>` when you want the full lifecycle and apply step in one command after review.

## What to inspect

| Output                                     | Decision it supports                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `discover/output/demand-profile.json`      | Which technologies, file families, host configs, package manifests, and docs now drive demand.               |
| `discover/output/unknown-signals.json`     | Unfamiliar MCP manifests, host rule folders, plugin manifests, and package dependencies that need follow-up. |
| `discover/output/source-index.json`        | Which configured/generated sources are enabled, indexed, direct, or unsupported.                             |
| `discover/output/source-utilization.json`  | Whether selected sources produced usable catalog entries or are dead weight.                                 |
| `discover/output/selection-report.json`    | Why candidates were accepted, rejected, capped, or deferred.                                                 |
| `discover/catalog.assets.jsonl`            | Raw asset evidence before ranking.                                                                           |
| `discover/output/asset-fingerprints.json`  | Stable asset identity, mirror content hashes, trust/quarantine state, and duplicate-group evidence.          |
| `state/recommendations.json`               | Ranked host-specific recommendations and budgets.                                                            |
| `mirror/bundles/*.lock.json`               | Pinned mirror inputs for reproducibility.                                                                    |
| `mirror/quarantine/**`                     | Risky content that must not be staged/activated without review.                                              |
| `state/install/refresh-report.json`        | Already installed assets that are stale relative to current locks.                                           |
| `activate/<host>/wire-preview-<host>.json` | Exact workspace writes planned by the host adapter.                                                          |

## Decision points

### 1. Demand changed but recommendations did not

- Check whether the new signal is strong evidence or only incidental text.
- Add or update a technology signature only when you have at least two of: manifest dependency, lockfile dependency, host config, source file import, documented framework file, or official docs/source mapping.
- Add fixtures before changing signature behavior so future scans keep the signal stable.

### 2. Source coverage drifted

- Prefer official-first-party or official-marketplace sources when they exist.
- Use official-compatible sources when the publisher is not the host vendor but the integration is documented or widely adopted.
- Use trusted-community/community sources as catalog references unless install/mirror safety is intentionally reviewed.
- Update source packs, official indexes, and source-sync schema/cache handling together when a source shape changes.

### 3. Catalog grew but ranking looks wrong

- Run `agent-harness recommend explain --host <host> --asset <asset-id>`.
- Print the merged host policy with `agent-harness recommend policy:print --host <host>`.
- Adjust recommendation fixtures before policy weights when a new expected behavior is missing coverage.

### 4. Quarantine appears

```bash
agent-harness quarantine list
agent-harness quarantine inspect --asset <asset-id>
```

Approve only after source identity, content, and executable behavior are reviewed:

```bash
agent-harness quarantine approve --asset <asset-id> --reason "reviewed source and content"
```

Reject or defer anything with prompt-injection language, secret-exfiltration instructions, unclear executables, unexpected network behavior, or unknown provenance:

```bash
agent-harness quarantine reject --asset <asset-id> --reason "unsafe prompt or executable behavior"
```

Install and activation skip quarantined entries until approval promotes them to `approved-with-warning`.

### 5. Existing installs are stale

Start report-only:

```bash
agent-harness install refresh --host <host>
```

Apply only after the refresh report matches the intended update:

```bash
AGENT_HARNESS_INSTALL_REFRESH_POLICY=apply-safe agent-harness install refresh --host <host> --apply
```

Re-run `wire <host>` preview after refresh so host integration changes are visible before apply.

## Schema and migration discipline

- Signature changes need deterministic fixtures and updated demand-profile expectations.
- Source-pack changes need source-registry/source-utilization coverage.
- Official index changes need allowlist or upstream-resolution tests.
- Source-sync state changes need migration/backfill behavior or an explicit regenerate path.
- Bundle-lock changes need mirror-plan/mirror-lock tests and a clear explanation of whether old locks should be reused or regenerated.

When in doubt, regenerate lifecycle state rather than silently migrating ambiguous old artifacts.

## AI-agent maintenance prompt

```text
You are maintaining agent-harness state for this workspace.

Goal: run the workspace evolution control loop safely and report only actionable drift.

Rules:
- Do not apply wire changes or native/global installs unless explicitly asked.
- Keep quarantine decisions human-review-only.
- Prefer official/verified sources over popularity-only sources.
- Add signatures or source mappings only when evidence is strong and covered by fixtures.

Commands:
1. agent-harness discover demand-profile
2. agent-harness discover sources
3. agent-harness discover sync
4. agent-harness discover sources
5. agent-harness discover catalog
6. agent-harness discover select
7. agent-harness discover stats
8. agent-harness recommend report --intent <intent>
9. agent-harness mirror plan
10. agent-harness mirror locks
11. agent-harness mirror diff
12. agent-harness install refresh --host <host>
13. agent-harness wire <host>

Inspect:
- discover/output/demand-profile.json
- discover/output/unknown-signals.json
- discover/output/source-utilization.json
- discover/output/selection-report.json
- discover/output/asset-fingerprints.json
- state/recommendations.json
- mirror/bundles/*.lock.json
- mirror/quarantine/**
- state/install/refresh-report.json
- activate/<host>/wire-preview-<host>.json

Return:
- what changed in demand/source/catalog/recommendations
- any quarantined assets and recommended review action
- stale installed assets, if any
- whether wire preview changed
- exact safe next command
```
