# VS Code / GitHub Copilot

Adapter implementation:

- `src/host-adapters/vscode.ts`
- `src/host-adapters/vscode-settings.ts`

This adapter is intentionally host-specific because VS Code and GitHub Copilot use protected user-scoped settings plus workspace-local instruction files.

## Official docs

- <https://code.visualstudio.com/docs/copilot/customization/overview>
- <https://code.visualstudio.com/docs/copilot/customization/custom-instructions>
- <https://code.visualstudio.com/docs/copilot/customization/agent-skills>
- <https://code.visualstudio.com/docs/copilot/customization/agent-plugins>
- <https://code.visualstudio.com/docs/copilot/customization/mcp-servers>

## Supported behavior

- patches user-scoped VS Code JSONC settings
- writes workspace-local `.github/copilot-instructions.md`
- materializes curated runtime folders under `~/.copilot/agent-harness/`
- writes extension metadata for valid VS Code extension identifiers
- emits native install action guidance for extension assets when possible
- supports explicit extension install, verify, and remove via `install native --host vscode`
- projects shared MCP references into the effective wire plan
- resets managed settings entries and generated files without wiping unrelated user settings

## Settings that can be patched

- `chat.pluginLocations`
- `chat.agentSkillsLocations`
- `chat.hookFilesLocations`
- `chat.agentFilesLocations`
- `chat.instructionsFilesLocations`
- `github.copilot.chat.codeGeneration.instructions`

## Curated runtime folders

- `~/.copilot/agent-harness/instructions`
- `~/.copilot/agent-harness/agents`
- `~/.copilot/agent-harness/skills`
- `~/.copilot/agent-harness/hooks`
- `~/.copilot/agent-harness/plugins`
- `~/.copilot/agent-harness/extensions`

## Workspace and activation outputs

- `.github/copilot-instructions.md`
- `activate/copilot-vscode/wire-preview-vscode.json`
- `activate/copilot-vscode/wire-plan.json`
- `activate/copilot-vscode/workspace-profile-manifest.json`

## Known limitations

Host-specific details only; see [Managed wire-in vs native/global install](../../README.md#managed-wire-in-vs-nativeglobal-install) for the shared invariants:

- Applying VS Code wire-in requires the VS Code user settings directory to exist and be writable.
- The README treats instruction files, skills, plugins, and MCP as the primary documented public contract. Some patched settings remain implementation detail unless a current VS Code settings reference explicitly documents them.
- The adapter never silently installs marketplace extensions during `wire`; native extension installation is an explicit `install native --operation install --apply` action.
