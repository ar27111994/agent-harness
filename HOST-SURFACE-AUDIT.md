# Host Surface Audit

_Checked-in host-surface classification for `agent-harness`._

This file records how the repo currently treats host-facing files, folders, and settings after the host-doc re-audit.

## Classification legend

- **documented** - explicitly described in current official host docs
- **compatibility-path** - accepted by the host as a compatibility format/path, but not always the host's primary native surface
- **harness-managed** - created by `agent-harness` for staging/reference/overlay purposes; not claimed as a documented host-native auto-discovery surface
- **implementation-detail** - used by the adapter internally or patched conservatively, but not presented as the main public contract
- **not-synthesized** - documented host-native surface that `agent-harness` intentionally does not generate yet because current asset metadata does not carry a normalized host-native config payload

## VS Code / GitHub Copilot

Official docs:

- <https://code.visualstudio.com/docs/copilot/customization/overview>
- <https://code.visualstudio.com/docs/copilot/customization/custom-instructions>
- <https://code.visualstudio.com/docs/copilot/customization/agent-skills>
- <https://code.visualstudio.com/docs/copilot/customization/agent-plugins>
- <https://code.visualstudio.com/docs/copilot/customization/mcp-servers>

| Surface                                                                         | Classification        | Notes                                                                                                          |
| ------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `.github/copilot-instructions.md`                                               | documented            | Workspace instruction file                                                                                     |
| `~/.copilot/agent-harness/instructions`                                         | documented            | Managed instruction-file location via patched VS Code settings                                                 |
| `~/.copilot/agent-harness/agents`                                               | documented            | Managed agent file location via patched VS Code settings                                                       |
| `~/.copilot/agent-harness/skills`                                               | documented            | Managed skill location via patched VS Code settings                                                            |
| `~/.copilot/agent-harness/hooks`                                                | documented            | Managed hook file location via patched VS Code settings                                                        |
| `~/.copilot/agent-harness/plugins`                                              | documented            | Managed plugin location via patched VS Code settings                                                           |
| `~/.copilot/agent-harness/extensions`                                           | harness-managed       | Reference/metadata directory for extension assets                                                              |
| `chat.pluginLocations` / `chat.agentSkillsLocations` / related patched settings | implementation-detail | Adapter patches them conservatively, but instruction files/skills/plugins/MCP are the main documented contract |
| `github.copilot.chat.codeGeneration.instructions`                               | implementation-detail | Kept out of the README's main public contract until backed by a current settings reference                     |

## OpenCode

Official docs:

- <https://opencode.ai/docs/rules/>
- <https://opencode.ai/docs/agents/>
- <https://opencode.ai/docs/skills/>
- <https://opencode.ai/docs/commands/>
- <https://opencode.ai/docs/plugins/>
- <https://opencode.ai/docs/mcp-servers/>
- <https://opencode.ai/docs/custom-tools/>
- <https://opencode.ai/docs/config/>

| Surface                                                                 | Classification  | Notes                                                                                                       |
| ----------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                             | documented      | Official OpenCode instruction surface                                                                       |
| `.opencode/agents/`                                                     | documented      | Native OpenCode agents surface                                                                              |
| `.opencode/skills/`                                                     | documented      | Native OpenCode skills surface                                                                              |
| `.opencode/commands/`                                                   | documented      | Native OpenCode commands surface                                                                            |
| `.opencode/plugins/`                                                    | documented      | Native OpenCode plugins surface                                                                             |
| `.opencode/context/project-intelligence/agent-harness/`                 | harness-managed | Managed overlay root for activation manifest, wire plan, and reference buckets                              |
| `.opencode/context/project-intelligence/agent-harness/instructions/`    | harness-managed | Managed reference bucket instead of undocumented top-level `.opencode/instructions/`                        |
| `.opencode/context/project-intelligence/agent-harness/hooks/`           | harness-managed | Managed reference bucket instead of undocumented top-level `.opencode/hooks/`                               |
| `.opencode/context/project-intelligence/agent-harness/mcp-servers/`     | harness-managed | Managed reference bucket; not claimed as native MCP config                                                  |
| `.opencode/context/project-intelligence/agent-harness/extensions/`      | harness-managed | Managed reference bucket; official custom-tool path is separate                                             |
| `.opencode/context/project-intelligence/agent-harness/reference-packs/` | harness-managed | Managed reference bucket                                                                                    |
| `opencode.json` `mcp`                                                   | not-synthesized | Documented host-native MCP config surface, but current assets do not carry normalized server config entries |
| `opencode.json` `instructions`                                          | not-synthesized | Documented config surface, but adapter currently uses `AGENTS.md` + managed overlay instead                 |
| `.opencode/tools/`                                                      | documented      | Official custom-tools surface, but not currently synthesized by the adapter                                 |

## Cursor

Official docs:

- <https://cursor.com/docs/rules>
- <https://cursor.com/docs/skills>
- <https://cursor.com/docs/plugins>
- <https://cursor.com/docs/mcp>
- <https://cursor.com/docs/hooks>
- <https://cursor.com/docs/subagents>
- <https://cursor.com/marketplace>

