import { isAbsolute, join, relative, resolve } from "node:path";

import {
  createDirectoryLink,
  ensureDirectory,
  pathEntryExists,
  pathExists,
  readJsonFile,
  readJsonFileOrNull,
  readTextFileOrNull,
  removeManagedSection,
  removePath,
  upsertManagedSection,
  toPosixPath,
  writeJsonFile,
  writeTextFile,
} from "../files.js";
import { assertWirePlanManifest } from "../manifest-validation.js";
import { sanitizeAssetId } from "../lib/safe-paths.js";
import { readSharedMcpAssetIds } from "../lib/shared-mcp.js";
import {
  applyHostNativeFilePayloads,
  collectHostNativeFilePayloads,
  revertNativeConfigOperations,
  toWorkspaceRelativeConfigPath,
} from "./native-config.js";
import type {
  ActivationManifest,
  AssetCatalogEntry,
  AssetKind,
  InstalledBundleManifest,
  InstalledPackageManifest,
  NativeConfigOperation,
  WirePlanManifest,
  WirePreviewManifest,
} from "../types.js";

const OPENCODE_DIRECTORY_BY_ASSET_KIND: Record<AssetKind, string> = {
  agent: "agents",
  skill: "skills",
  instruction: "instructions",
  workflow: "commands",
  hook: "hooks",
  plugin: "plugins",
  "mcp-server": "mcp-servers",
  extension: "extensions",
  "prompt-pack": "commands",
  "reference-pack": "reference-packs",
};

interface OpenCodeLinkedAsset {
  assetId: string;
  assetKind: AssetKind;
  sourcePath: string;
  linkPath: string;
  linkMode: "directory" | "file";
}

/**
 * Provides wire open code for the lifecycle pipeline.
 */
