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

| Surface                                                                 | Classification  | Notes                                                                                             |
| ----------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                             | documented      | Official OpenCode instruction surface                                                             |
| `.opencode/agents/`                                                     | documented      | Native OpenCode agents surface                                                                    |
| `.opencode/skills/`                                                     | documented      | Native OpenCode skills surface                                                                    |
| `.opencode/commands/`                                                   | documented      | Native OpenCode commands surface                                                                  |
| `.opencode/plugins/`                                                    | documented      | Native OpenCode plugins surface                                                                   |
| `.opencode/context/project-intelligence/agent-harness/`                 | harness-managed | Managed overlay root for activation manifest, wire plan, and reference buckets                    |
| `.opencode/context/project-intelligence/agent-harness/instructions/`    | harness-managed | Managed reference bucket instead of undocumented top-level `.opencode/instructions/`              |
| `.opencode/context/project-intelligence/agent-harness/hooks/`           | harness-managed | Managed reference bucket instead of undocumented top-level `.opencode/hooks/`                     |
| `.opencode/context/project-intelligence/agent-harness/mcp-servers/`     | harness-managed | Managed reference bucket; not claimed as native MCP config                                        |
| `.opencode/context/project-intelligence/agent-harness/extensions/`      | harness-managed | Managed reference bucket; official custom-tool path is separate                                   |
| `.opencode/context/project-intelligence/agent-harness/reference-packs/` | harness-managed | Managed reference bucket                                                                          |
| `opencode.json` `mcp`                                                   | documented      | Synthesized when an asset includes structured host-native config payloads for `opencode.json`     |
| `opencode.json` `instructions`                                          | documented      | Adapter now projects managed instruction assets into the documented `instructions` config surface |
| `.opencode/tools/`                                                      | documented      | Synthesized when an asset includes structured host-native tool payloads under `.opencode/tools/`  |

## Cursor

Official docs:

- <https://cursor.com/docs/rules>
- <https://cursor.com/docs/skills>
- <https://cursor.com/docs/plugins>
- <https://cursor.com/docs/mcp>
- <https://cursor.com/docs/hooks>
- <https://cursor.com/docs/subagents>
- <https://cursor.com/marketplace>

| Surface                                                          | Classification     | Notes                                                                                     |
| ---------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| `.cursor/rules/agent-harness.mdc`                                | documented         | Native Cursor rules surface                                                               |
| `.cursor/agent-harness/`                                         | harness-managed    | Managed asset/reference tree                                                              |
| `.cursor/agent-harness/cursor-plugin/.cursor-plugin/plugin.json` | compatibility-path | Valid Cursor plugin bundle format                                                         |
| `.cursor/agent-harness/cursor-plugin/agents/`                    | compatibility-path | Staged plugin-compatible agents                                                           |
| `.cursor/agent-harness/cursor-plugin/skills/`                    | compatibility-path | Staged plugin-compatible skills                                                           |
| `.cursor/agent-harness/cursor-plugin/rules/`                     | compatibility-path | Staged plugin-compatible rules                                                            |
| `.cursor/agent-harness/cursor-plugin/commands/`                  | compatibility-path | Staged plugin-compatible commands                                                         |
| `.cursor/mcp.json`                                               | documented         | Synthesized when an asset includes structured host-native MCP payloads                    |
| `.cursor/hooks.json` / `.cursor/hooks/`                          | documented         | Synthesized when an asset includes structured host-native hook payloads                   |
| `.cursor/agents/`                                                | documented         | Adapter now writes project-local agent files there for selected agent assets              |
| `cursor.com/marketplace` as a discovery source                   | documented         | Modeled directly in `discover/sources.json` as the checked-in `cursor-marketplace` source |

## Zed

Official docs:

- <https://zed.dev/docs/ai/rules>
- <https://zed.dev/docs/ai/mcp>
- <https://zed.dev/docs/reference/all-settings.html>

| Surface                                                            | Classification  | Notes                                                                                              |
| ------------------------------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------- |
| `.rules`                                                           | documented      | Native Zed rules surface                                                                           |
| `.zed/settings.json` `agent.profiles.*`                            | documented      | Adapter writes managed profile hints there                                                         |
| `.zed/settings.json` `context_servers`                             | documented      | Synthesized when an asset includes structured host-native config payloads for `.zed/settings.json` |
| `.zed/settings.json` `agent.profiles.*.enable_all_context_servers` | documented      | Current adapter writes this conservative profile setting                                           |
| `.zed/settings.json` `auto_install_extensions`                     | not-synthesized | Documented setting, but extension installation still remains manual                                |
| `.zed/agent-harness/`                                              | harness-managed | Managed reference tree for non-native assets                                                       |

