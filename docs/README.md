# Documentation index

This directory contains project documentation organized into four categories. Each category is linked from the main [`README.md`](../README.md) and serves a specific reader purpose.

## Directory structure

```
docs/
├── README.md           ← this file — category overview and navigation
├── demo/               ← reproducible terminal demo sources and walkthroughs
├── guides/             ← how-to guides and reference-style technical docs
├── playbooks/          ← scenario-driven workflows for common agent-harness operations
├── reference/          ← in-depth planning, audit, and architecture documents
│   └── hosts/          ← per-host adapter reference pages
```

---

## `demo/` — Terminal demo

Walkthrough and recording source for the published product demo.

| File                                                                | Description                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`README.md`](./demo/README.md)                                     | Demo recording contract, reproduction instructions, and script notes                                    |
| [`v2-opencode-walkthrough.md`](./demo/v2-opencode-walkthrough.md)   | Full v2 before/after walkthrough with expected artifacts and quarantine/security talking points         |
| [`workspace-opencode-demo.mjs`](./demo/workspace-opencode-demo.mjs) | Reproducible terminal demo script — creates a throwaway workspace and prints the quick-start transcript |

The demo video source lives in the separate [`agent-harness-demo-video`](https://github.com/ar27111994/agent-harness-demo-video) repository (Remotion-rendered). The README hero GIF is generated from that repo and committed here.

---

## `guides/` — How-to guides and technical reference

Independent guides that explain how the harness works, how to maintain it, and how specific features behave.

| File                                                                    | Description                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`CATALOG-BREADTH.md`](./guides/CATALOG-BREADTH.md)                     | How to evaluate and expand catalog breadth during discovery                                             |
| [`HARNESS-MAINTENANCE-GUIDE.md`](./guides/HARNESS-MAINTENANCE-GUIDE.md) | Day-to-day maintenance procedures for the harness repo                                                  |
| [`LOGGING-STRATEGY.md`](./guides/LOGGING-STRATEGY.md)                   | CLI output and logging conventions, and why lightweight helpers were chosen over a full logging library |
| [`MAINTENANCE-WORKFLOW.md`](./guides/MAINTENANCE-WORKFLOW.md)           | Maintenance workflow step-by-step                                                                       |
| [`RELEASE-PROCESS.md`](./guides/RELEASE-PROCESS.md)                     | Release workflow and checklist                                                                          |
| [`SAFE-DEFAULTS.md`](./guides/SAFE-DEFAULTS.md)                         | Default safety boundaries and what they protect                                                         |
| [`SEMANTIC-SCORING.md`](./guides/SEMANTIC-SCORING.md)                   | How the semantic scoring model works in recommendation ranking                                          |
| [`SOURCE-PACK-SEEDER.md`](./guides/SOURCE-PACK-SEEDER.md)               | How to seed and manage source packs                                                                     |
| [`TROUBLESHOOTING.md`](./guides/TROUBLESHOOTING.md)                     | Common problems and resolutions                                                                         |
| [`TRUST-CENTER.md`](./guides/TRUST-CENTER.md)                           | v2 trust model, safe defaults, review-required paths, and security non-guarantees                       |
| [`V1-TO-V2-UPGRADE.md`](./guides/V1-TO-V2-UPGRADE.md)                   | Migration notes from v1 to v2                                                                           |
| [`V2-CONTRACT.md`](./guides/V2-CONTRACT.md)                             | The v2 adapter contract and public API commitments                                                      |

---

## `playbooks/` — Scenario-driven workflows

Step-by-step playbooks for common agent-harness operations. Each one is a standalone workflow that can be followed by a human or an agent.

| File                                                                                 | Description                                                                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [`AGENT-SETUP-PLAYBOOK.md`](./playbooks/AGENT-SETUP-PLAYBOOK.md)                     | Dry-run setup workflow, decision tree, and reusable agent prompts for workspace/host asset setup |
| [`AI-ENRICHMENT-PLAYBOOK.md`](./playbooks/AI-ENRICHMENT-PLAYBOOK.md)                 | Scenario-based guidance for enrichment modes, bounded AI review, and operator workflows          |
| [`ASSET-UPDATE-PLAYBOOK.md`](./playbooks/ASSET-UPDATE-PLAYBOOK.md)                   | Report-only, due-only, and apply-safe refresh/update workflows for installed assets              |
| [`DEMAND-DETECTION-PLAYBOOK.md`](./playbooks/DEMAND-DETECTION-PLAYBOOK.md)           | How demand detection works and how to tune it                                                    |
| [`DISCOVERY-BREADTH-PLAYBOOK.md`](./playbooks/DISCOVERY-BREADTH-PLAYBOOK.md)         | How to maximise the practical candidate pool before judging recommendation quality               |
| [`QUARANTINE-PLAYBOOK.md`](./playbooks/QUARANTINE-PLAYBOOK.md)                       | Quarantine review flow and decision tree                                                         |
| [`RECOMMENDATION-POLICY-PLAYBOOK.md`](./playbooks/RECOMMENDATION-POLICY-PLAYBOOK.md) | How to inspect and tweak ranking policy after recall looks healthy                               |
| [`SOURCE-COVERAGE-PLAYBOOK.md`](./playbooks/SOURCE-COVERAGE-PLAYBOOK.md)             | How to assess and improve source coverage                                                        |
| [`WORKSPACE-EVOLUTION-PLAYBOOK.md`](./playbooks/WORKSPACE-EVOLUTION-PLAYBOOK.md)     | How to handle recurring post-wire-in repository drift                                            |

