import { join } from "node:path";

import { readJsonLinesFile, toPosixPath, writeJsonFile } from "../../files.js";
import { assertAssetCatalogEntry } from "../../manifest-validation.js";
import type {
  AssetCatalogEntry,
  AssetQueryMetadata,
  EnvironmentIndexAsset,
  EnvironmentIndexReport,
} from "../../types.js";
import {
  ENVIRONMENT_INDEX_OUTPUT_PATH,
  SELECTED_CATALOG_OUTPUT_PATH,
} from "./output-paths.js";

/**
 * Writes the experimental read-only environment index for selected assets.
 */
export async function writeEnvironmentIndex(
  projectRoot: string,
  args: string[] = [],
): Promise<EnvironmentIndexReport> {
  const json = args.includes("--json");
  const selectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...SELECTED_CATALOG_OUTPUT_PATH),
    assertAssetCatalogEntry,
  );
  const report = buildEnvironmentIndexReport(selectedEntries);
  const outputPath = join(projectRoot, ...ENVIRONMENT_INDEX_OUTPUT_PATH);
  await writeJsonFile(outputPath, report);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `Experimental environment index written to ${toPosixPath(outputPath)} (${report.selectedAssetCount} assets)`,
    );
  }

  return report;
}

/**
 * Builds the experimental read-only environment index from selected assets.
 */
export function buildEnvironmentIndexReport(
  selectedEntries: readonly AssetCatalogEntry[],
): EnvironmentIndexReport {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    experimental: true,
    selectedAssetCount: selectedEntries.length,
    assets: selectedEntries.map(buildEnvironmentIndexAsset),
    notes: [
      "Experimental read-only index for future query/retrieval flows.",
      "This artifact does not change mirror, install, activation, or wire behavior.",
    ],
  };
}

function buildEnvironmentIndexAsset(
  entry: AssetCatalogEntry,
): EnvironmentIndexAsset {
  const metadata = entry.queryMetadata ?? deriveQueryMetadata(entry);

  return {
    assetId: entry.id,
    displayName: entry.displayName,
    assetKind: entry.assetKind,
    hosts: [...entry.hosts].sort(),
    symbolicHandle: metadata.symbolicHandle,
    retrievalFacets: [...new Set(metadata.retrievalFacets)].sort(),
    chunkingHints: metadata.chunkingHints,
    citation: metadata.citation,
    safetyFlags: [...new Set(metadata.safetyFlags)].sort(),
  };
}

function deriveQueryMetadata(entry: AssetCatalogEntry): AssetQueryMetadata {
  return {
    symbolicHandle: createSymbolicHandle(entry),
    retrievalFacets: buildRetrievalFacets(entry),
    chunkingHints: {
      preferredStrategy: chooseChunkingStrategy(entry),
      maxPromptWeight: entry.contextCost.estimatedPromptWeight,
    },
    citation: {
      provenance: `${entry.source.authorityTier}:${entry.source.sourceKind}`,
      sourceUrl: entry.source.originUrl,
      sourceId: entry.source.sourceId,
    },
    safetyFlags: buildSafetyFlags(entry),
  };
}

function createSymbolicHandle(entry: AssetCatalogEntry): string {
  return [entry.source.sourceId, entry.assetKind, entry.id]
    .join(":")
    .replace(/[^a-zA-Z0-9:_-]+/gu, "-")
    .toLowerCase();
}

function buildRetrievalFacets(entry: AssetCatalogEntry): string[] {
  return [
    entry.assetKind,
    entry.compatibilityMode,
    ...entry.hosts,
    ...entry.capabilities,
  ].filter((facet) => facet.trim().length > 0);
}

function chooseChunkingStrategy(
  entry: AssetCatalogEntry,
): AssetQueryMetadata["chunkingHints"]["preferredStrategy"] {
  if (entry.evidence.filePath) {
    return "file";
  }
  if (entry.contextCost.sizeClass === "large") {
    return "section";
  }
  return "document";
}

function buildSafetyFlags(entry: AssetCatalogEntry): string[] {
  const flags: string[] = [];
  if (entry.risk.hasExecScripts) {
    flags.push("exec-scripts");
  }
  if (entry.risk.hasHooks) {
    flags.push("hooks");
  }
  if (entry.risk.requiresNetwork) {
    flags.push("network");
  }
  if (!entry.status.activationEligible) {
    flags.push("not-activation-eligible");
  }
  if (entry.source.authorityTier === "unverified-community") {
    flags.push("unverified-community");
  }

  return flags;
}
