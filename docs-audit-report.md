# agent-harness Documentation Audit Report

**Repository:** `C:\Projects\agent-harness` (v2.0.0)
**Audit date:** 2026-07-28
**Scope:** README.md, docs/ directory, CHANGELOG.md, AGENTS.md, `--help` accuracy, JSDoc coverage

---

## 1. DOCS THAT EXIST AND ARE GOOD

### README.md (1,948 lines)

- Extremely comprehensive: project description, badges, TOC, lifecycle model, host matrix, ARD interoperability, quick start, usage examples, command reference (for most commands), per-host wire-in details (7 hosts), discovery/recommendation architecture, environment variables (30+), generated files listing, repo structure diagram, dev/validation workflow, troubleshooting, FAQ (12 items), security/trust section, boundaries, related docs index.
- Every doc in `docs/` is linked to from the README.
- Includes a verified host-support matrix with known limitations per adapter.
- References official host documentation URLs.

### CHANGELOG.md (377 lines)

- Well-structured: `[Unreleased]`, `[2.0.0]` (with breaking changes called out), and historical entries.
- Each entry has a ticket reference (`#348`, `#349`, etc.).
- Breaking changes section is clearly separated.
- Good level of detail: describes what changed, why, and impact.

### AGENTS.md (102 lines)

- Well-structured contributor guidance: project overview, quick-start commands, coding conventions, safety rules, key directories table.
- Includes auto-generated host overlay blocks (OpenCode, Pi) from wire-in.
- Good discoverability at point-of-use for AI coding agents.

### docs/ directory structure (27 files, 4 subdirectories)

Well-organized:

- **demo/** (3 files) — README, walkthrough, demo script
- **guides/** (12 files) — maintenance, troubleshooting, V1→V2 upgrade, release process, logging strategy, safe defaults, V2 contract, trust center, etc.
- **playbooks/** (9 files) — agent setup, discovery breadth, demand detection, source coverage, AI enrichment, asset update, recommendation policy, workspace evolution, quarantine
- **reference/** (8 files) — coverage roadmap, demand-detection coverage, future improvements, host surface audit, implementation plan, roadmap, registry enrichment, source-sync decomposition

### CLI `--help` Output

- Comprehensive nested help: `agent-harness --help`, `agent-harness discover help`, `agent-harness mirror help`, `agent-harness stage help`, etc.
- Every domain has organized subcommands.
- Global options (`--state-root`, `--no-dotenv`) are documented.
- Options sections per subcommand group.
- The actual CLI binary reports correct behavior (verified: `agent-harness wire --help`, `setup doctor`, `mirror help`, etc.).

### JSDoc on Type Definitions

- **Excellent** coverage on `src/types/` files: `core.ts`, `catalog.ts`, `discovery.ts`, `recommendation.ts`, `activation.ts`, `install.ts`, `mirror.ts`, `quarantine.ts` — every exported type, interface, and function has a `/** */` comment.
- Key command-dispatch functions (`runWire`, `runWorkspace`, `runDiscover`, `runInstall`, `runActivate`, `runSetup`) all have descriptive JSDoc.
- `cli-output.ts`, `runtime.ts`, `env-file.ts` — well-documented exports.

### CONTRIBUTING.md (229 lines)

- Clear scope, development setup, guidelines, testing requirements, and PR workflow.
- References to relevant reference docs.

### Individual Docs Quality

- **TROUBLESHOOTING.md** — good; covers common failure modes per command
- **SAFE-DEFAULTS.md** — excellent structured table of safe defaults by area
- **V2-CONTRACT.md** — clear compatibility rules, exit codes, preview/apply semantics
- **HOST-SURFACE-AUDIT.md** (23,340 bytes) — detailed classification matrix per host surface
- **QUARANTINE-PLAYBOOK.md** — clear lifecycle states and transition scenarios

---

## 2. DOCS THAT EXIST BUT ARE STALE / WRONG / INCOMPLETE

### README vs `--help` — Command Reference Gaps

The README's "Command reference" section (lines 518-845) is styled as usage examples rather than a complete reference. Several commands present in `--help` are missing or under-documented:

| CLI `--help` command                          | README status                                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `mirror plan`                                 | Only mentioned as npm script, not as CLI command                                                                      |
| `mirror diff`                                 | Only one-line mention                                                                                                 |
| `mirror explain --mirror <mirrorId>`          | Only documents `--asset` flag                                                                                         |
| `bundle explain <bundleId>` (top-level)       | Not mentioned at all                                                                                                  |
| `discover index`                              | Only in prose (lines 358-388), not in command reference                                                               |
| `discover inspect`                            | **Not mentioned at all**                                                                                              |
| `discover enrich`                             | Only in prose, not in command reference                                                                               |
| `discover recall` / `discover candidate-pool` | Only in prose aliases                                                                                                 |
| `stage diff`                                  | **Not in README command reference**                                                                                   |
| `stage explain`                               | **Not in README command reference**                                                                                   |
| `stage generations`                           | **Not in README command reference**                                                                                   |
| `stage reset`                                 | Only as npm script                                                                                                    |
| `recommend evaluate`                          | Only as npm script                                                                                                    |
| `recommend policy:print`                      | In `recommend help` but **not in top-level `--help`**. README mentions it; CLI supports it. Minor top-level help gap. |
| `setup login`                                 | Only in prose examples, not in formal reference                                                                       |
| `doctor` (alias)                              | Not mentioned                                                                                                         |
| `quarantine list/inspect/approve/reject/pin`  | In README prose (lines 707-714) but not in command reference section                                                  |

### README Redundancy & Organization

- At 1,948 lines, the README serves as both introduction AND full manual. This makes it hard to scan for CLI newcomers.
- The "Host wire-in details" section (lines 849-1262) is detailed enough to be its own `docs/` document, yet lives entirely in the README.
- Some cross-reference links use absolute GitHub URLs (`https://github.com/ar27111994/agent-harness/blob/main/...`) which will break if the repo is forked or offline.

