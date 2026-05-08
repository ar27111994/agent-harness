# agent-harness

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node >=22](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](./package.json)
[![Quality](https://github.com/ar27111994/agent-harness/actions/workflows/quality.yml/badge.svg)](https://github.com/ar27111994/agent-harness/actions/workflows/quality.yml)
[![Latest Release](https://img.shields.io/github/v/release/ar27111994/agent-harness?display_name=tag)](https://github.com/ar27111994/agent-harness/releases)
[![npm version](https://img.shields.io/npm/v/%40ar27111994%2Fagent-harness?logo=npm&color=CB3837)](https://www.npmjs.com/package/@ar27111994/agent-harness)
[![npm downloads](https://img.shields.io/npm/dm/%40ar27111994%2Fagent-harness?logo=npm&color=CB3837)](https://www.npmjs.com/package/@ar27111994/agent-harness)
[![Sponsor](https://img.shields.io/badge/Sponsor-support-ff69b4?logo=githubsponsors&logoColor=white)](#sponsor)

`agent-harness` is a Node.js 22+ TypeScript CLI, published as `@ar27111994/agent-harness`, for discovering, curating, staging, activating, and wiring reusable AI-agent assets into developer workspaces.

It is built around one generic command surface and a host-adapter model. The lifecycle stays consistent across hosts, while each adapter owns the host-specific files, settings, and reset behavior required by VS Code / GitHub Copilot, OpenCode, Cursor, Zed, Claude Code, and Pi.

## Table of contents

- [What this project does](#what-this-project-does)
- [Lifecycle model](#lifecycle-model)
- [Supported hosts](#supported-hosts)
- [Quick start](#quick-start)
- [Usage examples](#usage-examples)
- [Agent setup playbook](./AGENT-SETUP-PLAYBOOK.md)
- [Command reference](#command-reference)
- [Host wire-in details](#host-wire-in-details)
- [Discovery and recommendations](#discovery-and-recommendations)
- [Environment variables](#environment-variables)
- [Generated and managed files](#generated-and-managed-files)
- [Repository structure](#repository-structure)
- [Development and validation](#development-and-validation)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Current boundaries](#current-boundaries)
- [Related documentation](#related-documentation)
- [Sponsor](#sponsor)
- [License](#license)

## What this project does

`agent-harness` automates the lifecycle of reusable agent assets:

1. Scans a target workspace to infer demand signals.
2. Loads configured and generated discovery sources.
3. Harvests candidate agent assets from local sources, source packs, documentation sources, package registries, and marketplace references.
4. Mirrors selected assets into reproducible local artifacts.
5. Installs mirrored assets into lifecycle-host package stores.
6. Executes explicit host-native install/verify/remove operations where an adapter supports them.
7. Recomputes ranked recommendations from selected catalog entries.
8. Activates ranked assets into host runtime views.
9. Wires the activated assets into a target workspace through a selected host adapter.

The goal is to make high-quality reusable agent context portable across tools without hardcoding one workstation, one operating system, or one AI host.

## Lifecycle model

The project intentionally separates these stages:

| Stage       | Purpose                                                                                              | Typical output                                      |
| ----------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `discover`  | Build demand profiles, source indexes, catalogs, selections, and source-utilization reports.         | `discover/output/`, `discover/catalog.assets.jsonl` |
| `mirror`    | Build mirror plans, bundle locks, raw artifact caches, quarantine data, and audit records.           | `mirror/`                                           |
| `install`   | Stage mirrored packages, reconcile generations, and explicitly run supported host-native installers. | `install/`, `state/install/`                        |
| `recommend` | Rank assets per recommendation host using policy, demand signals, trust, cost, diversity, and caps.  | `state/recommendations.json`                        |
| `activate`  | Materialize active runtime views for lifecycle hosts from installed packages and recommendations.    | `activate/`                                         |
| `wire`      | Preview by default, or explicitly apply/reset host-specific workspace integration.                   | host-specific files plus wire plans                 |
| `workspace` | Run the end-to-end lifecycle for a selected host and then apply wire-in.                             | full pipeline output                                |

Two host concepts are important:

- **Lifecycle host**: the install/activation package layout used to materialize assets.
- **Recommendation host**: the host-specific policy used for ranking and budgets.

Some adapters intentionally reuse another lifecycle host while keeping their own recommendation host. For example, Cursor reuses the Copilot-compatible lifecycle host but ranks through the `cursor` policy.

`wire <host>` is intentionally non-mutating unless you pass `--apply` or `--reset`; use the default preview mode to inspect target paths and planned writes before changing host files.

## Supported hosts

`agent-harness` currently supports six adapter targets.

| CLI target                  | Aliases                | Lifecycle host   | Recommendation host | Default bundles                                     | Wire style                                                           |
| --------------------------- | ---------------------- | ---------------- | ------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| `vscode` / `copilot-vscode` | `copilot`              | `copilot-vscode` | `copilot-vscode`    | `copilot-core`, `community-stable`, `shared-mcp`    | VS Code user settings plus workspace instructions                    |
| `opencode`                  | `open-code`            | `opencode`       | `opencode`          | `opencode-global`, `community-stable`, `shared-mcp` | project-local `.opencode` overlay and managed links                  |
| `cursor`                    | -                      | `copilot-vscode` | `cursor`            | `copilot-core`, `community-stable`, `shared-mcp`    | project-local Cursor rules and managed assets                        |
| `zed`                       | -                      | `opencode`       | `zed`               | `opencode-global`, `community-stable`, `shared-mcp` | project-local `.rules`, `.zed/settings.json`, and managed assets     |
| `claude-code`               | `claude`, `claudecode` | `opencode`       | `claude-code`       | `opencode-global`, `community-stable`, `shared-mcp` | project-local Claude context, rules, skills, and commands            |
| `pi`                        | `pi-coding-agent`      | `opencode`       | `pi`                | `opencode-global`, `community-stable`               | project-local Pi agent/system context, skills, prompts, and settings |

Use `setup hosts` to print the registered adapters from the local build:

```bash
agent-harness setup hosts
```

## Quick start

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
```

`setup doctor` prints each adapter's lifecycle host, recommendation host, default bundles, runtime executable, advertised capabilities, lifecycle preflight diagnostics, adapter-specific CLI readiness diagnostics, and activated asset prerequisite guidance. Missing optional host CLIs are reported as warnings unless the selected operation requires a writable host-native path or native installer runtime.

### Run a full workspace pipeline

From the target workspace directory, run one of:

```bash
agent-harness workspace vscode --intent frontend
agent-harness workspace opencode --intent backend
agent-harness workspace cursor --intent frontend
agent-harness workspace zed --intent docs
agent-harness workspace claude-code --intent backend
agent-harness workspace pi --intent docs
```

From this repository, equivalent npm scripts are available:

```bash
npm run workspace:vscode -- --intent frontend
npm run workspace:opencode -- --intent backend
npm run workspace:cursor -- --intent frontend
npm run workspace:zed -- --intent docs
npm run workspace:claude-code -- --intent backend
npm run workspace:pi -- --intent docs
```

The legacy package binaries `agent-harness-vscode` and `agent-harness-opencode` were removed. Use the single adapter-driven `agent-harness workspace <host>` command instead.

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

For the full playbook, reusable prompts, classification rules, and decision tree, see [`AGENT-SETUP-PLAYBOOK.md`](./AGENT-SETUP-PLAYBOOK.md).

Short version:

- run `agent-harness setup doctor --host <host>` first
- inspect workspace evidence such as `discover/output/demand-profile.json`, `discover/output/selection-report.json`, and `state/recommendations.json`
- run `agent-harness wire <host> --preview` before any apply
- separate staged/wired assets from native installs and manual runtime follow-up
- only run mutating install/apply commands after the dry run looks correct

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
```

Cursor reuses the Copilot-compatible lifecycle host but applies Cursor-specific recommendation policy, project-local `.cursor` rules, prompt-pack command coverage, MCP references, and managed Cursor plugin-compatible assets.

### Inspect why an asset was recommended

```bash
node ./dist/cli.js recommend explain --host claude-code --asset <asset-id>
```

Use this to inspect scoring reasons, matched demand signals, coverage tags, and score breakdowns.

### Print the effective policy for one host

```bash
node ./dist/cli.js recommend policy:print --host pi
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
npm run discover:catalog
npm run discover:select
npm run discover:stats
npm run discover:enrich
```

Equivalent direct CLI examples:

```bash
node ./dist/cli.js discover demand-profile
node ./dist/cli.js discover sources
node ./dist/cli.js discover catalog
node ./dist/cli.js discover select
node ./dist/cli.js discover stats
node ./dist/cli.js discover enrich
```

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

AI-assisted enrichment is optional and disabled by default. When configured, it writes a bounded summary to `discover/output/ai-enrichment.json` using an OpenAI-compatible chat-completions endpoint. Loopback, private-network, and non-public origins are still rejected before any API key is sent. By default the runtime allows a built-in set of public provider origins, automatically allows the configured endpoint origin when it is valid `https`, and can be extended with `AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS` for compatible gateways or proxies.

```bash
AGENT_HARNESS_AI_ENRICHMENT_URL=https://api.openai.com/v1/chat/completions
AGENT_HARNESS_AI_ENRICHMENT_API_KEY=<token>
AGENT_HARNESS_AI_ENRICHMENT_MODEL=gpt-4o-mini
# Optional comma-separated extra allowlist entries for compatible public gateways.
AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS=https://gateway.example.com
agent-harness discover enrich
```

Use `setup login --provider ai` for configuration guidance.

### Recommend

```bash
npm run recommend:report
node ./dist/cli.js recommend
npm run recommend:evaluate
npm run recommend:update
```

Omitting the recommendation subcommand defaults to `report`.
`recommend evaluate` now ends with an aggregate summary so you can spot whether a fixture suite is being carried by exact-stack wins, weak-only generic matches, or broad fallback behavior.

Explain a specific recommendation:

```bash
node ./dist/cli.js recommend explain --host copilot-vscode --asset <asset-id>
```

Print the merged effective policy for a host:

```bash
node ./dist/cli.js recommend policy:print --host shared
```

### Mirror

```bash
npm run mirror:plan
npm run mirror:locks
npm run mirror:acquire
node ./dist/cli.js mirror diff
node ./dist/cli.js mirror explain --asset <asset-id>
```

### Quarantine review

```bash
agent-harness quarantine list
agent-harness quarantine inspect --asset <asset-id>
agent-harness quarantine approve --asset <asset-id> --reason "reviewed source and content"
agent-harness quarantine reject --asset <asset-id> --reason "unsafe prompt or executable behavior"
```

Mirror acquisition routes high-risk or prompt-injection-like community assets into quarantine. Install and activation skip quarantined assets until an explicit review approves them as `approved-with-warning`.

### Install

```bash
npm run install:bundle
node ./dist/cli.js install native --host vscode
node ./dist/cli.js install native --host vscode --operation verify
node ./dist/cli.js install native --host vscode --operation install --apply
node ./dist/cli.js install native --host vscode --operation remove --apply
node ./dist/cli.js install native --host cursor
node ./dist/cli.js install native --host cursor --operation verify
npm run install:reconcile
npm run install:reset
```

`install native` plans by default. Mutating install/remove operations require `--apply`; verify is non-mutating. VS Code and Cursor extension assets are installed through adapter-owned VS Code-style extension providers and results are written to `state/install/native-extensions.json`.

### Activate

```bash
npm run activate:host
npm run activate:reset
node ./dist/cli.js activate rollback --host opencode --generation <generation-id>
```

You can bias activation ordering with `--intent`:

```bash
node ./dist/cli.js activate host --intent frontend
node ./dist/cli.js activate host --intent security
node ./dist/cli.js activate host --intent docs
```

You can also activate one lifecycle host using another recommendation policy:

```bash
node ./dist/cli.js activate host --host copilot-vscode --recommendation-host cursor
```

`--recommendation-host` is validated against the supported host set.

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
```

Repository scripts apply the corresponding wire-in:

```bash
npm run wire:vscode
npm run wire:opencode
npm run wire:cursor
npm run wire:zed
npm run wire:claude-code
npm run wire:pi
```

### Workspace

Workspace commands run discover, mirror, install, activate, and wire-in for the selected adapter:

```bash
agent-harness workspace vscode --intent frontend
agent-harness workspace opencode --intent backend
agent-harness workspace cursor --intent frontend
agent-harness workspace zed --intent docs
agent-harness workspace claude-code --intent backend
agent-harness workspace pi --intent docs
```

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

`rebuild:full` runs the clean, discovery, mirror, install, reconcile, recommendation, and activation flow from repository state.

## Host wire-in details

All host-specific behavior lives behind `src/host-adapters/`. Generic orchestration lives in `src/workspace.ts`, `src/wire.ts`, `src/pipeline.ts`, `src/install.ts`, `src/activate.ts`, and related lifecycle modules.

For the checked-in host-surface classification backing the current README wording, see [`HOST-SURFACE-AUDIT.md`](./HOST-SURFACE-AUDIT.md).

Preview, apply, and reset semantics are consistent across adapters:

- **Preview** writes a wire preview manifest without applying workspace mutations.
- **Apply** writes host-specific project files/settings and an effective wire plan.
- **Reset** removes managed outputs created by the adapter.

Most adapter previews use `activate/<host>/wire-preview-<host>.json`. VS Code uses its lifecycle root: `activate/copilot-vscode/wire-preview-vscode.json`.

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

Current boundaries:

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

Documented OpenCode-native surfaces that this adapter uses or stays compatible with:

- `AGENTS.md`
- `.opencode/agents/`
- `.opencode/skills/`
- `.opencode/commands/`
- `.opencode/plugins/`

Agent-harness-managed overlay/reference locations:

- `.opencode/context/project-intelligence/agent-harness/`
- harness-managed `.opencode/` link targets such as `instructions/`, `hooks/`, `mcp-servers/`, `extensions/`, and `reference-packs/`
- `AGENTS.md` managed sections

Wire-plan outputs:

- `activate/opencode/wire-preview-opencode.json`
- `.opencode/context/project-intelligence/agent-harness/wire-plan.json`

Current boundaries:

- The adapter links activated assets into a project-local overlay and reference tree.
- It does not claim that every harness-managed `.opencode/*` path is a documented native OpenCode auto-discovery surface.
- Although `opencode.json` `mcp` is a documented OpenCode-native surface, the adapter does not synthesize host-native MCP server config there yet because current asset metadata only carries MCP asset identity/reference content, not a normalized per-host server config payload.
- It does not install or modify global OpenCode packages, `opencode.json`, or global MCP configuration.

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
- compatible plugin bundle format via `.cursor-plugin/plugin.json`

Agent-harness staged/plugin-compatible surfaces:

- `.cursor/agent-harness/`
- `.cursor/agent-harness/cursor-plugin/`
- staged plugin `agents/`, `skills/`, `rules/`, `commands/`, and references

Current boundaries:

- Cursor native extension installation is explicit through `install native --host cursor --operation <verify|install|remove>` and depends on a compatible `cursor` CLI.
- `.cursor/agent-harness/cursor-plugin/` is treated as a staged plugin bundle, not as a documented project-native auto-discovery location by itself.
- Registering plugin paths remains host/user-managed.
- `.cursor/mcp.json` is a documented Cursor-native surface, but the adapter does not synthesize it yet because MCP assets are currently carried as references/IDs rather than normalized host-native server config entries.
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

Current boundaries:

- The adapter writes project-local context and profile hints.
- `.zed/agent-harness/` is a managed reference tree, not a claim that every staged asset kind is a documented Zed-native directory.
- Zed's documented MCP/context-server settings live in `.zed/settings.json`, but the adapter does not synthesize full `context_servers` entries yet because MCP assets do not currently carry a normalized host-native server config payload.
- Zed extension installation remains manual through Zed's Extension Gallery or `auto_install_extensions`; extension assets are wired as managed project references rather than installed automatically.

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

Current boundaries:

- MCP and reference assets are staged as project-readable references.
- The adapter does not synthesize full Claude Code MCP server config or executable hook/plugin settings without structured server or executable configuration metadata.

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

Current boundaries:

- Pi does not include `shared-mcp` in its default bundles.
- `.pi/agent-harness/` remains a harness-managed reference tree for non-native assets.
- MCP, extension, hook, and plugin assets are wired as managed references unless your Pi installation includes compatible executable support.

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
- `nativeInstallActions`

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

Generated outputs include:

- `discover/output/demand-profile.json`
- `discover/output/source-index.json`
- `discover/output/source-utilization.json`
- `discover/catalog.assets.jsonl`
- selected/rejected JSONL outputs

### Source utilization

`discover/output/source-utilization.json` separates configured sources from operationally harvested sources so you can see whether broad source declarations are producing usable catalog entries.

The checked-in default source registry intentionally mixes several source classes instead of relying on one curated repo. Out of the box it includes official docs and repos (for example GitHub Copilot docs, the `github/awesome-copilot` repo, and the `awesome-copilot.github.com` site), host-native marketplaces/registries (for example the VS Code Marketplace, Zed extension gallery, Pi packages, npm, and PyPI), and lighter-weight community registries such as `skills.sh` and ClawHub. That split keeps official sources preferred while still surfacing broader community references for real workspaces.

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
- `discover/schema/recommendation-policy-base.schema.json`
- `discover/schema/recommendation-host-policy-override.schema.json`

`base.json` holds global scoring, keyword maps, optional host defaults, and reusable presets. Each host file holds host-specific overrides. At runtime the loader composes these files into the effective recommendation policy.

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

### Optional AI enrichment

```bash
AGENT_HARNESS_AI_ENRICHMENT_URL=
AGENT_HARNESS_AI_ENRICHMENT_API_KEY=
AGENT_HARNESS_AI_ENRICHMENT_MODEL=gpt-4o-mini
# Optional comma-separated extra https origins for compatible public gateways.
AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS=
AGENT_HARNESS_AI_ENRICHMENT_TIMEOUT_MS=20000
AGENT_HARNESS_AI_ENRICHMENT_MAX_RESPONSE_BYTES=1000000
```

`AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS` extends the built-in public-provider allowlist. The configured enrichment endpoint origin is also auto-allowed when it is a valid public `https` origin, and DNS/public-IP checks still run before any request is sent.

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
AGENT_HARNESS_NPM_SEARCH_RESULT_LIMIT=12
AGENT_HARNESS_NPM_MCP_SEARCH_QUERY_LIMIT=8
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

The following directories and files are generated by the lifecycle and are ignored by git. In packaged CLI usage these paths live under the configured state root, which defaults to workspace-local `.agent-harness/`:

- `.agent-harness/`
- `discover/output/`
- `discover/catalog.assets.jsonl`
- `mirror/audit/`
- `mirror/bundles/`
- `mirror/index.jsonl`
- `mirror/quarantine/`
- `mirror/raw/`
- `install/`
- `activate/`
- `state/`
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

```text
agent-harness/
├── .github/
│   └── workflows/
├── discover/
│   ├── recommendation-policy/
│   ├── schema/
│   ├── source-packs/
│   ├── output/
│   ├── sources.json
│   └── selections.json
├── mirror/
│   ├── audit/
│   ├── bundles/
│   ├── quarantine/
│   ├── raw/
│   ├── schema/
│   └── policy.json
├── src/
│   ├── config/
│   ├── domains/
│   │   ├── discovery/
│   │   └── wire/
│   ├── host-adapters/
│   │   ├── native-wire.ts
│   │   ├── opencode.ts
│   │   ├── registry.ts
│   │   ├── vscode-settings.ts
│   │   └── vscode.ts
│   ├── install/
│   ├── lib/
│   ├── manifest-validation/
│   ├── tests/
│   ├── types/
│   ├── activate.ts
│   ├── cli.ts
│   ├── discover.ts
│   ├── install.ts
│   ├── mirror.ts
│   ├── pipeline.ts
│   ├── recommend.ts
│   ├── setup.ts
│   ├── wire.ts
│   └── workspace.ts
├── .npmignore
├── CHANGELOG.md
├── IMPLEMENTATION-PLAN.md
├── Roadmap.md
├── package.json
└── tsconfig.json
```

## Development and validation

Before pushing changes, run at least:

```bash
npm run validate
npm run build
npm test
```

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

The CI quality workflow runs on Ubuntu, macOS, and Windows. It validates linting, formatting, types, tests, scan budgets, detection quality, policy coverage, isolated CLI smoke checks, packed artifact smoke checks, and recommendation fixtures. The release workflow additionally runs production dependency audit and npm publish dry-run checks before tagged publication.

## Troubleshooting

### `agent-harness` command is not found

Build first and run through the local `dist` entrypoint, or use npm scripts from this repository:

```bash
npm run build
node ./dist/cli.js setup hosts
npm run workspace:vscode -- --intent frontend
```

The only package binary is now `agent-harness`; host-specific binaries such as `agent-harness-vscode` and `agent-harness-opencode` are intentionally removed.

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

Use this dry-run decision tree before changing policy or applying installs:

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

### Why is there one `agent-harness workspace <host>` command instead of separate binaries?

A single adapter-driven command keeps CLI behavior consistent across hosts. Host-specific behavior still exists, but it lives behind the adapter registry instead of separate wrapper entrypoints.

### Why are there VS Code and OpenCode-specific files in `src/host-adapters/`?

Those files are intentional adapter implementations. Generic orchestration belongs in lifecycle modules; host-specific settings, file layouts, and reset behavior belong in host adapters.

### Can a new adapter have its own custom behavior?

Yes. Add a new implementation under `src/host-adapters/`, register it in `src/host-adapters/registry.ts`, and keep generic lifecycle orchestration unchanged.

### Does `agent-harness` install VS Code extensions automatically?

No. VS Code extension assets can produce metadata and install guidance, but the harness does not silently install marketplace extensions.

### Should I increase selection count when recommendations look wrong?

Usually no. First confirm that demand detection found the real workspace technologies, then inspect whether relevant assets already exist in the selected set. If they do, the problem is more likely ranking, host policy, or source weighting than selection breadth. Increase selection count only when the current selection genuinely omits relevant candidates.

### Why do Cursor, Zed, Claude Code, and Pi reuse lifecycle hosts?

They can reuse compatible install and activation package layouts while keeping independent recommendation policies and native project-local wire behavior.

### Which generated files should I commit in my own project?

That depends on your project policy. Project-local files such as `.cursor/rules/agent-harness.mdc`, `.rules`, `CLAUDE.md`, `AGENTS.md`, or `SYSTEM.md` can be useful to commit if your team wants shared host behavior. Review generated content before committing it.

### Is OpenCode global configuration required?

No. The OpenCode adapter writes a project-local `.opencode` overlay and does not require a global OpenCode config directory for apply/reset flows.

### How do I know what was wired?

Inspect the effective wire plan. Depending on host, it is written under `activate/<host>/wire-plan.json` or inside the host-local overlay, such as `.opencode/context/project-intelligence/agent-harness/wire-plan.json`.

## Current boundaries

The project intentionally favors explicit host semantics over pretending every host behaves the same.

Known boundaries:

- VS Code extension assets are represented with metadata and install guidance; the harness does not silently install marketplace extensions.
- Cursor native extension installation is explicit and requires a compatible `cursor` CLI with VS Code-style extension commands.
- OpenCode wire-in is project-local and does not mutate global OpenCode packages.
- Claude Code and Pi MCP configuration is not synthesized without structured server metadata.
- Pi stages MCP references only by default and does not include `shared-mcp` in its default bundles.
- Quarantine review commands are intentionally conservative and audit-log based; richer interactive review UIs and policy-specific prompt-injection classifiers remain future enhancements.
- Large modules are improved but not fully decomposed; continued package extraction and file-size reduction are future work.

## Related documentation

- `CHANGELOG.md` - release notes
- `AGENT-SETUP-PLAYBOOK.md` - dry-run setup workflow, decision tree, and reusable agent prompts for workspace/host asset setup
- `HOST-SURFACE-AUDIT.md` - checked-in matrix mapping host-facing paths/settings to documented, compatibility, harness-managed, or implementation-detail status
- `SECURITY.md` - vulnerability reporting and supported-version policy
- `Roadmap.md` - gap analysis and long-range direction
- `IMPLEMENTATION-PLAN.md` - milestone-oriented execution plan
- `FUTURE-IMPROVEMENTS.md` - follow-up ideas and architectural extensions
- `CONTRIBUTING.md` - contribution workflow and hygiene

## Sponsor

[![Patreon](https://img.shields.io/badge/Support-Patreon-FF424D?logo=patreon&logoColor=white)](https://www.patreon.com/cw/ar27111994)
[![Ko-fi](https://img.shields.io/badge/Support-Ko--fi-29ABE0?logo=kofi&logoColor=white)](https://ko-fi.com/ar27111994)
[![Liberapay](https://img.shields.io/badge/Support-Liberapay-F6C915?logo=liberapay&logoColor=black)](https://liberapay.com/ar27111994)
[![Buy Me a Coffee](https://img.shields.io/badge/Support-Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=000000)](https://buymeacoffee.com/ar27111994)
[![thanks.dev](https://img.shields.io/badge/Support-thanks.dev-181717?logo=github&logoColor=white)](https://thanks.dev/d/gh/ar27111994)

## License

MIT
