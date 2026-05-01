import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { readdir, stat } from "node:fs/promises";

import { resolveAssetContent } from "./asset-content.js";
import {
  ensureDirectory,
  readJsonFileOrNull,
  removePath,
  replaceDirectoryLink,
  toPosixPath,
  writeJsonFile,
  writeTextFile,
} from "./files.js";
import type {
  ActivationManifest,
  AssetCatalogEntry,
  CopilotWorkspaceOverlayManifest,
  CopilotWorkspaceProfileManifest,
  WirePlanManifest,
  WirePreviewManifest,
} from "./types.js";
import {
  formatExtensionInstallActions,
  buildVsCodeExtensionInstallActions,
} from "./host-adapters/extension-installer.js";
import {
  toHomeRelativePath,
  resolveVsCodeUserSettingsPath,
} from "./lib/paths.js";
import { assertActivationManifest } from "./manifest-validation.js";
import { patchVsCodeSettings, readVsCodeSettings } from "./vscode-settings.js";

const VSCODE_USER_SETTINGS_PATH = resolveVsCodeUserSettingsPath();

export async function wireVsCode(options: {
  projectRoot: string;
  workspaceRoot: string;
  mode: "preview" | "apply" | "reset";
}): Promise<void> {
  const { projectRoot, workspaceRoot, mode } = options;
  const activationRoot = join(projectRoot, "activate", "copilot-vscode");
  const profileManifest =
    await readJsonFileOrNull<CopilotWorkspaceProfileManifest>(
      join(activationRoot, "workspace-profile-manifest.json"),
    );

  const curatedRoot = join(homedir(), ".copilot", "agent-harness");
  const currentRoot = join(curatedRoot, "current");
  const generationId = profileManifest?.profileId
    ? `${profileManifest.profileId}-${Date.now()}`
    : `general-${Date.now()}`;
  const generationRoot = join(curatedRoot, "generations", generationId);
  const instructionsRoot = join(generationRoot, "instructions");
  const agentsRoot = join(generationRoot, "agents");
  const skillsRoot = join(generationRoot, "skills");
  const hooksRoot = join(generationRoot, "hooks");
  const pluginsRoot = join(generationRoot, "plugins");
  const extensionsRoot = join(generationRoot, "extensions");
  const sharedMcpAssetIds = await readSharedMcpAssetIds(projectRoot);

  const preview: WirePreviewManifest = {
    schemaVersion: 1,
    host: "vscode",
    mode,
    generatedAt: new Date().toISOString(),
    workspaceRoot: toPosixPath(workspaceRoot),
    targetPaths: [
      toPosixPath(VSCODE_USER_SETTINGS_PATH),
      toPosixPath(join(workspaceRoot, ".github", "copilot-instructions.md")),
      toPosixPath(currentRoot),
      toPosixPath(generationRoot),
    ],
    notes: [
      "VS Code wire-in updates only user-scoped settings for protected AI path settings.",
      "Workspace-level copilot instructions are materialized into .github/copilot-instructions.md.",
      "Managed assets are materialized into generation-scoped directories and exposed through a stable current link.",
    ],
  };

  await writeJsonFile(
    join(activationRoot, "wire-preview-vscode.json"),
    preview,
  );

  if (mode === "preview") {
    return;
  }

  if (mode === "reset") {
    await resetVsCodeWireIn(workspaceRoot, curatedRoot);
    return;
  }

  await ensureDirectory(curatedRoot);
  await ensureDirectory(instructionsRoot);
  await ensureDirectory(agentsRoot);
  await ensureDirectory(skillsRoot);
  await ensureDirectory(hooksRoot);
  await ensureDirectory(pluginsRoot);
  await ensureDirectory(extensionsRoot);

  let materializedPaths: MaterializedVsCodePaths = {
    instructionFiles: [],
    agentFiles: [],
    skillRoots: [],
    hookFiles: [],
    pluginFolders: [],
    extensionIds: [],
  };

  if (profileManifest) {
    await materializeWorkspaceInstructions(
      workspaceRoot,
      activationRoot,
      profileManifest,
    );
    materializedPaths = await materializeCuratedFolders(
      activationRoot,
      profileManifest,
      {
        instructionsRoot,
        agentsRoot,
        skillsRoot,
        hooksRoot,
        pluginsRoot,
        extensionsRoot,
      },
    );
  }

  await writeJsonFile(
    join(generationRoot, "wire-plan.json"),
    buildVsCodeWirePlan(
      workspaceRoot,
      currentRoot,
      materializedPaths,
      sharedMcpAssetIds,
    ),
  );
  await writeJsonFile(
    join(curatedRoot, "wire-plan.json"),
    buildVsCodeWirePlan(
      workspaceRoot,
      currentRoot,
      materializedPaths,
      sharedMcpAssetIds,
    ),
  );
  await replaceDirectoryLink(currentRoot, generationRoot);
  await pruneVsCodeGenerationDirectories(curatedRoot, { keep: 3 });
  await patchVsCodeUserSettings({
    currentRoot,
    curatedRoot,
    materializedPaths,
  });
}

