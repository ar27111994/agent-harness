import { join } from "node:path";

import {
  readJsonFile,
  readJsonLinesFile,
  toPosixPath,
  writeJsonFile,
} from "../files.js";
import {
  assertAssetCatalogEntry,
  assertMirrorPolicy,
} from "../manifest-validation.js";
import type {
  AssetCatalogEntry,
  BundleLock,
  BundleLockAsset,
  MirrorIndexEntry,
  MirrorPolicy,
} from "../types.js";

/**
 * Generates bundle locks artifacts for the lifecycle pipeline.
 */
export async function generateBundleLocks(projectRoot: string): Promise<void> {
  const policy = await readJsonFile<MirrorPolicy>(
    join(projectRoot, "mirror", "policy.json"),
    assertMirrorPolicy,
  );
  const selectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
    assertAssetCatalogEntry,
  );
  const mirrorEligibleEntries = selectedEntries.filter(
    (entry) => entry.status.mirrorEligible,
  );

  for (const bundleTemplate of policy.bundleTemplates) {
    const bundleAssets = mirrorEligibleEntries
      .filter((entry) =>
        shouldIncludeEntryInBundle(
          entry,
          bundleTemplate.id,
          bundleTemplate.host,
          bundleTemplate.assetKinds,
        ),
      )
      .map((entry) => createBundleLockAsset(entry, bundleTemplate.id))
      .filter(
        (asset, index, assets) =>
          assets.findIndex(
            (candidate) => candidate.assetId === asset.assetId,
          ) === index,
      )
      .sort((left, right) => left.assetId.localeCompare(right.assetId));

    const bundleLock: BundleLock = {
      schemaVersion: 1,
      bundleId: bundleTemplate.id,
      generatedAt: new Date().toISOString(),
      host: bundleTemplate.host,
      assets: bundleAssets,
    };

    await writeJsonFile(
      join(projectRoot, "mirror", "bundles", `${bundleTemplate.id}.lock.json`),
      bundleLock,
    );
  }

  console.log(
    `Bundle locks written to ${toPosixPath(join(projectRoot, "mirror", "bundles"))}`,
  );
}

/**
 * Resolves bundle locks from the provided inputs.
 */
export async function resolveBundleLocks(
  projectRoot: string,
  mirrorIndexEntries: MirrorIndexEntry[],
  bundleIds: readonly string[],
): Promise<void> {
  const mirrorIdByAssetId = new Map(
    mirrorIndexEntries.map((entry) => [entry.assetId, entry.mirrorId]),
  );
  const bundlePaths = bundleIds.map((bundleId) =>
    join(projectRoot, "mirror", "bundles", `${bundleId}.lock.json`),
  );

  for (const bundlePath of bundlePaths) {
    const bundleLock = await readJsonFile<BundleLock>(bundlePath);
    const resolvedAssets = bundleLock.assets.map((asset) => ({
      ...asset,
      mirrorId: mirrorIdByAssetId.get(asset.assetId) ?? asset.mirrorId,
    }));

    await writeJsonFile(bundlePath, {
      ...bundleLock,
      assets: resolvedAssets,
    });
  }
}

function shouldIncludeEntryInBundle(
  entry: AssetCatalogEntry,
  bundleId: string,
  bundleHost: BundleLock["host"],
  allowedAssetKinds: string[],
): boolean {
  if (!allowedAssetKinds.includes(entry.assetKind)) {
    return false;
  }

  if (bundleId === "community-stable") {
    return (
      entry.source.sourceId === "local-antigravity-manifest" &&
      entry.install.method === "local-file"
    );
  }

  if (bundleId === "copilot-core") {
    if (!entry.hosts.includes("copilot-vscode")) {
      return false;
    }

    if (entry.assetKind === "skill") {
      return (
        entry.source.authorityTier === "official-first-party" &&
        entry.fit.portfolioFit >= 0.3
      );
    }

    return true;
  }

  if (bundleId === "shared-mcp") {
    return entry.hosts.includes("shared") || entry.assetKind === "mcp-server";
  }

  if (bundleHost === "shared") {
    return entry.hosts.includes("shared");
  }

  return entry.hosts.includes(bundleHost);
}

function createBundleLockAsset(
  entry: AssetCatalogEntry,
  bundleId: string,
): BundleLockAsset {
  return {
    assetId: entry.id,
    mirrorId: `unresolved:${entry.id}`,
    projectionType: determineProjectionType(entry, bundleId),
    activationEligible: entry.status.activationEligible,
    notes: entry.status.activationEligible
      ? "Resolve exact upstream artifact and replace unresolved mirrorId during raw mirror acquisition."
      : "Asset is mirrored for audit only and will not activate until explicitly promoted.",
  };
}

function determineProjectionType(
  entry: AssetCatalogEntry,
  bundleId: string,
): string {
  if (bundleId === "shared-mcp") {
    return "shared-mcp-candidate";
  }

  if (entry.compatibilityMode === "native") {
    return `native-${entry.assetKind}`;
  }

  return `adapted-${entry.assetKind}`;
}
