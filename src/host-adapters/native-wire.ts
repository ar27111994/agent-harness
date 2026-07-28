import { rename } from "node:fs/promises";
import { join } from "node:path";

import {
  ensureDirectory,
  readJsonFileOrNull,
  readTextFileOrNull,
  removePath,
  toPosixPath,
  writeJsonFile,
  writeTextFile,
} from "../files.js";
import { assertWirePlanManifest } from "../manifest-validation.js";
import { sanitizeAssetId } from "../lib/safe-paths.js";
import { readSharedMcpAssetIds } from "../lib/shared-mcp.js";
import {
  buildExtensionInstallActions,
  formatExtensionInstallActions,
  resolveVsCodeExtensionId,
} from "./extension-installer.js";
import { revertNativeConfigOperations } from "./native-config.js";
import type {
  ActivationManifest,
  AssetCatalogEntry,
  CopilotWorkspaceProfileManifest,
  ManagedTextFileSnapshot,
  NativeConfigOperation,
  WirePlanManifest,
  WirePreviewManifest,
} from "../types.js";
import type { WireMode } from "./types.js";
import {
  writeCursorNativeFiles,
  resetCursorNativeHost,
} from "./cursor-native.js";
import { writeZedNativeFiles, resetZedNativeHost } from "./zed-native.js";
import {
  writeClaudeCodeNativeFiles,
  resetClaudeCodeNativeHost,
} from "./claude-code-native.js";
import { writePiNativeFiles, resetPiNativeHost } from "./pi-native.js";
import {
  writeCodexNativeFiles,
  resetCodexNativeHost,
  buildCodexPluginManifest,
  buildCodexHooksManifest,
} from "./codex-native.js";
import {
  buildAssetMarkdown,
  describeJsonValue,
  directoryNameForAssetKind,
  isBenignRemoveDirectoryRace,
  mergeJsonObjects,
  mergeStringArraysPreservingOrder,
  removeEmptyParentDirectories,
  removeManagedStringArrayEntries,
  uniqueStrings,
  validateManagedTextFileSnapshots,
} from "./native-utils.js";
import type {
  LifecycleActivationHost,
  MaterializedNativeAssets,
  NativeAsset,
  NativeHostSpec,
} from "./native-utils.js";

/**
 * Defines the supported native wire host values.
 */
export type NativeWireHost = "cursor" | "zed" | "claude-code" | "pi" | "codex";

/**
 * Activation lifecycle host identifier.
 */
