# Source Code Quality Audit — agent-harness v2.0.0

**Audited:** 2026-07-28  
**Scope:** `src/host-adapters/`, `src/domains/discovery/`, `src/mirror/`, `src/install/`, `src/recommend/`, `src/activate.ts`, `src/package-registries.ts`  
**Compilation check:** `tsc --noEmit` passes with zero errors (strict mode).  
**Type safety:** No `any`, no `@ts-ignore`, no `@ts-expect-error` — strong discipline.

---

## SUMMARY

The codebase is well-structured, strictly typed, and written with clear conventions. It passes full TypeScript strict-mode compilation.

> **Note:** This audit was performed pre-refactor (prior to PR #376). Findings about duplicated registry searchers and the `native-wire.ts` monolith have been addressed: `searchRegistry()` was extracted as a shared abstraction (#373), and `native-wire.ts` was split into 5 per-host adapter files + `native-utils.ts` (#374).

---

## 1. DEAD CODE / UNREACHABLE PATHS

| Severity | File                               | Line(s)                                     | Issue                                                                                                                                                                                                                                                                                                                 |
| -------- | ---------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Low**  | `src/package-registries.ts`        | 516–520, 565–569, 609–613, 655–659, 693–697 | Five `catch { return []; }` blocks are explicitly annotated `/* c8 ignore start -- fetchJsonWithGuards catches internally and returns null; outer catch is an unreachable defensive guard */`. The code acknowledges these catches are unreachable but keeps them. Dead defensive code that exists only for "safety." |
| **Low**  | `src/host-adapters/opencode.ts`    | 327–330                                     | `readJsonFileOrNull` after `pathEntryExists` guard — annotated `/* c8 ignore next 3 */` as unreachable. The code admits the gap-check is dead but keeps it.                                                                                                                                                           |
| **Low**  | `src/host-adapters/native-wire.ts` | 322                                         | `readSharedMcpAssetIdsBestEffort` catch has `/* c8 ignore next 4 */`. This is intentional error-best-effort, not truly dead code.                                                                                                                                                                                     |

**Verdict:** No truly dead code. A few defensive-but-unreachable guards are documented with c8-ignore comments. These are low-severity — they add ~30 lines of safety net at the cost of clarity.

---

## 2. ERROR SWALLOWING

### 2.1 Bare `catch {}` patterns (31 occurrences)

**Search:** 31 instances of `catch {` across the source tree (no error parameter, no `catch (err)` logged).

| File                          | Count  | Pattern                                                                                                                                                             |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/package-registries.ts`   | **12** | All 6 registry searchers (npmSearch, pypiSearch, cratesSearch, nugetSearch, mavenSearch, packagistSearch, rubygemsSearch) each have 1–2 bare catches returning `[]` |
| `src/files.ts`                | 3      | `pathExists`, `pathEntryExists`, `ensureCleanDirectory` — acceptable (existence checks)                                                                             |
| `src/github.ts`               | 2      | Catch-and-continue in GitHub URL construction                                                                                                                       |
| `src/official-index.ts`       | 1      | Catch-return-null                                                                                                                                                   |
| `src/asset-content.ts`        | 1      | Catch-return-null                                                                                                                                                   |
| `src/cli.ts`                  | 1      | Catch-return-fallback version string                                                                                                                                |
| `src/ard-catalog.ts`          | 1      | Catch-return-null                                                                                                                                                   |
| `src/discover.ts`             | 1      | Catch in version reading                                                                                                                                            |
| `src/config/runtime.ts`       | 1      | Config loading                                                                                                                                                      |
| `src/install/generations.ts`  | 1      | File removal                                                                                                                                                        |
| `src/lib/http.ts`             | 3      | HTTP fetch guard                                                                                                                                                    |
| `src/lib/preflight.ts`        | 1      | Preflight check                                                                                                                                                     |
| `src/host-adapters/vscode.ts` | 2      | Cleanup operations                                                                                                                                                  |

**Major concern:** `package-registries.ts` has 12 bare catches in 709 lines — that's one every 59 lines. Fetching external data from 6 different registries and silently swallowing all errors (`catch { return []; }`). While the inline comments claim these are unreachable, the pattern is deeply ingrained: every registry search ends the same way. An actual network failure in the 5% case that bypasses `fetchJsonWithGuards` would be completely invisible.

### 2.2 `readSharedMcpAssetIdsBestEffort` — deliberate error swallowing

`src/host-adapters/native-wire.ts:315-328` and `src/host-adapters/opencode.ts:754-760` both wrap MCP asset reads in try/catch that returns `[]` and logs a warning. This is intentional and documented as non-fatal, but creates silent failure surface when the shared MCP state is corrupted.

---

## 3. TYPE SAFETY ISSUES

### 3.1 `Record<string, unknown>` pattern abuse

**File:** `src/package-registries.ts` (lines 502–506, 549–553, 595–596, 638–645, 684–685)

Every registry search function manually casts:

```typescript
(data as Record<string, unknown>)["crates"] as Record<string, unknown>[];
```

This sidesteps the type system entirely — functionally equivalent to `any[]`. The data from 6 registries (npm, PyPI, crates.io, NuGet, Maven Central, Packagist, RubyGems) is manually validated field-by-field rather than through Zod/io-ts schemas. This is repeated ~20+ times.

### 3.2 Unsafe type assertions in `activate.ts`

| Line | Issue                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1003 | `value as HostTarget` before validation completes — the cast happens before `includes()` checks                                                                    |
| 1046 | `value as ActivationHost` in `isActivationHost` guard — circular type trust                                                                                        |
| 182  | `satisfies CopilotWorkspaceOverlayManifest \| Record<string, unknown>` — using union with `Record<string, unknown>` lets the compiler accept structural mismatches |

### 3.3 Functionally-unsafe `Number.MAX_SAFE_INTEGER` as sentinel

`src/host-adapters/extension-installer.ts:300` and `src/activate.ts:759` — `Number.MAX_SAFE_INTEGER` is used as a "not-found" sentinel for ranking. Works for numeric positions but is a code smell; `null` with a null-safe default would be more explicit.

---

## 4. MAGIC NUMBERS

### 4.1 Activation budgets (activate.ts)

Well-documented with comments, but still magic numbers without symbolic constants in a shared constants file:

| Value | Location                             | Documentation                                                    |
| ----- | ------------------------------------ | ---------------------------------------------------------------- |
| `60`  | `COPILOT_VSCODE_ACTIVATION_BUDGET`   | "Bounded by the Copilot chat context window"                     |
| `120` | `OPENCODE_ACTIVATION_BUDGET`         | "Larger context tolerance"                                       |
| `40`  | `DEFAULT_ACTIVATION_BUDGET`          | "Conservative floor for hosts with unknown limits"               |
| `20`  | `FOCUSED_ACTIVATION_BUCKET_MAX_SIZE` | "capping at 20 ensures a single session intent cannot crowd out" |
| `12`  | `COPILOT_FALLBACK_SKILL_POOL_LIMIT`  | "marginal utility drops beyond 12"                               |

These are named constants, so this is borderline. But they live in `activate.ts` rather than `src/recommend/constants.ts` or a shared constants module — mixing activation constants across domains.

### 4.2 Scoring constants (recommend/constants.ts)

Good practice — all extracted into `constants.ts`: `COVERAGE_OVERLAP_CAP = 2`, `MIN_BUDGET_PENALTY = 1`, `HIGH_COST_BUDGET_DIVISOR = 3`, etc. These are appropriately named and documented.

### 4.3 Authority rank numbers (activate.ts:767-773)

```typescript
const ranks = {
  "official-first-party": 6,
  "official-marketplace": 5,
  "official-compatible": 4,
  "trusted-local": 3,
  "trusted-community": 2,
  "unverified-community": 1,
};
```

Hardcoded ordinal mapping duplicated with `getContextCostRank`. Should be a shared constant.

### 4.4 GitHub blob path index constants (mirror/acquire.ts:66-71)

```typescript
const GITHUB_BLOB_OWNER_INDEX = 0;
const GITHUB_BLOB_REPO_INDEX = 1;
const GITHUB_BLOB_KIND_INDEX = 2;
const GITHUB_BLOB_REF_START_INDEX = 3;
const MIN_GITHUB_BLOB_PATH_PARTS = 5;
const MIN_GITHUB_REPOSITORY_PATH_PARTS = 2;
```

These are path segment indices from `github.com/OWNER/REPO/blob/REF/path`. Named constants are good, but they're function-scoped in a 1269-line file.

---

## 5. DRY VIOLATIONS

### 5.1 [CRITICAL] Registry search functions — 6× near-identical copies

**File:** `src/package-registries.ts`

Functions `fetchNpmSearch`, `fetchPypiSearch`, `fetchCratesSearch`, `fetchNugetSearch`, `fetchMavenSearch`, `fetchPackagistSearch`, `fetchRubyGemsSearch` all follow **exactly the same structure**:

```
1.  normalize query, exit early if empty
2.  getRuntimeConfig().registries
3.  try {
4.    new URL(...)
5.    url.searchParams.set(...)
6.    fetchJsonWithGuards(url, {allowedOrigins, headers, maxBytes, timeoutMs})
7.    guard: !data || typeof !== "object" || !Array.isArray(...["data"|"crates"|"results"])
8.    data map to RegistrySearchResult { name, description?, downloads? }
9.    filter(r => r.name.length > 0)
10. } catch { return []; }
```

**Impact:** ~250 lines of near-identical code. A common `searchRegistry` higher-order function or a registry adapter pattern could eliminate 80% of the duplication. Each is also individually untestable in isolation (same mocking needed 7×).

### 5.2 [HIGH] Capability arrays (registry.ts lines 78–149)

`vscodeCapabilities`, `opencodeCapabilities`, `cursorCapabilities`, `nativeReferenceCapabilities` all have nearly identical entries — each lists the same 10+ asset kinds. The only differences:

- `opencodeCapabilities` adds `payable-api` and `acp-agent`
- `cursorCapabilities` adds `native-install` and `runtime-validation` for `extension`
- `piCapabilities` strips `auth-assist` from `mcp-server`

`zedCapabilities`, `claudeCodeCapabilities`, `codexCapabilities` are direct references to `nativeReferenceCapabilities` (done right). The others should use object spread/deep merge on a base capability set rather than re-declaring 10 identical entries.

### 5.3 [MEDIUM] `buildConcernBuckets` and `buildTaskModeBuckets` (activate.ts:656-738)

These two functions are structurally identical — both iterate `assetIds`, look up `recommendationEntryByAssetId`, build a `Map<string, string[]>`, dedupe with `new Set()`, sort, and return `Record<string, string[]>`. The only difference is which property they read from the recommendation entry (`coverageTags` vs `taskModes`).

A shared higher-order function like `buildBucketByKey(recommendationEntryByAssetId, assetIds, keySelector)` would eliminate this duplication.

### 5.4 [MEDIUM] Registry search map/filter patterns (package-registries.ts)

Each registry function's `.map()` produces `{ name, description?, downloads? }` from field names specific to each registry. The field-access and guard logic (`typeof x === "string"`) is duplicated 7×. A small `RegistryAdapter` abstraction per registry would isolate the URL/field-name differences.

### 5.5 [LOW] `diffStringSets` pattern (activate.ts:1049-1068)

`diffStringSets` is a standalone utility that could be in `lib/` or already exist somewhere else for other diff operations (e.g. `src/domains/discovery/diff.ts`). This creates an inconsistent pattern for diff operations.

---

## 6. MODULARITY / SRP VIOLATIONS (Monolith Files)

### 6.1 [HIGH] `src/host-adapters/native-wire.ts` — 2063 lines

Handles **five different hosts** (cursor, zed, claude-code, pi, codex) in a single monolithic file. Contains host-specific wire functions, managed instruction line building, plugin file writing, structured native config writing, and rollback logic. Should be split into one file per host or a host-agnostic core with extension points.

### 6.2 [MEDIUM] `src/recommend/candidates.ts` — 904 lines

Contains `buildCandidateRecommendationBase` (the main scoring pipeline), `buildCandidateRecommendation` (host-specific scoring), `buildPolicySearchContext`, `computeEntryPreselectionScore`, and support utilities. The scoring pipeline crosses multiple concerns (policy parsing, signal matching, keyword normalization).

### 6.3 [MEDIUM] `src/activate.ts` — 1076 lines

Contains CLI dispatch, host activation, candidate selection, comparison logic, diff generation, explain logic, rollback, and utility functions. The `activateHost` function alone spans ~260 lines (175–436).

### 6.4 [MEDIUM] `src/host-adapters/opencode.ts` — 1004 lines

OpenCode wire logic, gitignore management, npm install summary, link resolution, native config application — all in one file.

### 6.5 [MEDIUM] `src/host-adapters/vscode.ts` — 925 lines

Similarly monolithic.

---

## 7. INCONSISTENT PATTERNS

### 7.1 Error handling style

- **`files.ts`**: Uses `catch` without parameter for `pathExists` — acceptable (boolean check)
- **`package-registries.ts`**: 12 bare `catch { return []; }` — silent swallowing
- **`activate.ts`**: `swapActivationRuntimeRoot` uses explicit typed catch and `AggregateError` — proper handling
- **`native-config.ts`**: `applyHostNativeFilePayloads` catches, rollbacks, and rethrows — correct pattern
- **`vscode.ts:876`**: bare catch with logging — "Failed to clean up ..." — logging but no rethrow

Three different error strategies coexist without convention.

### 7.2 Path constant patterns

- **`mirror/constants.ts`**: Constants are `[string, ...string[]]` tuples later joined with `...path`
- **`install/paths.ts`**: Same pattern — `["state", "install", "progress.json"]`
- **`recommend/constants.ts`**: Mixed — some are `[string, ...string[]]`, some are plain strings
- **`domains/discovery/output-paths.ts`**: Likely follows the same array pattern

Consistent within each module but no shared convention document.

### 7.3 Host adapter wire dispatch

- **`registry.ts`**: VS Code uses `wireVsCode` directly, OpenCode uses `wireOpenCode` directly, cursor/zed/claude-code/pi/codex all use `wire: (options) => wireNativeHost("name", options)`.
- The 5 native-host adapters share `native-wire.ts`, but OpenCode and VS Code have separate files with completely different architectures (OpenCode uses directory junctions for links; VS Code uses user-settings patching with generation IDs; native hosts write managed files under a `.host/agent-harness` root).

---

## 8. COMPLEXITY WARNINGS

### 8.1 `selection.ts:selectCandidatesForHost` (O(n²) greedy selection)

The greedy selection loop (lines 255-316) re-evaluates `scoreCandidateAgainstSelection` for every remaining candidate on each iteration. With host-preselection limits up to 250+ candidates and `hostPolicy.recommendationLimit` around 40-120, this is O(n×m) where n=250, m=40-120. For a CLI tool this is likely fine, but the complexity is worth noting.

### 8.2 `mirror/acquire.ts` — 1269 lines

The main `acquireMirrorArtifacts` function is a single extremely long function (~250 lines) with complex branching:

- 5+ boolean flags for different refresh modes
- 3 different skip-reason tracking mechanisms (`PersistedSkippedAssets`, `scopedSkippedAssetIds`, `MirrorAcquireSkipReason`)
- Nested conditions for `fullRefreshRequested`, `incrementalRefreshRequested`, etc.
- Multiple large Map/Set structures simultaneously

### 8.3 `assertAllowedHostNativePath` (native-config.ts:274-351)

A single switch-case with 7 cases and complex conditionals for path validation, each case returning early or falling through to throw. Could be simplified to a record of allowed-path patterns per host.

---

## 9. SPECIFIC CODE QUALITY ISSUES

### 9.1 `src/host-adapters/native-config.ts:44`

```typescript
toUnknownArray(value);
```

Returns a new `unknown[]` by iterating but no actual transformation — just a type guard that returns the same array. Equivalent to `Array.isArray(value) ? value : []`. The `for` loop reconstructs arrays element-by-element for every call without benefit.

### 9.2 `src/host-adapters/native-wire.ts:262-265`

```typescript
const mcpServers = uniqueStrings([
  ...materializedAssets.mcpServers,
  ...sharedMcpAssetIds,
]);
```

This is duplicated in both the apply block and the wire-plan construction — `sharedMcpAssetIds` are already included in the host-native file writes but the union is recomputed for the wire-plan manifest. Minor, but suggests the data flow through the wire-plan building could be cleaner.

### 9.3 `src/activate.ts:198-206`

```typescript
const preferredAssetOrder = new Map(
  recommendationEntries.map((entry, index) => [
    entry.assetId,
    entry.rank || index,
  ]),
);
const recommendationEntryByAssetId = new Map(
  recommendationEntries.map((entry) => [entry.assetId, entry]),
);
```

Two sequential `map()` calls over the same array to build two Maps from the same data. Could use a single `reduce()`.

### 9.4 `src/activate.ts:311-332` — Copilot skill fallback pool

The fallback skill pool sorts candidate manifests by `compareActivationCandidates`, then picks the top 12. The same comparator is used for the primary selection, so fallback skills may already be in the selected set. The `mergedSkillIds = [...new Set([...selectedSkillIds, ...fallbackSkillIds])]` on line 331 dedupes them but the sorting is redundant for skills already selected.

### 9.5 `src/recommend/selection.ts:272-302` — Handwritten argmax

The `selectCandidatesForHost` loop implements argmax by hand (`bestIndex = -1; for ... compareDynamicScores(...) < 0`). A `reduce`-based argmax or `Math.max` with mapping would be more idiomatic.

---

## 10. POSITIVE FINDINGS

| Aspect                     | Assessment                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| **TypeScript strict mode** | Fully enforced — no `any`, no `@ts-ignore`, no `// @ts-expect-error` anywhere                       |
| **Null safety**            | Consistently uses `??` and `\|\|` where appropriate |
| **Comments**               | Well-documented — most constants and non-trivial functions have JSDoc                               |
| **Naming conventions**     | Consistent camelCase, clear function/type names                                                     |
| **File structure**         | Consistent domain-based organization under `src/`                                                   |
| **Manifest validation**    | Every JSON read is validated through an `assert*` function                                          |
| **Path traversal safety**  | `resolveSafeMirrorFilePath`, `resolveWorkspacePath`, `isPathWithinRoot` prevent directory traversal |
| **Rollback patterns**      | Native-config operations, activation swap, and wire plans all have rollback support                 |
| **Unused imports**         | Not observed — ESM with `verbatimModuleSyntax` prevents them                                        |
| **Testability**            | Several modules export `*Internals` objects for focused testing                                     |

---

## 11. PRIORITIZED RECOMMENDATIONS

| Priority | Recommendation                                                                                     | File(s)                                 | Effort | Impact                                          |
| -------- | -------------------------------------------------------------------------------------------------- | --------------------------------------- | ------ | ----------------------------------------------- |
| **P0**   | Extract shared `searchRegistry(higherOrderFn)` or adapter pattern for 7 registry searches          | `package-registries.ts`                 | 2d     | Eliminates ~250 lines duplicated code           |
| **P1**   | Split `native-wire.ts` into one file per host (cursor.ts, zed.ts, claude-code.ts, pi.ts, codex.ts) | `host-adapters/native-wire.ts`          | 1d     | Reduces 2063-line monolith                      |
| **P1**   | Create base capability set for registry.ts, spread for variations                                  | `host-adapters/registry.ts`             | 2h     | Eliminates 50+ lines near-identical arrays      |
| **P2**   | Abstract `buildConcernBuckets` + `buildTaskModeBuckets` into shared `buildBuckets(keySelector)`    | `activate.ts`                           | 1h     | Eliminates duplicated bucket-building           |
| **P2**   | Move activation constants to `src/recommend/constants.ts`                                          | `activate.ts`, `recommend/constants.ts` | 30min  | Consolidates related constants                  |
| **P2**   | Add `RegistrySearchResult` Zod/io-ts schemas in `package-registries.ts`                            | `package-registries.ts`                 | 1d     | Replaces 20+ `as Record<string, unknown>` casts |
| **P3**   | Extract `diffStringSets` + `getAuthorityRank` + `getContextCostRank` to shared `lib/`              | `activate.ts`                           | 1h     | Shared utility reuse                            |
| **P3**   | Replace hand-written argmax loop with `reduce` in `selection.ts`                                   | `recommend/selection.ts`                | 30min  | Idiomatic code                                  |
