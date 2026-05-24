# End-User Harness Maintenance Guide

Copy this guide into an AI coding agent after the first successful `agent-harness workspace <host> --intent <intent>` run. It keeps maintenance safe, reviewable, and boring.

## Assumptions

- Initial wire-in already succeeded for one host.
- Mutable state lives under `.agent-harness/` unless `--state-root` says otherwise.
- `wire <host>` preview is safe; `wire <host> --apply`, native installs, quarantine approvals, and trust-tier changes are review steps.
- Native/global host installs, MCP auth, marketplace extensions, executable hooks, plugins, and risky assets must never be silently enabled.

## Cadence

- Weekly: run the report-only maintenance loop.
- Before important releases or large dependency changes: run the same loop manually.
- After new quarantines/source drift/trust warnings: pause and review before applying anything.

## Safe automatic sequence

Run from the workspace root:

```bash
agent-harness discover demand-profile
agent-harness discover sources
agent-harness discover sync
agent-harness discover sources
agent-harness discover catalog
agent-harness discover select --no-ai-enrich
agent-harness discover stats
agent-harness recommend report --intent <intent>
agent-harness mirror plan
agent-harness mirror locks
agent-harness mirror diff
agent-harness install refresh --host <host>
agent-harness wire <host>
```

These commands produce reports and previews. They do not approve quarantine, promote trust tiers, or install native/global integrations.

## Reports to read

- `discover/output/demand-profile.json` — changed workspace demand.
- `discover/output/unknown-signals.json` — unfamiliar tech/source backlog.
- `discover/output/source-health.json` and `source-drift.json` — broken, dormant, stale, productive, or ambiguous sources.
- `discover/output/source-verification.json` — official-source verification and demotion evidence.
- `discover/output/source-candidates.json` — candidates that require approval before catalog promotion.
- `discover/output/asset-fingerprints.json` — stable identity, content hash, trust/quarantine state, duplicate evidence.
- `state/install/refresh-report.json` — stale installed/staged assets.
- `activate/<host>/wire-preview-<host>.json` — exact host writes before apply.
- `discover/output/maintenance-bot-plan.json` — PR/issue intents when using the maintenance workflow.

## Quarantine review

```bash
agent-harness quarantine list
agent-harness quarantine inspect --asset <asset-id>
```

Approve only when source identity, content, risk, and executable behavior are reviewed:

```bash
agent-harness quarantine approve --asset <asset-id> --reason "reviewed source and content"
```

Reject unsafe or unclear assets:

```bash
agent-harness quarantine reject --asset <asset-id> --reason "unsafe prompt or executable behavior"
```

Never approve quarantine just because an update is newer. Check whether the new version changed hooks, install scripts, MCP config, network behavior, or prompt-injection risk.

## Updating assets safely

Report-only first:

```bash
agent-harness install refresh --host <host>
```

Safe apply only after reviewing the refresh report:

```bash
AGENT_HARNESS_INSTALL_REFRESH_POLICY=apply-safe agent-harness install refresh --host <host> --apply
agent-harness wire <host>
```

If wire preview changed and looks correct:

```bash
agent-harness wire <host> --apply
```

Do not apply if the change introduces executable hooks/plugins/MCP servers/extensions, trust-tier ambiguity, new quarantine entries, or changed upstream fingerprints without review.

## Bot PRs and issues

Accept report-only bot PRs when:

- they only refresh generated reports or non-sensitive metadata summaries
- `maintenance-bot-plan.json` has no review-required issues
- no trust tier, quarantine, executable integration, or native/global install behavior changes

Defer or reject bot PRs when:

- generated reports are noisy or rate-limited
- source evidence is incomplete
- duplicate/official source evidence is unclear

Open/review issues when:

- official source ownership or publisher verification is ambiguous
- a source candidate needs trust-tier approval
- a quarantined asset needs approve/reject/pin decision
- a community asset wants promotion
- a staged/installed asset became risky on refresh

## Rollback and reversibility

- Use `wire <host>` preview before `--apply`.
- Use `wire <host> --reset` to remove adapter-managed project outputs.
- Use install generation commands to inspect/pin/prune staged generations.
- Prefer regenerating `.agent-harness/` state over migrating ambiguous old artifacts.
- Keep pinned generations/assets when a refresh report is unclear.

## Agent prompt

```text
You are maintaining agent-harness for this workspace.

Host: <host>
Intent: <intent>
State root: .agent-harness unless configured otherwise.

Run the safe automatic sequence only. Do not apply wire changes, approve quarantine, promote trust tiers, install native/global integrations, or enable executable hooks/plugins/MCP/extensions without explicit approval.

After running, inspect:
- discover/output/demand-profile.json
- discover/output/unknown-signals.json
- discover/output/source-health.json
- discover/output/source-drift.json
- discover/output/source-verification.json
- discover/output/source-candidates.json
- discover/output/asset-fingerprints.json
- state/install/refresh-report.json
- activate/<host>/wire-preview-<host>.json

Return:
1. What changed since the last run.
2. Any quarantine/source/trust/security issues.
3. Whether installed assets are stale.
4. Whether wire preview changed.
5. The exact next safe command.
6. Anything that requires human review.
```

## Deeper docs

- [`TRUST-CENTER.md`](https://github.com/ar27111994/agent-harness/blob/main/TRUST-CENTER.md)`n- [`WORKSPACE-EVOLUTION-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/WORKSPACE-EVOLUTION-PLAYBOOK.md)
- [`ASSET-UPDATE-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/ASSET-UPDATE-PLAYBOOK.md)
- [`MAINTENANCE-WORKFLOW.md`](https://github.com/ar27111994/agent-harness/blob/main/MAINTENANCE-WORKFLOW.md)
- [`AGENT-SETUP-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/AGENT-SETUP-PLAYBOOK.md)
