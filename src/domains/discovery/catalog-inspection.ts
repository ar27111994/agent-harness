import { join } from "node:path";

import { getOptionValue } from "../../lib/cli-options.js";
import { readJsonLinesFile } from "../../files.js";
import type { AssetCatalogEntry } from "../../types.js";
import {
  CATALOG_OUTPUT_PATH,
  REJECTED_CATALOG_OUTPUT_PATH,
  SELECTED_CATALOG_OUTPUT_PATH,
} from "./output-paths.js";

export async function printCatalogStats(projectRoot: string): Promise<void> {
  const catalogEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...CATALOG_OUTPUT_PATH),
  );
  const selectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...SELECTED_CATALOG_OUTPUT_PATH),
  );
  const rejectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...REJECTED_CATALOG_OUTPUT_PATH),
  );

  const stats = {
    catalogCount: catalogEntries.length,
    selectedCount: selectedEntries.length,
    rejectedCount: rejectedEntries.length,
    bySource: countBy(catalogEntries, (entry) => entry.source.sourceId),
    byAuthorityTier: countBy(
      catalogEntries,
      (entry) => entry.source.authorityTier,
    ),
    byAssetKind: countBy(catalogEntries, (entry) => entry.assetKind),
    byCompatibility: countBy(
      catalogEntries,
      (entry) => entry.compatibilityMode,
    ),
    byHost: countHostsForCatalog(catalogEntries),
  };

  console.log(JSON.stringify(stats, null, 2));
}

export async function inspectCatalog(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const sourceId = getOptionValue(args, "--source");
  const assetId = getOptionValue(args, "--id");
  const limit = Number(getOptionValue(args, "--limit") ?? "20");
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

function countBy<T>(
  items: T[],
  getKey: (item: T) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
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
