# agent-harness — Implementation Plan

## Purpose

This document converts every gap row in [Roadmap.md](./Roadmap.md) into a concrete implementation plan.

The plan is organized into prioritized milestones and assigns, for every roadmap row:

- an implementation work item
- milestone placement
- priority
- estimated effort
- suggested owner role
- dependencies
- a concrete definition of done

This plan replaces the earlier high-level vision document with a delivery-oriented plan that stays directly traceable to the roadmap.

## v1.0.0 Execution Status

The `release/v1.0.0` implementation wave delivers the first integrated stable baseline, but it does not complete every roadmap gap. The work is traceable through commits and issue references covering:

- `M0`: domain folders, centralized runtime config, shared preflight diagnostics, and host/service seams
- `M1`: OS-aware path resolution, home-relative local source seeds, cross-platform CI, and link lifecycle tests
- `M2` and `M4`: scan budgets, richer ignore profiles, data-driven detector modules, broad technology/vendor signature packs, generic repo artifact detection, repo-level demand fixtures, roadmap-archetype detector fixtures, policy coverage reporting, and benchmark coverage
- `M3`: source utilization reporting, guarded docs/registry harvesters, VS Code Marketplace extension harvesting, and dependency-evidence npm/PyPI candidate generation
- `M5` and `M6`: lifecycle terminology in wire plans, extension selection/install guidance, explicit VS Code extension install/verify/remove, shared MCP projection, asset prerequisite guidance, setup/doctor guidance, adapter-owned runtime preflight, host adapters, capability matrices, native project-local auto-wiring for Cursor, Zed, Claude Code, and Pi, and independent recommendation policies per registered host
- `M7`: config, discovery demand profiling, source registry/index handling, source utilization reporting, catalog inspection, package/reference/local/GitHub/official-index harvesters, detector signatures, technology signatures, package candidates, wire, host adapters, path utilities, preflight/runtime validation, host-native implementation modules under `src/host-adapters/`, focused install-domain modules under `src/install/`, recommendation modules under `src/recommend/`, mirror modules under `src/mirror/`, domain-specific manifest validators under `src/manifest-validation/`, and localized domain type modules under `src/types/`

Follow-up hardening after the merge addressed high-risk audit findings: scoped public package identity as `@ar27111994/agent-harness`, deterministic package allowlisting and packed-artifact smoke checks, package `main`/`exports`/`types` entry points, mutable state-root support through `--state-root` and `AGENT_HARNESS_STATE_ROOT`, safe mirror path resolution and file-manifest verification for multi-file artifacts, bounded mirror evidence file reads under approved local roots, guarded external response fetching with origin allowlists and byte limits, static public-provider allowlisting for optional AI enrichment, GitHub/repo content mirroring during mirror acquisition instead of wire time, validated PyPI metadata normalization, lazy VS Code settings path resolution after `.env` loading, resettable process-local GitHub state, explicit recommendation execution in the workspace and full rebuild pipelines, registry-driven recommendation-host enumeration, adapter-derived install bundle lock discovery, safe preview-by-default wire mode, non-destructive VS Code/OpenCode managed sections, quarantine review commands with audit logging, optional AI enrichment, official upstream allowlisting, mirror diff/explain reporting, offline workspace lifecycle smoke coverage, adapter-driven native-install/runtime preflight, `.gitignore` glob/negation handling, recommendation and mirror module decomposition, type-aware ESLint hardening, and shared CLI option parsing that rejects flag tokens as missing values.

Validation for this release includes typecheck, lint, format check, build, unit/link lifecycle tests, dotenv/parser tests, state-root tests, VS Code settings tests, security hardening tests, scan benchmark budget checks, detection quality reporting, detector-to-policy coverage reporting, isolated CLI smoke checks, offline workspace lifecycle smoke checks, packed-artifact smoke checks, recommendation fixture evaluation, and a Windows/macOS/Linux CI matrix plus a provenance-ready release workflow.

Known remaining roadmap work is still tracked below, especially additional native installers beyond VS Code and Cursor, deeper provider-specific OAuth/login automation, broader ecosystem-specific source harvesters, and future package/workspace extraction if the project later outgrows the single-package layout.

