# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [2.0.0] - 2026-06-01

### Added

- v2 agent asset supply-chain workflow covering discover, recommend, mirror, stage/install, refresh, activate, host wire-in, and rebuild flows across VS Code + Copilot, OpenCode, Cursor, Zed, Claude Code, Pi, and OpenAI Codex
- Codex host adapter support with project-local workspace/wire commands, documented boundaries, source compatibility, recommendation policy coverage, and safe reset behavior for #229
- README hero repositioning, proof points, one-command quick start, concrete lifecycle outputs, command-style conventions, supported-host/asset badges, and a real autoplay demo GIF with a sound-on walkthrough link for #225, #226, #230, #232, #233, #234, and #236
- workspace evolution, maintenance, quarantine, safe-default, trust-center, host support matrix, v1-to-v2 upgrade, release-process, and reproducible demo documentation for #239, #248, #252, #254, #255, #256, #258, and #259
- unknown workspace-signal backlog reports, source/catalog health doctor reports, candidate source queues, scheduled maintenance and maintenance-bot workflows, discover diff summaries, explainability commands, experimental environment index metadata, and evidence-weighted asset classification confidence for #240, #242, #245, #246, #247, #261, #262, #263, and #264
- coverage hardening roadmap and reproducible `coverage:gaps` reporting for #207, plus broad behavioral tests across recommendation, discovery, host-adapter, install, mirror, GitHub, HTTP, release-script, manifest-validation, and utility edge paths
- branch-residual coverage suites for AI enrichment, discovery harvesters, recommendation review/policy/selection, host wiring, install refresh, mirror acquisition, HTTP/preflight utilities, and source-sync helpers, raising the latest verified local run to 100% statements, branches, functions, and lines
- native-host recommendation fixture coverage for Cursor, Zed, Claude Code, and Pi defaults for #208
- demand-detection coverage matrix, targeted stack/vertical signatures, and false-positive fixtures for monorepos, serverless/edge, cross-platform mobile, AI-agent frameworks, commerce/CMS, workflow orchestration, desktop, infrastructure, and related project types for #209
- scenario-based recommendation-limit scaling guidance and copy-paste `preserve` / `scale` examples for #210
- ui-skills.com registered as a community skill registry source (`ui-skills`), discovered via flat sitemap with an item-URL predicate filtering to two-segment `/skills/{author}/{name}/` leaf pages; `itemCompatibilityMode: "adaptable"` across all supported hosts

### Changed

- source-sync prune predicate now uses `allPreviousCursorsCompleted` to determine whether a run constitutes a full re-scan, replacing the previous `observedEntryIds` guard; correctly prunes stale entries on legitimately empty sources while preventing accidental pruning during mid-stream cursor resumes
- `no-magic-numbers` ESLint rule extended to the full `src/domains/discovery/source-sync/**/*.ts` sub-tree following the decomposition in #270, covering all nine per-registry adapters and shared helpers
- default workspace troubleshooting docs now include a diagnostic ladder, artifact checklist, anti-vibes evidence requirements, and clearer playbook handoffs for #211
- coverage thresholds were raised to the verified 100% release floor while keeping runtime exclusions narrow instead of masking uncovered code
- recommendation policy maps now recognize the newly emitted demand/stack terms so detection, policy quality, and recommendation validation stay aligned
- `source-sync.ts` (1,916 lines) decomposed into 16 focused sub-modules under `src/domains/discovery/source-sync/` — shared types, state I/O, fetching, HTML engines, references, reporting, orchestrator, and 9 per-registry adapters — with `source-sync.ts` retained as a thin re-export barrel so all existing import paths are unchanged for #270
- `no-magic-numbers` ESLint rule expanded to `activate.ts`, `official-index-harvester.ts`, and `demand-signals.ts`; 11 new named constants extracted (`COPILOT_PROFILE_ID_MAX_LENGTH`, `COPILOT_VSCODE_ACTIVATION_BUDGET`, `OPENCODE_ACTIVATION_BUDGET`, `DEFAULT_ACTIVATION_BUDGET`, `FOCUSED_ACTIVATION_BUCKET_MAX_SIZE`, `COPILOT_FALLBACK_SKILL_POOL_LIMIT`, `COPILOT_PROFILE_ID_ASSET_SEGMENT_COUNT`, `OFFICIAL_FIRST_PARTY_SOURCE_PRIORITY`, `NON_FIRST_PARTY_SOURCE_PRIORITY`, `MAX_DEPENDENCY_SIGNALS_PER_FILE`, `TEXT_SIGNAL_READ_LIMIT`) for #271