| Surface                                                          | Classification        | Notes                                                                                                                |
| ---------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `.cursor/rules/agent-harness.mdc`                                | documented            | Native Cursor rules surface                                                                                          |
| `.cursor/agent-harness/`                                         | harness-managed       | Managed asset/reference tree                                                                                         |
| `.cursor/agent-harness/cursor-plugin/.cursor-plugin/plugin.json` | compatibility-path    | Valid Cursor plugin bundle format                                                                                    |
| `.cursor/agent-harness/cursor-plugin/agents/`                    | compatibility-path    | Staged plugin-compatible agents                                                                                      |
| `.cursor/agent-harness/cursor-plugin/skills/`                    | compatibility-path    | Staged plugin-compatible skills                                                                                      |
| `.cursor/agent-harness/cursor-plugin/rules/`                     | compatibility-path    | Staged plugin-compatible rules                                                                                       |
| `.cursor/agent-harness/cursor-plugin/commands/`                  | compatibility-path    | Staged plugin-compatible commands                                                                                    |
| `.cursor/mcp.json`                                               | not-synthesized       | Documented Cursor-native MCP surface; current assets expose MCP references/IDs, not normalized server config entries |
| `.cursor/hooks.json` / `.cursor/hooks/`                          | not-synthesized       | Documented native hook surfaces, but not generated without structured executable hook metadata                       |
| `.cursor/agents/`                                                | not-synthesized       | Documented native subagent surface; current adapter uses a staged plugin bundle instead                              |
| `cursor.com/marketplace` as a discovery source                   | implementation-detail | Useful official install/discovery surface, but not yet a separate checked-in source entry in `discover/sources.json` |

## Zed

Official docs:

- <https://zed.dev/docs/ai/rules>
- <https://zed.dev/docs/ai/mcp>
- <https://zed.dev/docs/reference/all-settings.html>

| Surface                                                            | Classification  | Notes                                                                                                    |
| ------------------------------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------- |
| `.rules`                                                           | documented      | Native Zed rules surface                                                                                 |
| `.zed/settings.json` `agent.profiles.*`                            | documented      | Adapter writes managed profile hints there                                                               |
| `.zed/settings.json` `context_servers`                             | not-synthesized | Documented Zed MCP/context-server surface; current assets do not carry normalized per-host server config |
| `.zed/settings.json` `agent.profiles.*.enable_all_context_servers` | documented      | Current adapter writes this conservative profile setting                                                 |
| `.zed/settings.json` `auto_install_extensions`                     | not-synthesized | Documented setting, but extension installation remains manual                                            |
| `.zed/agent-harness/`                                              | harness-managed | Managed reference tree for non-native assets                                                             |

## Claude Code

Official docs:

- <https://code.claude.com/docs/en/memory>
- <https://code.claude.com/docs/en/slash-commands>
- <https://code.claude.com/docs/en/sub-agents>
- <https://code.claude.com/docs/en/hooks>
- <https://code.claude.com/docs/en/settings>

| Surface                                             | Classification     | Notes                                                                                       |
| --------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                         | documented         | Native Claude Code memory/instructions surface                                              |
| `.claude/CLAUDE.md`                                 | documented         | Native project-local Claude memory surface                                                  |
| `.claude/rules/`                                    | documented         | Native rules surface                                                                        |
| `.claude/agents/`                                   | documented         | Native subagent surface                                                                     |
| `.claude/skills/`                                   | documented         | Native skills surface                                                                       |
| `.claude/commands/`                                 | compatibility-path | Compatibility-supported; modern docs emphasize skills first                                 |
| `.mcp.json` / `.claude/settings*.json` MCP settings | not-synthesized    | Current adapter keeps MCP references conservative without normalized server config metadata |
| `.claude/agent-harness/`                            | harness-managed    | Managed reference tree for non-native assets                                                |

## Pi

Official docs:

- <https://pi.dev/docs/latest/settings>
- <https://pi.dev/docs/latest/skills>
- <https://pi.dev/docs/latest/prompt-templates>
- <https://pi.dev/docs/latest/extensions>
- <https://pi.dev/docs/latest/packages>
- <https://pi.dev/docs/latest/usage>

| Surface                                  | Classification  | Notes                                                                                          |
| ---------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| `AGENTS.md`                              | documented      | Native Pi instructions/context surface                                                         |
| `SYSTEM.md`                              | documented      | Project system-prompt augmentation surface used by Pi                                          |
| `.pi/skills/`                            | documented      | Native Pi skill surface                                                                        |
| `.pi/prompts/`                           | documented      | Native Pi prompt-template surface                                                              |
| `.pi/settings.json` `skills` / `prompts` | documented      | Adapter now writes documented top-level arrays                                                 |
| `.pi/extensions/` / `.pi/packages/`      | not-synthesized | Documented surfaces, but adapter does not generate them without structured compatible metadata |
| `.pi/agent-harness/`                     | harness-managed | Managed reference tree for non-native assets                                                   |

## Discovery-source note for Cursor assets

The checked-in discovery registry already treats the **VS Code Marketplace** as an official marketplace-class source for hosts `copilot-vscode` and `cursor`, so Cursor-targeted extension/plugin/MCP discovery can already flow through that source.

What is **not** present yet is a separate checked-in source entry for Cursor's own official marketplace at <https://cursor.com/marketplace>. If we want that marketplace represented independently in discovery, it should be added as a separate source rather than implied by the existing shared VS Code Marketplace source.