### HEARTBEAT.md, IDENTITY.md, TOOLS.md, USER.md, SOUL.md

- These are template/stub files (agent-workspace scaffolding), not meaningful project documentation.
- They exist at project root but are not referenced from README or AGENTS.md — unclear purpose.

### SECURITY.md

- Present and valid. Not stale.

---

## 3. DOCS THAT ARE MISSING

### Structural gaps

- ~~**No `docs/README.md`** — FIXED: `docs/README.md` index now exists with full navigation across all 4 subdirectories.~~
- **No CLI cheat sheet or quick-reference card** — a concise one-page command summary would help newcomers.
- **No "Creating a new host adapter" guide** — the developer docs describe contributing in general but lack a step-by-step for adding a new host adapter.
- **No schema documentation** — 10+ JSON schema files exist in `discover/schema/` and `mirror/schema/` with no human-readable explanation of their structure/purpose.
- **No `discover inspect` documentation** — this CLI command has zero documentation anywhere.

### Command-specific gaps

- `mirror plan` — no dedicated doc (only `--help`)
- `mirror diff` — no dedicated doc
- `discover index` — documented in README prose but deserves a dedicated guide section
- `stage diff`, `stage explain`, `stage generations` — zero documentation beyond `--help`
- `stage reset` — no safety guidance for destructive operation

### Process / Policy docs

- **No bake-in/validation checklist** for checking that mirrored assets produce working installs
- **No guide for tuning recommendation limits** — documented in env vars but no worked examples

---

## 4. DISCOVERABILITY ISSUES

### Point-of-use doc discovery

