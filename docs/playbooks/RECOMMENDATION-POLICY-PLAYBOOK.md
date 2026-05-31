# Recommendation Policy Playbook

Use this playbook when the selected candidate pool already looks reasonable, but the final recommendations still feel wrong.

This is the right guide when:

- `selectedCount` is healthy, but the top recommendations are noisy
- relevant assets are already in `catalog.selected.jsonl` yet rank too low
- you want to inspect or edit host policy intentionally instead of guessing
- you want another AI agent to justify policy changes with evidence

## Do not start here unless breadth is already healthy

Before editing policy, verify:

- `discover/output/demand-profile.json` looks correct
- `discover/output/source-utilization.json` is not obviously starved
- `discover/output/selection-report.json` is not obviously too narrow

If those are still the problem, use `DISCOVERY-BREADTH-PLAYBOOK.md` first.

## What to inspect first

```bash
agent-harness recommend report --intent <intent>
agent-harness recommend explain --host <host> --asset <asset-id>
agent-harness recommend policy:print --host <host>
```

For VS Code on these user-facing recommend commands, use `--host vscode`. The internal policy file still lives at `discover/recommendation-policy/hosts/copilot-vscode.json`.

Inspect:

- `state/recommendations.json`
- the explain output for one clearly relevant asset
- the explain output for one clearly noisy asset
- the effective printed host policy

## Where policy lives

Policy is loaded from the active state root with a durable override layer.

Package/default files:

- `discover/recommendation-policy/base.json`
- `discover/recommendation-policy/hosts/shared.json`
- `discover/recommendation-policy/hosts/copilot-vscode.json`
- `discover/recommendation-policy/hosts/opencode.json`
- `discover/recommendation-policy/hosts/cursor.json`
- `discover/recommendation-policy/hosts/zed.json`
- `discover/recommendation-policy/hosts/claude-code.json`
- `discover/recommendation-policy/hosts/pi.json`

User-owned override files:

- `discover/recommendation-policy/overrides/base.json`
- `discover/recommendation-policy/overrides/hosts/shared.json`
- `discover/recommendation-policy/overrides/hosts/copilot-vscode.json`
- `discover/recommendation-policy/overrides/hosts/opencode.json`
- `discover/recommendation-policy/overrides/hosts/cursor.json`
- `discover/recommendation-policy/overrides/hosts/zed.json`
- `discover/recommendation-policy/overrides/hosts/claude-code.json`
- `discover/recommendation-policy/overrides/hosts/pi.json`

Precedence is:

1. checked-in/package defaults
2. user-owned override files
3. runtime env overrides

In installed/package usage these usually live under `.agent-harness/`.

## Manual workflow

### Step 1. Prove the problem is ranking, not recall

```bash
agent-harness discover full
agent-harness discover stats
agent-harness recommend report --intent <intent>
```

If the right assets are already present in `discover/output/catalog.selected.jsonl`, move on to policy inspection.

### Step 2. Inspect the effective policy

```bash
agent-harness recommend policy:print --host <host>
```

For VS Code, prefer `agent-harness recommend policy:print --host vscode`.

This shows the merged effective policy plus the resolved runtime override metadata (policy vs env, preserve vs scale, and whether scaling actually applied), which is the thing you should reason about before editing files blindly.

### Step 3. Explain both a good asset and a bad one

```bash
agent-harness recommend explain --host <host> --asset <relevant-asset-id>
agent-harness recommend explain --host <host> --asset <noisy-asset-id>
```

### Step 4. Edit the user-owned override files if needed

Treat `discover/recommendation-policy/base.json` and `discover/recommendation-policy/hosts/*.json` as defaults. Put durable customizations in the override layer instead:

- `discover/recommendation-policy/overrides/base.json` for shared scoring/keyword-map/preset overrides
- `discover/recommendation-policy/overrides/hosts/<host>.json` for host-specific caps, priorities, or override-mode settings

When you use a recommendation-limit env override, the default mode is still `preserve`, which changes only `recommendationLimit`. To explicitly scale related caps and minimums as well, set `recommendationLimitOverrideMode` to `scale` in the host override file or set the matching `AGENT_HARNESS_<HOST>_RECOMMENDATION_LIMIT_MODE=scale` env var.

Use limit changes by scenario:

- **Lean/default mode**: no override. Best for normal first runs and low-noise recommendations.
- **Broader report mode**: larger `recommendationLimit` with `preserve`. Best when diagnostics need more ranked candidates but existing caps/minimums should stay fixed.
- **Deep audit mode**: larger `recommendationLimit` with `scale`. Best for large monorepos, broad polyglot workspaces, or exploration where related host caps/minimums should grow with the report.

Do not increase limits when demand detection is wrong, source coverage is starved, or relevant assets are already selected but buried. Fix the actual bottleneck first. Treat `shared` and `pi` conservatively: `shared` is MCP-focused, and `pi` intentionally deprioritizes MCP/extension-like assets.

Then rerun:

```bash
agent-harness recommend report --intent <intent>
agent-harness recommend explain --host <host> --asset <asset-id>
```

## Agent-prompted workflow

```text
You are using agent-harness to diagnose recommendation quality and justify any recommendation-policy changes.

Workspace root: <workspace-path>
Host: <vscode|cursor|opencode|zed|claude-code|pi>
Intent: <optional one-or-more intents>

Goals:
1. Prove whether the problem is recall or ranking.
2. Inspect the merged effective recommendation policy.
3. Justify policy edits with explain output, not vibes.
4. Suggest the smallest policy change that fixes the observed problem.

Required workflow:
- Run the deterministic discovery/recommendation flow first.
- Confirm whether the right assets already exist in the selected catalog.
- Run `agent-harness recommend policy:print --host <host>`.
- Run `agent-harness recommend explain --host <host> --asset <relevant-asset-id>` and the same for at least one noisy asset.
- Inspect these files when they exist, relative to the active state root:
  - `discover/output/selection-report.json`
  - `discover/output/catalog.selected.jsonl`
  - `state/recommendations.json`
  - `discover/recommendation-policy/base.json`
  - `discover/recommendation-policy/hosts/<host>.json`
  - `discover/recommendation-policy/overrides/base.json`
  - `discover/recommendation-policy/overrides/hosts/<host>.json`
- Do not recommend broader source/pool changes unless you can show the selected set is actually missing relevant candidates.

When ready, give me:
- whether the bottleneck is detection, source breadth, selection, ranking, host policy, or wiring
- the exact policy area that looks wrong
- the smallest justified policy edit
- whether any limit override should use default, preserve, or scale mode
- the exact commands you ran
```

## Rule of thumb

- Right assets missing from selected set -> not a policy problem yet
- Right assets present but buried -> policy/ranking problem
- Need narrative context only -> use `AI-ENRICHMENT-PLAYBOOK.md`
