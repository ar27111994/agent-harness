import { join } from "node:path";

import {
  copyPath,
  pathExists,
  readJsonFile,
  readJsonFileOrNull,
  readJsonLinesFile,
  toPosixPath,
  writeJsonFile,
} from "../files.js";
import { getOptionValue, getOptionValues } from "../lib/cli-options.js";
import {
  assertAssetCatalogEntry,
  assertBundleLock,
  assertInstallProgressState,
  assertInstalledBundleManifest,
  assertMirrorIndexEntry,
} from "../manifest-validation.js";
import type {
  AssetCatalogEntry,
  BundleLock,
  InstallProgressState,
  InstalledBundleManifest,
  InstalledPackageManifest,
  MirrorIndexEntry,
} from "../types.js";
import { INSTALL_PROGRESS_STATE_OUTPUT_PATH } from "./paths.js";
import {
  updateInstallProgressState,
  writeInstallGenerations,
} from "./state.js";
import {
  getInstallableAssets,
  sanitizeAssetId,
  sanitizeMirrorId,
} from "./utils.js";

export async function installBundles(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const mirrorIndexEntries = await readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, "mirror", "index.jsonl"),
    assertMirrorIndexEntry,
  );
  const mirrorIndexById = new Map(
    mirrorIndexEntries.map((entry) => [entry.mirrorId, entry]),
  );
  const selectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
    assertAssetCatalogEntry,
  );
  const selectedEntryById = new Map(
    selectedEntries.map((entry) => [entry.id, entry]),
  );
  const allBundlePaths = [
    join(projectRoot, "mirror", "bundles", "opencode-global.lock.json"),
    join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
    join(projectRoot, "mirror", "bundles", "shared-mcp.lock.json"),
    join(projectRoot, "mirror", "bundles", "community-stable.lock.json"),
  ];
  const targetBundleIds = getOptionValues(args, "--bundle");
  const batchSizeRaw = Number(getOptionValue(args, "--batch-size") ?? "250");
  const batchSize =
    Number.isFinite(batchSizeRaw) && batchSizeRaw >= 1
      ? Math.min(Math.floor(batchSizeRaw), Number.MAX_SAFE_INTEGER)
      : 250;
  const manualBatchOffsetRaw = Number(getOptionValue(args, "--offset") ?? "0");
  const manualBatchOffset =
    Number.isFinite(manualBatchOffsetRaw) && manualBatchOffsetRaw >= 0
      ? Math.min(Math.floor(manualBatchOffsetRaw), Number.MAX_SAFE_INTEGER)
      : 0;
  const bundlePaths =
    targetBundleIds.length > 0
      ? allBundlePaths.filter((bundlePath) =>
          targetBundleIds.includes(extractBundleId(bundlePath)),
        )
      : allBundlePaths;

  for (const bundlePath of bundlePaths) {
    if (!(await pathExists(bundlePath))) {
      continue;
    }

    const bundleLock = await readJsonFile<BundleLock>(
      bundlePath,
      assertBundleLock,
    );
    const packageManifests: InstalledBundleManifest["packages"] = [];
    const currentBundleAssetIds = new Set(
      bundleLock.assets.map((asset) => asset.assetId),
    );
    const existingBundleManifest =
      await readJsonFileOrNull<InstalledBundleManifest>(
        join(
          projectRoot,
          "install",
          bundleLock.host,
          "bundles",
          `${bundleLock.bundleId}.install.json`,
        ),
        assertInstalledBundleManifest,
      );
    const existingRelevantPackages = (
      existingBundleManifest?.packages ?? []
    ).filter((pkg) => currentBundleAssetIds.has(pkg.assetId));
    const alreadyInstalledAssetIds = new Set(
      existingRelevantPackages.map((pkg) => pkg.assetId),
    );
    const installableAssets = getInstallableAssets(
      bundleLock.assets,
      mirrorIndexById,
    );
    const pendingAssets = getPendingAssets(
      installableAssets,
      alreadyInstalledAssetIds,
    );
    const assetsToInstall = pendingAssets.slice(
      manualBatchOffset,
      manualBatchOffset + batchSize,
    );

    for (const asset of assetsToInstall) {
      const mirrorEntry = mirrorIndexById.get(asset.mirrorId);
      if (!mirrorEntry) {
        continue;
      }

      if (mirrorEntry.status === "quarantined") {
        continue;
      }

      const catalogEntry = selectedEntryById.get(asset.assetId);
      if (!catalogEntry) {
        continue;
      }

      const sourceMaterialPath = join(
        projectRoot,
        "mirror",
        "raw",
        sanitizeMirrorId(mirrorEntry.mirrorId),
      );
      if (!(await pathExists(sourceMaterialPath))) {
        continue;
      }

      const packageRoot = join(
        projectRoot,
        "install",
        bundleLock.host,
        "packages",
        sanitizeAssetId(asset.assetId),
      );
      const filesRoot = join(packageRoot, "files");
      await copyPath(sourceMaterialPath, filesRoot);

      const packageManifest: InstalledPackageManifest = {
        schemaVersion: 1,
        assetId: asset.assetId,
        mirrorId: asset.mirrorId,
        host: bundleLock.host,
        installedAt: new Date().toISOString(),
        projectionType: asset.projectionType,
        assetKind: catalogEntry.assetKind,
        sourceAuthorityTier: catalogEntry.source.authorityTier,
        contextCost: catalogEntry.contextCost,
        portfolioFit: catalogEntry.fit.portfolioFit,
        filesRoot: toPosixPath(filesRoot),
        bundleMembership: [bundleLock.bundleId],
        activationEligible: asset.activationEligible,
        activeByDefault: false,
      };

      const manifestPath = join(packageRoot, "install-manifest.json");
      await writeJsonFile(manifestPath, packageManifest);
      packageManifests.push({
        assetId: asset.assetId,
        mirrorId: asset.mirrorId,
        manifestPath: toPosixPath(manifestPath),
      });
    }

    const bundleManifest: InstalledBundleManifest = {
      schemaVersion: 1,
      bundleId: bundleLock.bundleId,
      host: bundleLock.host,
      installedAt: new Date().toISOString(),
      packages: mergeInstalledPackages(
        existingRelevantPackages,
        packageManifests,
      ),
    };

    await writeJsonFile(
      join(
        projectRoot,
        "install",
        bundleLock.host,
        "bundles",
        `${bundleLock.bundleId}.install.json`,
      ),
      bundleManifest,
    );

    await updateInstallProgressState(
      projectRoot,
      bundleLock.bundleId,
      bundleLock.host,
      batchSize,
      installableAssets,
      bundleManifest.packages,
      assetsToInstall.map((asset) => asset.assetId),
    );
  }

  const progressState = await readJsonFileOrNull<InstallProgressState>(
    join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH),
    assertInstallProgressState,
  );
  if (progressState) {
    await writeInstallGenerations(projectRoot, progressState);
  }

  console.log(
    `Installed bundles written under ${toPosixPath(join(projectRoot, "install"))}`,
  );
}

function mergeInstalledPackages(
  existingPackages: InstalledBundleManifest["packages"],
  newPackages: InstalledBundleManifest["packages"],
): InstalledBundleManifest["packages"] {
  const packagesByAssetId = new Map(
    existingPackages.map((pkg) => [pkg.assetId, pkg]),
  );

  for (const pkg of newPackages) {
    packagesByAssetId.set(pkg.assetId, pkg);
  }

  return [...packagesByAssetId.values()].sort((left, right) =>
    left.assetId.localeCompare(right.assetId),
  );
}

function getPendingAssets(
  bundleAssets: BundleLock["assets"],
  installedAssetIds: Set<string>,
): BundleLock["assets"] {
  return bundleAssets.filter((asset) => !installedAssetIds.has(asset.assetId));
}

function extractBundleId(bundlePath: string): string {
  return (
    bundlePath
      .split(/[/\\]/u)
      .at(-1)
      ?.replace(/\.lock\.json$/u, "") ?? bundlePath
  );
}