### Fixed

- Go module index cursor now encodes `timestamp|lastSeenPath` (pipe-delimited) instead of a bare timestamp, eliminating the gap-or-duplicate hazard when multiple modules share the same timestamp at a page boundary; legacy bare-timestamp cursors are transparently upgraded on first resume
- npm changes-feed adapter now calls `deleteIndexedCatalogEntry` for rows with `deleted: true`, immediately removing stale catalog entries instead of leaving them until the never-firing prune-on-complete path
- improved release synchronization, version-check, GitHub resilience, guarded HTTP, path/file, native wire, install refresh, mirror acquisition, and recommendation validation regression coverage with deterministic tests

### Documentation

- added full Codex surface table (13 rows) to `HOST-SURFACE-AUDIT.md` documenting all managed path segments, config files, and lifecycle hooks for #229
- surfaced `HARNESS-MAINTENANCE-GUIDE.md` link in README Quick Start so post-wire-in maintenance steps are discoverable for #248
- added icons to all supported-host badges (VS Code + Copilot, OpenCode, Cursor, Zed, Claude Code, Pi, OpenAI Codex) and all asset-type badges using Simple Icons slugs and inline SVG data URIs where shields.io slug support lags
- documented source-sync SSRF trust boundary, allowed-origin derivation algorithm, and operator-facing SSRF backstop guidance in `SECURITY.md` and `SOURCE-SYNC-DECOMPOSITION-PLAN.md` for #272
- audited and updated all stale reference documentation: `Roadmap.md`, `IMPLEMENTATION-PLAN.md`, `FUTURE-IMPROVEMENTS.md`, `COVERAGE-100-ROADMAP.md`, and `SOURCE-SYNC-DECOMPOSITION-PLAN.md` now reflect v2.0.0 execution status, shipped capabilities, and current coverage metrics for #273

## [1.0.8] - 2026-05-17

### Fixed

- `rebuild full` now refreshes selected mirror artifacts whose raw cache directory predates the mirror `manifest.json` format, preventing install from failing on stale `mirror/index.jsonl` entries after upgrading existing workspaces
- CodeQL URL-sanitization alerts in mirror/install regression tests are resolved by parsing mocked request URLs before checking allowed hostnames

## [1.0.7] - 2026-05-14

### Added

- durable user-owned recommendation policy overrides for both the shared base policy and per-host policy layers, so package defaults can be extended safely without losing local operator intent
- explicit recommendation-limit override modes that distinguish `preserve` from `scale`, shared runtime/recommendation constants, and clearer effective-policy metadata in `recommend policy:print`
- a reusable built-CLI test harness, dedicated self-hosting integration suite, GitHub resilience regression coverage, and enforced coverage reporting with CI-published summaries
- demand-detection, source-coverage, and logging-strategy playbooks to document the new operational quality gates and tuning workflow

### Changed

- CLI help rendering now flows through shared output helpers instead of repeated ad hoc printers, keeping subcommand help output consistent without preparing state as a side effect
- lint guardrails now enforce tighter console usage and magic-number discipline in the policy/runtime hot paths, and the quality workflow now runs coverage-gated unit/integration tests before publishing a summarized coverage report
- `FUTURE-IMPROVEMENTS.md` now reflects the current implementation state so shipped capabilities are marked as implemented or partial instead of being left as stale future work