## Planning Conventions

### Priority Scale

| Priority | Meaning                                                                                     |
| -------- | ------------------------------------------------------------------------------------------- |
| `P0`     | Foundation work that unlocks multiple later milestones or reduces immediate structural risk |
| `P1`     | High-value work required for the platform direction to be credible and scalable             |
| `P2`     | Important follow-on work that improves coverage, correctness, or maintainability            |
| `P3`     | Useful optimization or hardening work that should land after higher-priority dependencies   |

### Effort Scale

| Effort | Meaning               |
| ------ | --------------------- |
| `XS`   | Up to 2 engineer-days |
| `S`    | 3 to 5 engineer-days  |
| `M`    | 1 to 2 engineer-weeks |
| `L`    | 2 to 4 engineer-weeks |
| `XL`   | 4 to 6 engineer-weeks |

### Suggested Owner Roles

| Owner role             | Responsibility                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `Architecture`         | Overall modular design, package seams, host model evolution, and long-range structure       |
| `Platform Foundations` | Shared runtime, path handling, config, filesystem, and common infrastructure                |
| `Discovery Engine`     | Workspace scanning, classification, enrichment, and recommendation signals                  |
| `Source Integrations`  | External source harvesters, registries, authority rules, and local source generation        |
| `Host Integration`     | Wire-in, activation, host adapters, plugin and extension projection, and host runtime flows |
| `Security & Runtime`   | Auth flows, config validation, preflight checks, runtime readiness, and policy enforcement  |
| `DX / CI`              | CI pipelines, benchmark harnesses, fixture suites, and developer workflows                  |

## Milestone Summary

| Milestone  | Goal                                                            | Priority | Included roadmap items       | Exit gate                                                                                                  |
| ---------- | --------------------------------------------------------------- | -------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `M0` / #48 | Establish modular architecture foundations                      | `P0`     | `A1`, `A4`, `A5`, `A7`       | Shared config, validation, service boundaries, and domain folders exist and are used by new work           |
| `M1` / #49 | Make the project genuinely cross-platform                       | `P1`     | `P1` to `P6`, `S6`           | Windows, macOS, and Linux paths, source seeds, and wire flows all work under CI                            |
| `M2` / #50 | Separate generic repo understanding from agent-asset harvesting | `P1`     | `G1`, `G2`, `G3`, `G5`, `G6` | Discovery can form meaningful demand profiles for non-agent and non-code-heavy repos                       |
| `M3` / #51 | Turn configured source breadth into effective source breadth    | `P1`     | `G4`, `S1` to `S5`, `S7`     | Declared source kinds and registry inputs materially affect catalog output                                 |
| `M4` / #52 | Make detection measurable, scalable, and maintainable           | `P1`     | `D1` to `D6`                 | Scan cost, detection quality, and signature extensibility are all tested and budgeted                      |
| `M5` / #53 | Make wire-in truly host-aware and user-assistive                | `P1`     | `W1` to `W7`                 | Staging, native install boundaries, auth guidance, and runtime readiness checks are explicit               |
| `M6` / #54 | Generalize host support beyond VS Code and OpenCode             | `P1`     | `H1` to `H7`                 | Additional non-default hosts can be integrated through adapter and config changes instead of core rewrites |
| `M7` / #55 | Reduce file and function complexity and create package seams    | `P2`     | `A2`, `A3`, `A6`, `A8`       | Oversized files are split, shared types are localized, and future package extraction is low-risk           |

## Milestone M0 — Modular Architecture Foundations

