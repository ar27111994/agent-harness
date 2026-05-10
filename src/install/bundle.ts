import { join } from "node:path";

import { getRuntimeConfig } from "../config/runtime.js";
import {
  copyPath,
  createContentHash,
  ensureCleanDirectory,
  listFilesRecursive,
  pathExists,
  readBinaryFileOrNull,
  readJsonFile,
  readJsonFileOrNull,
  readJsonLinesFile,
  toPosixPath,
  toRelativePosixPath,
  writeJsonFile,
} from "../files.js";
import { getOptionValue, getOptionValues } from "../lib/cli-options.js";
import {
  resolveSafeMirrorFilePath,
  sanitizeMirrorId,
} from "../lib/safe-paths.js";
import { listHostAdapters } from "../host-adapters/registry.js";
import {
  assertAssetCatalogEntry,
  assertBundleLock,
  assertInstallProgressState,
  assertInstalledBundleManifest,
  assertInstalledPackageManifest,
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
import { getInstallableAssets, sanitizeAssetId } from "./utils.js";

/**
 * Provides install bundles for the lifecycle pipeline.
 */
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
  const allBundleIds = getRegisteredBundleIds();
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
  const bundleIds = targetBundleIds.length > 0 ? targetBundleIds : allBundleIds;
  const bundlePaths = bundleIds.map((bundleId) =>
    join(projectRoot, "mirror", "bundles", `${bundleId}.lock.json`),
  );

  for (const bundlePath of bundlePaths) {
    if (!(await pathExists(bundlePath))) {
      console.warn(
        `Bundle lock not found: ${extractBundleId(bundlePath)} — run mirror locks/acquire first.`,
      );
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
    const alreadyInstalledAssetIdentities = new Set(
      existingRelevantPackages.map((pkg) => buildInstallIdentity(pkg)),
    );
    const installableAssets = getInstallableAssets(
      bundleLock.assets,
      mirrorIndexById,
    );
    const pendingAssets = getPendingAssets(
      installableAssets,
      alreadyInstalledAssetIdentities,
    );
    const assetsToInstall = pendingAssets.slice(
      manualBatchOffset,
      manualBatchOffset + batchSize,
    );

    for (const asset of assetsToInstall) {
      const mirrorEntry = mirrorIndexById.get(asset.mirrorId);
      if (!mirrorEntry) {
        throw new Error(
          `Installable asset is missing mirror index entry: ${asset.mirrorId}`,
        );
      }
      const catalogEntry = selectedEntryById.get(asset.assetId);
      if (!catalogEntry) {
        debugInstallBundleSkip(
          `Skipping ${asset.assetId}: no selected catalog entry found.`,
        );
        continue;
      }

      const sourceMaterialPath = join(
        projectRoot,
        "mirror",
        "raw",
        sanitizeMirrorId(mirrorEntry.mirrorId),
      );
      if (!(await pathExists(sourceMaterialPath))) {
        debugInstallBundleSkip(
          `Skipping ${asset.assetId}: mirror source material missing at ${toPosixPath(sourceMaterialPath)} for ${sanitizeMirrorId(mirrorEntry.mirrorId)}.`,
        );
        continue;
      }

      const mirrorManifest = await verifyMirrorFileManifest(
        sourceMaterialPath,
        mirrorEntry.contentHash,
      );

      const packageRoot = join(
        projectRoot,
        "install",
        bundleLock.host,
        "packages",
        sanitizeAssetId(asset.assetId),
      );
      const filesRoot = join(packageRoot, "files");
      await ensureCleanDirectory(filesRoot);
      await copyMirrorManifestFiles(sourceMaterialPath, filesRoot, mirrorManifest);

      const manifestPath = join(packageRoot, "install-manifest.json");
      const previousPackageManifest =
        await readJsonFileOrNull<InstalledPackageManifest>(
          manifestPath,
          assertInstalledPackageManifest,
        );
      const bundleMembership = [
        ...new Set([
          ...(previousPackageManifest?.bundleMembership ?? []),
          bundleLock.bundleId,
        ]),
      ].sort((left, right) => left.localeCompare(right));
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
        bundleMembership,
        activationEligible: asset.activationEligible,
        activeByDefault: false,
        upstream: {
          mirrorId: mirrorEntry.mirrorId,
          mirroredAt: mirrorEntry.mirroredAt,
          sourceId: catalogEntry.source.sourceId,
          sourceOriginUrl: catalogEntry.source.originUrl,
          sourceLastUpdated: catalogEntry.maintenance.lastUpdated,
          upstream: mirrorEntry.upstream,
        },
        nativeInstall:
          catalogEntry.assetKind === "extension"
            ? {
                extensionId: catalogEntry.install.manifestEntry,
              }
            : undefined,
      };

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
  const packagesByPackagePath = new Map(
    existingPackages.map((pkg) => [sanitizeAssetId(pkg.assetId), pkg]),
  );

  for (const pkg of newPackages) {
    packagesByPackagePath.set(sanitizeAssetId(pkg.assetId), pkg);
  }

  return [...packagesByPackagePath.values()].sort((left, right) =>
    left.assetId.localeCompare(right.assetId),
  );
}

interface MirrorFileManifest {
  schemaVersion: 1;
  aggregateHash: string;
  files: Array<{
    relativePath: string;
    sha256: string;
    sizeBytes: number;
    upstreamBlobSha?: string;
  }>;
}

async function verifyMirrorFileManifest(
  sourceMaterialPath: string,
  expectedAggregateHash: string,
): Promise<MirrorFileManifest> {
  const manifest = await readJsonFileOrNull<MirrorFileManifest>(
    join(sourceMaterialPath, "manifest.json"),
    assertMirrorFileManifest,
  );
  if (!manifest) {
    throw new Error(
      `Mirror artifact is missing manifest.json: ${toPosixPath(sourceMaterialPath)}`,
    );
  }

  const normalizedFiles = [...manifest.files].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  if (!normalizedFiles.some((file) => file.relativePath === "asset.json")) {
    throw new Error("Mirror artifact manifest is missing asset.json");
  }
  for (const file of normalizedFiles) {
    const filePath = resolveSafeMirrorFilePath(
      sourceMaterialPath,
      file.relativePath,
    );
    const content = await readBinaryFileOrNull(filePath);
    if (content === null) {
      throw new Error(`Mirror artifact file is missing: ${file.relativePath}`);
    }

    const actualHash = createContentHash(content);
    const actualSize = content.byteLength;
    if (actualHash !== file.sha256 || actualSize !== file.sizeBytes) {
      throw new Error(`Mirror artifact hash mismatch: ${file.relativePath}`);
    }
  }

  const aggregateHash = createContentHash(
    normalizedFiles.map(serializeMirrorManifestFileHashInput).join("\n"),
  );
  if (aggregateHash !== manifest.aggregateHash) {
    throw new Error("Mirror artifact manifest aggregate hash mismatch");
  }
  if (aggregateHash !== expectedAggregateHash) {
    throw new Error("Mirror artifact hash does not match mirror index");
  }

  await assertNoUnexpectedMirrorFiles(sourceMaterialPath, manifest);

  return manifest;
}

function assertMirrorFileManifest(
  value: unknown,
  context: string,
): asserts value is MirrorFileManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }

  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new Error(`${context}.schemaVersion must be 1`);
  }
  if (typeof record.aggregateHash !== "string") {
    throw new Error(`${context}.aggregateHash must be a string`);
  }
  if (!Array.isArray(record.files)) {
    throw new Error(`${context}.files must be an array`);
  }

  record.files.forEach((file, index) => {
    if (typeof file !== "object" || file === null || Array.isArray(file)) {
      throw new Error(`${context}.files[${index}] must be an object`);
    }

    const fileRecord = file as Record<string, unknown>;
    if (typeof fileRecord.relativePath !== "string") {
      throw new Error(`${context}.files[${index}].relativePath must be a string`);
    }
    if (typeof fileRecord.sha256 !== "string") {
      throw new Error(`${context}.files[${index}].sha256 must be a string`);
    }
    if (typeof fileRecord.sizeBytes !== "number") {
      throw new Error(`${context}.files[${index}].sizeBytes must be a number`);
    }
    if (
      fileRecord.upstreamBlobSha !== undefined &&
      typeof fileRecord.upstreamBlobSha !== "string"
    ) {
      throw new Error(
        `${context}.files[${index}].upstreamBlobSha must be a string`,
      );
    }
  });
}

