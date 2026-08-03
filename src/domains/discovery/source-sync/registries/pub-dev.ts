/**
 * pub.dev registry adapter for source-sync.
 *
 * Owns: resumable pub.dev package listing sync via the paginated
 * JSON API at https://pub.dev/api/packages.
 */

import type {
  DemandProfile,
  SelectionRegistry,
  SourceDefinition,
} from "../../../../types.js";
import {
  buildPackageRegistryCatalogEntry,
  getPackageRegistryKind,
} from "../../package-registry-harvester.js";

import {
  countEntriesForSource,
  getPreviousCursorStates,
  upsertIndexedCatalogEntry,
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
 * Syncs the pub.dev package registry using the paginated JSON package
 * listing API. Each page returns a `next_url` for cursor-based pagination
 * and a `packages` array with package metadata.
 */
export async function syncPubDevSource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const previousCursor = getPreviousCursorStates(context.previousState)[0] ?? {
    cursorId: "packages",
    nextToken: `${source.endpoints.baseUrl ?? "https://pub.dev"}/api/packages?page=1`,
    completed: false,
  };

  let pageCount = 0;
  let nextUrl: string | undefined = previousCursor.nextToken;
  if (!nextUrl) {
    nextUrl = `${source.endpoints.baseUrl ?? "https://pub.dev"}/api/packages?page=1`;
  }

  const maxPages = context.maxPagesPerRunOverride ?? SOURCE_SYNC_BATCH_SIZE;
  const registryKind = getPackageRegistryKind(source);
  const demandProfile = context.demandProfile ?? (null as DemandProfile | null);
  const selectionRegistry = context.selectionRegistry as SelectionRegistry;

  while (nextUrl && pageCount < maxPages) {
    const data = await fetchRequiredJson(nextUrl, getAllowedOrigins(nextUrl));
    const record = asRecord(data);
    const packages = Array.isArray(record.packages) ? record.packages : [];

    for (const pkg of packages) {
      const pkgRecord = asRecord(pkg);
      const packageName = getString(pkgRecord.name);
      if (!packageName) {
        continue;
      }

      const latest = asRecord(pkgRecord.latest ?? {});
      const pubspec = asRecord(latest.pubspec ?? {});
      const description = getString(pubspec.description) ?? "";
      const repositoryUrl = getString(pubspec.repository);
      // pub.dev listing API does not expose per-package publication
      // timestamps. lastUpdated remains undefined so freshness scoring
      // falls back to source lastSyncedAt rather than fabricating a
      // timestamp that would mark every package as "just updated."
      const lastUpdated = undefined;

      const entry = buildPackageRegistryCatalogEntry(
        source,
        packageName,
        description,
        repositoryUrl,
        lastUpdated,
        demandProfile,
        selectionRegistry,
        registryKind,
      );

      upsertIndexedCatalogEntry(context, entry);
    }

    pageCount++;
    nextUrl = typeof record.next_url === "string" ? record.next_url : undefined;
  }

  const completed = nextUrl === undefined;
  const indexedEntryCount = countEntriesForSource(
    context.entriesById,
    source.id,
  );

  return {
    sourceId: source.id,
    coverageMode: "indexed",
    status: completed ? "complete" : "partial",
    lastSyncedAt: new Date().toISOString(),
    indexedEntryCount,
    cursors: [
      {
        cursorId: "packages",
        nextToken: nextUrl,
        completed,
      },
    ],
  };
}
