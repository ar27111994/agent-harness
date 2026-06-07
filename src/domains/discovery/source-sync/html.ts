/**
 * Sitemap and paginated HTML sync engines for source-sync.
 *
 * Owns: the three generic sync drivers (syncSitemapSource,
 * syncHtmlListSource, and their typed variants) that back the majority of
 * reference and package-registry sources. Registry-specific business logic
 * is NOT in this file; each registry owns its own options construction.
 */

import { getRuntimeConfig } from "../../../config/runtime.js";
import type { AssetCatalogEntry, SourceDefinition } from "../../../types.js";
import { buildPackageRegistryCatalogEntry } from "../package-registry-harvester.js";
import { getPackageRegistryKind } from "../package-registry-harvester.js";

import {
  countEntriesForSource,
  getPreviousCursorStates,
  parseNonNegativeIntegerToken,
  parsePositiveIntegerToken,
  restoreFiniteCursorState,
  upsertIndexedCatalogEntry,
} from "./state.js";
import {
  SOURCE_SYNC_BATCH_SIZE,
  extractNormalizedLinks,
  fetchRequiredText,
  getAllowedOrigins,
  isAllowedOriginUrl,
  parseUrlSet,
  resolveSitemapLeafUrls,
} from "./fetching.js";
import { buildIndexedReferenceItem } from "./references.js";
import type { SourceSyncContext, SourceSyncSourceState } from "./types.js";
import type { AssetKind, CompatibilityMode } from "../../../types.js";
// ─── Sitemap reference source ─────────────────────────────────────────────────

/**
 * Syncs a reference source whose items are discovered via a sitemap. Each leaf
 * sitemap URL set is scanned and matching item URLs are turned into indexed
 * reference catalog entries.
 */
export async function syncSitemapReferenceSource(
  source: SourceDefinition,
  context: SourceSyncContext,
  options: {
    rootSitemapUrl: string;
    leafSitemapPredicate?: (url: URL) => boolean;
    itemUrlPredicate?: (url: URL) => boolean;
    itemAssetKind: AssetKind;
    itemCompatibilityMode: CompatibilityMode;
    itemInstallMethod: string;
    rootUrlExclusions?: Set<string>;
  },
): Promise<SourceSyncSourceState> {
  return syncSitemapSource(source, context, options.rootSitemapUrl, {
    leafSitemapPredicate: options.leafSitemapPredicate,
    itemUrlPredicate: options.itemUrlPredicate,
    buildItem: (url) =>
      buildIndexedReferenceItem(source, context, url, {
        assetKind: options.itemAssetKind,
        compatibilityMode: options.itemCompatibilityMode,
        installMethod: options.itemInstallMethod,
      }),
    rootUrlExclusions: options.rootUrlExclusions,
  });
}

// ─── Sitemap package registry source ─────────────────────────────────────────

/**
 * Syncs a package registry source whose items are discovered via a sitemap.
 * Package names are extracted from each item URL using the caller-supplied
 * `packageNameFromUrl` function.
 */
export async function syncSitemapPackageRegistrySource(
  source: SourceDefinition,
  context: SourceSyncContext,
  options: {
    rootSitemapUrl: string;
    leafSitemapPredicate?: (url: URL) => boolean;
    itemUrlPredicate?: (url: URL) => boolean;
    packageNameFromUrl: (url: URL) => string | undefined;
  },
): Promise<SourceSyncSourceState> {
  return syncSitemapSource(source, context, options.rootSitemapUrl, {
    leafSitemapPredicate: options.leafSitemapPredicate,
    itemUrlPredicate: options.itemUrlPredicate,
    buildItem: (url) => {
      const packageName = options.packageNameFromUrl(url);
      if (!packageName) {
        return null;
      }

      return buildPackageRegistryCatalogEntry(
        source,
        packageName,
        packageName,
        undefined,
        undefined,
        context.demandProfile,
        context.selectionRegistry,
        getPackageRegistryKind(source),
      );
    },
  });
}

// ─── HTML reference source ────────────────────────────────────────────────────

