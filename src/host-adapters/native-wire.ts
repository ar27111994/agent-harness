import { join } from "node:path";

import {
  ensureDirectory,
  readJsonFileOrNull,
  readTextFileOrNull,
  removeManagedSection,
  removePath,
  toPosixPath,
  upsertManagedSection,
  writeJsonFile,
  writeTextFile,
} from "../files.js";
import { sanitizeAssetId } from "../lib/safe-paths.js";
import { readSharedMcpAssetIds } from "../lib/shared-mcp.js";
import {
  buildExtensionInstallActions,
  formatExtensionInstallActions,
  resolveVsCodeExtensionId,
} from "./extension-installer.js";
import type {
  ActivationManifest,
  AssetCatalogEntry,
  AssetKind,
  CopilotWorkspaceProfileManifest,
  WirePlanManifest,
  WirePreviewManifest,
} from "../types.js";
import type { WireMode } from "./types.js";

/**
 * Defines the supported native wire host values.
 */
export type NativeWireHost = "cursor" | "zed" | "claude-code" | "pi";

type LifecycleActivationHost = "copilot-vscode" | "opencode";

interface NativeHostSpec {
  host: NativeWireHost;
  displayName: string;
  activationHost: LifecycleActivationHost;
  previewHost: WirePreviewManifest["host"];
  managedRootSegments: string[];
  targetPathSegments: string[][];
  notes: string[];
}

interface NativeAsset {
  assetId: string;
  assetKind: AssetKind;
  displayName: string;
  content: string;
  extensionId?: string;
}

interface MaterializedNativeAssets {
  instructionFiles: string[];
  agentFiles: string[];
  skillDirs: string[];
  pluginDirs: string[];
  hookFiles: string[];
  workflowFiles: string[];
  referenceFiles: string[];
  extensionIds: string[];
  mcpServers: string[];
}

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
  const materializedAssets = await materializeNativeAssets(
    nativeAssets,
    managedRoot,
  );
  const mcpServers = uniqueStrings([
    ...materializedAssets.mcpServers,
    ...sharedMcpAssetIds,
  ]);

  await writeHostNativeFiles({
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
  });

  await writeJsonFile(join(managedRoot, "wire-plan.json"), wirePlan);
  await writeJsonFile(join(hostActivationRoot, "wire-plan.json"), wirePlan);
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
    content,
    extensionId: resolveVsCodeExtensionId(asset),
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
        materializedAssets.pluginDirs.push(assetRoot);
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
        materializedAssets.mcpServers.push(nativeAsset.assetId);
        break;
      case "reference-pack":
        materializedAssets.referenceFiles.push(contentPath);
        break;
      case "extension":
        materializedAssets.referenceFiles.push(contentPath);
        if (nativeAsset.extensionId) {
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
}): Promise<void> {
  switch (options.spec.host) {
    case "cursor":
      await writeCursorNativeFiles(options);
      return;
    case "zed":
      await writeZedNativeFiles(options);
      return;
    case "claude-code":
      await writeClaudeCodeNativeFiles(options);
      return;
    case "pi":
      await writePiNativeFiles(options);
      return;
  }
}

async function writeCursorNativeFiles(options: {
  workspaceRoot: string;
  managedRoot: string;
  nativeAssets: NativeAsset[];
  materializedAssets: MaterializedNativeAssets;
  mcpServers: string[];
}): Promise<void> {
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
}

