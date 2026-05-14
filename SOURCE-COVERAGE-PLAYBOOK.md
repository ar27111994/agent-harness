# Source Coverage Playbook

Use this playbook when `agent-harness` is seeing the workspace correctly, but the active discovery universe is still too narrow, too noisy, or missing an important ecosystem.

This is the right guide when:

- `discover/output/demand-profile.json` looks broadly right, but the catalog is still thin
- `discover/output/source-index.json` or `discover/output/source-utilization.json` shows obvious source gaps
- you need to decide whether to edit `discover/sources.json`, a source pack, or one of the official indexes/upstream maps
- you want to widen breadth without blindly changing recommendation policy

If the real problem is that the workspace stack is being detected incorrectly, use [`DEMAND-DETECTION-PLAYBOOK.md`](./DEMAND-DETECTION-PLAYBOOK.md) first.

## The short answer

Treat source coverage as a registry-quality problem, not a ranking problem.

1. run `agent-harness discover breadth`
2. inspect the active source artifacts under the current state root
3. prove whether the gap is:
   - missing source declarations
   - weak/duplicate/noisy source definitions
   - a sync/harvest failure
   - selection/ranking rather than source coverage
4. edit the smallest source-registry input that can solve the gap cleanly
5. rerun breadth/stats/recommendation validation before shipping

## What to inspect

Run this from the target workspace root:

```bash
agent-harness discover breadth
agent-harness discover stats
```

Inspect these artifacts relative to the active state root:

- `discover/output/source-index.json`
- `discover/output/source-utilization.json`
- `discover/output/selection-report.json`
- `discover/output/catalog.selected.jsonl`
- `discover/output/catalog.rejected.jsonl`
- `state/recommendations.json`

Use these to answer:

- Did the source appear at all?
- Did it sync/harvest successfully?
- Did it contribute useful entries?
- Did selection reject what it produced?
- Did recommendation ranking ignore a healthy selected set?

## Which source file to change

### `discover/sources.json`

Use this for **individual source declarations**.

Typical cases:

- adding one new high-value repo/doc/package source
- refining source metadata for an existing source
- disabling or correcting one noisy source

Choose this when the change is specific and does not belong in a reusable pack.

### `discover/source-packs/*.json`

Use this for **curated groups of related sources**.

Typical cases:

- a new ecosystem or tool family deserves a reusable pack
- multiple sources should be versioned together as one curated unit
- you are widening breadth for a coherent domain, not a single source

Prefer packs when the addition would otherwise scatter many related sources into the base registry.

### `discover/official-skills-indexes.json`

Use this when the gap is in **official skill/index coverage**.

Typical cases:

- an official index is missing entirely
- index metadata for an official source family needs expansion
- discovery breadth depends on harvesting from a maintained official catalog

### `discover/official-upstreams.json`

Use this when the gap is in **canonical upstream resolution** for already indexed content.

Typical cases:

- official entries exist, but they do not resolve to the right repo-backed upstream
- upstream mapping is incomplete or stale
- mirror fidelity depends on better canonical source mapping

## Contributor workflow

### Step 1. Prove the gap is really source coverage

Start with:

```bash
agent-harness discover breadth
agent-harness discover stats
agent-harness recommend report
```

If `discover/output/demand-profile.json` is wrong, stop and use [`DEMAND-DETECTION-PLAYBOOK.md`](./DEMAND-DETECTION-PLAYBOOK.md) first.

If the selected set is healthy but the final ranking is still bad, stop and use [`RECOMMENDATION-POLICY-PLAYBOOK.md`](./RECOMMENDATION-POLICY-PLAYBOOK.md) instead.

### Step 2. Identify whether the source is missing, weak, or noisy

Check:

- `discover/output/source-index.json` to see whether the source is present and enabled
- `discover/output/source-utilization.json` to see whether it is yielding usable entries
- `discover/output/catalog.selected.jsonl` / `catalog.rejected.jsonl` to see whether the source is producing entries that selection immediately rejects

Use this rule of thumb:

- source absent -> add or register it
- source present but unused -> inspect sync/harvest behavior and metadata quality
- source present but noisy -> refine or narrow it rather than just adding more sources
- source healthy but final ranking weak -> stop changing coverage and inspect policy

### Step 3. Make the smallest clean registry change

Prefer:

- one clear source addition over many speculative ones
- curated packs over copy-pasted source sprawl
- canonical upstream mappings over duplicate source declarations
- source metadata that explains intent and provenance

Avoid:

- flooding the registry with low-value duplicates
- adding broad sources that only create noise
- solving ranking problems by endlessly widening source volume
- repo-specific coverage hacks that do not generalize

### Step 4. Validate the change

After editing discovery source inputs, run:

```bash
npm run build
npm test
agent-harness discover breadth
agent-harness discover stats
agent-harness recommend report
```

When the change touches indexed/synced remote sources, also inspect the regenerated source artifacts directly:

- `discover/output/source-index.json`
- `discover/output/source-utilization.json`
- `discover/output/selection-report.json`

## Signs of a good source-coverage change

A good change should do at least one of these clearly:

- add missing ecosystem coverage that produces usable selected entries
- improve canonical upstream resolution for already indexed content
- remove or narrow noisy duplication
- improve utilization quality, not just raw source count

A bad change usually looks like this:

- source count goes up, but selected quality does not
- duplicate assets proliferate across families
- source utilization becomes noisier without better recommendations
- the project now depends on special-case registry entries for one repo shape

## AI-agent prompt

Use this when you want another agent to diagnose and improve source coverage without confusing it with ranking.

```text
You are improving source coverage in agent-harness.

Workspace root: <workspace-path>
Host: <vscode|cursor|opencode|zed|claude-code|pi>
Intent: <optional one-or-more intents>

Goals:
- Confirm whether the bottleneck is source coverage rather than demand detection or recommendation ranking.
- Edit the smallest correct discovery-source input that solves the gap.
- Avoid duplicate/noisy source expansion.

Required workflow:
- Run `agent-harness discover breadth`.
- Run `agent-harness discover stats`.
- Run `agent-harness recommend report` when ranking output is needed for confirmation.
- Inspect, relative to the active state root:
  - `discover/output/demand-profile.json`
  - `discover/output/source-index.json`
  - `discover/output/source-utilization.json`
  - `discover/output/selection-report.json`
  - `discover/output/catalog.selected.jsonl`
  - `discover/output/catalog.rejected.jsonl`
  - `state/recommendations.json`
- Decide whether the change belongs in:
  - `discover/sources.json`
  - `discover/source-packs/*.json`
  - `discover/official-skills-indexes.json`
  - `discover/official-upstreams.json`
- Prefer source-quality improvements over raw source-count inflation.
- Validate with `npm run build`, `npm test`, `agent-harness discover breadth`, and `agent-harness discover stats`.

When ready, give me:
- whether the bottleneck was source coverage, selection, or ranking
- the exact discovery-source files changed
- the before/after effect on source-index or selection outputs
- any remaining noisy or duplicate-source risks
```

## When not to use this playbook

Do **not** start here when:

- the demand profile itself is wrong -> use [`DEMAND-DETECTION-PLAYBOOK.md`](./DEMAND-DETECTION-PLAYBOOK.md)
- the candidate pool is already healthy and you only need better ordering -> use [`RECOMMENDATION-POLICY-PLAYBOOK.md`](./RECOMMENDATION-POLICY-PLAYBOOK.md)
- you want the recall-first diagnosis entrypoint -> start with [`DISCOVERY-BREADTH-PLAYBOOK.md`](./DISCOVERY-BREADTH-PLAYBOOK.md)
