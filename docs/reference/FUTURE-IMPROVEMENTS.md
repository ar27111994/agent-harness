# Future Improvements

This file tracks optional future improvements for `agent-harness` beyond the currently implemented lifecycle.

> **v2.0.0 update (2026-06-01):** The v2.0.0 wave advanced items 5, 6, 7, 8, 9, 11, 12, 16, and 17 (see per-section notes below). Items marked **Implemented** or significantly narrowed in scope by v2.0.0 work are noted inline. All other status labels reflect the post-v2.0.0 assessment baseline.

The project already implements the full supply-chain flow:

1. Discover
2. Mirror
3. Install
4. Activate
5. Wire

The suggestions below are refinements, enhancements, and operational improvements that can make the system more complete, more explainable, and more production-ready.

Status labels:

- **Implemented** - the original gap is largely closed and only follow-on polish remains
- **Partial** - meaningful infrastructure exists, but the area is still incomplete
- **Future** - still genuinely forward-looking work

---

## 1. Universal official-upstream resolution

**Status:** Partial

### Official-upstream resolution current state

- Many `officialskills.sh` entries already resolve toward repo-backed canonical sources.
- Not every official skill page is guaranteed to map to a fully resolved upstream artifact path yet.

### Official-upstream resolution value

- Official indexes are useful for discovery, but repo-backed upstreams should remain canonical.
- Better upstream resolution improves mirror fidelity, provenance, and install quality.

### Official-upstream resolution next steps

- Extract and cache upstream repo links from every `officialskills.sh` page.
- Persist owner/slug → repo mapping for reuse across runs.
- Fall back to repo search only when page-level upstream extraction fails.
- Prefer repo-native artifacts over metadata-only index entries everywhere.
- Track unresolved official index entries separately for follow-up.

---

## 2. Richer host profile/workspace overlays

**Status:** Partial

### Overlay planning current state

- Activation is host-intent-aware.
- Overlay plans exist for OpenCode, Copilot, shared runtime, Cursor, Zed, Claude Code, and Pi.
- Copilot activation is recommendation-informed and budget-aware.
- Cursor, Zed, Claude Code, and Pi have project-local native auto-wiring backed by the host adapter registry.
- Each registered host has an independent recommendation policy override, even when it reuses a Copilot-compatible or OpenCode-compatible lifecycle host for install materialization.

### Overlay planning value

- Copilot benefits from smaller, more focused active sets.
- Richer workspace/profile overlays can significantly reduce context overhead.

### Overlay planning next steps

- Generate named Copilot profiles automatically from workspace evidence.
- Add per-workspace overlay manifests.
- Support stack-specific overlay modes such as:
  - frontend
  - backend
  - infra
  - security
  - docs
  - test
- Support task-mode overlays for focused sessions.
- Add session-intent-aware activation planning.
- Add profile diff and preview commands before switching.

---

## 3. Dedicated quarantine review workflow

**Status:** Partial

### Quarantine workflow current state

- Mirror routes risky assets and prompt-injection-like community content into `mirror/quarantine`.
- Install and activation skip quarantined entries.
- `quarantine list`, `quarantine inspect`, `quarantine approve`, and `quarantine reject` commands exist.
- Review decisions, reasons, and timestamps are recorded under `state/quarantine/reviews.jsonl`.
- Approval promotes a quarantined mirror entry to `approved-with-warning`.

### Quarantine workflow value

- Risk routing is more useful when it is reviewable and promotable.

### Quarantine workflow next steps

- Add richer interactive review UI/report output.
- Add policy-specific prompt-injection classifier tuning.
- Add reviewer identity and optional signed review attestations.
- Add quarantine diffing and batch review helpers.

---

## 4. Stronger community trust scoring

**Status:** Partial

### Community trust scoring current state

- Trust scoring already uses authority, source type, docs/readme, stars, maintenance cadence, install method, and risk penalties.

### Community trust scoring value

- Community sources vary widely in quality and safety.
- Richer trust scoring improves curation quality and recommendation accuracy.

### Community trust scoring next steps

