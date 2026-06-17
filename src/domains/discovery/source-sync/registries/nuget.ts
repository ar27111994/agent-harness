/**
 * NuGet registry adapter for source-sync.
 *
 * Owns: NuGet SearchQueryService resolution and paginated package search sync.
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
  normalizeStringArray,
} from "../fetching.js";
import type { SourceSyncContext, SourceSyncSourceState } from "../types.js";

/**
 * Syncs the NuGet gallery using the NuGet V3 search query service with
 * per-offset resumable cursors. Resolves the query service URL from the
 * NuGet service index when not explicitly configured.
 */
export async function syncNuGetRegistrySource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const previousCursor = restoreFiniteCursorState(
    getPreviousCursorStates(context.previousState)[0],
    {
      cursorId: "skip",
      nextToken: "0",
      completed: false,
    },
  );
  const searchQueryServiceUrl = await resolveNuGetSearchQueryServiceUrl(source);
  const allowedOrigins = getAllowedOrigins(
    searchQueryServiceUrl,
    source.endpoints.serviceIndexUrl,
  );
  let skip = parseNonNegativeIntegerToken(previousCursor.nextToken, 0);
  let completed = previousCursor.completed;

  for (
    let pageCount = 0;
    pageCount < getEffectiveMaxPagesPerRun(context) && !completed;
    pageCount += 1
  ) {
    const queryUrl = new URL(searchQueryServiceUrl);
    queryUrl.searchParams.set("q", "");
    queryUrl.searchParams.set("skip", String(skip));
    queryUrl.searchParams.set("take", String(SOURCE_SYNC_BATCH_SIZE));
    queryUrl.searchParams.set("prerelease", "true");
    queryUrl.searchParams.set("semVerLevel", "2.0.0");
    const data = await fetchRequiredJson(queryUrl.toString(), allowedOrigins);
    const record = asRecord(data);
    const packages = Array.isArray(record.data) ? record.data : [];
    const totalHits = getNumber(record.totalHits) ?? packages.length;

    for (const item of packages) {
      const packageRecord = asRecord(item);
      const packageName = getString(packageRecord.id);
      if (!packageName) {
        continue;
      }

      const entry = buildPackageRegistryCatalogEntry(
        source,
        packageName,
        getString(packageRecord.description) ?? packageName,
        undefined,
        undefined,
        context.demandProfile,
        context.selectionRegistry,
        getPackageRegistryKind(source),
        normalizeStringArray(packageRecord.tags),
      );
      upsertIndexedCatalogEntry(context, entry);
    }

    skip += packages.length;
    completed = packages.length === 0 || skip >= totalHits;
  }

  return {
    sourceId: source.id,
    coverageMode: "indexed",
    status: completed ? "complete" : "partial",
    lastSyncedAt: new Date().toISOString(),
    indexedEntryCount: countEntriesForSource(context.entriesById, source.id),
    cursors: [
      {
        cursorId: "skip",
        nextToken: String(skip),
        completed,
      },
    ],
  };
}

/**
 * Resolves the NuGet V3 search query service URL by fetching the NuGet service
 * index and selecting the `SearchQueryService` resource. Falls back to the
 * explicitly configured `queryApi` when present.
 */
export async function resolveNuGetSearchQueryServiceUrl(
  source: SourceDefinition,
): Promise<string> {
  if (source.endpoints.queryApi) {
    return source.endpoints.queryApi;
  }

  const serviceIndexUrl =
    source.endpoints.serviceIndexUrl ?? "https://api.nuget.org/v3/index.json";
  const data = await fetchRequiredJson(
    serviceIndexUrl,
    getAllowedOrigins(serviceIndexUrl),
  );
  const resources = Array.isArray(asRecord(data).resources)
    ? (asRecord(data).resources as unknown[])
    : [];
  const queryService = resources
    .map((item) => asRecord(item))
    .find((item) => {
      const typeValue = item["@type"];
      return (
        typeof typeValue === "string" &&
        typeValue.startsWith("SearchQueryService")
      );
    });
  const url = queryService ? getString(queryService["@id"]) : undefined;
  if (!url) {
    throw new Error(
      "NuGet service index did not expose a SearchQueryService endpoint.",
    );
  }

  return url;
}