async function patchVsCodeUserSettings(paths: {
  currentRoot: string;
  curatedRoot: string;
  materializedPaths: MaterializedVsCodePaths;
}): Promise<void> {
  const currentSettings = await readVsCodeSettings(VSCODE_USER_SETTINGS_PATH);
  const basePluginLocations = stripManagedVsCodeLocationEntries(
    currentSettings["chat.pluginLocations"],
    paths.curatedRoot,
  );
  const baseAgentSkillsLocations = stripManagedVsCodeLocationEntries(
    currentSettings["chat.agentSkillsLocations"],
    paths.curatedRoot,
  );
  const baseHookFilesLocations = stripManagedVsCodeLocationEntries(
    currentSettings["chat.hookFilesLocations"],
    paths.curatedRoot,
  );
  const baseAgentFilesLocations = stripManagedVsCodeLocationEntries(
    currentSettings["chat.agentFilesLocations"],
    paths.curatedRoot,
  );
  const baseInstructionsFilesLocations = stripManagedVsCodeLocationEntries(
    currentSettings["chat.instructionsFilesLocations"],
    paths.curatedRoot,
  );
  const nextSettings = {
    ...currentSettings,
    "chat.pluginLocations": {
      ...basePluginLocations,
      [toHomePath(join(paths.currentRoot, "plugins"))]: true,
    },
    "chat.agentSkillsLocations": {
      ...baseAgentSkillsLocations,
      ...buildVsCodeSkillLocationOverrides(paths.currentRoot),
    },
    "chat.hookFilesLocations": {
      ...baseHookFilesLocations,
      [toHomePath(join(paths.currentRoot, "hooks"))]: true,
    },
    "chat.agentFilesLocations": {
      ...baseAgentFilesLocations,
      [toHomePath(join(paths.currentRoot, "agents"))]: true,
    },
    "chat.instructionsFilesLocations": {
      ...baseInstructionsFilesLocations,
      [toHomePath(join(paths.currentRoot, "instructions"))]: true,
    },
    "github.copilot.chat.codeGeneration.instructions": [
      {
        file: ".github/copilot-instructions.md",
      },
    ],
  };

  await patchVsCodeSettings(VSCODE_USER_SETTINGS_PATH, nextSettings);
}

