# Source Pack Seeder

The `scripts/seed-source-packs.ts` script discovers GitHub repositories that
publish agent skills, MCP servers, or AI coding rules and writes candidate
entries to `discover/source-packs/community.json`.

## Quick start

```bash
# Dry-run — print candidates, do not write
npx tsx scripts/seed-source-packs.ts --dry-run

# Write candidates to community.json (with optional GitHub token for higher rate limits)
GITHUB_TOKEN=<your-pat> npx tsx scripts/seed-source-packs.ts

# Write and auto-approve without prompting (for CI)
npx tsx scripts/seed-source-packs.ts --auto-approve
```

## How it works

1. Queries the GitHub Search API for repos tagged with these topics:
   `claude-skill`, `mcp-server`, `agent-harness`, `cursor-rules`, `agent-skill`
2. Filters out repos already present in `sources.json` or the source packs.
3. Infers `authorityTier`, `assetKinds`, and `hosts` from repo metadata
   (topics, description, star count, org type).
4. Appends new entries to `discover/source-packs/community.json`.

## Rate limits

| Mode                | Limit               |
| ------------------- | ------------------- |
| Unauthenticated     | 60 requests/hour    |
| Authenticated (PAT) | 5,000 requests/hour |

For large seeding runs always provide a `GITHUB_TOKEN`.

## After seeding

1. Review the new entries in `discover/source-packs/community.json`.
2. Adjust `authorityTier`, `assetKinds`, and `priority` as appropriate.
3. Remove any entries that are spam, inactive (last push > 2 years ago), or
   have restrictive licenses.
4. Run the full build and tests to confirm validity:

```bash
node ./scripts/build.mjs
node --test dist/tests/source-registry-additional.test.js dist/tests/discovery-small-modules.test.js
```

## Schema requirements

Every entry **must** include:

| Field           | Description                                |
| --------------- | ------------------------------------------ |
| `id`            | Kebab-case unique identifier               |
| `repo`          | GitHub URL                                 |
| `authorityTier` | One of the authority tier enum values      |
| `assetKinds`    | Non-empty array of asset kind enum values  |
| `kind`          | Should be `"repo"` for GitHub repositories |

Missing `authorityTier` or `assetKinds` will cause `loadSourceRegistry` to throw
a validation error at discovery time.
