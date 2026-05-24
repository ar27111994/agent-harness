# v2 Safe Defaults

`agent-harness` is safe by default without being inert. It can discover, rank, mirror, stage, activate, and preview useful agent assets automatically, but risky transitions require explicit intent and review.

## Default policy

| Area                        | Default                                                                                                                                                                                          | Requires explicit intent                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Discovery                   | Report sources, candidates, verification, health, drift, demand, and recommendations.                                                                                                            | Promoting source candidates or changing trust tiers.                                                                |
| Mirror                      | Build plans, locks, fingerprints, quarantine data, and audit records.                                                                                                                            | Approving quarantined assets or treating unverified risky mirrors as safe.                                          |
| Install refresh             | Report-only unless configured otherwise. `apply-safe` stages/applies only low-risk policy-approved changes and skips the whole apply when any asset is blocked, quarantined, or review-required. | `--apply`, native installs, quarantined assets, review-required assets, risky executable assets, ownership changes. |
| Activation                  | Materialize active views from already staged and eligible assets.                                                                                                                                | Activating unresolved quarantine or unreviewed executable/community assets.                                         |
| Wire                        | `wire <host>` is preview mode by default.                                                                                                                                                        | `--apply` for workspace/user mutation and `--reset` for managed cleanup.                                            |
| Native/global host installs | Never implicit in `wire` or default workspace reporting.                                                                                                                                         | `install native --operation install --apply` or equivalent explicit operation.                                      |
| Executable integrations     | Treated as review-sensitive.                                                                                                                                                                     | Enabling hooks, plugins, MCP servers, custom tools, extensions, OAuth/login, or host-native config payloads.        |
| Maintenance bot flows       | Generate report-only summaries and issue/PR intents.                                                                                                                                             | Merging trust/quarantine/executable/native-install changes.                                                         |

## Explicit boundaries

- `wire <host>` writes `activate/<host>/wire-preview-<host>.json` and does not mutate host files unless `--apply` is present.
- Mutating native install operations require both `--operation install|remove` and `--apply`.
- Install refresh writes `state/install/refresh-report.json` first and only mutates staged/native state when `--apply` is present, policy allows it, and the report has no blocked, quarantined, or review-required assets.
- Quarantined assets remain `blocked-quarantined` until reviewed.
- `trusted-community` and `unverified-community` executable assets require review before automatic refresh apply.
- Official-looking sources can be demoted when owner or publisher evidence changes.

## Policy blocks vs hard errors

A policy block means the harness understood the input and refused to mutate because review is required. It should point to reports or next commands. A hard error means the command could not complete because required state, runtime, schema, paths, or package contents were invalid.

Examples of policy blocks:

- quarantined latest mirror
- executable asset refresh requiring review
- unsupported native install provider for a host
- missing explicit `--apply` for a mutating native install

Examples of hard errors:

- invalid command flags
- corrupt manifests
- missing required package files
- invalid host-native payload path
- failed runtime preflight for required native install

## Key reports

Inspect these before applying changes:

- `discover/output/source-verification.json`
- `discover/output/source-candidates.json`
- `discover/output/source-health.json`
- `discover/output/source-drift.json`
- `discover/output/asset-fingerprints.json`
- `state/quarantine/quarantine-state.json`
- `state/quarantine/reviews.jsonl`
- `state/install/refresh-report.json`
- `activate/<host>/wire-preview-<host>.json`

## Related docs

- [`TRUST-CENTER.md`](https://github.com/ar27111994/agent-harness/blob/main/TRUST-CENTER.md)
- [`QUARANTINE-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/QUARANTINE-PLAYBOOK.md)
- [`HARNESS-MAINTENANCE-GUIDE.md`](https://github.com/ar27111994/agent-harness/blob/main/HARNESS-MAINTENANCE-GUIDE.md)
- [`V2-CONTRACT.md`](https://github.com/ar27111994/agent-harness/blob/main/V2-CONTRACT.md)
