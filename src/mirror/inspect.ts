import { join } from "node:path";

import {
  readJsonFile,
  readJsonFileOrNull,
  readJsonLinesFile,
  readTextFileOrNull,
  toPosixPath,
} from "../files.js";
import { getOptionValue } from "../lib/cli-options.js";
import {
  assertAssetCatalogEntry,
  assertMirrorIndexEntry,
} from "../manifest-validation.js";
import type {
  AssetCatalogEntry,
  BundleLock,
  MirrorIndexEntry,
  SelectionReport,
} from "../types.js";
import {
  REJECTED_CATALOG_OUTPUT_PATH,
  SELECTION_REPORT_OUTPUT_PATH,
} from "../domains/discovery/output-paths.js";
import {
  MIRROR_INDEX_OUTPUT_PATH,
  MIRROR_INDEX_SNAPSHOT_PATH,
} from "./constants.js";
import { sanitizeMirrorId } from "./paths.js";

/**
 * Provides diff mirror index for the lifecycle pipeline.
 */
export async function diffMirrorIndex(projectRoot: string): Promise<void> {
  const currentEntries = await readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, ...MIRROR_INDEX_OUTPUT_PATH),
    assertMirrorIndexEntry,
  );
  const previousEntries = await readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, ...MIRROR_INDEX_SNAPSHOT_PATH),
    assertMirrorIndexEntry,
  );
  const previousByAssetId = new Map(
    previousEntries.map((entry) => [entry.assetId, entry]),
  );
  const currentByAssetId = new Map(
    currentEntries.map((entry) => [entry.assetId, entry]),
  );
  const added = currentEntries
    .filter((entry) => !previousByAssetId.has(entry.assetId))
    .map((entry) => entry.assetId)
    .sort();
  const removed = previousEntries
    .filter((entry) => !currentByAssetId.has(entry.assetId))
    .map((entry) => entry.assetId)
    .sort();
  const changed = currentEntries
    .filter((entry) => {
      const previous = previousByAssetId.get(entry.assetId);
      return (
        previous &&
        (previous.mirrorId !== entry.mirrorId ||
          previous.status !== entry.status)
      );
    })
    .map((entry) => entry.assetId)
    .sort();

  console.log("Mirror index diff: previous -> current");
  console.log(`  Added assets: ${formatDiffList(added)}`);
  console.log(`  Removed assets: ${formatDiffList(removed)}`);
  console.log(`  Changed assets: ${formatDiffList(changed)}`);
}

/**
 * Provides explain mirror artifact for the lifecycle pipeline.
 */
export async function explainMirrorArtifact(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const requestedAssetId = getOptionValue(args, "--asset") ?? args[0];
  const requestedMirrorId = getOptionValue(args, "--mirror");
  if (!requestedAssetId && !requestedMirrorId) {
    throw new Error("mirror explain requires --asset or --mirror");
  }

  const entries = await readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, ...MIRROR_INDEX_OUTPUT_PATH),
    assertMirrorIndexEntry,
  );
  const entry = entries.find(
    (candidate) =>
      candidate.assetId === requestedAssetId ||
      candidate.mirrorId === requestedMirrorId,
  );
  if (!entry) {
    throw new Error("No matching mirror artifact found.");
  }

  const rawRoot = join(
    projectRoot,
    "mirror",
    "raw",
    sanitizeMirrorId(entry.mirrorId),
  );
  const manifest = await readJsonFileOrNull<unknown>(
    join(rawRoot, "manifest.json"),
  );
  const contentPreview = (
    await readTextFileOrNull(join(rawRoot, "content.txt"))
  )?.slice(0, 4000);

  console.log(
    JSON.stringify(
      {
        mirrorIndex: entry,
        rawRoot: toPosixPath(rawRoot),
        manifest,
        contentPreview: contentPreview ?? null,
      },
      null,
      2,
    ),
  );
}

/**
 * Explains why assets are included in a bundle lock.
 */
