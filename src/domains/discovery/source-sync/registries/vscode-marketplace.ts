/**
 * VS Code Marketplace registry adapter for source-sync.
 *
 * Owns: paginated VS Code Marketplace query sync, demand-query cursor
 * management, and marketplace-specific page-size configuration. The actual
 * marketplace fetch and item shape are delegated to reference-harvesters.ts.
 */

import { getRuntimeConfig } from "../../../../config/runtime.js";
import type { SourceDefinition } from "../../../../types.js";
import {
  fetchVsCodeMarketplaceItemsForQuery,
  selectDemandQueries,
} from "../../reference-harvesters.js";
import { buildReferenceSourceCatalogEntry } from "../../reference-source-harvester.js";

import {
  countEntriesForSource,
  getPreviousCursorStates,
  parsePositiveIntegerToken,
  restoreFiniteCursorState,
  upsertIndexedCatalogEntry,
} from "../state.js";
import type { SourceSyncContext, SourceSyncSourceState } from "../types.js";

/**
 * Syncs the VS Code Marketplace source using demand-profile-derived queries
 * with per-query resumable page cursors.
 */
export async function syncVsCodeMarketplaceSource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const discoveryConfig = getRuntimeConfig().discovery;
  const queries = selectDemandQueries(context.demandProfile).slice(
    0,
    discoveryConfig.vscodeMarketplaceMaxQueries,
  );
  const previousQueryState = new Map(
    getPreviousCursorStates(context.previousState).map((cursorState) => [
      cursorState.cursorId,
      cursorState,
    ]),
  );
  const nextQueries: Array<{
    cursorId: string;
    nextToken: string;
    completed: boolean;
  }> = [];
  let status: "complete" | "partial" = "complete";

  for (const query of queries) {
    const queryState = restoreFiniteCursorState(previousQueryState.get(query), {
      cursorId: query,
      nextToken: "1",
      completed: false,
    });
    let nextPage = parsePositiveIntegerToken(queryState.nextToken, 1);
    let completed = queryState.completed;

    for (
      let pageCount = 0;
      pageCount < discoveryConfig.sourceSyncMaxPagesPerRun && !completed;
      pageCount += 1
    ) {
      const items = await fetchVsCodeMarketplaceItemsForQuery(source, query, {
        pageNumber: nextPage,
        pageSize: discoveryConfig.vscodeMarketplaceSyncPageSize,
      });
      for (const item of items) {
        const entry = buildReferenceSourceCatalogEntry(
          source,
          context.demandProfile,
          context.selectionRegistry,
          { harvestedItem: item },
        );
        upsertIndexedCatalogEntry(context, entry);
      }
      if (items.length < discoveryConfig.vscodeMarketplaceSyncPageSize) {
        completed = true;
      } else {
        nextPage += 1;
      }
    }

    if (!completed) {
      status = "partial";
    }

    nextQueries.push({
      cursorId: query,
      nextToken: String(nextPage),
      completed,
    });
  }

  return {
    sourceId: source.id,
    coverageMode: "indexed",
    status,
    lastSyncedAt: new Date().toISOString(),
    indexedEntryCount: countEntriesForSource(context.entriesById, source.id),
    cursors: nextQueries,
  };
}
