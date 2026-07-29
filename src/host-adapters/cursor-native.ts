import { join } from "node:path";

import { removePath, writeJsonFile, writeTextFile } from "../files.js";
import { sanitizeAssetId } from "../lib/safe-paths.js";
import type { AssetKind, NativeConfigOperation } from "../types.js";
import {
  applyStructuredNativeConfig,
  buildAgentFile,
  buildAssetMarkdown,
  buildManagedInstructionLines,
  buildPromptTemplate,
  buildSkillFile,
  directoryNameForAssetKind,
} from "./native-utils.js";
import type {
  JsonObject,
  NativeAsset,
  WireNativeFilesOptions,
} from "./native-utils.js";

/**

Writes Cursor-native managed files.
 */
export async function writeCursorNativeFiles(
  options: WireNativeFilesOptions,
): Promise<NativeConfigOperation[]> {
  const cursorRulePath = join(
    options.workspaceRoot,
    ".cursor",
    "rules",
    "agent-harness.mdc",
  );
  const managedLines = buildManagedInstructionLines({
    hostName: "Cursor",
    managedRoot: options.managedRoot,
    nativeAssets: options.nativeAssets,
    materializedAssets: options.materializedAssets,
    mcpServers: options.mcpServers,
  });

  await writeTextFile(
    cursorRulePath,
    [
      "---",
      "description: Agent Harness curated project context and reusable agent assets.",
      "alwaysApply: true",
      "---",
      "",
      ...managedLines,
    ].join("\n"),
  );
  await writeCursorPluginFiles({
    managedRoot: options.managedRoot,
    nativeAssets: options.nativeAssets,
    managedLines,
  });
  await writeCursorNativeAgentFiles(
    options.workspaceRoot,
    options.nativeAssets,
  );

  return applyStructuredNativeConfig(options.workspaceRoot, "cursor", {
    nativeAssets: options.nativeAssets,
  });
}

/**
Stages Cursor plugin-compatible assets.
 */
export async function writeCursorPluginFiles(options: {
  managedRoot: string;
  nativeAssets: NativeAsset[];
  managedLines: string[];
}): Promise<void> {
  const pluginRoot = join(options.managedRoot, "cursor-plugin");
  const assetKinds = new Set(
    options.nativeAssets.map((nativeAsset) => nativeAsset.assetKind),
  );

  await writeJsonFile(
    join(pluginRoot, ".cursor-plugin", "plugin.json"),
    buildCursorPluginManifest(assetKinds),
  );
  await writeTextFile(
    join(pluginRoot, "rules", "agent-harness.mdc"),
    [
      "---",
      "description: Agent Harness curated project context and reusable agent assets.",
      "alwaysApply: true",
      "---",
      "",
      ...options.managedLines,
      "",
    ].join("\n"),
  );

  for (const nativeAsset of options.nativeAssets) {
    await writeCursorPluginAsset(pluginRoot, nativeAsset);
  }
}

/**
Writes Cursor native agent markdown files.
 */
export async function writeCursorNativeAgentFiles(
  workspaceRoot: string,
  nativeAssets: NativeAsset[],
): Promise<void> {
  const cursorAgentsRoot = join(
    workspaceRoot,
    ".cursor",
    "agents",
    "agent-harness",
  );

  for (const nativeAsset of nativeAssets) {
    if (nativeAsset.assetKind !== "agent") {
      continue;
    }

    const assetSlug = sanitizeAssetId(nativeAsset.assetId);
    await writeTextFile(
      join(cursorAgentsRoot, `${assetSlug}.md`),
      buildAgentFile(assetSlug, nativeAsset.displayName, [nativeAsset.content]),
    );
  }
}

/**
Builds a Cursor plugin manifest from asset kinds.
 */
export function buildCursorPluginManifest(
  assetKinds: Set<AssetKind>,
): JsonObject {
  const manifest: JsonObject = {
    name: "agent-harness",
    version: "1.0.0",
    description: "Curated Agent Harness project assets for Cursor.",
    rules: "./rules",
  };

  if (assetKinds.has("skill")) {
    manifest.skills = "./skills";
  }
  if (assetKinds.has("agent")) {
    manifest.agents = "./agents";
  }
  if (assetKinds.has("workflow") || assetKinds.has("prompt-pack")) {
    manifest.commands = "./commands";
  }

  return manifest;
}

async function writeCursorPluginAsset(
  pluginRoot: string,
  nativeAsset: NativeAsset,
): Promise<void> {
  const assetSlug = sanitizeAssetId(nativeAsset.assetId);

  switch (nativeAsset.assetKind) {
    case "instruction":
      await writeTextFile(
        join(pluginRoot, "rules", `${assetSlug}.mdc`),
        buildPromptTemplate(nativeAsset.displayName, [nativeAsset.content]),
      );
      return;
    case "agent":
      await writeTextFile(
        join(pluginRoot, "agents", `${assetSlug}.md`),
        buildAgentFile(assetSlug, nativeAsset.displayName, [
          nativeAsset.content,
        ]),
      );
      return;
    case "skill":
      await writeTextFile(
        join(pluginRoot, "skills", assetSlug, "SKILL.md"),
        buildSkillFile(assetSlug, nativeAsset.displayName, [
          nativeAsset.content,
        ]),
      );
      return;
    case "workflow":
    case "prompt-pack":
      await writeTextFile(
        join(pluginRoot, "commands", `${assetSlug}.md`),
        buildPromptTemplate(nativeAsset.displayName, [nativeAsset.content]),
      );
      return;
    default:
      await writeTextFile(
        join(
          pluginRoot,
          "references",
          directoryNameForAssetKind(nativeAsset.assetKind),
          `${assetSlug}.md`,
        ),
        buildAssetMarkdown(nativeAsset),
      );
  }
}

/**
 * Removes all Cursor-native files installed by agent-harness.
 */
export async function resetCursorNativeHost(
  workspaceRoot: string,
): Promise<void> {
  await removePath(
    join(workspaceRoot, ".cursor", "rules", "agent-harness.mdc"),
  );
  await removePath(join(workspaceRoot, ".cursor", "agents", "agent-harness"));
}
