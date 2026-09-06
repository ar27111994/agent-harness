# Pi

Adapter implementation:

- `src/host-adapters/pi-native.ts`
- registered as `pi` in `src/host-adapters/registry.ts`
- reuses shared `src/host-adapters/native-utils.ts` for common wiring behaviors

Pi is a project-local native adapter. It reuses the OpenCode-compatible lifecycle host for install and activation but ranks assets through its own `pi` recommendation policy.

## Official docs

- <https://pi.dev/docs/latest/settings>
- <https://pi.dev/docs/latest/skills>
- <https://pi.dev/docs/latest/prompt-templates>
- <https://pi.dev/docs/latest/extensions>
- <https://pi.dev/docs/latest/packages>
- <https://pi.dev/docs/latest/usage>

## Supported behavior

- writes managed project agent context to `AGENTS.md`
- writes managed project system context to `SYSTEM.md`
- writes `.pi/skills/agent-harness/SKILL.md`
- writes `.pi/prompts/agent-harness.md`
- updates `.pi/settings.json` using Pi's documented top-level `skills` and `prompts` arrays
- includes selected instruction, agent, skill, workflow, and prompt-pack content in the matching managed Pi files
- materializes selected assets of every supported asset kind under `.pi/agent-harness/`
- stages plugins, hooks, extensions, reference packs, and MCP assets as managed project-readable references; native extension/package installation remains stage-only
- writes `activate/pi/wire-preview-pi.json`
- writes `activate/pi/wire-plan.json` on apply
- avoids global Pi profile mutation

## Documented Pi-native surfaces used directly

- `AGENTS.md`
- `SYSTEM.md`
- `.pi/skills/`
- `.pi/prompts/`
- `.pi/settings.json` top-level resource arrays

## Known limitations

Host-specific details only; see [Managed wire-in vs native/global install](../../README.md#managed-wire-in-vs-nativeglobal-install) for the shared invariants:

- Pi does not include `shared-mcp` in its default bundles.
- `.pi/agent-harness/` remains a harness-managed reference tree for non-native assets.
- `.pi/extensions/` and `.pi/packages/` can be synthesized when an asset includes structured host-native config payloads.
- Stage-only native extension/package assets are not installed or activated by `wire pi`; the operator must review and install them through Pi's supported host workflow.
- MCP, extension, hook, and plugin assets default to managed references unless they carry compatible Pi-native payloads.
