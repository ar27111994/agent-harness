# agent-harness

<p>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <a href="./package.json"><img alt="Node >=22" src="https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white" /></a>
  <a href="./package.json"><img alt="TypeScript 5.9" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" /></a>
  <a href="https://github.com/ar27111994/agent-harness/actions/workflows/quality.yml"><img alt="Quality workflow" src="https://github.com/ar27111994/agent-harness/actions/workflows/quality.yml/badge.svg" /></a>
  <a href="https://github.com/ar27111994/agent-harness/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/ar27111994/agent-harness?display_name=tag" /></a>
  <a href="https://www.npmjs.com/package/@ar27111994/agent-harness"><img alt="npm version" src="https://img.shields.io/npm/v/%40ar27111994%2Fagent-harness?logo=npm&color=CB3837" /></a>
  <a href="https://www.npmjs.com/package/@ar27111994/agent-harness"><img alt="npm downloads" src="https://img.shields.io/npm/dm/%40ar27111994%2Fagent-harness?logo=npm&color=CB3837" /></a>
  <a href="#sponsor"><img alt="Sponsor" src="https://img.shields.io/badge/Sponsor-support-ff69b4?logo=githubsponsors&logoColor=white" /></a>
  <a href="https://deepwiki.com/ar27111994/agent-harness"><img alt="Ask DeepWiki" src="https://deepwiki.com/badge.svg" /></a>
</p>

<p>
  <strong>Hosts:</strong>
  <a href="#supported-hosts"><img alt="VS Code + Copilot" src="https://img.shields.io/badge/VS%20Code%20%2B%20Copilot-007ACC?logo=githubcopilot&logoColor=white" /></a>
  <a href="#supported-hosts"><img alt="OpenCode" src="https://img.shields.io/badge/OpenCode-111827?logo=data:image/svg%2Bxml;base64,PHN2ZyBmaWxsPSJ3aGl0ZSIgcm9sZT0iaW1nIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHRpdGxlPk9wZW5Db2RlPC90aXRsZT48cGF0aCBkPSJNMjIgMjRIMlYwaDIwek0xNyA0LjhIN3YxNC40aDEweiIvPjwvc3ZnPg==" /></a>
  <a href="#supported-hosts"><img alt="Cursor" src="https://img.shields.io/badge/Cursor-000000?logo=cursor&logoColor=white" /></a>
  <a href="#supported-hosts"><img alt="Zed" src="https://img.shields.io/badge/Zed-084CCF?logo=zedindustries&logoColor=white" /></a>
  <a href="#supported-hosts"><img alt="Claude Code" src="https://img.shields.io/badge/Claude%20Code-D97757?logo=claude&logoColor=white" /></a>
  <a href="#supported-hosts"><img alt="Pi" src="https://img.shields.io/badge/Pi-FF4F8B?logo=data:image/svg%2Bxml;base64,PHN2ZyBmaWxsPSJ3aGl0ZSIgcm9sZT0iaW1nIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHRpdGxlPlBpPC90aXRsZT48cGF0aCBkPSJNMCAwdjI0aDZ2LTZoNnYtNkg2VjZoNnY2aDZWMFptMTggMTJ2MTJoNlYxMloiLz48L3N2Zz4=" /></a>
  <a href="#supported-hosts"><img alt="OpenAI Codex" src="https://img.shields.io/badge/OpenAI%20Codex-412991?logo=data:image/svg%2Bxml;base64,PHN2ZyBmaWxsPSJ3aGl0ZSIgdmlld0JveD0iMCAwIDI0IDI0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik05LjA2NCAzLjM0NGE0LjU3OCA0LjU3OCAwIDAxMi4yODUtLjMxMmMxIC4xMTUgMS44OTEuNTQgMi42NzMgMS4yNzUuMDEuMDEuMDI0LjAxNy4wMzcuMDIxYS4wOS4wOSAwIDAwLjA0MyAwIDQuNTUgNC41NSAwIDAxMy4wNDYuMjc1bC4wNDcuMDIyLjExNi4wNTdhNC41ODEgNC41ODEgMCAwMTIuMTg4IDIuMzk5Yy4yMDkuNTEuMzEzIDEuMDQxLjMxNSAxLjU5NWE0LjI0IDQuMjQgMCAwMS0uMTM0IDEuMjIzLjEyMy4xMjMgMCAwMC4wMy4xMTVjLjU5NC42MDcuOTg4IDEuMzMgMS4xODMgMi4xNy4yODkgMS40MjUtLjAwNyAyLjcxLS44ODcgMy44NTRsLS4xMzYuMTY2YTQuNTQ4IDQuNTQ4IDAgMDEtMi4yMDEgMS4zODguMTIzLjEyMyAwIDAwLS4wODEuMDc2Yy0uMTkxLjU1MS0uMzgzIDEuMDIzLS43NCAxLjQ5NC0uOSAxLjE4Ny0yLjIyMiAxLjg0Ni0zLjcxMSAxLjgzOC0xLjE4Ny0uMDA2LTIuMjM5LS40NC0zLjE1Ny0xLjMwMmEuMTA3LjEwNyAwIDAwLS4xMDUtLjAyNGMtLjM4OC4xMjUtLjc4LjE0My0xLjIwNC4xMzhhNC40NDEgNC40NDEgMCAwMS0xLjk0NS0uNDY2IDQuNTQ0IDQuNTQ0IDAgMDEtMS42MS0xLjMzNWMtLjE1Mi0uMjAyLS4zMDMtLjM5Mi0uNDE0LS42MTdhNS44MSA1LjgxIDAgMDEtLjM3LS45NjEgNC41ODIgNC41ODIgMCAwMS0uMDE0LTIuMjk4LjEyNC4xMjQgMCAwMC4wMDYtLjA1Ni4wODUuMDg1IDAgMDAtLjAyNy0uMDQ4IDQuNDY3IDQuNDY3IDAgMDEtMS4wMzQtMS42NTEgMy44OTYgMy44OTYgMCAwMS0uMjUxLTEuMTkyIDUuMTg5IDUuMTg5IDAgMDEuMTQxLTEuNmMuMzM3LTEuMTEyLjk4Mi0xLjk4NSAxLjkzMy0yLjYxOC4yMTItLjE0MS40MTMtLjI1MS42MDEtLjMzLjIxNS0uMDg5LjQzLS4xNjQuNjQ2LS4yMjdhLjA5OC4wOTggMCAwMC4wNjUtLjA2NiA0LjUxIDQuNTEgMCAwMS44MjktMS42MTUgNC41MzUgNC41MzUgMCAwMTEuODM3LTEuMzg4em0zLjQ4MiAxMC41NjVhLjYzNy42MzcgMCAwMDAgMS4yNzJoMy42MzZhLjYzNy42MzcgMCAxMDAtMS4yNzJoLTMuNjM2ek04LjQ2MiA5LjIzYS42MzcuNjM3IDAgMDAtMS4xMDYuNjMxbDEuMjcyIDIuMjI0LTEuMjY2IDIuMTM2YS42MzYuNjM2IDAgMTAxLjA5NS42NDlsMS40NTQtMi40NTVhLjYzNi42MzYgMCAwMC4wMDUtLjY0TDguNDYyIDkuMjN6Ii8+PC9zdmc+" /></a>
</p>

<p>
  <strong>Assets:</strong>
  <a href="#discovery-and-recommendations"><img alt="skills" src="https://img.shields.io/badge/skills-5B8DEF?logo=codecademy&logoColor=white" /></a>
  <a href="#discovery-and-recommendations"><img alt="agents" src="https://img.shields.io/badge/agents-7C3AED?logo=probot&logoColor=white" /></a>
  <a href="#discovery-and-recommendations"><img alt="instructions" src="https://img.shields.io/badge/instructions-0F766E?logo=markdown&logoColor=white" /></a>
  <a href="#discovery-and-recommendations"><img alt="workflows" src="https://img.shields.io/badge/workflows-F59E0B?logo=githubactions&logoColor=white" /></a>
  <a href="#discovery-and-recommendations"><img alt="prompt packs" src="https://img.shields.io/badge/prompt%20packs-DB2777?logo=huggingface&logoColor=white" /></a>
  <a href="#discovery-and-recommendations"><img alt="MCP servers" src="https://img.shields.io/badge/MCP%20servers-2563EB?logo=docker&logoColor=white" /></a>
  <a href="#discovery-and-recommendations"><img alt="plugins" src="https://img.shields.io/badge/plugins-16A34A?logo=gradle&logoColor=white" /></a>
  <a href="#discovery-and-recommendations"><img alt="hooks" src="https://img.shields.io/badge/hooks-DC2626?logo=zap&logoColor=white" /></a>
  <a href="#discovery-and-recommendations"><img alt="extensions" src="https://img.shields.io/badge/extensions-0891B2?logo=vscodium&logoColor=white" /></a>
  <a href="#discovery-and-recommendations"><img alt="reference packs" src="https://img.shields.io/badge/reference%20packs-64748B?logo=gitbook&logoColor=white" /></a>
</p>

**Discover anywhere. Install everywhere.**

`agent-harness` is a reviewable supply chain for reusable AI-agent assets: discover trusted sources, rank workspace-specific recommendations, mirror pinned bundles, stage local files, activate host views, and wire everything into the agent host you already use. ARD-compatible (v0.9) as both publisher and consumer.

**Proof points**