function serializeMirrorManifestFileHashInput(
  file: MirrorFileManifest["files"][number],
): string {
  return [
    file.relativePath,
    file.sha256,
    String(file.sizeBytes),
    file.upstreamBlobSha ?? "",
  ].join("\0");
}

async function copyMirrorManifestFiles(
  sourceMaterialPath: string,
  filesRoot: string,
  manifest: MirrorFileManifest,
): Promise<void> {
  const relativePathsToCopy = [
    ...manifest.files.map((file) => file.relativePath),
    "manifest.json",
  ];

  for (const relativePath of relativePathsToCopy) {
    await copyPath(
      resolveSafeMirrorFilePath(sourceMaterialPath, relativePath, "read"),
      resolveSafeMirrorFilePath(filesRoot, relativePath, "write"),
    );
  }
}

async function assertNoUnexpectedMirrorFiles(
  sourceMaterialPath: string,
  manifest: MirrorFileManifest,
): Promise<void> {
  const allowedFiles = new Set([
    ...manifest.files.map((file) => file.relativePath),
    "manifest.json",
  ]);
  const actualFiles = await listFilesRecursive(sourceMaterialPath, new Set(), {
    maxDepth: 20,
    maxFiles: 10_000,
    maxBytes: 100_000_000,
  });

  for (const filePath of actualFiles) {
    const relativePath = toRelativePosixPath(sourceMaterialPath, filePath);
    if (!allowedFiles.has(relativePath)) {
      throw new Error(`Mirror artifact contains unexpected file: ${relativePath}`);
    }
  }
}

function debugInstallBundleSkip(message: string): void {
  if (getRuntimeConfig().diagnostics.debugEnabled) {
    process.stderr.write(`[agent-harness:debug] ${message}\n`);
  }
}

function buildInstallIdentity(packageIdentity: {
  assetId: string;
  mirrorId: string;
}): string {
  return `${packageIdentity.assetId}:${packageIdentity.mirrorId}`;
}

function getRegisteredBundleIds(): string[] {
  return [
    ...new Set(
      listHostAdapters().flatMap((adapter) => adapter.defaultBundleIds),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function getPendingAssets(
  bundleAssets: BundleLock["assets"],
  installedAssetIdentities: Set<string>,
): BundleLock["assets"] {
  return bundleAssets.filter(
    (asset) => !installedAssetIdentities.has(buildInstallIdentity(asset)),
  );
}

function extractBundleId(bundlePath: string): string {
  return (
    bundlePath
      .split(/[/\\]/u)
      .at(-1)
      ?.replace(/\.lock\.json$/u, "") ?? bundlePath
  );
}
