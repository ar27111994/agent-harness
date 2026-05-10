import { join } from "node:path";

import { getRuntimeConfig } from "../config/runtime.js";
import {
  readJsonFileOrNull,
  readJsonLinesFile,
  toPosixPath,
  writeJsonFile,
} from "../files.js";
import { getOptionValue } from "../lib/cli-options.js";
import {
  assertAssetCatalogEntry,
  assertBundleLock,
  assertInstallGenerationManifest,
  assertInstallProgressState,
  assertInstalledPackageManifest,
  assertMirrorAcquireState,
  assertMirrorIndexEntry,
} from "../manifest-validation.js";
import type {
  AssetCatalogEntry,
  BundleLock,
  InstallGenerationManifest,
  InstallProgressState,
  InstallRefreshAssetStatus,
  InstallRefreshHostSummary,
  InstallRefreshPolicy,
  InstallRefreshPolicyDecision,
  InstallRefreshReport,
  InstalledPackageManifest,
  MirrorAcquireState,
  MirrorIndexEntry,
} from "../types.js";
import { acquireMirrorArtifacts } from "../mirror/acquire.js";
import { MIRROR_ACQUIRE_STATE_OUTPUT_PATH } from "../mirror/constants.js";
import { sanitizeMirrorId } from "../mirror/paths.js";
import { installBundles } from "./bundle.js";
import {
  INSTALL_GENERATIONS_ROOT,
  INSTALL_PROGRESS_STATE_OUTPUT_PATH,
  INSTALL_REFRESH_REPORT_OUTPUT_PATH,
} from "./paths.js";
import { INSTALL_HOSTS } from "./utils.js";

const MAX_REFRESH_BATCHES = 200;
const INSTALL_REFRESH_POLICIES = [
  "manual",
  "report-only",
  "apply-safe",
] as const satisfies readonly InstallRefreshPolicy[];

/**
 * Generates or applies install refresh state for the lifecycle pipeline.
 */
export async function manageInstallRefresh(
  projectRoot: string,
  workingDirectory: string,
  args: string[],
): Promise<void> {
  const requestedHost = parseInstallHost(getOptionValue(args, "--host"));
  const hosts = requestedHost ? [requestedHost] : [...INSTALL_HOSTS];
  const refreshPolicy = getRuntimeConfig().install.refreshPolicy;
  const applyRequested = args.includes("--apply");
  const refreshedMirrorState = !args.includes("--no-mirror-refresh");

  if (refreshedMirrorState) {
    await refreshMirrorState(projectRoot, workingDirectory);
  }

  let report = await buildInstallRefreshReport(
    projectRoot,
    hosts,
    refreshPolicy,
    refreshedMirrorState,
  );
  await writeJsonFile(join(projectRoot, ...INSTALL_REFRESH_REPORT_OUTPUT_PATH), report);
  printInstallRefreshReport(projectRoot, report, false);

  if (!applyRequested) {
    return;
  }

  const bundleIdsToRefresh = [...new Set(
    report.hosts.flatMap((host) =>
      host.assets
        .filter((asset) => asset.status === "stale" && asset.policyDecision === "apply")
        .flatMap((asset) => asset.bundleIds),
    ),
  )].sort((left, right) => left.localeCompare(right));

  if (bundleIdsToRefresh.length === 0) {
    console.log("No stale install bundles were eligible for refresh apply.");
    return;
  }

  await applyBundleRefreshes(projectRoot, bundleIdsToRefresh);

  report = await buildInstallRefreshReport(
    projectRoot,
    hosts,
    refreshPolicy,
    refreshedMirrorState,
  );
  await writeJsonFile(join(projectRoot, ...INSTALL_REFRESH_REPORT_OUTPUT_PATH), report);
  printInstallRefreshReport(projectRoot, report, true);
}

function parseInstallHost(value: string | undefined): (typeof INSTALL_HOSTS)[number] | undefined {
  if (!value) {
    return undefined;
  }

  if (!INSTALL_HOSTS.includes(value as (typeof INSTALL_HOSTS)[number])) {
    throw new Error(
      `Invalid --host value '${value}'. Must be one of: ${INSTALL_HOSTS.join(", ")}`,
    );
  }

  return value as (typeof INSTALL_HOSTS)[number];
}

async function refreshMirrorState(
  projectRoot: string,
  workingDirectory: string,
): Promise<void> {
  const batchSize = String(getRuntimeConfig().batches.mirrorAcquire);

  for (let batchIndex = 0; batchIndex < MAX_REFRESH_BATCHES; batchIndex += 1) {
    await acquireMirrorArtifacts(projectRoot, workingDirectory, [
      "--refresh",
      "--batch-size",
      batchSize,
    ]);
    const acquireState = await readJsonFileOrNull<MirrorAcquireState>(
      join(projectRoot, ...MIRROR_ACQUIRE_STATE_OUTPUT_PATH),
      assertMirrorAcquireState,
    );
    if (acquireState?.terminal) {
      return;
    }
  }

  throw new Error("mirror refresh did not complete within the maximum batch count");
}