### Fixed

- GitHub remote harvesting now preserves cache-backed degraded operation under rate limits, serializes source-health cache repairs, and has regression coverage for malformed persisted state
- recommendation selection/reporting now uses extracted shared thresholds and weights instead of repeated literals, reducing configuration drift across runtime and ranking code
- release preparation for `v1.0.7` now keeps `package.json` and `package-lock.json` synchronized at the published version header

## [1.0.6] - 2026-05-13

### Added

- automated GitHub Release synchronization on release tags so the workflow now creates or updates the GitHub Release page, blends curated changelog notes with GitHub-generated notes, and stays rerun-safe
- extracted non-trivial release/build/version-check logic into readable `scripts/` modules with direct script-level regression tests

### Fixed

- updated the remaining stale multi-intent prompt wording in `AI-ENRICHMENT-PLAYBOOK.md` and `RECOMMENDATION-POLICY-PLAYBOOK.md`
- standardized the user-facing VS Code host name to `vscode` across recommend/policy command surfaces while still mapping it to the internal `copilot-vscode` recommendation host where needed

## [1.0.5] - 2026-05-13

### Changed

- aligned README and playbook guidance with the shipped multi-intent behavior so repeated `--intent` flags are documented as additive recommendation/workspace inputs while the first intent remains the primary activation/manifests context
- clarified that `agent-harness workspace <host>` is the straightforward default end-to-end path for new users, while `discover breadth` remains the recall-first diagnostic flow and `wire <host>` remains the lifecycle-output wiring command

### Fixed

- removed stale single-intent wording that still implied repeated `--intent` flags were unsupported after the `1.0.4` multi-intent implementation landed
- prepared release metadata for `v1.0.5` by synchronizing the package version and lockfile version headers
- added a version-synchronization validation check so CI fails when `package.json` and `package-lock.json` drift out of sync

## [1.0.4] - 2026-05-12

### Added

- `--intent` now accepts repeated values to combine multiple session intents additively in a single run (e.g. `--intent backend --intent docs`); the first intent is recorded as the primary for backward compatibility; single-intent runs are unaffected
- long-running discovery and workspace flows now print visible phase and batch progress so `discover demand-profile`, `discover sources`, `discover sync`, `discover catalog`, `discover select`, `discover full`, `discover breadth`, and workspace mirror/install orchestration expose live progress instead of appearing stalled

### Fixed

- `recommend report` no longer hangs on large selected candidate sets; policy-derived search term sets (`concernKeywordMap`, `taskModeKeywordMap`, `domainKeywordGroups`) are now precomputed once per report build via `buildPolicySearchContext(...)` instead of once per candidate per host, reducing time from ~7 minutes to under 5 seconds on a 5.5k-entry selected pool

## [1.0.3] - 2026-05-11

### Added

- structured host-native file payload support so assets can synthesize documented OpenCode, Cursor, Zed, Claude Code, and Pi config surfaces when explicit native payloads are present
- explicit `cursor-marketplace` source coverage in the checked-in discovery registry plus regression coverage for direct official host-source representation
- checked-in `mattpocock/skills` trusted-community repo coverage in the discovery registry
- widened generic official/community repo and registry sources to target every supported host instead of legacy minimized host pairs where the assets are portable across adapters
- recommendation fixture evaluation now records aggregate quality metrics, including top-rank reason mix, top-rank confidence mix, broad-fallback frequency, and local-availability frequency
- scenario-specific playbooks for discovery breadth, AI enrichment, asset refresh/update, recommendation policy tuning, and dry-run operator setup so both manual setup and agent-operated setup can follow the same verified workflows

### Changed

