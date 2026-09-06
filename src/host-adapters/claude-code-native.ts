import { join } from "node:path";

import {
  readJsonFileOrNull,
  removePath,
  writeJsonFile,
  writeTextFile,
} from "../files.js";
import type {
  ManagedTextFileSnapshot,
  NativeConfigOperation,
} from "../types.js";
import {
  applyStructuredNativeConfig,
  assertJsonObject,
  buildAgentFile,
  buildManagedInstructionLines,
  buildNativeAssetContentSections,
  buildPromptTemplate,
  buildSkillFile,
  isJsonObject,
  removeEmptyParentDirectories,
  removeManagedSectionFile,
  restoreManagedTextFileSnapshot,
  upsertManagedSectionFile,
} from "./native-utils.js";
import type { WireNativeFilesOptions } from "./native-utils.js";
import {
  removeManagedMarketplaceEntries,
  replaceManagedMarketplaceEntry,
} from "./marketplace-utils.js";
import {
  claimManagedPluginDirectory,
  hasManagedPluginMarker,
} from "./ownership-marker.js";

const CLAUDE_PLUGIN_NAME = "agent-harness";
const CLAUDE_PLUGIN_VERSION = "2.1.0";
const CLAUDE_MARKETPLACE_NAME = "agent-harness-local";
const CLAUDE_PLUGIN_SOURCE_PATH = `./plugins/${CLAUDE_PLUGIN_NAME}`;
const CLAUDE_MANAGED_MARKETPLACE_ENTRY = {
  name: CLAUDE_PLUGIN_NAME,
  sourcePath: CLAUDE_PLUGIN_SOURCE_PATH,
} as const;

/**
 * Writes Claude Code-native managed files and a standards-compliant local
 * plugin marketplace. The direct `.claude/` surfaces remain useful without a
 * plugin installation; the marketplace provides a documented discovery path
 * for users who want Claude Code to load the same curated context as a plugin.
 */
export async function writeClaudeCodeNativeFiles(
  options: WireNativeFilesOptions,
): Promise<NativeConfigOperation[]> {
  const managedLines = buildManagedInstructionLines({
    hostName: "Claude Code",
    managedRoot: options.managedRoot,
    nativeAssets: options.nativeAssets,
    materializedAssets: options.materializedAssets,
    mcpServers: options.mcpServers,
  });

  await upsertManagedSectionFile(
    join(options.workspaceRoot, "CLAUDE.md"),
    "agent-harness-claude-code",
    managedLines,
  );
  await upsertManagedSectionFile(
    join(options.workspaceRoot, ".claude", "CLAUDE.md"),
    "agent-harness-claude-code",
    managedLines,
  );
  await writeTextFile(
    join(options.workspaceRoot, ".claude", "rules", "agent-harness.md"),
    [
      "# Agent Harness Rules",
      "",
      ...managedLines,
      ...buildNativeAssetContentSections(options.nativeAssets, ["instruction"]),
    ].join("\n"),
  );
  await writeTextFile(
    join(options.workspaceRoot, ".claude", "agents", "agent-harness.md"),
    buildAgentFile(
      "agent-harness",
      "Use curated Agent Harness assets for this project.",
      [
        ...managedLines,
        ...buildNativeAssetContentSections(options.nativeAssets, ["agent"]),
      ],
    ),
  );
  await writeTextFile(
    join(
      options.workspaceRoot,
      ".claude",
      "skills",
      "agent-harness",
      "SKILL.md",
    ),
    buildSkillFile(
      "agent-harness",
      "Use curated Agent Harness assets for this project.",
      [
        ...managedLines,
        ...buildNativeAssetContentSections(options.nativeAssets, ["skill"]),
      ],
    ),
  );
  await writeTextFile(
    join(options.workspaceRoot, ".claude", "commands", "agent-harness.md"),
    buildPromptTemplate("Use curated Agent Harness assets for this task.", [
      ...managedLines,
      ...buildNativeAssetContentSections(options.nativeAssets, [
        "prompt-pack",
        "workflow",
      ]),
    ]),
  );

  await writeClaudePlugin(options, managedLines);

  return applyStructuredNativeConfig(options.workspaceRoot, "claude-code", {
    nativeAssets: options.nativeAssets,
  });
}

