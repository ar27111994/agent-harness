# Plan 010 — VS Code publisher always shows "Microsoft" (#300)

## Problem

`buildReferenceSourceCatalogEntry` set `source.publisher` from the source-level
`publisher.name` field (e.g. `"Microsoft"` for the VS Code Marketplace source
definition). Every extension harvested from that source therefore appeared in the
catalog as published by `"Microsoft"`, regardless of who actually published the
extension (e.g. `"eamodio"` for GitLens, `"ms-python"` for Pylance).

## Root cause

`reference-source-harvester.ts` line 116 had:

```ts
publisher: source.publisher?.name ?? source.id,
```

This used the **source-level** publisher — set once on the `SourceDefinition` to
identify the marketplace owner — rather than the **per-extension** publisher
extracted during harvest.

The per-extension publisher was already available inside `normalizeVsCodeMarketplaceExtension`
(as the local `publisher` variable), but it was not threaded through the
`HarvestedReferenceItem` interface and therefore not reachable in
`buildReferenceSourceCatalogEntry`.

## Fix

1. **`HarvestedReferenceItem`** (`reference-harvesters.ts`) — added optional
   `publisherName?: string` field with JSDoc.

2. **`normalizeVsCodeMarketplaceExtension`** (`reference-harvesters.ts`) — populated
   `publisherName: publisher` in the returned item, where `publisher` is already
   extracted from `value.publisher.publisherName`.

3. **`buildReferenceSourceCatalogEntry`** (`reference-source-harvester.ts`) — changed
   the publisher resolution to:
   ```ts
   publisher: harvestedItem?.publisherName ?? source.publisher?.name ?? source.id,
   ```
   Fallback chain: per-extension harvest name → source-level name → source ID.

## Tests

`reference-source-harvester.test.ts` — new test
`"buildReferenceSourceCatalogEntry uses per-extension publisherName over source-level publisher (#300)"`:

- Non-Microsoft extension (`eamodio.gitlens`) → `source.publisher === "eamodio"`
- Microsoft-owned extension (`ms-python.vscode-pylance`) → `source.publisher === "ms-python"`
- Absent `publisherName` in harvested item → falls back to `source.publisher.name`
- Absent `harvestedItem` entirely → falls back to `source.publisher.name`

## Validation

- Build clean
- 5/5 tests pass (4 existing + 1 new)
- ESLint clean on all 3 changed files
