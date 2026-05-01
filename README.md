# agent-harness

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node >=22](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](./package.json)
[![Latest Release](https://img.shields.io/github/v/release/ar27111994/agent-harness?display_name=tag)](https://github.com/ar27111994/agent-harness/releases)

`agent-harness` is a dynamic, authority-aware asset supply chain for:

- OpenCode
- GitHub Copilot in VS Code

It keeps agent tooling curated, reproducible, and context-efficient by treating agent assets as a lifecycle instead of a one-step install.

## At a glance

- prefers official sources over stars and popularity
- keeps discovery, mirroring, installation, and activation separate
- narrows activation to stay within practical context budgets
- supports local assets, official indexes, repo-backed skills, docs, and shared MCP assets
- generates host-specific runtime views for OpenCode and GitHub Copilot

## Why this exists

Modern agent ecosystems expose a large number of skills, plugins, MCP servers, instructions, workflows, and agent definitions. Blindly installing everything creates three persistent problems:

- low-quality or duplicate sources pollute the runtime
- global activation exhausts context windows
- there is no deterministic path from discovery to active runtime state

`agent-harness` solves this by treating agent assets like a supply chain.

## Lifecycle model

The project separates asset handling into four explicit phases:

1. **Discover** — detect workspace signals, harvest metadata, classify assets, and select canonical candidates
2. **Mirror** — create pinned, inert local artifacts and bundle locks
3. **Install** — project mirrored artifacts into host-specific staged package stores
4. **Activate** — materialize smaller runtime views from installed generations

## Core principles

- **Official sources outrank stars**
- **Community sources remain catalog-only unless promoted**
- **Discover, mirror, install, and activate stay separate**
- **Mirror and install are deterministic and pinned**
- **Activation should be narrower than installation**
- **Recommendations should be evidence-driven, not brittle hardcoding**

## Architecture

### 1. Discover

Discovery finds candidate assets from:

- current workspace signals
- local generated sources
- official remote repositories and docs
- package registries such as npm and PyPI
- trusted community sources
- official skill indexes

Discovery outputs include:

- demand profile
- source index
- unified asset catalog
- selected catalog
- rejected catalog
- selection report
- recommendation report

### 2. Mirror

Mirror converts selected candidates into pinned, inert local references.

Mirror outputs include:

- mirror plan
- bundle locks
- raw mirrored artifacts
- mirror index
- mirror acquire state
- quarantine routing for risky assets

### 3. Install

Install projects mirrored assets into staged, host-specific package stores.

Install outputs include:

- staged packages for OpenCode
- staged packages for Copilot VS Code
- shared MCP install state
- bundle install manifests
- install progress state
- deterministic install generations

### 4. Activate

Activation materializes runtime views from installed generations.

Activation outputs include:

- OpenCode activation view
- Copilot activation view
- shared runtime activation view
- overlay plans
- generation-aware activation manifests
- Copilot workspace profile manifests

## Quick start

### Requirements

- Node.js 22+
- npm
- optional GitHub token for better GitHub API throughput:
  - `GITHUB_PERSONAL_ACCESS_TOKEN`
  - or `GITHUB_TOKEN`

### Install dependencies

```bash
npm install
```

`npm install` also wires the Husky Git hooks for this checkout. Pre-commit runs
`lint-staged`, which fixes staged TypeScript files with ESLint and Prettier and
formats staged JSON, Markdown, YAML, and `.mjs` files.

### Build

```bash
npm run build
npm run validate
npm test
npm run benchmark:scan
npm run quality:detection
npm run validate:recommendations
```

Runtime configuration is centralized in `src/config/runtime.ts`. Copy `.env.example` to a local `.env` if you want to document machine-specific values for yourself, but keep real secrets out of git. Supported settings include GitHub tokens, batch sizes, and scan budgets.

### Run a full workspace pipeline

From any target workspace:

#### VS Code / GitHub Copilot

```bash
agent-harness-vscode --intent frontend
```

or from this repository:

```bash
npm run workspace:vscode -- --intent frontend
```

#### OpenCode

```bash
agent-harness-opencode --intent backend
```

or from this repository:

```bash
npm run workspace:opencode -- --intent backend
```

#### Generic wrapper form

```bash
agent-harness workspace vscode --intent docs
agent-harness workspace opencode --intent security
agent-harness workspace cursor --intent frontend
agent-harness workspace zed --intent docs
```

VS Code and OpenCode apply native wire-in flows. Cursor and Zed are registered through the host adapter model and currently emit explicit host guidance plans while reusing the nearest compatible lifecycle host.

These wrappers currently execute the full pipeline for the target workspace:

1. demand profile
2. source index
3. catalog generation
4. canonical selection
5. mirror plan
6. mirror locks
7. batched mirror acquisition
8. batched install
9. install reconcile
10. activation
11. host wire-in apply or adapter guidance plan

### Guided setup and host readiness

```bash
agent-harness setup hosts
agent-harness setup doctor
agent-harness setup doctor --host vscode
```

`setup doctor` prints registered host adapters, lifecycle defaults, capability matrices, and runtime diagnostics. This is also where first-time users see guidance for optional GitHub authentication, native extension installation boundaries, shared MCP projection, and host-specific readiness notes.

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
npm run benchmark:scan
npm run quality:detection
npm run smoke:cli
npm run validate:recommendations
```

### Discover

```bash
npm run discover:demand
npm run discover:sources
npm run discover:catalog
npm run discover:select
npm run discover:stats
npm run recommend:report
npm run recommend:evaluate
```

You can also inspect a specific recommendation decision directly:

```bash
node ./dist/cli.js recommend explain --host copilot-vscode --asset microsoft-skills-azure-identity-ts
```

You can also print the fully merged effective recommendation policy:

```bash
node ./dist/cli.js recommend policy:print --host shared
```

The CI quality workflow runs on Ubuntu, macOS, and Windows. It validates linting, formatting, types, unit and link lifecycle tests, scan benchmark budgets, detection quality reporting, CLI smoke checks, and recommendation fixtures so portability, performance, and policy behavior stay pinned as the platform evolves.

### Discovery coverage and source utilization

Demand profiling now uses scan budgets plus modular detector packs for software manifests, documentation-heavy repos, notebooks, datasets, media/design assets, CAD/hardware artifacts, research content, game engines, mobile projects, and ML model artifacts. Catalog generation writes `discover/output/source-utilization.json` to distinguish configured sources from operationally harvested sources by kind.

Package registry discovery is driven by dependency evidence extracted from manifests such as `package.json`, `requirements.txt`, and `pyproject.toml`; generic stack signals no longer synthesize registry package candidates without dependency evidence.

### Recommendation policy layout

Recommendation scoring policy is authored as smaller files instead of one large
JSON blob:

- `discover/recommendation-policy/base.json`
- `discover/recommendation-policy/hosts/copilot-vscode.json`
- `discover/recommendation-policy/hosts/opencode.json`
- `discover/recommendation-policy/hosts/shared.json`
- `discover/schema/recommendation-policy-base.schema.json`
- `discover/schema/recommendation-host-policy-override.schema.json`

`base.json` holds scoring, keyword maps, and optional shared host defaults.
Each host file holds only the host-specific policy override. `base.json` can
also define optional reusable presets for `targetConcerns` and
`targetAssetKinds`, and host files can reference them through `presetRefs`
before applying local override entries. At runtime the loader composes these
files into the same `RecommendationPolicy` shape used by the scorer. The
recommender still accepts the legacy `discover/recommendation-policy.json`
path as a fallback if only the old file exists.

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

### Rebuild / operations

```bash
npm run rebuild:clean
npm run rebuild:full
```

## Host wire-in

### VS Code / GitHub Copilot wire-in

The project supports semi-automatic and automatic VS Code wire-in.

Supported behavior:

- updates **User-scoped** VS Code settings for protected AI path settings
- writes workspace-local `.github/copilot-instructions.md`
- materializes curated user-level runtime folders under `~/.copilot/agent-harness/`
- preserves the VS Code security boundary by avoiding workspace-level mutation of user-only settings

Commands:

```bash
agent-harness wire vscode --preview
agent-harness wire vscode --apply
agent-harness wire vscode --reset
```

Equivalent npm command:

```bash
npm run wire:vscode
```

Patched VS Code user settings can include:

- `chat.pluginLocations`
- `chat.agentSkillsLocations`
- `chat.hookFilesLocations`
- `chat.agentFilesLocations`
- `chat.instructionsFilesLocations`

For skills specifically, the wire-in uses the **parent curated skills folder**:

- `~/.copilot/agent-harness/skills`: `true`

and disables competing global skills roots such as:

- `~/.copilot/skills`
- `~/.agents/skills`
- `~/.claude/skills`
- `~/.config/opencode/skills`

Curated user-level runtime folders include:

- `~/.copilot/agent-harness/instructions`
- `~/.copilot/agent-harness/agents`
- `~/.copilot/agent-harness/skills`
- `~/.copilot/agent-harness/hooks`
- `~/.copilot/agent-harness/plugins`

Workspace-local export:

- `.github/copilot-instructions.md`

### OpenCode wire-in

The project supports semi-automatic project-local OpenCode wire-in.

Supported behavior:

- writes a project-local overlay under `.opencode/context/project-intelligence/agent-harness/`
- creates managed directory links under `.opencode/<asset-kind>/`
- does **not** overwrite the global OpenAgentsControl-managed install
- uses filesystem links instead of text-only workspace instructions
- uses Windows directory junctions when running on Windows for compatibility

Commands:

```bash
agent-harness wire opencode --preview
agent-harness wire opencode --apply
agent-harness wire opencode --reset
```

Equivalent npm command:

```bash
npm run wire:opencode
```

### Automatic wire-in through workspace wrappers

The OpenCode wrappers run wire-in automatically after activation:

```bash
agent-harness-opencode --intent backend
```

or:

```bash
agent-harness workspace opencode --intent security
```

## Common workflows

### Standard full rebuild

```bash
npm run rebuild:full
```

This performs:

1. clean transient state
2. demand profile generation
3. source index generation
4. catalog generation
5. canonical selection
6. mirror planning
7. mirror lock generation
8. batched mirror acquisition
9. batched install
10. install reconcile
11. activation

### Session-intent-aware activation

```bash
node ./dist/cli.js activate host --intent frontend
node ./dist/cli.js activate host --intent security
node ./dist/cli.js activate host --intent docs
```

This biases activation ordering toward assets whose ids and capabilities align with the requested session intent.

The same intent can be used through the one-command wrappers:

```bash
agent-harness-vscode --intent frontend
agent-harness-opencode --intent security
```

### Clean reset only

```bash
npm run rebuild:clean
```

### Install state reset only

```bash
npm run install:reset
```

### Activation reset only

```bash
npm run activate:reset
```

## Environment variables

### GitHub authentication

The GitHub client supports:

- `GITHUB_PERSONAL_ACCESS_TOKEN`
- fallback: `GITHUB_TOKEN`

Example PowerShell usage:

```powershell
$env:GITHUB_TOKEN = $env:GITHUB_PERSONAL_ACCESS_TOKEN
$env:AGENT_HARNESS_REMOTE_BATCH_SIZE = '120'
$env:AGENT_HARNESS_INSTALL_BATCH_SIZE = '250'
npm.cmd run rebuild:full
```

### Batch controls

- `AGENT_HARNESS_REMOTE_BATCH_SIZE`
- `AGENT_HARNESS_INSTALL_BATCH_SIZE`

These control checkpointed mirror acquisition and staged install throughput.

## Source authority model

The harness prefers sources in roughly this order:

1. trusted local generated sources
2. official first-party sources
3. official marketplaces
4. official-compatible sources
5. trusted community sources
6. unverified community sources

The governing rule is:

> If an official vendor source exists, it outranks a more popular unofficial source.

## Dynamic recommendation model

Recommendations are based on live evidence such as:

- current workspace stack signals
- weighted evidence counts from matched files
- host compatibility
- source authority
- trust score
- risk
- context cost
- portfolio fit

Recommendation ranking is now policy-driven from the canonical base policy at
[`discover/recommendation-policy/base.json`](./discover/recommendation-policy/base.json)
with per-host overrides. The legacy single-file
[`discover/recommendation-policy.json`](./discover/recommendation-policy.json)
is supported as a fallback only.
That policy controls:

- scoring weights and penalties
- per-host diversity caps
- per-host source concentration controls
- concern coverage targets
- prompt-weight activation budgets
- suppression rules for obviously irrelevant assets
- host-level deprioritization rules for wrapper or reference assets that should stay available but rank below runnable integrations

The engine persists a richer report in [`state/recommendations.json`](./state/recommendations.json),
including:

- per-asset score breakdowns
- matched demand signals
- source family and duplicate-group metadata
- host summaries with concern and task-mode coverage
- budget-aware suggested bundles

Activation now consumes that report directly instead of applying a second
asset-ID heuristic ranking layer.

Golden fixture evaluation is available through:

```bash
npm run recommend:evaluate
```

That writes [`state/recommendation-evaluation.json`](./state/recommendation-evaluation.json)
and checks five archetypes returned by `buildRecommendationFixtures()`:

- backend integration
- frontend UI
- infrastructure and security
- shared-executable-bias
- shared-source-saturation

Trust scoring currently incorporates:

- source authority tier
- source kind and priority
- publisher verification
- install method
- stars thresholds
- maintenance cadence
- readme/docs/frontmatter presence
- dependency declarations
- risk penalties

## Repository structure

```text
agent-harness/
├── discover/
│   ├── source-packs/
│   ├── schema/
│   ├── output/
│   ├── sources.json
│   ├── selections.json
│   ├── pipeline.json
│   └── official-skills-indexes.json
├── mirror/
│   ├── audit/
│   ├── bundles/
│   ├── quarantine/
│   ├── raw/
│   ├── schema/
│   └── policy.json
├── install/
├── activate/
├── state/
├── src/
├── package.json
├── tsconfig.json
└── IMPLEMENTATION-PLAN.md
```

## Contribution and project hygiene

- start with [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- use the issue templates under [`.github/ISSUE_TEMPLATE/`](./.github/ISSUE_TEMPLATE/)
- use the pull request template at [`.github/pull_request_template.md`](./.github/pull_request_template.md)

## Current refinement boundaries

The lifecycle is implemented end-to-end. The remaining work is refinement rather than missing architecture, for example:

- broader upstream resolution for every official index item
- richer session/workspace-intent-aware activation planning
- more advanced quarantine routing and policy enforcement

## Documentation

For current implementation details and roadmap, see:

- [`IMPLEMENTATION-PLAN.md`](./IMPLEMENTATION-PLAN.md)
- [`FUTURE-IMPROVEMENTS.md`](./FUTURE-IMPROVEMENTS.md)

## License

This project is licensed under the MIT License. See [`LICENSE`](./LICENSE).