const NATIVE_HOST_SPECS: Record<NativeWireHost, NativeHostSpec> = {
  cursor: {
    host: "cursor",
    displayName: "Cursor",
    activationHost: "copilot-vscode",
    previewHost: "vscode",
    managedRootSegments: [".cursor", "agent-harness"],
    targetPathSegments: [
      [".cursor", "rules", "agent-harness.mdc"],
      [
        ".cursor",
        "agent-harness",
        "cursor-plugin",
        ".cursor-plugin",
        "plugin.json",
      ],
      [".cursor", "agent-harness"],
    ],
    notes: [
      "Cursor native wire-in writes a project-local .cursor/rules/agent-harness.mdc rule file.",
      "Selected assets are materialized under .cursor/agent-harness for Cursor to reference from the rule.",
      "A Cursor plugin-compatible component tree is staged under .cursor/agent-harness/cursor-plugin for hosts that register project plugin paths.",
      "The global Cursor profile is not modified.",
    ],
  },
  zed: {
    host: "zed",
    displayName: "Zed",
    activationHost: "opencode",
    previewHost: "opencode",
    managedRootSegments: [".zed", "agent-harness"],
    targetPathSegments: [
      [".rules"],
      [".zed", "settings.json"],
      [".zed", "agent-harness"],
    ],
    notes: [
      "Zed native wire-in updates the project .rules file with an agent-harness managed section.",
      "Selected assets are materialized under .zed/agent-harness for @-mention and rules-file reference.",
      "The global Zed settings file is not modified.",
    ],
  },
  "claude-code": {
    host: "claude-code",
    displayName: "Claude Code",
    activationHost: "opencode",
    previewHost: "opencode",
    managedRootSegments: [".claude", "agent-harness"],
    targetPathSegments: [
      ["CLAUDE.md"],
      [".claude", "CLAUDE.md"],
      [".claude", "rules", "agent-harness.md"],
      [".claude", "agents", "agent-harness.md"],
      [".claude", "skills", "agent-harness", "SKILL.md"],
      [".claude", "commands", "agent-harness.md"],
      [".claude", "agent-harness"],
    ],
    notes: [
      "Claude Code native wire-in writes project CLAUDE.md context and .claude/rules/agent-harness.md.",
      "Selected agents, skills, workflows, and prompt packs are exposed through .claude/agents/agent-harness.md, .claude/skills/agent-harness, and .claude/commands/agent-harness.md.",
      "Project MCP server definitions are not synthesized without structured server configuration.",
    ],
  },
  pi: {
    host: "pi",
    displayName: "Pi",
    activationHost: "opencode",
    previewHost: "opencode",
    managedRootSegments: [".pi", "agent-harness"],
    targetPathSegments: [
      ["AGENTS.md"],
      ["SYSTEM.md"],
      [".pi", "settings.json"],
      [".pi", "skills", "agent-harness", "SKILL.md"],
      [".pi", "prompts", "agent-harness.md"],
      [".pi", "agent-harness"],
    ],
    notes: [
      "Pi native wire-in writes project AGENTS.md and SYSTEM.md managed sections.",
      "Selected assets are exposed through Pi-native .pi/skills and .pi/prompts entries.",
      "MCP assets are staged as references because Pi does not ship with built-in MCP support.",
    ],
  },
  codex: {
    host: "codex",
    displayName: "OpenAI Codex",
    activationHost: "opencode",
    previewHost: "opencode",
    managedRootSegments: [".codex", "agent-harness"],
    targetPathSegments: [
      ["AGENTS.md"],
      [".agents", "skills", "agent-harness", "SKILL.md"],
      [".agents", "plugins", "agent-harness"],
      [".codex", "agent-harness"],
      [".codex", "config.toml"],
      [".codex", "hooks.json"],
    ],
    notes: [
      "Codex wire-in writes project AGENTS.md context and repo-local Open Agent Skills under .agents/skills.",
      "Reference assets are materialized under .codex/agent-harness for reviewable project context.",
      "Plugin, MCP, hook, and rules activation require structured Codex-native config and trusted-project review; global Codex config and plugin caches are not modified.",
    ],
  },
};

/**
 * Provides wire native host for the lifecycle pipeline.
 */