| ID        | From roadmap         | Implementation work                                                                                                                                          | Priority | Effort | Suggested owner        | Dependencies | Definition of done                                                                                                          |
| --------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ | ---------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `A1` / #1 | Gap Matrix 7 / Row 1 | Create a domain-oriented source layout such as `src/domains/*`, `src/config/*`, `src/lib/*`, and `src/host-adapters/*`, while keeping stable CLI entrypoints | `P0`     | `M`    | `Architecture`         | None         | New code lands in domain folders, and root-level `src` files are reduced to orchestration shells or removed                 |
| `A4` / #2 | Gap Matrix 7 / Row 4 | Introduce a centralized configuration module with schema validation, typed accessors, defaults, and a checked-in `.env.example`                              | `P0`     | `M`    | `Platform Foundations` | None         | Direct `process.env` access is eliminated outside config bootstrap, and `.env.example` documents supported runtime settings |
| `A5` / #3 | Gap Matrix 7 / Row 5 | Introduce explicit services, factories, and boundary objects where lifecycle and dependency construction are currently implicit                              | `P0`     | `M`    | `Architecture`         | `A1`         | Core workflows are composed from named collaborators rather than large helper clusters in root modules                      |
| `A7` / #4 | Gap Matrix 7 / Row 7 | Create shared preflight, config-validation, and policy-check layers reusable by CLI commands and host adapters                                               | `P0`     | `M`    | `Security & Runtime`   | `A4`, `A5`   | Common validation and runtime diagnostics are invoked consistently instead of being reimplemented per command               |

## Milestone M1 — Cross-Platform Portability

| ID         | From roadmap         | Implementation work                                                                                                                   | Priority | Effort | Suggested owner        | Dependencies     | Definition of done                                                                                          |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | ---------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `P1` / #5  | Gap Matrix 1 / Row 1 | Replace Windows-only VS Code settings and curated root resolution with `os.homedir()` and explicit OS-aware settings-path resolution  | `P1`     | `M`    | `Platform Foundations` | `A4`             | VS Code settings and harness roots resolve correctly on Windows, macOS, and Linux without environment hacks |
| `P2` / #6  | Gap Matrix 1 / Row 2 | Replace USERPROFILE-specific path normalization with a host-agnostic home-relative path formatter                                     | `P1`     | `S`    | `Platform Foundations` | `P1`             | Generated user-facing paths are normalized consistently across all supported operating systems              |
| `P3` / #7  | Gap Matrix 1 / Row 3 | Remove checked-in workstation-specific local source paths and replace them with home-relative or runtime-generated source definitions | `P1`     | `M`    | `Source Integrations`  | `A4`             | Fresh clones do not contain broken personal local source paths in checked-in config                         |
| `P4` / #8  | Gap Matrix 1 / Row 4 | Resolve OpenCode local source roots dynamically from the current user home instead of fixed absolute paths                            | `P1`     | `S`    | `Source Integrations`  | `P3`             | OpenCode-related local discovery roots are generated correctly per user and OS                              |
| `P5` / #9  | Gap Matrix 1 / Row 5 | Add Windows, Ubuntu, and macOS CI jobs covering discover, workspace, wire preview/apply/reset, and key smoke tests                    | `P1`     | `M`    | `DX / CI`              | `P1`, `P3`, `P4` | CI blocks merges when any supported OS regresses in path handling or wire flows                             |
| `P6` / #10 | Gap Matrix 1 / Row 6 | Add portable link lifecycle integration tests covering create, replace, reconcile, and reset semantics on all supported OSes          | `P2`     | `M`    | `DX / CI`              | `P1`, `P2`, `P5` | Managed link behavior is test-proven on Windows junctions and Unix symlink flows                            |
| `S6` / #11 | Gap Matrix 4 / Row 6 | Generate local source seeds dynamically per machine and OS rather than storing personal absolute paths in the repository              | `P1`     | `S`    | `Source Integrations`  | `P3`, `P4`       | Local source seeding works for new users on supported OSes with zero repository edits                       |

## Milestone M2 — Generic Repository Understanding