export async function wireOpenCode(options: {
  projectRoot: string;
  workspaceRoot: string;
  mode: "preview" | "apply" | "reset";
}): Promise<void> {
  const { projectRoot, workspaceRoot, mode } = options;
  const activationRoot = join(projectRoot, "activate", "opencode");
  const localOverlayRoot = join(workspaceRoot, ".opencode");
  const localContextRoot = join(
    localOverlayRoot,
    "context",
    "project-intelligence",
    "agent-harness",
  );
  const localAgentsPath = join(workspaceRoot, "AGENTS.md");
  const previousWirePlan = await readValidatedOpenCodeWirePlan(
    join(localContextRoot, "wire-plan.json"),
    localOverlayRoot,
  );

  const preview: WirePreviewManifest = {
    schemaVersion: 1,
    host: "opencode",
    mode,
    generatedAt: new Date().toISOString(),
    workspaceRoot: toPosixPath(workspaceRoot),
    targetPaths: [
      toPosixPath(localAgentsPath),
      toPosixPath(localContextRoot),
      ...buildOpenCodeLinkRoots(localOverlayRoot),
    ],
    notes: [
      "OpenCode wire-in writes a project-local overlay under .opencode/context/project-intelligence/agent-harness.",
      "Command assets are written as managed .opencode/commands/*.md files; other asset kinds use managed directory links.",
      "The global OpenAgentsControl-managed install is not modified.",
    ],
  };

  await writeJsonFile(
    join(activationRoot, "wire-preview-opencode.json"),
    preview,
  );

  if (mode === "preview") {
    return;
  }

  if (mode === "reset") {
    await revertNativeConfigOperations(
      previousWirePlan?.nativeConfigOperations,
    );
    await removeManagedAgentsSection(localAgentsPath);
    await removeManagedLinks(previousWirePlan?.linkedPaths ?? []);
    await removePath(localContextRoot);
    return;
  }

  await revertNativeConfigOperations(previousWirePlan?.nativeConfigOperations);
  await removeManagedAgentsSection(localAgentsPath);
  await removeManagedLinks(previousWirePlan?.linkedPaths ?? []);
  await ensureDirectory(localContextRoot);

  const activationManifest = await readJsonFileOrNull<ActivationManifest>(
    join(activationRoot, "activation-manifest.json"),
  );
  const sharedMcpAssetIds = await readSharedMcpAssetIdsBestEffort(projectRoot);

  await writeJsonFile(
    join(localContextRoot, "activation-manifest.json"),
    activationManifest ?? {
      schemaVersion: 1,
      host: "opencode",
      generatedAt: new Date().toISOString(),
      activeBundles: [],
      activeAssets: [],
      runtimeRoot: toPosixPath(localContextRoot),
      notes: ["No OpenCode activation manifest was found at apply time."],
    },
  );

  const linkedAssets = await resolveOpenCodeLinkedAssets({
    projectRoot,
    activationRoot,
    activationManifest,
    localOverlayRoot,
  });
  const activeAssets = await loadActiveOpenCodeAssets(
    activationRoot,
    activationManifest,
  );

  const createdLinkPaths: string[] = [];
  try {
    for (const linkedAsset of linkedAssets) {
      await materializeOpenCodeLinkedAsset(linkedAsset);
      createdLinkPaths.push(linkedAsset.linkPath);
    }

    await upsertManagedAgentsSection({
      localAgentsPath,
      localOverlayRoot,
      localContextRoot,
      linkedAssets,
      sharedMcpAssetIds,
    });

    const nativeConfigOperations = await applyOpenCodeNativeConfig({
      workspaceRoot,
      activeAssets,
      linkedAssets,
    });

    const wirePlan: WirePlanManifest = {
      schemaVersion: 1,
      host: "opencode-project",
      generatedAt: new Date().toISOString(),
      workspaceRoot: toPosixPath(workspaceRoot),
      runtimeRoot: toPosixPath(localOverlayRoot),
      linkedPaths: createdLinkPaths.map(toPosixPath),
      mcpServers: sharedMcpAssetIds,
      nativeConfigOperations,
      notes: [
        "Project-local OpenCode overlay written under .opencode/context/project-intelligence/agent-harness.",
        "Selected assets are linked into project-local .opencode installation directories by asset kind.",
        "On Windows, managed directory links are created as junctions for compatibility.",
        "Shared MCP assets are surfaced in the effective OpenCode wire plan when available.",
      ],
    };

    await writeJsonFile(join(localContextRoot, "wire-plan.json"), wirePlan);
  } catch (error) {
    await removeManagedLinksBestEffort(createdLinkPaths);
    throw error;
  }
}

function buildOpenCodeLinkRoots(localOverlayRoot: string): string[] {
  return [...new Set(Object.values(OPENCODE_DIRECTORY_BY_ASSET_KIND))]
    .map((directoryName) => toPosixPath(join(localOverlayRoot, directoryName)))
    .sort((left, right) => left.localeCompare(right));
}

async function resolveOpenCodeLinkedAssets(options: {
  projectRoot: string;
  activationRoot: string;
  activationManifest: ActivationManifest | null;
  localOverlayRoot: string;
}): Promise<OpenCodeLinkedAsset[]> {
  const { projectRoot, activationRoot, activationManifest, localOverlayRoot } =
    options;

  if (!activationManifest) {
    return [];
  }

  const activeAssetIds = new Set(activationManifest.activeAssets);
  const linkedAssets: OpenCodeLinkedAsset[] = [];
  const seenAssetIds = new Set<string>();

  for (const bundleId of activationManifest.activeBundles) {
    const bundleManifestPath = join(
      projectRoot,
      "install",
      "opencode",
      "bundles",
      `${bundleId}.install.json`,
    );
    const bundleManifest =
      await readJsonFileOrNull<InstalledBundleManifest>(bundleManifestPath);

    if (!bundleManifest) {
      continue;
    }

    for (const pkg of bundleManifest.packages) {
      if (!activeAssetIds.has(pkg.assetId) || seenAssetIds.has(pkg.assetId)) {
        continue;
      }

      const packageManifest = await readJsonFile<InstalledPackageManifest>(
        pkg.manifestPath,
      );
      const assetRoot = join(
        activationRoot,
        sanitizeAssetId(packageManifest.assetId),
      );
      const fileLinkedAsset = isOpenCodeFileLinkedAsset(
        packageManifest.assetKind,
      );
      const sourcePath = fileLinkedAsset
        ? join(assetRoot, "content.txt")
        : assetRoot;

      if (!(await pathExists(sourcePath))) {
        continue;
      }

      linkedAssets.push({
        assetId: packageManifest.assetId,
        assetKind: packageManifest.assetKind,
        sourcePath,
        linkMode: fileLinkedAsset ? "file" : "directory",
        linkPath: join(
          localOverlayRoot,
          OPENCODE_DIRECTORY_BY_ASSET_KIND[packageManifest.assetKind],
          fileLinkedAsset
            ? `${sanitizeAssetId(packageManifest.assetId)}.md`
            : sanitizeAssetId(packageManifest.assetId),
        ),
      });
      seenAssetIds.add(pkg.assetId);
    }
  }

  return linkedAssets.sort((left, right) =>
    left.linkPath.localeCompare(right.linkPath),
  );
}

