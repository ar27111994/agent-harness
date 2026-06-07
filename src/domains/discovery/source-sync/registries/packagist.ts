/**
 * Packagist (PHP Composer) registry adapter for source-sync.
 *
 * Owns: one-pass full snapshot sync from the Packagist list API.
 */

import type { SourceDefinition } from "../../../../types.js";
import {
  buildPackageRegistryCatalogEntry,
  getPackageRegistryKind,
} from "../../package-registry-harvester.js";

import { countEntriesForSource, upsertIndexedCatalogEntry } from "../state.js";
import {
  SOURCE_SYNC_LARGE_RESPONSE_MAX_BYTES,
  asRecord,
  fetchRequiredJson,
  getAllowedOrigins,
  normalizeStringArray,
} from "../fetching.js";
import type { SourceSyncContext, SourceSyncSourceState } from "../types.js";

/**
 * Syncs the Packagist (PHP) registry using the paginated search API with
 * per-page resumable cursors.
 */
export async function syncPackagistRegistrySource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const apiUrl =
    source.endpoints.listApi ?? "https://packagist.org/packages/list.json";
  const data = await fetchRequiredJson(apiUrl, getAllowedOrigins(apiUrl), {
    maxBytes: SOURCE_SYNC_LARGE_RESPONSE_MAX_BYTES,
    timeoutMs: 60_000,
  });
  const record = asRecord(data);
  const packageNames = normalizeStringArray(record.packageNames);

  for (const packageName of packageNames) {
    const entry = buildPackageRegistryCatalogEntry(
      source,
      packageName,
      packageName,
      undefined,
      undefined,
      context.demandProfile,
      context.selectionRegistry,
      getPackageRegistryKind(source),
    );
    upsertIndexedCatalogEntry(context, entry);
  }

  return {
    sourceId: source.id,
    coverageMode: "indexed",
    status: "complete",
    lastSyncedAt: new Date().toISOString(),
    indexedEntryCount: countEntriesForSource(context.entriesById, source.id),
    reason:
      "Packagist exposes the full package-name snapshot through its official list API, so sync can index the registry directly in one pass.",
    cursors: [
      {
        cursorId: "snapshot",
        completed: true,
      },
    ],
  };
}
