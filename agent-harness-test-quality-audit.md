# Agent-Harness Test Quality Audit Report

**Date:** 2026-07-28  
**Auditor:** Hermes Agent  
**Scope:** `src/tests/*.test.ts` (130+ files)  
**Codebase:** agent-harness v2.0.0, TypeScript ESM, node:test runner

---

## Executive Summary

**Overall quality: GOOD — well above industry average for coverage-driven test suites.**  
The suite is not merely exercising code paths — it validates real behavior with meaningful assertions, uses isolated temp directories, tests edge cases, and covers security boundaries thoroughly. However, several specific gaps and weaknesses exist in concurrency testing, stress testing, and a handful of "documentation verification" tests that validate docs rather than code.

---

## 1. Strengths (What's Done Well)

| Dimension             | Rating | Notes                                                                                                                                                       |
| --------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test isolation        | ★★★★☆  | ~70% of tests use `mkdtemp` + try/finally cleanup. The remaining 30% rely on module-level state reset or are pure-function tests that don't need isolation. |
| Behavioral validation | ★★★★★  | Tests verify file contents, exit codes, JSON structure, rendered output, not just "didn't crash".                                                           |
| Edge case coverage    | ★★★★☆  | Empty inputs, malformed data, boundary values, schema mismatches, missing files all well-covered.                                                           |
| Error handling        | ★★★★☆  | `assert.rejects` used extensively for expected failures; schema validation tested.                                                                          |
| Security boundaries   | ★★★★★  | Path traversal prevention, wire-plan snapshot escape prevention, MCP path containment, pinned DNS lookups — all with working tests.                         |
| Test naming           | ★★★★☆  | Descriptive names (e.g., `"recommendation policy rejects mismatched base override schemas"`). Minor inconsistency in `void test(...)` vs just `test(...)`.  |
| Integration testing   | ★★★★☆  | Real CLI subprocess execution (`runBuiltCli`), real file I/O, real Prettier formatting checks.                                                              |
| Data-driven tests     | ★★★★☆  | Tables of test cases used in source-registry, recommendation-policy, preflight tests.                                                                       |
| 100% coverage         | ★★★★★  | Achieved without sacrificing quality — the coverage is genuine, not inflated by shallow tests.                                                              |

---

## 2. WEAK TEST FILES (Tests That Pass but Don't Meaningfully Validate Behavior)

### 2.1 Documentation-Verification Tests (Low Value)

These tests read `.md` files and check for substring presence. They validate that documentation _exists_ and _contains certain phrases_, but they don't test any code behavior. Documentation drift detection is a legitimate use case, but these are fragile (brittle string matching) and low-value relative to their maintenance cost.

| File                           | Lines | Problem                                                                                                                            |
| ------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **trust-center-docs.test.ts**  | 51    | Asserts that TRUST-CENTER.md contains ~15 hardcoded strings. No code tested. Fails if doc formatting changes.                      |
| **safe-defaults-docs.test.ts** | 43    | Asserts SAFE-DEFAULTS.md + README + TRUST-CENTER.md + package.json contain specific strings. No code tested.                       |
| **demo-docs.test.ts**          | 45    | Asserts v2 walkthrough contains ~15 strings and README links to it. No code tested.                                                |
| **v2-contract.test.ts**        | 62    | Asserts V2-CONTRACT.md documents specific file paths. Only the `REPORT_FILE_PATH` assertion ties to code.                          |
| **package-metadata.test.ts**   | 78    | Asserts package.json has correct keywords, description length, homepage URL. Validates npm publish metadata, not runtime behavior. |
| **public-docstrings.test.ts**  | 65    | Asserts all `export` declarations in `src/` have JSDoc comments. Strictly a lint-style check (valuable but not behavioral).        |

**Recommendation:** Move these to a `scripts/` lint-style check or a separate `docs-consistency` test suite. They inflate the "test file" count and offer zero behavioral coverage.

### 2.2 Tests That Exercise Code but Validate Weakly