async function materializeWorkspaceInstructions(
  workspaceRoot: string,
  activationRoot: string,
  profileManifest: CopilotWorkspaceProfileManifest,
): Promise<void> {
  const destinationDirectory = join(workspaceRoot, ".github");
  const destinationPath = join(destinationDirectory, "copilot-instructions.md");
  await ensureDirectory(destinationDirectory);

  const sections: string[] = ["# Generated by agent-harness", ""];

  for (const instructionId of profileManifest.selectedInstructionIds) {
    const resolvedAsset = await resolveAssetContent({
      projectRoot: dirname(dirname(activationRoot)),
      activationRoot,
      assetId: instructionId,
    });
    if (!resolvedAsset?.content) {
      continue;
    }

    sections.push(`<!-- ${instructionId} -->`);
    sections.push(resolvedAsset.content.trim());
    sections.push("");
  }

  await writeTextFile(destinationPath, `${sections.join("\n").trim()}\n`);
}

async function materializeCuratedFolders(
  activationRoot: string,
  profileManifest: CopilotWorkspaceProfileManifest,
  targets: {
    instructionsRoot: string;
    agentsRoot: string;
    skillsRoot: string;
    hooksRoot: string;
    pluginsRoot: string;
    extensionsRoot: string;
  },
): Promise<MaterializedVsCodePaths> {
  const instructionFiles = await materializeInstructionFiles(
    profileManifest.selectedInstructionIds,
    activationRoot,
    targets.instructionsRoot,
  );
  const agentFiles = await materializeAgentFiles(
    profileManifest.selectedAgentIds,
    activationRoot,
    targets.agentsRoot,
  );
  const skillRoots = await materializeSkillDirectories(
    profileManifest.selectedSkillIds ?? [],
    activationRoot,
    targets.skillsRoot,
  );
  const hookFiles = await materializeHookFiles(
    profileManifest.selectedHookIds ?? [],
    activationRoot,
    targets.hooksRoot,
  );
  const pluginFolders = await materializePluginFolders(
    profileManifest.selectedPluginIds ?? [],
    activationRoot,
    targets.pluginsRoot,
  );
  const extensionIds = await materializeExtensionMetadata(
    profileManifest.selectedExtensionIds ?? [],
    activationRoot,
    targets.extensionsRoot,
  );

  return {
    instructionFiles,
    agentFiles,
    skillRoots,
    hookFiles,
    pluginFolders,
    extensionIds,
  };
}

async function materializeInstructionFiles(
  assetIds: string[],
  activationRoot: string,
  destinationRoot: string,
): Promise<string[]> {
  const materializedPaths: string[] = [];

  for (const assetId of assetIds) {
    const assetData = await readActivationAssetData(activationRoot, assetId);
    if (!assetData?.content) {
      continue;
    }

    const destinationPath = join(
      destinationRoot,
      `${sanitizeAssetId(assetId)}.instructions.md`,
    );
    await writeTextFile(destinationPath, assetData.content);
    materializedPaths.push(destinationPath);
  }

  return materializedPaths;
}

async function materializeAgentFiles(
  assetIds: string[],
  activationRoot: string,
  destinationRoot: string,
): Promise<string[]> {
  const materializedPaths: string[] = [];

  for (const assetId of assetIds) {
    const assetData = await readActivationAssetData(activationRoot, assetId);
    if (!assetData?.content) {
      continue;
    }

    const destinationPath = join(
      destinationRoot,
      `${sanitizeAssetId(assetId)}.agent.md`,
    );
    await writeTextFile(destinationPath, assetData.content);
    materializedPaths.push(destinationPath);
  }

  return materializedPaths;
}

async function materializeSkillDirectories(
  assetIds: string[],
  activationRoot: string,
  destinationRoot: string,
): Promise<string[]> {
  const materializedRoots: string[] = [];

  for (const assetId of assetIds) {
    const assetData = await readActivationAssetData(activationRoot, assetId);
    if (!assetData?.content) {
      continue;
    }

    const skillRoot = join(destinationRoot, sanitizeAssetId(assetId));
    await ensureDirectory(skillRoot);
    await writeTextFile(join(skillRoot, "SKILL.md"), assetData.content);
    materializedRoots.push(skillRoot);
  }

  return materializedRoots;
}

