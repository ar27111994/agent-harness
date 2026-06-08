/**
 * npm registry adapter for source-sync.
 *
 * Owns: resumable npm changes-feed sync and npm-specific status messaging.
 */

import type { SourceDefinition } from "../../../../types.js";
import {
  extractRepositoryUrlFromNpmMetadata,
  fetchNpmPackageMetadata,
} from "../../../../package-registries.js";
import {
  buildPackageRegistryCatalogEntry,
  getPackageRegistryKind,
} from "../../package-registry-harvester.js";
import { buildCatalogId } from "../../catalog-utils.js";

import {
  countEntriesForSource,
  deleteIndexedCatalogEntry,
  getPreviousCursorStates,
  upsertIndexedCatalogEntry,
} from "../state.js";
import {
  SOURCE_SYNC_BATCH_SIZE,
  asRecord,
  fetchRequiredJson,
  getAllowedOrigins,
  getString,
  stringifyUnknown,
} from "../fetching.js";
import type { SourceSyncContext, SourceSyncSourceState } from "../types.js";

/**
 * Syncs the npm registry using the official replicate changes feed for
 * resumable incremental indexing.
 */
export async function syncNpmRegistrySource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const previousCursor = getPreviousCursorStates(context.previousState)[0] ?? {
    cursorId: "changes",
    nextToken: "0",
    completed: false,
  };
  const changesUrl = new URL(
    source.endpoints.changesApi ?? "https://replicate.npmjs.com/_changes",
  );
  changesUrl.searchParams.set("since", previousCursor.nextToken ?? "0");
  changesUrl.searchParams.set("limit", String(SOURCE_SYNC_BATCH_SIZE));
  const data = await fetchRequiredJson(
    changesUrl.toString(),
    getAllowedOrigins(changesUrl.toString()),
  );
  const record = asRecord(data);
  const results = Array.isArray(record.results) ? record.results : [];

  const registryKind = getPackageRegistryKind(source);
  for (const result of results) {
    const row = asRecord(result);
    const packageName = getString(row.id);
    if (!packageName) {
      continue;
    }

    if (row.deleted === true) {
      // The npm changes feed explicitly signals a package was unpublished.
      // Remove it from the in-memory index immediately so the catalog stays
      // accurate without waiting for a prune-on-complete pass (which the
      // feed-based adapter never reaches).
      const entryId = buildCatalogId(
        `${source.id}:${registryKind}`,
        packageName,
      );
      deleteIndexedCatalogEntry(context, entryId);
      continue;
    }

    const metadata = await fetchNpmPackageMetadata(packageName, {
      resolveHostname: undefined,
    });
    if (!metadata) {
      continue;
    }

    const entry = buildPackageRegistryCatalogEntry(
      source,
      packageName,
      metadata.description ?? packageName,
      extractRepositoryUrlFromNpmMetadata(metadata),
      metadata.lastUpdated,
      context.demandProfile,
      context.selectionRegistry,
      getPackageRegistryKind(source),
      metadata.keywords ?? [],
    );
    upsertIndexedCatalogEntry(context, entry);
  }

  return {
    sourceId: source.id,
    coverageMode: "indexed",
    status: "partial",
    lastSyncedAt: new Date().toISOString(),
    indexedEntryCount: countEntriesForSource(context.entriesById, source.id),
    reason:
      "npm now uses the official replicate changes feed for resumable indexing. The feed is effectively unbounded, so sync remains intentionally partial while it catches up.",
    cursors: [
      {
        cursorId: "changes",
        nextToken:
          stringifyUnknown(record.last_seq) ?? previousCursor.nextToken,
        completed: false,
      },
    ],
  };
}
