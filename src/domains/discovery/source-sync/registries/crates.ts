/**
 * Crates.io (Cargo) registry adapter for source-sync.
 *
 * Owns: paginated Cargo crates API sync and crate metadata extraction.
 */

import type { SourceDefinition } from "../../../../types.js";
import {
  buildPackageRegistryCatalogEntry,
  getPackageRegistryKind,
} from "../../package-registry-harvester.js";

import {
  countEntriesForSource,
  getPreviousCursorStates,
  parsePositiveIntegerToken,
  restoreFiniteCursorState,
  upsertIndexedCatalogEntry,
  getEffectiveMaxPagesPerRun,
} from "../state.js";
import {
  SOURCE_SYNC_BATCH_SIZE,
  asRecord,
  fetchRequiredJson,
  getAllowedOrigins,
  getString,
} from "../fetching.js";
import type { SourceSyncContext, SourceSyncSourceState } from "../types.js";

/**
 * Syncs the crates.io registry using the paginated search API with per-page
 * resumable cursors.
 */
export async function syncCargoRegistrySource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const previousCursor = restoreFiniteCursorState(
    getPreviousCursorStates(context.previousState)[0],
    {
      cursorId: "page",
      nextToken: "1",
      completed: false,
    },
  );
  let pageNumber = parsePositiveIntegerToken(previousCursor.nextToken, 1);
  let completed = previousCursor.completed;

  for (
    let pageCount = 0;
    pageCount < getEffectiveMaxPagesPerRun(context) && !completed;
    pageCount += 1
  ) {
    const apiUrl = new URL(
      source.endpoints.apiUrl ?? "https://crates.io/api/v1/crates",
    );
    apiUrl.searchParams.set("page", String(pageNumber));
    apiUrl.searchParams.set("per_page", String(SOURCE_SYNC_BATCH_SIZE));
    const data = await fetchRequiredJson(
      apiUrl.toString(),
      getAllowedOrigins(apiUrl.toString()),
    );
    const record = asRecord(data);
    const crates = Array.isArray(record.crates) ? record.crates : [];

    for (const item of crates) {
      const crate = asRecord(item);
      const packageName = getString(crate.id) ?? getString(crate.name);
      if (!packageName) {
        continue;
      }

      const entry = buildPackageRegistryCatalogEntry(
        source,
        packageName,
        getString(crate.description) ?? packageName,
        getString(crate.repository) ?? getString(crate.homepage),
        getString(crate.updated_at),
        context.demandProfile,
        context.selectionRegistry,
        getPackageRegistryKind(source),
      );
      upsertIndexedCatalogEntry(context, entry);
    }

    if (crates.length < SOURCE_SYNC_BATCH_SIZE) {
      completed = true;
    } else {
      pageNumber += 1;
    }
  }

  return {
    sourceId: source.id,
    coverageMode: "indexed",
    status: completed ? "complete" : "partial",
    lastSyncedAt: new Date().toISOString(),
    indexedEntryCount: countEntriesForSource(context.entriesById, source.id),
    cursors: [
      {
        cursorId: "page",
        nextToken: String(pageNumber),
        completed,
      },
    ],
  };
}