/**
 * Syncs a reference source whose items are discovered by scraping paginated
 * HTML pages. Links matching `options.linkPattern` are turned into indexed
 * reference catalog entries.
 */
export async function syncHtmlReferenceSource(
  source: SourceDefinition,
  context: SourceSyncContext,
  options: {
    pageUrlTemplate: string;
    pageUrlForNumber?: (pageNumber: number) => string;
    linkPattern: RegExp;
    itemAssetKind: AssetKind;
    itemCompatibilityMode: CompatibilityMode;
    itemInstallMethod: string;
    rootUrlExclusions?: Set<string>;
  },
): Promise<SourceSyncSourceState> {
  return syncHtmlListSource(
    source,
    context,
    options.pageUrlTemplate,
    options.linkPattern,
    {
      pageUrlForNumber: options.pageUrlForNumber,
      buildItem: (url) =>
        buildIndexedReferenceItem(source, context, url, {
          assetKind: options.itemAssetKind,
          compatibilityMode: options.itemCompatibilityMode,
          installMethod: options.itemInstallMethod,
        }),
      rootUrlExclusions: options.rootUrlExclusions,
    },
  );
}

// ─── HTML package registry source ────────────────────────────────────────────

/**
 * Syncs a package registry source whose items are discovered by scraping
 * paginated HTML pages. Package names are extracted from matched link URLs
 * using the caller-supplied `packageNameFromPath` function.
 */
export async function syncHtmlPackageRegistrySource(
  source: SourceDefinition,
  context: SourceSyncContext,
  options: {
    pageUrlTemplate: string;
    pageUrlForNumber?: (pageNumber: number) => string;
    linkPattern: RegExp;
    packageNameFromPath: (url: URL) => string | undefined;
  },
): Promise<SourceSyncSourceState> {
  return syncHtmlListSource(
    source,
    context,
    options.pageUrlTemplate,
    options.linkPattern,
    {
      pageUrlForNumber: options.pageUrlForNumber,
      buildItem: (url) => {
        const packageName = options.packageNameFromPath(url);
        if (!packageName) {
          return null;
        }

        return buildPackageRegistryCatalogEntry(
          source,
          packageName,
          packageName,
          undefined,
          undefined,
          context.demandProfile,
          context.selectionRegistry,
          getPackageRegistryKind(source),
        );
      },
    },
  );
}

// ─── Generic sitemap driver ───────────────────────────────────────────────────

/**
 * Generic sitemap-driven sync engine. Fetches the root sitemap index, iterates
 * leaf sitemaps with per-cursor resumable pagination, and calls `buildItem` for
 * each discovered URL. Used by typed wrappers above.
 */
