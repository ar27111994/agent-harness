# agent-harness — Implementation Plan

## Purpose

`agent-harness` is a dynamic, authority-aware asset supply chain for:

- OpenCode
- GitHub Copilot in VS Code

It separates the lifecycle of agent assets into four explicit phases:

1. Discover
2. Mirror
3. Install
4. Activate

The main goals are:

- prefer official sources over popularity
- avoid global context bloat
- keep recommendations dynamic and evidence-driven
- support both local generated assets and internet-discovered assets
- share schemas across hosts while keeping final runtime projections host-specific

---

## Core Principles

### Source authority beats stars

If an official vendor source exists, it outranks a more popular community alternative.

Examples:

- `supabase/agent-skills` beats a community Supabase skills repo with more stars
- official GitHub or Microsoft sources beat unofficial Copilot collections

### No install-everything behavior

The system must never collapse discovery, mirroring, installing, and activation into one step.

### Dynamic relevance, not brittle static lists

Stack detection, host-fit scoring, bundle suggestions, and recommended installs should be based on live evidence from:

- current workspace contents
- installed/generated local assets
- source authority
- host compatibility
- token cost
- risk
- portfolio fit

### Community sources are catalog-only unless promoted

Community assets are discoverable and analyzable but should not be treated as canonical unless explicitly promoted.

### Shared schemas, host-specific projections

OpenCode and Copilot share discovery and mirror metadata, but each will get host-specific install and activation outputs later.

---

## Lifecycle Phases

## 1. Discover

### Purpose

Discover candidate assets from local and remote sources, normalize them into a unified catalog, and select canonical candidates.

### Responsibilities

- detect stack and concern signals from the current workspace
- load all configured discovery sources
- harvest metadata from local manifests and local directories
- harvest metadata from official remote repo/doc sources
- classify asset kind and host compatibility
- score and rank candidates using official-over-popularity rules
- generate selected vs rejected catalog views

### Current outputs

- `discover/output/demand-profile.json`
- `discover/output/source-index.json`
- `discover/catalog.assets.jsonl`
- `discover/output/catalog.selected.jsonl`
- `discover/output/catalog.rejected.jsonl`
- `discover/output/selection-report.json`

## 2. Mirror

### Purpose

Convert selected discovery candidates into pinned, inert local references and bundle locks.

### Responsibilities

- plan what should be mirrored
- produce bundle locks for later phases
- later pin exact artifacts, hashes, and provenance
- later quarantine suspicious or oversized assets

### Current outputs

- `mirror/audit/mirror-plan.json`
- `mirror/bundles/opencode-global.lock.json`
- `mirror/bundles/copilot-core.lock.json`
- `mirror/bundles/shared-mcp.lock.json`
- `mirror/bundles/community-stable.lock.json`

## 3. Install _(planned)_

### Purpose

Transform mirrored assets into host-ready staged assets.

### Planned outputs

- OpenCode install packages and bundle manifests
- Copilot install packages and bundle manifests
- shared MCP install packages
- deterministic install generations

## 4. Activate _(planned)_

### Purpose

Expose only the appropriate installed assets at runtime.

### Planned outputs

- OpenCode active harness view
- Copilot core/profile/workspace overlays
- activation manifests and generation switching

---

## Current Project Layout

Current directory contents:

- `discover/`
- `dist/`
- `mirror/`
- `node_modules/`
- `package-lock.json`
- `package.json`
- `src/`
- `state/`
- `tsconfig.json`

### Layout intent

#### `discover/`

Discovery inputs, schemas, and generated outputs.

Contains:

- source registry
- selection policy
- pipeline definition
- schemas
- output files

#### `mirror/`

Mirror policy, schemas, audit data, and bundle locks.

#### `src/`

TypeScript source code for the CLI and pipeline logic.

#### `dist/`

Compiled JS output.

#### `state/`

Local state and cache files, including remote GitHub metadata cache.

---

## Current Implemented Commands

Defined in `package.json`.

### Build and validation