async function materializeHookFiles(
  assetIds: string[],
  activationRoot: string,
  destinationRoot: string,
): Promise<string[]> {
  const materializedPaths: string[] = [];

  for (const assetId of assetIds) {
    const assetData = await readActivationAssetData(activationRoot, assetId);
    if (!assetData?.content) {
      continue;
    }

    const extension = assetData.sourcePath?.endsWith(".json") ? ".json" : ".md";
    const destinationPath = join(
      destinationRoot,
      `${sanitizeAssetId(assetId)}${extension}`,
    );
    await writeTextFile(destinationPath, assetData.content);
    materializedPaths.push(destinationPath);
  }

  return materializedPaths;
}

async function materializePluginFolders(
  assetIds: string[],
  activationRoot: string,
  destinationRoot: string,
): Promise<string[]> {
  const materializedRoots: string[] = [];

  for (const assetId of assetIds) {
    const assetData = await readActivationAssetData(activationRoot, assetId);
    if (!assetData?.content) {
      continue;
    }

    const pluginRoot = join(destinationRoot, sanitizeAssetId(assetId));
    await ensureDirectory(pluginRoot);
    const fileName = inferPluginFileName(assetData);
    await writeTextFile(join(pluginRoot, fileName), assetData.content);
    if (fileName !== "README.md") {
      await writeTextFile(join(pluginRoot, "README.md"), `# ${assetId}\n`);
    }
    materializedRoots.push(pluginRoot);
  }

  return materializedRoots;
}

async function materializeExtensionMetadata(
  assetIds: string[],
  activationRoot: string,
  destinationRoot: string,
): Promise<string[]> {
  const materializedExtensionIds: string[] = [];

  for (const assetId of assetIds) {
    const assetData = await readActivationAssetData(activationRoot, assetId);
    if (!assetData) {
      continue;
    }

    await writeJsonFile(
      join(destinationRoot, `${sanitizeAssetId(assetId)}.json`),
      {
        schemaVersion: 1,
        assetId,
        displayName: assetData.asset.displayName,
        source: assetData.asset.source,
        nativeInstall: buildVsCodeExtensionInstallActions([assetId])[0],
      },
    );
    materializedExtensionIds.push(assetId);
  }

  return materializedExtensionIds;
}

async function resetVsCodeWireIn(
  workspaceRoot: string,
  curatedRoot: string,
): Promise<void> {
  const destinationPath = join(
    workspaceRoot,
    ".github",
    "copilot-instructions.md",
  );
  const destinationDirectory = join(workspaceRoot, ".github");
  await ensureDirectory(destinationDirectory);
  await writeTextFile(destinationPath, "");
  await removePath(curatedRoot);
  await resetVsCodeUserSettings({
    curatedRoot,
    currentRoot: join(curatedRoot, "current"),
  });
}

function buildVsCodeWirePlan(
  workspaceRoot: string,
  curatedRoot: string,
  materializedPaths: MaterializedVsCodePaths,
  sharedMcpAssetIds: string[],
): WirePlanManifest {
  return {
    schemaVersion: 1,
    host: "vscode-user",
    generatedAt: new Date().toISOString(),
    workspaceRoot: toPosixPath(workspaceRoot),
    runtimeRoot: toPosixPath(curatedRoot),
    instructionsFiles: [
      toPosixPath(join(workspaceRoot, ".github", "copilot-instructions.md")),
      ...materializedPaths.instructionFiles.map(toPosixPath),
    ],
    agentFiles: materializedPaths.agentFiles.map(toPosixPath),
    skillDirs: materializedPaths.skillRoots.map(toPosixPath),
    pluginDirs: materializedPaths.pluginFolders.map(toPosixPath),
    extensionIds: materializedPaths.extensionIds,
    mcpServers: sharedMcpAssetIds,
    nativeInstallActions: formatExtensionInstallActions(
      buildVsCodeExtensionInstallActions(materializedPaths.extensionIds),
    ),
    hookFiles: materializedPaths.hookFiles.map(toPosixPath),
    notes: [
      "User-scoped AI path settings are patched in VS Code settings.json.",
      "Workspace copilot instructions are materialized locally for Copilot consumption.",
      "Extension assets are tracked separately from plugins and require explicit native install actions.",
      "Shared MCP assets are surfaced in the effective wire plan for host runtime configuration.",
    ],
  };
}

