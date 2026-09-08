# Claude Code

Adapter implementation:

- `src/host-adapters/claude-code-native.ts`
- registered as `claude-code` in `src/host-adapters/registry.ts`
- reuses shared `src/host-adapters/native-utils.ts` for common wiring behaviors

Claude Code is a project-local native adapter. It reuses the OpenCode-compatible lifecycle host for install and activation but ranks assets through its own `claude-code` recommendation policy.

## Official docs

- <https://code.claude.com/docs/en/memory>
- <https://code.claude.com/docs/en/slash-commands>
- <https://code.claude.com/docs/en/sub-agents>
- <https://code.claude.com/docs/en/hooks>
- <https://code.claude.com/docs/en/plugins>
- <https://code.claude.com/docs/en/plugin-marketplaces>
- <https://code.claude.com/docs/en/settings>

## Supported behavior

- writes managed project context to `CLAUDE.md`
- writes managed local Claude context to `.claude/CLAUDE.md`
- writes `.claude/rules/agent-harness.md`
- writes `.claude/agents/agent-harness.md`
- writes `.claude/skills/agent-harness/SKILL.md`
- writes `.claude/commands/agent-harness.md`
- writes `.claude-plugin/marketplace.json` with a managed local `./plugins/agent-harness` source
- writes `plugins/agent-harness/.claude-plugin/plugin.json` with version and author metadata
- maps selected Claude Code command-like assets from `workflow` and `prompt-pack` recommendations into the managed command context
- includes selected instruction, agent, skill, workflow, and prompt-pack content in the matching managed Claude files
- materializes selected assets of every supported asset kind under `.claude/agent-harness/`
- surfaces hooks, extensions, reference packs, and MCP assets as managed project-readable references unless they carry compatible Claude-native payloads
- writes `activate/claude-code/wire-preview-claude-code.json`
- writes `activate/claude-code/wire-plan.json` on apply
- avoids global Claude Code profile mutation

## Known limitations

Host-specific details only; see [Managed wire-in vs native/global install](../../README.md#managed-wire-in-vs-nativeglobal-install) for the shared invariants:

- MCP and reference assets are still staged as project-readable references by default.
- The adapter can synthesize Claude Code `.mcp.json` and `.claude/settings*.json` surfaces when an asset includes structured host-native config payloads.
- Executable hook/plugin settings still require asset metadata that deliberately targets those documented Claude surfaces.
