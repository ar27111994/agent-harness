# v2 CLI and Report Contract

This document defines the v2-stable automation surface for `agent-harness`. End-user playbooks, maintenance jobs, and AI agents may rely on the commands and reports marked stable here throughout the v2 line.

## Compatibility rules

- Stable JSON reports use `schemaVersion: 1` unless noted otherwise.
- Additive fields are allowed in v2.
- Field removals, type changes, renamed files, or changed command semantics require a migration note in the upgrade/release notes.
- Internal/debug files are not stable unless listed in this document.
- Prefer regenerating state over migrating ambiguous or pre-v2 artifacts.

## Exit codes

- `0` — command completed successfully. Warnings and policy blocks can still be present in generated reports.
- `1` — invalid command/flags, validation failure, policy block that prevents requested mutation, or hard runtime failure.
- Future v2 minors may add more specific non-zero codes, but `0` vs non-zero remains stable for automation.

## Preview, dry-run, and apply semantics

- Default lifecycle commands are preview/report-first when mutation is risky.
- `--apply` is required for host-facing mutation, native install/remove, quarantine decisions, and wire application.
- Preview/report commands may write machine-readable reports under `discover/output/`, `state/`, `mirror/`, `install/`, or `activate/` so agents can review evidence.
- `wire <host>` previews exact target paths and notes; `wire <host> --apply` performs the managed writes.
- `wire <host> --reset` removes adapter-managed project outputs without touching global host state.

## Stable lifecycle commands

### Discovery and source maintenance

```bash
agent-harness discover demand-profile
agent-harness discover sources
agent-harness discover sync
agent-harness discover catalog
agent-harness discover select --no-ai-enrich
agent-harness discover stats
agent-harness discover breadth
```

Stable reports:

- `discover/output/demand-profile.json`
- `discover/output/unknown-signals.json`
- `discover/output/source-health.json`
- `discover/output/source-drift.json`
- `discover/output/catalog-maintenance-candidates.json`
- `discover/output/source-verification.json`
- `discover/output/source-candidates.json`
- `discover/output/asset-fingerprints.json`

Schema/schema-like locations:

- `discover/schema/source-registry.schema.json`
- `discover/schema/source-pack.schema.json`
- `discover/schema/official-upstreams.schema.json`
- `src/types/discovery.ts`

### Recommendation

```bash
agent-harness recommend report --intent <intent>
```

Stable report:

- `state/recommendations.json`

Schema/schema-like locations:

- `discover/schema/recommendation-policy-base.schema.json`
- `discover/schema/recommendation-host-policy-override.schema.json`
- `src/types/recommendation.ts`

### Mirror and bundle locks

```bash
agent-harness mirror plan
agent-harness mirror locks
agent-harness mirror acquire
agent-harness mirror diff
agent-harness mirror explain --asset <asset-id>
```

Stable files/reports:

- `mirror/index.jsonl`
- `mirror/bundles/*.lock.json`
- `state/mirror/acquire-state.json`

Schema/schema-like locations:

- `mirror/policy.json`
- `src/types/mirror.ts`

### Quarantine

```bash
agent-harness quarantine list
agent-harness quarantine inspect --asset <asset-id>
agent-harness quarantine report
agent-harness quarantine approve --asset <asset-id> --reason <reason>
agent-harness quarantine reject --asset <asset-id> --reason <reason>
agent-harness quarantine pin --asset <asset-id> --reason <reason>
```

Stable files/reports:

- `state/quarantine/reviews.jsonl`
- `state/quarantine/quarantine-state.json`

Schema/schema-like locations:

- `src/types/quarantine.ts`
- `src/manifest-validation/quarantine.ts`

### Stage/install refresh

```bash
agent-harness install refresh --host <host>
agent-harness install refresh --host <host> --due-only
AGENT_HARNESS_INSTALL_REFRESH_POLICY=apply-safe agent-harness install refresh --host <host> --apply
agent-harness install native --host <host> --operation verify
agent-harness install native --host <host> --operation install --apply
agent-harness install native --host <host> --operation remove --apply
```

Stable files/reports:

- `install/generations/<host>/current.json`
- `install/<host>/packages/*/install-manifest.json`
- `state/install/refresh-report.json`
- `state/install/refresh-state.json`
- `state/install/native-extensions.json`

Schema/schema-like locations:

- `src/types/install.ts`
- `src/manifest-validation/install.ts`

### Wire and activation

```bash
agent-harness wire <host>
agent-harness wire <host> --apply
agent-harness wire <host> --reset
agent-harness activate host --host <host> --intent <intent>
agent-harness activate rollback --host <host> --generation <generation-id>
```

Stable files/reports:

- `activate/<host>/activation-manifest.json`
- `activate/<host>/wire-preview-<host>.json`
- `activate/<host>/wire-plan.json`
- host-managed project files listed in each wire preview

Schema/schema-like locations:

- `src/types/activation.ts`
- `src/manifest-validation/workspace.ts`

## Internal or non-stable outputs

These may change within v2 and should not be used as durable automation contracts unless promoted in this document:

- console wording beyond exit code and explicit report paths
- debug logs enabled by environment variables
- `.tmp/` files
- transient cache files
- raw mirrored source material under `mirror/raw/`
- host CLI stdout/stderr captured during native install attempts

## Breaking-change requirement

Any pull request that changes stable command semantics, stable file locations, or stable report fields must also update:

1. this contract,
2. the relevant type/schema or validator,
3. focused tests for the changed shape, and
4. the v1-to-v2 upgrade guide or release notes when users need an action.