- OpenCode now projects managed instruction assets into `opencode.json` and native adapters can apply reversible structured payload merges for documented host config files
- Cursor now writes project-local agent files under `.cursor/agents/agent-harness/` in addition to the staged plugin-compatible bundle
- README and `HOST-SURFACE-AUDIT.md` now document current host-native synthesis boundaries, direct per-host discovery coverage, and the current CLI surface without migration-era wrapper-binary framing
- README now documents the layered confidence model, explain-output reason classes, and how to read `recommend evaluate` as a precision-vs-fallback signal instead of only a pass/fail check
- source-sync now reruns finite indexed sources from the beginning on completed passes, evicts entries that disappeared upstream after a fresh complete sync, and keeps append-only cursors resumable for feed-style registries
- install refresh now blocks ambiguous multi-bundle mirror conflicts instead of silently picking the last seen mirror id, and refresh report validation now checks nested fingerprint and native-install payloads
- guarded HTTP body timeouts now cancel active readers before surfacing timeout failures, demand-context session intent signals still apply when no demand profile is available, `discover breadth` now provides a first-class recall-first discovery command for widening the candidate pool before ranking, and `stage` is now the clearer preferred lifecycle term with `install` retained as a supported alias
- README and `AGENT-SETUP-PLAYBOOK.md` now consistently mark lifecycle artifact paths as state-root-relative, distinguish state-root lifecycle output from workspace-local host files, and clarify the real lifecycle ordering plus the bounded meaning of the stage/install phase
- the workspace pipeline now runs indexed discovery sync before catalog/recommendation so one-shot host flows use the same broadened discovery universe as explicit breadth audits

### Fixed

- active documentation no longer frames primary usage and troubleshooting around removed wrapper binaries instead of the supported `agent-harness` CLI surface
- AI enrichment validators now accept nullable fingerprint hashes for disabled/skipped artifact fingerprints during explicit opt-out and other non-completed flows
- Zed and Pi native reset cleanup now removes empty managed parent directories instead of leaving empty host metadata folders behind
- demand discovery now prioritizes root manifests under scan-budget pressure and ignores `.agent`, `.dart_tool`, and `.specify` metadata directories by default so real-workspace detection is less distorted by tool metadata
- JSONL state reads now tolerate ENOENT races during streaming, rethrow non-ENOENT stream failures correctly, and JSONL writes replace existing destinations reliably on Windows while avoiding repeated chunk byte-length rescans
- discovery catalog generation now buckets indexed entries by source once, avoids stack-overflowing on very large indexed source populations, trusted-local demand gating no longer lets concern-only phrases reject trusted-local guidance, source-sync avoids pruning indexed entries after transient zero-observation complete runs, and source-utilization fallback coverage matches source kind defaults
- `.env.example` keeps install refresh policy comments adjacent to the policy key, recommendation-report coverage now documents validator defaulting side effects, and install refresh due-only coverage asserts the persisted schedule state is left untouched when a run is skipped

## [1.0.2] - 2026-05-08

### Added

- added `AGENT-SETUP-PLAYBOOK.md`, a dedicated dry-run setup guide with a troubleshooting decision tree, asset-action classification guidance, and reusable AI-agent prompts for workspace/host/intention-based setup flows

### Changed

- README now links the dedicated `AGENT-SETUP-PLAYBOOK.md` guide and documents a preview-first workflow for AI-assisted setup/operator usage
- README now includes a dry-run troubleshooting decision tree that separates demand detection, selection breadth, ranking/policy, and install/runtime follow-up

### Fixed

- documented operator guidance now makes it explicit that increasing selection count should not be the first move when relevant assets already exist in the selected set

## [1.0.1] - 2026-05-08

### Changed

- made the Release workflow rerun-safe for manual `workflow_dispatch` runs so already-published versions skip duplicate publish steps instead of failing noisy follow-up checks
- normalized the `Unreleased` changelog section headings to keep post-release changelog structure consistent

### Fixed

- `official-index-entry` mirror acquisition now falls back to structured official-index page content when repo-backed package materialization fails for non-cap reasons, which unblocks the real `InterActNote` + OpenCode workspace flow that previously stopped on Flutter-related `materialize-failed` skips
- official-index HTML entity decoding now unescapes ampersands last, preventing double-decoding of values like `&amp;quot;`