export async function syncSitemapSource(
  source: SourceDefinition,
  context: SourceSyncContext,
  rootSitemapUrl: string,
  options: {
    leafSitemapPredicate?: (url: URL) => boolean;
    itemUrlPredicate?: (url: URL) => boolean;
    buildItem: (url: URL) => AssetCatalogEntry | null;
    rootUrlExclusions?: Set<string>;
  },
): Promise<SourceSyncSourceState> {
  const allowedOrigins = getAllowedOrigins(
    rootSitemapUrl,
    source.endpoints.baseUrl,
  );
  const leafSitemapUrls = await resolveSitemapLeafUrls(
    rootSitemapUrl,
    allowedOrigins,
    options.leafSitemapPredicate,
  );
  const previousStateByCursor = new Map(
    getPreviousCursorStates(context.previousState).map((cursor) => [
      cursor.cursorId,
      cursor,
    ]),
  );
  const nextCursors: Array<{
    cursorId: string;
    nextToken: string;
    completed: boolean;
  }> = [];
  let remainingPageBudget =
    getRuntimeConfig().discovery.sourceSyncMaxPagesPerRun;
  let status: "complete" | "partial" | "failed" =
    leafSitemapUrls.length > 0 ? "complete" : "failed";

  for (const sitemapUrl of leafSitemapUrls) {
    const previousCursor = restoreFiniteCursorState(
      previousStateByCursor.get(sitemapUrl),
      {
        cursorId: sitemapUrl,
        nextToken: "0",
        completed: false,
      },
    );
    let nextOffset = parseNonNegativeIntegerToken(previousCursor.nextToken, 0);
    let completed = previousCursor.completed;

    if (!completed && remainingPageBudget > 0) {
      const xml = await fetchRequiredText(sitemapUrl, allowedOrigins);
      const itemUrls = parseUrlSet(xml, sitemapUrl)
        .filter((url) => isAllowedOriginUrl(url, allowedOrigins))
        .filter((url) => options.itemUrlPredicate?.(url) ?? true)
        .filter((url) => !options.rootUrlExclusions?.has(url.toString()));
      const pageItems = itemUrls.slice(
        nextOffset,
        nextOffset + SOURCE_SYNC_BATCH_SIZE,
      );

      for (const itemUrl of pageItems) {
        const entry = options.buildItem(itemUrl);
        if (entry) {
          upsertIndexedCatalogEntry(context, entry);
        }
      }

      nextOffset += pageItems.length;
      completed = nextOffset >= itemUrls.length;
      remainingPageBudget -= 1;
    }

    if (!completed) {
      status = "partial";
    }

    nextCursors.push({
      cursorId: sitemapUrl,
      nextToken: String(nextOffset),
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

// ─── Generic paginated HTML driver ───────────────────────────────────────────

/**
 * Generic paginated HTML sync engine. Iterates numbered pages of a URL
 * template, extracts links matching `linkPattern`, and calls `buildItem` for
 * each. Stops when a page returns no new links or the page budget is exhausted.
 */
export async function syncHtmlListSource(
  source: SourceDefinition,
  context: SourceSyncContext,
  pageUrlTemplate: string,
  linkPattern: RegExp,
  options: {
    buildItem: (url: URL) => AssetCatalogEntry | null;
    pageUrlForNumber?: (pageNumber: number) => string;
    rootUrlExclusions?: Set<string>;
  },
): Promise<SourceSyncSourceState> {
  const previousCursor = restoreFiniteCursorState(
    getPreviousCursorStates(context.previousState)[0],
    {
      cursorId: "page",
      nextToken: "1",
      completed: false,
    },
  );
  const allowedOrigins = getAllowedOrigins(
    pageUrlTemplate.replace("{page}", "1"),
    source.endpoints.baseUrl,
  );
  let pageNumber = parsePositiveIntegerToken(previousCursor.nextToken, 1);
  let completed = previousCursor.completed;
  let reason: string | undefined;
  let synchronizedPages = 0;
  const existingIndexedEntryCount = countEntriesForSource(
    context.entriesById,
    source.id,
  );

  for (
    let pageCount = 0;
    pageCount < getRuntimeConfig().discovery.sourceSyncMaxPagesPerRun &&
    !completed;
    pageCount += 1
  ) {
    const pageUrl =
      options.pageUrlForNumber?.(pageNumber) ??
      pageUrlTemplate.replace("{page}", String(pageNumber));
    let html: string;

    try {
      html = await fetchRequiredText(pageUrl, allowedOrigins);
    } catch (error) {
      if (synchronizedPages === 0 && existingIndexedEntryCount === 0) {
        throw error;
      }
      reason = error instanceof Error ? error.message : String(error);
      break;
    }

    const pageLinks = extractNormalizedLinks(
      html,
      pageUrl,
      allowedOrigins,
      linkPattern,
    ).filter((url) => !options.rootUrlExclusions?.has(url.toString()));

    for (const pageLink of pageLinks) {
      const entry = options.buildItem(pageLink);
      if (entry) {
        upsertIndexedCatalogEntry(context, entry);
      }
    }

    synchronizedPages += 1;

    if (pageLinks.length === 0 || !html.includes(`page=${pageNumber + 1}`)) {
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
    reason,
    cursors: [
      {
        cursorId: "page",
        nextToken: String(pageNumber),
        completed,
      },
    ],
  };
}
