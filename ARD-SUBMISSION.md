# ARD Ecosystem Submission — agent-harness

## Overview

This document describes how `agent-harness` participates in the ARD (Agentic Resource Discovery) ecosystem as a **publisher** of a self-hosted, well-known catalog manifest that Agent Finders crawl — and as a **consumer** of other publishers' manifests.

ARD spec version: **v0.91** (Status: Proposal, dated August 26, 2026). See <https://agenticresourcediscovery.org/spec> and the source repo <https://github.com/ards-project/ard-spec>. Published by Junjie Bu (Google), R.V. Guha (Microsoft), Shaun Smith (HuggingFace).

## Publisher Profile

| Field                          | Value                                                                    |
| ------------------------------ | ------------------------------------------------------------------------ |
| **Project**                    | agent-harness                                                            |
| **Publisher**                  | ar27111994                                                               |
| **FQDN**                       | ar27111994.dev                                                           |
| **Catalog URL**                | https://ar27111994.dev/.well-known/ard.json                              |
| **Legacy URL**                 | https://ar27111994.dev/.well-known/ai-catalog.json                       |
| **Spec version**               | ARD v0.91 (https://agenticresourcediscovery.org/spec)                    |
| **Manifest specVersion field** | "1.0" (ai-catalog predecessor only; `ard.json` carries no version field) |
| **URN prefix**                 | `urn:air:ar27111994.dev:*:*`                                             |
| **Publisher identity**         | https://ar27111994.dev                                                   |
| **License**                    | MIT                                                                      |
| **Repository**                 | https://github.com/ar27111994/agent-harness                              |

## What agent-harness Publishes

`agent-harness` publishes a curated catalog of reusable AI-agent assets — skills, MCP servers, plugins, agents, extensions, and prompt packs — discovered across 39 enabled asset-producing sources (of 50 configured; the `docs`-kind entries are metadata-only provenance references):

- **Official first-party repos**: Anthropic, OpenAI, Microsoft, Google, NVIDIA, Supabase, Firebase
- **Package registries**: npm, PyPI, crates.io, Go, Maven, NuGet, RubyGems, Packagist
- **Marketplaces**: VS Code Marketplace, Cursor Marketplace
- **Community registries**: skills.sh, ClawHub, Zed extensions, Pi packages, MCP registry
- **Awesome-lists**: 16 curated indexes (punkpeye/awesome-mcp-servers, etc.)

Every entry carries:

- A spec-conformant URN (`urn:air:ar27111994.dev:<namespace>:<name>-<hash>`)
- The correct ARD media type (e.g. MCP Server Card = `application/mcp-server-card+json`)
- Trust signals (publisher verification, authority tier, trust-manifest identity binding)
- Cross-host compatibility (VS Code, Cursor, Zed, Claude Code, OpenCode, Pi, Codex)
- Risk assessment and context-cost estimates

## Publisher Discovery (well-known manifests)

By ARD v0.91 §5.1, discovery is **self-hosted**: a publisher publishes manifests at well-known paths on its own domain, and Agent Finders crawl them. There is **no central PR registry** — the former `ards-project/community` registry repo no longer exists and must not be used.

### What we serve

| Path                           | Manifest shape                                                                                                                                                                                                                    | Status                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `/.well-known/ard.json`        | **ArdManifest** — root requires only `entries[]` (each entry requires `identifier`, `displayName`, `type`, and exactly one of `url`/`data`; `representativeQueries` is a SHOULD in 2–5). Any extra top-level members are ignored. | **Required / preferred** — consumers MUST fetch this.                                                               |
| `/.well-known/ai-catalog.json` | **AiCatalogManifest** — root requires `specVersion` (enum `["1.0"]`) + `entries[]`, optional `host`.                                                                                                                              | **Legacy** — the ARD predecessor path; consumers MAY consult it (treated as equivalent). Served as a courtesy only. |

Publishing guidance (§5.1 is informational for publishers, not a MUST): a publisher is **recommended** to serve `/.well-known/ard.json` and to emit the `rel="ard"` link relation, but neither is a publisher-side requirement. The normative requirement sits on the **consumer** side: Agent Finders MUST fetch `/.well-known/ard.json` and honor the `rel="ard"` relation. Serving only the predecessor `ai-catalog.json` risks the publisher not being found, since consulting it is optional for consumers. We serve **both** for backward compatibility.

### Discovery mechanisms we support

- `https://ar27111994.dev/.well-known/ard.json` — primary manifest (ArdManifest)
- `https://ar27111994.dev/.well-known/ai-catalog.json` — legacy predecessor (AiCatalogManifest)
- `<link rel="ard" href="https://ar27111994.dev/.well-known/ard.json">` in the site `<head>` — optional relation (recommended)
- In-page JSON-LD markup and `robots.txt` `Agentmap:` directives — supplementary optional mechanisms (may be added)

### Agents / catalogs that consume these manifests

- **GitHub Agent Finder** — <https://github.com/agentfinder> (live AI resource catalog, ~2000 entries)
- **HuggingFace Discover** — <https://github.com/huggingface/hf-discover>

These crawl well-known manifests on the publisher's advertised domain, so the manifest must be served (200, JSON) at the advertised host.

## Conformance

The catalog is generated by `src/ard-catalog.ts` (`writeArdCatalog`) and emits both `/.well-known/ard.json` (ArdManifest) and `/.well-known/ai-catalog.json` (AiCatalogManifest) atomically. The repository ships a vendored snapshot of the upstream schema (`discover/schema/ard-ai-catalog-1.0.schema.json`) plus a dependency-free validator:

```bash
npm run build
node ./dist/cli.js discover ard-export
npm run validate:ard-schema
npm run validate:ard-urls
```

> Note: `validate:ard-schema` validates the `ai-catalog.json` envelope (which carries `specVersion`). The `ard.json` ArdManifest omits `specVersion` by design (its schema does not require it), so it is not subject to that check.

## References

- [#325](https://github.com/ar27111994/agent-harness/issues/325) — ARD catalog export
- [#327](https://github.com/ar27111994/agent-harness/issues/327) — ARD registry consumer adapter
- [#328](https://github.com/ar27111994/agent-harness/issues/328) — ARD trust-manifest signals
- [#329](https://github.com/ar27111994/agent-harness/issues/329) — README ARD section
- [#488](https://github.com/ar27111994/agent-harness/issues/488) — refresh ARD submission + repair live well-known catalog
- [ARD spec v0.91](https://agenticresourcediscovery.org/spec)
- [ards-project/ard-spec](https://github.com/ards-project/ard-spec)