async function resetVsCodeUserSettings(paths: {
  curatedRoot: string;
  currentRoot: string;
}): Promise<void> {
  const currentSettings = await readVsCodeSettings(VSCODE_USER_SETTINGS_PATH);
  const managedSkillOverrides = buildVsCodeSkillLocationOverrides(
    paths.currentRoot,
  );
  const managedSkillOverrideKeys = new Set(Object.keys(managedSkillOverrides));
  const managedPathKeys = {
    plugin: toHomePath(join(paths.currentRoot, "plugins")),
    hook: toHomePath(join(paths.currentRoot, "hooks")),
    agent: toHomePath(join(paths.currentRoot, "agents")),
    instruction: toHomePath(join(paths.currentRoot, "instructions")),
  };
  const nextCodeGenerationInstructions = stripManagedCodeGenerationInstructions(
    currentSettings["github.copilot.chat.codeGeneration.instructions"],
  );
  const nextSettings = {
    ...currentSettings,
    "chat.pluginLocations": stripManagedVsCodeLocationEntries(
      currentSettings["chat.pluginLocations"],
      paths.curatedRoot,
      new Set([managedPathKeys.plugin]),
    ),
    "chat.agentSkillsLocations": stripManagedVsCodeLocationEntries(
      currentSettings["chat.agentSkillsLocations"],
      paths.curatedRoot,
      managedSkillOverrideKeys,
    ),
    "chat.hookFilesLocations": stripManagedVsCodeLocationEntries(
      currentSettings["chat.hookFilesLocations"],
      paths.curatedRoot,
      new Set([managedPathKeys.hook]),
    ),
    "chat.agentFilesLocations": stripManagedVsCodeLocationEntries(
      currentSettings["chat.agentFilesLocations"],
      paths.curatedRoot,
      new Set([managedPathKeys.agent]),
    ),
    "chat.instructionsFilesLocations": stripManagedVsCodeLocationEntries(
      currentSettings["chat.instructionsFilesLocations"],
      paths.curatedRoot,
      new Set([managedPathKeys.instruction]),
    ),
    "github.copilot.chat.codeGeneration.instructions":
      nextCodeGenerationInstructions,
  };

  await patchVsCodeSettings(VSCODE_USER_SETTINGS_PATH, nextSettings);
}

function stripManagedVsCodeLocationEntries(
  value: unknown,
  curatedRoot: string,
  explicitManagedKeys: ReadonlySet<string> = new Set<string>(),
): Record<string, boolean> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const normalizedCuratedRoot = toHomePath(curatedRoot);
  const managedRootPrefix = normalizedCuratedRoot.endsWith("/")
    ? normalizedCuratedRoot
    : `${normalizedCuratedRoot}/`;
  return Object.fromEntries(
    Object.entries(value as Record<string, boolean>).filter(
      ([key]) =>
        !(
          explicitManagedKeys.has(key) ||
          key === normalizedCuratedRoot ||
          key.startsWith(managedRootPrefix)
        ),
    ),
  );
}

function stripManagedCodeGenerationInstructions(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  const nextValue = value.filter((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return true;
    }
    const record = entry as Record<string, unknown>;
    return record.file !== ".github/copilot-instructions.md";
  });

  return nextValue.length > 0 ? nextValue : undefined;
}

