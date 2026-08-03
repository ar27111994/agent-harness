# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Demand-based source filtering** — `discover full` now syncs only sources relevant to the detected project ecosystem, reducing first-run sync time from 5+ minutes to under 60 seconds for typical TypeScript projects. Sources are mapped from demand signals (languages, frameworks, package managers) to relevant registries. Universal sources (mcp-registry, skills-sh, ui-skills, clawhub) are always synced. Use `--sync-all` to override and sync every enabled source (#419)
- **Demand-sync progress hint** — after demand detection, `discover full` prints an ecosystem-aware summary: "Detected TypeScript project. Syncing 12/47 demand-relevant sources (35 skipped). Use --sync-all for full sync or --no-sync to skip entirely." (#420)
- **`--sync-all` flag** — new flag for `discover full` that bypasses demand-based source filtering and syncs all enabled sources (#419)
- **hex-registry (Hex.pm)** — Elixir/Erlang ecosystem package registry via sitemap-based sync at https://hex.pm/sitemap.xml. Automatically included when demand signals detect Elixir, Erlang, mix, hex, or rebar
- **conan-registry (ConanCenter)** — C/C++ ecosystem package registry via sitemap-based sync at https://conan.io/sitemap.xml. Automatically included when demand signals detect C, C++, cmake, meson, or conan
- **pub-dev-registry (pub.dev)** — Dart/Flutter ecosystem package registry via JSON API paginated sync at https://pub.dev/api/package-names. Automatically included when demand signals detect Dart, Flutter, or pub

### Fixed

- **`recommend` subcommand --help shows subcommand-specific options** — `recommend report --help`, `recommend evaluate --help`, `recommend ai-review --help`, and `recommend policy:print --help` now show subcommand-specific usage and options instead of the parent recommend command list (#416)
- **`install refresh --help` uses correct command name** — help headings and usage lines now show `install` (the primary command) instead of the legacy `stage` alias. Parent help says "install commands (stage is a legacy alias)" (#417)
- **`bundle explain --help` shows correct heading** — `bundle explain --help` now shows "bundle explain — Explain why assets are present in a bundle lock" instead of the incorrect "mirror explain" heading (#418)

## [2.0.0] - 2026-07-31

### Breaking Changes

- **Demand-scan file ordering changed** — binary files are now deprioritised below source files in demand-scan ordering (previously binary and source files were interleaved lexicographically). Tools or tests that assert a fixed scan order or specific truncation behaviour may need to be updated (#280).
- **`.worktrees/` directories excluded from all scans** — file discovery, demand detection, and source-sync traversal now skip `.worktrees/` subdirectories. Workspaces that deliberately stored assets inside `.worktrees/` will no longer have them picked up (#277).
- **Packagist registry enforces a hard 500-entry cap** — Packagist source-sync stops at 500 entries per source. Operators who previously indexed full high-volume Packagist namespaces will observe a reduced catalog for those sources (#286).
- **`source-health` dormant/never-synced `reason` field is now always populated** — previously the `reason` field on dormant and never-synced entries was an empty string; it now carries a descriptive message. Code that matched on empty-string reason will need to update its checks (#281).

### Fixed

- **MSYS path normalisation** — `--state-root /c/Projects/...` is now correctly resolved to `C:\Projects\...` on Windows, preventing silent data misdirection to phantom `C:\c\...` paths (#397)
- **Stopword filtering in capabilities** — `splitIntoKeywords` now filters English stopwords and single-character tokens, preventing noise like "the", "a", "is" from appearing in ARD capabilities and representative queries (#400, #406)
- **Discover stats fallback** — when `catalog.assets.jsonl` is missing but `catalog.selected.jsonl` exists, breakdowns are now built from the available selection instead of showing empty maps (#398)
- **Install malformed-artifact resilience** — `installBundles` now skips malformed mirror artifacts with a warning (including the assetId for diagnosis) instead of aborting the entire install pipeline (#409)
- **ARD trust manifests** — `deriveArdTrustManifest` now generates identity-based trust manifests for all official-first-party, official-compatible, and trusted-community sources, and includes publisher-verified attestations (#399)
- **Dependency directory exclusion** — GitHub repo harvesting now skips files under `node_modules/`, `vendor/`, `.venv/`, `__pycache__/`, and other dependency directories, preventing catalog pollution (#405)
- **Wire plan preview output** — `wire cursor --preview` and `wire vscode --preview` now print a structured plan preview (matching the OpenCode format) instead of showing only preflight diagnostics (#403)
- **CI maintenance noise reduction** — dormant-source false positives from ephemeral CI state roots are filtered; broken sources (severity=error) now surface as bot-plan issues ahead of drift warnings; discovery state cache is persisted between CI runs via GitHub Actions cache (#412, #413, #414)
- **Codex native install** — the Codex host adapter now supports native extension installation via the same mechanism as VS Code/Cursor, replacing the previous `nativeInstall=none` (#407)
- **Help output restructured** — `--help` now includes a Quick Start section at the top and groups commands by lifecycle phase (Discover, Recommend, Mirror & Install, Activate & Wire, Workspace, Setup & Doctor) instead of a dense 40+ command flat list (#410)
- **`--timeout-seconds` global flag** — long-running operations (recommend report, discover catalog) can now be given a configurable deadline via `--timeout-seconds <n>` (clamped 10–3,600) or the `AGENT_HARNESS_TIMEOUT_SECONDS` env var, preventing silent timeout failures on large catalogs (#402, #404)
- **Swift Package Index source disabled** — the `swift-package-index` source is now disabled (sitemap returns 403 Forbidden), eliminating a permanent severe source-health error from every maintenance run (#411)
- **CHANGELOG date corrected** — `[2.0.0]` date updated to `2026-07-31` to reflect the actual release timeline (#408)
- **ard-export Prettier compliance** — `discover ard-export` now formats `.well-known/ai-catalog.json` with Prettier inline, so the output passes `npm run format:check` immediately after generation (#348)
- **Asset-kind diversity threshold** — the diversity penalty for overrepresented asset kinds now applies to the 3rd candidate of the same kind rather than the 4th; prevents extensions from crowding out skills and agents in top-N recommendations (#401 follow-up)
- **MSYS bare drive letter** — `/c` without a trailing slash is now correctly resolved to `C:\` on Windows alongside the existing `/c/X` → `C:\X` normalisation (#397 follow-up)
- **Language identifier preservation** — `splitIntoKeywords` now preserves single-character programming language identifiers (`C`, `R`) and normalises punctuation-based aliases (`C++` → `cpp`, `F#` → `fsharp`) before generic token filtering, ensuring language tokens survive stopword and length checks (#400/#406 follow-up)
- **Catalog file-existence detection** — `discover stats` now distinguishes a genuinely absent raw catalog file (falls back to selected+rejected for breakdowns) from a present-but-empty file (preserves empty breakdown with `catalogSource: raw-catalog`) instead of using the array-length heuristic (#398 follow-up)
- **Install progress skipped-asset tracking** — `InstallProgressState` now records `skippedAssetIds` per bundle (malformed, missing, or uninstallable artifacts), excludes them from `lastBatchAssetIds`, and preserves them in the remaining-asset count so a completed bundle cannot silently omit required batch work (#409 follow-up)
- **Structured source-health reason codes** — dormant CI sources now carry `reasonCode: "ephemeral-ci-state-root"` instead of a bare boolean `ciDetected` flag; the maintenance bot plan matches on the structured code, making the filter self-documenting and extensible for future conditions (#412 follow-up)
- **CLI help quarantine expansion** — `--help` now lists `quarantine approve`, `quarantine reject`, and `quarantine pin` alongside `quarantine list`, and splits Quarantine and Rebuild & Bundle into separate labelled groups (#410 follow-up)
- **Workspace pipeline silent failure** — `workspace <host>` now exits non-zero and stops at the recommend phase when recommendations cannot be produced, instead of silently continuing through mirror/install/activate with empty output (#349)
- **`isAborted()` coverage** — removed `/* c8 ignore */` markers; the helper is now exported and tested through the preflight pipeline with aborted `AbortSignal` (#355)
- **Setup doctor Pi cold-start timeout** — raised default `preflightTimeoutMs` from 10 s to 15 s, eliminating spurious timeout warnings on Pi's first invocation (#350)
- **Source-sync transient-failure resilience** — fetch operations now retry up to 3 times with exponential backoff (1 s, 2 s, 4 s) via shared `fetchWithRetry` wrapper. Non-transient errors distinguished structurally (`NonTransientFetchError` class + HTTP 4xx detection) rather than fragile string-matching. Sources self-heal on next successful sync (#351)
- **Source-sync stale-data fallback** — when a previously-successful source fails to fetch, existing catalog entries are preserved under `status: "stale"` with `severity: "warning"` for up to 3 consecutive failures; only escalates to `severity: "error"` (`status: "failed"`) after persistent failure. Sources self-heal on next successful sync (#351)
- **Broad-fallback host identification** — `recommend evaluate` now lists which specific host IDs produce broad-fallback top recommendations via the new `broadFallbackHosts` field (#354)
- **OpenCode `.gitignore` self-reference** — removed `.gitignore` from `REQUIRED_ENTRIES`; entries now only target lockfiles and `node_modules` (#356 item 2)
- **OpenCode non-null assertion eliminated** — extracted `buildNpmInstallNotes()` helper with proper `== null` guard, removing the `!` assertion. Uses `!= null` (loose) per AGENTS.md convention to guard both null and undefined (#356 item 5 / S2)
- **Duplicate retry-loop code eliminated** — extracted shared `fetchWithRetry<T>()` generic, eliminating ~60 lines of copy-pasted retry logic across `fetchRequiredText` / `fetchRequiredJson` (S1)
- **Error discrimination hardened** — replaced fragile string-matching `isNonTransientError()` with `NonTransientFetchError` class + structured HTTP 4xx status check (J1)
- **Prettier error visibility** — `ard-catalog` catch block now logs `console.warn` with the error cause when Prettier formatting is skipped, instead of silently swallowing (J2)

### Added

- `wire opencode --preview` now prints a structured wire-plan summary to stdout before any file is written, listing linked-asset paths count, resolved MCP server identifiers, native-config operations, and contextual notes so operators can review changes before committing (#284)
- `WirePlanManifest.npmInstallSummary` field documenting the expected OpenCode plugin npm-install footprint (package.json path, declared dependency count, estimated installed-package count derived from lockfile entries or a fallback estimate) so tooling can distinguish OpenCode-managed npm artefacts from reference-pack files wired by agent-harness (#282)
- `SelectionReport.rejectionSummary` (`Record<string, number>`) tallying catalog rejections by reason, and `SelectionReport.sampleRejected` (stratified up-to-20 `{assetId, reason}` entries guaranteeing at least one sample per distinct rejection reason) surfacing demand-relevance and duplicate-rejection signals for diagnostics (#285)
- `RecommendationReport.recommendations[]` flat deduplicated array providing a stable programmatic surface over the recommendation set alongside the existing grouped structure (#283)
- Ecosystem-affinity mismatch penalty (flat 40 pts) in package-registry source scoring — assets from a registry whose ecosystem does not match any detected workspace package manager are penalised; no penalty is applied when the workspace has no package-manager signals or the source is not a package registry (#278)
- Non-empty contextual reason strings for every dormant and never-synced source in source-health reports; previously empty-string reasons are replaced by descriptive messages (last-seen age, zero-entry signal, configuration note) (#281)
- Node CLI framework demand signal: workspaces with `bin` entries and `engines.node` in `package.json` now emit a `node-cli` framework signal used by scoring and policy (#279)
- Binary files are now deprioritised below source files in demand-scan ordering (stable, lexicographic tie-breaking within each tier ensures reproducible truncation across platforms); the CLI emits a stderr warning when the scan is truncated, reporting the truncation reason and the number of files and MB actually scanned (#280)
- `.worktrees/` directories are excluded from all recursive scan passes (file discovery, demand detection, and source-sync traversal), preventing accidental cross-worktree signal bleed (#277)
- Packagist registry source-sync now enforces a hard 500-entry cap per source to prevent runaway catalog inflation from high-volume package namespaces (#286)
- Five new source packs registered in `discover/source-packs/`:
  - **official.json** — `anthropics-knowledge-work-plugins-pack`: official Anthropic collection of 11 role-specific knowledge-worker plugins (productivity, sales, legal, finance, bio-research, etc.) bundling domain skills, slash commands, MCP connector manifests, and sub-agents; `official-first-party`, priority 95
  - **community.json** — `egonex-ai-understand-anything`: multi-platform 6-agent + Tree-sitter codebase-analysis plugin producing interactive knowledge graphs with semantic search, architecture tours, and diff-impact analysis; `unverified-community`, priority 70
  - **community.json** — `leonxlnx-taste-skill`: 13 portable design-taste SKILL.md files (10 code-gen + 3 image-gen) replacing generic frontend boilerplate with high-quality layout, typography, and motion output (39k+ stars); `trusted-community`, priority 72
  - **community.json** — `mukul975-anthropic-cybersecurity-skills`: 754 cybersecurity skills across 26 domains mapped to MITRE ATT&CK v19.1, NIST CSF 2.0, MITRE ATLAS v5.4, D3FEND v1.3, and NIST AI RMF 1.0; community-authored, not affiliated with Anthropic; `unverified-community`, priority 70
  - **community.json** — `imbad0202-academic-research-skills`: full academic research pipeline (research → write → review → finalize) across 4 skill packages with 32+ agents and a 10-stage orchestrator; CC BY-NC 4.0; `unverified-community`, priority 70
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
- ARD (Agentic Resource Discovery) v0.9 interoperability: `discover ard-export` command publishing `.well-known/ai-catalog.json` with URN identifiers, media-type mapping, trust-manifest derivation, and synthetic representative queries for registry discovery (#325)
- README ARD section with ecosystem architecture diagram, publisher/consumer role descriptions, and cross-references to implementation tickets (#329)
- ARD trust-manifest signal consumption: `ard-identity-bound` (+4), `ard-compliance-attested` (+3), `ard-soc2` (+3), `ard-hipaa` (+3), and `ard-signed` (+5) trust-score boosts (#328)
- ARD registry source adapter consuming `POST /search` endpoints, mapping ARD results to `AssetCatalogEntry` with `SourceKind: "ard-registry"`, federated referral tracking, and semantic-score normalization (#327)
- ARD ecosystem community submission documentation for ards-project, GitHub Agent Finder, and HuggingFace Discover (#326)
- ARD representativeQueries wired into SemanticScorer — entries with ARD-generated natural-language query text use 1.2× weighted cosine similarity via `ARD_REPRESENTATIVE_QUERY_WEIGHT`; `buildEntryEmbeddingText` prioritizes `representativeQueries` over keyword-derived capability terms when present (#327)
- ARD publisher FQDN now configurable via `AGENT_HARNESS_ARD_PUBLISHER_FQDN` environment variable with hardcoded default `ar27111994.dev` — production paths use `getArdPublisherFqdn()` getter
- Comprehensive catalog breadth documentation — new `docs/guides/CATALOG-BREADTH.md` guide with two-phase offline index workflow, production configuration table, source coverage breakdown, scheduled CI workflow template, and catalog size projections; README updated with "Building a comprehensive catalog" section
- VS Code Marketplace popularity sweep default raised from 10 to 50 pages (2,500 extensions by install count, configurable via `AGENT_HARNESS_VSCODE_MARKETPLACE_POPULARITY_SWEEP_PAGES`) for offline index builds
- Fixed skills-sh registry source — sitemap URL updated to `www.skills.sh` (308 redirect) and leaf predicate expanded to match `sitemap-(skills|agents|misc|owners)` patterns (#336)
- **`--quiet` / `--summary` flags for `discover full`** — `--quiet` suppresses expected "none survived selection" warnings; `--summary` prints aggregate breakdown by reason instead of per-source counts (#352)
- **`SelectionReport.acceptanceRate`** — computed as `selectedCount / inputCount` (rounded to 4 decimal places); 0 when inputCount is 0. Backfilled for pre-v2.0.0 reports (#353)
- **`SourceSyncStatus` extended** — new `"stale"` variant for sources using fallback data after transient fetch failures

### Changed

- source-sync prune predicate now uses `allPreviousCursorsCompleted` to determine whether a run constitutes a full re-scan, replacing the previous `observedEntryIds` guard; correctly prunes stale entries on legitimately empty sources while preventing accidental pruning during mid-stream cursor resumes
- `no-magic-numbers` ESLint rule extended to the full `src/domains/discovery/source-sync/**/*.ts` sub-tree following the decomposition in #270, covering all nine per-registry adapters and shared helpers
- default workspace troubleshooting docs now include a diagnostic ladder, artifact checklist, anti-vibes evidence requirements, and clearer playbook handoffs for #211
- coverage thresholds were raised to the verified 100% release floor while keeping runtime exclusions narrow instead of masking uncovered code
- recommendation policy maps now recognize the newly emitted demand/stack terms so detection, policy quality, and recommendation validation stay aligned
- `source-sync.ts` (1,916 lines) decomposed into 16 focused sub-modules under `src/domains/discovery/source-sync/` — shared types, state I/O, fetching, HTML engines, references, reporting, orchestrator, and 9 per-registry adapters — with `source-sync.ts` retained as a thin re-export barrel so all existing import paths are unchanged for #270
- `no-magic-numbers` ESLint rule expanded to `activate.ts`, `official-index-harvester.ts`, and `demand-signals.ts`; 11 new named constants extracted (`COPILOT_PROFILE_ID_MAX_LENGTH`, `COPILOT_VSCODE_ACTIVATION_BUDGET`, `OPENCODE_ACTIVATION_BUDGET`, `DEFAULT_ACTIVATION_BUDGET`, `FOCUSED_ACTIVATION_BUCKET_MAX_SIZE`, `COPILOT_FALLBACK_SKILL_POOL_LIMIT`, `COPILOT_PROFILE_ID_ASSET_SEGMENT_COUNT`, `OFFICIAL_FIRST_PARTY_SOURCE_PRIORITY`, `NON_FIRST_PARTY_SOURCE_PRIORITY`, `MAX_DEPENDENCY_SIGNALS_PER_FILE`, `TEXT_SIGNAL_READ_LIMIT`) for #271
- **Activation budget lookup** — replaced sequential `if` branches in `getActivationBudget` with a `Map<ActivationHost, number>` lookup (#356 item 1)
- **Rejection sample size constant** — extracted inline `SAMPLE_SIZE = 20` to file-level `REJECTION_SAMPLE_SIZE` for consistency (#356 item 6)

- `writeJsonFileAtomically` no longer performs a pre-delete before the atomic rename, closing a window where a crash between `rm` and `rename` could leave a discovery artifact missing entirely (#316)
- `swapActivationRuntimeRoot` now surfaces rollback failures via `AggregateError` when both the apply and the restore rename fail, preventing the runtime root from being silently left in a missing state (#317)
- `readSharedMcpAssetIds` validates that `pkg.manifestPath` stays within the install root before reading, closing a path-traversal risk via tampered bundle manifests (#318)
- Extension-ID parsing in `verifyVsCodeExtensionInstalled` now strips only the trailing `@version` suffix instead of splitting at the first `@`, so scoped extension IDs are no longer truncated (#319)
- `writeJsonLinesFile` no longer performs a pre-delete before the atomic rename, closing the same window as #316 for all catalog JSONL output files — `catalog.assets.jsonl`, `catalog.selected.jsonl`, and `catalog.rejected.jsonl` (#306)
- Publisher name for VS Code Marketplace extensions is now resolved from the per-extension `publisher.publisherName` field harvested at sync time rather than the source-level publisher override, so extensions from non-Microsoft publishers are correctly attributed (#300)
- `install refresh` no longer crashes with ENOENT on a clean checkout: missing `mirror/bundles/*.lock.json` files are now gracefully skipped during `resolveBundleLocks` (#298)
- `setup doctor` now runs all host-adapter preflights concurrently and enforces a per-adapter wall-clock timeout (default 5 s, configurable via `AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS`), preventing a blocked CLI probe from hanging the entire command (#302)
- `recommend report` now fails immediately with a clear error when `catalog.selected.jsonl` is absent or empty, instead of hanging for 10+ seconds against an empty dataset; the error message directs users to run `discover full` or `discover select` first (#303)
- `synonymLookup` map is now built once per recommendation report instead of once per candidate entry, eliminating an O(tokens × synonyms) hot path that caused `recommend report` to stall for 81 s on real 2,000-entry catalogs (#299, #321)
- Packagist PHP entries no longer rank in the top results for TypeScript/Node workspaces: the ecosystem-affinity mismatch penalty is now doubled (2×) when the workspace has package-manager signals and none match the candidate registry's ecosystem (#278)
- Per-source entry cap enforced in `discover select`: no single source may contribute more than `AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE` (default 200) entries to the selected catalog; excess entries are logged as `"source-cap"` rejections; a `sourceDiversityWarning` field is emitted when any source still exceeds 20% after capping (#304)
- `assertRecommendationReport` backfill shim is now documented as a legacy-only compatibility path; fresh report writes are validated for the `recommendations` key before the validator runs, so write-path regressions are immediately visible in tests (#283)
- Agent coding conventions and contributor guidance added to `CONTRIBUTING.md` (not `AGENTS.md`, which is gitignored) (#322)
- `docs/guides/TROUBLESHOOTING.md` created, covering host CLI setup, version failures, doctor hang, install ENOENT, concurrent-write safety, and Packagist asset dominance; linked from README (#305)

- `wire opencode --apply` idempotently writes `.opencode/.gitignore` listing `node_modules`, `package-lock.json`, `bun.lockb`, `yarn.lock`, and `pnpm-lock.yaml` before OpenCode starts, ensuring its overlay scanner skips npm install artefacts and eliminating ~800 spurious `OVERLAY:` log lines per run (#282)
- Go module index cursor now encodes `timestamp|lastSeenPath` (pipe-delimited) instead of a bare timestamp, eliminating the gap-or-duplicate hazard when multiple modules share the same timestamp at a page boundary; legacy bare-timestamp cursors are transparently upgraded on first resume
- npm changes-feed adapter now calls `deleteIndexedCatalogEntry` for rows with `deleted: true`, immediately removing stale catalog entries instead of leaving them until the never-firing prune-on-complete path
- improved release synchronization, version-check, GitHub resilience, guarded HTTP, path/file, native wire, install refresh, mirror acquisition, and recommendation validation regression coverage with deterministic tests
- `evidence.classification` is now populated for all harvested assets — `buildClassificationConfidence` synthesizes classification evidence from the asset's known `assetKind` so the field is never `null` in catalog output (#301)
- GitHub harvester now emits an `oms-trust-anchor` repo-level trust signal when `nv-agent-root-cert.pem` is detected, and a per-asset `oms-signed` signal when a sibling `skill.oms.sig` file is present; trust-score effects are `+3` and `+5` respectively (#315)
- `discover index` command added as a dedicated catalog-index build step — writes `catalog-index.jsonl` plus a freshness-aware meta companion; `discover sync` reuses a fresh index when it is within `AGENT_HARNESS_DISCOVERY_INDEX_MAX_AGE_DAYS` (default 7) rather than re-harvesting from scratch; raised `AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_FOR_INDEX_BUILD` default to 500 for index-build runs (#289)
- VS Code Marketplace harvesting now runs a popularity-first sweep (top installs by count) ahead of the alphabetical demand-query loop, and a category-sweep phase driven by workspace demand → VS Code category taxonomy mappings; both phases are runtime-configurable via `AGENT_HARNESS_VSCODE_MARKETPLACE_POPULARITY_SWEEP_PAGES` and `AGENT_HARNESS_VSCODE_MARKETPLACE_CATEGORY_SWEEP_ENABLED` (#290, #291)
- Official skills index expanded from 1 to 16 entries; `AGENT_HARNESS_OFFICIAL_INDEX_MAX_ITEMS_PER_INDEX` enforces a per-index cap (0 = unlimited) to prevent runaway harvesting from large official feeds (#292)
- `discover/source-packs/official.json` seeded with 12 high-value MCP vendor entries (Anthropic, Stripe, Cloudflare, Supabase, GitHub, Sentry, Docker, Linear, Notion, Resend, Postmark, Braintrust); `authorityTier` and `assetKinds` are now required fields on all source-pack entries; a `scripts/seed-source-packs.ts` seeding automation and matching guide doc added (#293)
- Six new official source-pack entries covering `google/gemini-cli-extensions`, `/sre`, `data-agent-kit`, `conductor`, `NVIDIA/skills`, and `solana-foundation/pay-skills`; new `"payable-api"` and `"acp-agent"` asset kinds added to the `AssetKind` union and validated constants (#307, #308, #309, #310, #311, #313)
- Host surface gaps documented across Cursor, Windsurf, Cline, JetBrains, Zed, and Copilot plugin compatibility; `HOST-SURFACE-AUDIT.md` updated; VS Code extension compatibility notes, ACP/forwarding notes, and Claude-plugin schema notes added to support-matrix and README (#314)
- `AssetCatalogEntry.compatibleHosts` field introduced; compatibility matrix derives cross-host support from asset kinds during harvesting; recommendation selection respects `compatibleHosts` when filtering candidates for each target host (#312)
- Semantic similarity scoring added as an optional selection filter — `SemanticScorer` uses `@xenova/transformers` (optional peer) with cosine similarity and `fit.fitLevel` tagging (`"strong" | "moderate" | "weak" | "none"`); falls back to keyword-overlap gating when the runtime dependency is unavailable; configurable via `AGENT_HARNESS_DISCOVERY_SEMANTIC_SCORING` and `AGENT_HARNESS_DISCOVERY_MIN_SIMILARITY` (#294)
- Registry metadata enrichment for 7 additional registries — static adjacent-tooling matrix and live search APIs for crates.io, NuGet, Maven, Packagist, RubyGems; `AssetEvidence` extended with `discoveryMethod` field (#295)

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