async function loadActiveOpenCodeAssets(
  activationRoot: string,
  activationManifest: ActivationManifest | null,
): Promise<AssetCatalogEntry[]> {
  if (!activationManifest) {
    return [];
  }

  const assets: AssetCatalogEntry[] = [];
  for (const assetId of activationManifest.activeAssets) {
    const asset = await readJsonFileOrNull<AssetCatalogEntry>(
      join(activationRoot, sanitizeAssetId(assetId), "asset.json"),
    );
    if (asset) {
      assets.push(asset);
    }
  }

  return assets.sort((left, right) => left.id.localeCompare(right.id));
}

async function applyOpenCodeNativeConfig(options: {
  workspaceRoot: string;
  activeAssets: AssetCatalogEntry[];
  linkedAssets: OpenCodeLinkedAsset[];
}): Promise<NativeConfigOperation[]> {
  const instructionPaths = options.linkedAssets
    .filter((asset) => asset.assetKind === "instruction")
    .map((asset) =>
      toWorkspaceRelativeConfigPath(options.workspaceRoot, asset.linkPath),
    );
  const payloads = collectHostNativeFilePayloads(
    options.activeAssets,
    "opencode",
  );

  if (instructionPaths.length > 0) {
    payloads.unshift({
      path: "opencode.json",
      format: "json",
      merge: true,
      content: {
        instructions: instructionPaths,
      },
    });
  }

  if (payloads.length === 0) {
    return [];
  }

  return applyHostNativeFilePayloads({
    workspaceRoot: options.workspaceRoot,
    host: "opencode",
    payloads,
  });
}

async function materializeOpenCodeLinkedAsset(
  linkedAsset: OpenCodeLinkedAsset,
): Promise<void> {
  if (linkedAsset.linkMode === "directory") {
    await createDirectoryLink(linkedAsset.linkPath, linkedAsset.sourcePath);
    return;
  }

  if (await pathEntryExists(linkedAsset.linkPath)) {
    throw new Error(
      `Refusing to overwrite existing OpenCode file link for asset ${linkedAsset.assetKind}:${linkedAsset.assetId}: ${toPosixPath(linkedAsset.linkPath)}`,
    );
  }

  const content = await readTextFileOrNull(linkedAsset.sourcePath);
  if (content === null) {
    throw new Error(
      `Cannot materialize OpenCode file link because source content is missing: ${toPosixPath(linkedAsset.sourcePath)} -> ${toPosixPath(linkedAsset.linkPath)}`,
    );
  }

  await writeTextFile(linkedAsset.linkPath, content);
}

function isOpenCodeFileLinkedAsset(assetKind: AssetKind): boolean {
  return (
    assetKind === "instruction" ||
    assetKind === "workflow" ||
    assetKind === "prompt-pack"
  );
}

/**
 * Projects shared MCP references into OpenCode wire plans without failing the
 * project-local apply when shared activation state is stale or malformed.
 */
