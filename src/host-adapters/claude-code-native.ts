import { join } from "node:path";

import { removePath, writeTextFile } from "../files.js";
import type {
  ManagedTextFileSnapshot,
  NativeConfigOperation,
} from "../types.js";
import {
  applyStructuredNativeConfig,
  buildAgentFile,
  buildManagedInstructionLines,
  buildNativeAssetContentSections,
  buildPromptTemplate,
  buildSkillFile,
  removeManagedSectionFile,
  restoreManagedTextFileSnapshot,
  upsertManagedSectionFile,
} from "./native-utils.js";
import type { WireNativeFilesOptions } from "./native-utils.js";

/**

Writes Claude Code-native managed files.
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

  return applyStructuredNativeConfig(options.workspaceRoot, "claude-code", {
    nativeAssets: options.nativeAssets,
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
}