export async function wireNativeHost(
  host: NativeWireHost,
  options: {
    projectRoot: string;
    workspaceRoot: string;
    mode: WireMode;
  },
): Promise<void> {
  const spec = NATIVE_HOST_SPECS[host];
  const hostActivationRoot = join(options.projectRoot, "activate", host);
  const managedRoot = join(options.workspaceRoot, ...spec.managedRootSegments);
  const targetPaths = spec.targetPathSegments.map((segments) =>
    join(options.workspaceRoot, ...segments),
  );

  await ensureDirectory(hostActivationRoot);

  const preview: WirePreviewManifest = {
    schemaVersion: 1,
    host: spec.previewHost,
    mode: options.mode,
    generatedAt: new Date().toISOString(),
    workspaceRoot: toPosixPath(options.workspaceRoot),
    targetPaths: targetPaths.map(toPosixPath),
    notes: spec.notes,
  };

  await writeJsonFile(
    join(hostActivationRoot, `wire-preview-${host}.json`),
    preview,
  );

  if (options.mode === "preview") {
    return;
  }

  if (options.mode === "reset") {
    await resetNativeHost(spec, options.workspaceRoot, hostActivationRoot);
    return;
  }

  await resetNativeHost(spec, options.workspaceRoot, hostActivationRoot);
  await ensureDirectory(managedRoot);

  const sourceActivationRoot = join(
    options.projectRoot,
    "activate",
    spec.activationHost,
  );
  const nativeAssets = await loadNativeAssets(
    sourceActivationRoot,
    spec.activationHost,
  );
  const sharedMcpAssetIds = await readSharedMcpAssetIdsBestEffort(
    options.projectRoot,
    spec.displayName,
  );
  const managedWirePlanPath = join(managedRoot, "wire-plan.json");
  const managedWirePlanTmpPath = join(managedRoot, "wire-plan.json.tmp");
  const activationWirePlanPath = join(hostActivationRoot, "wire-plan.json");
  const activationWirePlanTmpPath = join(
    hostActivationRoot,
    "wire-plan.json.tmp",
  );
  const textFileSnapshots = await captureManagedTextFileSnapshots(
    resolveManagedTextFileSnapshotPaths(spec, options.workspaceRoot),
  );
  let nativeConfigOperations: NativeConfigOperation[] = [];

  try {
    const materializedAssets = await materializeNativeAssets(
      nativeAssets,
      managedRoot,
    );
    const mcpServers = uniqueStrings([
      ...materializedAssets.mcpServers,
      ...sharedMcpAssetIds,
    ]);

    nativeConfigOperations = await writeHostNativeFiles({
      spec,
      workspaceRoot: options.workspaceRoot,
      managedRoot,
      nativeAssets,
      materializedAssets,
      mcpServers,
    });

    const wirePlan = buildNativeWirePlan({
      spec,
      workspaceRoot: options.workspaceRoot,
      managedRoot,
      materializedAssets: {
        ...materializedAssets,
        mcpServers,
      },
      nativeConfigOperations,
      textFileSnapshots,
    });

    await writeJsonFile(managedWirePlanTmpPath, wirePlan);
    await writeJsonFile(activationWirePlanTmpPath, wirePlan);
    await rename(managedWirePlanTmpPath, managedWirePlanPath);
    await rename(activationWirePlanTmpPath, activationWirePlanPath);
  } catch (error) {
    await removePath(managedWirePlanTmpPath);
    await removePath(activationWirePlanTmpPath);
    await revertNativeConfigOperations({
      workspaceRoot: options.workspaceRoot,
      host: spec.host,
      operations: nativeConfigOperations,
    });
    await cleanupFailedNativeHostApply(
      spec,
      options.workspaceRoot,
      managedRoot,
      hostActivationRoot,
      textFileSnapshots,
    );
    throw error;
  }
}

/**
 * Reads shared MCP references for native host plans without making unrelated
 * stale shared activation state fatal to project-local wiring.
 */
async function readSharedMcpAssetIdsBestEffort(
  projectRoot: string,
  hostName: string,
): Promise<string[]> {
  try {
    return await readSharedMcpAssetIds(projectRoot);
  } catch (error) {
    /* c8 ignore next 4 */
    console.warn(
      `Failed to project shared MCP assets into ${hostName} wire plan: ${toLoggableErrorMessage(error)}`,
    );
    return [];
  }
}

async function loadNativeAssets(
  activationRoot: string,
  activationHost: LifecycleActivationHost,
): Promise<NativeAsset[]> {
  const assetIds =
    activationHost === "copilot-vscode"
      ? await readCopilotAssetIds(activationRoot)
      : await readOpenCodeAssetIds(activationRoot);

  const assets: NativeAsset[] = [];
  for (const assetId of assetIds) {
    const nativeAsset = await readNativeAssetFromActivation(
      activationRoot,
      assetId,
    );
    if (!nativeAsset) {
      continue;
    }

    assets.push(nativeAsset);
  }

  return assets.sort((left, right) =>
    left.assetId.localeCompare(right.assetId),
  );
}

async function readNativeAssetFromActivation(
  activationRoot: string,
  assetId: string,
): Promise<NativeAsset | null> {
  const assetRoot = join(activationRoot, sanitizeAssetId(assetId));
  const asset = await readJsonFileOrNull<AssetCatalogEntry>(
    join(assetRoot, "asset.json"),
  );
  if (!asset) {
    return null;
  }

  const content =
    (await readTextFileOrNull(join(assetRoot, "content.txt"))) ??
    buildMetadataFallback(asset);

  return {
    assetId,
    assetKind: asset.assetKind,
    displayName: asset.displayName,
    compatibilityMode: asset.compatibilityMode,
    content,
    extensionId: resolveVsCodeExtensionId(asset),
    hostNativeConfig: asset.hostNativeConfig,
  };
}