## Claude Code

Official docs:

- <https://code.claude.com/docs/en/memory>
- <https://code.claude.com/docs/en/slash-commands>
- <https://code.claude.com/docs/en/sub-agents>
- <https://code.claude.com/docs/en/hooks>
- <https://code.claude.com/docs/en/plugins>
- <https://code.claude.com/docs/en/plugin-marketplaces>
- <https://code.claude.com/docs/en/settings>

| Surface                                             | Classification     | Notes                                                                                                |
| --------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                         | documented         | Native Claude Code memory/instructions surface                                                       |
| `.claude/CLAUDE.md`                                 | documented         | Native project-local Claude memory surface                                                           |
| `.claude/rules/`                                    | documented         | Native rules surface                                                                                 |
| `.claude/agents/`                                   | documented         | Native subagent surface                                                                              |
| `.claude/skills/`                                   | documented         | Native skills surface                                                                                |
| `.claude/commands/`                                 | compatibility-path | Compatibility-supported; modern docs emphasize skills first                                          |
| `.mcp.json` / `.claude/settings*.json` MCP settings | documented         | Synthesized when an asset includes structured host-native config payloads for those documented files |
| `.claude-plugin/marketplace.json`                   | documented         | Project-local marketplace index containing the managed `./plugins/agent-harness` source              |
| `plugins/agent-harness/.claude-plugin/plugin.json`  | documented         | Managed local plugin manifest with version and author metadata                                       |
| `.claude/agent-harness/`                            | harness-managed    | Managed reference tree for non-native assets                                                         |

## Pi

Official docs:

- <https://pi.dev/docs/latest/settings>
- <https://pi.dev/docs/latest/skills>
- <https://pi.dev/docs/latest/prompt-templates>
- <https://pi.dev/docs/latest/extensions>
- <https://pi.dev/docs/latest/packages>
- <https://pi.dev/docs/latest/usage>

| Surface                                  | Classification  | Notes                                                                                                    |
| ---------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                              | documented      | Native Pi instructions/context surface                                                                   |
| `SYSTEM.md`                              | documented      | Project system-prompt augmentation surface used by Pi                                                    |
| `.pi/skills/`                            | documented      | Native Pi skill surface                                                                                  |
| `.pi/prompts/`                           | documented      | Native Pi prompt-template surface                                                                        |
| `.pi/settings.json` `skills` / `prompts` | documented      | Adapter now writes documented top-level arrays                                                           |
| `.pi/extensions/` / `.pi/packages/`      | stage-only      | Staged or synthesized as references when payloads exist; the Pi adapter does not claim wire-time install |
| `.pi/agent-harness/`                     | harness-managed | Managed reference tree for non-native assets                                                             |

Pi native extension/package capabilities are intentionally stage-only in v2.1.0. They remain available
for review and explicit host-side installation, but `wire pi` does not silently install or activate them.

## OpenAI Codex

Official docs:

- <https://developers.openai.com/codex>
- <https://developers.openai.com/codex/app>
- <https://developers.openai.com/codex/guides/agents-md>
- <https://developers.openai.com/codex/skills>
- <https://developers.openai.com/codex/plugins>
- <https://developers.openai.com/codex/mcp>
- <https://developers.openai.com/codex/hooks>
- <https://developers.openai.com/codex/config-basic>

| Surface                                               | Classification     | Notes                                                                                                                                             |
| ----------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                           | documented         | Native Codex instruction surface; harness writes a managed `agent-harness-codex` section                                                          |
| `.agents/skills/agent-harness/SKILL.md`               | documented         | Repo-scoped Open Agent Skill surface; harness materializes a skill summary there                                                                  |
| `plugins/agent-harness/`                              | documented         | Current repo/team plugin directory; harness writes `.codex-plugin/plugin.json`, skills, agents, and commands                                      |
| `plugins/agent-harness/skills/agent-harness/SKILL.md` | documented         | Current plugin-bundled skill surface                                                                                                              |
| `.agents/plugins/marketplace.json`                    | documented         | Repo/team marketplace index; harness merges an `agent-harness` entry pointing at `plugins/agent-harness/`                                         |
| `.agents/plugins/agent-harness/`                      | compatibility-path | Legacy plugin bundle preserved only when an existing legacy marketplace requires that shape                                                       |
| `.codex/config.toml`                                  | documented         | Synthesized for MCP server entries only when an asset carries a structured Codex-native `text` payload for this path; auth/login remains explicit |
| `.codex/hooks.json`                                   | explicit-payload   | Accepted only for a structured host-native hook payload; the current plugin manifest does not synthesize hook registration                        |
| `.codex/rules/*.rules`                                | documented         | Synthesized when an asset carries a structured Codex-native payload targeting this path; Starlark-like `prefix_rule` format                       |
| `.codex/agent-harness/`                               | harness-managed    | Managed reference tree for non-native assets (reference packs, non-wired MCP/hook refs)                                                           |
| `~/.codex/config.toml` (global)                       | not-synthesized    | Intentionally not written; global Codex config and plugin cache remain the user's responsibility                                                  |
| `~/.codex/plugins/cache/`                             | not-synthesized    | Intentionally not written; plugin caches require explicit marketplace install flows                                                               |
| Automations / remote connections / worktrees          | not-synthesized    | App-specific runtime features; not auto-wired by the harness                                                                                      |

