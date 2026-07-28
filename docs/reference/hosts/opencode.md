# OpenCode

Adapter implementation:

- `src/host-adapters/opencode.ts`

This adapter is intentionally host-specific because OpenCode consumes project-local overlays and asset-kind directory layouts.

## Official docs

- <https://opencode.ai/docs/rules/>
- <https://opencode.ai/docs/agents/>
- <https://opencode.ai/docs/skills/>
- <https://opencode.ai/docs/commands/>
- <https://opencode.ai/docs/plugins/>
- <https://opencode.ai/docs/mcp-servers/>
- <https://opencode.ai/docs/custom-tools/>
- <https://opencode.ai/docs/config/>

## Supported behavior

- writes a managed overlay under `.opencode/context/project-intelligence/agent-harness/`
- updates/removes managed `AGENTS.md` sections
- links selected assets into project-local `.opencode/` directories by asset kind, mapping workflow and prompt-pack assets to OpenCode `commands/`
- writes an effective project-local wire plan under the managed overlay
- projects shared MCP references into the wire plan when available
- uses Windows directory junctions on Windows
- avoids global OpenCode or OpenAgentsControl install mutation
- does not require a global OpenCode config directory for project-local apply/reset

## Managed project-local locations

- `.opencode/context/project-intelligence/agent-harness/`
- `.opencode/agents/`
- `.opencode/skills/`
- `.opencode/commands/`
- `.opencode/plugins/`
- `.opencode/context/project-intelligence/agent-harness/instructions/`
- `.opencode/context/project-intelligence/agent-harness/hooks/`
- `.opencode/context/project-intelligence/agent-harness/mcp-servers/`
- `.opencode/context/project-intelligence/agent-harness/extensions/`
- `.opencode/context/project-intelligence/agent-harness/reference-packs/`
- `AGENTS.md`

## Documented OpenCode-native surfaces used or compatible with

- `AGENTS.md`
- `opencode.json` `instructions`
- `opencode.json` `mcp` when structured native payloads are present
- `.opencode/agents/`
- `.opencode/skills/`
- `.opencode/commands/`
- `.opencode/plugins/`
- `.opencode/tools/` when structured native payloads are present

## Agent-harness-managed overlay/reference locations

- `.opencode/context/project-intelligence/agent-harness/`
- harness-managed context-root link targets such as `.opencode/context/project-intelligence/agent-harness/instructions/`, `.opencode/context/project-intelligence/agent-harness/hooks/`, `.opencode/context/project-intelligence/agent-harness/mcp-servers/`, `.opencode/context/project-intelligence/agent-harness/extensions/`, and `.opencode/context/project-intelligence/agent-harness/reference-packs/`
- `AGENTS.md` managed sections

## Wire-plan outputs

- `activate/opencode/wire-preview-opencode.json`
- `.opencode/context/project-intelligence/agent-harness/wire-plan.json`

## Known limitations

Host-specific details only; see [Managed wire-in vs native/global install](../index.md#managed-wire-in-vs-nativeglobal-install) for the shared invariants:

- The adapter links activated assets into a project-local overlay and reference tree.
- It does not claim that every harness-managed `.opencode/*` path is a documented native OpenCode auto-discovery surface.
- `opencode.json` remains opt-in: managed instruction entries are projected there automatically, and MCP/tool synthesis only happens when an asset carries structured host-native payloads for those documented surfaces.
- It does not install or modify global OpenCode packages or any global OpenCode MCP configuration.
