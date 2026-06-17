import { join } from "node:path";
import { stat } from "node:fs/promises";

import { getRuntimeConfig } from "../../config/runtime.js";
import { writeJsonFile, readJsonFileOrNull } from "../../files.js";
import {
  CATALOG_INDEX_OUTPUT_PATH,
  CATALOG_INDEX_META_OUTPUT_PATH,
} from "./output-paths.js";

// ─── Types ─────────────────────────────────────────────────────────────────

/** Lightweight metadata written alongside catalog-index.jsonl. */
export interface CatalogIndexMeta {
  /**
   * ISO-8601 timestamp of when the full index was last successfully written.
   * Used by staleness checks without reading the full JSONL.
   */
  builtAt: string;
  /**
   * Total number of entries written to the index at build time.
   * Informational — not used for freshness decisions.
   */
  entryCount: number;
}

// ─── Staleness helpers ──────────────────────────────────────────────────────

/**
 * Returns `true` when a fresh `catalog-index.jsonl` exists on disk and its
 * age is within the configured `discoveryIndexMaxAgeDays` threshold.
 *
 * Falls back to checking the JSONL mtime when the meta file is absent so
 * that indexes written before this feature existed are still recognised.
 */
export async function isCatalogIndexFresh(
  projectRoot: string,
): Promise<boolean> {
  const maxAgeDays = getRuntimeConfig().discovery.discoveryIndexMaxAgeDays;
  const indexPath = join(projectRoot, ...CATALOG_INDEX_OUTPUT_PATH);

  // Prefer the lightweight meta file — avoids reading the full JSONL.
  const metaPath = join(projectRoot, ...CATALOG_INDEX_META_OUTPUT_PATH);
  const meta = await readJsonFileOrNull<CatalogIndexMeta>(
    metaPath,
    assertCatalogIndexMeta,
  );

  let builtAt: Date;

  if (meta != null) {
    // Meta exists but the JSONL snapshot itself may be absent (e.g. deleted
    // manually). Verify the index file is actually on disk before trusting
    // the timestamp in meta.
    try {
      await stat(indexPath);
    } catch {
      return false;
    }
    builtAt = new Date(meta.builtAt);
  } else {
    // Fall back to JSONL mtime — handles pre-meta indexes.
    try {
      const indexStat = await stat(indexPath);
      builtAt = indexStat.mtime;
    } catch {
      // JSONL absent — index is not fresh.
      return false;
    }
  }

  const ageMs = Date.now() - builtAt.getTime();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  return ageMs <= maxAgeMs;
}

/**
 * Writes a `catalog-index-meta.json` file recording the build timestamp and
 * entry count. Called by `syncIndexedSourcesForIndex` after the JSONL is written.
 */
export async function writeCatalogIndexMeta(
  projectRoot: string,
  entryCount: number,
): Promise<void> {
  const meta: CatalogIndexMeta = {
    builtAt: new Date().toISOString(),
    entryCount,
  };
  await writeJsonFile(
    join(projectRoot, ...CATALOG_INDEX_META_OUTPUT_PATH),
    meta,
  );
}

// ─── Validator ──────────────────────────────────────────────────────────────

function assertCatalogIndexMeta(
  value: unknown,
  context: string,
): asserts value is CatalogIndexMeta {
  if (
    value == null ||
    typeof value !== "object" ||
    typeof (value as Record<string, unknown>).builtAt !== "string" ||
    typeof (value as Record<string, unknown>).entryCount !== "number"
  ) {
    throw new Error(`Invalid CatalogIndexMeta at ${context}`);
  }
}

/** Exposes narrow catalog-index internals for focused tests. */
export const catalogIndexInternals = {
  assertCatalogIndexMeta,
};
