# Security and Trust Center

`agent-harness` moves reusable AI-agent assets through a supply-chain lifecycle. Those assets may be plain instructions, but they may also describe MCP servers, plugins, hooks, extensions, package install metadata, or prompt text that attempts to override local rules. The v2 security model is therefore built around evidence, review gates, reversible outputs, and explicit activation.

This document is for both end users and maintainers. It explains what the harness promises, what it does not promise, and which actions still require human review.

## Short version

For the concise lifecycle policy matrix, see [`SAFE-DEFAULTS.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/SAFE-DEFAULTS.md).

Safe by default means:

- Discovery and recommendation can report on untrusted assets, but risky assets are quarantined before stage/activation/wire-in.
- `wire <host>` previews planned writes first; `--apply` is required for workspace mutation.
- Native/global host installs, marketplace extensions, executable hooks, plugins, MCP server activation, OAuth/login, and trust-tier promotion are explicit review actions.
- Official-looking sources are verified and can be demoted when ownership or publisher evidence fails.
- Community and experimental assets are never silently promoted to trusted status.
- Reset/failure rollback is designed to remove managed outputs or restore captured text-file snapshots without deleting unrelated user content.

## Trust tiers

The catalog uses these authority tiers:

| Tier                   | Meaning                                                                                        | Default handling                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `trusted-local`        | User-authored or repository-local fixtures/config intentionally supplied to the harness.       | Eligible when the local source is explicitly configured. Still subject to path and payload validation.         |
| `official-first-party` | First-party repository or documentation controlled by the host/project vendor.                 | Preferred when ownership evidence matches; demoted when verification fails.                                    |
| `official-marketplace` | Marketplace entry from a host or package ecosystem with publisher metadata.                    | Eligible when publisher/package evidence is consistent; executable behavior still needs review where relevant. |
| `official-compatible`  | Official or vendor-adjacent source compatible with another host lifecycle.                     | Usable as compatibility evidence, not proof that every asset is native to the target host.                     |
| `trusted-community`    | Community source with positive evidence such as maintenance, reputation, and low-risk content. | Can be recommended, but executable capabilities and trust promotion remain review-gated.                       |
| `unverified-community` | Unknown, new, stale, ambiguous, or weakly evidenced community source.                          | Reportable/catalogable, but risky assets route to quarantine and are not silently activated.                   |

Trust is not only popularity. Stars, downloads, or mentions can help ranking, but they do not override source identity, content risk, publisher verification, or quarantine state.

## Source verification and network boundary

Discovery can read configured sources, generated local config roots, registries, package metadata, and marketplace references. The source-sync boundary is intentionally conservative:

- Source registry entries declare source kind, hosts, authority tier, origin URL, and expected asset kinds.
- Official sources are checked against owner/publisher evidence; failures are recorded in `discover/output/source-verification.json` and demoted instead of trusted by name alone.
- Source health, drift, and productivity are reported in `discover/output/source-health.json` and `discover/output/source-drift.json`.
- New candidates are written to `discover/output/source-candidates.json` for review before catalog promotion.
- Local generated config sources for host settings are catalog-only by default so private settings, hooks, and MCP files are not mirrored unless a user-authored source opts in.

Security non-goal: the harness does not prove that the upstream author is benign. It records evidence, applies safe defaults, and makes review decisions visible.

### Source-sync origin allowlist and SSRF backstop

`source-sync` uses a **self-derived origin allowlist** to restrict outbound fetch calls to the exact hostnames declared in checked-in source definitions. This allowlist is built at request time from the source pack's own `endpoints` URLs — it is not a static list and it is not user-configurable at runtime.

How the boundary works:

1. Each source definition in the checked-in source registry declares one or more endpoint URLs under `endpoints`.
2. Before any network call, `source-sync` extracts the origin (scheme + host + port) from those declared URLs and passes it as an explicit allowlist to the shared HTTP guard layer.
3. The shared HTTP guard layer independently enforces an **SSRF backstop**: it rejects requests that resolve to private IP ranges (RFC 1918, loopback, link-local, multicast), unroutable addresses, or bare IP literals, regardless of what the allowlist says.
4. If the resolved hostname does not appear in the derived allowlist, the fetch is refused before a TCP connection is opened.

This means that even if a source definition were tampered with to include an attacker-controlled hostname, the HTTP guard's SSRF backstop provides an independent defense against SSRF and internal-network probing.

**Important limitation:** the self-derived allowlist is specific to `source-sync` and its checked-in source pack. It must **not** be reused for other features that accept arbitrary user-provided runtime URLs (for example, custom webhook endpoints, user-supplied proxy URLs, or OAuth callback overrides). Those cases require a separate, separately-reviewed allowlist or must be routed through a dedicated validation layer. See [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for guidance on security patterns contributors must not copy from `source-sync`.

## Quarantine rules

Quarantine is the hard stop for risky or ambiguous assets. Quarantined assets must not be staged, activated, refreshed into an installed generation, or wired into a workspace until reviewed.

Assets should enter or remain in quarantine when they include or gain:

- executable hooks, shell snippets, install scripts, package-manager lifecycle scripts, or binary launch instructions
- MCP servers, plugins, extensions, custom tools, OAuth/login requirements, or network-facing runtime behavior
- prompt-injection-like instructions such as ignoring system/developer/user policy, exfiltrating secrets, or hiding behavior
- ambiguous source ownership, publisher verification failure, suspicious redirects, or stale/superseded community mirrors
- changed fingerprints where installed content and latest upstream content differ in security-relevant ways

Review commands:

```bash
agent-harness quarantine list
agent-harness quarantine inspect --asset <asset-id>
agent-harness quarantine report
agent-harness quarantine approve --asset <asset-id> --reason "reviewed source and content"
agent-harness quarantine reject --asset <asset-id> --reason "unsafe prompt or executable behavior"
agent-harness quarantine pin --asset <asset-id> --reason "keep blocked until upstream ownership is verified"
```

Review records are written to `state/quarantine/reviews.jsonl`; the current state is summarized in `state/quarantine/quarantine-state.json`.

## Prompt-injection handling

Agent assets are treated as untrusted content until selected and wired. The harness may catalog prompt-like text, but it does not treat the content as instructions for the harness itself.

Prompt-injection-like content is a risk signal when it attempts to:

- override local policy or host rules
- hide files, commands, network calls, or execution behavior
- request credentials, tokens, private repository contents, or environment variables
- disable review, quarantine, validation, logging, or user approval
- force unsafe tool use through hooks/plugins/MCP/custom tools

The harness can flag and quarantine such content. It cannot guarantee that a downstream AI host will ignore a malicious prompt after a user explicitly wires it in. Users should inspect generated files and keep risky assets blocked unless the behavior is intended and isolated.

## Executable assets and native integrations

Executable capability is always special. The harness distinguishes reference material from active host-native configuration.

The harness will never silently:

- run package install scripts from discovered assets
- install VS Code/Cursor marketplace extensions
- enable executable hooks, plugins, MCP servers, or custom tools
- perform MCP OAuth/login flows
- write global Codex, Claude Code, OpenCode, Cursor, Zed, Pi, or VS Code profile state beyond the adapter's documented explicit apply behavior
- enable remote connections, browser/computer-use settings, full-access sandbox settings, or automations
- promote community trust tiers or approve quarantine during automatic maintenance

When a supported adapter exposes native install operations, they must be called explicitly through native-install commands and the adapter runtime must pass preflight checks.

## Safe defaults by lifecycle phase

| Phase               | Safe default                                                                      | Review-required actions                                                            |
| ------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `discover`          | Build reports, source health, verification, candidates, and catalogs.             | Promoting source candidates or changing trust tiers.                               |
| `recommend`         | Rank assets using demand, trust, cost, risk, diversity, and caps.                 | Overriding policy to favor risky/executable/community assets.                      |
| `mirror`            | Produce mirror plans, locks, fingerprints, audit records, and quarantine reports. | Approving quarantined or changed risky assets.                                     |
| `stage` / `install` | Stage bounded mirrored bundles into managed lifecycle state.                      | Native/global install, verify, remove, or applying refresh updates.                |
| `activate`          | Materialize selected runtime views from staged packages.                          | Activating assets with unresolved quarantine or executable risk.                   |
| `wire`              | Preview target paths and notes.                                                   | `--apply`, `--reset`, host-native config payloads, and any executable integration. |
| maintenance         | Report-only discovery/refresh summaries.                                          | Bot PRs that alter trust, quarantine, native install, or executable behavior.      |

## Guarantees

The project aims to guarantee that:

- registered host adapters declare their lifecycle host, recommendation host, supported asset kinds, native-install boundaries, and wire preview/apply/reset behavior
- wire preview is non-mutating for host files
- wire apply writes only adapter-managed project/user locations described in the docs
- wire reset removes managed outputs and preserves unrelated user content where snapshots/managed markers support restoration
- quarantined assets remain blocked from safe refresh/apply paths
- official-source verification failures are visible instead of silently trusted
- generated reports are inspectable JSON/JSONL/Markdown artifacts suitable for CI and review

## Non-guarantees and limitations

The harness does not guarantee that:

- a source, package, marketplace entry, or repository is safe just because it is popular or official-looking
- a downstream AI host will safely interpret malicious instructions after the user wires them in
- external registries, package metadata, GitHub search, or marketplace APIs are complete, fresh, or available
- every host-native surface is supported; unsupported and partial capabilities are documented in the host support matrix
- native/global host configuration outside managed paths can be restored if it was changed manually outside the harness
- security review can be automated away for executable hooks/plugins/MCP/extensions or trust-tier changes

## User responsibilities

Before applying changes, users should:

1. Run preview/report commands first.
2. Inspect quarantine, source verification, source candidates, asset fingerprints, and refresh reports.
3. Treat executable integrations as code review, not as documentation review.
4. Keep secrets out of asset content, logs, generated reports, and issue attachments.
5. Use least-privilege tokens for discovery and release automation.
6. Pin or reject unclear assets instead of approving them because they are new or popular.
7. Use `wire <host> --reset` if generated project files need to be removed.

## Maintainer responsibilities

Maintainers should keep these checks aligned:

- source verification and demotion rules
- community scoring and quarantine risk signals
- refresh policy tiers and blocked-quarantined decisions
- host adapter support matrix and compliance tests
- manifest validation for stable report contracts
- release provenance and package audit checks

When adding a host or asset kind, update the host support matrix, security/trust docs, manifest validation, and adapter compliance tests in the same change.

## Related docs

- [`SECURITY.md`](https://github.com/ar27111994/agent-harness/blob/main/SECURITY.md)
- [`QUARANTINE-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/QUARANTINE-PLAYBOOK.md)
- [`HOST-SURFACE-AUDIT.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/reference/HOST-SURFACE-AUDIT.md)
- [`HARNESS-MAINTENANCE-GUIDE.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/HARNESS-MAINTENANCE-GUIDE.md)
- [`V2-CONTRACT.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/V2-CONTRACT.md)
- [`ASSET-UPDATE-PLAYBOOK.md`](https://github.com/ar27111994/agent-harness/blob/main/docs/playbooks/ASSET-UPDATE-PLAYBOOK.md)