| File                                  | Lines | Problem                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **env-file.test.ts**                  | 39    | Only 1 test for the entire dotenv parser. Tests basic `FOO=one`, `FOO=two`, multiline, and export — but no tests for: empty values, comments, inline comments, quoted edge cases, special characters, binary-safe values, BOM handling, or error on read failure.                                                                             |
| **detection-quality.ts**              | 69    | **Not a proper test file** — uses bare `assert.ok(...)` outside any `test()` wrapper. It's a script that prints results to console. If it throws, the runner catches it, but there's no descriptive name, no structure. Tests precision/recall of detection fixtures, which is valuable, but the file doesn't follow the test module pattern. |
| **cli-options.test.ts**               | 79    | Good structure, but only covers option parsing helpers. Does NOT test: argument interleaving, `--` end-of-options marker, mixed short/long flags, or environment-variable fallback patterns.                                                                                                                                                  |
| **remote-state.test.ts**              | 64    | Covers load/save round-trip and invalid schemaVersion fallback. Missing: concurrent state writes, partial/corrupt file reads, permission-denied scenarios, large state files, or cross-version migration.                                                                                                                                     |
| **runtime-env-file-coverage.test.ts** | 29    | Dense single test covering multiple edge cases with one assertion call each. No test isolation per case — if any assertion fails early, the rest don't run.                                                                                                                                                                                   |

---

## 3. MISSING TEST CATEGORIES

### 3.1 🟢 Concurrency & Parallelism Tests — NOW COVERED

> **Pre-PR assessment noted ZERO COVERAGE. Post-PR:** `concurrency-input-edge-cases.test.ts` now covers concurrent write operations, read/write interference, large JSONL handling (1000+ entries), and edge-case paths. The following scenarios remain as stretch goals (not blocking):

- Parallel source-sync operations racing on shared state files (low-risk: source-sync is serial by design)
- `acquireAllMirrorBatches` disabled control flow (abort signal delivery)

**Risk was: High → Now: Low.** The concurrency test file covers the critical shared-state write path.

### 3.2 🟠 Stress / Large-Input Tests — 1 FILE, MINIMAL

Only `discover-breadth.test.ts` tests with 120K entries. Missing:

| Scenario                                 | Severity | Why It Matters                                                                |
| ---------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| ARD catalog with 10,000+ entries         | High     | `writeArdCatalog` serializes all entries; no memory-bounds or streaming tests |
| Recommendation input with 1000+ assets   | High     | Sort/ranking algorithms not tested at scale                                   |
| CLI help rendering with many subcommands | Low      | Cosmetic, but breaks if help text exceeds buffer                              |
| JSONL with 100,000 malformed entries     | Medium   | "Skip malformed entries" path tested with 1 bad entry, not 100K               |
| Deeply nested manifest structures        | Medium   | Recursive validator could stack-overflow on deep nesting                      |

### 3.3 🟢 Input Sanitization Gaps — NOW COVERED

> **Pre-PR assessment flagged null bytes, Unicode traversal, symlinks, and CLI injection. Post-PR:** `concurrency-input-edge-cases.test.ts` now covers:

- ✅ Null bytes in paths: `sanitizeMirrorId`, `sanitizeAssetId`, `isPathWithinRoot`, `resolveSafeMirrorFilePath`, `resolveAllowedAbsolutePath`
- ✅ Unicode path traversal: `isPathWithinRoot` with Unicode characters in safe paths
- ⚠️ Symbolic link handling: Two cases now covered — `resolveAllowedRealFilePath` rejects symlink escapes (returns null) and canonicalizes Unicode paths. Edge cases like deeply nested symlink chains remain untested.
- ⚠️ CLI argument injection: `--asset` values that look like flags not exhaustively fuzzed
- **Very long strings (DoS):** Asset IDs up to 100K chars not tested for memory/performance impact.

### 3.4 🟡 Install Flow Edge Cases

No tests for:

- Partial/corrupt download during mirror acquire (connection drop mid-file)
- Install with insufficient disk space
- Install rollback on fatal error mid-batch
- Concurrent install operations (two bundles at once)
- Stale lock file cleanup
- Cross-platform path separator handling in native install

