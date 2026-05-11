# Agent Setup Playbook

This playbook shows how to use `agent-harness` with another AI agent as a dry-run setup operator.

Use it when you want an agent to:

- inspect a workspace
- explain what `agent-harness` detected
- optionally review the bounded AI enrichment sidecar without confusing it with recommendation reranking
- preview what would be wired into a host
- separate safe preview steps from mutating install/apply steps
- suggest manual follow-up for extensions, plugins, MCP servers, authentication, or host runtime setup

The goal is simple: **dry run first, approve second, apply/install last.**

## When to use this playbook

Use this playbook when:

- recommendations look noisy or surprising
- you want help choosing a host (`vscode`, `cursor`, `opencode`, `zed`, `claude-code`, `pi`)
- you want setup help for one or more intents such as `frontend`, `backend`, or `docs`
- you want an agent to guide setup without immediately mutating your workspace or global host config
- you want a clean separation between staged/wired assets and native/manual installation steps

If your first question is "how do I give recommendations the widest sensible candidate pool?", start with [`DISCOVERY-BREADTH-PLAYBOOK.md`](./DISCOVERY-BREADTH-PLAYBOOK.md) and then return to this playbook for dry-run setup/apply decisions.

## Dry-run workflow

Run this sequence from the target workspace root.

Unless you override it with `--state-root` or `AGENT_HARNESS_STATE_ROOT`, packaged CLI usage writes lifecycle artifacts under workspace-local `.agent-harness/`. Repository-local development in this repo still writes them at the repository root. The paths below are shown relative to the active state root.

### 1. Check host readiness

```bash
agent-harness setup doctor --host <host>
```

Use this to confirm:

- lifecycle host and recommendation host
- CLI/runtime readiness
- adapter capabilities
- any native-install boundary for the selected host

### 2. Build workspace evidence

Use the workspace root so the detector can see the real repo manifests and dependencies.

```bash
agent-harness discover breadth
agent-harness discover stats
agent-harness recommend report
```

If AI enrichment is configured and you want the bounded sidecar summary as part of the review, either run it explicitly:

```bash
agent-harness discover enrich
```

or include it in the wrapper flow:

```bash
agent-harness discover full --ai-enrich
```

`discover breadth` is the canonical one-shot command when you want the widest practical candidate pool and a quick diagnosis before ranking/install decisions.

Inspect these files when they exist:

- `discover/output/demand-profile.json`
- `discover/output/selection-report.json`
- `discover/output/source-index.json`
- `discover/output/source-utilization.json`
- `discover/output/ai-enrichment-input.json`
- `discover/output/ai-enrichment.json`
- `state/recommendations.json`

If you are using the installed package defaults, these are typically under `.agent-harness/` (for example `.agent-harness/discover/output/demand-profile.json`).

### 3. Preview wire-in before any apply step

```bash
agent-harness wire <host> --preview
```

Typical preview outputs:

- `activate/<host>/wire-preview-<host>.json`
- `activate/copilot-vscode/wire-preview-vscode.json` for VS Code / GitHub Copilot

In installed/package usage, prefix those with the active state root (for example `.agent-harness/activate/cursor/wire-preview-cursor.json`).

Use the preview to answer:

- which target paths would be touched
- which assets are only staged vs actually wired
- which host-specific settings or project-local files are involved
- whether the host integration looks correct before approval

### 4. Review native install planning separately

Some asset kinds need more than staging/wiring.

Examples:

- VS Code / Cursor extensions may require explicit native install commands.
- MCP servers may need authentication, secrets, local executables, or runtime config.
- Plugins and host-specific integrations may need a host CLI, extension provider, or host-side login.

Useful commands:

```bash
agent-harness install native --host vscode
agent-harness install native --host vscode --operation verify
agent-harness install native --host cursor
agent-harness install native --host cursor --operation verify
```

Mutating native install or remove actions require `--apply`.

## Decision tree: when recommendations look wrong

Use this before increasing selection breadth or changing policy. The artifact paths below are relative to the active state root.

### Step 1: Check demand detection first

Inspect `discover/output/demand-profile.json`.

If the real stack is missing here, fix that first.

Common causes:

- running from the wrong directory
- manifests excluded by `.gitignore`, `.ignore`, or `.agent-harnessignore`
- unsupported or weak dependency evidence

### Step 2: Check selection counts second

Inspect `discover/output/selection-report.json`.

- If `selectedCount` is very low, selection filtering may be too strict.
- If `selectedCount` is already healthy, increasing it is usually the wrong first move.

### Step 3: Check ranking before changing selection

Inspect `state/recommendations.json`.

Use `recommend explain` on both:

- one asset that clearly belongs
- one asset that looks noisy or off-topic

Example:

```bash
agent-harness recommend explain --host <host> --asset <asset-id>
```

If relevant technologies are already detected and selected but weak recommendations still dominate, the problem is usually:

- ranking
- host policy
- source weighting
- overly broad generic signals

### Step 4: Separate recommendation from installation

A recommended asset is not automatically installed.

Check:

- `wire --preview` output
- native install planning
- manual runtime prerequisites

A bad outcome can come from correct recommendations plus incomplete runtime setup.

### Step 5: Increase selection count only as a last resort

Do this only when:

- demand detection is correct
- the selected set genuinely misses relevant candidates
- source coverage is not the real bottleneck

If the right assets are already present in the selected set, tune ranking or source mix instead of making the pool larger.

## How to classify suggested assets

A good setup review should classify each suggested asset like this:

### Usually handled by the normal lifecycle

- instructions
- agents
- skills
- hooks
- prompt packs
- workflows

These are typically staged, activated, and wired by the normal lifecycle for the selected host.

### Usually requires explicit native install

- VS Code extensions
- Cursor extensions where supported by a compatible CLI/provider

Review first, then use explicit native install commands only after approval.

Examples:

```bash
agent-harness install native --host vscode --operation install --apply
agent-harness install native --host cursor --operation install --apply
```

### Usually requires manual runtime/auth/config follow-up

- MCP servers
- plugins with external runtime expectations
- integrations that depend on host login or local executables

These may be staged or referenced correctly while still needing:

- API keys
- account login
- executable availability on PATH
- host-side enablement
- local config edits outside the harness-managed surface

## Copy-paste prompts for AI agents

### Prompt 1: dry-run operator

```text
You are setting up agent assets for this workspace with agent-harness.

Workspace root: <workspace-path>
Host: <vscode|cursor|opencode|zed|claude-code|pi>
Intent(s): <optional intent list such as frontend, backend, docs>

Use agent-harness as the source of truth and do a dry run first.

Goals:
1. Inspect host readiness.
2. Run only non-mutating preview/planning commands first.
3. Explain what agent-harness detected about this workspace.
4. Explain which assets are being recommended and why.
5. Separate staged/wired assets from native/manual installs.
6. Only suggest apply/install commands after the dry run looks correct.

Required workflow:
- Run `agent-harness setup doctor --host <host>`.
- Run the workspace discovery/recommendation flow needed for inspection.
- If AI enrichment is configured, decide whether to keep it manual (`discover enrich` / `--ai-enrich`) or let the configured automatic mode run.
- Run `agent-harness wire <host> --preview` before any apply.
- Inspect at least these files when they exist (relative to the active state root):
  - `discover/output/demand-profile.json`
  - `discover/output/selection-report.json`
  - `state/recommendations.json`
  - `activate/<host>/wire-preview-<host>.json` or host-equivalent preview output
- If recommendations look wrong, explain whether the problem is:
  - demand detection
  - selection filtering
  - ranking/policy
  - source mix
  - host-native install support
- For each suggested asset, label it as one of:
  - already staged/wired by agent-harness
  - requires explicit native install
  - requires manual runtime/auth/config follow-up
- Do not apply changes or install anything unless I explicitly confirm.

When ready, give me:
- a short diagnosis
- the exact previewed commands you ran
- the exact apply/install commands you recommend next
- any manual steps for extensions, plugins, MCP servers, auth, or host settings
```

### Prompt 2: approved execution follow-up

```text
Proceed with the approved agent-harness setup plan for this workspace.
Use the same workspace root, host, and intents we already reviewed.

Rules:
- Apply wire changes only after confirming the preview still matches.
- Use explicit native install commands only for assets that require them.
- Keep manual/runtime-only steps separate from tool-executed steps.
- After finishing, summarize:
  - what was staged
  - what was wired
  - what was natively installed
  - what still needs manual follow-up
```

## Suggested operator output format

A good agent response after the dry run should usually look like this:

1. **Diagnosis**
   - what the workspace looks like
   - whether the issue is detection, selection, ranking, source mix, install support, or manual setup
2. **Previewed commands**
   - exact non-mutating commands already run
3. **Recommended next commands**
   - exact apply/install commands, clearly marked as mutating
4. **Manual follow-up**
   - extensions to review
   - plugins to enable
   - MCP auth/config steps
   - host/runtime prerequisites

## Practical rule of thumb

- **Missing relevant assets entirely** -> investigate detection, source coverage, or selection.
- **Relevant assets exist but lose to noisy ones** -> investigate ranking, policy, and source weighting.
- **Assets are recommended but not active in the host** -> inspect wire previews, native install planning, and runtime prerequisites.

## Related playbooks

- [`DISCOVERY-BREADTH-PLAYBOOK.md`](./DISCOVERY-BREADTH-PLAYBOOK.md) - maximize the candidate pool before ranking/setup decisions
- [`AI-ENRICHMENT-PLAYBOOK.md`](./AI-ENRICHMENT-PLAYBOOK.md) - choose between enrichment modes and bounded AI review
- [`ASSET-UPDATE-PLAYBOOK.md`](./ASSET-UPDATE-PLAYBOOK.md) - refresh stale installed assets safely
- [`RECOMMENDATION-POLICY-PLAYBOOK.md`](./RECOMMENDATION-POLICY-PLAYBOOK.md) - tune ranking only after recall looks healthy

## Related commands

```bash
agent-harness setup doctor --host <host>
agent-harness discover breadth
agent-harness discover full --ai-enrich
agent-harness discover enrich
agent-harness discover stats
agent-harness recommend report
agent-harness recommend explain --host <host> --asset <asset-id>
agent-harness wire <host> --preview
agent-harness wire <host> --apply
agent-harness install native --host <host>
agent-harness install native --host <host> --operation verify
agent-harness install native --host <host> --operation install --apply
```