## [1.0.0] - 2026-05-01

### Added in 1.0.0

- centralized runtime configuration with schema-style validation, automatic current-working-directory `.env` loading, documented `.env.example` defaults, and shared preflight diagnostics
- cross-platform path handling for VS Code settings, home-relative display paths, generated local source seeds, and source endpoint resolution
- modular discovery detector packs for docs, notebooks, datasets, media/design assets, CAD/hardware, research, game engines, mobile, and ML artifact repos
- scan budgets, expanded ignore profiles, link lifecycle tests, scan benchmark budgets, and Windows/macOS/Linux CI coverage
- source utilization reporting that separates configured sources from operationally harvested sources
- dependency-evidence package registry harvesting for npm and PyPI plus docs, registry, and marketplace reference harvesters
- `github-awesome-copilot-site` as a default official docs source so discovery can harvest the `awesome-copilot.github.com` catalog alongside the backing repository
- `clawhub` as a default community registry source for broader catalog/reference coverage without enabling default mirror/install promotion
- host adapter registry with capability matrices, guided setup/doctor commands, adapter-specific CLI readiness diagnostics, native project-local auto-wiring for Cursor, Zed, Claude Code, and Pi, independent per-host recommendation policies, extension install planning, prompt-template/command coverage, and shared MCP wire plan projection
- policy coverage reporting that checks detector-emitted terms against recommendation policy maps, fails CI on unmapped terms, and emits human-reviewed draft policy suggestions
- regression tests for dotenv duplicate/multiline parsing, CLI option missing-value handling, VS Code settings patching, safe mirror artifact paths, and PyPI metadata normalization
- guarded HTTP helpers with origin allowlists, timeouts, and response byte limits for external content reads
- domain-specific discovery modules for demand profiling, source indexing, source utilization, package/reference/local/GitHub/official-index harvesting, catalog selection, and catalog trust utilities
- focused install-domain modules, domain-local manifest validators, and localized type modules that preserve stable public barrel entrypoints while reducing large shared files
- scoped public package identity as `@ar27111994/agent-harness`, package metadata, npm `files` allowlist, prepack build, packed-artifact smoke validation, and release workflow with OIDC trusted publishing, provenance-ready publish checks, and package build validation in the publish job
- Dependabot version and security update configuration for npm packages and GitHub Actions plus repository funding metadata and README npm/sponsor badges
- mutable state-root support through `--state-root` and `AGENT_HARNESS_STATE_ROOT`, with packaged CLI defaults writing lifecycle output to workspace-local `.agent-harness/` instead of the package install directory
- `quarantine list/inspect/approve/reject` review commands with review logging for quarantined mirror artifacts
- optional `discover enrich` AI-assisted enrichment reports through an explicitly configured OpenAI-compatible endpoint
- `setup login` provider guidance for GitHub, npm, and optional AI enrichment configuration
- `mirror diff` and `mirror explain` commands for phase-level inspection
- explicit `.npmignore` release-artifact controls that keep source, tests, source maps, CI metadata, runtime state, local tarballs, and planning-only docs out of packed artifacts
- registry-driven recommendation-host enumeration, extensible host-target validation, package entry points, TypeScript declaration output, and release checks across Ubuntu, macOS, and Windows
- regression coverage for real-world TypeScript/Apify, Flutter/Firebase, native mobile, finance/trading, BI, DevOps/networking, MLOps/RAG, embedded/robotics/blockchain, data-mining/SEO, demand relevance selection, command help side effects, executable MCP package search, and human-readable generic asset names

### Changed in 1.0.0