| ID         | From roadmap         | Implementation work                                                                                                                                                            | Priority | Effort | Suggested owner    | Dependencies                 | Definition of done                                                                                    |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ | ------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `G1` / #12 | Gap Matrix 2 / Row 1 | Expand demand profiling beyond software manifests to support notebooks, datasets, design assets, research content, media projects, hardware, and engineering artifact families | `P1`     | `L`    | `Discovery Engine` | `A1`, `A5`                   | Demand profiling produces meaningful signals for a representative non-software fixture corpus         |
| `G2` / #13 | Gap Matrix 2 / Row 2 | Split generic repo understanding from agent-asset harvesting so repositories can be understood even when they expose no skill or agent conventions                             | `P1`     | `L`    | `Discovery Engine` | `G1`                         | Repository classification runs before agent-asset extraction and works for generic repos              |
| `G3` / #14 | Gap Matrix 2 / Row 3 | Replace the short hardcoded signal vocabulary with a modular stack-signature registry that is easier to extend and validate                                                    | `P1`     | `M`    | `Discovery Engine` | `G1`, `G2`                   | New stack signatures can be added with isolated tests and without editing a central heuristic cluster |
| `G5` / #15 | Gap Matrix 2 / Row 5 | Add detectors for non-code-heavy folders so large documentation, media, notebook, and research trees produce targeted signals instead of near-empty profiles                   | `P2`     | `M`    | `Discovery Engine` | `G1`                         | Pure knowledge, notebook, and research repos yield meaningful demand profiles                         |
| `G6` / #16 | Gap Matrix 2 / Row 6 | Introduce auto-generated local source templates, detector packs, and machine-derived defaults so first-run setup is not biased toward one workflow                             | `P2`     | `M`    | `Architecture`     | `A4`, `G1`, `G2`, `G3`, `G5` | A new user can run the pipeline on common repo archetypes without editing checked-in config           |

## Milestone M3 — Effective Source Breadth and Registry Activation

| ID         | From roadmap         | Implementation work                                                                                                                               | Priority | Effort | Suggested owner       | Dependencies     | Definition of done                                                                                             |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | --------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `G4` / #17 | Gap Matrix 2 / Row 4 | Replace hardcoded package-candidate mapping with dependency extraction and ecosystem-aware registry scoring driven by actual repo evidence        | `P1`     | `L`    | `Discovery Engine`    | `G1`, `G3`, `A4` | Package-registry discovery reflects real repo dependencies across multiple ecosystems                          |
| `S1` / #18 | Gap Matrix 4 / Row 1 | Add reporting that distinguishes configured sources from operationally harvested sources and shows effective utilization by source kind           | `P2`     | `S`    | `Source Integrations` | None             | Reports clearly show which source kinds are configured, active, dormant, or ineffective                        |
| `S2` / #19 | Gap Matrix 4 / Row 2 | Expand trusted community and niche-domain source coverage without weakening authority-tier rules                                                  | `P2`     | `M`    | `Source Integrations` | `S1`             | Niche ecosystems have at least one vetted discovery path while official precedence remains intact              |
| `S3` / #20 | Gap Matrix 4 / Row 3 | Implement real marketplace and registry harvesters for source kinds currently represented only as config placeholders                             | `P1`     | `L`    | `Source Integrations` | `S1`, `G4`       | Every declared source kind either contributes harvested entries or is explicitly disabled or dormant by design |
| `S4` / #21 | Gap Matrix 4 / Row 4 | Promote docs sources to first-class harvested inputs that can produce durable instruction and reference assets                                    | `P2`     | `M`    | `Source Integrations` | `S1`             | Trusted docs sources contribute measurable catalog entries and are traceable in reports                        |
| `S5` / #22 | Gap Matrix 4 / Row 5 | Broaden package-registry candidate generation so npm and PyPI results are driven by dependency evidence rather than a narrow hardcoded signal map | `P1`     | `M`    | `Source Integrations` | `G4`             | Registry coverage materially improves for repositories with real dependency manifests                          |
| `S7` / #23 | Gap Matrix 4 / Row 7 | Add repo-archetype detection independent of agent-file conventions so GitHub repos are useful inputs even when they are not skill repositories    | `P2`     | `M`    | `Discovery Engine`    | `G2`, `S1`       | Non-agent repos can still produce relevant assets or recommendations through GitHub source harvesting          |

## Milestone M4 — Detection Scalability, Quality, and Maintainability

