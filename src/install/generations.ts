import { join } from "node:path";

import {
  listFilesRecursive,
  pathExists,
  readJsonFile,
  readJsonFileOrNull,
  removePath,
  toPosixPath,
  writeJsonFile,
} from "../files.js";
import { getOptionValue } from "../lib/cli-options.js";
import {
  assertInstallGenerationManifest,
  assertInstalledPackageManifest,
} from "../manifest-validation.js";
import type {
  BundleLock,
  InstallGenerationManifest,
  InstalledPackageManifest,
} from "../types.js";
import { INSTALL_GENERATIONS_ROOT } from "./paths.js";
import { INSTALL_HOSTS, sanitizeAssetId } from "./utils.js";

const GENERATION_ID_PATTERN = /^[A-Za-z0-9._-]+$/u;

function validateHost(
  value: string | undefined,
): BundleLock["host"] | undefined {
  if (!value) {
    return undefined;
  }
  if (!INSTALL_HOSTS.includes(value as (typeof INSTALL_HOSTS)[number])) {
    throw new Error(
      `Invalid host value: ${value}. Must be one of: ${INSTALL_HOSTS.join(", ")}`,
    );
  }
  return value as BundleLock["host"];
}

function validateGenerationId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (!GENERATION_ID_PATTERN.test(value)) {
    throw new Error(
      `Invalid generation ID: ${value}. Must contain only alphanumeric characters, dots, underscores, and hyphens.`,
    );
  }
  return value;
}

/**
 * Provides diff install state for the lifecycle pipeline.
 */
export async function diffInstallState(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const host = validateHost(getOptionValue(args, "--host"));
  const leftGenerationId = validateGenerationId(getOptionValue(args, "--left"));
  const rightGenerationId = validateGenerationId(
    getOptionValue(args, "--right"),
  );
  const hosts = host ? [host] : INSTALL_HOSTS;

  for (const currentHost of hosts) {
    const leftGeneration = await resolveInstallGenerationManifest(
      projectRoot,
      currentHost,
      leftGenerationId ?? "previous",
    );
    const rightGeneration = await resolveInstallGenerationManifest(
      projectRoot,
      currentHost,
      rightGenerationId ?? "current",
    );

    if (!leftGeneration || !rightGeneration) {
      console.log(`No comparable generations found for ${currentHost}`);
      continue;
    }

    const leftAssets = await loadGenerationAssetIds(leftGeneration);
    const rightAssets = await loadGenerationAssetIds(rightGeneration);
    const bundleDiff = diffStringSets(
      leftGeneration.bundleIds,
      rightGeneration.bundleIds,
    );
    const assetDiff = diffStringSets(leftAssets, rightAssets);

    console.log(
      `Install diff for ${currentHost}: ${leftGeneration.generationId} -> ${rightGeneration.generationId}`,
    );
    console.log(`  Added bundles: ${formatDiffList(bundleDiff.added)}`);
    console.log(`  Removed bundles: ${formatDiffList(bundleDiff.removed)}`);
    console.log(`  Added assets: ${formatDiffList(assetDiff.added)}`);
    console.log(`  Removed assets: ${formatDiffList(assetDiff.removed)}`);
  }
}

/**
 * Provides explain installed asset for the lifecycle pipeline.
 */
export async function explainInstalledAsset(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const assetId = getOptionValue(args, "--asset") ?? args[0];

  if (!assetId) {
    throw new Error("explain requires --asset <assetId>");
  }

  const lines: string[] = [];

  for (const host of INSTALL_HOSTS) {
    const packageManifestPath = join(
      projectRoot,
      "install",
      host,
      "packages",
      sanitizeAssetId(assetId),
      "install-manifest.json",
    );
    const packageManifest = await readJsonFileOrNull<InstalledPackageManifest>(
      packageManifestPath,
      assertInstalledPackageManifest,
    );

    if (!packageManifest) {
      continue;
    }

    const currentGeneration = await resolveInstallGenerationManifest(
      projectRoot,
      host,
      "current",
    );
    const isInCurrentGeneration =
      currentGeneration?.packageManifestPaths.includes(
        toPosixPath(packageManifestPath),
      ) ?? false;
    lines.push(`Host ${host}: installed via ${packageManifest.mirrorId}`);
    lines.push(`  bundles: ${packageManifest.bundleMembership.join(", ")}`);
    lines.push(`  files: ${packageManifest.filesRoot}`);
    lines.push(
      `  active generation: ${isInCurrentGeneration ? (currentGeneration?.generationId ?? "current") : "not active"}`,
    );
  }

  if (lines.length === 0) {
    console.log(`Asset ${assetId} is not installed in any host bundle.`);
    return;
  }

  console.log(`Install explain for ${assetId}`);
  console.log(lines.join("\n"));
}

/**
 * Provides manage install generations for the lifecycle pipeline.
 */
export async function manageInstallGenerations(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const [subcommand = "list"] = args;

  switch (subcommand) {
    case "list":
      await listInstallGenerations(projectRoot, args.slice(1));
      return;
    case "pin":
      await pinInstallGeneration(projectRoot, args.slice(1), true);
      return;
    case "unpin":
      await pinInstallGeneration(projectRoot, args.slice(1), false);
      return;
    case "prune":
      await pruneInstallGenerations(projectRoot, args.slice(1));
      return;
    default:
      throw new Error(`Unknown install generations command '${subcommand}'`);
  }
}

async function listInstallGenerations(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const host = validateHost(getOptionValue(args, "--host"));
  const hosts = host ? [host] : INSTALL_HOSTS;

  for (const currentHost of hosts) {
    const manifests = await listGenerationManifests(projectRoot, currentHost);
    console.log(`Install generations for ${currentHost}:`);
    for (const manifest of manifests) {
      console.log(
        `  ${manifest.generationId}${manifest.pinned ? " [pinned]" : ""} bundles=${manifest.bundleIds.length} packages=${manifest.packageManifestPaths.length}`,
      );
    }
  }
}

