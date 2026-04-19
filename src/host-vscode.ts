import { basename, dirname, extname, join } from "node:path";

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
  AssetCatalogEntry,
  CopilotWorkspaceOverlayManifest,
  CopilotWorkspaceProfileManifest,
  WirePlanManifest,
  WirePreviewManifest,
} from "./types.js";
import { patchVsCodeSettings, readVsCodeSettings } from "./vscode-settings.js";

const VSCODE_USER_SETTINGS_PATH = join(
  process.env.APPDATA ?? "",
  "Code",
  "User",
  "settings.json",
);

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

  const curatedRoot = join(
    process.env.USERPROFILE ?? "",
    ".copilot",
    "agent-harness",
  );
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

  let materializedPaths: MaterializedVsCodePaths = {
    instructionFiles: [],
    agentFiles: [],
    skillRoots: [],
    hookFiles: [],
    pluginFolders: [],
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
      },
    );
  }

  await writeJsonFile(
    join(generationRoot, "wire-plan.json"),
    buildVsCodeWirePlan(workspaceRoot, currentRoot, materializedPaths),
  );
  await writeJsonFile(
    join(curatedRoot, "wire-plan.json"),
    buildVsCodeWirePlan(workspaceRoot, currentRoot, materializedPaths),
  );
  await replaceDirectoryLink(currentRoot, generationRoot);
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

  return {
    instructionFiles,
    agentFiles,
    skillRoots,
    hookFiles,
    pluginFolders,
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

async function resetVsCodeWireIn(
  workspaceRoot: string,
  curatedRoot: string,
): Promise<void> {
  const destinationPath = join(
    workspaceRoot,
    ".github",
    "copilot-instructions.md",
  );
  await writeTextFile(destinationPath, "");
  await removePath(curatedRoot);
  await resetVsCodeUserSettings(curatedRoot);
}

function buildVsCodeWirePlan(
  workspaceRoot: string,
  curatedRoot: string,
  materializedPaths: MaterializedVsCodePaths,
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
    hookFiles: materializedPaths.hookFiles.map(toPosixPath),
    notes: [
      "User-scoped AI path settings are patched in VS Code settings.json.",
      "Workspace copilot instructions are materialized locally for Copilot consumption.",
    ],
  };
}

async function resetVsCodeUserSettings(curatedRoot: string): Promise<void> {
  const currentSettings = await readVsCodeSettings(VSCODE_USER_SETTINGS_PATH);
  const nextSettings = {
    ...currentSettings,
    "chat.pluginLocations": stripManagedVsCodeLocationEntries(
      currentSettings["chat.pluginLocations"],
      curatedRoot,
    ),
    "chat.agentSkillsLocations": stripManagedVsCodeLocationEntries(
      currentSettings["chat.agentSkillsLocations"],
      curatedRoot,
    ),
    "chat.hookFilesLocations": stripManagedVsCodeLocationEntries(
      currentSettings["chat.hookFilesLocations"],
      curatedRoot,
    ),
    "chat.agentFilesLocations": stripManagedVsCodeLocationEntries(
      currentSettings["chat.agentFilesLocations"],
      curatedRoot,
    ),
    "chat.instructionsFilesLocations": stripManagedVsCodeLocationEntries(
      currentSettings["chat.instructionsFilesLocations"],
      curatedRoot,
    ),
  };

  await patchVsCodeSettings(VSCODE_USER_SETTINGS_PATH, nextSettings);
}

function stripManagedVsCodeLocationEntries(
  value: unknown,
  curatedRoot: string,
): Record<string, boolean> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const normalizedCuratedRoot = toHomePath(curatedRoot);
  return Object.fromEntries(
    Object.entries(value as Record<string, boolean>).filter(
      ([key]) => !key.startsWith(normalizedCuratedRoot),
    ),
  );
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
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-");
}

function toHomePath(pathValue: string): string {
  const userProfile = process.env.USERPROFILE ?? "";
  return userProfile && pathValue.startsWith(userProfile)
    ? pathValue.replace(userProfile, "~").replace(/\\/gu, "/")
    : toPosixPath(pathValue);
}