| ID         | From roadmap         | Implementation work                                                                                                       | Priority | Effort | Suggested owner    | Dependencies           | Definition of done                                                                       |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | ------------------ | ---------------------- | ---------------------------------------------------------------------------------------- |
| `D1` / #24 | Gap Matrix 3 / Row 1 | Add scan budgets, depth caps, file-count ceilings, byte budgets, and early-stop heuristics to recursive traversal         | `P1`     | `M`    | `Discovery Engine` | `A5`                   | Demand profiling remains predictably fast on large and heterogeneous repositories        |
| `D2` / #25 | Gap Matrix 3 / Row 2 | Expand ignore profiles for common heavy generated-output directories across major ecosystems                              | `P2`     | `S`    | `Discovery Engine` | `D1`                   | Scan cost is controlled across standard fixture repos without missing high-value signals |
| `D3` / #26 | Gap Matrix 3 / Row 3 | Add more file-type-specific enrichers and make enrichment pluggable instead of concentrating depth in a few special cases | `P1`     | `M`    | `Discovery Engine` | `G1`, `G3`, `A5`       | Multiple ecosystems receive first-class enrichment instead of fallback keyword matching  |
| `D4` / #27 | Gap Matrix 3 / Row 4 | Build a representative fixture corpus and quality-reporting harness to measure precision and recall by repo archetype     | `P1`     | `M`    | `DX / CI`          | `G1`, `G2`, `G3`, `D3` | Detection quality is measurable by archetype and visible in CI or periodic reports       |
| `D5` / #28 | Gap Matrix 3 / Row 5 | Add benchmark fixtures and CI thresholds for demand-profile runtime, scan volume, and memory usage                        | `P2`     | `M`    | `DX / CI`          | `D1`, `D2`             | Performance regressions are caught automatically by explicit benchmark budgets           |
| `D6` / #29 | Gap Matrix 3 / Row 6 | Refactor the signal model into data-driven detector modules or signature packs with dedicated tests                       | `P1`     | `M`    | `Discovery Engine` | `G3`, `D3`             | New detectors can be added in isolation without inflating central discovery modules      |

## Milestone M5 — Wire-In Automation and Guided Setup

| ID         | From roadmap         | Implementation work                                                                                                                           | Priority | Effort | Suggested owner      | Dependencies     | Definition of done                                                                                               |
| ---------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | -------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `W1` / #30 | Gap Matrix 5 / Row 1 | Make the lifecycle terminology explicit by separating staging, activation, wire-in, and native installation in the model and CLI UX           | `P1`     | `M`    | `Host Integration`   | `A5`             | Users can tell whether an asset is staged, activated, wired, or natively installed from CLI output and manifests |
| `W2` / #31 | Gap Matrix 5 / Row 2 | Add a real extension-install abstraction for hosts that support marketplaces, beginning with VS Code extension assets                         | `P1`     | `L`    | `Host Integration`   | `W1`, `W3`       | A selected VS Code extension can be discovered, installed, verified, and removed through the harness             |
| `W3` / #32 | Gap Matrix 5 / Row 3 | Extend activation and workspace profile manifests to model extension selections separately from plugins                                       | `P1`     | `M`    | `Host Integration`   | `A5`             | Extension assets participate in activation with full round-trip manifest fidelity                                |
| `W4` / #33 | Gap Matrix 5 / Row 4 | Add a shared-asset projection layer so shared MCP server assets can be surfaced intentionally into each host's effective wire plan            | `P1`     | `M`    | `Host Integration`   | `W1`, `H5`       | Shared MCP assets appear in effective host wire plans wherever host capabilities permit                          |
| `W5` / #34 | Gap Matrix 5 / Row 5 | Introduce an auth-capability model and guided CLI assistance for assets that require tokens, OAuth, login, or provider-specific prerequisites | `P1`     | `L`    | `Security & Runtime` | `A4`, `A7`, `W1` | Selecting an auth-required asset triggers prerequisite checks and actionable guided setup                        |
| `W6` / #35 | Gap Matrix 5 / Row 6 | Add host runtime readiness checks for marketplace availability, CLI presence, host versions, login state, and MCP runtime prerequisites       | `P1`     | `M`    | `Security & Runtime` | `A7`, `W1`       | `workspace` and `wire` fail fast with uniform readiness diagnostics instead of late runtime failure              |
| `W7` / #36 | Gap Matrix 5 / Row 7 | Add an explicit `setup` or `doctor` flow for first-time onboarding and asset-specific operational guidance                                    | `P2`     | `M`    | `Host Integration`   | `W5`, `W6`       | New users can complete host and asset onboarding from a guided CLI flow without reading source code              |

