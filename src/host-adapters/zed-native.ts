import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import {
  applyEdits,
  modify,
  parse as parseJsonc,
  type ParseError,
} from "jsonc-parser";

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
 * Writes Zed-native managed files.
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
  // Parse as JSONC to preserve comments and trailing commas in user settings
  const rawContent = await readFile(settingsPath, "utf8").catch((error) => {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return "{}";
    }
    throw error;
  });
  const parseErrors: ParseError[] = [];
  // parseJsonc returns the parsed value; we validate it is an object so
  // modify() can navigate the path. Non-object roots (arrays, primitives)
  // cannot hold agent profiles and would be silently corrupted.
  const parsed: unknown = parseJsonc(rawContent, parseErrors, {
    disallowComments: false,
    allowTrailingComma: true,
  });
  if (parseErrors.length > 0) {
    throw new Error(
      `Zed settings.json contains JSONC parse errors. ` +
        `Please add the agent-harness profile manually:\n` +
        `  "agent": { "profiles": { "agent-harness": { "name": "Agent Harness", "enable_all_context_servers": true } } }`,
    );
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(
      `Zed settings.json is not a JSON object (found ${typeof parsed}). ` +
        `Please add the agent-harness profile manually:\n` +
        `  "agent": { "profiles": { "agent-harness": { "name": "Agent Harness", "enable_all_context_servers": true } } }`,
    );
  }
  // Try JSONC modify first. If modify() or writeFile fails (e.g. the file
  // has a valid JSON structure but modify cannot navigate the target path),
  // fall back to a plain JSON merge. Validation errors (parse errors,
  // non-object roots) are already thrown above and propagate to the caller.
  try {
    const edits = modify(
      rawContent,
      ["agent", "profiles", "agent-harness"],
      zedProfilePatch.agent.profiles["agent-harness"],
      { formattingOptions: { insertSpaces: true, tabSize: 2 } },
    );
    await writeFile(settingsPath, applyEdits(rawContent, edits), "utf8");
  } catch {
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
