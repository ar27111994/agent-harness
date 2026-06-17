/**
 * Maven Central (Solr) registry adapter for source-sync.
 *
 * Owns: paginated Maven Central search API sync using Solr offset pagination.
 */

import type { SourceDefinition } from "../../../../types.js";
import {
  buildPackageRegistryCatalogEntry,
  getPackageRegistryKind,
} from "../../package-registry-harvester.js";

import {
  countEntriesForSource,
  getPreviousCursorStates,
  parseNonNegativeIntegerToken,
  restoreFiniteCursorState,
  upsertIndexedCatalogEntry,
  getEffectiveMaxPagesPerRun,
} from "../state.js";
import {
  SOURCE_SYNC_BATCH_SIZE,
  asRecord,
  fetchRequiredJson,
  getAllowedOrigins,
  getNumber,
  getString,
} from "../fetching.js";
import type { SourceSyncContext, SourceSyncSourceState } from "../types.js";

/**
 * Syncs the Maven Central repository using the Sonatype search API with
 * per-offset resumable cursors.
 */
export async function syncMavenRegistrySource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const previousCursor = restoreFiniteCursorState(
    getPreviousCursorStates(context.previousState)[0],
    {
      cursorId: "start",
      nextToken: "0",
      completed: false,
    },
  );
  let start = parseNonNegativeIntegerToken(previousCursor.nextToken, 0);
  let completed = previousCursor.completed;

  for (
    let pageCount = 0;
    pageCount < getEffectiveMaxPagesPerRun(context) && !completed;
    pageCount += 1
  ) {
    const apiUrl = new URL(
      source.endpoints.searchApi ??
        "https://search.maven.org/solrsearch/select",
    );
    apiUrl.searchParams.set("q", "*:*");
    apiUrl.searchParams.set("rows", String(SOURCE_SYNC_BATCH_SIZE));
    apiUrl.searchParams.set("start", String(start));
    apiUrl.searchParams.set("wt", "json");
    const data = await fetchRequiredJson(
      apiUrl.toString(),
      getAllowedOrigins(apiUrl.toString()),
    );
    const response = asRecord(asRecord(data).response);
    const docs = Array.isArray(response.docs) ? response.docs : [];
    const numFound = getNumber(response.numFound) ?? docs.length;

    for (const item of docs) {
      const doc = asRecord(item);
      const groupId = getString(doc.g);
      const artifactId = getString(doc.a);
      if (!groupId || !artifactId) {
        continue;
      }

      const packageName = `${groupId}:${artifactId}`;
      const timestamp = getNumber(doc.timestamp);
      const lastUpdated =
        typeof timestamp === "number"
          ? new Date(timestamp).toISOString()
          : undefined;
      const entry = buildPackageRegistryCatalogEntry(
        source,
        packageName,
        getString(doc.id) ?? packageName,
        undefined,
        lastUpdated,
        context.demandProfile,
        context.selectionRegistry,
        getPackageRegistryKind(source),
      );
      upsertIndexedCatalogEntry(context, entry);
    }

    start += docs.length;
    completed = docs.length === 0 || start >= numFound;
  }

  return {
    sourceId: source.id,
    coverageMode: "indexed",
    status: completed ? "complete" : "partial",
    lastSyncedAt: new Date().toISOString(),
    indexedEntryCount: countEntriesForSource(context.entriesById, source.id),
    cursors: [
      {
        cursorId: "start",
        nextToken: String(start),
        completed,
      },
    ],
  };
}
