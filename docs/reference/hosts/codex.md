# OpenAI Codex

The Codex adapter uses the OpenCode-compatible lifecycle host while applying Codex-specific recommendation policy and project-local wire-in surfaces.

## Official references

- <https://developers.openai.com/codex>
- <https://developers.openai.com/codex/app>
- <https://developers.openai.com/codex/cli>
- <https://developers.openai.com/codex/skills>
- <https://developers.openai.com/codex/plugins>
- <https://developers.openai.com/codex/mcp>
- <https://developers.openai.com/codex/hooks>
- <https://developers.openai.com/codex/guides/agents-md>

## What the adapter does

- writes a managed Codex section into project `AGENTS.md`
- materializes selected skills into repo-local `.agents/skills/agent-harness/`
- writes a repo-local `.agents/plugins/marketplace.json` and reviewable `agent-harness` plugin descriptor
- stores reference assets under `.codex/agent-harness/`
- applies structured Codex-native payloads only when assets explicitly provide documented host-native config
- supports native extension installation via `stage native --host codex` (uses the same VS Code extension install mechanism; #407)

## What it does not do by default

- it does not write global `~/.codex` config or plugin cache entries
- it does not silently enable plugin hooks
- it does not perform MCP OAuth/login or create MCP server config without structured native payloads
- it does not create automations, remote connections, browser/computer-use settings, or full-access sandbox settings
- native extension install requires the `codex` CLI on PATH for runtime validation; falls back to file-only staging when unavailable