async function readCopilotAssetIds(activationRoot: string): Promise<string[]> {
  const profileManifest =
    await readJsonFileOrNull<CopilotWorkspaceProfileManifest>(
      join(activationRoot, "workspace-profile-manifest.json"),
    );
  return profileManifest?.selectedAssetIds ?? [];
}

async function readOpenCodeAssetIds(activationRoot: string): Promise<string[]> {
  const activationManifest = await readJsonFileOrNull<ActivationManifest>(
    join(activationRoot, "activation-manifest.json"),
  );
  return activationManifest?.activeAssets ?? [];
}

async function materializeNativeAssets(
  nativeAssets: NativeAsset[],
  managedRoot: string,
): Promise<MaterializedNativeAssets> {
  const materializedAssets: MaterializedNativeAssets = {
    instructionFiles: [],
    agentFiles: [],
    skillDirs: [],
    pluginDirs: [],
    hookFiles: [],
    workflowFiles: [],
    referenceFiles: [],
    extensionIds: [],
    mcpServers: [],
  };

  for (const nativeAsset of nativeAssets) {
    const assetSlug = sanitizeAssetId(nativeAsset.assetId);
    const assetRoot = join(
      managedRoot,
      "assets",
      directoryNameForAssetKind(nativeAsset.assetKind),
      assetSlug,
    );
    await ensureDirectory(assetRoot);
    const contentPath = join(assetRoot, fileNameForAssetKind(nativeAsset));
    await writeTextFile(contentPath, buildAssetMarkdown(nativeAsset));

    switch (nativeAsset.assetKind) {
      case "instruction":
        materializedAssets.instructionFiles.push(contentPath);
        break;
      case "agent":
        materializedAssets.agentFiles.push(contentPath);
        break;
      case "skill":
        materializedAssets.skillDirs.push(assetRoot);
        break;
      case "plugin":
        if (nativeAsset.compatibilityMode === "reference-only") {
          materializedAssets.referenceFiles.push(contentPath);
        } else {
          materializedAssets.pluginDirs.push(assetRoot);
        }
        break;
      case "hook":
        materializedAssets.hookFiles.push(contentPath);
        break;
      case "workflow":
      case "prompt-pack":
        materializedAssets.workflowFiles.push(contentPath);
        break;
      case "mcp-server":
        materializedAssets.referenceFiles.push(contentPath);
        if (nativeAsset.compatibilityMode !== "reference-only") {
          materializedAssets.mcpServers.push(nativeAsset.assetId);
        }
        break;
      case "reference-pack":
        materializedAssets.referenceFiles.push(contentPath);
        break;
      case "extension":
        materializedAssets.referenceFiles.push(contentPath);
        if (
          nativeAsset.compatibilityMode === "native" &&
          nativeAsset.extensionId
        ) {
          materializedAssets.extensionIds.push(nativeAsset.extensionId);
        }
        break;
    }
  }

  return sortMaterializedAssets(materializedAssets);
}

async function writeHostNativeFiles(options: {
  spec: NativeHostSpec;
  workspaceRoot: string;
  managedRoot: string;
  nativeAssets: NativeAsset[];
  materializedAssets: MaterializedNativeAssets;
  mcpServers: string[];
}): Promise<NativeConfigOperation[]> {
  switch (options.spec.host) {
    case "cursor":
      return writeCursorNativeFiles(options);
    case "zed":
      return writeZedNativeFiles(options);
    case "claude-code":
      return writeClaudeCodeNativeFiles(options);
    case "pi":
      return writePiNativeFiles(options);
    case "codex":
      return writeCodexNativeFiles(options);
  }
}

/**
 * Applies host-native structured file payloads.
 */
