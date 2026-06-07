/**
 * Go module index registry adapter for source-sync.
 *
 * Owns: Go module index feed sync and go-specific cursor management.
 */

import type { SourceDefinition } from "../../../../types.js";
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
  fetchRequiredText,
  getAllowedOrigins,
  getString,
  isRecord,
} from "../fetching.js";
import type { SourceSyncContext, SourceSyncSourceState } from "../types.js";

/**
 * Syncs the Go module proxy / pkg.go.dev index using sitemap-driven discovery
 * with a paginated HTML fallback.
 */
export async function syncGoRegistrySource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const previousCursor = getPreviousCursorStates(context.previousState)[0] ?? {
    cursorId: "index",
    nextToken: "1970-01-01T00:00:00Z",
    completed: false,
  };
  const apiUrl = new URL(
    source.endpoints.indexApi ?? "https://index.golang.org/index",
  );
  apiUrl.searchParams.set(
    "since",
    previousCursor.nextToken ?? "1970-01-01T00:00:00Z",
  );
  apiUrl.searchParams.set("limit", String(SOURCE_SYNC_BATCH_SIZE));
  const content = await fetchRequiredText(
    apiUrl.toString(),
    getAllowedOrigins(apiUrl.toString()),
  );
  const rows = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter(
      (line): line is Record<string, unknown> =>
        Boolean(line) && isRecord(line),
    );

  let nextToken = previousCursor.nextToken ?? "1970-01-01T00:00:00Z";
  for (const row of rows) {
    const packageName = getString(row.Path);
    if (!packageName) {
      continue;
    }
    const timestamp = getString(row.Timestamp) ?? undefined;
    const entry = buildPackageRegistryCatalogEntry(
      source,
      packageName,
      packageName,
      undefined,
      timestamp,
      context.demandProfile,
      context.selectionRegistry,
      getPackageRegistryKind(source),
    );
    upsertIndexedCatalogEntry(context, entry);
    if (timestamp) {
      nextToken = timestamp;
    }
  }

  return {
    sourceId: source.id,
    coverageMode: "indexed",
    status: "partial",
    lastSyncedAt: new Date().toISOString(),
    indexedEntryCount: countEntriesForSource(context.entriesById, source.id),
    reason:
      "Go package discovery now uses the official module index feed. Like npm, it is append-only and intentionally remains partial while it advances through the feed.",
    cursors: [
      {
        cursorId: "index",
        nextToken,
        completed: false,
      },
    ],
  };
}