async function pinInstallGeneration(
  projectRoot: string,
  args: string[],
  pinned: boolean,
): Promise<void> {
  const host = validateHost(getOptionValue(args, "--host"));
  const generationId = validateGenerationId(
    getOptionValue(args, "--generation"),
  );
  const reason = getOptionValue(args, "--reason");

  if (!host || !generationId) {
    throw new Error("generations pin/unpin requires --host and --generation");
  }

  const generationPath = join(
    projectRoot,
    ...INSTALL_GENERATIONS_ROOT,
    host,
    `${generationId}.json`,
  );
  const generationManifest = await readJsonFile<InstallGenerationManifest>(
    generationPath,
    assertInstallGenerationManifest,
  );
  generationManifest.pinned = pinned;
  generationManifest.pinReason = pinned
    ? (reason ?? "Pinned manually")
    : undefined;
  await writeJsonFile(generationPath, generationManifest);

  const currentGenerationPath = join(
    projectRoot,
    ...INSTALL_GENERATIONS_ROOT,
    host,
    "current.json",
  );
  const currentGeneration = await readJsonFileOrNull<InstallGenerationManifest>(
    currentGenerationPath,
    assertInstallGenerationManifest,
  );

  if (currentGeneration?.generationId === generationManifest.generationId) {
    currentGeneration.pinned = generationManifest.pinned;
    currentGeneration.pinReason = generationManifest.pinReason;
    await writeJsonFile(currentGenerationPath, currentGeneration);
  }

  console.log(
    `${pinned ? "Pinned" : "Unpinned"} generation ${generationId} for ${host}`,
  );
}

async function pruneInstallGenerations(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const host = validateHost(getOptionValue(args, "--host"));
  const keepRaw = Number(getOptionValue(args, "--keep") ?? "2");
  const keep =
    Number.isFinite(keepRaw) && keepRaw >= 0
      ? Math.min(Math.floor(keepRaw), Number.MAX_SAFE_INTEGER)
      : 2;
  const hosts = host ? [host] : INSTALL_HOSTS;

  for (const currentHost of hosts) {
    const currentGeneration = await resolveInstallGenerationManifest(
      projectRoot,
      currentHost,
      "current",
    );
    const manifests = await listGenerationManifests(projectRoot, currentHost);
    const keepGenerationIds = new Set(
      manifests
        .filter((manifest) => manifest.pinned)
        .map((manifest) => manifest.generationId),
    );

    if (currentGeneration) {
      keepGenerationIds.add(currentGeneration.generationId);
    }

    for (const manifest of manifests.slice(0, Math.max(keep, 0))) {
      keepGenerationIds.add(manifest.generationId);
    }

    for (const manifest of manifests) {
      if (keepGenerationIds.has(manifest.generationId)) {
        continue;
      }

      await removePath(
        join(
          projectRoot,
          ...INSTALL_GENERATIONS_ROOT,
          currentHost,
          `${manifest.generationId}.json`,
        ),
      );
    }

    console.log(
      `Pruned install generations for ${currentHost}; kept ${keepGenerationIds.size}`,
    );
  }
}

async function listGenerationManifests(
  projectRoot: string,
  host: BundleLock["host"],
): Promise<InstallGenerationManifest[]> {
  const generationsRoot = join(projectRoot, ...INSTALL_GENERATIONS_ROOT, host);
  if (!(await pathExists(generationsRoot))) {
    return [];
  }

  const generationFiles = (await listFilesRecursive(generationsRoot))
    .filter((filePath) => filePath.endsWith(".json"))
    .filter((filePath) => !filePath.endsWith("current.json"))
    .filter((filePath) => !filePath.endsWith("previous.json"));

  const manifests = await Promise.all(
    generationFiles.map((filePath) =>
      readJsonFile<InstallGenerationManifest>(
        filePath,
        assertInstallGenerationManifest,
      ),
    ),
  );

  return manifests.sort((left, right) =>
    right.generationId.localeCompare(left.generationId),
  );
}

async function resolveInstallGenerationManifest(
  projectRoot: string,
  host: BundleLock["host"],
  generationId: string,
): Promise<InstallGenerationManifest | null> {
  const fileName = `${generationId}.json`;
  const generationPath = join(
    projectRoot,
    ...INSTALL_GENERATIONS_ROOT,
    host,
    fileName,
  );

  return readJsonFileOrNull<InstallGenerationManifest>(
    generationPath,
    assertInstallGenerationManifest,
  );
}

async function loadGenerationAssetIds(
  generation: InstallGenerationManifest,
): Promise<string[]> {
  const packageManifests = await Promise.all(
    generation.packageManifestPaths.map(async (manifestPath) => {
      try {
        const manifest = await readJsonFileOrNull<InstalledPackageManifest>(
          manifestPath,
          assertInstalledPackageManifest,
        );
        return manifest;
      } catch {
        return null;
      }
    }),
  );

  return packageManifests
    .filter(
      (manifest): manifest is InstalledPackageManifest => manifest !== null,
    )
    .map((manifest) => manifest.assetId)
    .sort((left, right) => left.localeCompare(right));
}

function diffStringSets(
  left: string[],
  right: string[],
): { added: string[]; removed: string[] } {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  return {
    added: [...rightSet]
      .filter((value) => !leftSet.has(value))
      .sort((a, b) => a.localeCompare(b)),
    removed: [...leftSet]
      .filter((value) => !rightSet.has(value))
      .sort((a, b) => a.localeCompare(b)),
  };
}

function formatDiffList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}