- bumped the package version to `1.0.0`
- routed ad hoc environment access through the centralized config module
- replaced checked-in workstation-specific local source paths with home-relative defaults
- split new architecture, discovery, wire, host adapter, config, install, manifest-validation, type, and preflight work into package-style seams, including host-native implementations under `src/host-adapters/`
- consolidated workspace execution on `agent-harness workspace <host>`, removed legacy `agent-harness-vscode` and `agent-harness-opencode` package binaries, and added workspace scripts for all registered adapters
- ignored local environment files, local package tarballs, mirror index snapshots, and generated project-local native host wiring artifacts for Cursor, Zed, Claude Code, and Pi to prevent accidental commits from local smoke runs
- extended Copilot workspace profiles and wire plans to distinguish plugins, extensions, native install actions, and shared MCP assets
- expanded detection quality fixtures to cover roadmap archetypes and made recommendation policy tuning evidence-driven instead of ad hoc
- refined host compatibility, activation host validation, native JSON merge safety, OpenCode shared MCP projection resilience, and Python dependency evidence extraction including Poetry `pyproject.toml` sections
- changed `wire <host>` to default to preview mode; `--apply` or `--reset` is required for mutating wire operations
- made workspace and full rebuild runs invoke the recommendation stage explicitly after discovery selection instead of relying on hidden `discover select` side effects
- made docs, registry, and marketplace source references attempt guarded summary harvesting and source utilization distinguish active, reference-only, and dormant sources
- mirror acquisition now accepts pinned GitHub-tree and official-index artifacts when raw content verifies against the pinned blob SHA even if the GitHub branch-commit lookup is temporarily unavailable
- README and `.env.example` now document that GitHub tokens help both discovery and GitHub-backed mirror acquisition on larger real-workspace runs
- made VS Code settings path resolution lazy so `.env` overrides for path-related variables are honored after CLI bootstrap
- centralized CLI option parsing and rejection of flag-looking tokens as missing option values
- split recommendation policy loading, CLI commands, host enumeration, internal recommendation models, and report/scoring logic into `src/recommend/` modules behind the stable `src/recommend.ts` facade
- split mirror planning, bundle locking, acquisition/materialization, inspection, constants, and path handling into `src/mirror/` modules behind the stable `src/mirror.ts` facade
- tightened ESLint with type-aware no-floating-promise and unsafe-access rules plus scoped console-output enforcement for CLI boundary modules
- reduced `src/discover.ts`, `src/install.ts`, `src/manifest-validation.ts`, and `src/types.ts` to stable entrypoints backed by focused domain modules
- made catalog selection demand-aware before duplicate selection so irrelevant source-pack entries are rejected before recommendation
- aligned OpenCode, Zed, Pi, Cursor, and Claude Code capability matrices with documented host-specific assets including OpenCode commands, Zed MCP/reference support, Pi prompt templates, Cursor prompt/plugin assets, and Claude Code prompt/MCP assets
- made CLI `--help` and `-h` flags route to command-group usage before lifecycle state is prepared

### Fixed in 1.0.0

