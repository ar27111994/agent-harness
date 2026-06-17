/**
 * VS Code Marketplace registry adapter for source-sync.
 *
 * Owns: paginated VS Code Marketplace query sync, demand-query cursor
 * management, and marketplace-specific page-size configuration. The actual
 * marketplace fetch and item shape are delegated to reference-harvesters.ts.
 *
 * Harvest tiers (run in order per sync call):
 *   Tier 1 — Popularity sweep: top-N by install count. Re-runs on every
 *             scheduled index refresh. Uses a dedicated cursor so progress
 *             does not interfere with other tiers.
 *   Tier 2 — Category sweep: all extensions in categories derived from the
 *             workspace demand profile. Runs after the popularity sweep.
 *   Tier 3 — Alphabetical pagination: full long-tail coverage using the
 *             existing demand-query cursor loop.
 */

import { getRuntimeConfig } from "../../../../config/runtime.js";
import type { SourceDefinition } from "../../../../types.js";
import {
  fetchVsCodeMarketplaceItemsForQuery,
  selectDemandQueries,
} from "../../reference-harvesters.js";
import { buildReferenceSourceCatalogEntry } from "../../reference-source-harvester.js";
import {
  VSCODE_SORT_BY,
  VSCODE_SORT_ORDER,
  resolveVsCodeCategories,
} from "../../category-mappings.js";

import {
  countEntriesForSource,
  getPreviousCursorStates,
  parsePositiveIntegerToken,
  restoreFiniteCursorState,
  upsertIndexedCatalogEntry,
} from "../state.js";
import type { SourceSyncContext, SourceSyncSourceState } from "../types.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Cursor ID prefix used to mark Tier-1 popularity-sweep cursors in the
 * persisted sync state. Prefixing keeps them distinct from text-query cursors.
 */
const POPULARITY_CURSOR_PREFIX = "__popularity__";

/**
 * Cursor ID prefix for Tier-2 category-sweep cursors.
 */
const CATEGORY_CURSOR_PREFIX = "__cat__";

/**
 * Page size for the popularity and category sweeps.
 * The Marketplace API allows up to 100 per page.
 */
const SWEEP_PAGE_SIZE = 100;

// ─── Adapter ─────────────────────────────────────────────────────────────────

/**
 * Syncs the VS Code Marketplace source in three tiers:
 *   1. Popularity sweep  — top-N by install count
 *   2. Category sweep    — all extensions in demand-mapped categories
 *   3. Alphabetical loop — full long-tail pagination (existing behaviour)
 */
export async function syncVsCodeMarketplaceSource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const discoveryConfig = getRuntimeConfig().discovery;
  const popularitySweepPages =
    discoveryConfig.vscodeMarketplacePopularitySweepPages;
  const categorySweepEnabled =
    discoveryConfig.vscodeMarketplaceCategorySweepEnabled;
  const previousCursors = new Map(
    getPreviousCursorStates(context.previousState).map((c) => [c.cursorId, c]),
  );

  const nextCursors: Array<{
    cursorId: string;
    nextToken: string;
    completed: boolean;
  }> = [];
  let status: "complete" | "partial" = "complete";

  // ── Tier 1: Popularity sweep ────────────────────────────────────────────

  const popularityCursorId = `${POPULARITY_CURSOR_PREFIX}install-count`;
  const popularityState = restoreFiniteCursorState(
    previousCursors.get(popularityCursorId),
    { cursorId: popularityCursorId, nextToken: "1", completed: false },
  );
  let popularityPage = parsePositiveIntegerToken(popularityState.nextToken, 1);
  let popularityCompleted = popularityState.completed;

  for (
    let pageCount = 0;
    pageCount < popularitySweepPages && !popularityCompleted;
    pageCount += 1
  ) {
    const items = await fetchVsCodeMarketplaceItemsForQuery(source, "", {
      pageNumber: popularityPage,
      pageSize: SWEEP_PAGE_SIZE,
      sortBy: VSCODE_SORT_BY.InstallCount,
      sortOrder: VSCODE_SORT_ORDER.Descending,
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
    if (items.length < SWEEP_PAGE_SIZE) {
      popularityCompleted = true;
    } else {
      popularityPage += 1;
    }
  }

  if (popularitySweepPages > 0 && !popularityCompleted) {
    status = "partial";
  }

  if (popularitySweepPages > 0) {
    nextCursors.push({
      cursorId: popularityCursorId,
      nextToken: String(popularityPage),
      completed: popularityCompleted,
    });
  }

  // ── Tier 2: Category sweep ───────────────────────────────────────────────

  if (categorySweepEnabled) {
    const demandSignals = context.demandProfile
      ? [
          ...context.demandProfile.signals.languages,
          ...context.demandProfile.signals.frameworks,
          ...context.demandProfile.signals.concerns,
          ...context.demandProfile.signals.tooling,
        ]
      : [];
    const categories = resolveVsCodeCategories(demandSignals);

    for (const category of categories) {
      const catCursorId = `${CATEGORY_CURSOR_PREFIX}${category}`;
      const catState = restoreFiniteCursorState(
        previousCursors.get(catCursorId),
        { cursorId: catCursorId, nextToken: "1", completed: false },
      );
      let catPage = parsePositiveIntegerToken(catState.nextToken, 1);
      let catCompleted = catState.completed;

      for (
        let pageCount = 0;
        pageCount < discoveryConfig.sourceSyncMaxPagesPerRun && !catCompleted;
        pageCount += 1
      ) {
        const items = await fetchVsCodeMarketplaceItemsForQuery(source, "", {
          pageNumber: catPage,
          pageSize: SWEEP_PAGE_SIZE,
          sortBy: VSCODE_SORT_BY.InstallCount,
          sortOrder: VSCODE_SORT_ORDER.Descending,
          category,
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
        if (items.length < SWEEP_PAGE_SIZE) {
          catCompleted = true;
        } else {
          catPage += 1;
        }
      }

      if (!catCompleted) {
        status = "partial";
      }

      nextCursors.push({
        cursorId: catCursorId,
        nextToken: String(catPage),
        completed: catCompleted,
      });
    }
  }

  // ── Tier 3: Alphabetical demand-query pagination ──────────────────────────

  const queries = selectDemandQueries(context.demandProfile).slice(
    0,
    discoveryConfig.vscodeMarketplaceMaxQueries,
  );

  for (const query of queries) {
    const queryState = restoreFiniteCursorState(previousCursors.get(query), {
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

    nextCursors.push({
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
    cursors: nextCursors,
  };
}