async function writeCursorPluginFiles(options: {
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

function buildCursorPluginManifest(assetKinds: Set<AssetKind>): JsonObject {
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

async function writeZedNativeFiles(options: {
  workspaceRoot: string;
  managedRoot: string;
  nativeAssets: NativeAsset[];
  materializedAssets: MaterializedNativeAssets;
  mcpServers: string[];
}): Promise<void> {
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
}

async function writeClaudeCodeNativeFiles(options: {
  workspaceRoot: string;
  managedRoot: string;
  nativeAssets: NativeAsset[];
  materializedAssets: MaterializedNativeAssets;
  mcpServers: string[];
}): Promise<void> {
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
}

async function writePiNativeFiles(options: {
  workspaceRoot: string;
  managedRoot: string;
  nativeAssets: NativeAsset[];
  materializedAssets: MaterializedNativeAssets;
  mcpServers: string[];
}): Promise<void> {
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
}

function buildNativeWirePlan(options: {
  spec: NativeHostSpec;
  workspaceRoot: string;
  managedRoot: string;
  materializedAssets: MaterializedNativeAssets;
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
  await removePath(managedRoot);
  await removePath(join(hostActivationRoot, "wire-plan.json"));

  switch (spec.host) {
    case "cursor":
      await removePath(
        join(workspaceRoot, ".cursor", "rules", "agent-harness.mdc"),
      );
      return;
    case "zed":
      await removeManagedSectionFile(
        join(workspaceRoot, ".rules"),
        "agent-harness-zed",
      );
      await removeManagedZedSettings(
        join(workspaceRoot, ".zed", "settings.json"),
      );
      return;
    case "claude-code":
      await removeManagedSectionFile(
        join(workspaceRoot, "CLAUDE.md"),
        "agent-harness-claude-code",
      );
      await removeManagedSectionFile(
        join(workspaceRoot, ".claude", "CLAUDE.md"),
        "agent-harness-claude-code",
      );
      await removePath(
        join(workspaceRoot, ".claude", "rules", "agent-harness.md"),
      );
      await removePath(
        join(workspaceRoot, ".claude", "agents", "agent-harness.md"),
      );
      await removePath(
        join(workspaceRoot, ".claude", "skills", "agent-harness"),
      );
      await removePath(
        join(workspaceRoot, ".claude", "commands", "agent-harness.md"),
      );
      return;
    case "pi":
      await removeManagedSectionFile(
        join(workspaceRoot, "AGENTS.md"),
        "agent-harness-pi",
      );
      await removeManagedSectionFile(
        join(workspaceRoot, "SYSTEM.md"),
        "agent-harness-pi",
      );
      await removePath(join(workspaceRoot, ".pi", "skills", "agent-harness"));
      await removePath(
        join(workspaceRoot, ".pi", "prompts", "agent-harness.md"),
      );
      await removeManagedPiSettings(
        join(workspaceRoot, ".pi", "settings.json"),
      );
      return;
  }
}

async function upsertManagedSectionFile(
  filePath: string,
  markerId: string,
  bodyLines: string[],
): Promise<void> {
  const existingContent = (await readTextFileOrNull(filePath)) ?? "";
  await writeTextFile(
    filePath,
    upsertManagedSection({
      originalContent: existingContent,
      markerId,
      bodyLines,
    }),
  );
}

async function removeManagedSectionFile(
  filePath: string,
  markerId: string,
): Promise<void> {
  const existingContent = await readTextFileOrNull(filePath);
  if (existingContent === null) {
    return;
  }

  const nextContent = removeManagedSection({
    originalContent: existingContent,
    markerId,
  });
  if (nextContent.trim().length === 0) {
    await removePath(filePath);
    return;
  }

  await writeTextFile(filePath, nextContent);
}

async function mergeJsonFile(
  filePath: string,
  patch: JsonObject,
): Promise<void> {
  const currentValue = await readJsonFileOrNull<unknown>(filePath);
  const currentObject =
    currentValue === null ? {} : assertJsonObject(currentValue, filePath);
  await writeJsonFile(filePath, mergeJsonObjects(currentObject, patch));
}

/**
 * Ensures an existing host settings file can be safely object-merged.
 */
function assertJsonObject(value: unknown, filePath: string): JsonObject {
  if (isJsonObject(value)) {
    return value;
  }

  throw new Error(
    `Expected ${toPosixPath(filePath)} to contain a JSON object, but found ${describeJsonValue(value)}.`,
  );
}

function describeJsonValue(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }

  return value === null ? "null" : typeof value;
}

async function removeManagedZedSettings(filePath: string): Promise<void> {
  const existingValue = await readJsonFileOrNull<unknown>(filePath);
  const settings = asJsonObject(existingValue);
  if (!settings) {
    return;
  }

  const agent = asJsonObject(settings.agent);
  const profiles = asJsonObject(agent?.profiles);
  if (profiles) {
    delete profiles["agent-harness"];
  }
  if (profiles && Object.keys(profiles).length === 0 && agent) {
    delete agent.profiles;
  }
  if (agent && Object.keys(agent).length === 0) {
    delete settings.agent;
  }

  await writeOrRemoveJsonFile(filePath, settings);
}

async function upsertManagedPiSettings(filePath: string): Promise<void> {
  const existingValue = await readJsonFileOrNull<unknown>(filePath);
  const settings =
    existingValue === null ? {} : assertJsonObject(existingValue, filePath);
  delete settings.agentHarness;

  await writeOrRemoveJsonFile(
    filePath,
    mergeJsonObjects(settings, {
      skills: ["skills/agent-harness"],
      prompts: ["prompts/agent-harness.md"],
    }),
  );
}

async function removeManagedPiSettings(filePath: string): Promise<void> {
  const existingValue = await readJsonFileOrNull<unknown>(filePath);
  const settings = asJsonObject(existingValue);
  if (!settings) {
    return;
  }

  removeManagedStringArrayEntries(settings, "skills", ["skills/agent-harness"]);
  removeManagedStringArrayEntries(settings, "prompts", [
    "prompts/agent-harness.md",
  ]);
  delete settings.agentHarness;

  await writeOrRemoveJsonFile(filePath, settings);
}

async function writeOrRemoveJsonFile(
  filePath: string,
  value: JsonObject,
): Promise<void> {
  if (Object.keys(value).length === 0) {
    await removePath(filePath);
    return;
  }

  await writeJsonFile(filePath, value);
}

function buildManagedInstructionLines(options: {
  hostName: string;
  managedRoot: string;
  nativeAssets: NativeAsset[];
  materializedAssets: MaterializedNativeAssets;
  mcpServers: string[];
}): string[] {
  const lines = [
    `# Agent Harness for ${options.hostName}`,
    "",
    "Agent Harness has wired curated project assets into this workspace.",
    `Managed asset root: ${toPosixPath(options.managedRoot)}`,
    "",
    "## Active assets",
  ];

  if (options.nativeAssets.length === 0) {
    lines.push("- No active assets were found at wire time.");
  } else {
    for (const asset of options.nativeAssets) {
      lines.push(
        `- ${asset.displayName} (${asset.assetKind}, ${asset.assetId})`,
      );
    }
  }

  appendMaterializedAssetPathLines(lines, options.materializedAssets);

  if (options.mcpServers.length > 0) {
    lines.push("", "## MCP references");
    for (const mcpServer of options.mcpServers) {
      lines.push(`- ${mcpServer}`);
    }
  }

  lines.push(
    "",
    "## Usage guidance",
    "- Prefer the curated assets above when they match the current task.",
    "- Treat hooks, plugins, extensions, and MCP references as opt-in capabilities that may require host-specific trust or setup.",
    "- Review managed files before committing project-local host configuration.",
  );

  return lines;
}

function appendMaterializedAssetPathLines(
  lines: string[],
  materializedAssets: MaterializedNativeAssets,
): void {
  const pathGroups = [
    ["Instruction files", materializedAssets.instructionFiles],
    ["Agent files", materializedAssets.agentFiles],
    ["Skill directories", materializedAssets.skillDirs],
    ["Plugin directories", materializedAssets.pluginDirs],
    ["Hook files", materializedAssets.hookFiles],
    ["Workflow and prompt files", materializedAssets.workflowFiles],
    ["Reference files", materializedAssets.referenceFiles],
  ] as const;
  const populatedPathGroups = pathGroups.filter(
    ([, paths]) => paths.length > 0,
  );

  if (
    populatedPathGroups.length === 0 &&
    materializedAssets.extensionIds.length === 0
  ) {
    return;
  }

  lines.push("", "## Wired asset locations");
  for (const [heading, paths] of populatedPathGroups) {
    lines.push("", `### ${heading}`);
    for (const path of paths) {
      lines.push(`- ${toPosixPath(path)}`);
    }
  }

  if (materializedAssets.extensionIds.length > 0) {
    lines.push("", "### Extension IDs");
    for (const extensionId of materializedAssets.extensionIds) {
      lines.push(`- ${extensionId}`);
    }
  }
}

function buildNativeAssetContentSections(
  nativeAssets: NativeAsset[],
  assetKinds: AssetKind[],
): string[] {
  const selectedAssets = nativeAssets.filter((nativeAsset) =>
    assetKinds.includes(nativeAsset.assetKind),
  );

  if (selectedAssets.length === 0) {
    return [];
  }

  const lines = ["", "## Selected asset content"];
  for (const asset of selectedAssets) {
    lines.push(
      "",
      `### ${asset.displayName}`,
      "",
      `- Asset ID: ${asset.assetId}`,
      `- Asset kind: ${asset.assetKind}`,
      "",
      asset.content.trim(),
    );
  }

  return lines;
}

function buildAssetMarkdown(nativeAsset: NativeAsset): string {
  return [
    `# ${nativeAsset.displayName}`,
    "",
    `- Asset ID: ${nativeAsset.assetId}`,
    `- Asset kind: ${nativeAsset.assetKind}`,
    "",
    "## Content",
    "",
    nativeAsset.content.trim(),
    "",
  ].join("\n");
}

function buildAgentFile(
  name: string,
  description: string,
  bodyLines: string[],
): string {
  return [
    "---",
    `name: ${quoteFrontmatterScalar(name)}`,
    `description: ${quoteFrontmatterScalar(description)}`,
    "---",
    "",
    ...bodyLines,
    "",
  ].join("\n");
}

function buildSkillFile(
  name: string,
  description: string,
  bodyLines: string[],
): string {
  return [
    "---",
    `name: ${quoteFrontmatterScalar(name)}`,
    `description: ${quoteFrontmatterScalar(description)}`,
    "---",
    "",
    ...bodyLines,
    "",
  ].join("\n");
}

function buildPromptTemplate(description: string, bodyLines: string[]): string {
  return [
    "---",
    `description: ${quoteFrontmatterScalar(description)}`,
    "---",
    "",
    ...bodyLines,
    "",
  ].join("\n");
}

function quoteFrontmatterScalar(value: string): string {
  return JSON.stringify(value.replace(/\r\n?/gu, "\n"));
}

function directoryNameForAssetKind(assetKind: AssetKind): string {
  switch (assetKind) {
    case "mcp-server":
      return "mcp-servers";
    case "prompt-pack":
      return "prompt-packs";
    case "reference-pack":
      return "reference-packs";
    default:
      return `${assetKind}s`;
  }
}

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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

type JsonObject = Record<string, unknown>;

function mergeJsonObjects(base: JsonObject, patch: JsonObject): JsonObject {
  const merged: JsonObject = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    const existingValue = merged[key];
    if (Array.isArray(value)) {
      merged[key] = uniqueStrings([
        ...coerceStringArray(existingValue),
        ...value.filter((entry): entry is string => typeof entry === "string"),
      ]);
      continue;
    }

    if (isJsonObject(value) && isJsonObject(existingValue)) {
      merged[key] = mergeJsonObjects(existingValue, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

function asJsonObject(value: unknown): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function removeManagedStringArrayEntries(
  settings: JsonObject,
  key: string,
  entriesToRemove: readonly string[],
): void {
  if (!(key in settings)) {
    return;
  }

  const nextValues = coerceStringArray(settings[key]).filter(
    (entry) => !entriesToRemove.includes(entry),
  );
  if (nextValues.length === 0) {
    delete settings[key];
    return;
  }

  settings[key] = nextValues;
}