- `npm run build`
- `npm run check`

### Discover

- `npm run discover:demand`
- `npm run discover:sources`
- `npm run discover:catalog`
- `npm run discover:select`
- `npm run discover:stats`

### Mirror

- `npm run mirror:plan`
- `npm run mirror:locks`

---

## Current Implemented Files and Responsibilities

### Root config

#### `package.json`

Defines scripts, Node requirement, TypeScript dependency setup, and CLI entrypoint.

#### `tsconfig.json`

TypeScript config for the Node CLI.

### Discovery config

#### `discover/sources.json`

Canonical source registry.

#### `discover/selections.json`

Canonical selection policy.

#### `discover/pipeline.json`

High-level discovery pipeline definition.

#### `discover/schema/*`

Schemas for source registry, asset catalog entries, and selection registry.

### Mirror config

#### `mirror/policy.json`

Mirror policy and bundle templates.

#### `mirror/schema/*`

Schemas for mirror index entries and bundle lock files.

### Source code

#### `src/cli.ts`

Main CLI dispatcher.

#### `src/files.ts`

Filesystem helpers for JSON, JSONL, and recursive traversal.

#### `src/types.ts`

Shared types for discovery, selection, mirror planning, and bundle locks.

#### `src/discover.ts`

Main discovery engine.

Currently implements:

- demand profile generation
- source index generation
- local manifest harvest
- local directory harvest
- official GitHub metadata harvest
- catalog generation
- canonical selection
- catalog stats and inspection support

#### `src/github.ts`

Official GitHub REST metadata harvesting.

Uses:

- repository metadata endpoint
- recursive git tree endpoint
- README metadata endpoint

Stores cached responses under:

- `state/remote-cache/github/`

#### `src/mirror.ts`

Mirror readiness plan and initial bundle lock generation.

---

## Source Inventory

The discover layer supports multiple source classes.

## Official first-party sources

### Already present or explicitly configured

- official GitHub Copilot docs
- `github/awesome-copilot`
- official VS Code Marketplace
- official Claude Code docs
- official MCP docs
- `supabase/agent-skills`
- local OpenCode/OpenAgentsControl state

### Additional official sources to include

- `anthropics/skills`
- `anthropics/claude-cookbooks`
- `remotion-dev/skills`
- `vercel-labs/agent-skills`
- `openai/skills`
- `microsoft/skills`
- `google-gemini/gemini-skills`
- `apify/agent-skills`
- `expo/skills`
- `huggingface/skills`
- `neondatabase/agent-skills`
- `scopeblind/scopeblind-gateway`
- `flutter/skills`
- `genkit-ai/skills`
- `firebase/skills`
- all remaining official skills referenced from `VoltAgent/awesome-agent-skills`

Important: `VoltAgent/awesome-agent-skills` should be used as a discovery index, not as a reason to bypass canonical official upstreams.

## Trusted local generated sources

### Current local generated sources

- `C:\Users\ar271\.config\opencode`
- `C:\Users\ar271\.config\opencode\context`
- `C:\Users\ar271\.agents\skills`
- `C:\Users\ar271\.agents\skills\.antigravity-install-manifest.json`

These provide strong local evidence but should not override official-source precedence.

## Community contributors to include as discovery inputs