async function buildInstallRefreshReport(
  projectRoot: string,
  hosts: readonly (typeof INSTALL_HOSTS)[number][],
  refreshPolicy: InstallRefreshPolicy,
  refreshedMirrorState: boolean,
): Promise<InstallRefreshReport> {
  const mirrorIndexEntries = await readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, "mirror", "index.jsonl"),
    assertMirrorIndexEntry,
  );
  const mirrorIndexById = new Map(
    mirrorIndexEntries.map((entry) => [entry.mirrorId, entry]),
  );

  const hostSummaries = await Promise.all(
    hosts.map((host) =>
      buildInstallRefreshHostSummary(
        projectRoot,
        host,
        refreshPolicy,
        mirrorIndexById,
      ),
    ),
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policy: refreshPolicy,
    refreshedMirrorState,
    hosts: hostSummaries,
  };
}

async function buildInstallRefreshHostSummary(
  projectRoot: string,
  host: (typeof INSTALL_HOSTS)[number],
  refreshPolicy: InstallRefreshPolicy,
  mirrorIndexById: Map<string, MirrorIndexEntry>,
): Promise<InstallRefreshHostSummary> {
  const currentGeneration = await readJsonFileOrNull<InstallGenerationManifest>(
    join(projectRoot, ...INSTALL_GENERATIONS_ROOT, host, "current.json"),
    assertInstallGenerationManifest,
  );
  if (!currentGeneration) {
    return {
      host,
      pinnedGeneration: false,
      assetCount: 0,
      staleCount: 0,
      pinnedCount: 0,
      blockedCount: 0,
      currentCount: 0,
      assets: [],
    };
  }

  const bundleLocks = await Promise.all(
    currentGeneration.bundleIds.map(async (bundleId) => {
      const bundleLock = await readJsonFileOrNull<BundleLock>(
        join(projectRoot, "mirror", "bundles", `${bundleId}.lock.json`),
        assertBundleLock,
      );
      return bundleLock;
    }),
  );
  const bundleAssetsByAssetId = new Map<
    string,
    { mirrorId: string; bundleIds: string[] }
  >();
  for (const bundleLock of bundleLocks) {
    if (!bundleLock) {
      continue;
    }
    for (const asset of bundleLock.assets) {
      const existing = bundleAssetsByAssetId.get(asset.assetId);
      if (existing) {
        existing.bundleIds = [...new Set([...existing.bundleIds, bundleLock.bundleId])].sort(
          (left, right) => left.localeCompare(right),
        );
        existing.mirrorId = asset.mirrorId;
      } else {
        bundleAssetsByAssetId.set(asset.assetId, {
          mirrorId: asset.mirrorId,
          bundleIds: [bundleLock.bundleId],
        });
      }
    }
  }

  const packageManifests = await Promise.all(
    currentGeneration.packageManifestPaths.map((manifestPath) =>
      readJsonFileOrNull<InstalledPackageManifest>(
        manifestPath,
        assertInstalledPackageManifest,
      ),
    ),
  );
  const assets = (
    await Promise.all(
      packageManifests
        .filter(
          (manifest): manifest is InstalledPackageManifest => manifest !== null,
        )
        .map((manifest) =>
          buildInstallRefreshAssetStatus(
            projectRoot,
            host,
            manifest,
            currentGeneration.pinned ?? false,
            bundleAssetsByAssetId,
            mirrorIndexById,
            refreshPolicy,
          ),
        ),
    )
  ).sort((left, right) => left.assetId.localeCompare(right.assetId));

  return {
    host,
    pinnedGeneration: currentGeneration.pinned ?? false,
    assetCount: assets.length,
    staleCount: assets.filter((asset) => asset.status === "stale").length,
    pinnedCount: assets.filter((asset) => asset.status === "pinned").length,
    blockedCount: assets.filter((asset) => asset.status === "blocked").length,
    currentCount: assets.filter((asset) => asset.status === "current").length,
    assets,
  };
}

