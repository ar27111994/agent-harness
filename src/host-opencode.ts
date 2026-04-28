import { join } from "node:path";

import {
  createDirectoryLink,
  ensureDirectory,
  pathExists,
  readJsonFile,
  readJsonFileOrNull,
  readTextFileOrNull,
  removeManagedSection,
  removePath,
  toPosixPath,
  writeJsonFile,
  writeTextFile,
} from "./files.js";
import type {
  ActivationManifest,
  AssetKind,
  InstalledBundleManifest,
  InstalledPackageManifest,
  WirePlanManifest,
  WirePreviewManifest,
} from "./types.js";

const OPENCODE_DIRECTORY_BY_ASSET_KIND: Record<AssetKind, string> = {
  agent: "agents",
  skill: "skills",
  instruction: "instructions",
  workflow: "workflows",
  hook: "hooks",
  plugin: "plugins",
  "mcp-server": "mcp-servers",
  extension: "extensions",
  "prompt-pack": "prompt-packs",
  "reference-pack": "reference-packs",
};

interface OpenCodeLinkedAsset {
  assetId: string;
  assetKind: AssetKind;
  sourcePath: string;
  linkPath: string;
}

export async function wireOpenCode(options: {
  projectRoot: string;
  workspaceRoot: string;
  mode: "preview" | "apply" | "reset";
}): Promise<void> {
  const { projectRoot, workspaceRoot, mode } = options;
  const activationRoot = join(projectRoot, "activate", "opencode");
  const activationManifest = await readJsonFileOrNull<ActivationManifest>(
    join(activationRoot, "activation-manifest.json"),
  );

  const localOverlayRoot = join(workspaceRoot, ".opencode");
  const localContextRoot = join(
    localOverlayRoot,
    "context",
    "project-intelligence",
    "agent-harness",
  );
  const localAgentsPath = join(workspaceRoot, "AGENTS.md");
  const previousWirePlan = await readJsonFileOrNull<WirePlanManifest>(
    join(localContextRoot, "wire-plan.json"),
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
      "Selected assets are exposed through managed directory links under .opencode/<asset-kind>/.",
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
    await removeManagedAgentsSection(localAgentsPath);
    await removeManagedLinks(previousWirePlan?.linkedPaths ?? []);
    await removePath(localContextRoot);
    return;
  }

  await removeManagedAgentsSection(localAgentsPath);
  await removeManagedLinks(previousWirePlan?.linkedPaths ?? []);
  await ensureDirectory(localContextRoot);

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

  for (const linkedAsset of linkedAssets) {
    await createDirectoryLink(linkedAsset.linkPath, linkedAsset.sourcePath);
  }

  const wirePlan: WirePlanManifest = {
    schemaVersion: 1,
    host: "opencode-project",
    generatedAt: new Date().toISOString(),
    workspaceRoot: toPosixPath(workspaceRoot),
    runtimeRoot: toPosixPath(localOverlayRoot),
    linkedPaths: linkedAssets.map((linkedAsset) =>
      toPosixPath(linkedAsset.linkPath),
    ),
    notes: [
      "Project-local OpenCode overlay written under .opencode/context/project-intelligence/agent-harness.",
      "Selected assets are linked into project-local .opencode installation directories by asset kind.",
      "On Windows, managed directory links are created as junctions for compatibility.",
    ],
  };

  await writeJsonFile(join(localContextRoot, "wire-plan.json"), wirePlan);
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
      const sourcePath = join(
        activationRoot,
        sanitizeAssetId(packageManifest.assetId),
      );

      if (!(await pathExists(sourcePath))) {
        continue;
      }

      linkedAssets.push({
        assetId: packageManifest.assetId,
        assetKind: packageManifest.assetKind,
        sourcePath,
        linkPath: join(
          localOverlayRoot,
          OPENCODE_DIRECTORY_BY_ASSET_KIND[packageManifest.assetKind],
          sanitizeAssetId(packageManifest.assetId),
        ),
      });
      seenAssetIds.add(pkg.assetId);
    }
  }

  return linkedAssets.sort((left, right) =>
    left.linkPath.localeCompare(right.linkPath),
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
  await writeTextFile(localAgentsPath, nextAgentsContent);
}

async function removeManagedLinks(linkedPaths: string[]): Promise<void> {
  for (const linkedPath of linkedPaths) {
    await removePath(linkedPath);
  }
}

function sanitizeAssetId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-");
}
