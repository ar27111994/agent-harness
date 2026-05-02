# agent-harness

`agent-harness` is a Node.js 22+ TypeScript CLI for discovering, curating, staging, activating, and wiring reusable AI-agent assets into developer workspaces.

It is built around one generic command surface and a host-adapter model. The lifecycle stays consistent across hosts, while each adapter owns the host-specific files, settings, and reset behavior required by VS Code / GitHub Copilot, OpenCode, Cursor, Zed, Claude Code, and Pi.

## Table of contents

- [What this project does](#what-this-project-does)
- [Lifecycle model](#lifecycle-model)
- [Supported hosts](#supported-hosts)
- [Quick start](#quick-start)
- [Command reference](#command-reference)
- [Host wire-in details](#host-wire-in-details)
- [Discovery and recommendations](#discovery-and-recommendations)
- [Environment variables](#environment-variables)
- [Generated and managed files](#generated-and-managed-files)
- [Repository structure](#repository-structure)
- [Development and validation](#development-and-validation)
- [Current boundaries](#current-boundaries)
- [Related documentation](#related-documentation)
- [License](#license)

## What this project does

`agent-harness` automates the lifecycle of reusable agent assets:

1. Scans a target workspace to infer demand signals.
2. Loads configured and generated discovery sources.
3. Harvests candidate agent assets from local sources, source packs, documentation sources, package registries, and marketplace references.
4. Mirrors selected assets into reproducible local artifacts.
5. Installs mirrored assets into lifecycle-host package stores.
6. Activates ranked assets into host runtime views.
7. Wires the activated assets into a target workspace through a selected host adapter.

The goal is to make high-quality reusable agent context portable across tools without hardcoding one workstation, one operating system, or one AI host.

## Lifecycle model

The project intentionally separates these stages:

| Stage       | Purpose                                                                                             | Typical output                                      |
| ----------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `discover`  | Build demand profiles, source indexes, catalogs, selections, and source-utilization reports.        | `discover/output/`, `discover/catalog.assets.jsonl` |
| `mirror`    | Build mirror plans, bundle locks, raw artifact caches, quarantine data, and audit records.          | `mirror/`                                           |
| `install`   | Stage mirrored packages into lifecycle-host package stores and reconcile generations.               | `install/`                                          |
| `recommend` | Rank assets per recommendation host using policy, demand signals, trust, cost, diversity, and caps. | `state/recommendations.json`                        |
| `activate`  | Materialize active runtime views for lifecycle hosts from installed packages and recommendations.   | `activate/`                                         |
| `wire`      | Apply, preview, or reset host-specific workspace integration.                                       | host-specific files plus wire plans                 |
| `workspace` | Run the end-to-end lifecycle for a selected host and then apply wire-in.                            | full pipeline output                                |

Two host concepts are important:

- **Lifecycle host**: the install/activation package layout used to materialize assets.
- **Recommendation host**: the host-specific policy used for ranking and budgets.

Some adapters intentionally reuse another lifecycle host while keeping their own recommendation host. For example, Cursor reuses the Copilot-compatible lifecycle host but ranks through the `cursor` policy.

## Supported hosts

`agent-harness` currently supports six adapter targets.

| CLI target                  | Aliases                | Lifecycle host   | Recommendation host | Default bundles                                     | Wire style                                                           |
| --------------------------- | ---------------------- | ---------------- | ------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| `vscode` / `copilot-vscode` | `copilot`              | `copilot-vscode` | `copilot-vscode`    | `copilot-core`, `community-stable`, `shared-mcp`    | VS Code user settings plus workspace instructions                    |
| `opencode`                  | `open-code`            | `opencode`       | `opencode`          | `opencode-global`, `community-stable`, `shared-mcp` | project-local `.opencode` overlay and managed links                  |
| `cursor`                    | —                      | `copilot-vscode` | `cursor`            | `copilot-core`, `community-stable`, `shared-mcp`    | project-local Cursor rules and managed assets                        |
| `zed`                       | —                      | `opencode`       | `zed`               | `opencode-global`, `community-stable`, `shared-mcp` | project-local `.rules`, `.zed/settings.json`, and managed assets     |
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

### Install dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

### Optional local environment

Runtime configuration is centralized in `src/config/runtime.ts`. Copy `.env.example` to a local `.env` if you want machine-specific values for yourself, but keep real secrets out of git.

```bash
cp .env.example .env
```

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

`setup doctor` prints each adapter’s lifecycle host, recommendation host, default bundles, advertised capabilities, and preflight diagnostics.

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
```

Equivalent direct CLI examples:

```bash
node ./dist/cli.js discover demand-profile
node ./dist/cli.js discover sources
node ./dist/cli.js discover catalog
node ./dist/cli.js discover select
node ./dist/cli.js discover stats
```

### Recommend

```bash
npm run recommend:report
npm run recommend:evaluate
npm run recommend:update
```

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
```

### Install

```bash
npm run install:bundle
npm run install:reconcile
npm run install:reset
```

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

### Rebuild / operations

```bash
npm run rebuild:clean
npm run rebuild:full
```

`rebuild:full` runs the clean, discovery, mirror, install, reconcile, recommendation, and activation flow from repository state.

## Host wire-in details

All host-specific behavior lives behind `src/host-adapters/`. Generic orchestration lives in `src/workspace.ts`, `src/wire.ts`, `src/pipeline.ts`, `src/install.ts`, `src/activate.ts`, and related lifecycle modules.

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

Supported behavior:

- patches user-scoped VS Code JSONC settings
- writes workspace-local `.github/copilot-instructions.md`
- materializes curated runtime folders under `~/.copilot/agent-harness/`
- writes extension metadata for valid VS Code extension identifiers
- emits native install action guidance for extension assets when possible
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
- The adapter emits extension install guidance; it does not silently install marketplace extensions.

### OpenCode

Adapter implementation:

- `src/host-adapters/opencode.ts`

This adapter is intentionally host-specific because OpenCode consumes project-local overlays and asset-kind directory layouts.

Supported behavior:

- writes `.opencode/context/project-intelligence/agent-harness/`
- creates managed links under `.opencode/<asset-kind>/`
- writes an effective project-local wire plan under the `.opencode` overlay
- projects shared MCP references into the wire plan when available
- updates/removes managed `AGENTS.md` sections
- uses Windows directory junctions on Windows
- avoids global OpenAgentsControl install mutation
- does not require a global OpenCode config directory for project-local apply/reset

Managed project-local locations:

- `.opencode/context/project-intelligence/agent-harness/`
- `.opencode/agents/`
- `.opencode/skills/`
- `.opencode/instructions/`
- `.opencode/workflows/`
- `.opencode/hooks/`
- `.opencode/plugins/`
- `.opencode/mcp-servers/`
- `.opencode/extensions/`
- `.opencode/prompt-packs/`
- `.opencode/reference-packs/`
- `AGENTS.md`

Wire-plan outputs:

- `activate/opencode/wire-preview-opencode.json`
- `.opencode/context/project-intelligence/agent-harness/wire-plan.json`

Current boundaries:

- The adapter links activated assets into the workspace overlay.
- It does not install or modify global OpenCode packages.

### Cursor

Adapter implementation:

- `src/host-adapters/native-wire.ts`
- registered as `cursor` in `src/host-adapters/registry.ts`

Cursor is a project-local native adapter. It reuses the VS Code / Copilot lifecycle host for install and activation but ranks assets through its own `cursor` recommendation policy.

Supported behavior:

- writes `.cursor/rules/agent-harness.mdc`
- materializes selected assets under `.cursor/agent-harness/`
- writes `activate/cursor/wire-preview-cursor.json`
- writes `activate/cursor/wire-plan.json` on apply
- avoids global Cursor profile mutation
- avoids global VS Code profile mutation

Current boundaries:

- Cursor extension/native-install capability is not advertised until Cursor native wire-in can surface structured extension IDs and install actions.
- Extension-like assets are treated as reference material in the project-local managed tree.

### Zed

Adapter implementation:

- `src/host-adapters/native-wire.ts`
- registered as `zed` in `src/host-adapters/registry.ts`

Zed is a project-local native adapter. It reuses the OpenCode-compatible lifecycle host for install and activation but ranks assets through its own `zed` recommendation policy.

Supported behavior:

- updates the project `.rules` file with an agent-harness managed section
- adds an `agent-harness` profile entry to `.zed/settings.json`
- materializes selected assets under `.zed/agent-harness/`
- writes `activate/zed/wire-preview-zed.json`
- writes `activate/zed/wire-plan.json` on apply
- avoids global Zed profile/settings mutation
- avoids global OpenCode profile mutation

Current boundaries:

- The adapter writes project-local context and profile hints.
- Host marketplace/plugin installation remains manual or future adapter-specific work.

### Claude Code

Adapter implementation:

- `src/host-adapters/native-wire.ts`
- registered as `claude-code` in `src/host-adapters/registry.ts`

Claude Code is a project-local native adapter. It reuses the OpenCode-compatible lifecycle host for install and activation but ranks assets through its own `claude-code` recommendation policy.

Supported behavior:

- writes managed project context to `CLAUDE.md`
- writes managed local Claude context to `.claude/CLAUDE.md`
- writes `.claude/rules/agent-harness.md`
- writes `.claude/skills/agent-harness/SKILL.md`
- writes `.claude/commands/agent-harness.md`
- materializes selected assets under `.claude/agent-harness/`
- writes `activate/claude-code/wire-preview-claude-code.json`
- writes `activate/claude-code/wire-plan.json` on apply
- avoids global Claude Code profile mutation

Current boundaries:

- MCP and reference assets are staged as project-readable references.
- The adapter does not synthesize full Claude Code MCP server config without structured server metadata.

### Pi

Adapter implementation:

- `src/host-adapters/native-wire.ts`
- registered as `pi` in `src/host-adapters/registry.ts`

Pi is a project-local native adapter. It reuses the OpenCode-compatible lifecycle host for install and activation but ranks assets through its own `pi` recommendation policy.

Supported behavior:

- writes managed project agent context to `AGENTS.md`
- writes managed project system context to `SYSTEM.md`
- writes `.pi/skills/agent-harness/SKILL.md`
- writes `.pi/prompts/agent-harness.md`
- updates `.pi/settings.json` with skill and prompt resource entries
- materializes selected assets under `.pi/agent-harness/`
- writes `activate/pi/wire-preview-pi.json`
- writes `activate/pi/wire-plan.json` on apply
- avoids global Pi profile mutation

Current boundaries:

- Pi does not include `shared-mcp` in its default bundles.
- MCP assets are staged as references unless your Pi installation includes a compatible MCP extension.

### Native adapter wire-plan fields

Native project-local adapters emit effective wire plans with materialized paths. Depending on selected assets, plans can include:

- `instructionsFiles`
- `agentFiles`
- `skillDirs`
- `pluginDirs`
- `workflowFiles`
- `referenceFiles`
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

### Dependency-evidence package discovery

Package registry discovery is driven by dependency evidence extracted from manifests such as:

- `package.json`
- `requirements.txt`
- `pyproject.toml`

The discovery pipeline emits package dependency signals like `npm:<package>` and `pypi:<package>` only from dependency evidence. It filters requirement directives, direct references, VCS URLs, local paths, and non-package strings before querying package registries.

For `pyproject.toml`, dependency extraction is intentionally scoped to project dependency sections, such as `[project].dependencies` and `[project.optional-dependencies]`, rather than build-system requirements.

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
- `validate:recommendations` evaluates golden recommendation fixtures.

## Environment variables

See `.env.example` for documented defaults.

### GitHub authentication

Optional GitHub tokens improve API throughput during discovery:

```bash
GITHUB_PERSONAL_ACCESS_TOKEN=
# GITHUB_TOKEN=
```

PowerShell example:

```powershell
$env:GITHUB_PERSONAL_ACCESS_TOKEN = '<token>'
$env:GITHUB_TOKEN = $env:GITHUB_PERSONAL_ACCESS_TOKEN
```

### GitHub API and retries

```bash
GITHUB_API_VERSION=2022-11-28
AGENT_HARNESS_GITHUB_FETCH_RETRIES=3
```

### Batch sizes

```bash
AGENT_HARNESS_REMOTE_BATCH_SIZE=15
AGENT_HARNESS_MIRROR_BATCH_SIZE=120
AGENT_HARNESS_INSTALL_BATCH_SIZE=250
```

### Scan budgets

```bash
AGENT_HARNESS_SCAN_MAX_DEPTH=14
AGENT_HARNESS_SCAN_MAX_FILES=20000
AGENT_HARNESS_SCAN_MAX_BYTES=50000000
```

### Optional platform path overrides

Most users should leave these unset:

```bash
# XDG_CONFIG_HOME=
# APPDATA=
```

## Generated and managed files

The following directories and files are generated by the lifecycle and are ignored by git:

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
│   │   └── discovery/
│   ├── host-adapters/
│   │   ├── native-wire.ts
│   │   ├── opencode.ts
│   │   ├── registry.ts
│   │   ├── vscode-settings.ts
│   │   └── vscode.ts
│   ├── lib/
│   ├── tests/
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
npm run quality:detection
npm run quality:policy
npm run benchmark:scan
npm run validate:recommendations
```

The CI quality workflow runs on Ubuntu, macOS, and Windows. It validates linting, formatting, types, tests, scan budgets, detection quality, policy coverage, CLI smoke checks, and recommendation fixtures.

## Current boundaries

The project intentionally favors explicit host semantics over pretending every host behaves the same.

Known boundaries:

- VS Code extension assets are represented with metadata and install guidance; the harness does not silently install marketplace extensions.
- Cursor currently does not advertise extension/native-install capability because the native Cursor wire plan does not yet surface structured extension IDs or install actions.
- OpenCode wire-in is project-local and does not mutate global OpenCode packages.
- Claude Code and Pi MCP configuration is not synthesized without structured server metadata.
- Pi stages MCP references only by default and does not include `shared-mcp` in its default bundles.
- Large modules are improved but not fully decomposed; continued package extraction and file-size reduction are future work.

## Related documentation

- `CHANGELOG.md` — release notes
- `Roadmap.md` — gap analysis and long-range direction
- `IMPLEMENTATION-PLAN.md` — milestone-oriented execution plan
- `FUTURE-IMPROVEMENTS.md` — follow-up ideas and architectural extensions
- `CONTRIBUTING.md` — contribution workflow and hygiene

## License

MIT