- `pumanitro/global-chat`
- `bitjaru/styleseed`
- `milkomida77/guardian-agent-prompts`
- `Elkidogz/technical-change-skill`
- `rmyndharis/antigravity-skills`
- `amartelr/antigravity-workspace-manager`
- `obra/superpowers`
- `guanyang/antigravity-skills`
- `diet103/claude-code-infrastructure-showcase`
- `ChrisWiles/claude-code-showcase`
- `travisvn/awesome-claude-skills`
- `Dimillian/Skills`
- `zebbern/claude-code-guide`
- `alirezarezvani/claude-skills`
- `karanb192/awesome-claude-skills`
- `VoltAgent/awesome-agent-skills`
- `zircote/.claude`
- `vibeforge1111/vibeship-spawner-skills`
- `coreyhaines31/marketingskills`
- `AgriciDaniel/claude-seo`
- `mrprewsh/seo-aeo-engine`
- `jonathimer/devmarketing-skills`
- `kepano/obsidian-skills`
- `Silverov/yandex-direct-skill`
- `vudovn/antigravity-kit`
- `affaan-m/everything-claude-code`
- `whatiskadudoing/fp-ts-skills`
- `warmskull/idea-darwin`
- `webzler/agentMemory`
- `rafsilva85/credit-optimizer-v5`
- `Wittlesus/cursorrules-pro`
- `nedcodes-ok/rule-porter`
- `SSOJet/skills`
- `MojoAuth/skills`
- `Xquik-dev/x-twitter-scraper`
- `shmlkv/dna-claude-analysis`
- `AlmogBaku/debug-skill`
- `uberSKILLS`
- `christopherlhammer11-ai/tool-use-guardian`
- `christopherlhammer11-ai/recallmax`
- `tsilverberg/webapp-uat`
- `Wolfe-Jam/faf-skills`
- `fullstackcrew-alpha/privacy-mask`
- `AvdLee/SwiftUI-Agent-Skill`
- `CloudAI-X/threejs-skills`
- `K-Dense-AI/claude-scientific-skills`
- `NotMyself/claude-win11-speckit-update-skill`
- `SHADOWPR0/beautiful_prose`
- `SHADOWPR0/security-bluebook-builder`
- `SeanZoR/claude-speed-reader`
- `Shpigford/skills`
- `ZhangHanDong/makepad-skills`
- `czlonkowski/n8n-skills`
- `frmoretto/clarity-gate`
- `gokapso/agent-skills`
- `huifer/WellAlly-health`
- `ibelick/ui-skills`
- `jackjin1997/ClawForge`
- `jthack/ffuf_claude_skill`
- `MetcalfSolutions/Satori`
- `muratcankoylan/Agent-Skills-for-Context-Engineering`
- `robzolkos/skill-rails-upgrade`
- `sanjay3290/ai-skills`
- `scarletkc/vexor`
- `sstklen/infinite-gratitude`
- `wrsmith108/linear-claude-skill`
- `wrsmith108/varlock-claude-skill`
- `zarazhangrui/frontend-slides`
- `zxkane/aws-skills`
- `UrRhb/agentflow`
- `AgentPhone-AI/skills`
- `uxuiprinciples/agent-skills`
- `voidborne-d/humanize-chinese`
- `pbakaus/impeccable`

These should remain catalog-first and promotion-controlled.

---

## Current Discovery Model

### Demand profiling

The CLI scans the current working directory and extracts live signals from files such as:

- `package.json`
- `tsconfig.json`
- `pyproject.toml`
- `Cargo.toml`
- `go.mod`
- Docker files
- Terraform files
- test config files
- OpenAPI/Swagger-related filenames

This produces a demand profile for dynamic relevance scoring.

### Selection ordering

Current ordering is:

1. authority tier
2. compatibility mode
3. portfolio fit
4. risk
5. context cost
6. maintenance recency
7. stars only as tie-breaker

### Dynamic direction

The current system is dynamic, but still partly heuristic.

Still too static:

- path-based asset classification
- bundle inclusion rules
- recommendation scoring
- host-fit heuristics

Target direction:

- evidence-weighted classification
- source-family-aware ranking
- dynamic install recommendations
- token-budget-aware activation recommendations

---

## Current Mirror Model

### What exists now

- mirror readiness planning
- bundle lock generation
- bundle templates for OpenCode, Copilot, shared MCP, and community-stable

### What is planned next

- raw artifact acquisition
- exact provenance pinning
- content hashing
- mirror index generation
- quarantine flow
- replacement of unresolved mirror ids with real pinned mirror ids

---

## Current Status

### Working now

- build succeeds
- discover pipeline runs end-to-end
- mirror pipeline runs end-to-end
- official GitHub repo metadata harvesting works
- local OpenCode harvesting works
- local antigravity-generated harvesting works
- duplicate/self-selection bug was fixed

