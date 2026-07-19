# ARD Ecosystem Submission — agent-harness

## Overview

This document describes how `agent-harness` participates in the ARD (Agentic Resource Discovery) ecosystem as both a **publisher** and a **consumer**, for community registry submission.

## Publisher Profile

| Field            | Value                                                    |
| ---------------- | -------------------------------------------------------- |
| **Project**      | agent-harness                                            |
| **Publisher**    | ar27111994                                               |
| **FQDN**         | ar27111994.github.io                                     |
| **Catalog URL**  | https://ar27111994.github.io/.well-known/ai-catalog.json |
| **Spec version** | ARD v0.9 (https://agenticresourcediscovery.org/spec)     |
| **URN prefix**   | `urn:ai:ar27111994.github.io:*:*`                        |
| **License**      | MIT                                                      |
| **Repository**   | https://github.com/ar27111994/agent-harness              |

## What agent-harness Publishes

`agent-harness` publishes a curated catalog of reusable AI-agent assets — skills, MCP servers, plugins, agents, extensions, and prompt packs — discovered across 45+ sources including:

- **Official first-party repos**: Anthropic, OpenAI, Microsoft, Google, NVIDIA, Supabase, Firebase
- **Package registries**: npm, PyPI, crates.io, Go, Maven, NuGet, RubyGems, Packagist
- **Marketplaces**: VS Code Marketplace, Cursor Marketplace
- **Community registries**: skills.sh, ClawHub, Zed extensions, Pi packages, MCP registry
- **Awesome-lists**: 16 curated indexes (punkpeye/awesome-mcp-servers, etc.)

Every entry carries:

- Trust signals (OMS signatures, publisher verification, authority tier)
- Cross-host compatibility (VS Code, Cursor, Zed, Claude Code, OpenCode, Pi, Codex)
- Risk assessment (hooks, exec scripts, network requirements)
- Context-cost estimates

## Registry Submissions

### 1. ards-project Community

Submit a PR to https://github.com/ards-project/community adding agent-harness to the ecosystem registry:

```json
{
  "identifier": "urn:ai:ar27111994.github.io:cli:agent-harness",
  "displayName": "agent-harness",
  "type": "application/ai-catalog+json",
  "url": "https://ar27111994.github.io/.well-known/ai-catalog.json",
  "description": "AI-agent asset supply-chain: discovers, recommends, mirrors, stages, activates, and wires reusable agent skills, MCP servers, plugins, and agents across 7 host IDEs",
  "capabilities": [
    "discovery",
    "recommendation",
    "mirroring",
    "staging",
    "activation",
    "host-wiring"
  ],
  "tags": ["cli", "supply-chain", "skills", "mcp-servers", "agent-assets"]
}
```

### 2. GitHub Agent Finder

Submit via the Agent Finder onboarding flow at https://github.com/agentfinder. The catalog is already hosted at the well-known URI.

### 3. HuggingFace Discover

Submit via https://github.com/huggingface/hf-discover. agent-harness assets include MCP servers and skills discoverable through HuggingFace's agent ecosystem.

## Conformance

The catalog validates against the ARD v0.9 schema:

```bash
npx ajv-cli validate -s https://agenticresourcediscovery.org/spec/v0.9/schemas/ai-catalog.json \
  -d https://ar27111994.github.io/.well-known/ai-catalog.json
```

## References

- [#325](https://github.com/ar27111994/agent-harness/issues/325) — ARD catalog export
- [#327](https://github.com/ar27111994/agent-harness/issues/327) — ARD registry consumer adapter
- [#328](https://github.com/ar27111994/agent-harness/issues/328) — ARD trust-manifest signals
- [#329](https://github.com/ar27111994/agent-harness/issues/329) — README ARD section
- [ARD Spec v0.9](https://agenticresourcediscovery.org/spec)
- [ards-project/ard-spec](https://github.com/ards-project/ard-spec)