async function buildInstallRefreshAssetStatus(
  projectRoot: string,
  host: (typeof INSTALL_HOSTS)[number],
  manifest: InstalledPackageManifest,
  pinnedGeneration: boolean,
  bundleAssetsByAssetId: Map<string, { mirrorId: string; bundleIds: string[] }>,
  mirrorIndexById: Map<string, MirrorIndexEntry>,
  refreshPolicy: InstallRefreshPolicy,
): Promise<InstallRefreshAssetStatus> {
  const latestBundleAsset = bundleAssetsByAssetId.get(manifest.assetId);
  const latestMirrorEntry = latestBundleAsset
    ? mirrorIndexById.get(latestBundleAsset.mirrorId)
    : undefined;
  const latestCatalogEntry = latestMirrorEntry
    ? await readJsonFileOrNull<AssetCatalogEntry>(
        join(
          projectRoot,
          "mirror",
          "raw",
          sanitizeMirrorId(latestMirrorEntry.mirrorId),
          "asset.json",
        ),
        assertAssetCatalogEntry,
      )
    : null;

  let status: InstallRefreshAssetStatus["status"];
  let reason: string;

  if (pinnedGeneration) {
    status = "pinned";
    reason = "Current install generation is pinned.";
  } else if (!latestBundleAsset) {
    status = "blocked";
    reason = "Asset is no longer present in the current bundle lock set.";
  } else if (latestBundleAsset.mirrorId !== manifest.mirrorId) {
    status = "stale";
    reason = `Installed mirror ${manifest.mirrorId} differs from latest mirror ${latestBundleAsset.mirrorId}.`;
  } else {
    status = "current";
    reason = "Installed mirror matches the latest bundle lock mirror.";
  }

  return {
    assetId: manifest.assetId,
    host,
    bundleIds: latestBundleAsset?.bundleIds ?? [...manifest.bundleMembership],
    assetKind: manifest.assetKind,
    status,
    policyDecision: decideInstallRefreshPolicy(status, refreshPolicy),
    pinned: pinnedGeneration,
    reason,
    installedMirrorId: manifest.mirrorId,
    latestMirrorId: latestBundleAsset?.mirrorId,
    installedFingerprint: manifest.upstream,
    latestFingerprint:
      latestMirrorEntry && latestCatalogEntry
        ? {
            mirrorId: latestMirrorEntry.mirrorId,
            mirroredAt: latestMirrorEntry.mirroredAt,
            sourceId: latestCatalogEntry.source.sourceId,
            sourceOriginUrl: latestCatalogEntry.source.originUrl,
            sourceLastUpdated: latestCatalogEntry.maintenance.lastUpdated,
            upstream: latestMirrorEntry.upstream,
          }
        : undefined,
    nativeInstall:
      manifest.nativeInstall?.extensionId && status === "stale"
        ? {
            extensionId: manifest.nativeInstall.extensionId,
            operation: "install",
          }
        : undefined,
  };
}

function decideInstallRefreshPolicy(
  status: InstallRefreshAssetStatus["status"],
  refreshPolicy: InstallRefreshPolicy,
): InstallRefreshPolicyDecision {
  if (status === "current") {
    return "ignore";
  }
  if (status === "pinned") {
    return "ignore";
  }
  if (status === "blocked" || status === "unknown") {
    return "notify";
  }
  if (refreshPolicy === "manual") {
    return "notify";
  }
  if (refreshPolicy === "report-only") {
    return "plan";
  }
  return "apply";
}

async function applyBundleRefreshes(
  projectRoot: string,
  bundleIds: readonly string[],
): Promise<void> {
  const batchSize = String(getRuntimeConfig().batches.installBundle);

  for (const bundleId of bundleIds) {
    for (let batchIndex = 0; batchIndex < MAX_REFRESH_BATCHES; batchIndex += 1) {
      await installBundles(projectRoot, ["--bundle", bundleId, "--batch-size", batchSize]);
      const progressState = await readJsonFileOrNull<InstallProgressState>(
        join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH),
        assertInstallProgressState,
      );
      const bundleState = progressState?.bundles[bundleId];
      if (bundleState && bundleState.remainingAssets <= 0) {
        break;
      }
      if (batchIndex === MAX_REFRESH_BATCHES - 1) {
        throw new Error(
          `install refresh did not complete bundle '${bundleId}' within the maximum batch count`,
        );
      }
    }
  }
}

function printInstallRefreshReport(
  projectRoot: string,
  report: InstallRefreshReport,
  applied: boolean,
): void {
  const outputPath = toPosixPath(join(projectRoot, ...INSTALL_REFRESH_REPORT_OUTPUT_PATH));
  console.log(
    `${applied ? "Updated" : "Wrote"} install refresh report to ${outputPath}`,
  );
  for (const host of report.hosts) {
    console.log(
      `  ${host.host}: assets=${host.assetCount} stale=${host.staleCount} pinned=${host.pinnedCount} blocked=${host.blockedCount} current=${host.currentCount}`,
    );
  }
}

/**
 * Exposes the supported install refresh policy values for CLI/config validation.
 */
export const installRefreshPolicies = [...INSTALL_REFRESH_POLICIES];
