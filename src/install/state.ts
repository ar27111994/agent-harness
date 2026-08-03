import { join } from "node:path";

import {
  ensureDirectory,
  listFilesRecursive,
  pathExists,
  readJsonFile,
  readJsonFileOrNull,
  readJsonLinesFile,
  removePath,
  toPosixPath,
  writeJsonFile,
  writeJsonFileWithSnapshot,
} from "../files.js";
import {
  assertBundleLock,
  assertInstallProgressState,
  assertInstalledBundleManifest,
  assertMirrorIndexEntry,
} from "../manifest-validation.js";
import type {
  BundleLock,
  InstallGenerationManifest,
  InstallProgressState,
  InstalledBundleManifest,
  MirrorIndexEntry,
} from "../types.js";
import {
  INSTALL_GENERATIONS_ROOT,
  INSTALL_PROGRESS_SNAPSHOT_OUTPUT_PATH,
  INSTALL_PROGRESS_STATE_OUTPUT_PATH,
} from "./paths.js";
import { getInstallableAssets, INSTALL_HOSTS } from "./utils.js";

/**
 * Updates update install progress state state with the provided inputs.
 */
export async function updateInstallProgressState(
  projectRoot: string,
  bundleId: string,
  host: BundleLock["host"],
  batchSize: number,
  allAssets: BundleLock["assets"],
  installedAssets: InstalledBundleManifest["packages"],
  lastBatchAssetIds: string[],
  skippedAssetIds: string[] = [],
): Promise<void> {
  const currentState = (await readJsonFileOrNull<InstallProgressState>(
    join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH),
    assertInstallProgressState,
  )) ?? {
    schemaVersion: 1,
    updatedAt: new Date(0).toISOString(),
    bundles: {},
  };

  currentState.updatedAt = new Date().toISOString();
  const uniqueInstalled = [
    ...new Set(installedAssets.map((asset) => asset.assetId)),
  ];
  const uniqueSkipped = [...new Set(skippedAssetIds)];
  // Merge with previously skipped IDs, then remove any that are now
  // installed or no longer part of this bundle (prevents stale entries).
  const allAssetIds = new Set(allAssets.map((asset) => asset.assetId));
  const previousSkipped =
    currentState.bundles[bundleId]?.skippedAssetIds ?? [];
  const mergedSkipped = [
    ...new Set([...previousSkipped, ...uniqueSkipped]),
  ].filter(
    (id) => !uniqueInstalled.includes(id) && allAssetIds.has(id),
  );
  currentState.bundles[bundleId] = {
    host,
    batchSize,
    totalAssets: allAssets.length,
    installedAssets: uniqueInstalled.length,
    remainingAssets: Math.max(
      0,
      allAssets.length - uniqueInstalled.length - mergedSkipped.length,
    ),
    lastBatchAssetIds: lastBatchAssetIds.filter(
      (id) => !uniqueSkipped.includes(id),
    ),
    skippedAssetIds: mergedSkipped,
  };

  await writeJsonFileWithSnapshot(
    join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH),
    join(projectRoot, ...INSTALL_PROGRESS_SNAPSHOT_OUTPUT_PATH),
    currentState,
  );
}

/**
 * Reconciles reconcile install state state from persisted manifests.
 */