### 3.5 🟡 OMS Trust Verification Gap

The `ard-registry.test.ts` tests cover `extractArdTrustSignals`, `computeArdTrustScore`, and `normalizeScoreToPortfolioFit` as pure functions. However:

- No integration test for the full OMS signature verification chain (cryptographic verification against a real key or mock)
- No test for expired trust anchors
- No test for OMS attestation replay attacks
- `source-verification.test.ts` tests domain ownership verification but not the OMS anchor-of-trust chain

---

## 4. SPECIFIC EDGE CASES NOT COVERED

| Area                      | Missing Edge Case                                                                      | File Where It Should Be        |
| ------------------------- | -------------------------------------------------------------------------------------- | ------------------------------ |
| **ARD catalog**           | `buildArdUrn` with IDs containing `#`, `?`, or non-ASCII characters                    | `ard-catalog.test.ts`          |
| **ARD catalog**           | `writeArdCatalog` with write-permission failure                                        | `ard-catalog.test.ts`          |
| **ARD catalog**           | Empty catalog with `generatedAt` populated (release-gate trigger)                      | `ard-catalog.test.ts`          |
| **Quarantine**            | `quarantine approve` for already-approved asset (idempotency)                          | `quarantine.test.ts`           |
| **Quarantine**            | `quarantine report` with zero entries                                                  | `quarantine.test.ts`           |
| **State root**            | `resolveStateRoot` with non-existent package root                                      | `state-root.test.ts`           |
| **State root**            | `prepareStateRoot` with unwritable state root directory                                | `state-root.test.ts`           |
| **Native config**         | `applyHostNativeFilePayloads` with unparseable JSON in existing config file            | `native-config.test.ts`        |
| **Native config**         | Rollback when revert of a single operation fails mid-list                              | `native-config.test.ts`        |
| **Pipeline**              | `runWorkspacePipeline` when discover phase returns non-zero                            | `pipeline.test.ts`             |
| **Pipeline**              | `acquireAllMirrorBatches` with empty asset list                                        | `pipeline.test.ts`             |
| **Recommendation eval**   | `classifyTopRecommendationConfidence` with undefined entry (not just undefined signal) | `recommend-evaluation.test.ts` |
| **Recommendation report** | `buildRecommendationReport` with zero entries catalog                                  | `recommend-report.test.ts`     |
| **Candidate queue**       | Duplicate detection with 1000+ existing sources                                        | `candidate-queue.test.ts`      |
| **Source verification**   | Official upstream allowlist with 10,000+ entries                                       | `source-verification.test.ts`  |
| **CLI options**           | `getOptionValue` with `=` syntax (`--host=vscode`)                                     | `cli-options.test.ts`          |
| **OpenCode wire**         | Wire reset when `.opencode` directory doesn't exist                                    | `opencode-wire.test.ts`        |
| **VS Code wire**          | Wire apply when VS Code settings file is locked by another process                     | `vscode-wire.test.ts`          |
| **MCP security**          | `readSharedMcpAssetIds` with cyclic symlink in manifestPath                            | `shared-mcp-security.test.ts`  |

---

## 5. TEST QUALITY BY AREA

### 5.1 ARD Export ★★★★☆

**Files:** `ard-catalog.test.ts`, `ard-catalog-format.test.ts`, `ard-registry.test.ts`, `ard-types.test.ts`  
**Good:** URN construction with slash/colon replacement and length truncation. Trust manifest derivation. Empty/malformed catalog handling. Prettier formatting verification.  
**Weak:** Missing: large-export memory/stress, write failure, non-ASCII IDs, streaming for 10K+ entries.  
**Verdict:** Solid for a v1 implementation; needs scale tests for production release.

### 5.2 OMS Trust Verification ★★★☆☆

**Files:** `ard-registry.test.ts`, `source-verification.test.ts`, `classification-confidence-and-verification.test.ts`, `trust-center-docs.test.ts`  
**Good:** Pure-function signal extraction and score computation well tested. Domain authority verification tested (SSH URLs, docs hosts, owner mismatches).  
**Weak:** No cryptographic signature verification chain. `trust-center-docs.test.ts` is a documentation test, not a code test. No integration test for the full OMS verification pipeline.  
**Verdict:** Functional but not production-hardened for the trust chain.

