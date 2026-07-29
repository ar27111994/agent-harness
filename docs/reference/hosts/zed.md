# Zed

Adapter implementation:

- `src/host-adapters/zed-native.ts`
- registered as `zed` in `src/host-adapters/registry.ts`
- reuses shared `src/host-adapters/native-utils.ts` for common wiring behaviors

Zed is a project-local native adapter. It reuses the OpenCode-compatible lifecycle host for install and activation but ranks assets through its own `zed` recommendation policy.

## Official docs

- <https://zed.dev/docs/ai/rules>
- <https://zed.dev/docs/ai/mcp>
- <https://zed.dev/docs/reference/all-settings.html>

## Supported behavior

- updates the documented project `.rules` file with an agent-harness managed section
- adds an `agent-harness` profile entry to `.zed/settings.json`
- materializes selected assets of every supported asset kind under `.zed/agent-harness/`
- surfaces agents, skills, workflows, prompt packs, plugins, hooks, extensions, reference packs, and MCP assets as project-readable references in managed Zed context
- writes `activate/zed/wire-preview-zed.json`
- writes `activate/zed/wire-plan.json` on apply
- avoids global Zed profile/settings mutation
- avoids global OpenCode profile mutation

## Documented Zed-native surfaces used directly

- `.rules`
- `.zed/settings.json` agent profile settings

## Agent-harness managed reference surfaces

- `.zed/agent-harness/`
- project-readable references for non-native asset kinds

## Known limitations

Host-specific details only; see [Managed wire-in vs native/global install](../../README.md#managed-wire-in-vs-nativeglobal-install) for the shared invariants:

- The adapter writes project-local context and profile hints.
- Zed extension installation remains manual through Zed's Extension Gallery or `auto_install_extensions`; extension assets are wired as managed project references unless explicit extension-install intent is provided.
- `.zed/agent-harness/` is a managed reference tree, not a claim that every staged asset kind is a documented Zed-native directory.
- Zed's documented MCP/context-server settings can be synthesized when an asset includes structured host-native config payloads for `.zed/settings.json`.
