# Source Sync Decomposition Plan

`src/domains/discovery/source-sync.ts` remains intentionally stable for v2.0.0, but it is the next discovery module that should be decomposed. This plan defines the extraction seams so future work can reduce the monolith without behavior drift.

## Goals

- Preserve current source-sync behavior and output contracts during every extraction.
- Keep guarded fetch, cursor state, and entry comparison semantics covered by existing tests.
- Make each extracted module own one concern with narrow inputs and deterministic outputs.
- Avoid mixing registry-specific parsing with shared sync orchestration.

## Proposed module layout

```text
src/domains/discovery/source-sync/
  index.ts                 # public orchestration surface used by discover.ts
  state.ts                 # load/write state, cursors, legacy query migration
  fetching.ts              # guarded fetch wrappers, allowed-origin helpers
  references.ts            # indexed reference asset construction/deduping
  reporting.ts             # sync summaries and source state classification
  html.ts                  # sitemap + paginated HTML extraction
  registries/
    npm.ts
    pypi.ts
    crates.ts
    vscode-marketplace.ts
    mcp-registry.ts
    nuget.ts
```

## Extraction order

1. **State and cursor helpers**
   - Move `loadSourceSyncState`, cursor restoration, token parsing, and legacy query migration.
   - Keep existing helper exports for tests until callers are updated.
   - Verification: `source-sync-helpers.test.ts`, `source-sync-internals.test.ts`.

2. **Guarded fetch helpers**
   - Move source-sync-specific `fetchRequiredJson`, `fetchRequiredText`, allowed-origin construction, and byte/timeout defaults.
   - Keep SSRF policy centralized in existing HTTP guards; this module only builds source-owned allowlists.
   - Verification: `security-hardening.test.ts`, `source-sync-internals.test.ts`.

3. **Reference entry construction**
   - Move deterministic id generation, reference-item normalization, structural comparison, and dedupe helpers.
   - Verification: source-sync helper tests plus catalog validation tests.

4. **Registry adapters**
   - Extract one registry at a time behind a common adapter shape:
     - input: source definition, demand profile, previous cursor state
     - output: observed entries, cursor state, status/reason
   - Start with the smallest registry to prove the seam before VS Code Marketplace/MCP pagination.
   - Verification: registry-specific tests and default source-sync smoke tests.

5. **HTML/sitemap crawling**
   - Extract sitemap and paginated HTML discovery after registry adapters, because it shares the most URL and cursor logic.
   - Verification: HTML-backed source tests and failure-resume tests.

6. **Final orchestration shell**
   - Leave `source-sync.ts` as a thin re-export or remove it after imports/tests are migrated.
   - Verification: full `npm run validate:quality`.

## Non-goals for v2.0.0

- No output schema changes.
- No new external source volume purely for decomposition.
- No weakening of public URL validation or source-origin allowlists.
- No behavior-preserving refactor without tests running after each extraction step.

## Exit criteria

A future decomposition PR series is complete when source sync has a thin orchestrator, registry/HTML/fetch/state concerns live in separate modules, and the existing source-sync tests remain green without broad snapshot rewrites.
