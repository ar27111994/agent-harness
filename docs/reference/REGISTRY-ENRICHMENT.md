# Registry Metadata Enrichment

> **Scope:** `discover full` / `discover sync` — package-registry harvest phase.

## Overview

By default, `agent-harness` only indexes packages that are **already declared** in workspace manifest files (`package.json`, `requirements.txt`, `Cargo.toml`, etc.). This means a TypeScript workspace without `eslint` never sees it recommended, and any workspace never discovers MCP server packages unless they are already installed.

**Registry metadata enrichment** (#295) extends harvest with two complementary mechanisms:

1. **Static adjacent-tooling matrix** — zero-latency look-up of high-confidence adjacent packages by stack signal.
2. **Live registry search** — top-N results from each registry's search/suggest API, sorted by popularity/downloads.

Both mechanisms tag discovered entries as `discoveryMethod: "registry-adjacent-search"` so the recommendation report can group them as _"Consider adopting"_ separately from already-declared tooling.

---

## How It Works

### 1. Static adjacent-tooling matrix

`src/domains/discovery/adjacent-tooling.ts` maps demand-profile signal keywords to package names for npm, PyPI, crates.io, NuGet, Maven, Packagist, and RubyGems.

When a workspace has a `typescript` language signal, `eslint`, `prettier`, `vitest`, `tsx`, and `tsup` are automatically added to the npm harvest candidates — even if none are in `package.json`.

When `mcp` appears in any signal, the core `@modelcontextprotocol/*` packages and `fastmcp` are added.

### 2. Live registry search

Demand language and framework signals (e.g. `typescript`, `react`, `django`) are used as search terms against each registry's public search API:

| Registry      | API endpoint                         | Sort order     |
| ------------- | ------------------------------------ | -------------- |
| npm           | `registry.npmjs.org/-/v1/search`     | popularity     |
| crates.io     | `crates.io/api/v1/crates`            | downloads      |
| NuGet         | `azuresearch-usnc.nuget.org/query`   | totalDownloads |
| Maven Central | `search.maven.org/solrsearch/select` | relevance      |
| Packagist     | `packagist.org/search.json`          | relevance      |
| RubyGems      | `rubygems.org/api/v1/search.json`    | downloads      |

> **Note:** crates.io requires a `User-Agent` header; `agent-harness` sends `agent-harness/2.0.0` automatically.

### 3. Adjacent entry tagging

Catalog entries from adjacent discovery carry:

```json
{
  "evidence": {
    "discoveryMethod": "registry-adjacent-search",
    "isAdjacentSuggestion": true,
    "manifestFound": false
  }
}
```

---

## Configuration

| Environment variable                                           | Default | Description                                                     |
| -------------------------------------------------------------- | ------- | --------------------------------------------------------------- |
| `AGENT_HARNESS_DISCOVERY_REGISTRY_SEARCH_MAX_TERMS`            | `10`    | Max search terms dispatched per registry per harvest            |
| `AGENT_HARNESS_DISCOVERY_REGISTRY_SEARCH_MAX_RESULTS_PER_TERM` | `50`    | Max results fetched per search term                             |
| `AGENT_HARNESS_DISCOVERY_ADJACENT_TOOLING_ENABLED`             | `true`  | Enable/disable adjacent-tooling matrix and live registry search |

### Disabling adjacent discovery

```bash
# Static matrix only (no live search):
AGENT_HARNESS_DISCOVERY_REGISTRY_SEARCH_MAX_TERMS=0 agent-harness discover full

# Full disable (static + live):
AGENT_HARNESS_DISCOVERY_ADJACENT_TOOLING_ENABLED=false \
AGENT_HARNESS_DISCOVERY_REGISTRY_SEARCH_MAX_TERMS=0 \
  agent-harness discover full
```

---

## Rate Limits

| Registry      | Limit                         | How agent-harness handles it                 |
| ------------- | ----------------------------- | -------------------------------------------- |
| npm           | 200 req/min (unauthenticated) | `maxTerms` cap limits parallel calls         |
| crates.io     | 10 req/sec                    | Sequential term dispatch; small result pages |
| NuGet         | None documented               | Sequential                                   |
| Maven Central | None documented               | Sequential                                   |
| Packagist     | None documented               | Sequential                                   |
| RubyGems      | None documented               | Sequential                                   |

For high-frequency scheduled runs, reduce `AGENT_HARNESS_DISCOVERY_REGISTRY_SEARCH_MAX_TERMS` to stay within rate limits.

---

## Internals

- `src/domains/discovery/adjacent-tooling.ts` — static signal → package maps + `getAdjacentPackagesForSignals()`
- `src/package-registries.ts` — `fetchCratesIoSearch`, `fetchNugetSearch`, `fetchMavenSearch`, `fetchPackagistSearch`, `fetchRubyGemsSearch`
- `src/domains/discovery/package-registry-harvester.ts` — `discoverAdjacentPackages()` + integration into `harvestPackageRegistrySource()`
- `src/config/runtime.ts` — `discovery.registrySearchMaxTerms`, `discovery.registrySearchMaxResultsPerTerm`, `discovery.adjacentToolingEnabled`
- `src/types/catalog.ts` — `AssetEvidence.discoveryMethod`, `AssetEvidence.isAdjacentSuggestion`
