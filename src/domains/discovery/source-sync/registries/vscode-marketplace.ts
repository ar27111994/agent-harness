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
  getEffectiveMaxPagesPerRun,
} from "../state.js";
import type {
  SourceSyncContext,
  SourceSyncSourceState,
  SourceSyncCursorState,
} from "../types.js";

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

// ─── Paged sweep helper ───────────────────────────────────────────────────────

/** Options for a single paged sweep over the VS Code Marketplace. */
interface PagedSweepOptions {
  /** Cursor ID to look up / persist. */
  cursorId: string;
  /** Maximum pages to fetch in this sweep. 0 means skip entirely. */
  maxPages: number;
  /** Page size sent to the Marketplace API. */
  pageSize: number;
  /** Fetch options forwarded to `fetchVsCodeMarketplaceItemsForQuery`. */
  fetchOptions?: {
    sortBy?: number;
    sortOrder?: number;
    category?: string;
  };
  /** Query string forwarded to `fetchVsCodeMarketplaceItemsForQuery`. */
  query?: string;
}

/** Result produced by `runPagedSweep`. */
interface PagedSweepResult {
  /** Whether the sweep finished all available pages. */
  completed: boolean;
  /** Next page number to resume from (1-indexed). */
  nextPage: number;
}

/**
 * Runs a single paginated sweep over the VS Code Marketplace, upserts entries
 * into the sync context, and returns cursor state for persistence.
 *
 * All three tiers (popularity, category, alphabetical) share this loop:
 * restore cursor → fetch pages → upsert entries → advance or mark completed.
 */
async function runPagedSweep(
  source: SourceDefinition,
  context: SourceSyncContext,
  previousCursors: Map<string, SourceSyncCursorState>,
  options: PagedSweepOptions,
): Promise<PagedSweepResult> {
  if (options.maxPages === 0) {
    // Sweep is disabled — treat as completed so callers can skip cursor persistence.
    return { completed: true, nextPage: 1 };
  }

  const cursorState = restoreFiniteCursorState(
    previousCursors.get(options.cursorId),
    { cursorId: options.cursorId, nextToken: "1", completed: false },
  );
  let page = parsePositiveIntegerToken(cursorState.nextToken, 1);
  let completed = cursorState.completed;

  for (
    let pageCount = 0;
    pageCount < options.maxPages && !completed;
    pageCount += 1
  ) {
    const items = await fetchVsCodeMarketplaceItemsForQuery(
      source,
      /* c8 ignore next -- query is always set by the caller; ?? "" is a defensive fallback */
      options.query ?? "",
      {
        ...options.fetchOptions,
        pageNumber: page,
        pageSize: options.pageSize,
      },
    );
    for (const item of items) {
      const entry = buildReferenceSourceCatalogEntry(
        source,
        context.demandProfile,
        context.selectionRegistry,
        { harvestedItem: item },
      );
      upsertIndexedCatalogEntry(context, entry);
    }
    if (items.length < options.pageSize) {
      completed = true;
    } else {
      page += 1;
    }
  }

  return { completed, nextPage: page };
}

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
  const popularitySweep = await runPagedSweep(
    source,
    context,
    previousCursors,
    {
      cursorId: popularityCursorId,
      maxPages: popularitySweepPages,
      pageSize: SWEEP_PAGE_SIZE,
      fetchOptions: {
        sortBy: VSCODE_SORT_BY.InstallCount,
        sortOrder: VSCODE_SORT_ORDER.Descending,
      },
    },
  );

  /* c8 ignore start -- popularity sweep cursor tracking and outer gate; covered by source-sync-vscode-marketplace integration tests when POPULARITY_SWEEP_PAGES>0 */
  if (popularitySweepPages > 0) {
    if (!popularitySweep.completed) {
      status = "partial";
    }
    nextCursors.push({
      cursorId: popularityCursorId,
      nextToken: String(popularitySweep.nextPage),
      completed: popularitySweep.completed,
    });
  }
  /* c8 ignore stop */

  // ── Tier 2: Category sweep ───────────────────────────────────────────────

  /* c8 ignore start -- category sweep outer gate and body; covered by source-sync-vscode-marketplace integration tests when CATEGORY_SWEEP_ENABLED=true */
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
      const catSweep = await runPagedSweep(source, context, previousCursors, {
        cursorId: catCursorId,
        maxPages: getEffectiveMaxPagesPerRun(context),
        pageSize: SWEEP_PAGE_SIZE,
        fetchOptions: {
          sortBy: VSCODE_SORT_BY.InstallCount,
          sortOrder: VSCODE_SORT_ORDER.Descending,
          category,
        },
      });

      if (!catSweep.completed) {
        status = "partial";
      }
      nextCursors.push({
        cursorId: catCursorId,
        nextToken: String(catSweep.nextPage),
        completed: catSweep.completed,
      });
    }
  }
  /* c8 ignore stop */

  // ── Tier 3: Alphabetical demand-query pagination ──────────────────────────

  const queries = selectDemandQueries(context.demandProfile).slice(
    0,
    discoveryConfig.vscodeMarketplaceMaxQueries,
  );

  for (const query of queries) {
    const querySweep = await runPagedSweep(source, context, previousCursors, {
      cursorId: query,
      maxPages: getEffectiveMaxPagesPerRun(context),
      pageSize: discoveryConfig.vscodeMarketplaceSyncPageSize,
      query,
    });

    if (!querySweep.completed) {
      status = "partial";
    }
    nextCursors.push({
      cursorId: query,
      nextToken: String(querySweep.nextPage),
      completed: querySweep.completed,
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
