# Demand Detection Playbook

Use this playbook when `agent-harness` is looking at the right workspace but the detected stack, intents, or evidence in `discover/output/demand-profile.json` still look wrong, weak, or incomplete.

This is the right guide when:

- obvious technologies in the repo are missing from the demand profile
- the detected stack is too generic for a specialized workspace
- the harness found the workspace, but recommendation breadth still looks narrow for the wrong reasons
- you want to improve detection logic without adding repo-specific hacks

If the real problem is that the source universe itself is too small, use [`SOURCE-COVERAGE-PLAYBOOK.md`](./SOURCE-COVERAGE-PLAYBOOK.md) instead.

## The short answer

Start by proving whether the failure is a **false negative**, a **false positive**, or simply **weak evidence**:

1. run `agent-harness discover demand-profile` from the real workspace root
2. inspect `discover/output/demand-profile.json`
3. compare the emitted evidence against the actual manifests, configs, and directory layout in the workspace
4. decide whether the fix belongs in:
   - `src/domains/discovery/demand-profile.ts`
   - `src/domains/discovery/demand-signals.ts`
   - `src/domains/discovery/detector-signatures.ts`
   - `src/domains/discovery/technology-signatures.ts`
5. validate with the focused detection suites before touching ranking or policy

Do **not** widen recommendation policy first. Detection problems should be fixed at the detection layer.

## What good diagnosis looks like

### False negatives

The workspace clearly contains a real stack signal, but the demand profile misses it.

Examples:

- a TypeScript repo is detected only as generic JavaScript
- docs-heavy repositories are missing docs/research evidence
- test-heavy repos are missing testing demand
- a CLI repo is missing command/runtime evidence

### False positives

The profile claims a stack or concern that the workspace does not actually support.

Examples:

- frontend demand inferred from one stray config file
- devops/security concerns triggered by weak incidental evidence
- mobile or data signals inferred from generic keywords with no repo support

### Weak evidence

The right stack appears, but the confidence is too low or the evidence is too thin to influence later stages cleanly.

Examples:

- the right technologies are present, but the evidence list is sparse
- the harness sees one manifest but misses surrounding corroborating files
- a repo has multiple real concerns, but only one is strongly surfaced

## Artifacts to inspect first

Run this from the target workspace root:

```bash
agent-harness discover demand-profile
```

Inspect:

- `discover/output/demand-profile.json`
- `discover/output/workspace-summary.json` when present
- representative workspace manifests and config files that should have been detected

When debugging a full breadth flow, also compare:

- `discover/output/selection-report.json`
- `state/recommendations.json`

Those downstream artifacts help confirm whether the real bottleneck is still detection.

## Which file to change

### `src/domains/discovery/technology-signatures.ts`

Use this when the fix is mostly **data-driven technology recognition**.

Typical examples:

- add or refine file-name / package / config signatures
- strengthen evidence for a known stack with more grounded indicators
- normalize additional aliases for an already supported technology

Prefer this path when you can solve the problem by teaching the harness better evidence, not by adding custom branching logic.

### `src/domains/discovery/detector-signatures.ts`

Use this when the fix is a more focused **detector rule or detector evidence map**.

Typical examples:

- a detector needs additional high-signal inputs
- concern-specific evidence mapping is incomplete
- one detector needs better positive/negative heuristics

### `src/domains/discovery/demand-signals.ts`

Use this when the issue is in **how raw evidence is merged, weighted, or normalized** into the final demand signal set.

Typical examples:

- the right evidence exists but is combined poorly
- evidence strength needs better balancing
- one signal category is crowding out another

### `src/domains/discovery/demand-profile.ts`

Use this when the problem is in the **overall demand-profile assembly flow** rather than in a specific signature table.

Typical examples:

- aggregation order is wrong
- a processing stage skips relevant evidence classes
- workspace-level assembly logic is flawed

## Contributor workflow

### Step 1. Reproduce the failure on a representative fixture or repo

Start with the real workspace that exposed the issue, then distill it into a representative fixture when the failure mode is broadly useful.

Prefer fixture-driven coverage over one-off repo-specific exceptions.

Good fixture candidates live alongside or near:

- `src/tests/detection-fixtures.ts`
- `src/tests/fixtures/`

### Step 2. Inspect the current detection result

Run:

```bash
agent-harness discover demand-profile
node --test dist/tests/demand-profile.test.js dist/tests/detectors.test.js dist/tests/technology-signatures.test.js
```

Compare expected repo signals with the actual `discover/output/demand-profile.json` output.

### Step 3. Make the smallest data-first fix that actually solves the case

Prefer this order:

1. improve signatures/data
2. improve detector-level mapping
3. improve aggregation logic
4. only then touch broader orchestration

Avoid:

- repo-name special cases
- path hacks that only fit one workspace layout
- keyword-only heuristics without corroborating evidence
- changes that widen detection everywhere when the evidence is actually narrow

### Step 4. Validate detection quality

After any detection change, run:

```bash
npm run build
npm test
npm run quality:detection
```

Focused local checks are also useful during iteration:

```bash
node --test dist/tests/demand-profile.test.js
node --test dist/tests/detectors.test.js
node --test dist/tests/technology-signatures.test.js
```

Use `npm run quality:detection` before shipping to confirm you improved the representative quality report rather than only one fixture.

## How to avoid detection hacks

Use these rules:

- prefer multiple grounded signals over one broad keyword
- require corroborating evidence before claiming specialized stacks
- encode the general pattern, not the repo that happened to reveal it
- add fixtures that prove the new rule helps the target case without creating obvious false positives
- if you cannot express the fix cleanly without repo-specific branching, stop and redesign the rule

## AI-agent prompt

Use this when you want another agent to debug detection quality without guessing.

```text
You are improving demand detection in agent-harness.

Workspace root: <workspace-path>

Goal:
- Diagnose whether the current problem is a false negative, false positive, or weak evidence issue.
- Fix detection logic without repo-specific hacks.

Required workflow:
- Run `agent-harness discover demand-profile` from the real workspace root.
- Inspect `discover/output/demand-profile.json`.
- Compare detected signals against the actual manifests/config files in the workspace.
- Decide whether the change belongs in:
  - `src/domains/discovery/demand-profile.ts`
  - `src/domains/discovery/demand-signals.ts`
  - `src/domains/discovery/detector-signatures.ts`
  - `src/domains/discovery/technology-signatures.ts`
- Prefer data/signature changes before orchestration changes.
- Add or update representative tests/fixtures.
- Validate with:
  - `npm run build`
  - `npm test`
  - `npm run quality:detection`

When ready, give me:
- the diagnosis type (false negative / false positive / weak evidence)
- the exact files changed
- the representative tests or fixtures that prove the fix
- any follow-up risks or edge cases still worth watching
```

## When not to use this playbook

Do **not** start here when:

- the demand profile is already broadly correct, but the source universe is too small -> use [`SOURCE-COVERAGE-PLAYBOOK.md`](./SOURCE-COVERAGE-PLAYBOOK.md)
- the selected set is healthy but final ranking is noisy -> use [`RECOMMENDATION-POLICY-PLAYBOOK.md`](./RECOMMENDATION-POLICY-PLAYBOOK.md)
- you want a recall-first diagnosis across the whole discovery flow -> start with [`DISCOVERY-BREADTH-PLAYBOOK.md`](./DISCOVERY-BREADTH-PLAYBOOK.md)
