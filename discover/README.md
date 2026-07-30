# Discover Directory

The `discover/` directory contains the static configuration, schema definitions,
source registrations, and editable policy files that drive the agent-harness
discovery pipeline. It is **not** the runtime output directory — generated
catalogs, reports, and indices live under `discover/output/`.

## Directory Overview

| Path                           | Purpose                                                              |
| ------------------------------ | -------------------------------------------------------------------- |
| `sources.json`                 | Configured discovery sources (registries, repos, marketplaces, docs) |
| `selections.json`              | Whitelist/blacklist rules for catalog selection filtering            |
| `pipeline.json`                | Pipeline stage configuration (enable/disable stages, thresholds)     |
| `official-skills-indexes.json` | Known official skills index URLs (first-party verified)              |
| `official-upstreams.json`      | Known official upstream repository URLs                              |
| `schema/`                      | JSON Schema definitions for catalog entries, sources, and selections |
| `seeds/`                       | Seed data for bootstrapping new catalog entries                      |
| `source-packs/`                | Community and official source pack registrations                     |
| `recommendation-policy/`       | Per-host recommendation scoring and filtering policies               |
| `output/`                      | Runtime-generated catalogs, reports, and indices (gitignored)        |

## Source Packs

Source packs in `source-packs/` are grouped into community and official JSON
files. Each entry describes a GitHub repository, organization, or curated list
that should be harvested for agent assets.

### Adding a New Source Pack

1. Identify the target: GitHub username/org, repository URL, or curated list.
2. Choose the appropriate file: `source-packs/community.json` for community
   packs, `source-packs/official.json` for verified first-party packs.
3. Add an entry with these required fields:
   - `id`: unique identifier (e.g., `"username-project-name"`)
   - `authorityTier`: `"official-first-party"`, `"trusted-community"`, or
     `"unverified-community"`
   - `sourcePriority`: integer (1–100, higher = preferred)
   - `endpoints`: object with at least a `repo` URL
   - `tags`: array of descriptive tags
4. Run `discover sync` to harvest the new source.
5. Verify entries appear in `discover/output/catalog.assets.jsonl`.

## Schema Files

JSON Schema files in `schema/` document the expected shape of catalog entries,
source definitions, and selection rules. These are referenced by the manifest
validation pipeline and by external tooling that consumes agent-harness output.

## Related Documentation

- [Catalog Breadth Guide](../docs/guides/CATALOG-BREADTH.md) — building
  comprehensive catalogs
- [Semantic Scoring Guide](../docs/guides/SEMANTIC-SCORING.md) — how
  recommendations are ranked
- [Source Pack Seeder Guide](../docs/guides/SOURCE-PACK-SEEDER.md) —
  programmatic source pack registration
- [Contributing Guide](../CONTRIBUTING.md) — contributing to agent-harness