export async function reconcileInstallState(
  projectRoot: string,
  hostFilter?: string,
): Promise<void> {
  const mirrorIndexEntries = await readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, "mirror", "index.jsonl"),
    assertMirrorIndexEntry,
  );
  const mirrorIndexById = new Map(
    mirrorIndexEntries.map((entry) => [entry.mirrorId, entry]),
  );
  const reconciledState: InstallProgressState = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    bundles: {},
  };

  const effectiveHosts = hostFilter
    ? [hostFilter]
    : [...INSTALL_HOSTS];

  for (const host of effectiveHosts) {
    const bundlesRoot = join(projectRoot, "install", host, "bundles");
    if (!(await pathExists(bundlesRoot))) {
      continue;
    }

    const bundleManifestPaths = (await listFilesRecursive(bundlesRoot)).filter(
      (filePath) => filePath.endsWith(".install.json"),
    );

    for (const bundleManifestPath of bundleManifestPaths) {
      const bundleManifest = await readJsonFile<InstalledBundleManifest>(
        bundleManifestPath,
        assertInstalledBundleManifest,
      );
      const bundleLockPath = join(
        projectRoot,
        "mirror",
        "bundles",
        `${bundleManifest.bundleId}.lock.json`,
      );
      const bundleLock = (await readJsonFileOrNull<BundleLock>(
        bundleLockPath,
        assertBundleLock,
      )) ?? {
        schemaVersion: 1,
        bundleId: bundleManifest.bundleId,
        generatedAt: new Date(0).toISOString(),
        host,
        assets: [],
      };
      const installableAssets = getInstallableAssets(
        bundleLock.assets,
        mirrorIndexById,
      );
      const currentBundleAssetIds = new Set(
        installableAssets.map((asset) => asset.assetId),
      );
      const uniqueInstalledAssetIds = [
        ...new Set(
          bundleManifest.packages
            .map((pkg) => pkg.assetId)
            .filter((assetId) => currentBundleAssetIds.has(assetId)),
        ),
      ];

      reconciledState.bundles[bundleManifest.bundleId] = {
        host,
        batchSize: Math.min(250, uniqueInstalledAssetIds.length),
        totalAssets: installableAssets.length,
        installedAssets: uniqueInstalledAssetIds.length,
        remainingAssets: Math.max(
          0,
          installableAssets.length - uniqueInstalledAssetIds.length,
        ),
        lastBatchAssetIds: uniqueInstalledAssetIds.slice(
          -Math.min(50, uniqueInstalledAssetIds.length),
        ),
        skippedAssetIds: [],
      };
    }
  }

  await ensureDirectory(join(projectRoot, "state", "install"));
  await writeJsonFileWithSnapshot(
    join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH),
    join(projectRoot, ...INSTALL_PROGRESS_SNAPSHOT_OUTPUT_PATH),
    reconciledState,
  );
  await writeInstallGenerations(projectRoot, reconciledState);
  console.log(
    `Install progress reconciled at ${toPosixPath(join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH))}`,
  );
}

/**
 * Resets reset install state state and generated outputs.
 */
export async function resetInstallState(
  projectRoot: string,
  hostFilter?: string,
): Promise<void> {
  if (hostFilter) {
    await removePath(join(projectRoot, "install", hostFilter));
    await removePath(join(projectRoot, "state", "install", hostFilter));
    console.log(
      `Install state for '${hostFilter}' reset under ${toPosixPath(join(projectRoot, "install", hostFilter))}`,
    );
  } else {
    await removePath(join(projectRoot, "install"));
    await removePath(join(projectRoot, "state", "install"));
    console.log(
      `Install state reset under ${toPosixPath(join(projectRoot, "install"))}`,
    );
  }
}

/**
 * Writes install generations to project state.
 */
export async function writeInstallGenerations(
  projectRoot: string,
  progressState: InstallProgressState,
): Promise<void> {
  const generationId = new Date().toISOString().replace(/[:.]/gu, "-");

  for (const host of INSTALL_HOSTS) {
    const bundleIds = Object.entries(progressState.bundles)
      .filter(([, bundleState]) => bundleState.host === host)
      .map(([bundleId]) => bundleId)
      .sort((left, right) => left.localeCompare(right));

    const packageManifestPaths: string[] = [];

    for (const bundleId of bundleIds) {
      const bundleManifestPath = join(
        projectRoot,
        "install",
        host,
        "bundles",
        `${bundleId}.install.json`,
      );
      const bundleManifest = await readJsonFileOrNull<InstalledBundleManifest>(
        bundleManifestPath,
        assertInstalledBundleManifest,
      );
      if (!bundleManifest) {
        continue;
      }

      const bundleLockPath = join(
        projectRoot,
        "mirror",
        "bundles",
        `${bundleId}.lock.json`,
      );
      const bundleLock = await readJsonFileOrNull<BundleLock>(
        bundleLockPath,
        assertBundleLock,
      );
      const currentBundleAssetIds = new Set(
        (bundleLock?.assets ?? []).map((asset) => asset.assetId),
      );

      for (const pkg of bundleManifest.packages) {
        if (currentBundleAssetIds.has(pkg.assetId)) {
          packageManifestPaths.push(pkg.manifestPath);
        }
      }
    }

    const generationManifest: InstallGenerationManifest = {
      schemaVersion: 1,
      generationId,
      host,
      generatedAt: new Date().toISOString(),
      bundleIds,
      packageManifestPaths: [...new Set(packageManifestPaths)].sort(
        (left, right) => left.localeCompare(right),
      ),
    };

    await ensureDirectory(join(projectRoot, ...INSTALL_GENERATIONS_ROOT, host));
    const currentGenerationPath = join(
      projectRoot,
      ...INSTALL_GENERATIONS_ROOT,
      host,
      "current.json",
    );
    await writeJsonFile(
      join(
        projectRoot,
        ...INSTALL_GENERATIONS_ROOT,
        host,
        `${generationId}.json`,
      ),
      generationManifest,
    );
    await writeJsonFileWithSnapshot(
      currentGenerationPath,
      join(projectRoot, ...INSTALL_GENERATIONS_ROOT, host, "previous.json"),
      generationManifest,
    );
  }
}
