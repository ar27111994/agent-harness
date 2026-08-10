# Building a Comprehensive Agent Asset Catalog

agent-harness v2.0.0 ships with conservative defaults that build a fast, demand-driven catalog (~11,500+ entries from 50+ configured sources). This guide describes how to build a truly comprehensive catalog across millions of available assets for production use.

## The Two-Phase Architecture

Agent-harness uses a two-phase catalog architecture (#289):

1. **Offline index build** — fully paginate all indexed sources, store as a local snapshot
2. **Per-workspace selection** — demand-rank against the local index, zero API calls

This separates the slow network-bound harvest from the fast per-workspace ranking.

## Quick Start: Build a Comprehensive Index

```bash
# Set unlimited pagination for the index build
export AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_FOR_INDEX_BUILD=0

# Provide a GitHub token for 5,000 req/h (vs 60 unauthenticated)
export GITHUB_TOKEN=<your_personal_access_token>

# Build the full index (can take 30–60 minutes with unlimited pagination)
agent-harness discover index
```

The index is stored at `discover/output/catalog-index.jsonl` and stays fresh for 7 days.

## Production Configuration

Override these environment variables for comprehensive coverage:

| Env Var                                                   | Default       | Production    | Effect                                            |
| --------------------------------------------------------- | ------------- | ------------- | ------------------------------------------------- |
| `AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_FOR_INDEX_BUILD`     | 500           | 0 (unlimited) | Pages per source in offline index build           |
| `AGENT_HARNESS_VSCODE_MARKETPLACE_POPULARITY_SWEEP_PAGES` | 50            | 200+          | Popularity-sorted VS Code extension pages (50/pg) |
| `AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_QUERIES`            | 4             | 20            | Demand-driven queries for per-workspace harvest   |
| `AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_ITEMS_PER_QUERY`    | 6             | 20            | Results per demand-driven query                   |
| `AGENT_HARNESS_VSCODE_MARKETPLACE_SYNC_PAGE_SIZE`         | 50            | 50            | Items per page in full sync                       |
| `AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE`                    | 200           | 500+          | Per-source selection diversity cap                |
| `AGENT_HARNESS_OFFICIAL_INDEX_MAX_ITEMS_PER_INDEX`        | 0 (unlimited) | 0             | Max items per awesome-list index                  |
| `AGENT_HARNESS_DISCOVERY_INDEX_MAX_AGE_DAYS`              | 7             | 1–7           | Index staleness threshold                         |
| `GITHUB_TOKEN`                                            | (none)        | PAT           | GitHub API rate limit: 5,000 req/h vs 60          |

## Source Coverage

### VS Code Marketplace (60,000+ extensions)

The indexed source sync uses three sweep tiers:

1. **Popularity sweep** (`AGENT_HARNESS_VSCODE_MARKETPLACE_POPULARITY_SWEEP_PAGES` pages × 50/page)
2. **Category sweep** (enabled by default — maps demand signals to Marketplace categories)
3. **Alphabetical pagination** (resumable cursor-based)

At 200 popularity pages: 10,000 extensions by install count. The category sweep adds ecosystem-specific extensions. Alphabetical pagination fills the remainder.

### Package Registries

All major registries have indexed source adapters with cursor-based pagination:

| Registry            | Adapter        | Page Size | Default Cap |
| ------------------- | -------------- | --------- | ----------- |
| npm                 | `npm.ts`       | 50        | 500 entries |
| PyPI                | sitemap        | —         | 500 entries |
| crates.io           | `crates.ts`    | 50        | 500 entries |
| Go modules          | `go.ts`        | 50        | 500 entries |
| Maven Central       | `maven.ts`     | 50        | 500 entries |
| NuGet               | `nuget.ts`     | 50        | 500 entries |
| Packagist (PHP)     | `packagist.ts` | 50        | 500 entries |
| RubyGems            | sitemap        | —         | 500 entries |
| Swift Package Index | disabled       | —         | —           |

Each registry caps at `SOURCE_SYNC_INDEXED_REGISTRY_ENTRY_CAP` (500 entries per source). For production, raise `sourceSyncMaxPagesForIndexBuild` to 0 and run the full index build repeatedly over scheduled CI to build up the catalog over multiple runs.

### GitHub Repos and Awesome-Lists

GitHub sources are harvested via:

1. **Awesome-lists** (`discover/official-skills-indexes.json`) — 16 curated indexes
2. **Source packs** (`discover/source-packs/official.json` + `community.json`) — 20 repo sources
3. **Demand-driven** — per-workspace GitHub topic searches

Adding a `GITHUB_TOKEN` is the single highest-impact change — it raises the API rate limit from 60 to 5,000 requests per hour.

### MCP Registry

The MCP registry (`registry.modelcontextprotocol.io`) has a dedicated adapter with resumable offset cursors. At unlimited pagination it can catalog all published MCP servers.

### Community Registries

Additional registries include skills.sh, ClawHub, Pi packages, Cursor Marketplace, Zed extensions, and ui-skills.com. Most use sitemap-based harvesting.

## Scheduled CI Workflow

For production, run the index build on a schedule:

```yaml
# .github/workflows/catalog-index.yml
name: Build Catalog Index
on:
  schedule:
    - cron: "0 6 * * *" # daily at 6 AM
  workflow_dispatch:

jobs:
  index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22" }
      - run: npm ci
      - run: npm run build
      - name: Build index
        env:
          AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_FOR_INDEX_BUILD: 0
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node dist/cli.js --no-dotenv discover index
      - name: Upload index artifact
        uses: actions/upload-artifact@v4
        with:
          name: catalog-index
          path: discover/output/catalog-index.jsonl
```

## Estimating Catalog Size

| Source               | Entries at default | Entries with unlimited index |
| -------------------- | ------------------ | ---------------------------- |
| VS Code Marketplace  | 895                | 10,000+ (popularity 200pg)   |
| npm registry         | 500                | 500 (hard cap per source)    |
| Other registries     | 500 each           | 500 each (hard cap)          |
| GitHub awesome-lists | 3,136              | 5,000+ (with GITHUB_TOKEN)   |
| MCP registry         | 500                | All published servers        |
| Community sources    | 500–1,000          | 2,000+                       |

**Projected total:** 11,500 (default) → 25,000–50,000 (comprehensive). The hard cap of 500 per package registry is the main bottleneck — raising it requires a source-sync code change (tracked in #296).