async function readSharedMcpAssetIdsBestEffort(
  projectRoot: string,
): Promise<string[]> {
  try {
    return await readSharedMcpAssetIds(projectRoot);
  } catch (error) {
    console.warn(
      `Failed to project shared MCP assets into OpenCode wire plan: ${toLoggableErrorMessage(error)}`,
    );
    return [];
  }
}

async function upsertManagedAgentsSection(options: {
  localAgentsPath: string;
  localOverlayRoot: string;
  localContextRoot: string;
  linkedAssets: OpenCodeLinkedAsset[];
  sharedMcpAssetIds: string[];
}): Promise<void> {
  const existingAgentsContent =
    (await readTextFileOrNull(options.localAgentsPath)) ?? "";
  const bodyLines = [
    "# Agent Harness OpenCode overlay",
    "",
    `Managed overlay root: ${toPosixPath(options.localOverlayRoot)}`,
    `Managed context root: ${toPosixPath(options.localContextRoot)}`,
    "",
    "## Linked assets",
    ...(options.linkedAssets.length > 0
      ? options.linkedAssets.map(
          (asset) =>
            `- ${asset.assetId} (${asset.assetKind}) -> ${toPosixPath(asset.linkPath)}`,
        )
      : ["- No active OpenCode assets were found at wire time."]),
    ...(options.sharedMcpAssetIds.length > 0
      ? [
          "",
          "## Shared MCP references",
          ...options.sharedMcpAssetIds.map((assetId) => `- ${assetId}`),
        ]
      : []),
    "",
    "Review generated links before committing project-local host configuration.",
  ];

  await writeTextFile(
    options.localAgentsPath,
    upsertManagedSection({
      originalContent: existingAgentsContent,
      markerId: "agent-harness",
      bodyLines,
    }),
  );
}

async function removeManagedAgentsSection(
  localAgentsPath: string,
): Promise<void> {
  const existingAgentsContent = await readTextFileOrNull(localAgentsPath);

  if (existingAgentsContent === null) {
    return;
  }

  const nextAgentsContent = removeManagedSection({
    originalContent: existingAgentsContent,
    markerId: "agent-harness",
  });
  if (nextAgentsContent.trim().length === 0) {
    await removePath(localAgentsPath);
    return;
  }

  await writeTextFile(localAgentsPath, nextAgentsContent);
}

async function removeManagedLinks(linkedPaths: string[]): Promise<void> {
  for (const linkedPath of linkedPaths) {
    await removePath(linkedPath);
  }
}

async function removeManagedLinksBestEffort(
  linkedPaths: string[],
): Promise<void> {
  for (const linkedPath of linkedPaths) {
    try {
      await removePath(linkedPath);
    } catch (error) {
      console.warn(
        `Failed to roll back managed link ${linkedPath}: ${toLoggableErrorMessage(error)}`,
      );
    }
  }
}

async function readValidatedOpenCodeWirePlan(
  wirePlanPath: string,
  managedRoot: string,
): Promise<WirePlanManifest | null> {
  const wirePlan = await readJsonFileOrNull<unknown>(wirePlanPath);
  if (wirePlan === null) {
    return null;
  }

  assertWirePlanManifest(wirePlan, wirePlanPath);
  const linkedPaths = wirePlan.linkedPaths ?? [];
  for (const linkedPath of linkedPaths) {
    if (!isPathWithinRoot(linkedPath, managedRoot)) {
      throw new Error(
        `Wire plan contains linkedPath outside managed OpenCode root (${toPosixPath(managedRoot)}): ${linkedPath}`,
      );
    }
  }

  return {
    ...wirePlan,
    linkedPaths,
  };
}

function isPathWithinRoot(pathValue: string, rootPath: string): boolean {
  const absoluteRoot = resolve(rootPath);
  const absolutePath = resolve(pathValue);
  const relativePath = relative(absoluteRoot, absolutePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function toLoggableErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  return String(error);
}