export async function explainBundleLock(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const bundleId = getOptionValue(args, "--bundle") ?? args[0];
  const json = args.includes("--json");
  if (!bundleId) {
    throw new Error("bundle explain requires --bundle <bundleId> or a positional bundle ID");
  }

  const bundleLock = await readJsonFile<BundleLock>(
    join(projectRoot, "mirror", "bundles", `${bundleId}.lock.json`),
  );
  const selectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
    assertAssetCatalogEntry,
  ).catch(() => []);
  const selectedById = new Map(
    selectedEntries.map((entry) => [entry.id, entry] as const),
  );
  const rejectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...REJECTED_CATALOG_OUTPUT_PATH),
    assertAssetCatalogEntry,
  ).catch(() => []);
  const rejectedById = new Map(
    rejectedEntries.map((entry) => [entry.id, entry] as const),
  );
  const selectionReport = await readJsonFileOrNull<SelectionReport>(
    join(projectRoot, ...SELECTION_REPORT_OUTPUT_PATH),
  );
  const mirrorIndex = await readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, ...MIRROR_INDEX_OUTPUT_PATH),
    assertMirrorIndexEntry,
  ).catch(() => []);
  const mirrorById = new Map(
    mirrorIndex.map((entry) => [entry.mirrorId, entry] as const),
  );
  const explanation = {
    bundleId: bundleLock.bundleId,
    host: bundleLock.host,
    assetCount: bundleLock.assets.length,
    assets: bundleLock.assets.map((asset) => {
      const catalogEntry = selectedById.get(asset.assetId);
      const rejectedEntry = rejectedById.get(asset.assetId);
      const mirrorEntry = mirrorById.get(asset.mirrorId);

      return {
        assetId: asset.assetId,
        mirrorId: asset.mirrorId,
        projectionType: asset.projectionType,
        activationEligible: asset.activationEligible,
        notes: asset.notes,
        selected: catalogEntry !== undefined,
        rejected: rejectedEntry !== undefined,
        assetKind: catalogEntry?.assetKind ?? rejectedEntry?.assetKind ?? "unknown",
        compatibilityMode:
          catalogEntry?.compatibilityMode ??
          rejectedEntry?.compatibilityMode ??
          "unknown",
        sourceId:
          catalogEntry?.source.sourceId ??
          rejectedEntry?.source.sourceId ??
          "unknown",
        sourceAuthorityTier:
          catalogEntry?.source.authorityTier ??
          rejectedEntry?.source.authorityTier ??
          mirrorEntry?.source.authorityTier,
        mirrorStatus: mirrorEntry?.status ?? "unresolved",
        reason: buildBundleInclusionReason({
          asset,
          selectedEntry: catalogEntry,
          rejectedEntry,
          mirrorEntry,
          selectionReport,
        }),
      };
    }),
  };

  if (json) {
    console.log(JSON.stringify(explanation, null, 2));
    return;
  }

  console.log(`Bundle: ${explanation.bundleId}`);
  console.log(`  host: ${explanation.host}`);
  console.log(`  assets: ${explanation.assetCount}`);
  for (const asset of explanation.assets) {
    console.log(`  - ${asset.assetId}`);
    console.log(`    projection: ${asset.projectionType}`);
    console.log(
      `    activation eligible: ${asset.activationEligible ? "yes" : "no"}`,
    );
    console.log(`    asset kind: ${asset.assetKind}`);
    console.log(`    compatibility: ${asset.compatibilityMode}`);
    console.log(`    source: ${asset.sourceId}`);
    console.log(`    trust: ${asset.sourceAuthorityTier ?? "unknown"}`);
    console.log(`    mirror: ${asset.mirrorStatus} (${asset.mirrorId})`);
    console.log(`    reason: ${asset.reason}`);
  }
}

function buildBundleInclusionReason(input: {
  asset: BundleLock["assets"][number];
  selectedEntry: AssetCatalogEntry | undefined;
  rejectedEntry: AssetCatalogEntry | undefined;
  mirrorEntry: MirrorIndexEntry | undefined;
  selectionReport: SelectionReport | null;
}): string {
  const catalogEntry = input.selectedEntry ?? input.rejectedEntry;
  if (!catalogEntry) {
    return "Bundle lock references an asset that is no longer in the selected or rejected catalog outputs.";
  }

  const parts = [
    input.selectedEntry
      ? `${catalogEntry.assetKind} selected for ${catalogEntry.hosts.join(", ")}`
      : `${catalogEntry.assetKind} was rejected before bundle generation`,
    `${catalogEntry.source.authorityTier} source`,
    `projection ${input.asset.projectionType}`,
  ];
  const duplicateDecision = input.selectionReport?.duplicateDecisions.find(
    (decision) => decision.rejectedAssetIds.includes(catalogEntry.id),
  );

  if (duplicateDecision) {
    parts.push(
      `rejected as duplicate of ${duplicateDecision.selectedAssetId}: ${duplicateDecision.selectionReason}`,
    );
  }
  if (!input.asset.activationEligible) {
    parts.push("mirrored for audit only because activation is not eligible");
  }
  if (!input.mirrorEntry) {
    parts.push("waiting for mirror acquisition to resolve the artifact id");
  } else {
    parts.push(`mirror status ${input.mirrorEntry.status}`);
  }

  return parts.join("; ");
}

function formatDiffList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}