- **No `--help` produces context-aware doc references.** `--help` lists commands but never says "see docs/guides/xxx.md for details."
- **No man page or `--man` flag.**
- **All doc links in README use absolute GitHub URLs** instead of relative paths — this breaks offline, in forked repos, and for local `file://` viewing.
- README's "Key Playbooks" list (lines 92-111) links to specific docs in the middle of the file rather than at a consistent "Reference" section.

### docs/ directory itself

- **Inconsistent naming:** `V2-CONTRACT.md` vs `V2-CONTRACT.md` (caps) alongside `SOURCE-SYNC-DECOMPOSITION-PLAN.md` — some use title case, others all-caps slug style.
- **No categorization metadata** — playbooks/guides/reference split is clear; a `docs/README.md` index (now present) addresses this.
- **RECOMMENDATION-POLICY-PLAYBOOK.md** references `policy:print` which is not in `--help` — dead link at point-of-use.

### JSDoc discoverability

- **JSDoc on exported symbols is good, but internal functions are mostly undocumented.**
- Some exports lack JSDoc in key modules (e.g., `parseGlobalOptions`, `isHelpRequest`, `isVersionRequest` in `cli.ts` — all module-internal but noted for completeness).
- The `src/install.ts` and `src/mirror.ts` dispatcher functions have JSDoc but their sub-command handlers (in subdirectories) have inconsistent coverage.

---

## 5. SPECIFIC ISSUES REQUIRING ATTENTION

| #   | Issue                                                                                                            | Severity                   | Suggested fix                                                |
| --- | ---------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------ |
| 1   | `recommend policy:print` in `recommend help` but missing from top-level `--help`. README mentions it; CLI works. | **Medium** — inconsistency | Add to top-level `--help` output                             |
| 2   | `discover inspect` in `--help` but zero documentation anywhere                                                   | Medium                     | Add README entry + docs snippet                              |
| 3   | `bundle explain` as top-level command in `--help` but not in README                                              | Medium                     | Document in README "Mirror" section                          |
| 4   | `stage diff`, `stage explain`, `stage generations` undocumented                                                  | Medium                     | Add to README "Stage / Install" section                      |
| 5   | ~~No `docs/README.md` index~~ — FIXED                                                                            | ~~Medium~~                 | ✅ Directory index created                                   |
| 6   | README absolute GitHub URLs break on fork/offline                                                                | Low                        | Convert to relative paths                                    |
| 7   | README is 1,948 lines — content could be split                                                                   | Low                        | Consider splitting host wire-in details into a dedicated doc |
| 8   | No adapter developer guide                                                                                       | Low                        | Create `docs/guides/ADAPTER-DEVELOPMENT.md`                  |
| 9   | Schema JSON files undocumented                                                                                   | Low                        | Create `docs/reference/SCHEMA-GUIDE.md`                      |
| 10  | JSDoc coverage on internal functions weak                                                                        | Low                        | Acceptable for TypeScript; no action needed                  |

---

## 6. OVERALL ASSESSMENT

| Category                | Rating          | Notes                                                   |
| ----------------------- | --------------- | ------------------------------------------------------- |
| README completeness     | ★★★★☆           | Very comprehensive; slightly bloated                    |
| docs/ organization      | ★★★★☆ (was 4/5) | Well-structured; index file now present                 |
| `--help` accuracy       | ★★★★☆           | Commands are correct; some undocumented in README       |
| CHANGELOG quality       | ★★★★★           | Excellent — detailed, referenced, structured            |
| JSDoc on public exports | ★★★★★           | Excellent on types, good on dispatchers                 |
| Discoverability         | ★★★☆☆           | No docs index, no man page, no `--help`→docs cross-refs |
| Missing docs            | ★★★☆☆           | A few command holes; nothing critical missing           |

**Bottom line:** The project has unusually thorough documentation for a v2.0.0 CLI tool. The main gaps are: (a) a few CLI commands undocumented in the README, (b) no `docs/` index, (c) a potentially dead `policy:print` reference, and (d) absolute URL breakage risk. None of these are blocking — the documentation quality is well above average for this project maturity.