function buildNativeWirePlan(options: {
  spec: NativeHostSpec;
  workspaceRoot: string;
  managedRoot: string;
  materializedAssets: MaterializedNativeAssets;
  nativeConfigOperations: NativeConfigOperation[];
  textFileSnapshots: ManagedTextFileSnapshot[];
}): WirePlanManifest {
  return {
    schemaVersion: 1,
    host: options.spec.host,
    generatedAt: new Date().toISOString(),
    workspaceRoot: toPosixPath(options.workspaceRoot),
    runtimeRoot: toPosixPath(options.managedRoot),
    instructionsFiles:
      options.materializedAssets.instructionFiles.map(toPosixPath),
    agentFiles: options.materializedAssets.agentFiles.map(toPosixPath),
    skillDirs: options.materializedAssets.skillDirs.map(toPosixPath),
    pluginDirs: options.materializedAssets.pluginDirs.map(toPosixPath),
    workflowFiles: options.materializedAssets.workflowFiles.map(toPosixPath),
    referenceFiles: options.materializedAssets.referenceFiles.map(toPosixPath),
    extensionIds: options.materializedAssets.extensionIds,
    hookFiles: options.materializedAssets.hookFiles.map(toPosixPath),
    mcpServers: options.materializedAssets.mcpServers,
    nativeConfigOperations: options.nativeConfigOperations,
    textFileSnapshots: options.textFileSnapshots,
    nativeInstallActions: [
      `${options.spec.displayName} project-local native wiring was applied under ${toPosixPath(options.workspaceRoot)}.`,
      "Restart or reload the host if it does not hot-reload project configuration files.",
      ...buildNativeExtensionInstallActionLines(
        options.spec,
        options.materializedAssets.extensionIds,
      ),
    ],
    notes: options.spec.notes,
  };
}

async function resetNativeHost(
  spec: NativeHostSpec,
  workspaceRoot: string,
  hostActivationRoot: string,
): Promise<void> {
  const managedRoot = join(workspaceRoot, ...spec.managedRootSegments);
  const previousWirePlan = validateManagedTextFileSnapshots(
    await readJsonFileOrNull<WirePlanManifest>(
      join(hostActivationRoot, "wire-plan.json"),
      assertWirePlanManifest,
    ),
    resolveManagedTextFileSnapshotPaths(spec, workspaceRoot),
    join(hostActivationRoot, "wire-plan.json"),
  );

  await revertNativeConfigOperations({
    workspaceRoot,
    host: spec.host,
    operations: previousWirePlan?.nativeConfigOperations,
  });
  await removePath(managedRoot);
  await removePath(join(hostActivationRoot, "wire-plan.json"));

  switch (spec.host) {
    case "cursor":
      await resetCursorNativeHost(workspaceRoot);
      return;
    case "zed":
      await resetZedNativeHost(
        workspaceRoot,
        previousWirePlan?.textFileSnapshots,
      );
      return;
    case "claude-code":
      await resetClaudeCodeNativeHost(
        workspaceRoot,
        previousWirePlan?.textFileSnapshots,
      );
      return;
    case "pi":
      await resetPiNativeHost(
        workspaceRoot,
        previousWirePlan?.textFileSnapshots,
      );
      return;
    case "codex":
      await resetCodexNativeHost(
        workspaceRoot,
        previousWirePlan?.textFileSnapshots,
      );
      return;
  }
}

async function cleanupFailedNativeHostApply(
  spec: NativeHostSpec,
  workspaceRoot: string,
  managedRoot: string,
  hostActivationRoot: string,
  textFileSnapshots: ManagedTextFileSnapshot[],
): Promise<void> {
  await removePath(managedRoot);
  await removePath(join(hostActivationRoot, "wire-plan.json"));

  switch (spec.host) {
    case "cursor":
      await resetCursorNativeHost(workspaceRoot);
      return;
    case "zed":
      await resetZedNativeHost(workspaceRoot, textFileSnapshots);
      return;
    case "claude-code":
      await resetClaudeCodeNativeHost(workspaceRoot, textFileSnapshots);
      return;
    case "pi":
      await resetPiNativeHost(workspaceRoot, textFileSnapshots);
      return;
    case "codex":
      await resetCodexNativeHost(workspaceRoot, textFileSnapshots);
      return;
  }
}

