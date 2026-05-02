# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-05-01

### Added in 1.0.0

- centralized runtime configuration with schema-style validation, automatic current-working-directory `.env` loading, documented `.env.example` defaults, and shared preflight diagnostics
- cross-platform path handling for VS Code settings, home-relative display paths, generated local source seeds, and source endpoint resolution
- modular discovery detector packs for docs, notebooks, datasets, media/design assets, CAD/hardware, research, game engines, mobile, and ML artifact repos
- scan budgets, expanded ignore profiles, link lifecycle tests, scan benchmark budgets, and Windows/macOS/Linux CI coverage
- source utilization reporting that separates configured sources from operationally harvested sources
- dependency-evidence package registry harvesting for npm and PyPI plus docs, registry, and marketplace reference harvesters
- host adapter registry with capability matrices, guided setup/doctor commands, adapter-specific CLI readiness diagnostics, native project-local auto-wiring for Cursor, Zed, Claude Code, and Pi, independent per-host recommendation policies, extension install planning, and shared MCP wire plan projection
- policy coverage reporting that checks detector-emitted terms against recommendation policy maps, fails CI on unmapped terms, and emits human-reviewed draft policy suggestions
- regression tests for dotenv duplicate/multiline parsing, CLI option missing-value handling, VS Code settings patching, safe mirror artifact paths, and PyPI metadata normalization
- guarded HTTP helpers with origin allowlists, timeouts, and response byte limits for external content reads
- domain-specific discovery modules for demand profiling, source indexing, source utilization, package/reference/local/GitHub/official-index harvesting, catalog selection, and catalog trust utilities
- focused install-domain modules, domain-local manifest validators, and localized type modules that preserve stable public barrel entrypoints while reducing large shared files
- explicit `.npmignore` release-artifact controls that keep source, tests, source maps, CI metadata, runtime state, and planning-only docs out of packed artifacts

### Changed in 1.0.0

- bumped the package version to `1.0.0`
- routed ad hoc environment access through the centralized config module
- replaced checked-in workstation-specific local source paths with home-relative defaults
- split new architecture, discovery, wire, host adapter, config, install, manifest-validation, type, and preflight work into package-style seams, including host-native implementations under `src/host-adapters/`
- consolidated workspace execution on `agent-harness workspace <host>`, removed legacy `agent-harness-vscode` and `agent-harness-opencode` package binaries, and added workspace scripts for all registered adapters
- ignored local environment files and generated project-local native host wiring artifacts for Cursor, Zed, Claude Code, and Pi to prevent accidental commits from local smoke runs
- extended Copilot workspace profiles and wire plans to distinguish plugins, extensions, native install actions, and shared MCP assets
- expanded detection quality fixtures to cover roadmap archetypes and made recommendation policy tuning evidence-driven instead of ad hoc
- refined host compatibility, activation host validation, native JSON merge safety, OpenCode shared MCP projection resilience, and Python dependency evidence extraction including Poetry `pyproject.toml` sections
- changed `wire <host>` to default to preview mode; `--apply` or `--reset` is required for mutating wire operations
- made workspace runs invoke the recommendation stage explicitly after discovery selection instead of relying on hidden `discover select` side effects
- made docs, registry, and marketplace source references attempt guarded summary harvesting and source utilization distinguish active, reference-only, and dormant sources
- made VS Code settings path resolution lazy so `.env` overrides for path-related variables are honored after CLI bootstrap
- centralized CLI option parsing and rejection of flag-looking tokens as missing option values
- reduced `src/discover.ts`, `src/install.ts`, `src/manifest-validation.ts`, and `src/types.ts` to stable entrypoints backed by focused domain modules

### Fixed in 1.0.0

- mirror multi-file artifact writes now reject path traversal outside the raw mirror root
- PyPI metadata is validated and normalized field-by-field before repository URL extraction
- GitHub process-local rate-limit and health-update state can be reset between repeated in-process CLI invocations
- install batching no longer treats a missing progress state as a completed bundle

## [0.2.0] - 2026-04-27

### Added in 0.2.0

- a policy-driven recommendation engine with host-specific overrides, schema-backed policy files, richer recommendation reporting, and golden recommendation fixtures
- a stronger developer quality toolchain with ESLint, Prettier, Husky, lint-staged, and CI validation for both code quality and recommendation behavior
- a centralized manifest validation layer and expanded discovery, mirror, install, and activation plumbing across the end-to-end pipeline
- roadmap and implementation-planning documentation tied directly to milestone and work-item tracking issues

### Changed in 0.2.0

- promoted validation from a single typecheck command to a broader `typecheck`, `lint`, `format`, `validate`, and `validate:recommendations` workflow
- expanded recommendation authoring into modular base and per-host policy files instead of one large policy blob
- improved VS Code and OpenCode wire-in behavior, including better curated runtime projection and Windows-friendly directory linking
- broadened source packs, schemas, and registry inputs to improve catalog generation and recommendation quality

## [0.1.0] - 2026-04-13

### Added in 0.1.0

- the initial end-to-end agent asset lifecycle covering discover, mirror, install, activate, and host wire-in
- workspace wrappers for GitHub Copilot in VS Code and OpenCode to run the full pipeline against a target workspace
- source discovery across local generated assets, official repositories and indexes, trusted community inputs, docs, and package registries
- staged host-specific package stores, generation-aware activation outputs, and reproducible mirror artifacts with quarantine support

### Changed in 0.1.0

- established the project baseline as a Node.js 22+ TypeScript CLI with published `agent-harness`, `agent-harness-vscode`, and `agent-harness-opencode` entrypoints