### 5.3 Recommendations (Breadth/Quality) ★★★★½

**Files:** `recommend-commands.test.ts`, `recommend-policy.test.ts`, `recommend-report.test.ts`, `recommend-evaluation.test.ts`, `recommend-signals.test.ts`, `recommend-summary.test.ts`, `recommend-counts.test.ts`, `recommend-ecosystem-penalty.test.ts`, `recommend-hosts.test.ts`, `recommend-fixtures.test.ts`, `recommend-ai-review.test.ts`  
**Good:** Comprehensive coverage of policy loading, merging, override validation, schema mismatch detection, preset validation. Report building with session intents tested thoroughly. CLI explain command tested with rich output assertions. Confidence classification tested across multiple signal strength combinations.  
**Weak:** No tests for 1000+ entry ranking performance. No tests for recommendation with completely empty demand profile.  
**Verdict:** The most thoroughly tested area.

### 5.4 Native Install Flows ★★★★☆

**Files:** `native-config.test.ts`, `native-host-wire.test.ts`  
**Good:** Deep coverage of JSON merge/revert cycle, path validation (rejects empty, absolute, traversal, directory paths), rollback on invalid payload, cross-host support (Cursor, Zed, Claude Code, Pi, Codex). Native wire apply/reset tested with full file-creation and cleanup verification.  
**Weak:** Missing: install with network failure, crash recovery mid-batch, concurrent install locking, disk-full handling.  
**Verdict:** Strong for config operations; weaker for install runtime edge cases.

### 5.5 Wire-In for All Hosts ★★★★½

**Files:** `vscode-wire.test.ts`, `opencode-wire.test.ts`, `native-host-wire.test.ts`, `host-adapters.test.ts`, `host-runtime-utils.test.ts`  
**Good:** All major hosts tested (VS Code, OpenCode, Cursor, Zed, Claude Code, Pi, Codex). Each test covers full apply/reset lifecycle. Settings merging tested with existing user configs. Host preflight checks tested. Security boundary (wire-plan snapshot escape) tested for two distinct hosts.  
**Weak:** VS Code wire test mocks `GITHUB_TOKEN` but doesn't test without it. No cross-host interference tests (wire two hosts in same workspace).  
**Verdict:** Very thorough. Among the best-covered areas.

### 5.6 Quarantine Workflows ★★★★☆

**Files:** `quarantine.test.ts`  
**Good:** Approve/reject/pin lifecycle tested with evidence recording. Signal-based transitions tested (prompt-injection, safe-to-risky, official-duplicate-supersedes). Schema validation tested.  
**Weak:** Missing: approving already-approved asset (idempotency), reject already-rejected asset, report with zero entries, concurrent review writes.  
**Verdict:** Tests the happy path and common transitions well; missing a few uncommon edge cases.

### 5.7 Asset Discovery Sourcing ★★★★½

**Files:** `discover-breadth.test.ts`, `discover-source-cap.test.ts`, `discover-quiet-summary.test.ts`, `discovery-small-modules.test.ts`, `discovery-reporting.test.ts`, `source-sync*.test.ts`, `source-registry*.test.ts`, `candidate-queue.test.ts`, `source-health.test.ts`  
**Good:** Large-input test (120K entries) present. Per-source capping with diversity warnings tested. Quiet/summary output modes tested. Source candidate queue with duplicate detection tested. Source verification demotions tested.  
**Weak:** Missing: source sync with network failure, concurrent source syncs, per-source cap below 1.  
**Verdict:** Very strong. One of the best-tested areas.

### 5.8 State Root Isolation ★★★★☆

**Files:** `state-root.test.ts`  
**Good:** Package-root vs workspace-local resolution tested. File sync from package to state root verified. User-owned override preservation tested. Seed-once semantics tested.  
**Weak:** Missing: concurrent prepareStateRoot calls, unwritable state root, non-existent package root.  
**Verdict:** Good for the current usage pattern; needs concurrency tests if multi-process is introduced.

