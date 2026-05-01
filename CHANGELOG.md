# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-05-01

### Added in 1.0.0

- centralized runtime configuration with schema-style validation, documented `.env.example` defaults, and shared preflight diagnostics
- cross-platform path handling for VS Code settings, home-relative display paths, generated local source seeds, and source endpoint resolution
- modular discovery detector packs for docs, notebooks, datasets, media/design assets, CAD/hardware, research, game engines, mobile, and ML artifact repos
- scan budgets, expanded ignore profiles, link lifecycle tests, scan benchmark budgets, and Windows/macOS/Linux CI coverage
- source utilization reporting that separates configured sources from operationally harvested sources
- dependency-evidence package registry harvesting for npm and PyPI plus docs, registry, and marketplace reference harvesters
- host adapter registry with capability matrices, guided setup/doctor commands, Cursor and Zed adapter entries, extension install planning, and shared MCP wire plan projection
- policy coverage reporting that checks detector-emitted terms against recommendation policy maps, fails CI on unmapped terms, and emits human-reviewed draft policy suggestions

### Changed in 1.0.0

- bumped the package version to `1.0.0`
- routed ad hoc environment access through the centralized config module
- replaced checked-in workstation-specific local source paths with home-relative defaults
- split new architecture, discovery, wire, host adapter, config, and preflight work into package-style seams
- extended Copilot workspace profiles and wire plans to distinguish plugins, extensions, native install actions, and shared MCP assets
- expanded detection quality fixtures to cover roadmap archetypes and made recommendation policy tuning evidence-driven instead of ad hoc

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