**Lifecycle host note:** The Codex adapter (`id: codex`, aliases `openai-codex` / `codex-app`) reuses the `opencode` lifecycle host for activation and preview because both hosts consume project-local Markdown context, Open Agent Skills, plugin directories, and MCP references through similar file layouts. Codex now supports native extension installation via `stage native --host codex` (same VS Code extension mechanism; #407). Reset (`wire codex --reset`) removes the `AGENTS.md` managed section, `.agents/skills/agent-harness`, the current `plugins/agent-harness` bundle, any legacy compatibility bundle, the managed marketplace entry, and empty parent dirs; `.codex/` structured config is cleaned up separately.

## Discovery-source note for Cursor assets

The checked-in discovery registry already treats the **VS Code Marketplace** as an official marketplace-class source for hosts `copilot-vscode` and `cursor`, so Cursor-targeted extension/plugin/MCP discovery can already flow through that source.

Cursor now has a separate checked-in source entry for its own official marketplace at <https://cursor.com/marketplace> via `discover/sources.json#cursor-marketplace`, while the shared VS Code Marketplace source still covers compatible shared discovery paths.

---

## Host Compatibility Gaps — current audit

### 1. Cursor — VS Code extension partial compatibility

**Status:** Documented in `support-matrix.ts` `LIMITATIONS_BY_HOST["cursor"]`.

Cursor is a VS Code fork and supports installing extensions from the VS Code Marketplace. Extensions using standard VS Code APIs work; those requiring VS Code-specific runtime features (debugger, notebook APIs) may not. The `vscode-marketplace` source in `discover/sources.json` already lists `cursor` in its hosts array, so marketplace extension recommendations flow to Cursor workspaces automatically.

**Evidence:** <https://cursor.com/help/customization/extensions>

### 2. Windsurf — removed compatibility target

**Status:** Not a registered v2.1.0 host. Windsurf was removed from the compatible-host matrix in #475, so source packs must not imply that the harness wires or targets it.

The adapter-development guide uses a neutral example host instead of Windsurf-specific wiring.

### 3. GitHub Copilot CLI / copilot-vscode — Claude Code plugin format partial compatibility

**Status:** Documented in `support-matrix.ts` `LIMITATIONS_BY_HOST["copilot-vscode"]`.

The VS Code agent plugin format (<https://code.visualstudio.com/docs/agent-customization/agent-plugins>) is consumed by both GitHub Copilot and Claude Code. The schema is shared but manifest path conventions differ (`.claude-plugin/plugin.json` vs root `plugin.json`). Assets that ship both layouts are compatible with `copilot-vscode`.

### 4. Cline — `.clinerules` files apply across CLI, VS Code extension, and JetBrains plugin

**Status:** Noted. Cline's `.clinerules` format is surface-agnostic — the same rules file works across the Cline CLI, the VS Code Cline extension, and the JetBrains Cline plugin. Source pack entries targeting Cline content should use `hosts: ["shared"]` or list all three surface IDs when they become registered host targets.

**Evidence:** <https://github.com/cline/cline>

### 5. JetBrains ↔ Zed — ACP (Agent Client Protocol) compatibility

**Status:** Modelled via new `"acp-agent"` `AssetKind` in v2.0.0.

JetBrains and Zed co-developed ACP (<https://www.jetbrains.com/acp/>) for IDE-agent interoperability. Assets typed as `acp-agent` are understood to be cross-compatible between JetBrains and Zed. Source pack entries for ACP agents should use `assetKinds: ["acp-agent"]` and `hosts: ["zed"]` (or both `"zed"` and a JetBrains host ID when one is registered).

### 6. Zed — MCP forwarding to external agents

**Status:** Documented in `support-matrix.ts` `LIMITATIONS_BY_HOST["zed"]`.

Zed forwards MCP servers configured in `.zed/settings.json` to external ACP-based agents in the same session (<https://zed.dev/docs/ai/external-agents>). This means MCP server recommendations for Zed workspaces are also relevant to ACP-agent consumers. The Zed adapter note reflects this forwarding relationship.
