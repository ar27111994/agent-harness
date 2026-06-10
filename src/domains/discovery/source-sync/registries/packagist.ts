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
  SOURCE_SYNC_INDEXED_REGISTRY_ENTRY_CAP,
  SOURCE_SYNC_LARGE_RESPONSE_MAX_BYTES,
  asRecord,
  fetchRequiredJson,
  getAllowedOrigins,
  normalizeStringArray,
} from "../fetching.js";
import type { SourceSyncContext, SourceSyncSourceState } from "../types.js";

/** Timeout for the Packagist full package-name snapshot fetch. */
const PACKAGIST_TIMEOUT_MS = 60_000;

/**
 * Syncs the Packagist (PHP) registry by fetching the full package-name
 * snapshot from the list API in one pass.
 */
export async function syncPackagistRegistrySource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const apiUrl =
    source.endpoints.listApi ?? "https://packagist.org/packages/list.json";
  const data = await fetchRequiredJson(apiUrl, getAllowedOrigins(apiUrl), {
    maxBytes: SOURCE_SYNC_LARGE_RESPONSE_MAX_BYTES,
    timeoutMs: PACKAGIST_TIMEOUT_MS,
  });
  const record = asRecord(data);
  const packageNames = normalizeStringArray(record.packageNames);

  // Slice up-front so the orchestrator always observes the same ≤CAP entries
  // regardless of how many were stored from a previous run.  An in-loop guard
  // against the existing count is wrong: if startCount is already at the cap
  // (re-run of a fully-populated source) the guard fires on the first
  // iteration, zero entries are observed, and the orchestrator's prune step
  // then removes all 500 previously-indexed entries.
  const cappedNames = packageNames.slice(
    0,
    SOURCE_SYNC_INDEXED_REGISTRY_ENTRY_CAP,
  );

  for (const packageName of cappedNames) {
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
