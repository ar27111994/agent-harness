# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-04-30

### Added in 1.0.0

- centralized runtime configuration with `.env.example`, typed defaults, and shared preflight diagnostics
- host adapter registry foundations for VS Code / GitHub Copilot and OpenCode workspace and wire flows
- recursive scan budgets, expanded ignore profiles, generic repository signals, dependency-aware package candidates, and source operational-status reporting
- cross-platform CI coverage for Linux, macOS, and Windows plus a portable directory-link lifecycle smoke check

### Changed in 1.0.0

- replaced workstation-specific local source paths with home-relative source endpoints expanded at runtime
- routed GitHub, batch, VS Code settings, and curated-root configuration through the shared config module
- documented doctor/setup diagnostics, scan controls, link validation, and the new internal source layout

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
