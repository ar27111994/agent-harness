import { join } from "node:path";

import { removePath, writeTextFile } from "../files.js";
import type {
  ManagedTextFileSnapshot,
  NativeConfigOperation,
} from "../types.js";
import {
  applyStructuredNativeConfig,
  buildManagedInstructionLines,
  buildNativeAssetContentSections,
  buildPromptTemplate,
  buildSkillFile,
  removeEmptyParentDirectories,
  removeManagedPiSettings,
  removeManagedSectionFile,
  restoreManagedSectionFromSnapshot,
  upsertManagedPiSettings,
  upsertManagedSectionFile,
} from "./native-utils.js";
import type { WireNativeFilesOptions } from "./native-utils.js";

/**
 * Writes Pi-native managed files.
 */
export async function writePiNativeFiles(
  options: WireNativeFilesOptions,
): Promise<NativeConfigOperation[]> {
  const managedLines = buildManagedInstructionLines({
    hostName: "Pi",
    managedRoot: options.managedRoot,
    nativeAssets: options.nativeAssets,
    materializedAssets: options.materializedAssets,
    mcpServers: options.mcpServers,
  });

  await upsertManagedSectionFile(
    join(options.workspaceRoot, "AGENTS.md"),
    "agent-harness-pi",
    managedLines,
  );
  await upsertManagedSectionFile(
    join(options.workspaceRoot, "SYSTEM.md"),
    "agent-harness-pi",
    [
      "Append these Agent Harness project instructions to Pi's default system prompt.",
      "",
      ...managedLines,
    ],
  );
  await writeTextFile(
    join(options.workspaceRoot, ".pi", "skills", "agent-harness", "SKILL.md"),
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
    join(options.workspaceRoot, ".pi", "prompts", "agent-harness.md"),
    buildPromptTemplate("Use curated Agent Harness assets for this task.", [
      ...managedLines,
      ...buildNativeAssetContentSections(options.nativeAssets, [
        "agent",
        "instruction",
        "prompt-pack",
        "workflow",
      ]),
    ]),
  );
  await upsertManagedPiSettings(
    join(options.workspaceRoot, ".pi", "settings.json"),
  );

  return applyStructuredNativeConfig(options.workspaceRoot, "pi", {
    nativeAssets: options.nativeAssets,
  });
}

/**
 * Removes all Pi-native files installed by agent-harness.
 */
export async function resetPiNativeHost(
  workspaceRoot: string,
  textFileSnapshots: ManagedTextFileSnapshot[] | undefined,
): Promise<void> {
  // Section-scoped snapshot restore: extracts only the agent-harness-pi
  // managed section from the snapshot and applies it to the current file,
  // preserving other hosts' sections. Fallback removes the section directly.
  await restoreManagedSectionFromSnapshot(
    join(workspaceRoot, "AGENTS.md"),
    textFileSnapshots,
    "agent-harness-pi",
    () =>
      removeManagedSectionFile(
        join(workspaceRoot, "AGENTS.md"),
        "agent-harness-pi",
      ),
  );
  await restoreManagedSectionFromSnapshot(
    join(workspaceRoot, "SYSTEM.md"),
    textFileSnapshots,
    "agent-harness-pi",
    () =>
      removeManagedSectionFile(
        join(workspaceRoot, "SYSTEM.md"),
        "agent-harness-pi",
      ),
  );
  await removePath(join(workspaceRoot, ".pi", "skills", "agent-harness"));
  await removePath(join(workspaceRoot, ".pi", "prompts", "agent-harness.md"));
  await removeManagedPiSettings(
    join(workspaceRoot, ".pi", "settings.json"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, ".pi", "extensions"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, ".pi", "packages"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, ".pi", "skills"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, ".pi", "prompts"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(join(workspaceRoot, ".pi"), workspaceRoot);
}