## Milestone M6 — Host Extensibility Beyond VS Code and OpenCode

| ID         | From roadmap         | Implementation work                                                                                                                                                                              | Priority | Effort | Suggested owner    | Dependencies                       | Definition of done                                                                                            |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ | ------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `H1` / #37 | Gap Matrix 6 / Row 1 | Replace the closed `HostTarget` union with a host registry or adapter contract that supports registration of new hosts                                                                           | `P1`     | `M`    | `Architecture`     | `A1`, `A5`                         | New hosts can be registered through a bounded adapter surface instead of core union edits                     |
| `H2` / #38 | Gap Matrix 6 / Row 2 | Refactor `workspace` and `wire` orchestration to dispatch through registered host adapters rather than hardcoded host names                                                                      | `P1`     | `M`    | `Host Integration` | `H1`                               | `workspace` and `wire` accept any registered host adapter                                                     |
| `H3` / #39 | Gap Matrix 6 / Row 3 | Move host bundle defaults and policy choices into per-host configuration objects or manifests                                                                                                    | `P1`     | `M`    | `Host Integration` | `H1`                               | New hosts can define default bundles without touching central switch logic                                    |
| `H4` / #40 | Gap Matrix 6 / Row 4 | Replace bespoke host modules with a reusable adapter skeleton covering paths, projection, settings, and reset semantics                                                                          | `P1`     | `L`    | `Host Integration` | `H1`, `H2`                         | Most new host integrations reuse a common adapter pattern rather than starting from scratch                   |
| `H5` / #41 | Gap Matrix 6 / Row 5 | Add a formal capability matrix mapping asset kinds to host behaviors such as stage, wire, native install, auth assist, and runtime validation                                                    | `P1`     | `M`    | `Architecture`     | `H1`                               | Host support and asset compatibility can be reasoned about from a single model                                |
| `H6` / #42 | Gap Matrix 6 / Row 6 | Generalize recommendation, activation, and profile emission flows so each host can emit its own selected-assets manifest shape                                                                   | `P2`     | `M`    | `Host Integration` | `H3`, `H5`                         | New host support includes recommendation, activation, and wire-plan generation end to end                     |
| `H7` / #43 | Gap Matrix 6 / Row 7 | Prove the adapter model by integrating additional non-default hosts such as Cursor, Zed, Claude Code, Pi, Codex, or Droid primarily through adapter and config changes rather than core rewrites | `P2`     | `L`    | `Architecture`     | `H1`, `H2`, `H3`, `H4`, `H5`, `H6` | Additional non-default host integrations land mostly through adapter and config work instead of core rewrites |

## Milestone M7 — Complexity Reduction and Future Package Seams

| ID         | From roadmap         | Implementation work                                                                                                            | Priority | Effort | Suggested owner        | Dependencies                 | Definition of done                                                                            |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ | ---------------------- | ---------------------------- | --------------------------------------------------------------------------------------------- |
| `A2` / #44 | Gap Matrix 7 / Row 2 | Split oversized core files into smaller modules with stable public entrypoints and explicit ownership boundaries               | `P2`     | `L`    | `Architecture`         | `A1`, `A5`                   | Core modules stay under agreed size budgets unless explicitly justified                       |
| `A3` / #45 | Gap Matrix 7 / Row 3 | Break concentrated discovery orchestration into dedicated scanning, enrichment, classification, and candidate-scoring services | `P2`     | `L`    | `Discovery Engine`     | `A2`, `D3`, `D6`             | Major workflows can be tested and optimized independently of the full discovery engine        |
| `A6` / #46 | Gap Matrix 7 / Row 6 | Split shared types and validation by domain and colocate schemas with the manifests or asset families they govern              | `P2`     | `M`    | `Platform Foundations` | `A1`, `A2`                   | Type and validation changes are localized to the owning domain rather than broad shared files |
| `A8` / #47 | Gap Matrix 7 / Row 8 | Refactor toward internal package-style boundaries so later extraction into libraries or a workspace split is low-risk          | `P3`     | `L`    | `Architecture`         | `A1`, `A2`, `A3`, `A6`, `H1` | The codebase can evolve into multiple packages without rewriting core business logic          |