---

## `reference/` — Planning, audit, and architecture

In-depth documents covering the project's strategy, implementation plans, coverage analysis, and audit results.

| File                                                                                 | Description                                                                                                                         |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| [`COVERAGE-100-ROADMAP.md`](./reference/COVERAGE-100-ROADMAP.md)                     | The 100% coverage policy, gap-inventory workflow, and maintained coverage targets                                                   |
| [`DEMAND-DETECTION-COVERAGE.md`](./reference/DEMAND-DETECTION-COVERAGE.md)           | Coverage analysis of detector signatures across domains                                                                             |
| [`FUTURE-IMPROVEMENTS.md`](./reference/FUTURE-IMPROVEMENTS.md)                       | Follow-up ideas and architectural extensions                                                                                        |
| [`HOST-SURFACE-AUDIT.md`](./reference/HOST-SURFACE-AUDIT.md)                         | Checked-in matrix mapping host-facing paths/settings to documented, compatibility, harness-managed, or implementation-detail status |
| [`IMPLEMENTATION-PLAN.md`](./reference/IMPLEMENTATION-PLAN.md)                       | Milestone-oriented execution plan                                                                                                   |
| [`REGISTRY-ENRICHMENT.md`](./reference/REGISTRY-ENRICHMENT.md)                       | Registry enrichment strategy                                                                                                        |
| [`ROADMAP.md`](./reference/ROADMAP.md)                                               | Gap analysis and long-range direction                                                                                               |
| [`SOURCE-SYNC-DECOMPOSITION-PLAN.md`](./reference/SOURCE-SYNC-DECOMPOSITION-PLAN.md) | Plan for decomposing source-sync module                                                                                             |

#### Host adapter references

| File                                                       | Description                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [`claude-code.md`](./reference/hosts/claude-code.md)       | Claude Code adapter — supported behavior, managed files, and known limitations              |
| [`codex.md`](./reference/hosts/codex.md)                   | OpenAI Codex adapter — supported behavior, managed files, and known limitations             |
| [`cursor.md`](./reference/hosts/cursor.md)                 | Cursor adapter — supported behavior, managed files, and known limitations                   |
| [`opencode.md`](./reference/hosts/opencode.md)             | OpenCode adapter — supported behavior, managed files, and known limitations                 |
| [`pi.md`](./reference/hosts/pi.md)                         | Pi adapter — supported behavior, managed files, and known limitations                       |
| [`vscode-copilot.md`](./reference/hosts/vscode-copilot.md) | VS Code / GitHub Copilot adapter — supported behavior, managed files, and known limitations |
| [`zed.md`](./reference/hosts/zed.md)                       | Zed adapter — supported behavior, managed files, and known limitations                      |

---

## Entry-point documents

These are the key documents linked from the main README and the most common starting points:

- **Getting started:** [`../README.md#quick-start`](../README.md#quick-start) — follow the quick-start instructions in the main README.
- **Agent setup:** [`AGENT-SETUP-PLAYBOOK.md`](./playbooks/AGENT-SETUP-PLAYBOOK.md) — end-to-end workspace/host setup walkthrough.
- **Troubleshooting:** [`TROUBLESHOOTING.md`](./guides/TROUBLESHOOTING.md) — common CLI and lifecycle issues.
- **Security model:** [`TRUST-CENTER.md`](./guides/TRUST-CENTER.md) — trust model, safe defaults, and security boundaries.
- **Release notes:** [`../CHANGELOG.md`](../CHANGELOG.md) — version history and release notes.
- **Contributing:** [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — contribution workflow and hygiene.

## Consistency with main README

The main [`README.md`](../README.md) is the single entry point for users. It links to docs in this directory from the [Key Playbooks](../README.md#key-playbooks), [Command reference](../README.md#command-reference), [Troubleshooting](../README.md#troubleshooting), [Security and trust center](../README.md#security-and-trust-center), and [Related documentation](../README.md#related-documentation) sections.

Documents in this directory follow these conventions:

1. **Guides** (`guides/`) explain _how a feature works_ — mechanics, configuration, conventions.
2. **Playbooks** (`playbooks/`) explain _what to do in a specific scenario_ — step-by-step workflows for agents and humans.
3. **Reference** (`reference/`) stores _audit, planning, and long-term strategy_ documents that support the project roadmap and quality gates.
4. **Demo** (`demo/`) holds terminal demo recording sources and walkthrough notes.

This mirrors the section structure of the main README: playbook references are grouped under [Key Playbooks](../README.md#key-playbooks), guides under [Command reference](../README.md#command-reference) annotations and [Troubleshooting](../README.md#troubleshooting), and reference docs under [Related documentation](../README.md#related-documentation).