function resolveManagedTextFileSnapshotPaths(
  spec: NativeHostSpec,
  workspaceRoot: string,
): string[] {
  switch (spec.host) {
    case "zed":
      return [join(workspaceRoot, ".rules")];
    case "claude-code":
      return [
        join(workspaceRoot, "CLAUDE.md"),
        join(workspaceRoot, ".claude", "CLAUDE.md"),
      ];
    case "pi":
      return [
        join(workspaceRoot, "AGENTS.md"),
        join(workspaceRoot, "SYSTEM.md"),
      ];
    case "codex":
      return [join(workspaceRoot, "AGENTS.md")];
    default:
      return [];
  }
}

async function captureManagedTextFileSnapshots(
  paths: string[],
): Promise<ManagedTextFileSnapshot[]> {
  const snapshots: ManagedTextFileSnapshot[] = [];

  for (const filePath of paths) {
    snapshots.push({
      path: toPosixPath(filePath),
      content: await readTextFileOrNull(filePath),
    });
  }

  return snapshots;
}

/**
 * Exposes text-file snapshot restore for per-host adapter use.
 */
function fileNameForAssetKind(nativeAsset: NativeAsset): string {
  switch (nativeAsset.assetKind) {
    case "skill":
      return "SKILL.md";
    case "agent":
      return "agent.md";
    case "hook":
      return "hook.md";
    case "workflow":
    case "prompt-pack":
      return "prompt.md";
    case "plugin":
      return "plugin.md";
    case "mcp-server":
      return "mcp-server.md";
    default:
      return `${sanitizeAssetId(nativeAsset.assetId)}.md`;
  }
}

/**
 * Formats unknown errors for best-effort warning messages.
 */
function toLoggableErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  return String(error);
}

function buildMetadataFallback(asset: AssetCatalogEntry): string {
  return [
    `# ${asset.displayName}`,
    "",
    `- Asset ID: ${asset.id}`,
    `- Source: ${asset.source.sourceId}`,
    `- Authority: ${asset.source.authorityTier}`,
    `- Compatibility: ${asset.compatibilityMode}`,
    `- Origin: ${asset.source.originUrl}`,
    "",
    "## Capabilities",
    ...asset.capabilities.map((capability) => `- ${capability}`),
    "",
  ].join("\n");
}

function sortMaterializedAssets(
  materializedAssets: MaterializedNativeAssets,
): MaterializedNativeAssets {
  return {
    instructionFiles: [...materializedAssets.instructionFiles].sort(),
    agentFiles: [...materializedAssets.agentFiles].sort(),
    skillDirs: [...materializedAssets.skillDirs].sort(),
    pluginDirs: [...materializedAssets.pluginDirs].sort(),
    hookFiles: [...materializedAssets.hookFiles].sort(),
    workflowFiles: [...materializedAssets.workflowFiles].sort(),
    referenceFiles: [...materializedAssets.referenceFiles].sort(),
    extensionIds: uniqueStrings(materializedAssets.extensionIds),
    mcpServers: [...materializedAssets.mcpServers].sort(),
  };
}

function buildNativeExtensionInstallActionLines(
  spec: NativeHostSpec,
  extensionIds: string[],
): string[] {
  if (spec.host !== "cursor" || extensionIds.length === 0) {
    return [];
  }

  return formatExtensionInstallActions(
    buildExtensionInstallActions({
      executable: "cursor",
      extensionIds,
      host: "cursor",
    }),
  ).map((line) => `Cursor native extension action: ${line}`);
}

/**
 * Exposes focused native wire helpers for behavioral coverage.
 */
export const nativeWireInternals = {
  cleanupFailedNativeHostApply,
  describeJsonValue,
  mergeJsonObjects,
  mergeStringArraysPreservingOrder,
  isBenignRemoveDirectoryRace,
  nativeHostSpecs: NATIVE_HOST_SPECS,
  removeEmptyParentDirectories,
  removeManagedStringArrayEntries,
  toLoggableErrorMessage,
  validateManagedTextFileSnapshots,
  buildCodexPluginManifest,
  buildCodexHooksManifest,
};