- **Published CLI:** [`@ar27111994/agent-harness` on npm](https://www.npmjs.com/package/@ar27111994/agent-harness), with release artifacts on [GitHub Releases](https://github.com/ar27111994/agent-harness/releases).
- **Quality-gated:** every release path is backed by the [quality workflow](https://github.com/ar27111994/agent-harness/actions/workflows/quality.yml).
- **Discoverable:** listed through [GitHub Explore topic visibility](https://github.com/github/explore/pull/5175) as topic metadata, not an endorsement.
- **Cross-host today:** VS Code/GitHub Copilot, OpenCode, Cursor, Zed, Claude Code, Pi, and OpenAI Codex.

**▶️ Watch the demo:**

<!-- GitHub's README sanitizer strips <video>/<iframe>, so the hero uses a committed, muted GIF from the demo-video repo and links to the full sound-on YouTube walkthrough. -->

[![agent-harness autoplay demo preview — click for sound-on walkthrough](https://raw.githubusercontent.com/ar27111994/agent-harness-demo-video/main/media/readme/agent-harness-readme-preview.gif)](https://youtu.be/u1OmcS97iOg)

**Sound-on walkthrough:** [youtu.be/u1OmcS97iOg](https://youtu.be/u1OmcS97iOg)

- **Video source:** [`agent-harness-demo-video`](https://github.com/ar27111994/agent-harness-demo-video), rendered with Remotion and kept outside this package so npm tarballs stay lean.
- **Terminal source:** [`docs/demo/workspace-opencode-demo.mjs`](https://github.com/ar27111994/agent-harness/blob/main/docs/demo/workspace-opencode-demo.mjs), which records the public-safe OpenCode quick-start transcript and generated-output tree.
- **Walkthrough notes:** [`docs/demo/v2-opencode-walkthrough.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/demo/v2-opencode-walkthrough.md), covering the full v2 before/after flow.

The core model is deliberately boring in the best way: one command surface, a host-adapter boundary, preview-first writes, and explicit native-install steps. The lifecycle stays consistent across hosts while each adapter owns the files, settings, apply/reset behavior, and safety boundaries required by that host.

## Table of contents

- [What this project does](#what-this-project-does)
- [Lifecycle model](#lifecycle-model)
- [Supported hosts](#supported-hosts)
- [Where it fits](#where-it-fits)
- [What it produces](#what-it-produces)
- [Quick start](#quick-start)
- [Usage examples](#usage-examples)
- [Key playbooks](#key-playbooks)
- [Command reference](#command-reference)
- [Host wire-in details](#host-wire-in-details)
- [Discovery and recommendations](#discovery-and-recommendations)
- [Environment variables](#environment-variables)
- [Generated and managed files](#generated-and-managed-files)
- [Repository structure](#repository-structure)
- [Development and validation](#development-and-validation)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Security and trust center](#security-and-trust-center)
- [Current boundaries](#current-boundaries)
- [Related documentation](#related-documentation)
- [Sponsor](#sponsor)
- [License](#license)

## Key Playbooks

- [Agent setup playbook](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/AGENT-SETUP-PLAYBOOK.md)
- [Discovery breadth playbook](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/DISCOVERY-BREADTH-PLAYBOOK.md)
- [Demand detection playbook](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/DEMAND-DETECTION-PLAYBOOK.md)
- [Demand detection coverage](https://github.com/ar27111994/agent-harness/blob/main/docs/reference/DEMAND-DETECTION-COVERAGE.md)
- [Source coverage playbook](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/SOURCE-COVERAGE-PLAYBOOK.md)
- [AI enrichment playbook](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/AI-ENRICHMENT-PLAYBOOK.md)
- [Asset update playbook](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/ASSET-UPDATE-PLAYBOOK.md)
- [Logging strategy](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/LOGGING-STRATEGY.md)
- [Troubleshooting guide](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/TROUBLESHOOTING.md)
- [Recommendation policy playbook](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/RECOMMENDATION-POLICY-PLAYBOOK.md)
- [Workspace evolution control-loop playbook](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/WORKSPACE-EVOLUTION-PLAYBOOK.md)
- [End-user harness maintenance guide](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/HARNESS-MAINTENANCE-GUIDE.md)
- [Security and trust center](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/TRUST-CENTER.md)
- [v2 safe defaults](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/SAFE-DEFAULTS.md)
- [v2 CLI and report contract](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/V2-CONTRACT.md)
- [v1 to v2 upgrade guide](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/V1-TO-V2-UPGRADE.md)
- [Scheduled maintenance workflow](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/MAINTENANCE-WORKFLOW.md)
- [Release process](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/RELEASE-PROCESS.md)

## What this project does

`agent-harness` automates the lifecycle of reusable agent assets:

1. Scans a target workspace to infer demand signals.
2. Loads configured and generated discovery sources.
3. Harvests candidate agent assets from local sources, source packs, documentation sources, package registries, and marketplace references.
4. Recomputes ranked recommendations from selected catalog entries.
5. Mirrors the bounded selected asset set into reproducible local artifacts.
6. Stages mirrored bundle assets into lifecycle-host package stores.
7. Executes explicit host-native install/verify/remove operations where an adapter supports them.
8. Activates ranked assets into host runtime views.
9. Wires the activated assets into a target workspace through a selected host adapter.

The goal is to make high-quality reusable agent context portable across tools without hardcoding one workstation, one operating system, or one AI host.

## Lifecycle model

The project intentionally separates these stages:

| Stage       | Purpose                                                                                                 | Typical output                                      |
| ----------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `discover`  | Build demand profiles, source indexes, catalogs, selections, and source-utilization reports.            | `discover/output/`, `discover/catalog.assets.jsonl` |
| `recommend` | Rank assets per recommendation host using policy, demand signals, trust, cost, diversity, and caps.     | `state/recommendations.json`                        |
| `mirror`    | Build mirror plans, bundle locks, raw artifact caches, quarantine data, and audit records.              | `mirror/`                                           |
| `stage`     | Stage mirrored bundle assets, reconcile generations, and explicitly run supported host-native installs. | `install/`, `state/install/`                        |
| `activate`  | Materialize active runtime views for lifecycle hosts from staged packages and recommendations.          | `activate/`                                         |
| `wire`      | Preview by default, or explicitly apply/reset host-specific workspace integration.                      | host-specific files plus wire plans                 |
| `workspace` | Run the end-to-end lifecycle for a selected host and then apply wire-in.                                | full pipeline output                                |

`stage` is the clearer mental model for this phase: the harness stages a bounded mirrored bundle subset into its managed lifecycle store. The CLI still accepts `install` as an alias because host-native install/verify/remove operations also live in that command group.

Two host concepts are important:

- **Lifecycle host**: the stage/activation package layout used to materialize assets.
- **Recommendation host**: the host-specific policy used for ranking and budgets.

Some adapters intentionally reuse another lifecycle host while keeping their own recommendation host. For example, Cursor reuses the Copilot-compatible lifecycle host but ranks through the `cursor` policy.

`wire <host>` is intentionally non-mutating unless you pass `--apply` or `--reset`; use the default preview mode to inspect target paths and planned writes before changing host files.

## Supported hosts

`agent-harness` currently registers seven host adapters in `src/host-adapters/registry.ts`.

| CLI target    | Aliases                     | Lifecycle host   | Recommendation host | Default bundles                                     | Wire style                                                             |
| ------------- | --------------------------- | ---------------- | ------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| `vscode`      | `copilot`                   | `copilot-vscode` | `copilot-vscode`    | `copilot-core`, `community-stable`, `shared-mcp`    | VS Code user settings plus workspace instructions                      |
| `opencode`    | `open-code`                 | `opencode`       | `opencode`          | `opencode-global`, `community-stable`, `shared-mcp` | project-local `.opencode` overlay and managed links                    |
| `cursor`      | -                           | `copilot-vscode` | `cursor`            | `copilot-core`, `community-stable`, `shared-mcp`    | project-local Cursor rules and managed assets                          |
| `zed`         | -                           | `opencode`       | `zed`               | `opencode-global`, `community-stable`, `shared-mcp` | project-local `.rules`, `.zed/settings.json`, and managed assets       |
| `claude-code` | `claude`, `claudecode`      | `opencode`       | `claude-code`       | `opencode-global`, `community-stable`, `shared-mcp` | project-local Claude context, rules, skills, and commands              |
| `pi`          | `pi-coding-agent`           | `opencode`       | `pi`                | `opencode-global`, `community-stable`               | project-local Pi agent/system context, skills, prompts, and settings   |
| `codex`       | `openai-codex`, `codex-app` | `opencode`       | `codex`             | `opencode-global`, `community-stable`, `shared-mcp` | project-local AGENTS.md, .agents skills/plugins, and .codex references |

Use `setup hosts` to print the registered adapters from the local build:

```bash
agent-harness setup hosts
```

## Where it fits

`agent-harness` is the supply-chain layer that decides what reusable agent assets enter a workspace and how they are staged, activated, reviewed, and wired. It does **not** run agents. It prepares inspectable inputs for the host or harness you already use.

| Tool or category               | What it does                                                                                                                                                                                                | Boundary                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Curated skill/plugin libraries | Help you find and install assets from one ecosystem or curated catalog.                                                                                                                                     | Usually focused on acquisition, not cross-host lifecycle state, pinned mirrors, quarantine, and resettable wire plans.          |
| MCP/server lists               | Help you discover servers and integration ideas.                                                                                                                                                            | Lists are references; they do not decide what enters a workspace, stage reproducible artifacts, or manage host-specific wiring. |
| Agent runtime harnesses        | Run agents, tasks, models, tools, and sessions.                                                                                                                                                             | `agent-harness` is not the runtime. It manages reusable assets before they enter one.                                           |
| **agent-harness**              | **Discovers sources, ranks recommendations, mirrors pinned bundles, stages/activates assets, quarantines risky inputs, and wires selected assets into supported hosts with preview/apply/reset semantics.** | **Supply-chain and workspace integration layer for reusable AI-agent assets.**                                                  |

The practical lifecycle is: `discover -> recommend -> mirror -> stage -> activate -> wire`. Official and verified sources are preferred over popularity-only signals, official-first-party sources are demoted when owner/publisher evidence fails verification, mirrored generations are pinned for review, risky candidates route through quarantine, and native/global host installs remain explicit instead of hidden inside `workspace <host>`.

## ARD interoperability

<p>
  <a href="https://agenticresourcediscovery.org/spec"><img alt="ARD v0.9" src="https://img.shields.io/badge/ARD-v0.9-6366F1?logo=data:image/svg%2Bxml;base64,PHN2ZyBmaWxsPSJ3aGl0ZSIgdmlld0JveD0iMCAwIDI0IDI0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik0xMiAyTDIgN3YxMGwxMCA1IDEwLTVWN0wxMiAyem0wIDIuMTY0bDcgMy41djcuNjcybC03IDMuNS03LTMuNVY3LjY2NGw3LTMuNXoiLz48L3N2Zz4=" /></a>
</p>

**Tagline:** _Discover anywhere. Install everywhere._

`agent-harness` is both an **ARD publisher** and an **ARD consumer**, implementing the [Agentic Resource Discovery](https://agenticresourcediscovery.org/spec) v0.9 specification (backed by Google, Microsoft, Hugging Face, GitHub, NVIDIA, and others).

### Publisher — `.well-known/ai-catalog.json`

Every `discover select` or `discover full` run builds a selected asset catalog. Export it as an ARD-compliant catalog so registries can discover agent-harness-curated assets:

```bash
agent-harness discover ard-export
# → .well-known/ai-catalog.json
```

ARD registries crawl `/.well-known/ai-catalog.json` at your domain to index agent-harness assets alongside assets from other publishers. The export maps every `AssetCatalogEntry` to an ARD entry with:

- **URN identifier** (`urn:ai:<publisher>:<namespace>:<name>`) — domain-backed identity
- **Media type** (`application/mcp-server+json`, `application/ai-skill`, etc.) from AssetKind
- **Trust manifest** — OMS signatures, publisher verification, compliance attestations
- **Representative queries** — synthetic natural-language queries for semantic discovery

### Consumer — ARD registry adapter

`agent-harness` can consume ARD-compliant registries as discovery sources via `POST /search`. The registry adapter maps ARD results back to `AssetCatalogEntry` for the full mirror/stage/activate/wire pipeline. See `discover sync` and the `ard-registry` source kind (#327).

### Architecture

```text
┌──────────────────────────────────────────────────────┐
│                    ARD Ecosystem                      │
│                                                       │
│  ┌──────────┐    ┌───────────┐    ┌───────────────┐  │
│  │ Catalogs │───▶│ Registries│───▶│ agent-harness │  │
│  │(publish) │    │ (search)  │    │  (consume)    │  │
│  └──────────┘    └───────────┘    └───────┬───────┘  │
│       ▲                                   │          │
│       │          ┌───────────┐            │          │
│       └──────────│agent-harness│◀─────────┘          │
│                  │ (publish)  │                        │
│                  └───────────┘                        │
│  Distribution (§3.6): mirror → stage → activate → wire │
└──────────────────────────────────────────────────────┘
```

ARD defines **discovery** (catalogs and registries). `agent-harness` handles the **distribution** phase that ARD §3.6 explicitly delegates to backend implementation — mirroring, staging, activation, and host-specific wiring.

**See:** [#325](https://github.com/ar27111994/agent-harness/issues/325) (catalog export), [#327](https://github.com/ar27111994/agent-harness/issues/327) (registry consumer), [#328](https://github.com/ar27111994/agent-harness/issues/328) (trust signals), [#326](https://github.com/ar27111994/agent-harness/issues/326) (community submission).

## What it produces

When you run the installed CLI from a workspace, mutable lifecycle state is written under `.agent-harness/` by default. Repository-local development keeps the same layout at the repository root so npm scripts and checked-in policy assets continue to work.

| Phase                       | Inspectable outputs                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demand detection            | `.agent-harness/discover/output/demand-profile.json`, `.agent-harness/discover/output/unknown-signals.json`                                                                                                                                                                                                                                         |
| Source selection            | `.agent-harness/discover/output/source-index.json`, `.agent-harness/discover/output/selection-report.json`, `.agent-harness/discover/output/source-utilization.json`, `.agent-harness/discover/output/source-health.json`, `.agent-harness/discover/output/source-drift.json`, `.agent-harness/discover/output/catalog-maintenance-candidates.json` |
| Catalog and recommendations | `.agent-harness/discover/catalog.assets.jsonl`, `.agent-harness/discover/output/asset-fingerprints.json`, `.agent-harness/state/recommendations.json`                                                                                                                                                                                               |
| Mirror locks and quarantine | `.agent-harness/mirror/bundles/*.lock.json`, `.agent-harness/mirror/quarantine/**`, `.agent-harness/mirror/audit/**`                                                                                                                                                                                                                                |
| Staged generations          | `.agent-harness/install/generations/<host>/current.json`, `.agent-harness/install/<host>/packages/*/install-manifest.json`                                                                                                                                                                                                                          |
| Activation                  | `.agent-harness/activate/<host>/activation-manifest.json`, `.agent-harness/activate/<host>/<host>-overlay-plan.json` when the adapter emits an overlay plan                                                                                                                                                                                         |
| Wire preview/apply          | `.agent-harness/activate/<host>/wire-preview-<host>.json`, `.agent-harness/activate/<host>/wire-plan.json`, plus host-specific managed files such as `.opencode/...`, `.cursor/...`, `.zed/settings.json`, `.claude/...`, `.pi/...`, `.agents/...`, `.codex/...`, `AGENTS.md`, or `.github/copilot-instructions.md`                                 |

Preview mode writes reviewable wire plans without touching host files. Apply mode writes only the selected adapter's managed project files/settings, while native/global host installs remain explicit `install native` operations where supported. See [Host wire-in details](#host-wire-in-details) for the per-host paths and reset behavior.

## Quick start

### Try it in one command

```bash
npm install -g @ar27111994/agent-harness
agent-harness workspace opencode --intent general
```

Run the command from the workspace you want to inspect. By default, the installed CLI writes lifecycle state under `.agent-harness/`, applies only the selected adapter's managed project-local wire-in, and leaves native/global host installs, MCP authentication, marketplace extensions, and executable integrations as explicit follow-up operations. Review [What it produces](#what-it-produces) for the generated files and [Host wire-in details](#host-wire-in-details) for the exact OpenCode boundaries.

### Requirements

- Node.js `>=22`
- npm
- Git
- Optional GitHub token for higher GitHub API throughput:
  - `GITHUB_PERSONAL_ACCESS_TOKEN`
  - or `GITHUB_TOKEN`

### Install the CLI package

```bash
npm install -g @ar27111994/agent-harness
```

For local development from this repository, install dependencies instead:

```bash
npm install
```

### Build

```bash
npm run build
```

### Optional local environment

Runtime configuration is centralized in `src/config/runtime.ts`. `.env.example` documents supported variables. The CLI automatically loads a `.env` file from the current working directory before dispatching commands, without overriding variables that are already exported by your shell. Use `--no-dotenv` for hermetic CI/smoke runs.

```bash
cp .env.example .env
```

Use `.env` for local machine values such as GitHub tokens, batch sizes, scan budgets, and optional state-root overrides. Keep real secrets out of git.

### Inspect host readiness

```bash
agent-harness setup hosts
agent-harness setup doctor
agent-harness setup doctor --host vscode
agent-harness setup doctor --host opencode
agent-harness setup doctor --host cursor
agent-harness setup doctor --host zed
agent-harness setup doctor --host claude-code
agent-harness setup doctor --host pi
agent-harness setup doctor --host codex
```

`setup doctor` prints each adapter's lifecycle host, recommendation host, default bundles, runtime executable, advertised capabilities, lifecycle preflight diagnostics, adapter-specific CLI readiness diagnostics, and activated asset prerequisite guidance. Missing optional host CLIs are reported as warnings unless the selected operation requires a writable host-native path or native installer runtime.

### Run a full workspace pipeline

From the target workspace directory, run one of:

```bash
agent-harness workspace vscode --intent frontend
agent-harness workspace opencode --intent devops
agent-harness workspace cursor --intent frontend
agent-harness workspace cursor --intent frontend --ai-enrich
agent-harness workspace zed --intent design
agent-harness workspace claude-code --intent research
agent-harness workspace pi --intent product
agent-harness workspace codex --intent research
```

From this repository, equivalent npm scripts are available:

```bash
npm run workspace:vscode -- --intent frontend
npm run workspace:opencode -- --intent devops
npm run workspace:cursor -- --intent frontend
npm run workspace:zed -- --intent design
npm run workspace:claude-code -- --intent research
npm run workspace:pi -- --intent product
npm run workspace:codex -- --intent research
```

Use the adapter-driven `agent-harness workspace <host>` command for end-to-end host setup. For a new user, this is the straightforward default path: it runs the broad discovery/recommendation pipeline, stages and activates assets, and then performs the selected host's final wire-in.

**After the first wire-in:** copy the [end-user harness maintenance guide](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/HARNESS-MAINTENANCE-GUIDE.md) to your AI coding agent and run the weekly safe-refresh loop from there. Add `--ai-enrich` when you want the bounded enrichment sidecar as part of the same run, or configure `AGENT_HARNESS_AI_ENRICHMENT_MODE` for conservative automatic behavior.

Supported canonical intents are `general`, `frontend`, `backend`, `mobile`, `devops`, `security`, `docs`, `testing`, `research`, `data`, `design`, `product`, and `marketing`. Common aliases are normalized automatically, for example `documentation` → `docs`, `ci-cd` / `infra` → `devops`, `branding` → `design`, and `ba` / `planning` / `product-research` → `product`. `--intent` accepts repeated values for additive multi-intent runs, for example `--intent frontend --intent docs`. The first provided intent remains the primary intent for backward-compatible activation/manifests. If you want to compare isolated task shapes instead of combining them, rerun the command once per intent.

### Mutable state root

A packaged CLI keeps checked-in discovery and mirror policy assets read-only and writes mutable lifecycle state elsewhere:

- When you run from this repository root, the development default remains the repository root so existing npm scripts continue to work.
- When you run the installed package from another workspace, the default mutable state root is `.agent-harness/` in that workspace.
- Override the state location with `--state-root <path>` or `AGENT_HARNESS_STATE_ROOT`.

Examples:

```bash
agent-harness --state-root .agent-harness workspace cursor --intent frontend
AGENT_HARNESS_STATE_ROOT=.agent-harness agent-harness wire zed --preview
```

## Usage examples

### Preview before touching a workspace

Use `wire` or `wire --preview` when you want to inspect planned host targets without mutating workspace files:

```bash
agent-harness wire cursor
agent-harness wire zed --preview
agent-harness wire claude-code --preview
```

Preview output is written under `activate/<host>/` and can be reviewed before `--apply`. Omitting a mode flag is equivalent to `--preview`.

### Use an AI agent as a dry-run setup operator

When you want another agent to operate `agent-harness` for you, start with a dry run before any apply/install step. This keeps workspace mutation, extension installation, and MCP/tool authentication separate from discovery and recommendation review.

For the full playbook, reusable prompts, classification rules, and decision tree, see [`AGENT-SETUP-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/AGENT-SETUP-PLAYBOOK.md).

Available playbooks:

- [`AGENT-SETUP-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/AGENT-SETUP-PLAYBOOK.md) - dry-run setup workflow, decision tree, and reusable agent prompts for workspace/host asset setup

- [`DISCOVERY-BREADTH-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/DISCOVERY-BREADTH-PLAYBOOK.md) - maximize the practical candidate pool before judging recommendation quality

- [`DEMAND-DETECTION-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/DEMAND-DETECTION-PLAYBOOK.md) - debug false negatives, false positives, and weak evidence in `discover/output/demand-profile.json`

- [`DEMAND-DETECTION-COVERAGE.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/reference/DEMAND-DETECTION-COVERAGE.md) - audited project-type matrix for stack/vertical detection coverage

- [`SOURCE-COVERAGE-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/SOURCE-COVERAGE-PLAYBOOK.md) - widen discovery sources cleanly when the workspace is understood but the source universe is too narrow

- [`AI-ENRICHMENT-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/AI-ENRICHMENT-PLAYBOOK.md) - choose enrichment modes, bounded AI review, and operator workflows

- [`ASSET-UPDATE-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/ASSET-UPDATE-PLAYBOOK.md) - refresh staged assets safely with report-only, due-only, and apply-safe flows

- [`RECOMMENDATION-POLICY-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/RECOMMENDATION-POLICY-PLAYBOOK.md) - inspect and tune ranking only after recall looks healthy

Short version:

- new user default: run `agent-harness workspace <host>` for the full end-to-end host flow
- run `agent-harness setup doctor --host <host>` first when you want a dry-run/operator-guided setup review
- use `agent-harness discover breadth` first when your main question is candidate-pool breadth rather than end-to-end setup
- run `agent-harness wire <host> --preview` only when lifecycle outputs already exist and you want to inspect/apply host-specific wire behavior
- separate staged/wired assets from native installs and manual runtime follow-up
- only run mutating install/apply commands after the dry run looks correct

If your main question is "how do I give recommendations the widest sensible candidate pool first?", use [`DISCOVERY-BREADTH-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/DISCOVERY-BREADTH-PLAYBOOK.md) before changing recommendation policy. If breadth looks wrong because stack detection is weak, continue with [`DEMAND-DETECTION-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/DEMAND-DETECTION-PLAYBOOK.md); if the stack looks right but the discovery universe is still too small, continue with [`SOURCE-COVERAGE-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/SOURCE-COVERAGE-PLAYBOOK.md).

### Default workspace diagnostic ladder

When `agent-harness workspace <host>` gives surprising output, diagnose in this order instead of jumping straight to bigger limits or host-policy edits:

1. **Did the workspace command complete?** If not, inspect preflight/runtime/install/wire logs and host readiness with `agent-harness setup doctor --host <host>`.
2. **Is `discover/output/demand-profile.json` wrong or weak?** If yes, use [`DEMAND-DETECTION-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/DEMAND-DETECTION-PLAYBOOK.md) and the matrix in [`DEMAND-DETECTION-COVERAGE.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/reference/DEMAND-DETECTION-COVERAGE.md).
3. **Is source utilization or selected-candidate breadth starved?** Inspect `discover/output/source-index.json`, `discover/output/source-utilization.json`, and `discover/output/selection-report.json`, then use [`SOURCE-COVERAGE-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/SOURCE-COVERAGE-PLAYBOOK.md) / [`DISCOVERY-BREADTH-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/DISCOVERY-BREADTH-PLAYBOOK.md).
4. **Are relevant assets selected but buried?** Inspect `state/recommendations.json`, `recommend policy:print --host <host>`, and `recommend explain --host <host> --asset <asset-id>`, then use [`RECOMMENDATION-POLICY-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/RECOMMENDATION-POLICY-PLAYBOOK.md).
5. **Is the problem host-specific?** Validate the host policy with recommendation fixtures before changing defaults.
6. **Is narrative judgment needed after deterministic output is sane?** Use bounded AI review/enrichment as an audit layer, not as a replacement for detection/source/ranking fixes.

Every detection, source, or policy change should cite fixture output, explain output, a selected-catalog miss, a source-utilization miss, or a demand-profile false negative/positive. Avoid changes based only on vibes.

### Apply and reset one host

```bash
agent-harness wire cursor --apply
agent-harness wire cursor --reset
```

Use this when activation outputs already exist and you only want to test the host adapter behavior.

### Run the full pipeline for a documentation-heavy repo

```bash
agent-harness workspace zed --intent docs
```

This scans the current workspace, ranks assets with the `zed` recommendation policy, activates the OpenCode-compatible lifecycle view, and writes Zed project-local files.

### Run the full pipeline for a frontend repo in Cursor

```bash
agent-harness workspace cursor --intent frontend
agent-harness workspace cursor --intent frontend --ai-enrich
```

Cursor reuses the Copilot-compatible lifecycle host but applies Cursor-specific recommendation policy, project-local `.cursor` rules, prompt-pack command coverage, MCP references, and managed Cursor plugin-compatible assets. Adding `--ai-enrich` writes the bounded enrichment sidecar after the deterministic workspace flow completes.

### Inspect why an asset was recommended

```bash
agent-harness recommend explain --host claude-code --asset <asset-id>
```

Use this to inspect scoring reasons, matched demand signals, coverage tags, and score breakdowns.

### Run bounded AI review for a host

```bash
agent-harness recommend ai-review --host vscode --apply
```

This writes bounded AI-review input/output artifacts under `recommend/output/` and, with `--apply`, folds validated suppressions and reranks back into the recommendation report.

### Print the effective policy for one host

```bash
agent-harness recommend policy:print --host pi
```

This is useful when tuning host policy overrides or investigating why a host selected different assets than another host.

### Rebuild from repository state

```bash
npm run rebuild:full
npm run recommend:report
npm run activate:host
```

Use this sequence after changing source definitions, recommendation policy, mirror bundles, or install behavior.

## Command reference

### Command style convention

- Use `agent-harness ...` for installed package usage and copy-pasteable user commands.
- Use `npm run ...` for repository-development shortcuts after `npm install`.
- Use `node ./dist/cli.js ...` only when intentionally testing the built local entrypoint from this repository.

### Managed wire-in vs native/global install

`workspace <host>` applies the complete managed lifecycle and final host wire-in. It stages and activates selected harness assets, then writes the host-specific project/user files owned by the adapter.

It does not silently perform separate native or global installation steps. Marketplace extension installs, MCP authentication, global host package/plugin registration, executable hook/tool setup, and host logins remain explicit or manual unless an asset provides structured host-native config for a documented surface. Use `agent-harness install native --host <host> --operation <plan|verify|install|remove>` for supported native extension flows.

### Build and validation

```bash
npm run build
npm run typecheck
npm run lint
npm run format
npm run format:check
npm run validate
npm test
npm run smoke:cli
npm run benchmark:scan
npm run quality:detection
npm run quality:policy
npm run validate:recommendations
```

### Discover

```bash
npm run discover:demand
npm run discover:sources
agent-harness discover sync
npm run discover:catalog
npm run discover:select
npm run discover:full
agent-harness discover breadth
npm run discover:stats
npm run discover:enrich
```

Equivalent direct CLI examples:

```bash
agent-harness discover demand-profile
agent-harness discover sources
agent-harness discover sync
agent-harness discover catalog
agent-harness discover select --ai-enrich
agent-harness discover full --ai-enrich
agent-harness discover breadth
agent-harness discover recall
agent-harness discover candidate-pool
agent-harness discover stats
agent-harness discover enrich --force
```

`discover sync` now provides persistent indexed harvesting for the built-in marketplace and registry sources that expose trustworthy official feeds, sitemaps, or paginated APIs. That includes the VS Code and Cursor marketplaces, Zed and Pi package galleries, skills.sh, ClawHub's server-rendered plugin catalog, the official MCP registry, and the supported package registries (npm change feed, PyPI, crates.io, Go index, Maven Central, NuGet, RubyGems, Packagist, and Swift Package Index).

Coverage modes remain explicit instead of silently pretending everything is equivalent:

- **direct**: single-pass sources harvested during catalog generation (for example docs and local sources)
- **rotating**: batch-rotated remote repo sources
- **indexed**: sources with persistent resumable sync support
- **sampled**: an honesty label kept only for sources that still lack a trustworthy exhaustive upstream surface in the current implementation

In the checked-in built-in source registry, the goal is for `sampled` to disappear over time; after the indexed-source expansion it should only show up for newly added or still-unsupported custom sources, not for the main built-in registry families.

The discovery configuration is assembled from multiple checked-in inputs on purpose:

- `discover/sources.json` = first-class source definitions
- `discover/source-packs/*.json` = repo-source expansions merged into the registry
- `discover/official-skills-indexes.json` + `discover/official-upstreams.json` = official index seeds and owner allowlists used during catalog harvest

`discover sources` now records those assembled configuration inputs in `discover/output/source-index.json` so the effective discovery universe is inspectable instead of implicit.

If you want the widest practical candidate pool before judging recommendation quality, start with `agent-harness discover breadth`. That first-class command runs the full breadth-oriented discovery pass and prints whether the bottleneck currently looks like demand detection, source coverage, selection filtering, or ranking. For the step-by-step workflow and agent-operated version, use [`DISCOVERY-BREADTH-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/DISCOVERY-BREADTH-PLAYBOOK.md).

Every command group accepts `--help` or `-h` and exits before preparing lifecycle state. Examples:

```bash
agent-harness discover --help
agent-harness wire vscode --help
agent-harness recommend explain --help
```

### Detection breadth and vendor signatures

Demand detection is deterministic by default. It does not require an external AI/ML service or API key for normal operation. The scanner combines:

- file-family detector signatures for docs, notebooks, datasets, BI dashboards, finance/trading, media/design, audio/music/video/VFX, CAD/hardware, embedded/firmware, games, mobile, robotics/simulation, DevOps/platform, security/networking, blockchain/smart contracts, business analysis, 3D printing/slicer profiles, marketing/content/CMS/SEO, and research artifacts;
- ecosystem dependency signatures for npm, PyPI, Dart `pubspec.yaml`, Cargo, Go modules, Maven/Gradle, NuGet, RubyGems, Packagist, SwiftPM, CocoaPods, and related native mobile manifests;
- vendor/platform signatures for common third-party stacks such as Node, React, Flutter/Dart, Swift, Objective-C, Kotlin, Java Android, C#/.NET MAUI/Xamarin, Java/.NET/Go/Rust/Ruby/PHP backends, Azure, AWS, GCP, Firebase, Supabase, Apify, MCP, AI/ML/DL/RL/MLOps/RAG/vector-search libraries, robotics/simulation, blockchain/security, DevOps/Kubernetes/Helm/Ansible/Pulumi, network automation, finance/trading, BI/reporting, CAD/embedded/3D printing, creative media, and marketing/SEO/content packages;
- generic language, package-manager, infrastructure, and API markers.

These signatures live under `src/domains/discovery/` alongside focused demand-profile, source-registry, source-index, source-utilization, catalog-selection, package/reference/local/GitHub/official-index harvester, and catalog utility modules. Support for additional domains or vendors can be added as data-driven detector entries or focused harvester modules instead of one-off project-specific logic. Optional AI-assisted enrichment is available through `discover enrich`, but v1.0.0 intentionally keeps normal discovery reproducible and offline-capable by default.

### AI-assisted enrichment

AI-assisted enrichment is optional and disabled by default. When configured, it writes a bounded request artifact to `discover/output/ai-enrichment-input.json` and an outcome artifact to `discover/output/ai-enrichment.json` using an OpenAI-compatible chat-completions endpoint. Loopback, private-network, and non-public origins are still rejected before any API key is sent. By default the runtime allows a built-in set of public provider origins, automatically allows the configured endpoint origin when it is valid `https`, and can be extended with `AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS` for compatible gateways or proxies.

The same guarded endpoint configuration is also reused by `recommend ai-review` and `recommend report --ai-review`. Enrichment remains a sidecar summary; AI review is the bounded stage that can actually suppress or rerank recommendation entries after the deterministic report is built.

Supported enrichment modes are:

- `manual` (default): only run `discover enrich` or explicit `--ai-enrich` wrapper flags
- `after-select`: automatically evaluate enrichment after selection completes
- `after-workspace`: automatically evaluate enrichment after a workspace flow finishes
- `on-ambiguity`: automatically run only when deterministic selection looks uncertain
- `on-input-change`: automatically run only when the bounded enrichment input changed
- `ci-only`: automatically evaluate enrichment only in CI/headless contexts
- `off`: disable automatic enrichment entirely

When enrichment runs, the outcome artifact uses explicit statuses such as `disabled`, `skipped`, `completed`, `reused`, and `failed`. Unchanged successful inputs reuse cached results unless you pass `--force`, and CI/headless flows can opt into fail-open or require-enrichment behavior.

```bash
AGENT_HARNESS_AI_ENRICHMENT_URL=https://api.openai.com/v1/chat/completions
AGENT_HARNESS_AI_ENRICHMENT_API_KEY=<token>
AGENT_HARNESS_AI_ENRICHMENT_MODE=manual
AGENT_HARNESS_AI_ENRICHMENT_MODEL=gpt-4o-mini
# Optional comma-separated extra allowlist entries for compatible public gateways.
AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS=https://gateway.example.com
agent-harness discover enrich
agent-harness discover full --ai-enrich
agent-harness workspace cursor --intent frontend --ai-enrich
```

Use `setup login --provider ai` for configuration guidance. For scenario-based operator guidance, see [`AI-ENRICHMENT-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/AI-ENRICHMENT-PLAYBOOK.md).

### Recommend

```bash
npm run recommend:report
agent-harness recommend
agent-harness recommend report --ai-review
agent-harness recommend ai-review --apply
npm run recommend:evaluate
npm run recommend:update
```

Omitting the recommendation subcommand defaults to `report`.
`recommend evaluate` now ends with an aggregate summary so you can spot whether a fixture suite is being carried by exact-stack wins, weak-only generic matches, or broad fallback behavior.

`recommend ai-review` writes `recommend/output/ai-review-input.json` and `recommend/output/ai-review.json`. Use `--host <host>` to review a single host shortlist and `--apply` to write validated reranks/suppressions back into `recommend/output/report.json`. `recommend report --ai-review` is the one-shot version that rebuilds the deterministic report first and then applies the same bounded AI review stage.

Explain a specific recommendation:

```bash
agent-harness recommend explain --host vscode --asset <asset-id>
```

Print the merged effective policy for a host:

```bash
agent-harness recommend policy:print --host shared
```

If the selected candidate pool already looks healthy but the final ranking still feels wrong, use [`RECOMMENDATION-POLICY-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/RECOMMENDATION-POLICY-PLAYBOOK.md). For recurring post-wire-in repository drift, use [`WORKSPACE-EVOLUTION-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/WORKSPACE-EVOLUTION-PLAYBOOK.md).

### Mirror

```bash
npm run mirror:plan
npm run mirror:locks
npm run mirror:acquire
agent-harness mirror diff
agent-harness mirror explain --asset <asset-id>
```

### Quarantine review

```bash
agent-harness quarantine list
agent-harness quarantine inspect --asset <asset-id>
agent-harness quarantine report
agent-harness quarantine approve --asset <asset-id> --reason "reviewed source and content"
agent-harness quarantine reject --asset <asset-id> --reason "unsafe prompt or executable behavior"
agent-harness quarantine pin --asset <asset-id> --reason "await ownership proof"
```

Mirror acquisition routes high-risk or prompt-injection-like community assets into quarantine. Install and activation skip quarantined assets until an explicit review approves them as `approved-with-warning`. `quarantine report` writes `state/quarantine/quarantine-state.json` with current state, reason, first seen, last reviewed, suggested action, and transition evidence. See [`QUARANTINE-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/QUARANTINE-PLAYBOOK.md) for review flow.

### Stage / install

```bash
npm run install:bundle
agent-harness install native --host vscode
agent-harness install native --host vscode --operation verify
agent-harness install native --host vscode --operation install --apply
agent-harness install native --host vscode --operation remove --apply
agent-harness install native --host cursor
agent-harness install native --host cursor --operation verify
agent-harness stage refresh --host copilot-vscode
agent-harness stage refresh --host copilot-vscode --apply
agent-harness stage refresh --host copilot-vscode --due-only
npm run install:reconcile
npm run install:reset
```

`stage` is the preferred lifecycle term here: the harness stages a bounded mirrored bundle subset into its managed store, while `install native` remains the explicit host-facing install boundary. Mutating install/remove operations require `--apply`; verify is non-mutating. VS Code and Cursor extension assets are installed through adapter-owned VS Code-style extension providers and results are written to `state/install/native-extensions.json`.

`stage refresh` writes `state/install/refresh-report.json`, persists schedule/checkpoint metadata in `state/install/refresh-state.json`, compares the installed upstream fingerprint stamped into each install manifest against the latest bundle-lock mirror, and can apply safe staged refreshes when `AGENT_HARNESS_INSTALL_REFRESH_POLICY=apply-safe` and `--apply` are both used. `--due-only` makes the command suitable for cron/background checks by skipping runs until the configured refresh interval is due. Refresh reports include policy tiers for report-only, stage-only, low-risk apply, review-required, and quarantined decisions; executable/native assets can be staged, but host-native activation/install remains review-gated. `install refresh` remains a supported alias.

For report-only vs due-only vs apply-safe update workflows, see [`ASSET-UPDATE-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/ASSET-UPDATE-PLAYBOOK.md).

### Activate

```bash
npm run activate:host
npm run activate:reset
agent-harness activate rollback --host opencode --generation <generation-id>
```

You can bias recommendation ranking and activation ordering with a validated `--intent`:

```bash
agent-harness activate host --intent frontend
agent-harness activate host --intent devops
agent-harness activate host --intent design
agent-harness activate host --intent product
```

You can also activate one lifecycle host using another recommendation policy:

```bash
agent-harness activate host --host copilot-vscode --recommendation-host cursor
```

`--recommendation-host` is validated against the supported host set. `--intent` is also validated (`general | frontend | backend | mobile | devops | security | docs | testing | research | data | design | product | marketing`), accepts common aliases such as `documentation`, `ci-cd`, `branding`, and `ba`, and can be passed repeatedly. Activation uses the first provided intent as its primary activation context so downstream views stay deterministic even when recommendation/workspace flows were built from multiple intents.

### Wire

Preview, apply, or reset any adapter:

```bash
agent-harness wire vscode --preview
agent-harness wire vscode --apply
agent-harness wire vscode --reset

agent-harness wire opencode --preview
agent-harness wire opencode --apply
agent-harness wire opencode --reset

agent-harness wire cursor --preview
agent-harness wire cursor --apply
agent-harness wire cursor --reset

agent-harness wire zed --preview
agent-harness wire zed --apply
agent-harness wire zed --reset

agent-harness wire claude-code --preview
agent-harness wire claude-code --apply
agent-harness wire claude-code --reset

agent-harness wire pi --preview
agent-harness wire pi --apply
agent-harness wire pi --reset

agent-harness wire codex --preview
agent-harness wire codex --apply
agent-harness wire codex --reset
```

Repository scripts apply the corresponding wire-in:

```bash
npm run wire:vscode
npm run wire:opencode
npm run wire:cursor
npm run wire:zed
npm run wire:claude-code
npm run wire:pi
npm run wire:codex
```

### Workspace

Workspace commands run discover, recommend, mirror, stage, activate, and wire-in for the selected adapter:

```bash
agent-harness workspace vscode --intent frontend
agent-harness workspace opencode --intent devops
agent-harness workspace cursor --intent frontend
agent-harness workspace cursor --intent frontend --ai-enrich
agent-harness workspace zed --intent design
agent-harness workspace claude-code --intent research
agent-harness workspace pi --intent product
agent-harness workspace codex --intent research
```

`workspace <host>` also accepts `--no-ai-enrich`, `--force`, and `--require-ai-enrich` for explicit control of the bounded enrichment sidecar.

### Setup

```bash
npm run setup:hosts
npm run setup:doctor
npm run setup:login -- --provider github
npm run setup:login -- --provider npm
npm run setup:login -- --provider ai
```

### Rebuild / operations

```bash
npm run rebuild:clean
npm run rebuild:full
```

`rebuild:full` runs the clean, discovery, recommendation, mirror, stage/reconcile, and activation flow from repository state.

## Host wire-in details

All host-specific behavior lives behind `src/host-adapters/`. Generic orchestration lives in `src/workspace.ts`, `src/wire.ts`, `src/pipeline.ts`, `src/install.ts`, `src/activate.ts`, and related lifecycle modules.

For the checked-in host-surface classification backing the current README wording, see [`HOST-SURFACE-AUDIT.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/reference/HOST-SURFACE-AUDIT.md).

Unless noted otherwise, lifecycle file paths shown in this section are relative to the configured state root. In repository-local development that is the repository root; in packaged CLI usage the default state root is workspace-local `.agent-harness/`.

Preview, apply, and reset semantics are consistent across adapters:

- **Preview** writes a wire preview manifest without applying workspace mutations.
- **Apply** writes host-specific project files/settings and an effective wire plan.
- **Reset** removes managed outputs created by the adapter.

Most adapter previews use `activate/<host>/wire-preview-<host>.json`. VS Code uses its lifecycle root: `activate/copilot-vscode/wire-preview-vscode.json`.

### v2 host support matrix

This matrix is the public v2 adapter contract. It separates generic lifecycle support from host-native support so unsupported/partial capabilities are intentionally named instead of implied as complete. Every host participates in discover/recommend/stage/activate and quarantine-aware review gating; native install/verify/remove stays explicit and only appears where an adapter exposes a native install provider.

| Host             | Lifecycle / recommendation          | Discover-aware signals | Stage / install                           | Activate | Wire preview / apply / reset | Native install / verify / remove | Project-local native wiring                                                                                                        | Known limitations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ----------------------------------- | ---------------------- | ----------------------------------------- | -------- | ---------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `copilot-vscode` | `copilot-vscode` / `copilot-vscode` | Yes                    | Stage + explicit extension native install | Yes      | Yes / yes / yes              | `extension` via VS Code CLI      | Workspace instructions plus user-scoped settings                                                                                   | Requires a writable VS Code user settings directory for apply/reset. Marketplace extension install/verify/remove is explicit and never part of wire apply. Claude Code plugin format (.claude-plugin/plugin.json) is partially compatible — the schema is shared with VS Code agent plugins but manifest path conventions differ. Agent assets shipping both plugin.json layouts are compatible with copilot-vscode.                                                                                                                           |
| `opencode`       | `opencode` / `opencode`             | Yes                    | Stage only                                | Yes      | Yes / yes / yes              | none                             | Project-local `.opencode` overlay and `AGENTS.md`                                                                                  | Uses project-local overlays and does not mutate global OpenCode packages or global MCP settings. MCP and tool config synthesis requires explicit structured native payloads.                                                                                                                                                                                                                                                                                                                                                                   |
| `cursor`         | `copilot-vscode` / `cursor`         | Yes                    | Stage + explicit extension native install | Yes      | Yes / yes / yes              | `extension` via Cursor CLI       | Project-local `.cursor` rules, agents, plugin-compatible tree, and structured native config when supplied                          | Reuses the Copilot lifecycle store while applying Cursor-specific project files. Cursor extension install/verify/remove requires the Cursor CLI and explicit native-install operations. Project plugin registration remains user/host managed. VS Code Marketplace extensions are partially compatible with Cursor — extensions that use standard VS Code APIs work, but those relying on VS Code-specific runtime features (e.g. debugger, notebook APIs) may not. Discovery from the vscode-marketplace source applies to cursor workspaces. |
| `zed`            | `opencode` / `zed`                  | Yes                    | Stage only                                | Yes      | Yes / yes / yes              | none                             | Project-local `.rules`, `.zed/settings.json`, and `.zed/agent-harness` references                                                  | Extension installation remains manual through Zed unless future structured native support is added. Managed .zed/agent-harness assets are references, not a claim that every asset kind is a native Zed directory. Zed forwards MCP servers configured in .zed/settings.json to external ACP-based agents in the same session — MCP server recommendations for Zed workspaces are also relevant to ACP agent consumers. ACP-compatible agents (via JetBrains Agent Client Protocol) can be used in Zed when ACP forwarding is configured.      |
| `claude-code`    | `opencode` / `claude-code`          | Yes                    | Stage only                                | Yes      | Yes / yes / yes              | none                             | Project-local `CLAUDE.md`, `.claude/*`, and structured native config when supplied                                                 | MCP, hook, and settings synthesis requires explicit structured Claude-native payloads. Global Claude Code profile/configuration is not modified.                                                                                                                                                                                                                                                                                                                                                                                               |
| `pi`             | `opencode` / `pi`                   | Yes                    | Stage only                                | Yes      | Yes / yes / yes              | none                             | Project-local `AGENTS.md`, `SYSTEM.md`, `.pi/skills`, `.pi/prompts`, and structured native config when supplied                    | Pi does not include shared-mcp in its default bundles. MCP assets are staged as references because Pi has no built-in MCP support in the current adapter contract.                                                                                                                                                                                                                                                                                                                                                                             |
| `codex`          | `opencode` / `codex`                | Yes                    | Stage only                                | Yes      | Yes / yes / yes              | none                             | Project-local `AGENTS.md`, `.agents/skills`, `.agents/plugins`, `.codex/agent-harness`, and structured native config when supplied | Global Codex config, plugin caches, automations, remote connections, and sandbox settings are not modified. Plugin, MCP, hook, and rules activation requires structured Codex-native config and trusted-project review.                                                                                                                                                                                                                                                                                                                        |

Adapter compliance coverage lives in `src/tests/host-adapters.test.ts`, `src/tests/native-host-wire.test.ts`, and `src/tests/host-support-matrix.test.ts`. The tests assert the registered adapter metadata, preview/apply/reset behavior, native-install boundaries, reversible managed file handling, and the README matrix rows.

### VS Code / GitHub Copilot

Adapter implementation:

- `src/host-adapters/vscode.ts`
- `src/host-adapters/vscode-settings.ts`

This adapter is intentionally host-specific because VS Code and GitHub Copilot use protected user-scoped settings plus workspace-local instruction files.

Current official docs:

- <https://code.visualstudio.com/docs/copilot/customization/overview>
- <https://code.visualstudio.com/docs/copilot/customization/custom-instructions>
- <https://code.visualstudio.com/docs/copilot/customization/agent-skills>
- <https://code.visualstudio.com/docs/copilot/customization/agent-plugins>
- <https://code.visualstudio.com/docs/copilot/customization/mcp-servers>

Supported behavior:

- patches user-scoped VS Code JSONC settings
- writes workspace-local `.github/copilot-instructions.md`
- materializes curated runtime folders under `~/.copilot/agent-harness/`
- writes extension metadata for valid VS Code extension identifiers
- emits native install action guidance for extension assets when possible
- supports explicit extension install, verify, and remove via `install native --host vscode`
- projects shared MCP references into the effective wire plan
- resets managed settings entries and generated files without wiping unrelated user settings

Settings that can be patched:

- `chat.pluginLocations`
- `chat.agentSkillsLocations`
- `chat.hookFilesLocations`
- `chat.agentFilesLocations`
- `chat.instructionsFilesLocations`
- `github.copilot.chat.codeGeneration.instructions`

Curated runtime folders:

- `~/.copilot/agent-harness/instructions`
- `~/.copilot/agent-harness/agents`
- `~/.copilot/agent-harness/skills`
- `~/.copilot/agent-harness/hooks`
- `~/.copilot/agent-harness/plugins`
- `~/.copilot/agent-harness/extensions`

Workspace and activation outputs:

- `.github/copilot-instructions.md`
- `activate/copilot-vscode/wire-preview-vscode.json`
- `activate/copilot-vscode/wire-plan.json`
- `activate/copilot-vscode/workspace-profile-manifest.json`

Current boundaries (host-specific details only; see [Managed wire-in vs native/global install](#managed-wire-in-vs-nativeglobal-install) for the shared invariants):

- Applying VS Code wire-in requires the VS Code user settings directory to exist and be writable.
- The README treats instruction files, skills, plugins, and MCP as the primary documented public contract. Some patched settings remain implementation detail unless a current VS Code settings reference explicitly documents them.
- The adapter never silently installs marketplace extensions during `wire`; native extension installation is an explicit `install native --operation install --apply` action.

### OpenCode

Adapter implementation:

- `src/host-adapters/opencode.ts`

This adapter is intentionally host-specific because OpenCode consumes project-local overlays and asset-kind directory layouts.

Current official docs:

- <https://opencode.ai/docs/rules/>
- <https://opencode.ai/docs/agents/>
- <https://opencode.ai/docs/skills/>
- <https://opencode.ai/docs/commands/>
- <https://opencode.ai/docs/plugins/>
- <https://opencode.ai/docs/mcp-servers/>
- <https://opencode.ai/docs/custom-tools/>
- <https://opencode.ai/docs/config/>

Supported behavior:

- writes a managed overlay under `.opencode/context/project-intelligence/agent-harness/`
- updates/removes managed `AGENTS.md` sections
- links selected assets into project-local `.opencode/` directories by asset kind, mapping workflow and prompt-pack assets to OpenCode `commands/`
- writes an effective project-local wire plan under the managed overlay
- projects shared MCP references into the wire plan when available
- uses Windows directory junctions on Windows
- avoids global OpenCode or OpenAgentsControl install mutation
- does not require a global OpenCode config directory for project-local apply/reset

Managed project-local locations:

- `.opencode/context/project-intelligence/agent-harness/`
- `.opencode/agents/`
- `.opencode/skills/`
- `.opencode/commands/`
- `.opencode/plugins/`
- `.opencode/context/project-intelligence/agent-harness/instructions/`
- `.opencode/context/project-intelligence/agent-harness/hooks/`
- `.opencode/context/project-intelligence/agent-harness/mcp-servers/`
- `.opencode/context/project-intelligence/agent-harness/extensions/`
- `.opencode/context/project-intelligence/agent-harness/reference-packs/`
- `AGENTS.md`

Documented OpenCode-native surfaces that this adapter uses or stays compatible with:

- `AGENTS.md`
- `opencode.json` `instructions`
- `opencode.json` `mcp` when structured native payloads are present
- `.opencode/agents/`
- `.opencode/skills/`
- `.opencode/commands/`
- `.opencode/plugins/`
- `.opencode/tools/` when structured native payloads are present

Agent-harness-managed overlay/reference locations:

- `.opencode/context/project-intelligence/agent-harness/`
- harness-managed context-root link targets such as `.opencode/context/project-intelligence/agent-harness/instructions/`, `.opencode/context/project-intelligence/agent-harness/hooks/`, `.opencode/context/project-intelligence/agent-harness/mcp-servers/`, `.opencode/context/project-intelligence/agent-harness/extensions/`, and `.opencode/context/project-intelligence/agent-harness/reference-packs/`
- `AGENTS.md` managed sections

Wire-plan outputs:

- `activate/opencode/wire-preview-opencode.json`
- `.opencode/context/project-intelligence/agent-harness/wire-plan.json`

Current boundaries (host-specific details only; see [Managed wire-in vs native/global install](#managed-wire-in-vs-nativeglobal-install) for the shared invariants):

- The adapter links activated assets into a project-local overlay and reference tree.
- It does not claim that every harness-managed `.opencode/*` path is a documented native OpenCode auto-discovery surface.
- `opencode.json` remains opt-in: managed instruction entries are projected there automatically, and MCP/tool synthesis only happens when an asset carries structured host-native payloads for those documented surfaces.
- It does not install or modify global OpenCode packages or any global OpenCode MCP configuration.

### Cursor

Adapter implementation:

- `src/host-adapters/native-wire.ts`
- registered as `cursor` in `src/host-adapters/registry.ts`

Cursor is a project-local native adapter. It reuses the VS Code / Copilot lifecycle host for install and activation but ranks assets through its own `cursor` recommendation policy.

Current official docs:

- <https://cursor.com/docs/rules>
- <https://cursor.com/docs/skills>
- <https://cursor.com/docs/plugins>
- <https://cursor.com/docs/mcp>
- <https://cursor.com/docs/hooks>
- <https://cursor.com/docs/subagents>
- <https://cursor.com/marketplace>

Supported behavior:

- writes the documented Cursor rules file `.cursor/rules/agent-harness.mdc`
- materializes selected assets under `.cursor/agent-harness/`
- stages a Cursor plugin-compatible component tree at `.cursor/agent-harness/cursor-plugin/` with a `.cursor-plugin/plugin.json` manifest
- maps selected Cursor command-like assets from `workflow` and `prompt-pack` recommendations into staged plugin `commands/`
- stages plugin-compatible `agents/`, `skills/`, `rules/`, and reference files for hosts that register project plugin paths
- writes `activate/cursor/wire-preview-cursor.json`
- writes `activate/cursor/wire-plan.json` on apply
- avoids global Cursor profile mutation
- avoids global VS Code profile mutation
- plans explicit Cursor native extension install/verify/remove actions when selected extension assets expose structured extension IDs

Documented Cursor-native surfaces used directly:

- `.cursor/rules/`
- `.cursor/agents/`
- `.cursor/mcp.json` when structured native payloads are present
- `.cursor/hooks.json` / `.cursor/hooks/` when structured native payloads are present
- compatible plugin bundle format via `.cursor-plugin/plugin.json`

Agent-harness staged/plugin-compatible surfaces:

- `.cursor/agent-harness/`
- `.cursor/agent-harness/cursor-plugin/`
- staged plugin `agents/`, `skills/`, `rules/`, `commands/`, and references

Current boundaries (host-specific details only; see [Managed wire-in vs native/global install](#managed-wire-in-vs-nativeglobal-install) for the shared invariants):

- Cursor native extension installation is explicit through `install native --host cursor --operation <verify|install|remove>` and depends on a compatible `cursor` CLI.
- `.cursor/agent-harness/` and `.cursor/agent-harness/cursor-plugin/` are staged project-local managed locations; `.cursor/agent-harness/cursor-plugin/` is treated as a compatible plugin bundle, and registering plugin paths remains host/user-managed.
- `.cursor/mcp.json` and `.cursor/hooks*.json` synthesis is opt-in and only happens when an asset carries structured host-native payloads for those documented files.
- Extension-like assets without structured extension IDs are treated as reference material in the project-local managed tree.

### Zed

Adapter implementation:

- `src/host-adapters/native-wire.ts`
- registered as `zed` in `src/host-adapters/registry.ts`

Zed is a project-local native adapter. It reuses the OpenCode-compatible lifecycle host for install and activation but ranks assets through its own `zed` recommendation policy.

Current official docs:

- <https://zed.dev/docs/ai/rules>
- <https://zed.dev/docs/ai/mcp>
- <https://zed.dev/docs/reference/all-settings.html>

Supported behavior:

- updates the documented project `.rules` file with an agent-harness managed section
- adds an `agent-harness` profile entry to `.zed/settings.json`
- materializes selected assets of every supported asset kind under `.zed/agent-harness/`
- surfaces agents, skills, workflows, prompt packs, plugins, hooks, extensions, reference packs, and MCP assets as project-readable references in managed Zed context
- writes `activate/zed/wire-preview-zed.json`
- writes `activate/zed/wire-plan.json` on apply
- avoids global Zed profile/settings mutation
- avoids global OpenCode profile mutation

Documented Zed-native surfaces used directly:

- `.rules`
- `.zed/settings.json` agent profile settings

Agent-harness managed reference surfaces:

- `.zed/agent-harness/`
- project-readable references for non-native asset kinds

Current boundaries (host-specific details only; see [Managed wire-in vs native/global install](#managed-wire-in-vs-nativeglobal-install) for the shared invariants):

- The adapter writes project-local context and profile hints.
- Zed extension installation remains manual through Zed's Extension Gallery or `auto_install_extensions`; extension assets are wired as managed project references unless explicit extension-install intent is provided.
- `.zed/agent-harness/` is a managed reference tree, not a claim that every staged asset kind is a documented Zed-native directory.
- Zed's documented MCP/context-server settings can be synthesized when an asset includes structured host-native config payloads for `.zed/settings.json`.

### Claude Code

Adapter implementation:

- `src/host-adapters/native-wire.ts`
- registered as `claude-code` in `src/host-adapters/registry.ts`

Claude Code is a project-local native adapter. It reuses the OpenCode-compatible lifecycle host for install and activation but ranks assets through its own `claude-code` recommendation policy.

Current official docs:

- <https://code.claude.com/docs/en/memory>
- <https://code.claude.com/docs/en/slash-commands>
- <https://code.claude.com/docs/en/sub-agents>
- <https://code.claude.com/docs/en/hooks>
- <https://code.claude.com/docs/en/settings>

Supported behavior:

- writes managed project context to `CLAUDE.md`
- writes managed local Claude context to `.claude/CLAUDE.md`
- writes `.claude/rules/agent-harness.md`
- writes `.claude/agents/agent-harness.md`
- writes `.claude/skills/agent-harness/SKILL.md`
- writes `.claude/commands/agent-harness.md`
- maps selected Claude Code command-like assets from `workflow` and `prompt-pack` recommendations into the managed command context
- includes selected instruction, agent, skill, workflow, and prompt-pack content in the matching managed Claude files
- materializes selected assets of every supported asset kind under `.claude/agent-harness/`
- surfaces plugins, hooks, extensions, reference packs, and MCP assets as managed project-readable references
- writes `activate/claude-code/wire-preview-claude-code.json`
- writes `activate/claude-code/wire-plan.json` on apply
- avoids global Claude Code profile mutation

Current boundaries (host-specific details only; see [Managed wire-in vs native/global install](#managed-wire-in-vs-nativeglobal-install) for the shared invariants):

- MCP and reference assets are still staged as project-readable references by default.
- The adapter can synthesize Claude Code `.mcp.json` and `.claude/settings*.json` surfaces when an asset includes structured host-native config payloads.
- Executable hook/plugin settings still require asset metadata that deliberately targets those documented Claude surfaces.

### OpenAI Codex

The Codex adapter uses the OpenCode-compatible lifecycle host while applying Codex-specific recommendation policy and project-local wire-in surfaces.

Official references:

- <https://developers.openai.com/codex>
- <https://developers.openai.com/codex/app>
- <https://developers.openai.com/codex/cli>
- <https://developers.openai.com/codex/skills>
- <https://developers.openai.com/codex/plugins>
- <https://developers.openai.com/codex/mcp>
- <https://developers.openai.com/codex/hooks>
- <https://developers.openai.com/codex/guides/agents-md>

What the adapter does:

- writes a managed Codex section into project `AGENTS.md`
- materializes selected skills into repo-local `.agents/skills/agent-harness/`
- writes a repo-local `.agents/plugins/marketplace.json` and reviewable `agent-harness` plugin descriptor
- stores reference assets under `.codex/agent-harness/`
- applies structured Codex-native payloads only when assets explicitly provide documented host-native config

What it does not do by default:

- it does not write global `~/.codex` config or plugin cache entries
- it does not silently enable plugin hooks
- it does not perform MCP OAuth/login or create MCP server config without structured native payloads
- it does not create automations, remote connections, browser/computer-use settings, or full-access sandbox settings

### Pi

Adapter implementation:

- `src/host-adapters/native-wire.ts`
- registered as `pi` in `src/host-adapters/registry.ts`

Pi is a project-local native adapter. It reuses the OpenCode-compatible lifecycle host for install and activation but ranks assets through its own `pi` recommendation policy.

Current official docs:

- <https://pi.dev/docs/latest/settings>
- <https://pi.dev/docs/latest/skills>
- <https://pi.dev/docs/latest/prompt-templates>
- <https://pi.dev/docs/latest/extensions>
- <https://pi.dev/docs/latest/packages>
- <https://pi.dev/docs/latest/usage>

Supported behavior:

- writes managed project agent context to `AGENTS.md`
- writes managed project system context to `SYSTEM.md`
- writes `.pi/skills/agent-harness/SKILL.md`
- writes `.pi/prompts/agent-harness.md`
- updates `.pi/settings.json` using Pi's documented top-level `skills` and `prompts` arrays
- includes selected instruction, agent, skill, workflow, and prompt-pack content in the matching managed Pi files
- materializes selected assets of every supported asset kind under `.pi/agent-harness/`
- surfaces plugins, hooks, extensions, reference packs, and MCP assets as managed project-readable references
- writes `activate/pi/wire-preview-pi.json`
- writes `activate/pi/wire-plan.json` on apply
- avoids global Pi profile mutation

Documented Pi-native surfaces used directly:

- `AGENTS.md`
- `SYSTEM.md`
- `.pi/skills/`
- `.pi/prompts/`
- `.pi/settings.json` top-level resource arrays

Current boundaries (host-specific details only; see [Managed wire-in vs native/global install](#managed-wire-in-vs-nativeglobal-install) for the shared invariants):

- Pi does not include `shared-mcp` in its default bundles.
- `.pi/agent-harness/` remains a harness-managed reference tree for non-native assets.
- `.pi/extensions/` and `.pi/packages/` can be synthesized when an asset includes structured host-native config payloads.
- MCP, extension, hook, and plugin assets default to managed references unless they carry compatible Pi-native payloads.

### Native adapter wire-plan fields

Native project-local adapters emit effective wire plans with materialized paths. Depending on selected assets, plans can include:

- `instructionsFiles`
- `agentFiles`
- `skillDirs`
- `pluginDirs`
- `workflowFiles`
- `referenceFiles`
- `extensionIds`
- `hookFiles`
- `mcpServers`
- `textFileSnapshots`
- `nativeConfigOperations`
- `nativeInstallActions`

`textFileSnapshots` capture the exact pre-apply content for managed markdown/text files so reset and failure rollback can restore the original file byte-for-byte instead of relying only on managed-block removal.

### Structured host-native file payloads

Assets can now carry optional structured native-config payloads at `hostNativeConfig.<host>.files[]`.

Each file payload includes:

- `path` - workspace-relative target path on a documented host-native surface
- `format` - `text` or `json`
- `content` - file body for `text`, or JSON object for `json`
- `merge` - optional for `json`; when `true`, the adapter deep-merges the payload into an existing host config file and records a reversible wire-plan operation

The adapters only accept payload paths for documented host-native targets:

- OpenCode: `opencode.json`, `.opencode/tools/...`
- Cursor: `.cursor/mcp.json`, `.cursor/hooks.json`, `.cursor/hooks/...`, `.cursor/agents/...`
- Zed: `.zed/settings.json`
- Claude Code: `.mcp.json`, `.claude/settings.json`, `.claude/settings.local.json`
- Pi: `.pi/extensions/...`, `.pi/packages/...`

That keeps host-native synthesis opt-in and explicit instead of treating every staged reference as executable native config.

## Discovery and recommendations

### Discovery coverage

Demand profiling uses scan budgets and detector packs for a broad range of repository archetypes:

- software manifests
- documentation-heavy repositories
- notebooks
- datasets
- media/design assets
- CAD/hardware artifacts
- research and publishing content
- game engines
- mobile projects
- ML model artifacts

Generated outputs include these state-root-relative paths:

- `discover/output/demand-profile.json`
- `discover/output/source-index.json`
- `discover/output/source-utilization.json`
- `discover/catalog.assets.jsonl`
- selected/rejected JSONL outputs

### Source utilization

`discover/output/source-utilization.json` separates configured sources from operationally harvested sources so you can see whether broad source declarations are producing usable catalog entries.

The checked-in default source registry intentionally mixes several source classes instead of relying on one curated repo. Out of the box it includes official docs and repos (for example GitHub Copilot docs, the `github/awesome-copilot` repo, and the `awesome-copilot.github.com` site), host-native marketplaces/registries (for example the VS Code Marketplace, Cursor Marketplace, Zed extension gallery, Pi packages, npm, and PyPI), and lighter-weight community registries such as `skills.sh` and ClawHub. That split keeps official sources preferred while still surfacing broader community references for real workspaces.

Current direct official discovery coverage is modeled explicitly per host:

- GitHub Copilot / VS Code: first-party docs plus the VS Code Marketplace
- OpenCode: first-party docs
- Cursor: first-party docs plus Cursor Marketplace, with shared VS Code Marketplace compatibility coverage still available where appropriate
- Zed: first-party docs plus Zed Extension Gallery
- Claude Code: first-party docs
- Pi: first-party docs plus Pi Packages

Generated local source seeds include host config roots for OpenCode, Claude Code, and Cursor. Claude Code harvesting recognizes `CLAUDE.md`, `.claude`-style `agents/`, `commands/`, `skills/`, hook settings, plugin manifests, and `.mcp.json`. Cursor harvesting recognizes rules, agents, commands, skills, hooks, plugin manifests, marketplace manifests, and `mcp.json` from the default Cursor config root. Claude Code and Cursor generated local config sources are catalog-only by default so local settings, hooks, and MCP files are not mirrored into project state unless a user-authored source explicitly opts in.

### Dependency-evidence package discovery

Package registry discovery is driven by dependency evidence extracted from manifests such as:

- `package.json`
- `requirements.txt`
- `pyproject.toml`
- `pubspec.yaml`

The discovery pipeline emits package dependency signals like `npm:<package>`, `pypi:<package>`, and `pub:<package>` only from dependency evidence. It filters requirement directives, direct references, VCS URLs, local paths, and non-package strings before querying package registries.

For `pyproject.toml`, dependency extraction is intentionally scoped to project dependency sections rather than build-system requirements. Supported sections include PEP 621 `[project].dependencies`, `[project.optional-dependencies]`, Poetry `[tool.poetry.dependencies]`, `[tool.poetry.dev-dependencies]`, and `[tool.poetry.group.<name>.dependencies]` sections. Requirements detection covers `requirements*.txt`, `constraints*.txt`, and files under `requirements/` without treating that folder name as business-analysis evidence.

Non-Python/JavaScript dependency parsing also feeds technology signatures for Cargo workspace dependencies, Go modules, Maven/Gradle coordinates, NuGet `PackageReference`/`PackageVersion`/`packages.config`, Ruby gems, Packagist packages, and SwiftPM packages. Lockfiles are used for package-manager evidence but are not scanned as generic prose, which avoids transitive package names such as `debug` or `mock` creating false demand signals.

For MCP recommendations, npm registry discovery builds demand-derived npm search queries such as `<detected-term> mcp server` and `keywords:mcp-server`, then filters search results to executable-server package patterns. This avoids a checked-in package allowlist while still surfacing relevant MCP servers for detected stacks. GitHub tree harvesting treats Markdown MCP documentation as reference material instead of executable MCP server assets.

### Recommendation policy layout

Recommendation policy is split across smaller JSON files:

- `discover/recommendation-policy/base.json`
- `discover/recommendation-policy/hosts/copilot-vscode.json`
- `discover/recommendation-policy/hosts/opencode.json`
- `discover/recommendation-policy/hosts/shared.json`
- `discover/recommendation-policy/hosts/cursor.json`
- `discover/recommendation-policy/hosts/zed.json`
- `discover/recommendation-policy/hosts/claude-code.json`
- `discover/recommendation-policy/hosts/pi.json`
- `discover/recommendation-policy/overrides/base.json`
- `discover/recommendation-policy/overrides/hosts/<host>.json`
- `discover/schema/recommendation-policy-base.schema.json`
- `discover/schema/recommendation-policy-base-override.schema.json`
- `discover/schema/recommendation-host-policy-override.schema.json`

`base.json` holds global scoring, keyword maps, optional host defaults, and reusable presets. Each host file holds host-specific defaults. Put durable workspace/user customization in `discover/recommendation-policy/overrides/` rather than editing package-owned defaults. At runtime the loader composes recommendation policy in this order:

1. checked-in/package defaults
2. user-owned override files
3. runtime env overrides

`discover select` first applies workspace-demand relevance filtering, then canonical duplicate selection. Entries with no language, framework, concern, tooling, or executable MCP overlap are rejected before recommendation so unrelated source packs do not dominate real-world reports.

Recommendation scoring considers:

- source authority
- compatibility mode
- trust score
- source priority
- workspace demand matches
- host preferences
- coverage/diversity
- freshness
- context cost
- risk penalties
- duplicate groups
- per-host caps and budgets

### Layered confidence model

The recommendation pipeline now follows a stricter evidence hierarchy instead of treating repeated docs noise like runtime truth:

- **Strong evidence**: manifests, lockfiles, imports, framework/runtime/config files
- **Medium evidence**: deploy/config conventions, generated artifacts, directory conventions
- **Weak evidence**: README/docs/examples
- **Ignored by default**: issue templates, changelogs, roadmaps, planning docs

That evidence feeds a ranking ladder:

- `fit:exact-stack` → exact dependency/framework/runtime matches
- `fit:ecosystem` → narrower ecosystem-adjacent matches
- `fit:generic-concern` → broad concern overlap like testing/docs/backend
- `coverage-gap-fill` → coverage-driven fallback signal when host coverage goals still need help; in evaluation summaries it is counted as a broad fallback only when no stronger exact/ecosystem fit is carrying the top slot

`recommend explain` surfaces these reasons directly, along with matched-signal evidence counts and whether an asset was shown for actual workspace fit or only because it was already available locally:

- `recommendation basis: workspace-fit | local-availability`
- `available locally: yes | no`
- `matched signals: ... s=<strong>/m=<medium>/w=<weak>`

If a narrow repo shows a lot of `fit:generic-concern` or `coverage-gap-fill` winners, that is a signal to inspect policy breadth or source mix before increasing selection counts.

The legacy `discover/recommendation-policy.json` path is still accepted as a fallback when only the older monolithic policy file exists.

### Quality and policy coverage

The quality tooling includes:

```bash
npm run quality:detection
npm run quality:policy
npm run benchmark:scan
npm run validate:recommendations
```

- `quality:detection` checks representative archetype fixtures and reports precision/recall-style metrics.
- `quality:policy` verifies detector-emitted terms are represented in recommendation policy maps and writes draft suggestions for human review.
- `benchmark:scan` enforces scan budget expectations.
- `validate:recommendations` evaluates golden recommendation fixtures and prints aggregate quality signals such as top-rank reason mix, top-rank confidence mix, broad-fallback frequency, and local-availability frequency.

## Environment variables

See `.env.example` for documented defaults. On startup, the CLI loads `.env` from the current working directory into `process.env` and preserves any variables already set by the parent shell or process manager.

### GitHub authentication

Optional GitHub tokens improve API throughput during discovery and GitHub-backed mirror acquisition:

```bash
GITHUB_PERSONAL_ACCESS_TOKEN=
# GITHUB_TOKEN=
```

PowerShell example:

```powershell
$env:GITHUB_PERSONAL_ACCESS_TOKEN = '<token>'
$env:GITHUB_TOKEN = $env:GITHUB_PERSONAL_ACCESS_TOKEN
```

### Optional AI enrichment and recommendation review

```bash
AGENT_HARNESS_AI_ENRICHMENT_URL=
AGENT_HARNESS_AI_ENRICHMENT_API_KEY=
AGENT_HARNESS_AI_ENRICHMENT_MODE=manual
AGENT_HARNESS_AI_ENRICHMENT_MODEL=gpt-4o-mini
# Optional comma-separated extra https origins for compatible public gateways.
AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS=
AGENT_HARNESS_AI_ENRICHMENT_TIMEOUT_MS=20000
AGENT_HARNESS_AI_ENRICHMENT_MAX_RESPONSE_BYTES=1000000
AGENT_HARNESS_AI_ENRICHMENT_MAX_INPUT_SELECTED_ASSETS=50
AGENT_HARNESS_AI_ENRICHMENT_MAX_INPUT_EVIDENCE_ITEMS=12
AGENT_HARNESS_AI_ENRICHMENT_MAX_INPUT_CAPABILITIES_PER_ASSET=16
AGENT_HARNESS_AI_ENRICHMENT_REDACT_FILE_PATHS=false
AGENT_HARNESS_AI_ENRICHMENT_REDACT_SOURCE_IDS=false
AGENT_HARNESS_AI_ENRICHMENT_RETRY_MAX_ATTEMPTS=1
AGENT_HARNESS_AI_ENRICHMENT_RETRY_BACKOFF_MS=1000
AGENT_HARNESS_AI_ENRICHMENT_AUTO_MIN_INTERVAL_MS=300000
AGENT_HARNESS_AI_ENRICHMENT_REQUIRE_SUCCESS_IN_CI=false
AGENT_HARNESS_AI_ENRICHMENT_ALLOW_CACHE_IN_CI=true
```

These settings power both `discover enrich` and the bounded `recommend ai-review` / `recommend report --ai-review` flow. `AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS` extends the built-in public-provider allowlist. The configured endpoint origin is also auto-allowed when it is a valid public `https` origin, and DNS/public-IP checks still run before any request is sent.

`AGENT_HARNESS_AI_ENRICHMENT_MAX_INPUT_SELECTED_ASSETS`, `AGENT_HARNESS_AI_ENRICHMENT_MAX_INPUT_EVIDENCE_ITEMS`, and `AGENT_HARNESS_AI_ENRICHMENT_MAX_INPUT_CAPABILITIES_PER_ASSET` only bound the metadata included in the optional AI enrichment request. They do **not** cap deterministic discovery selection, they do **not** cap final recommendation breadth, and they do **not** install or enroll assets. The older `AGENT_HARNESS_AI_ENRICHMENT_MAX_SELECTED_ASSETS`, `AGENT_HARNESS_AI_ENRICHMENT_MAX_EVIDENCE_ITEMS`, and `AGENT_HARNESS_AI_ENRICHMENT_MAX_CAPABILITIES_PER_ASSET` aliases remain supported for backward compatibility.

The enrichment-specific controls are grouped into four buckets:

- **Mode/triggering**: `AGENT_HARNESS_AI_ENRICHMENT_MODE`
- **Privacy/budget**: selected-asset, evidence, capability, and redaction caps
- **Provider behavior**: timeout, response budget, retry attempts, and retry backoff
- **CI/headless semantics**: cooldown, cache reuse in CI, and require-success behavior

### Shared network and host-command safeguards

```bash
AGENT_HARNESS_HTTP_TIMEOUT_MS=10000
AGENT_HARNESS_HTTP_MAX_RESPONSE_BYTES=1000000
AGENT_HARNESS_GITHUB_FETCH_TIMEOUT_MS=10000
AGENT_HARNESS_GITHUB_JSON_MAX_BYTES=2000000
AGENT_HARNESS_REGISTRY_FETCH_TIMEOUT_MS=5000
AGENT_HARNESS_REGISTRY_METADATA_MAX_BYTES=2000000
AGENT_HARNESS_REGISTRY_SEARCH_MAX_BYTES=500000
AGENT_HARNESS_REFERENCE_SOURCE_MAX_BYTES=600000
AGENT_HARNESS_OFFICIAL_INDEX_PAGE_MAX_BYTES=1000000
AGENT_HARNESS_OFFICIAL_INDEX_CONTENT_MAX_BYTES=1000000
AGENT_HARNESS_NATIVE_COMMAND_TIMEOUT_MS=30000
AGENT_HARNESS_NATIVE_COMMAND_MAX_BUFFER_BYTES=2000000
AGENT_HARNESS_PREFLIGHT_COMMAND_TIMEOUT_MS=10000
```

### Discovery recall caps

```bash
AGENT_HARNESS_GENERIC_REFERENCE_MAX_ITEMS=8
AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_QUERIES=4
AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_ITEMS_PER_QUERY=6
AGENT_HARNESS_VSCODE_MARKETPLACE_SYNC_PAGE_SIZE=50
AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_PER_RUN=10
AGENT_HARNESS_NPM_SEARCH_RESULT_LIMIT=12
AGENT_HARNESS_NPM_MCP_SEARCH_QUERY_LIMIT=8
```

### Per-host recommendation limit overrides

```bash
AGENT_HARNESS_SHARED_RECOMMENDATION_LIMIT=12
AGENT_HARNESS_SHARED_RECOMMENDATION_LIMIT_MODE=preserve
AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT=240
AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT_MODE=preserve
AGENT_HARNESS_OPENCODE_RECOMMENDATION_LIMIT=80
AGENT_HARNESS_OPENCODE_RECOMMENDATION_LIMIT_MODE=preserve
AGENT_HARNESS_CURSOR_RECOMMENDATION_LIMIT=240
AGENT_HARNESS_CURSOR_RECOMMENDATION_LIMIT_MODE=preserve
AGENT_HARNESS_ZED_RECOMMENDATION_LIMIT=80
AGENT_HARNESS_ZED_RECOMMENDATION_LIMIT_MODE=preserve
AGENT_HARNESS_CLAUDE_CODE_RECOMMENDATION_LIMIT=80
AGENT_HARNESS_CLAUDE_CODE_RECOMMENDATION_LIMIT_MODE=preserve
AGENT_HARNESS_PI_RECOMMENDATION_LIMIT=80
AGENT_HARNESS_PI_RECOMMENDATION_LIMIT_MODE=preserve
```

These env vars override the checked-in host policy recommendation caps at runtime. `*_RECOMMENDATION_LIMIT_MODE=preserve` keeps the current default behavior and changes only the total `recommendationLimit`. Set the mode to `scale` when you explicitly want `maxPerAssetKind`, target minimums, and related host-selection caps to scale with the overridden limit. Generated recommendation reports and `recommend policy:print --host <host>` both record whether the effective limit and mode came from policy or env overrides.

Use the modes intentionally:

- **Lean/default mode**: keep the checked-in defaults for normal first runs, small/medium repos, demos, and low-noise recommendations.
- **Broader report mode**: increase `AGENT_HARNESS_<HOST>_RECOMMENDATION_LIMIT` and leave mode as `preserve` when you only want a longer ranked report without changing diversity pressure or target minimums.
- **Deep audit mode**: pair a larger limit with `AGENT_HARNESS_<HOST>_RECOMMENDATION_LIMIT_MODE=scale` for large monorepos, broad polyglot workspaces, or exploratory audits where caps/minimums should grow with the report.

Example broader report mode:

```bash
AGENT_HARNESS_CURSOR_RECOMMENDATION_LIMIT=260
AGENT_HARNESS_CURSOR_RECOMMENDATION_LIMIT_MODE=preserve
```

Example deep audit mode:

```bash
AGENT_HARNESS_CURSOR_RECOMMENDATION_LIMIT=320
AGENT_HARNESS_CURSOR_RECOMMENDATION_LIMIT_MODE=scale
```

Do **not** raise limits first when `demand-profile.json` is wrong, source coverage is starved, or relevant assets are already selected but buried. Fix detection, source coverage, or ranking instead. `shared` should stay conservative unless you are explicitly auditing shared MCP coverage; `pi` intentionally deprioritizes MCP/extension-like assets, so scaling should not be used just to bypass that policy intent. VS Code and Cursor usually benefit most from broader surfaces, while Zed, Claude Code, OpenCode, and Pi should be checked with `recommend explain` and host-specific fixtures.

Verify effective settings with:

```bash
agent-harness recommend policy:print --host <host>
```

### Mirror safety limits

```bash
AGENT_HARNESS_MAX_OFFICIAL_INDEX_PACKAGE_FILES=1000
AGENT_HARNESS_MAX_OFFICIAL_INDEX_FILE_SIZE_BYTES=1000000
AGENT_HARNESS_MAX_OFFICIAL_INDEX_PACKAGE_TOTAL_BYTES=20000000
AGENT_HARNESS_MAX_GITHUB_MIRROR_FILE_SIZE_BYTES=1000000
```

### GitHub API and retries

```bash
GITHUB_API_VERSION=2022-11-28
AGENT_HARNESS_GITHUB_FETCH_RETRIES=3
```

### Diagnostics, batch sizes, and scan budgets

```bash
AGENT_HARNESS_DEBUG=false
AGENT_HARNESS_INSTALL_REFRESH_POLICY=manual
AGENT_HARNESS_INSTALL_REFRESH_INTERVAL_MS=21600000
AGENT_HARNESS_REMOTE_BATCH_SIZE=15
AGENT_HARNESS_MIRROR_BATCH_SIZE=120
AGENT_HARNESS_INSTALL_BATCH_SIZE=250
AGENT_HARNESS_SCAN_MAX_DEPTH=14
AGENT_HARNESS_SCAN_MAX_FILES=20000
AGENT_HARNESS_SCAN_MAX_BYTES=50000000
```

The runtime config exposes diagnostics as a boolean flag at `diagnostics.debugEnabled`; there is no full log-level hierarchy today. The current `AGENT_HARNESS_DEBUG` env var maps directly to `diagnostics.debugEnabled`, so diagnostics can be controlled either through that env var or by reading the resolved runtime config object.

### Mutable state root override

```bash
AGENT_HARNESS_STATE_ROOT=.agent-harness
```

You can also pass `--state-root <path>` on the CLI. This option is global and may appear before or after the command domain.

### Optional platform path overrides

Most users should leave these unset:

```bash
# AGENT_HARNESS_HOME=
# XDG_CONFIG_HOME=
# APPDATA=
```

## Generated and managed files

The lifecycle writes two kinds of generated output:

1. **State-root lifecycle state** such as discovery, mirror, install, activation, and recommendation artifacts
2. **Workspace-local host files** such as `.cursor/`, `.zed/`, `AGENTS.md`, or `.github/copilot-instructions.md` when a wire/apply flow targets that host

Unless you override it, packaged CLI usage writes lifecycle state under the configured state root, which defaults to workspace-local `.agent-harness/`. Repository-local development in this repo still uses the repository root as the default state root.

State-root lifecycle outputs include:

- `.agent-harness/`
- `discover/output/`
- `discover/output/ai-enrichment-input.json`
- `discover/output/ai-enrichment.json`
- `recommend/output/`
- `discover/catalog.assets.jsonl`
- `mirror/audit/`
- `mirror/bundles/`
- `mirror/index.jsonl`
- `mirror/quarantine/`
- `mirror/raw/`
- `install/`
- `activate/`
- `state/`

Workspace-local host outputs can include:

- `.opencode/`
- `.cursor/`
- `.zed/`
- `.claude/`
- `.pi/`
- `.github/copilot-instructions.md`
- `.rules`
- `AGENTS.md`
- `CLAUDE.md`
- `SYSTEM.md`

Local environment files are ignored except `.env.example`:

- `.env`
- `.env.*`
- `!.env.example`

## Repository structure

Representative layout (generated lifecycle state such as `state/`, `install/`, `activate/`, and `discover/output/` is omitted here because it is created at runtime):

```text
agent-harness/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   └── workflows/
├── discover/
│   ├── recommendation-policy/
│   ├── schema/
│   ├── seeds/
│   ├── source-packs/
│   ├── official-skills-indexes.json
│   ├── official-upstreams.json
│   ├── pipeline.json
│   ├── selections.json
│   └── sources.json
├── mirror/
│   ├── schema/
│   └── policy.json
├── scripts/
│   └── prepare-husky.cjs
├── src/
│   ├── config/
│   ├── domains/
│   │   ├── discovery/
│   │   └── wire/
│   ├── host-adapters/
│   │   ├── extension-installer.ts
│   │   ├── native-config.ts
│   │   ├── native-wire.ts
│   │   ├── opencode.ts
│   │   ├── registry.ts
│   │   ├── types.ts
│   │   ├── vscode-settings.ts
│   │   └── vscode.ts
│   ├── install/
│   ├── lib/
│   ├── manifest-validation/
│   ├── mirror/
│   ├── recommend/
│   ├── tests/
│   ├── types/
│   ├── activate.ts
│   ├── cli.ts
│   ├── discover.ts
│   ├── install.ts
│   ├── manifest-validation.ts
│   ├── mirror.ts
│   ├── pipeline.ts
│   ├── quarantine.ts
│   ├── recommend-fixtures.ts
│   ├── recommend.ts
│   ├── setup.ts
│   ├── wire.ts
│   └── workspace.ts
├── docs/
│   ├── demo/
│   ├── guides/
│   │   ├── HARNESS-MAINTENANCE-GUIDE.md
│   │   ├── LOGGING-STRATEGY.md
│   │   ├── MAINTENANCE-WORKFLOW.md
│   │   ├── RELEASE-PROCESS.md
│   │   ├── SAFE-DEFAULTS.md
│   │   ├── TRUST-CENTER.md
│   │   ├── V1-TO-V2-UPGRADE.md
│   │   └── V2-CONTRACT.md
│   ├── playbooks/
│   │   ├── AGENT-SETUP-PLAYBOOK.md
│   │   ├── AI-ENRICHMENT-PLAYBOOK.md
│   │   ├── ASSET-UPDATE-PLAYBOOK.md
│   │   ├── DEMAND-DETECTION-PLAYBOOK.md
│   │   ├── DISCOVERY-BREADTH-PLAYBOOK.md
│   │   ├── QUARANTINE-PLAYBOOK.md
│   │   ├── RECOMMENDATION-POLICY-PLAYBOOK.md
│   │   ├── SOURCE-COVERAGE-PLAYBOOK.md
│   │   └── WORKSPACE-EVOLUTION-PLAYBOOK.md
│   └── reference/
│       ├── COVERAGE-100-ROADMAP.md
│       ├── DEMAND-DETECTION-COVERAGE.md
│       ├── FUTURE-IMPROVEMENTS.md
│       ├── HOST-SURFACE-AUDIT.md
│       ├── IMPLEMENTATION-PLAN.md
│       ├── Roadmap.md
│       └── SOURCE-SYNC-DECOMPOSITION-PLAN.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── package.json
└── tsconfig.json
```

## Development and validation

Before pushing changes, run at least:

```bash
npm run validate
npm run build
npm run validate:coverage
npm run test:self-hosting
```

Coverage is enforced through `npm run test:coverage` using the checked-in `.c8rc.json` policy. `npm run validate:coverage` builds, runs the coverage gate, and refreshes `coverage/coverage-gaps.md` with uncovered lines/functions/branches from the latest `lcov.info`. The current gate targets the main shipped runtime surface while excluding generated types, test harness artifacts, and selected built command-entry outputs listed in `.c8rc.json`; it fails CI unless statements, branches, functions, and lines all remain at 100%. The maintained 100% coverage policy and gap-inventory workflow are documented in [`COVERAGE-100-ROADMAP.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/reference/COVERAGE-100-ROADMAP.md).

For release or adapter changes, also run:

```bash
npm run smoke:cli
npm run smoke:workspace
npm run quality:detection
npm run quality:policy
npm run benchmark:scan
npm run validate:recommendations
npm run smoke:pack
```

For release readiness, run:

```bash
npm run validate:release
```

The CI quality workflow runs on Ubuntu, macOS, and Windows. It validates linting, formatting, types, coverage-gated unit/integration tests, the dedicated self-hosting suite, scan budgets, detection quality, policy coverage, isolated CLI smoke checks, packed artifact smoke checks, and recommendation fixtures. It also publishes a coverage summary into the GitHub Actions step summary for each run. The release workflow additionally runs production dependency audit and npm publish dry-run checks before tagged publication.

For output/logging conventions and the current decision to prefer lightweight internal helpers over a full logging library, see [`LOGGING-STRATEGY.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/LOGGING-STRATEGY.md).

## Troubleshooting

### `agent-harness` command is not found

Build first and run through the local `dist` entrypoint, or use npm scripts from this repository:

```bash
npm run build
agent-harness setup hosts
npm run workspace:vscode -- --intent frontend
```

The supported package binary is `agent-harness`. Run host-specific flows through `agent-harness workspace <host>` or `agent-harness wire <host>`.

### Host readiness diagnostics fail

Run:

```bash
agent-harness setup doctor --host <host>
```

VS Code apply needs a writable VS Code user settings directory. OpenCode, Cursor, Zed, Claude Code, and Pi use project-local wiring and should not require global host profile mutation. Missing host CLIs such as `cursor`, `zed`, `claude`, or `pi` are reported as readiness warnings so users know runtime validation is incomplete, but project-local preview/apply/reset can still proceed when no required path is missing.

### VS Code settings cannot be patched

The VS Code adapter reads JSONC settings. If parsing fails, fix `settings.json` syntax first, then retry:

```bash
agent-harness wire vscode --preview
agent-harness wire vscode --apply
```

The adapter avoids overwriting unrelated user settings and removes only managed entries during reset.

### Preview still appears applied

Preview should remove stale wire plans where the adapter owns them. If workspace files were applied earlier, use reset:

```bash
agent-harness wire <host> --reset
agent-harness wire <host> --preview
```

### Recommendations are slow or irrelevant on a real workspace

Run the pipeline from the target workspace so `discover demand-profile` can see the real manifests, then inspect selection counts before recommendation:

```bash
agent-harness discover demand-profile
agent-harness discover catalog
agent-harness discover select
agent-harness discover stats
agent-harness recommend report
```

Use this dry-run decision tree before changing policy or applying installs. The artifact paths below are relative to the active state root:

1. **Check demand detection first.** Inspect `discover/output/demand-profile.json`.
   - If the workspace stack is missing there, fix detection scope first.
   - Common causes: running from the wrong directory, manifests hidden by `.gitignore`, `.ignore`, or `.agent-harnessignore`, or unsupported dependency evidence.
2. **Check selection counts second.** Inspect `discover/output/selection-report.json`.
   - If `selectedCount` is extremely low, then selection filtering may be too strict for that workspace.
   - If `selectedCount` is already healthy, increasing selection count is usually the wrong first move.
3. **Check ranking before changing selection.** Inspect `state/recommendations.json` and use `recommend explain` on both a relevant asset and an off-topic asset.
   - If relevant technologies are present in demand/selection but weak recommendations still dominate, the problem is usually ranking, host policy, or source weighting.
   - Example: a workspace can correctly detect `apify` and `duckdb`, yet still surface broad official assets if generic documentation/integration signals are overweighted.
4. **Separate recommendation from installation.** Review `wire --preview` output and native install planning.
   - A recommended asset is not automatically installed.
   - Extension installation, MCP auth, runtime executables, and host logins may still need explicit approval or manual follow-up.
5. **Only increase selection count as a last resort.** Do it when the workspace truly lacks enough relevant candidates after demand detection is correct.
   - If the right assets are already in the selected set, tune policy or source mix instead of making the candidate pool larger.

`discover select` should reject entries that do not overlap with detected workspace signals. If relevant entries are missing, inspect `discover/output/demand-profile.json` and confirm the workspace manifests are not excluded by `.gitignore`, `.ignore`, or `.agent-harnessignore`.

A practical rule of thumb:

- **Missing relevant assets entirely** → investigate detection, source coverage, or selection.
- **Relevant assets exist but lose to noisy ones** → investigate ranking, policy, and source weighting.
- **Assets are recommended but not active in the host** → inspect wire previews, native install planning, and manual runtime prerequisites.

### GitHub discovery or mirror acquisition is slow or rate-limited

Set a token before discovery or full workspace runs:

```bash
GITHUB_PERSONAL_ACCESS_TOKEN=<token>
```

Use a least-privileged token with public repository read access unless your sources require more. This is especially helpful on larger real-workspace runs where the harness needs both GitHub API metadata and raw-content verification for mirrored assets.

### A generated host file shows up in `git status`

Generated host files are ignored for this repository. If you run the harness against another workspace, decide whether that workspace should commit project-local host config. For this repository, generated files such as `.cursor/`, `.zed/`, `.claude/`, `.pi/`, `.opencode/`, `AGENTS.md`, `CLAUDE.md`, and `SYSTEM.md` are intentionally ignored.

### Windows link behavior differs from Unix

OpenCode uses managed directory links. On Windows, directory links are created as junctions for compatibility. The link lifecycle tests cover create, replace, and reset behavior across supported operating systems.

## FAQ

### Why does the CLI use `agent-harness workspace <host>`?

The CLI keeps one adapter-driven command surface so host selection stays explicit while lifecycle behavior remains consistent across supported hosts. For a new user, `workspace <host>` is also the default end-to-end command: it already runs broad discovery, recommendation, staging, activation, and final host wire-in in one flow.

### Why are there VS Code and OpenCode-specific files in `src/host-adapters/`?

Those files are intentional adapter implementations. Generic orchestration belongs in lifecycle modules; host-specific settings, file layouts, and reset behavior belong in host adapters.

### Can a new adapter have its own custom behavior?

Yes. Add a new implementation under `src/host-adapters/`, register it in `src/host-adapters/registry.ts`, and keep generic lifecycle orchestration unchanged.

### Does `agent-harness` install VS Code extensions automatically?

No. VS Code extension assets can produce metadata and install guidance, but the harness does not silently install marketplace extensions.

### Should I increase selection count when recommendations look wrong?

Usually no. First confirm that demand detection found the real workspace technologies, then inspect whether relevant assets already exist in the selected set. If they do, the problem is more likely ranking, host policy, or source weighting than selection breadth. Increase selection count only when the current selection genuinely omits relevant candidates.

### How do I give recommendations the widest possible asset pool?

Run `agent-harness discover breadth` from the real workspace root first, then inspect `discover/output/source-index.json`, `discover/output/source-utilization.json`, and `discover/output/selection-report.json` before touching policy. If the checked-in source universe is still too narrow, widen the active state-root discovery inputs (`discover/sources.json`, `discover/source-packs/*.json`, `discover/official-skills-indexes.json`, and `discover/official-upstreams.json`) and rerun `agent-harness discover breadth`. Use this recall-first path when you are diagnosing breadth specifically; for a normal new-user end-to-end setup, use `agent-harness workspace <host>` instead. For the step-by-step workflow and agent prompt, use [`DISCOVERY-BREADTH-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/DISCOVERY-BREADTH-PLAYBOOK.md).

### Why do Cursor, Zed, Claude Code, and Pi reuse lifecycle hosts?

They can reuse compatible install and activation package layouts while keeping independent recommendation policies and native project-local wire behavior.

### Which generated files should I commit in my own project?

That depends on your project policy. Project-local files such as `.cursor/rules/agent-harness.mdc`, `.rules`, `CLAUDE.md`, `AGENTS.md`, or `SYSTEM.md` can be useful to commit if your team wants shared host behavior. Review generated content before committing it.

### Is OpenCode global configuration required?

No. The OpenCode adapter writes a project-local `.opencode` overlay and does not require a global OpenCode config directory for apply/reset flows.

### How do I know what was wired?

Inspect the effective wire plan. Depending on host, it is written under `activate/<host>/wire-plan.json` or inside the host-local overlay, such as `.opencode/context/project-intelligence/agent-harness/wire-plan.json`.

## Security and trust center

For the v2 trust model, safe defaults, review-required paths, and security non-guarantees, see [`TRUST-CENTER.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/TRUST-CENTER.md) and [`SAFE-DEFAULTS.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/SAFE-DEFAULTS.md). The short rule is: discovery/reporting can be automated, but quarantine approval, trust-tier promotion, executable hooks/plugins/MCP/custom tools, native/global installs, and host-native credential flows require explicit review.

## Current boundaries

The project intentionally favors explicit host semantics over pretending every host behaves the same.

Known boundaries:

- VS Code extension assets are represented with metadata and install guidance; the harness does not silently install marketplace extensions.
- Cursor native extension installation is explicit and requires a compatible `cursor` CLI with VS Code-style extension commands.
- OpenCode wire-in is project-local and does not mutate global OpenCode packages.
- Host-native MCP/hooks/tools/packages/settings synthesis is opt-in and only happens when an asset carries structured host-native file payloads for documented surfaces.
- Pi stages MCP references only by default and does not include `shared-mcp` in its default bundles.
- Quarantine review commands are intentionally conservative and audit-log based; richer interactive review UIs and policy-specific prompt-injection classifiers remain future enhancements.
- Large modules are improved but not fully decomposed; continued package extraction and file-size reduction are future work.

## Related documentation

- [`CHANGELOG.md`](https://github.com/ar27111994/agent-harness/blob/main/CHANGELOG.md) - release notes
- [`AGENT-SETUP-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/AGENT-SETUP-PLAYBOOK.md) - dry-run setup workflow, decision tree, and reusable agent prompts for workspace/host asset setup
- [`DISCOVERY-BREADTH-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/DISCOVERY-BREADTH-PLAYBOOK.md) - how to maximize the practical candidate pool before judging recommendation quality
- [`AI-ENRICHMENT-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/AI-ENRICHMENT-PLAYBOOK.md) - scenario-based guidance for enrichment modes, bounded AI review, and operator workflows
- [`ASSET-UPDATE-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/ASSET-UPDATE-PLAYBOOK.md) - report-only, due-only, and apply-safe refresh/update workflows for installed assets
- [`LOGGING-STRATEGY.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/LOGGING-STRATEGY.md) - current decision and guardrails for CLI output/logging vs a full logging library
- [`RECOMMENDATION-POLICY-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/RECOMMENDATION-POLICY-PLAYBOOK.md) - how to inspect and tweak ranking policy only after recall looks healthy
- [`HOST-SURFACE-AUDIT.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/reference/HOST-SURFACE-AUDIT.md) - checked-in matrix mapping host-facing paths/settings to documented, compatibility, harness-managed, or implementation-detail status
- [`SECURITY.md`](https://github.com/ar27111994/agent-harness/blob/main/SECURITY.md) - vulnerability reporting and supported-version policy
- [`Roadmap.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/reference/Roadmap.md) - gap analysis and long-range direction
- [`IMPLEMENTATION-PLAN.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/reference/IMPLEMENTATION-PLAN.md) - milestone-oriented execution plan
- [`FUTURE-IMPROVEMENTS.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/reference/FUTURE-IMPROVEMENTS.md) - follow-up ideas and architectural extensions
- [`CONTRIBUTING.md`](https://github.com/ar27111994/agent-harness/blob/main/CONTRIBUTING.md) - contribution workflow and hygiene

## Sponsor

[![Patreon](https://img.shields.io/badge/Support-Patreon-FF424D?logo=patreon&logoColor=white)](https://www.patreon.com/cw/ar27111994)
[![Ko-fi](https://img.shields.io/badge/Support-Ko--fi-29ABE0?logo=kofi&logoColor=white)](https://ko-fi.com/ar27111994)
[![Liberapay](https://img.shields.io/badge/Support-Liberapay-F6C915?logo=liberapay&logoColor=black)](https://liberapay.com/ar27111994)
[![Buy Me a Coffee](https://img.shields.io/badge/Support-Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=000000)](https://buymeacoffee.com/ar27111994)
[![thanks.dev](https://img.shields.io/badge/Support-thanks.dev-181717?logo=github&logoColor=white)](https://thanks.dev/d/gh/ar27111994)

## License

MIT