- Add commit recency and release cadence.
- Add contributor diversity signals.
- Add issue/PR health signals.
- Add security policy presence.
- Add test/workflow presence.
- Add license confidence and compatibility checks.
- Add signed release / provenance signals where available.
- Model endorsement signals from trusted indexes or official docs.

---

## 5. Better source classification and evidence-weighted parsing

**Status:** Partial _(v2.0.0: evidence-weighted asset-kind inference and classification confidence scores now emitted by the discovery pipeline — see #264)_

### Source classification current state

- Classification still relies partly on path-based heuristics.

### Source classification value

- Many ecosystems express skills, agents, and workflows differently.
- Better parsing reduces false classification and improves host-fit.

### Source classification next steps

- Add schema-aware parsing for known formats.
- Add frontmatter-driven classification where possible.
- Add repo-tree pattern recognition.
- Add source-family-specific classifiers.
- Add evidence-weighted asset-kind inference.
- Add confidence scores per classification decision.

---

## 6. Better remote harvesting resilience

**Status:** Partial _(v2.0.0: source/catalog health doctor reports, candidate source queue instrumentation, and operator-facing degraded-mode summaries added — see #242, #245, #261)_

### Remote harvesting current state

- GitHub PAT support exists.
- Rate-limit fallback to cache exists.
- Remote discovery is checkpointed.
- GitHub fetches now have retry/backoff, persisted source-health state, degraded summaries, and cache-backed fallback behavior covered by targeted regression tests.

### Remote harvesting value

- Remote ecosystems are noisy and rate limits happen.
- Better resilience improves reproducibility and long-running rebuilds.

### Remote harvesting next steps

- Add fallback metadata paths for sources that fail REST API fetches.
- Add periodic refresh TTLs for cached remote snapshots.
- Expand degraded-mode behavior beyond GitHub-backed sources where it is justified.
- Add operator-facing summaries that make unhealthy-source triage easier during large sync runs.

---

## 7. Bundle explainability and reasoning reports

**Status:** Partial _(v2.0.0: discover diff summaries and explainability commands for unknown workspace-signal backlog, scheduled maintenance, and discover diff now added — see #240, #247, #262, #263)_

### Bundle explainability current state

- Selection reports and recommendation reports exist.
- Overlay plans exist.
- Explain commands already exist for recommendation, install, activation, and mirror inspection paths.

### Bundle explainability value

- Users need to understand why assets are selected, mirrored, installed, or activated.

### Bundle explainability next steps

- Add `why selected` and `why rejected` explanations per asset.
- Add `why in bundle` explanation output.
- Add `why active now` explanation output.
- Add `bundle explain <bundleId>` command.
- Add provenance chain summary from discover → mirror → install → activate.

---

## 8. Better generation management

**Status:** Partial _(v2.0.0: scheduled maintenance-bot workflows and maintenance command surface added — see #246)_

### Generation management current state

- Deterministic install generations exist.
- Rollback exists.
- Generation listing, diffing, pinning, and pruning commands already exist.

### Generation management value

- Long-lived systems accumulate generations and need lifecycle control.

### Generation management next steps

- Add rollback summary reports.
- Add generation validation and integrity checks.
- Add richer policy-driven pruning/blessing workflows beyond the existing command surface.

---

## 9. Full diff/report commands across phases

**Status:** Partial _(v2.0.0: `discover diff` summaries added — see #247; the remaining gaps are `mirror diff` rich delta reports and cross-phase change summaries)_

### Diff and report commands current state

- `mirror diff`, `install diff`, and `activate diff` already exist.
- The remaining gap is mainly around `discover diff`, richer recommendation deltas, and higher-level cross-phase change summaries.

### Diff and report commands value

- Supply-chain style tooling benefits from visibility into what changed between runs.

### Diff and report commands next steps

- `discover diff`
- `mirror diff`
- `install diff`
- `activate diff`
- report changes since last rebuild
- per-host bundle deltas
- recommendation delta reports

---

## 10. Better package-registry harvesting

**Status:** Partial

### Package-registry harvesting current state

- Package registry sources exist in the source registry.
- Discovery is still GitHub-heavy overall, but direct npm/PyPI metadata and search harvesting already exist for important source families.

### Package-registry harvesting value

- Some important MCP servers and tools are better represented in package registries than repos.

### Package-registry harvesting next steps

- Direct npm package metadata harvesting.
- Direct PyPI metadata harvesting.
- Direct Cargo / NuGet / Open VSX harvesting where relevant.
- Package → repo / docs reconciliation.
- Better package provenance and release integrity modeling.

---

## 11. Stronger activation planning

**Status:** Partial _(v2.0.0: named activation budget constants added for all host adapter paths; session-intent-aware and dynamic budget pruning remain future work)_

### Activation planning current state

- Activation is generation-aware, host-aware, recommendation-aware, and budget-aware.

### Activation planning value

- Final runtime behavior is where context budgets matter most.

### Activation planning next steps

- Session/task-intent-aware activation.
- Dynamic asset pruning by prompt budget.
- Workspace overlays tied to active repo characteristics.
- Split overlays by concern: frontend/backend/security/docs/test/etc.
- Richer per-host bundle routing beyond the current adapter default bundle lists.
- Richer OpenCode global-harness vs task-harness activation choices.

---

## 12. Test suite and validation harness

**Status:** Partial _(v2.0.0: 100% statement/branch/function/line gate now enforced in CI and verified locally; branch-residual suites added for all major domains; v2.1.0 extended the gate to the live-fetch sync/harvest paths with mocked-HTTP contract tests)_

### Test harness current state

- The repo now has a broad automated test suite, coverage reporting, explicit coverage thresholds, smoke checks, recommendation fixture evaluation, detection quality reporting, and a dedicated self-hosting integration suite.
- Remaining work is mostly about raising thresholds further, expanding targeted regression depth, and adding more performance-focused or visualization-oriented validation layers.

### Test harness value

- Selection, trust scoring, dedupe, and activation logic benefit from regression tests.

### Test harness next steps

- Raise coverage thresholds over time instead of letting the initial baselines stagnate.
- Add more focused trust-scoring and source-health regressions.
- Expand golden coverage for lockfile and overlay outputs where snapshots stay stable.
- Add more performance-sensitive and large-input validation for expensive lifecycle phases.

---

## 13. Performance optimization

**Status:** Partial

### Performance optimization value

- Catalogs and mirrors can get large quickly.
- Rebuild performance matters for operational usability.

### Performance optimization next steps

- Lower-memory catalog processing.
- Parallel remote fetching where safe.
- Smarter incremental rebuilds.
- Better chunking for mirror/install/activate.
- Faster cache reuse and invalidation.

---

## 14. Promotion workflow for community assets

**Status:** Partial

### Promotion workflow current state

- Community assets are catalog-only unless promoted by policy.

### Promotion workflow value

- Promotion should be explicit, reviewable, and reproducible.

### Promotion workflow next steps

- Promotion manifest file(s).
- Reviewed promotion history.
- Promotion diff view.
- Source-specific promotion confidence notes.
- Separate `community-stable` vs `community-experimental` promotion tracks.

---

## 15. Visual reports and dashboards

**Status:** Future

### Visual reporting value

- Large agent ecosystems are easier to manage with visual summaries.

### Visual reporting next steps

- HTML dashboard for source coverage.
- Trust distribution report.
- Active bundle composition dashboard.
- Mirror/install health dashboard.
- Generation timeline report.
- Quarantine summary report.

---

## 16. Better operating docs

**Status:** Partial _(v2.0.0: workspace evolution, maintenance, quarantine, safe-default, trust-center, host support matrix, v1-to-v2 upgrade, release-process, and reproducible demo docs added — see #239, #248, #252, #254, #255, #256, #258, #259)_

### Operating docs current state

- README and implementation plan exist.
- Dedicated playbooks now exist for agent setup, discovery breadth, demand detection, source coverage, AI enrichment, asset updates, recommendation policy tuning, and logging strategy.

### Operating docs value

- Operational clarity reduces misuse and drift.

### Operating docs next steps

- “Promote official source” guide.
- “Quarantine review” guide.
- “Rollback generation” guide.
- “How Copilot overlays are chosen” guide.
- “How project-local native host wiring works” guide covering Cursor, Zed, Claude Code, and Pi.
- A concise contributor guide for reading coverage reports and self-hosting outputs.

---

## 17. RLM-native external environment architecture

### RLM environment architecture current state

- The lifecycle is already cleanly separated into discover, mirror, install, activate, and wire.
- Catalog and activation logic still optimize primarily for canonical selection, host fit, and prompt-budget-aware active sets.
- The system does not yet emit a first-class external environment that a runtime can query symbolically or recursively.

### RLM environment architecture value

- Recursive Language Models (RLMs) shift long-context handling away from stuffing or compacting prompts and toward querying an external environment.
- `agent-harness` is well-positioned to become the system that builds that trusted external environment.
- This preserves the repo's core value even if host runtimes reduce their dependence on narrow context-window activation.

### Strategic goal

Evolve `agent-harness` from a host-specific asset activation pipeline into a trusted context substrate that:

- discovers and normalizes canonical agent assets
- mirrors them with provenance and immutable structure
- installs queryable environment backends in addition to staged host bundles
- activates host overlays as one projection of a broader external environment

### Repo-specific implementation plan

#### Milestone 1. Query-ready discovery model

Goal: extend discovery outputs so assets are not only installable, but also queryable and expandable by an external runtime.

Suggested work:

- Add environment-oriented metadata to asset types:
  - symbolic handles
  - retrieval facets
  - chunking hints
  - relationship edges
  - citation metadata
  - environment safety flags
- Add a new discover artifact for query-time consumption, such as:
  - `discover/output/environment-index.json`
  - `discover/output/environment-graph.jsonl`
- Track canonical aliases across instructions, skills, agents, workflows, docs, and packages.
- Score assets partly on retrieval quality and provenance, not only prompt weight.

Primary file touch points:

- `src/types.ts`
- `src/discover.ts`
- `src/recommend.ts`
- `discover/schema/asset-catalog-entry.schema.json`
- `discover/schema/selection-report.schema.json`
- `discover/recommendation-policy/base.json`

Success criteria:

- Every selected asset can describe how it should be queried, cited, and expanded.
- Discovery emits at least one environment-specific output in addition to the existing catalog and selection files.

#### Milestone 2. Immutable mirror environment artifacts

Goal: make mirror produce immutable, provenance-preserving environment units rather than only raw packageable files.

Suggested work:

- Extend mirrored artifacts to include:
  - normalized chunks
  - citation spans
  - relationship sidecars
  - optional retrieval-ready derived files
- Add mirror index fields for environment artifact status and provenance chain completeness.
- Keep raw source material intact while generating normalized environment derivatives alongside it.

Primary file touch points:

- `src/mirror.ts`
- `src/types.ts`
- `mirror/schema/mirror-index-entry.schema.json`
- `mirror/schema/bundle-lock.schema.json`
- `mirror/policy.json`

Success criteria:

- A mirrored asset can be reconstructed back to upstream content and also consumed as a normalized query unit.
- Mirror outputs remain deterministic and auditable.

#### Milestone 3. Queryable install backend

Goal: install a host-agnostic external environment backend in parallel with host-specific staged packages.

Suggested work:

- Add an install projection for environment backends, for example:
  - JSONL manifest store first
  - SQLite FTS store later
  - optional vector sidecar only when explicitly enabled
- Separate host runtime packages from shared environment data.
- Track environment generation manifests next to existing install generations.

Primary file touch points:

- `src/install.ts`
- `src/pipeline.ts`
- `src/types.ts`
- `install/generations/`
- `state/install/progress.json`

Success criteria:

- A full pipeline run produces both host install packages and a reusable external environment store.
- Environment generations can be diffed and rolled back independently of host overlays.

#### Milestone 4. Hybrid activation and host adapters

Goal: keep current activation behavior for constrained hosts while enabling hybrid or external-environment-first runtime modes.

Suggested work:

- Extend activation manifests to distinguish:
  - always-loaded assets
  - queryable-on-demand assets
  - blocked or policy-gated assets
  - environment runtime mode
- Add hybrid activation modes that prefer smaller overlays plus richer external environment references.
- Keep budget-aware overlay generation for hosts that are not RLM-capable.

Primary file touch points:

- `src/activate.ts`
- `src/workspace.ts`
- `src/pipeline.ts`
- `src/host-adapters/opencode.ts`
- `src/host-adapters/vscode.ts`
- `src/host-adapters/native-wire.ts`
- `activate/`

Success criteria:

- Activation can target classic overlay mode and hybrid external-environment mode without breaking current workflows.
- Host wire-in remains deterministic and backwards compatible.

#### Milestone 5. Governance, policy, and evaluation for recursive access

Goal: add the controls needed before any host relies on recursive or code-driven context access.

Suggested work:

- Add policy concepts for:
  - allowed query operations
  - recursion depth caps
  - subcall budgets
  - provenance requirements
  - environment safety levels
- Add fixture-backed evaluation for:
  - retrieval precision
  - citation fidelity
  - provenance preservation
  - hybrid activation correctness
  - cost and budget enforcement

Primary file touch points:

- `src/recommend.ts`
- `src/types.ts`
- `discover/recommendation-policy/base.json`
- `discover/recommendation-policy/hosts/*.json`
- `src/manifest-validation.ts`
- `README.md`
- `IMPLEMENTATION-PLAN.md`

Success criteria:

- The repo can explain why a given asset is always-loaded, queryable, or blocked.
- Regression tests protect the environment layer from quality or governance drift.

### Proposed CLI surface

These commands should be additive and should not replace the current discover, mirror, install, and activate commands.

#### Discover

- `agent-harness discover environment-index`
  - builds the query-ready environment index from the selected catalog
- `agent-harness discover environment-graph`
  - emits relationship edges and canonical aliases across assets
- `agent-harness discover inspect --asset <asset-id> --environment`
  - explains chunking, query facets, and citation coverage for an asset

#### Mirror

- `agent-harness mirror environment`
  - materializes normalized chunks, citation maps, and derived environment artifacts
- `agent-harness mirror explain --asset <asset-id>`
  - shows raw upstream path, normalized derivatives, and provenance chain

#### Install

- `agent-harness install environment --backend jsonl`
- `agent-harness install environment --backend sqlite`
- `agent-harness install environment:diff --from <generation> --to <generation>`

#### Activate

- `agent-harness activate host --host opencode --runtime-mode overlay` _(proposed)_
- `agent-harness activate host --host opencode --runtime-mode hybrid` _(proposed)_
- `agent-harness activate host --host copilot-vscode --runtime-mode overlay` _(proposed)_
- `agent-harness activate explain --host <host>`
  - explains what is always-loaded versus queryable on demand

#### Cross-phase environment operations

- `agent-harness environment explain --asset <asset-id>`
  - summarizes discover → mirror → install → activate environment state
- `agent-harness environment diff --from <generation> --to <generation>`
  - compares environment generations independent of host package generations

### Recommended delivery order

If this strategic direction is pursued, the most practical order is:

1. Query-ready discovery model
2. Immutable mirror environment artifacts
3. Queryable install backend
4. Hybrid activation and host adapters
5. Governance and evaluation for recursive access

### Near-term first slice

The lowest-risk first implementation slice is:

1. extend `AssetCatalogEntry` and related schemas with query-oriented metadata
2. emit `environment-index.json` from discover
3. add a read-only `discover environment-index` CLI command
4. keep mirror, install, and activation behavior unchanged until the new discover artifact is stable

This preserves current behavior while creating the foundation for an RLM-native evolution path.

---

## Recommended priority order

If only a few future improvements are pursued next, the strongest order is:

1. Universal official-upstream resolution
2. Richer Copilot profile/workspace overlays
3. Dedicated quarantine review workflow
4. Stronger community trust scoring
5. Test suite and diff/explainability tools