async function writeClaudePlugin(
  options: WireNativeFilesOptions,
  managedLines: string[],
): Promise<void> {
  const pluginRoot = join(options.workspaceRoot, "plugins", CLAUDE_PLUGIN_NAME);
  // Claim via the shared ownership guard — refuse a pre-existing unmarked
  // user-owned plugin dir instead of adopting it (review thread ...bbJOF).
  await claimManagedPluginDirectory(pluginRoot, CLAUDE_PLUGIN_NAME);
  await writeJsonFile(join(pluginRoot, ".claude-plugin", "plugin.json"), {
    name: CLAUDE_PLUGIN_NAME,
    description: "Curated Agent Harness project assets for Claude Code.",
    version: CLAUDE_PLUGIN_VERSION,
    author: { name: "Agent Harness" },
  });
  await writeTextFile(
    join(pluginRoot, "skills", CLAUDE_PLUGIN_NAME, "SKILL.md"),
    buildSkillFile(
      CLAUDE_PLUGIN_NAME,
      "Use curated Agent Harness assets for this Claude Code project.",
      [
        ...managedLines,
        ...buildNativeAssetContentSections(options.nativeAssets, [
          "skill",
          "instruction",
          "reference-pack",
        ]),
      ],
    ),
  );
  await writeTextFile(
    join(pluginRoot, "agents", `${CLAUDE_PLUGIN_NAME}.md`),
    buildAgentFile(
      CLAUDE_PLUGIN_NAME,
      "Use curated Agent Harness agent assets for this project.",
      buildNativeAssetContentSections(options.nativeAssets, ["agent"]),
    ),
  );
  await writeTextFile(
    join(pluginRoot, "commands", `${CLAUDE_PLUGIN_NAME}.md`),
    buildPromptTemplate("Use curated Agent Harness assets for this task.", [
      ...buildNativeAssetContentSections(options.nativeAssets, [
        "prompt-pack",
        "workflow",
      ]),
    ]),
  );

  await mergeClaudePluginMarketplace(
    join(options.workspaceRoot, ".claude-plugin", "marketplace.json"),
  );
}

/**
 * Adds the local Agent Harness plugin to a Claude Code marketplace while
 * preserving unrelated marketplace metadata and plugins.
 */
export async function mergeClaudePluginMarketplace(
  filePath: string,
): Promise<void> {
  const existing = await readJsonFileOrNull<unknown>(filePath);
  const marketplace =
    existing === null ? {} : assertJsonObject(existing, filePath);
  const rawPlugins: unknown[] = Array.isArray(marketplace.plugins)
    ? marketplace.plugins
    : [];
  await writeJsonFile(filePath, {
    ...marketplace,
    name:
      typeof marketplace.name === "string"
        ? marketplace.name
        : CLAUDE_MARKETPLACE_NAME,
    owner: isJsonObject(marketplace.owner)
      ? marketplace.owner
      : { name: "Agent Harness" },
    plugins: replaceManagedMarketplaceEntry(
      rawPlugins,
      CLAUDE_MANAGED_MARKETPLACE_ENTRY,
      {
        name: CLAUDE_PLUGIN_NAME,
        source: CLAUDE_PLUGIN_SOURCE_PATH,
        description: "Curated Agent Harness project assets for Claude Code.",
      },
    ),
  });
}

/**
 * Removes all Claude Code-native files installed by agent-harness.
 */
export async function resetClaudeCodeNativeHost(
  workspaceRoot: string,
  textFileSnapshots: ManagedTextFileSnapshot[] | undefined,
): Promise<void> {
  await restoreManagedTextFileSnapshot(
    join(workspaceRoot, "CLAUDE.md"),
    textFileSnapshots,
    () =>
      removeManagedSectionFile(
        join(workspaceRoot, "CLAUDE.md"),
        "agent-harness-claude-code",
      ),
  );
  await restoreManagedTextFileSnapshot(
    join(workspaceRoot, ".claude", "CLAUDE.md"),
    textFileSnapshots,
    () =>
      removeManagedSectionFile(
        join(workspaceRoot, ".claude", "CLAUDE.md"),
        "agent-harness-claude-code",
      ),
  );
  await removePath(join(workspaceRoot, ".claude", "rules", "agent-harness.md"));
  await removePath(
    join(workspaceRoot, ".claude", "agents", "agent-harness.md"),
  );
  await removePath(join(workspaceRoot, ".claude", "skills", "agent-harness"));
  await removePath(
    join(workspaceRoot, ".claude", "commands", "agent-harness.md"),
  );
  const pluginRoot = join(workspaceRoot, "plugins", CLAUDE_PLUGIN_NAME);
  if (await hasManagedPluginMarker(pluginRoot, CLAUDE_PLUGIN_NAME)) {
    await removePath(pluginRoot);
  }
  await removeClaudePluginMarketplaceEntry(
    join(workspaceRoot, ".claude-plugin", "marketplace.json"),
  );

  await removeEmptyParentDirectories(
    join(workspaceRoot, ".claude", "rules"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, ".claude", "agents"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, ".claude", "skills"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, ".claude", "commands"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, ".claude"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, "plugins"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, ".claude-plugin"),
    workspaceRoot,
  );
}

async function removeClaudePluginMarketplaceEntry(
  filePath: string,
): Promise<void> {
  const existing = await readJsonFileOrNull<unknown>(filePath);
  if (existing === null) return;

  const marketplace = assertJsonObject(existing, filePath);
  const rawPlugins: unknown[] = Array.isArray(marketplace.plugins)
    ? marketplace.plugins
    : [];
  const plugins = removeManagedMarketplaceEntries(
    rawPlugins,
    CLAUDE_MANAGED_MARKETPLACE_ENTRY,
  );

  if (
    marketplace.name === CLAUDE_MARKETPLACE_NAME &&
    plugins.length === 0 &&
    Object.keys(marketplace).every((key) =>
      ["name", "owner", "plugins"].includes(key),
    )
  ) {
    await removePath(filePath);
    return;
  }

  await writeJsonFile(filePath, { ...marketplace, plugins });
}
