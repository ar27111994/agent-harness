# Scheduled Maintenance Workflow

This workflow keeps discovery, catalogue, recommendation, refresh, and evidence reports current after initial wire-in without silently changing trust tiers or installing risky assets.

## GitHub Actions

The scheduled workflow lives at `.github/workflows/maintenance.yml` and runs weekly plus manual `workflow_dispatch`.

It performs:

```bash
npm ci
npm run build
npm run discover:sources
npm run discover:sync
npm run discover:sources
npm run discover:catalog
npm run discover:select -- --no-ai-enrich
npm run discover:stats
npm run recommend:report -- --intent general
node ./dist/cli.js install refresh --host copilot-vscode --due-only
node ./scripts/maintenance-summary.mjs
```

The workflow uploads these artifacts:

- `discover/output/source-health.json`
- `discover/output/source-drift.json`
- `discover/output/catalog-maintenance-candidates.json`
- `discover/output/source-verification.json`
- `discover/output/source-candidates.json`
- `discover/output/unknown-signals.json`
- `discover/output/asset-fingerprints.json`
- `discover/output/maintenance-summary.md`
- `state/install/refresh-report.json`
- `state/install/refresh-state.json`

## Local dry run

```bash
npm run build
npm run discover:sources
npm run discover:sync
npm run discover:sources
npm run discover:catalog
npm run discover:select -- --no-ai-enrich
npm run discover:stats
npm run recommend:report -- --intent general
node ./dist/cli.js install refresh --host copilot-vscode --due-only
node ./scripts/maintenance-summary.mjs
```

For low-rate local runs, bound sync breadth:

```bash
AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_PER_RUN=1 \
AGENT_HARNESS_GENERIC_REFERENCE_MAX_ITEMS=50 \
AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_QUERIES=2 \
AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_ITEMS_PER_QUERY=10 \
npm run discover:sync
```

## Review boundaries

Safe to propose automatically as report-only PRs:

- refreshed generated reports
- low-risk metadata corrections with stable provenance
- dormant-source notes that do not change trust tier
- non-mutating documentation updates

Must stay human-review-gated:

- official-source promotion or ownership changes
- trust-tier demotions or ambiguous publisher evidence
- source candidates from community/awesome-list evidence
- quarantine approve/reject decisions
- executable hooks, MCP servers, plugins, extensions, install scripts, and native/global install actions

## Noise control

The workflow uses bounded sync settings so scheduled jobs remain actionable and rate-limit friendly. Severe findings should come from deterministic reports, not raw logs:

- newly failing or dormant sources: `source-health.json` / `source-drift.json`
- newly productive or duplicate-heavy sources: `source-health.json`
- official owner/publisher ambiguity: `source-verification.json`
- unknown workspace or source candidates: `unknown-signals.json` / `source-candidates.json`
- stale staged assets: `state/install/refresh-report.json`

If maintenance starts producing noisy artifacts, tune the report thresholds before broadening automation.
