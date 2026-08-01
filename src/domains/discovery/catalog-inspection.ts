import { join } from "node:path";

import { getOptionValue } from "../../lib/cli-options.js";
import { readJsonLinesFile, pathExists } from "../../files.js";
import type { AssetCatalogEntry } from "../../types.js";
import { countBy } from "./catalog-utils.js";
import {
  CATALOG_OUTPUT_PATH,
  REJECTED_CATALOG_OUTPUT_PATH,
  SELECTED_CATALOG_OUTPUT_PATH,
} from "./output-paths.js";

/**
 * Provides print catalog stats for the lifecycle pipeline.
 *
 * When the raw catalog file (catalog.assets.jsonl) is missing but the selected
 * catalog exists, breakdowns are built from the selected + rejected catalogs
 * so that `discover stats` shows meaningful data. Ticket: #398.
 */
export async function printCatalogStats(projectRoot: string): Promise<void> {
  const catalogFilePath = join(projectRoot, ...CATALOG_OUTPUT_PATH);
  const catalogFileExists = await pathExists(catalogFilePath);
  const catalogEntries =
    await readJsonLinesFile<AssetCatalogEntry>(catalogFilePath);
  const selectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...SELECTED_CATALOG_OUTPUT_PATH),
  );
  const rejectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...REJECTED_CATALOG_OUTPUT_PATH),
  );

  const { breakdownEntries, catalogSource } = resolveBreakdownEntries(
    catalogFileExists,
    catalogEntries,
    selectedEntries,
    rejectedEntries,
  );

  const stats = {
    catalogCount: catalogEntries.length,
    selectedCount: selectedEntries.length,
    rejectedCount: rejectedEntries.length,
    catalogSource,
    bySource: countBy(breakdownEntries, (entry) => entry.source.sourceId),
    byAuthorityTier: countBy(
      breakdownEntries,
      (entry) => entry.source.authorityTier,
    ),
    byAssetKind: countBy(breakdownEntries, (entry) => entry.assetKind),
    byCompatibility: countBy(
      breakdownEntries,
      (entry) => entry.compatibilityMode,
    ),
    byHost: countHostsForCatalog(breakdownEntries),
  };

  console.log(JSON.stringify(stats, null, 2));
}

/**
 * Provides inspect catalog for the lifecycle pipeline.
 */
export async function inspectCatalog(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const sourceId = getOptionValue(args, "--source");
  const assetId = getOptionValue(args, "--id");
  const limitOption = getOptionValue(args, "--limit");
  const trimmedLimitOption = limitOption?.trim();
  const parsedLimit = trimmedLimitOption
    ? /^\d+$/u.test(trimmedLimitOption)
      ? Number.parseInt(trimmedLimitOption, 10)
      : Number.NaN
    : 20;
  const catalogEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...CATALOG_OUTPUT_PATH),
  );

  let matches = catalogEntries;

  if (sourceId) {
    matches = matches.filter((entry) => entry.source.sourceId === sourceId);
  }

  if (assetId) {
    matches = matches.filter((entry) => entry.id === assetId);
  }

  const limit =
    Number.isInteger(parsedLimit) && parsedLimit >= 0
      ? Math.min(parsedLimit, matches.length)
      : Math.min(20, matches.length);

  console.log(
    JSON.stringify(
      {
        totalMatches: matches.length,
        sourceId: sourceId ?? null,
        assetId: assetId ?? null,
        results: matches.slice(0, limit),
      },
      null,
      2,
    ),
  );
}

function countHostsForCatalog(
  entries: AssetCatalogEntry[],
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const entry of entries) {
    for (const host of entry.hosts) {
      counts[host] = (counts[host] ?? 0) + 1;
    }
  }

  return counts;
}

/**
 * Resolves the breakdown entries and their source label for catalog stats.
 *
 * When the raw catalog is empty but selected/rejected catalogs exist,
 * uses the combined selection as the breakdown source so operators see
 * meaningful distributions instead of empty maps. Ticket: #398.
 */
export function resolveBreakdownEntries(
  catalogFileExists: boolean,
  catalogEntries: AssetCatalogEntry[],
  selectedEntries: AssetCatalogEntry[],
  rejectedEntries: AssetCatalogEntry[],
): {
  breakdownEntries: AssetCatalogEntry[];
  catalogSource: string;
} {
  // Distinguish "file absent" (fall back) from "file exists but is empty" (use empty).
  const breakdownEntries = catalogFileExists
    ? catalogEntries
    : [...selectedEntries, ...rejectedEntries];
  const catalogSource = catalogFileExists ? "raw-catalog" : "selected+rejected";
  return { breakdownEntries, catalogSource };
}

/**
 * Provide internals for unit testing.
 */
export const catalogInspectionInternals = {
  resolveBreakdownEntries,
  countHostsForCatalog,
};
