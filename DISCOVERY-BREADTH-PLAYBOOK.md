# Discovery Breadth Playbook

Use this playbook when you want the **widest practical candidate pool** before recommendation ranking happens.

This is the right guide when:

- you want the largest sensible set of candidate assets for a real workspace
- recommendations feel too narrow or obviously miss important ecosystems
- you want to know whether the bottleneck is **demand detection**, **source coverage**, or **selection filtering**
- you want another AI agent to run the discovery flow without guessing which levers matter

## The short answer

Today this is possible, but before this playbook it was **not obvious enough**.

The widest practical pool now has one first-class command: `agent-harness discover breadth`.

That command already does the right discovery pass for recall-first diagnosis:

1. run from the **real workspace root**
2. make sure manifests are not hidden by `.gitignore`, `.ignore`, or `.agent-harnessignore`
3. run the full breadth-oriented discovery sequence, including `discover sources` and `discover sync`
4. print whether the bottleneck currently looks like demand detection, source coverage, selection filtering, or ranking
5. inspect `discover/output/source-index.json`, `discover/output/source-utilization.json`, and `discover/output/selection-report.json`
6. if the built-in registry is still too narrow for your case, widen the **active state-root discovery config** before rerunning `discover breadth`

## What actually controls breadth

Breadth is determined by three layers, in order:

### 1. Demand detection

If the workspace signals are wrong or incomplete, the rest of the pipeline will look narrow even when the source registry is broad.

Check:

- `discover/output/demand-profile.json`

Common failures:

- running from the wrong directory
- important manifests not checked in or not visible from the current root
- manifests filtered by `.gitignore`, `.ignore`, or `.agent-harnessignore`
- weak evidence for a real stack that is mostly implicit

### 2. Discovery source coverage

The candidate universe is assembled from the active state root, not just from one hardcoded file.

Inspect:

- `discover/output/source-index.json`
- `discover/output/source-utilization.json`

The active state-root discovery inputs are:

- `discover/sources.json`
- `discover/source-packs/*.json`
- `discover/official-skills-indexes.json`
- `discover/official-upstreams.json`

If you are using the installed package defaults, these usually live under `.agent-harness/`:

- `.agent-harness/discover/sources.json`
- `.agent-harness/discover/source-packs/*.json`
- `.agent-harness/discover/official-skills-indexes.json`
- `.agent-harness/discover/official-upstreams.json`

### 3. Selection filtering

A broad catalog can still produce a smaller selected set.

Inspect:

- `discover/output/selection-report.json`
- `discover/output/catalog.selected.jsonl`
- `discover/output/catalog.rejected.jsonl`

If the catalog is broad but `selectedCount` is still low, the bottleneck is selection rather than source coverage.

## Manual workflow: widest practical candidate pool

Run this from the target workspace root.

Unless you override it with `--state-root` or `AGENT_HARNESS_STATE_ROOT`, packaged CLI usage writes lifecycle artifacts under workspace-local `.agent-harness/`. Repository-local development in this repo still writes them at the repository root.

### Step 1. Confirm the harness can see the workspace correctly

```bash
agent-harness discover demand-profile
agent-harness setup doctor --host <host>
```

Inspect:

- `discover/output/demand-profile.json`

Do not widen policy yet if the workspace stack itself is missing.

### Step 2. Materialize the widest checked-in discovery universe

Start with the first-class breadth command:

```bash
agent-harness discover breadth
agent-harness discover stats
agent-harness recommend report --intent <intent>
```

If you want to see the exact underlying sequence, `discover breadth` is effectively the recall-first wrapper around:

```bash
agent-harness discover demand-profile
agent-harness discover sources
agent-harness discover sync
agent-harness discover catalog
agent-harness discover select
```

Then inspect:

- `discover/output/source-index.json`
- `discover/output/source-utilization.json`
- `discover/output/selection-report.json`
- `discover/output/catalog.selected.jsonl`
- `discover/output/catalog.rejected.jsonl`
- `state/recommendations.json`

### Step 3. Decide what is actually narrow

Use this rule of thumb:

- **Demand profile is wrong** -> fix workspace visibility first
- **Source index is broad but utilization is weak** -> source declarations exist but are not producing usable entries
- **Catalog is broad but selected set is small** -> selection is the bottleneck
- **Selected set is healthy but recommendations still miss obvious tools** -> ranking/policy is the bottleneck, not breadth

### Step 4. Widen the discovery universe if the checked-in sources are still not enough

Edit the active state-root discovery inputs, then rerun discovery:

- `discover/sources.json`
- `discover/source-packs/*.json`
- `discover/official-skills-indexes.json`
- `discover/official-upstreams.json`

Then rerun:

```bash
agent-harness discover breadth
agent-harness discover stats
agent-harness recommend report --intent <intent>
```

## Agent-prompted workflow

Use this when you want another AI agent to maximize candidate recall without blindly changing recommendation policy.

```text
You are using agent-harness to maximize the practical candidate asset pool for this workspace before judging recommendation quality.

Workspace root: <workspace-path>
Host: <vscode|cursor|opencode|zed|claude-code|pi>
Intent: <optional primary intent>

Goals:
1. Verify that demand detection sees the real workspace.
2. Build the widest checked-in discovery universe first.
3. Inspect whether the bottleneck is demand detection, source coverage, selection filtering, or ranking.
4. Only suggest discovery-config or policy edits after proving where the bottleneck is.

Required workflow:
- Run `agent-harness setup doctor --host <host>`.
- Run `agent-harness discover breadth`.
- Run `agent-harness discover stats`.
- Run `agent-harness recommend report --intent <intent>` when a primary intent is provided.
- Inspect these files when they exist, relative to the active state root:
  - `discover/output/demand-profile.json`
  - `discover/output/source-index.json`
  - `discover/output/source-utilization.json`
  - `discover/output/selection-report.json`
  - `discover/output/catalog.selected.jsonl`
  - `discover/output/catalog.rejected.jsonl`
  - `state/recommendations.json`
- If the checked-in source universe still looks too narrow, point me to the exact active-state-root files that should be edited next:
  - `discover/sources.json`
  - `discover/source-packs/*.json`
  - `discover/official-skills-indexes.json`
  - `discover/official-upstreams.json`
- Do not recommend policy changes until you have shown whether the bottleneck is source coverage or ranking.

When ready, give me:
- a short diagnosis
- whether the bottleneck is detection, source coverage, selection, or ranking
- the exact commands you ran (including `agent-harness discover breadth`)
- the exact state-root files I should edit next if the discovery universe still needs widening
```

## When not to use this playbook

Do **not** start here when the real issue is clearly one of these:

- you already have a healthy selected set, but the top recommendations are noisy -> use `RECOMMENDATION-POLICY-PLAYBOOK.md`
- you want the optional bounded AI sidecar or AI reranking flow -> use `AI-ENRICHMENT-PLAYBOOK.md`
- your installed assets are stale and need refresh/apply flow -> use `ASSET-UPDATE-PLAYBOOK.md`
