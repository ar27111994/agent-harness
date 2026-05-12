# AI Enrichment Playbook

Use this playbook when you want to configure, inspect, or operationalize the optional AI-assisted stages in `agent-harness`.

This guide covers two different features that share the same guarded endpoint config but do **different jobs**:

- `discover enrich` / `discover full --ai-enrich` / `workspace <host> --ai-enrich`
- `recommend ai-review` / `recommend report --ai-review`

## The important distinction

### AI enrichment

AI enrichment is a **bounded sidecar summary** attached to discovery.

Use it when you want:

- extra narrative context around selected assets
- a bounded summary for an operator review
- ambiguity-sensitive follow-up without replacing deterministic discovery

Artifacts:

- `discover/output/ai-enrichment-input.json`
- `discover/output/ai-enrichment.json`

### Recommendation AI review

Recommendation AI review is the bounded AI stage that can actually **rerank or suppress** recommendation entries.

Use it when you want:

- a second pass over the deterministic shortlist
- bounded AI suppression/reranking
- a review artifact you may optionally apply back into the report

Artifacts:

- `recommend/output/ai-review-input.json`
- `recommend/output/ai-review.json`

## Manual scenarios

### Scenario 1. Keep AI fully manual

This is the safest starting mode.

```bash
agent-harness discover full
agent-harness discover enrich
agent-harness recommend report
agent-harness recommend ai-review --host <host>
```

Suggested env:

```bash
AGENT_HARNESS_AI_ENRICHMENT_MODE=manual
```

### Scenario 2. Run enrichment as part of a workspace setup review

```bash
agent-harness workspace <host> --intent <intent> --ai-enrich
```

Use this when you want the deterministic flow plus the bounded enrichment sidecar in one run.

### Scenario 3. Auto-run enrichment only when it adds signal

```bash
AGENT_HARNESS_AI_ENRICHMENT_MODE=on-ambiguity
```

or

```bash
AGENT_HARNESS_AI_ENRICHMENT_MODE=on-input-change
```

These are the most conservative automatic modes when you do not want enrichment on every run.

### Scenario 4. Apply bounded AI reranking to recommendations

```bash
agent-harness recommend report --intent <intent>
agent-harness recommend ai-review --host <host> --apply
```

Or use the one-shot form:

```bash
agent-harness recommend report --intent <intent> --ai-review
```

## Recommended configuration workflow

### Step 1. Configure the endpoint once

```bash
AGENT_HARNESS_AI_ENRICHMENT_URL=https://api.openai.com/v1/chat/completions
AGENT_HARNESS_AI_ENRICHMENT_API_KEY=<token>
AGENT_HARNESS_AI_ENRICHMENT_MODEL=gpt-4o-mini
AGENT_HARNESS_AI_ENRICHMENT_MODE=manual
```

Optional:

```bash
AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS=https://gateway.example.com
```

Use `agent-harness setup login --provider ai` for built-in guidance.

### Step 2. Choose the right mode for the job

- `manual` -> best default for human-reviewed setup
- `after-select` -> good when selection always needs sidecar context
- `after-workspace` -> good for end-to-end workspace flows
- `on-ambiguity` -> good when you want AI only for uncertain cases
- `on-input-change` -> good when you want cache-aware refresh only when inputs differ
- `ci-only` -> good for headless or pipeline-specific automation
- `off` -> turns off automatic enrichment

### Step 3. Inspect the artifacts instead of guessing

Inspect:

- `discover/output/ai-enrichment-input.json`
- `discover/output/ai-enrichment.json`
- `recommend/output/ai-review-input.json`
- `recommend/output/ai-review.json`
- `state/recommendations.json`

## Agent-prompted workflow

```text
You are using agent-harness to configure and review the optional AI-assisted stages for this workspace.

Workspace root: <workspace-path>
Host: <vscode|cursor|opencode|zed|claude-code|pi>
Intent: <optional primary intent>

Goals:
1. Keep deterministic discovery/recommendation as the baseline.
2. Distinguish AI enrichment from recommendation AI review.
3. Recommend the safest useful AI mode for this workspace and workflow.
4. Show me the exact commands and artifacts, not just opinions.

Required workflow:
- Run the deterministic discovery/recommendation flow first.
- If enrichment is needed, run either `agent-harness discover enrich` or an explicit `--ai-enrich` wrapper flow.
- If recommendation reranking is needed, run `agent-harness recommend ai-review --host <host>` before proposing `--apply`.
- Inspect these files when they exist, relative to the active state root:
  - `discover/output/ai-enrichment-input.json`
  - `discover/output/ai-enrichment.json`
  - `recommend/output/ai-review-input.json`
  - `recommend/output/ai-review.json`
  - `state/recommendations.json`
- Recommend one of these modes with a reason: `manual`, `after-select`, `after-workspace`, `on-ambiguity`, `on-input-change`, `ci-only`, or `off`.
- Do not apply AI review changes unless I explicitly confirm.

When ready, give me:
- whether I should use enrichment, AI review, both, or neither
- the exact env/config you recommend
- the exact commands you ran
- whether `--apply` is actually justified
```

## Rule of thumb

- Need a bounded discovery-side summary -> use **AI enrichment**
- Need bounded reranking/suppression on the shortlist -> use **recommendation AI review**
- Need both -> keep them separate in your explanation so operators know which stage changed what
