import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { applyEdits, modify, parse as parseJsonc, type ParseError } from "jsonc-parser";

import type {
  ManagedTextFileSnapshot,
  NativeConfigOperation,
} from "../types.js";
import {
  applyStructuredNativeConfig,
  buildManagedInstructionLines,
  buildNativeAssetContentSections,
  mergeJsonFile,
  removeManagedSectionFile,
  removeManagedZedSettings,
  restoreManagedTextFileSnapshot,
  upsertManagedSectionFile,
} from "./native-utils.js";
import type { WireNativeFilesOptions } from "./native-utils.js";

/**

Writes Zed-native managed files.
 */
export async function writeZedNativeFiles(
  options: WireNativeFilesOptions,
): Promise<NativeConfigOperation[]> {
  const rulesPath = join(options.workspaceRoot, ".rules");
  const managedLines = buildManagedInstructionLines({
    hostName: "Zed",
    managedRoot: options.managedRoot,
    nativeAssets: options.nativeAssets,
    materializedAssets: options.materializedAssets,
    mcpServers: options.mcpServers,
  });
  await upsertManagedSectionFile(rulesPath, "agent-harness-zed", [
    ...managedLines,
    ...buildNativeAssetContentSections(options.nativeAssets, ["instruction"]),
  ]);
  const settingsPath = join(options.workspaceRoot, ".zed", "settings.json");
  const zedProfilePatch = {
    agent: {
      profiles: {
        "agent-harness": {
          name: "Agent Harness",
          enable_all_context_servers: true,
        },
      },
    },
  };
  try {
    // Parse as JSONC to preserve comments and trailing commas in user settings
    const rawContent = await readFile(settingsPath, "utf8").catch(() => "{}");
    const errors: ParseError[] = [];
    const current = parseJsonc(rawContent, errors, {
      disallowComments: false,
      allowTrailingComma: true,
    });
    const edits = modify(
      rawContent,
      ["agent", "profiles", "agent-harness"],
      zedProfilePatch.agent.profiles["agent-harness"],
      { formattingOptions: { insertSpaces: true, tabSize: 2 } },
    );
    await writeFile(settingsPath, applyEdits(rawContent, edits), "utf8");
  } catch (error) {
    if (error instanceof Error && error.message.includes("JSONC parse errors")) {
      throw error;
    }
    // Fall back to plain JSON merge for files without JSONC content
    await mergeJsonFile(settingsPath, zedProfilePatch);
  }

  return applyStructuredNativeConfig(options.workspaceRoot, "zed", {
    nativeAssets: options.nativeAssets,
  });
}

/**
 * Removes all Zed-native files installed by agent-harness.
 */
export async function resetZedNativeHost(
  workspaceRoot: string,
  textFileSnapshots: ManagedTextFileSnapshot[] | undefined,
): Promise<void> {
  await restoreManagedTextFileSnapshot(
    join(workspaceRoot, ".rules"),
    textFileSnapshots,
    () =>
      removeManagedSectionFile(
        join(workspaceRoot, ".rules"),
        "agent-harness-zed",
      ),
  );
  await removeManagedZedSettings(
    join(workspaceRoot, ".zed", "settings.json"),
    workspaceRoot,
  );
}
