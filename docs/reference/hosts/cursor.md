# Cursor

Adapter implementation:

- `src/host-adapters/native-wire.ts`
- registered as `cursor` in `src/host-adapters/registry.ts`

Cursor is a project-local native adapter. It reuses the VS Code / Copilot lifecycle host for install and activation but ranks assets through its own `cursor` recommendation policy.

## Official docs

- <https://cursor.com/docs/rules>
- <https://cursor.com/docs/skills>
- <https://cursor.com/docs/plugins>
- <https://cursor.com/docs/mcp>
- <https://cursor.com/docs/hooks>
- <https://cursor.com/docs/subagents>
- <https://cursor.com/marketplace>

## Supported behavior

- writes the documented Cursor rules file `.cursor/rules/agent-harness.mdc`
- materializes selected assets under `.cursor/agent-harness/`
- stages a Cursor plugin-compatible component tree at `.cursor/agent-harness/cursor-plugin/` with a `.cursor-plugin/plugin.json` manifest
- maps selected Cursor command-like assets from `workflow` and `prompt-pack` recommendations into staged plugin `commands/`
- stages plugin-compatible `agents/`, `skills/`, `rules/`, and reference files for hosts that register project plugin paths
- writes `activate/cursor/wire-preview-cursor.json`
- writes `activate/cursor/wire-plan.json` on apply
- avoids global Cursor profile mutation
- avoids global VS Code profile mutation
- plans explicit Cursor native extension install/verify/remove actions when selected extension assets expose structured extension IDs

## Documented Cursor-native surfaces used directly

- `.cursor/rules/`
- `.cursor/agents/`
- `.cursor/mcp.json` when structured native payloads are present
- `.cursor/hooks.json` / `.cursor/hooks/` when structured native payloads are present
- compatible plugin bundle format via `.cursor-plugin/plugin.json`

## Agent-harness staged/plugin-compatible surfaces

- `.cursor/agent-harness/`
- `.cursor/agent-harness/cursor-plugin/`
- staged plugin `agents/`, `skills/`, `rules/`, `commands/`, and references

## Known limitations

Host-specific details only; see [Managed wire-in vs native/global install](../index.md#managed-wire-in-vs-nativeglobal-install) for the shared invariants:

- Cursor native extension installation is explicit through `install native --host cursor --operation <verify|install|remove>` and depends on a compatible `cursor` CLI.
- `.cursor/agent-harness/` and `.cursor/agent-harness/cursor-plugin/` are staged project-local managed locations; `.cursor/agent-harness/cursor-plugin/` is treated as a compatible plugin bundle, and registering plugin paths remains host/user-managed.
- `.cursor/mcp.json` and `.cursor/hooks*.json` synthesis is opt-in and only happens when an asset carries structured host-native payloads for those documented files.
- Extension-like assets without structured extension IDs are treated as reference material in the project-local managed tree.
