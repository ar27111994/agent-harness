/**
 * pub.dev registry adapter for source-sync.
 *
 * Owns: resumable pub.dev package listing sync via the official
 * JSON API at https://pub.dev/api/package-names.
 *
 * Per https://pub.dev/help/api, the supported listing endpoint is
 * /api/package-names — it returns paginated package name strings
 * with a camelCase `nextUrl` cursor. The /api/packages?page=N URL
 * is not a supported public API.
 */

import type { SourceDefinition } from "../../../../types.js";
import {
  buildPackageRegistryCatalogEntry,
  getPackageRegistryKind,
} from "../../package-registry-harvester.js";

import {
  countEntriesForSource,
  getEffectiveMaxPagesPerRun,
  getPreviousCursorStates,
  upsertIndexedCatalogEntry,
} from "../state.js";
import {
  asRecord,
  fetchRequiredJson,
  getAllowedOrigins,
  getString,
} from "../fetching.js";
import type { SourceSyncContext, SourceSyncSourceState } from "../types.js";

/** Canonical listing URL derived from the checked-in source endpoints. */
function resolveListingUrl(source: SourceDefinition): string {
  return (
    source.endpoints.listApi ??
    `${source.endpoints.baseUrl ?? "https://pub.dev"}/api/package-names`
  );
}

/**
 * Syncs the pub.dev package registry using the official paginated
 * `/api/package-names` API. Each response page contains:
 *
 *   { "packages": ["name1", ...], "nextUrl": "..." }
 *
 * Packages are returned as plain names — the listing API does not
 * expose per-package metadata. Individual package details require
 * separate calls to /api/packages/<name>, which are not used here
 * to keep sync fast and bounded.
 */
export async function syncPubDevSource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const listingUrl = resolveListingUrl(source);
  // Derive allowed origins from the checked-in source endpoint once,
  // not from the API response's nextUrl field (which the remote could
  // in theory pivot to any origin).
  const allowedOrigins = getAllowedOrigins(listingUrl);

  const previousCursor = getPreviousCursorStates(context.previousState)[0] ?? {
    cursorId: "packages",
    nextToken: listingUrl,
    completed: false,
  };

  let pageCount = 0;
  let nextUrl: string | undefined = previousCursor.nextToken;
  if (!nextUrl) {
    nextUrl = listingUrl;
  }

  const maxPages = getEffectiveMaxPagesPerRun(context);
  const registryKind = getPackageRegistryKind(source);
  const demandProfile = context.demandProfile;
  const selectionRegistry = context.selectionRegistry;

  while (nextUrl && pageCount < maxPages) {
    const data = await fetchRequiredJson(nextUrl, allowedOrigins);
    const record = asRecord(data);
    const packages = Array.isArray(record.packages) ? record.packages : [];

    for (const pkg of packages) {
      // pub.dev /api/package-names returns plain strings, not objects.
      // Accept both forms so the adapter degrades gracefully if the
      // response format changes.
      const packageName =
        typeof pkg === "string" ? pkg : getString(asRecord(pkg).name);
      if (!packageName) {
        continue;
      }

      // The listing API does not expose per-package description,
      // repository URL, or publication timestamp. Build the catalog
      // entry from the package name alone — downstream scoring uses
      // source-level signals (authority tier, kind) to fill the gaps.
      const entry = buildPackageRegistryCatalogEntry(
        source,
        packageName,
        "", // description — not available from listing
        undefined, // repositoryUrl — not available
        undefined, // lastUpdated — not available (avoids fabrication)
        demandProfile,
        selectionRegistry,
        registryKind,
      );

      upsertIndexedCatalogEntry(context, entry);
    }

    pageCount++;
    // The official API response field is camelCase `nextUrl` (not
    // snake_case `next_url`).  https://pub.dev/help/api
    // Use getString to normalize empty strings → undefined so
    // end-of-pagination is consistently treated as complete.
    nextUrl = getString(record.nextUrl);
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