function buildVsCodeSkillLocationOverrides(
  curatedRoot: string,
): Record<string, boolean> {
  return {
    "~/.copilot/skills": false,
    "~/.agents/skills": false,
    "~/.claude/skills": false,
    "~/.config/opencode/skills": false,
    [toHomePath(join(curatedRoot, "skills"))]: true,
  };
}

async function readSharedMcpAssetIds(projectRoot: string): Promise<string[]> {
  const sharedActivationManifest = await readJsonFileOrNull<ActivationManifest>(
    join(projectRoot, "activate", "shared", "activation-manifest.json"),
    assertActivationManifest,
  );

  return [...new Set(sharedActivationManifest?.activeAssets ?? [])].sort(
    (left, right) => left.localeCompare(right),
  );
}

async function readActivationAssetData(
  activationRoot: string,
  assetId: string,
): Promise<{
  content: string;
  asset: AssetCatalogEntry;
  sourcePath?: string;
} | null> {
  const resolvedAsset = await resolveAssetContent({
    projectRoot: dirname(dirname(activationRoot)),
    activationRoot,
    assetId,
  });
  if (!resolvedAsset) {
    return null;
  }

  return {
    content: resolvedAsset.content,
    asset: resolvedAsset.asset,
    sourcePath: resolvedAsset.asset.evidence.filePath,
  };
}

function inferPluginFileName(assetData: {
  content: string;
  sourcePath?: string;
}): string {
  const sourcePath = assetData.sourcePath;
  const baseFileName = sourcePath ? basename(sourcePath) : undefined;

  if (baseFileName && baseFileName.length > 0) {
    return baseFileName;
  }

  const trimmedContent = assetData.content.trim();
  if (trimmedContent.startsWith("{") || trimmedContent.startsWith("[")) {
    return "plugin.json";
  }

  if (sourcePath && extname(sourcePath).length > 0) {
    return `plugin${extname(sourcePath)}`;
  }

  return "README.md";
}

interface MaterializedVsCodePaths {
  instructionFiles: string[];
  agentFiles: string[];
  skillRoots: string[];
  hookFiles: string[];
  pluginFolders: string[];
  extensionIds: string[];
}

export function buildCopilotWorkspaceOverlayManifest(options: {
  workspaceRoot: string;
  overlayPlan: CopilotWorkspaceOverlayManifest;
}): CopilotWorkspaceOverlayManifest {
  return {
    ...options.overlayPlan,
    workspaceRoot: toPosixPath(options.workspaceRoot),
  };
}

function sanitizeAssetId(value: string): string {
  const base =
    value.replace(/[^a-zA-Z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "") || "asset";
  const suffix = createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `${base}-${suffix}`;
}

function toHomePath(pathValue: string): string {
  return toHomeRelativePath(pathValue);
}

async function pruneVsCodeGenerationDirectories(
  curatedRoot: string,
  options: { keep: number },
): Promise<void> {
  const generationsDir = join(curatedRoot, "generations");
  try {
    const entries = await readdir(generationsDir, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());

    const directoriesWithMtime = await Promise.all(
      directories.map(async (dir) => {
        const dirPath = join(generationsDir, dir.name);
        try {
          const stats = await stat(dirPath);
          return {
            name: dir.name,
            path: dirPath,
            mtime: stats.mtime.getTime(),
          };
        } catch {
          return null;
        }
      }),
    );

    const validDirectories = directoriesWithMtime.filter(
      (entry): entry is NonNullable<typeof entry> => entry !== null,
    );

    validDirectories.sort((a, b) => b.mtime - a.mtime);

    const toRemove = validDirectories.slice(options.keep);

    for (const dir of toRemove) {
      try {
        await removePath(dir.path);
      } catch (error) {
        console.warn(
          `Failed to prune generation directory ${dir.path}: ${toLoggableErrorMessage(error)}`,
        );
      }
    }
  } catch {
    // Ignore errors if the generations directory doesn't exist
  }
}

function toLoggableErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  return String(error);
}