- mirror multi-file artifact writes now reject path traversal outside the raw mirror root, clean raw artifact directories before writing, store file manifests, and verify aggregate hashes during install
- PyPI metadata is validated and normalized field-by-field before repository URL extraction
- GitHub process-local rate-limit and health-update state can be reset between repeated in-process CLI invocations
- install batching no longer treats a missing progress state as a completed bundle
- demand profiling honors `.gitignore`, `.ignore`, and `.agent-harnessignore` patterns in addition to built-in generated-directory skips, including simple glob wildcards and negation re-inclusion rules
- GitHub/repo assets are mirrored through guarded fetches during mirror acquisition instead of being fetched live during wire-in
- guarded pinned GitHub lookups now honor Node's `lookup(..., { all: true })` callback shape, which eliminates the `ERR_INVALID_IP_ADDRESS` failure mode that caused real-workspace GitHub fetches to be skipped as null
- official-index upstream repository links are constrained by a checked-in owner allowlist and schema-backed `discover/official-upstreams.json` asset
- install and activation now enforce bundle activation eligibility, verify/copy only mirror-manifest-listed files, and skip quarantined or unpromoted assets
- mirror acquisition quarantines prompt-injection-like community content for manual review
- VS Code and OpenCode wire-in preserve unmanaged instruction/`AGENTS.md` content through managed sections instead of wholesale replacement
- isolated CLI and offline workspace lifecycle smoke tests now run against temporary home/config/state roots so validation does not mutate real user host configuration
- Cursor native extension installation is planned through a compatible VS Code-style `cursor` CLI when structured extension IDs are available
- mirror evidence file reads are restricted to the working directory, state root, and known local seed roots before any local file content is mirrored
- optional AI enrichment now uses centralized runtime configuration, static public-provider origin allowlists, and private/loopback/link-local hostname rejection before sending API keys
- install bundle discovery now derives lock paths from registered host adapter bundle defaults and warns when expected locks are missing
- duplicate checked-in local source definitions were removed in favor of runtime-generated local sources with dynamic endpoints
- shared mirror path guards are reused by both mirror acquisition and bundle installation, and GitHub timeout handling uses one `AbortError` helper
- guarded HTTP fetches now resolve and pin public DNS answers before requests, mirror evidence reads reject symlink escapes, GitHub mirror downloads verify raw-byte upstream blob SHAs, and prompt-injection quarantine detection covers normalized jailbreak and secret-exfiltration variants
- recommendation selection now preserves policy minimums above one, keeps hard source/duplicate caps in fallback selection, and keeps suggested bundles within activation budgets
- native and VS Code wire-in now preserve applied preview state, reuse activation asset path sanitization, and avoid clobbering user-owned global skill-location preferences
- rebuild, scanning, discovery, activation, and install flows now use workspace roots consistently, skip generated discovery output, reuse demand-signal file reads, atomically stage activation runtime views before swapping, merge bundle membership, mirror audit-only assets, reject truncated GitHub snapshots, and validate all Copilot workspace profile selection arrays
- public exported declarations now include API docstrings with a regression test that fails when exported source declarations lack JSDoc coverage
- demand profiling now uses delimited technology text-marker matching to avoid substring false positives such as `ros` inside common TypeScript words
- demand profiling now covers broader repo archetypes including finance/trading, BI/reporting, DevOps/platform engineering, network automation, advanced security, MLOps/RAG/vector search, creative media, embedded/firmware, robotics simulation, extended blockchain, data mining, slicer/3D-printing, and CMS/SEO/content workflows
- dependency parsing now feeds technology signatures for Cargo, Go, Maven/Gradle, NuGet, RubyGems, Packagist, and SwiftPM manifests, handles Poetry inline table dependencies, requirements variants, Cargo workspace dependencies, Gradle two-part coordinates, NuGet central package management, and avoids prose-scanning lockfiles
- demand profiling now detects Dart/Flutter `pubspec.yaml`, Firebase `pub` dependencies, Kotlin/Java Android, Swift, Objective-C, CocoaPods, SwiftPM, C#/.NET MAUI, and Xamarin mobile projects
- package-registry discovery now uses demand-derived npm search queries for executable MCP servers instead of checked-in package-name allowlists, and registry MCP classification recognizes executable server package patterns
- GitHub tree harvesting no longer treats Markdown files that mention MCP as executable MCP servers
- generic catalog filenames such as `SKILL.md` and `README.md` now fall back to human-readable parent directory names
- Claude Code and Cursor local config harvesting now recognizes host-native agents, commands/prompt packs, skills, hooks, plugin manifests, MCP config files, and rule/context files while keeping generated local config sources catalog-only by default
- Cursor wire-in now stages a plugin-compatible component tree under `.cursor/agent-harness/cursor-plugin`, and Claude Code wire-in now writes a managed `.claude/agents/agent-harness.md` project agent
- native host wire-in now exposes every selected asset kind through host managed references and wire-plan buckets for Cursor, Zed, Claude Code, and Pi
- recommendation redundancy scoring now uses maintained selection indexes instead of scanning every selected candidate for each score

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