### Latest generated scale

From the latest run:

- total catalog entries: 1422
- selected entries: 1422
- rejected entries: 0

### Current source counts

- `github-awesome-copilot`: 1161
- `local-antigravity-manifest`: 57
- `local-opencode-config`: 28
- `local-opencode-context`: 172
- `supabase-agent-skills`: 4

### Current host counts

- `copilot-vscode`: 1212
- `shared`: 10
- `opencode`: 260

---

## Current Known Issues

### Antigravity double-counting

`community-stable.lock.json` currently includes both:

- manifest-level entries
- installed generated skill entries

Planned correction:

- installed `.agents/skills/<name>/SKILL.md` becomes the canonical artifact
- `.antigravity-install-manifest.json` remains a provenance/filter source only

### Broken antigravity remote source

The configured `antigravity-awesome-skills` GitHub source currently returns 404.
This needs a corrected upstream URL or removal.

### Dynamic scoring still needs to mature

The system is more dynamic than before, but recommendation quality is still driven by rule-based heuristics in places.

---

## Planned Roadmap

## Phase 1 — finish discover + mirror foundation

- fix antigravity double-counting
- correct broken community repo source
- improve canonicalization inside source families
- improve dynamic recommendation scoring
- add more official remote metadata harvesting sources

## Phase 2 — real mirror acquisition

- mirror raw snapshots ✅
- write mirror index entries ✅
- hash content ✅
- quarantine risky assets ⚠️ basic status handling implemented; dedicated quarantine routing can be expanded
- resolve bundle lock entries to actual mirror ids ✅

## Phase 3 — install system

- host-specific projection engine ✅
- OpenCode staged packages ✅
- Copilot staged packages ✅
- shared MCP install store ✅
- deterministic install generations ✅

## Phase 4 — activation system

- OpenCode active harness generation ✅
- Copilot core/profile/workspace overlays ✅
- token-budget-aware activation ✅
- generation switching and rollback ✅

## Phase 5 — adaptive recommendation intelligence

- stronger stack inference ✅
- better host-fit scoring ✅
- better official/community conflict handling ✅
- demand-driven install and activation recommendations ✅

---

## Working Rules for the Project

1. Official sources outrank stars.
2. Community sources remain catalog-only unless promoted.
3. Discover, mirror, install, and activate remain separate.
4. No runtime activation from raw source mirrors.
5. Mirror and install must be deterministic and pinned.
6. OpenCode and Copilot share schemas, but use host-specific projections later.
7. Relevance should move steadily toward evidence-based scoring rather than brittle hardcoding.

---

## Current Final State

The following are now implemented in code and exercised through the CLI:

1. Discover
   - dynamic source registry + source packs
   - demand profiling
   - local generated source harvesting
   - official GitHub metadata harvesting with PAT support
   - official index harvesting + repo-backed duplicate resolution
   - package-registry harvesting for npm and PyPI metadata
   - canonical selection and rejection reporting

2. Mirror
   - bundle lock generation
   - raw mirror acquisition
   - mirror index generation
   - content hashing
   - checkpoint/resume batching
   - quarantine routing for risky mirrored assets

3. Install
   - staged host-specific package stores
   - bundle install manifests
   - install reconcile
   - deterministic install generations
   - install filtering that skips quarantined mirror entries

4. Activate
   - OpenCode activation views
   - Copilot activation views
   - shared runtime activation views
   - overlay plans
   - generation-aware activation manifests
   - Copilot workspace profile manifests
   - session-intent-aware activation ordering

5. Operational controls
   - install reset
   - activate reset
   - rebuild clean
   - rebuild full
   - activate rollback
   - comprehensive README
   - MIT license

## Remaining Refinement Notes

- official index upstream resolution is substantially improved but not universal for every indexed item
- activation overlay planning is host-intent-aware and generation-aware, but can still be extended into richer session/workspace-intent planning later