## Dependency Highlights

The item-level dependency column above is the canonical dependency source. The most important milestone ordering constraints are:

1. `M0` lands first because it establishes config, validation, and composition seams used by every later milestone.
2. `M1` should land before broader host and source automation so portability is solved before the platform grows.
3. `M2` and `M3` can partially overlap, but `G4` and `S5` depend on the broader discovery model from `M2`.
4. `M4` should measure the new detection architecture, not the old one, so it depends on meaningful progress in `M2` and `M3`.
5. `M5` starts after `M0`, with `W4` intentionally aligned to the capability work in `M6`.
6. `M6` should be proven with real non-default host integrations rather than stopping at abstraction design.
7. `M7` is structured follow-through, not optional cleanup, because it converts the new architecture into maintainable code boundaries.

## Recommended Delivery Order

| Order | Milestone | Why it comes here                                                                                     |
| ----- | --------- | ----------------------------------------------------------------------------------------------------- |
| `1`   | `M0`      | Establishes the seams needed to refactor safely instead of layering more logic into large root files  |
| `2`   | `M1`      | Removes immediate platform portability debt and unblocks cross-platform validation                    |
| `3`   | `M2`      | Makes the platform meaningfully generic outside the current agent-centric repo assumptions            |
| `4`   | `M3`      | Converts declarative source breadth into actual harvested breadth                                     |
| `5`   | `M4`      | Adds budgets, quality evidence, and extensibility controls once the discovery model is modular enough |
| `6`   | `M5`      | Makes wire-in behavior explicit, safer, and easier for end users to operate                           |
| `7`   | `M6`      | Generalizes the host model after the current-host flows are better defined                            |
| `8`   | `M7`      | Finalizes file-splitting and package seams after the target architecture is stable                    |

## First Execution Slice

Start execution in milestone tracking issues #48 and #49. Treat wave `0A` as the immediate starting slice and avoid beginning `1B` until the portability code changes in `1A` are merged or close to merge-ready.

| Wave | Scope                    | Issues                                                 | Why this is the right first slice                                                                 |
| ---- | ------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `0A` | Foundation bootstrap     | `A4` / #2, `A1` / #1                                   | Centralized config and domain seams reduce hidden coupling before deeper refactors begin          |
| `0B` | Composition and checks   | `A5` / #3, `A7` / #4                                   | Service boundaries and shared validation should be built on top of the initial config/layout work |
| `1A` | Portability core         | `P1` / #5, `P2` / #6, `P3` / #7, `P4` / #8, `S6` / #11 | Removes OS-specific assumptions and replaces checked-in workstation bias with portable generation |
| `1B` | Portability verification | `P5` / #9, `P6` / #10                                  | CI matrix and link lifecycle tests should validate the new portability paths after they exist     |

## Milestone Completion Criteria

| Milestone | Completion criteria                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| `M0`      | Shared config, validation, and service composition patterns are in place and adopted by all new work                  |
| `M1`      | Cross-platform CI proves wire and source-generation behavior on Windows, Ubuntu, and macOS                            |
| `M2`      | Discovery handles generic and non-agent repos with materially better signal quality                                   |
| `M3`      | Configured source breadth translates into measurable harvested breadth and reportable utilization                     |
| `M4`      | Detection quality and performance are budgeted, benchmarked, and regression-tested                                    |
| `M5`      | Wire-in and setup flows distinguish staged vs installed assets and guide users through auth and runtime prerequisites |
| `M6`      | Additional non-default host integrations prove the adapter model with minimal core rewrites                           |
| `M7`      | Oversized files are reduced, shared types are localized, and package extraction becomes low-risk                      |

## Tracking Recommendation

Use the work-item IDs and GitHub issue numbers in this document as the canonical execution keys in issues, PRs, and milestone status reports.

Recommended labels or prefixes:

- `A*` for architecture and internal modularity
- `P*` for portability
- `G*` for generic repository understanding
- `D*` for detection scalability and quality
- `S*` for source breadth and source integrations
- `W*` for wire-in automation and onboarding
- `H*` for host extensibility

This keeps roadmap rows, milestone progress, and implementation work directly traceable.