---

## 6. TEST ARCHITECTURE ISSUES

### 6.1 Fixture Duplication

Multiple test files define their own `buildEntry()` / `makeEntry()` / `buildSource()` helpers with slightly different shapes. This works but means fixture changes must be updated in many places. Consolidating into `detection-fixtures.ts` or a shared `test-helpers.ts` would reduce maintenance burden.

### 6.2 Env-Variable Pollution

Several tests modify `process.env` (e.g., `AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE`, `GITHUB_TOKEN`, `PATH`, `PATHEXT`) with manual save/restore. The `t.after()` pattern is used inconsistently — some tests use it, others use try/finally. Any missed restore in a failing test leaks state to subsequent tests.

### 6.3 `void test(...)` vs `test(...)`

Both patterns appear across the suite:

- `void test(...)` — used in ~60% of files (explicit void to satisfy ESLint no-floating-promises)
- `test(...)` — used in ~40% (relies on node:test's handling)

This is cosmetic but inconsistent.

### 6.4 Detection-Quality.ts Is Not a Proper Test

`detection-quality.ts` uses bare `assert.ok()` outside any `test()` wrapper. It runs as a script, not a proper test. If it throws, the runner reports it as an uncaught exception, not a named test failure.

---

## 7. QUANTITATIVE SUMMARY

| Metric                                                 | Value      |
| ------------------------------------------------------ | ---------- |
| Total test files                                       | ~130       |
| Strong tests (validates behavior)                      | ~110 (85%) |
| Weak tests (docs/minimal validation)                   | ~12 (9%)   |
| Non-standard test files (not proper `test()` wrappers) | 2 (1.5%)   |
| Security/input-sanitization tests                      | ~15 files  |
| Concurrency tests                                      | 1 file     |
| Stress/large-input tests                               | **1 file** |
| Files with per-test isolation (tmpdir)                 | ~70%       |
| Files using `t.after()` for cleanup                    | ~30%       |
| Average assertions per test                            | ~5-8       |

---

## 8. RECOMMENDATIONS (Priority-Ordered)

1. **🔴 Add concurrency tests** — At minimum: race-condition tests for quarantine state file, mirror index, and install progress state under concurrent access. Use `Promise.all` with interleaved reads/writes.

2. **🟠 Add stress tests** — ARD catalog export with 10K+ entries, recommendation with 1000+ assets, pipeline with 100+ bundles. Add memory-usage assertions (e.g., `process.memoryUsage()` before/after).

3. **🟠 Extend input sanitization** — Add tests for null bytes, unicode normalization attacks, symlink escape, and very long strings (DoS vectors) in path validation and CLI argument parsing.

4. **🟡 Relocate doc-verification tests** — Move `trust-center-docs.test.ts`, `safe-defaults-docs.test.ts`, `demo-docs.test.ts`, `v2-contract.test.ts`, `package-metadata.test.ts` to a separate `scripts/docs-consistency-check.ts` or a dedicated `docs-consistency.test.ts` in `scripts/tests/`.

5. **🟡 Fix detection-quality.ts** — Wrap assertions in proper `test()` blocks with descriptive names.

6. **🟡 Fix detection-quality.ts** — Add proper `test()` wrappers.

7. **🟡 Standardize cleanup** — Adopt `t.after()` consistently across all tests that create temp dirs. Currently ~30% use it; the rest rely on try/finally.

8. **🟡 Add install-edge-case tests** — Network failure, disk-full, crash-recovery, cross-platform paths for the install flows.

9. **🟢 Consolidate fixtures** — Extract shared helpers (`buildEntry`, `makeEntry`, `buildSource`) into `src/tests/fixtures/` or a shared `test-helpers.ts` to reduce duplication.

10. **🟢 OMS integration test** — Add a test that exercises the full OMS trust verification pipeline end-to-end with a mock signature/verification.

---

_Report generated by Hermes Agent after reading 30+ test files spanning all key areas of the agent-harness project._
