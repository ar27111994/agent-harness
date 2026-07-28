import { join } from "node:path";

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
} from "./native-wire.js";
import type { MaterializedNativeAssets, NativeAsset } from "./native-wire.js";

/**
Writes Zed-native managed files.
 */
export async function writeZedNativeFiles(options: {
  workspaceRoot: string;
  managedRoot: string;
  nativeAssets: NativeAsset[];
  materializedAssets: MaterializedNativeAssets;
  mcpServers: string[];
}): Promise<NativeConfigOperation[]> {
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
  await mergeJsonFile(join(options.workspaceRoot, ".zed", "settings.json"), {
    agent: {
      profiles: {
        "agent-harness": {
          name: "Agent Harness",
          enable_all_context_servers: true,
        },
      },
    },
  });

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
