import { join } from "node:path";

import { getRuntimeConfig } from "../../config/runtime.js";
import {
  pathExists,
  readJsonFile,
  readJsonFileOrNull,
  readJsonLinesFile,
  writeJsonFile,
  writeJsonLinesFile,
} from "../../files.js";
import { fetchJsonWithGuards, fetchTextWithGuards } from "../../lib/http.js";
import {
  assertAssetCatalogEntry,
  assertDemandProfile,
  assertSelectionRegistry,
} from "../../manifest-validation.js";
import {
  extractRepositoryUrlFromNpmMetadata,
  fetchNpmPackageMetadata,
} from "../../package-registries.js";
import type {
  AssetCatalogEntry,
  AssetKind,
  CompatibilityMode,
  DemandProfile,
  SelectionRegistry,
  SourceCoverageMode,
  SourceDefinition,
  SourceSyncStatus,
} from "../../types.js";
import {
  buildPackageRegistryCatalogEntry,
  getPackageRegistryKind,
} from "./package-registry-harvester.js";
import { loadSourceRegistry } from "./source-registry.js";
import { loadRemoteHarvestState } from "./remote-state.js";
import {
  SOURCE_SYNC_ENTRIES_OUTPUT_PATH,
  SOURCE_SYNC_REPORT_OUTPUT_PATH,
  SOURCE_SYNC_STATE_OUTPUT_PATH,
} from "./output-paths.js";
import {
  fetchVsCodeMarketplaceItemsForQuery,
  selectDemandQueries,
} from "./reference-harvesters.js";
import { splitIntoKeywords, uniqueStrings } from "./catalog-utils.js";
import { buildReferenceSourceCatalogEntry } from "./reference-source-harvester.js";

const SOURCE_SYNC_FETCH_MAX_BYTES = 5_000_000;
const SOURCE_SYNC_LARGE_RESPONSE_MAX_BYTES = 25_000_000;
const SOURCE_SYNC_BATCH_SIZE = 50;
const SOURCE_SYNC_TIMEOUT_MS = 30_000;
const SOURCE_SYNC_HEADERS = {
  Accept: "application/json,text/html,application/xml,text/plain,*/*",
  "User-Agent":
    "agent-harness/1.0 (+https://github.com/ar27111994/agent-harness)",
};

interface LegacySourceSyncQueryState {
  query: string;
  nextPage: number;
  completed: boolean;
}

/**
 * Tracks resumable progress for one source-sync cursor.
 */
export interface SourceSyncCursorState {
  cursorId: string;
  nextToken?: string;
  completed: boolean;
}

/**
 * Records the latest sync outcome for a single configured source.
 */
export interface SourceSyncSourceState {
  sourceId: string;
  coverageMode: SourceCoverageMode;
  status: SourceSyncStatus;
  lastSyncedAt?: string;
  indexedEntryCount: number;
  reason?: string;
  cursors: SourceSyncCursorState[];
}

/**
 * Persists the aggregate source-sync state used by discovery and reporting.
 */
export interface SourceSyncState {
  schemaVersion: 1;
  generatedAt: string;
  sources: SourceSyncSourceState[];
}

interface SourceSyncContext {
  demandProfile: DemandProfile | null;
  selectionRegistry: SelectionRegistry;
  entriesById: Map<string, AssetCatalogEntry>;
  entriesDirty: boolean;
  previousState: SourceSyncSourceState | undefined;
  observedEntryIds: Set<string>;
}

interface IndexedReferenceOptions {
  assetKind: AssetKind;
  compatibilityMode: CompatibilityMode;
  installMethod: string;
  manifestEntry?: string;
  displayName?: string;
  summary?: string;
  lastUpdated?: string;
  installs?: number;
}

interface SourceSyncFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
}

/**
 * Runs persistent indexed source sync for supported high-volume sources.
 */
export async function syncIndexedSources(projectRoot: string): Promise<void> {
  const sourceRegistry = await loadSourceRegistry(projectRoot);
  const selectionRegistry = await readJsonFile<SelectionRegistry>(
    join(projectRoot, "discover", "selections.json"),
    assertSelectionRegistry,
  );
  const demandProfile = await readJsonFileOrNull<DemandProfile>(
    join(projectRoot, "discover", "output", "demand-profile.json"),
    assertDemandProfile,
  );
  const existingState = await loadSourceSyncState(projectRoot);
  const remoteHarvestState = await loadRemoteHarvestState(projectRoot);
  const existingEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...SOURCE_SYNC_ENTRIES_OUTPUT_PATH),
    assertAssetCatalogEntry,
  );
  const entriesById = new Map(
    existingEntries.map((entry) => [entry.id, entry]),
  );
  const entriesPath = join(projectRoot, ...SOURCE_SYNC_ENTRIES_OUTPUT_PATH);
  let entriesDirty = false;
  const sourceStates: SourceSyncSourceState[] = [];

  for (const source of sourceRegistry.sources.filter(
    (entry) => entry.enabled,
  )) {
    const previousState = existingState.sources.find(
      (entry) => entry.sourceId === source.id,
    );
    const context: SourceSyncContext = {
      demandProfile,
      selectionRegistry,
      entriesById,
      entriesDirty: false,
      previousState,
      observedEntryIds: new Set<string>(),
    };

    try {
      const synchronizedState = await synchronizeIndexedSource(source, context);
      if (
        synchronizedState?.coverageMode === "indexed" &&
        synchronizedState.status === "complete" &&
        context.observedEntryIds.size > 0
      ) {
        pruneMissingIndexedEntriesForSource(context, source.id);
        synchronizedState.indexedEntryCount = countEntriesForSource(
          context.entriesById,
          source.id,
        );
      }
      sourceStates.push(
        synchronizedState ??
          classifyNonIndexedSource(
            source,
            remoteHarvestState.generatedAt,
            remoteHarvestState.completedSourceIds.includes(source.id),
          ),
      );
      entriesDirty ||= context.entriesDirty;
    } catch (error) {
      sourceStates.push({
        sourceId: source.id,
        coverageMode: "indexed",
        status: "failed",
        lastSyncedAt: new Date().toISOString(),
        indexedEntryCount: countEntriesForSource(entriesById, source.id),
        reason: getErrorMessage(error),
        cursors: getPreviousCursorStates(previousState),
      });
      entriesDirty ||= context.entriesDirty;
    }
  }

  const nextState: SourceSyncState = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources: sourceStates.sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId),
    ),
  };
  const syncedEntries = [...entriesById.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  await writeJsonFile(
    join(projectRoot, ...SOURCE_SYNC_STATE_OUTPUT_PATH),
    nextState,
  );
  if (entriesDirty || !(await pathExists(entriesPath))) {
    await writeJsonLinesFile(entriesPath, syncedEntries);
  }
  await writeJsonFile(
    join(projectRoot, ...SOURCE_SYNC_REPORT_OUTPUT_PATH),
    nextState,
  );

  process.stdout.write(
    `Source sync written to ${join(projectRoot, ...SOURCE_SYNC_REPORT_OUTPUT_PATH)} (${syncedEntries.length} indexed entries)\n`,
  );
}

function upsertIndexedCatalogEntry(
  context: SourceSyncContext,
  entry: AssetCatalogEntry,
): void {
  context.observedEntryIds.add(entry.id);
  const existingEntry = context.entriesById.get(entry.id);
  if (
    existingEntry !== undefined &&
    areIndexedCatalogEntriesEqual(existingEntry, entry)
  ) {
    return;
  }

  context.entriesById.set(entry.id, entry);
  context.entriesDirty = true;
}

function areIndexedCatalogEntriesEqual(
  left: AssetCatalogEntry,
  right: AssetCatalogEntry,
): boolean {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) => [key, sortJsonValue(entryValue)]),
  );
}

function pruneMissingIndexedEntriesForSource(
  context: SourceSyncContext,
  sourceId: string,
): void {
  for (const [entryId, entry] of context.entriesById.entries()) {
    if (
      entry.source.sourceId === sourceId &&
      !context.observedEntryIds.has(entryId)
    ) {
      context.entriesById.delete(entryId);
      context.entriesDirty = true;
    }
  }
}

/**
 * Loads persisted source sync state.
 */
export async function loadSourceSyncState(
  projectRoot: string,
): Promise<SourceSyncState> {
  return (
    (await readJsonFileOrNull<SourceSyncState>(
      join(projectRoot, ...SOURCE_SYNC_STATE_OUTPUT_PATH),
    )) ?? {
      schemaVersion: 1,
      generatedAt: new Date(0).toISOString(),
      sources: [],
    }
  );
}

/**
 * Returns the source ids that should be treated as indexed during catalog generation.
 */
export function getIndexedSourceIds(state: SourceSyncState): Set<string> {
  return new Set(
    state.sources
      .filter(
        (source) =>
          source.coverageMode === "indexed" &&
          (source.status === "partial" || source.status === "complete"),
      )
      .map((source) => source.sourceId),
  );
}

/**
 * Loads persisted indexed catalog entries.
 */
export async function loadIndexedCatalogEntries(
  projectRoot: string,
): Promise<AssetCatalogEntry[]> {
  return readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...SOURCE_SYNC_ENTRIES_OUTPUT_PATH),
    assertAssetCatalogEntry,
  );
}

async function synchronizeIndexedSource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState | null> {
  switch (source.id) {
    case "vscode-marketplace":
      if (source.kind === "marketplace") {
        return syncVsCodeMarketplaceSource(source, context);
      }
      break;
    case "cursor-marketplace":
      return syncSitemapReferenceSource(source, context, {
        rootSitemapUrl:
          source.endpoints.sitemapUrl ??
          "https://cursor.com/sitemap-marketplace.xml",
        itemAssetKind: "plugin",
        itemCompatibilityMode: "native",
        itemInstallMethod: "cursor-marketplace-index",
        itemUrlPredicate: (url) => url.pathname.startsWith("/marketplace/"),
        rootUrlExclusions: new Set(["https://cursor.com/marketplace"]),
      });
    case "zed-extension-registry":
      return syncHtmlReferenceSource(source, context, {
        pageUrlTemplate:
          source.endpoints.baseUrl ?? "https://zed.dev/extensions",
        linkPattern: /\/extensions\/[^"'\s<>()?#]+/gu,
        itemAssetKind: "extension",
        itemCompatibilityMode: "native",
        itemInstallMethod: "zed-extension-index",
        rootUrlExclusions: new Set(["https://zed.dev/extensions"]),
      });
    case "pi-packages":
      return syncHtmlReferenceSource(source, context, {
        pageUrlTemplate: "https://pi.dev/packages?page={page}",
        pageUrlForNumber: (pageNumber) =>
          pageNumber === 1
            ? (source.endpoints.baseUrl ?? "https://pi.dev/packages")
            : `https://pi.dev/packages?page=${pageNumber}`,
        linkPattern: /\/packages\/[^"'\s<>()?#]+/gu,
        itemAssetKind: "skill",
        itemCompatibilityMode: "native",
        itemInstallMethod: "pi-package-index",
        rootUrlExclusions: new Set(["https://pi.dev/packages"]),
      });
    case "skills-sh":
      return syncSitemapReferenceSource(source, context, {
        rootSitemapUrl:
          source.endpoints.sitemapUrl ?? "https://skills.sh/sitemap.xml",
        leafSitemapPredicate: (url) =>
          /sitemap-(?:skills(?:-\d+)?|agents(?:-\d+)?)\.xml$/u.test(
            url.pathname,
          ),
        itemAssetKind: "skill",
        itemCompatibilityMode: "adaptable",
        itemInstallMethod: "skills-registry-index",
      });
    case "clawhub":
      return syncClawHubPlugins(source, context);
    case "mcp-registry":
      return syncMcpRegistrySource(source, context);
    case "npm-registry":
      return syncNpmRegistrySource(source, context);
    case "pypi-registry":
      return syncSitemapPackageRegistrySource(source, context, {
        rootSitemapUrl:
          source.endpoints.sitemapUrl ?? "https://pypi.org/sitemap.xml",
        leafSitemapPredicate: (url) =>
          /\/[0-9a-f]{2}\.sitemap\.xml$/u.test(url.pathname),
        itemUrlPredicate: (url) => url.pathname.startsWith("/project/"),
        packageNameFromUrl: extractPypiPackageNameFromUrl,
      });
    case "cargo-registry":
      return syncCargoRegistrySource(source, context);
    case "go-registry":
      return syncGoRegistrySource(source, context);
    case "maven-registry":
      return syncMavenRegistrySource(source, context);
    case "nuget-registry":
      return syncNuGetRegistrySource(source, context);
    case "rubygems-registry":
      return syncHtmlPackageRegistrySource(source, context, {
        pageUrlTemplate: "https://rubygems.org/gems?page={page}",
        linkPattern: /\/gems\/[^"'\s<>()?#]+/gu,
        packageNameFromPath: (url) => decodePathSegments(url.pathname)[1],
      });
    case "packagist-registry":
      return syncPackagistRegistrySource(source, context);
    case "swift-package-index":
      return syncSitemapPackageRegistrySource(source, context, {
        rootSitemapUrl:
          source.endpoints.sitemapUrl ??
          "https://swiftpackageindex.com/sitemap.xml",
        itemUrlPredicate: (url) => url.pathname !== "/",
        packageNameFromUrl: extractSwiftPackageNameFromUrl,
      });
    default:
      return null;
  }

  return null;
}

function classifyNonIndexedSource(
  source: SourceDefinition,
  remoteHarvestGeneratedAt: string,
  wasRecentlyHarvested: boolean,
): SourceSyncSourceState {
  if (source.kind === "repo") {
    return {
      sourceId: source.id,
      coverageMode: "rotating",
      status: "not-applicable",
      lastSyncedAt: wasRecentlyHarvested ? remoteHarvestGeneratedAt : undefined,
      indexedEntryCount: 0,
      reason:
        "Repo sources are harvested through rotating remote batches, not persistent source-sync indexing.",
      cursors: [],
    };
  }

  if (
    source.kind === "docs" ||
    source.kind === "local-directory" ||
    source.kind === "local-manifest"
  ) {
    return {
      sourceId: source.id,
      coverageMode: "direct",
      status: "not-applicable",
      indexedEntryCount: 0,
      reason:
        "This source is harvested directly during catalog generation and does not use persistent sync state.",
      cursors: [],
    };
  }

  return {
    sourceId: source.id,
    coverageMode: "sampled",
    status: "unsupported",
    indexedEntryCount: 0,
    reason:
      "This source is currently not covered by persistent source-sync indexing.",
    cursors: [],
  };
}

async function syncVsCodeMarketplaceSource(
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
  const nextQueries: SourceSyncCursorState[] = [];
  let status: SourceSyncStatus = "complete";

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

async function syncSitemapReferenceSource(
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

async function syncSitemapPackageRegistrySource(
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

async function syncSitemapSource(
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
  const nextCursors: SourceSyncCursorState[] = [];
  let remainingPageBudget =
    getRuntimeConfig().discovery.sourceSyncMaxPagesPerRun;
  let status: SourceSyncStatus =
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

async function syncHtmlReferenceSource(
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

async function syncHtmlPackageRegistrySource(
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

async function syncHtmlListSource(
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
      reason = getErrorMessage(error);
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

async function syncClawHubPlugins(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const pluginsUrl =
    source.endpoints.pluginsUrl ?? "https://clawhub.ai/plugins?sort=downloads";
  const html = await fetchRequiredText(
    pluginsUrl,
    getAllowedOrigins(pluginsUrl, source.endpoints.baseUrl),
  );
  const pluginLinks = extractNormalizedLinks(
    html,
    pluginsUrl,
    getAllowedOrigins(pluginsUrl),
    /\/plugins\/[^"'\s<>()?#]+/gu,
  ).filter((url) => !url.pathname.endsWith("/publish"));

  for (const pluginLink of pluginLinks) {
    const entry = buildIndexedReferenceItem(source, context, pluginLink, {
      assetKind: "plugin",
      compatibilityMode: "partial",
      installMethod: "clawhub-plugin-index",
    });
    upsertIndexedCatalogEntry(context, entry);
  }

  return {
    sourceId: source.id,
    coverageMode: "indexed",
    status: "partial",
    lastSyncedAt: new Date().toISOString(),
    indexedEntryCount: countEntriesForSource(context.entriesById, source.id),
    reason:
      "ClawHub plugin pages are indexed from the server-rendered catalog. Skill listing still needs a first-class cursor endpoint before this source can be marked complete.",
    cursors: [
      {
        cursorId: "plugins",
        nextToken: undefined,
        completed: true,
      },
    ],
  };
}

async function syncMcpRegistrySource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const previousCursor = restoreFiniteCursorState(
    getPreviousCursorStates(context.previousState)[0],
    {
      cursorId: "cursor",
      nextToken: undefined,
      completed: false,
    },
  );
  const apiUrl =
    source.endpoints.apiUrl ??
    "https://registry.modelcontextprotocol.io/v0/servers";
  const allowedOrigins = getAllowedOrigins(apiUrl, source.endpoints.baseUrl);
  let cursor = previousCursor.nextToken;
  let completed = previousCursor.completed;

  for (
    let pageCount = 0;
    pageCount < getRuntimeConfig().discovery.sourceSyncMaxPagesPerRun &&
    !completed;
    pageCount += 1
  ) {
    const requestUrl = new URL(apiUrl);
    if (cursor) {
      requestUrl.searchParams.set("cursor", cursor);
    }

    const data = await fetchRequiredJson(requestUrl.toString(), allowedOrigins);
    const record = asRecord(data);
    const servers = Array.isArray(record.servers) ? record.servers : [];

    for (const item of servers) {
      const serverRecord = asRecord(item);
      if (!isLatestMcpRegistryEntry(serverRecord)) {
        continue;
      }

      const entry = buildMcpRegistryCatalogEntry(source, context, serverRecord);
      if (entry) {
        upsertIndexedCatalogEntry(context, entry);
      }
    }

    const metadata = asRecord(record.metadata);
    const nextCursor = getString(metadata.nextCursor);
    if (!nextCursor) {
      completed = true;
    }
    cursor = nextCursor;
  }

  return {
    sourceId: source.id,
    coverageMode: "indexed",
    status: completed ? "complete" : "partial",
    lastSyncedAt: new Date().toISOString(),
    indexedEntryCount: countEntriesForSource(context.entriesById, source.id),
    cursors: [
      {
        cursorId: "cursor",
        nextToken: cursor,
        completed,
      },
    ],
  };
}

async function syncNpmRegistrySource(
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

  for (const result of results) {
    const row = asRecord(result);
    const packageName = getString(row.id);
    if (!packageName || row.deleted === true) {
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

async function syncCargoRegistrySource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const previousCursor = restoreFiniteCursorState(
    getPreviousCursorStates(context.previousState)[0],
    {
      cursorId: "page",
      nextToken: "1",
      completed: false,
    },
  );
  let pageNumber = parsePositiveIntegerToken(previousCursor.nextToken, 1);
  let completed = previousCursor.completed;

  for (
    let pageCount = 0;
    pageCount < getRuntimeConfig().discovery.sourceSyncMaxPagesPerRun &&
    !completed;
    pageCount += 1
  ) {
    const apiUrl = new URL(
      source.endpoints.apiUrl ?? "https://crates.io/api/v1/crates",
    );
    apiUrl.searchParams.set("page", String(pageNumber));
    apiUrl.searchParams.set("per_page", String(SOURCE_SYNC_BATCH_SIZE));
    const data = await fetchRequiredJson(
      apiUrl.toString(),
      getAllowedOrigins(apiUrl.toString()),
    );
    const record = asRecord(data);
    const crates = Array.isArray(record.crates) ? record.crates : [];

    for (const item of crates) {
      const crate = asRecord(item);
      const packageName = getString(crate.id) ?? getString(crate.name);
      if (!packageName) {
        continue;
      }

      const entry = buildPackageRegistryCatalogEntry(
        source,
        packageName,
        getString(crate.description) ?? packageName,
        getString(crate.repository) ?? getString(crate.homepage) ?? undefined,
        getString(crate.updated_at) ?? undefined,
        context.demandProfile,
        context.selectionRegistry,
        getPackageRegistryKind(source),
      );
      upsertIndexedCatalogEntry(context, entry);
    }

    if (crates.length < SOURCE_SYNC_BATCH_SIZE) {
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
    cursors: [
      {
        cursorId: "page",
        nextToken: String(pageNumber),
        completed,
      },
    ],
  };
}

async function syncGoRegistrySource(
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

async function syncMavenRegistrySource(
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
    pageCount < getRuntimeConfig().discovery.sourceSyncMaxPagesPerRun &&
    !completed;
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

async function syncNuGetRegistrySource(
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
    pageCount < getRuntimeConfig().discovery.sourceSyncMaxPagesPerRun &&
    !completed;
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

async function syncPackagistRegistrySource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const apiUrl =
    source.endpoints.listApi ?? "https://packagist.org/packages/list.json";
  const data = await fetchRequiredJson(apiUrl, getAllowedOrigins(apiUrl), {
    maxBytes: SOURCE_SYNC_LARGE_RESPONSE_MAX_BYTES,
    timeoutMs: 60_000,
  });
  const record = asRecord(data);
  const packageNames = normalizeStringArray(record.packageNames);

  for (const packageName of packageNames) {
    const entry = buildPackageRegistryCatalogEntry(
      source,
      packageName,
      packageName,
      undefined,
      undefined,
      context.demandProfile,
      context.selectionRegistry,
      getPackageRegistryKind(source),
    );
    upsertIndexedCatalogEntry(context, entry);
  }

  return {
    sourceId: source.id,
    coverageMode: "indexed",
    status: "complete",
    lastSyncedAt: new Date().toISOString(),
    indexedEntryCount: countEntriesForSource(context.entriesById, source.id),
    reason:
      "Packagist exposes the full package-name snapshot through its official list API, so sync can index the registry directly in one pass.",
    cursors: [
      {
        cursorId: "snapshot",
        completed: true,
      },
    ],
  };
}

async function resolveNuGetSearchQueryServiceUrl(
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

function buildMcpRegistryCatalogEntry(
  source: SourceDefinition,
  context: SourceSyncContext,
  item: Record<string, unknown>,
): AssetCatalogEntry | null {
  const server = asRecord(item.server);
  const serverName = getString(server.name);
  if (!serverName) {
    return null;
  }

  const remoteUrls = Array.isArray(server.remotes)
    ? server.remotes
        .map((remote) => asRecord(remote))
        .flatMap((remote) => getString(remote.url) ?? [])
    : [];
  const updatedAt = getMcpRegistryUpdatedAt(item);
  const originUrl = buildMcpRegistryOriginUrl(
    source.endpoints.baseUrl ?? "https://registry.modelcontextprotocol.io/",
    serverName,
    remoteUrls[0],
  );
  const title = getString(server.title);
  const displayName =
    title && title.toLowerCase() !== serverName.toLowerCase()
      ? `${title} (${serverName})`
      : serverName;
  const summary = getString(server.description) ?? displayName;
  const capabilities = uniqueStrings([
    ...splitIntoKeywords(serverName),
    ...splitIntoKeywords(title ?? ""),
    ...splitIntoKeywords(summary),
    ...remoteUrls.flatMap((url) => splitIntoKeywords(url)),
    ...extractMcpRegistryRemoteTypes(server),
    "mcp",
    "registry",
  ]);

  return buildReferenceSourceCatalogEntry(
    source,
    context.demandProfile,
    context.selectionRegistry,
    {
      harvestedItem: {
        displayName,
        originUrl,
        summary,
        capabilities,
        assetKind: "mcp-server",
        compatibilityMode: "native",
        installMethod: "mcp-official-registry",
        manifestEntry: serverName,
        lastUpdated: updatedAt,
      },
    },
  );
}

function isLatestMcpRegistryEntry(item: Record<string, unknown>): boolean {
  const meta = asRecord(item._meta);
  const official = asRecord(meta["io.modelcontextprotocol.registry/official"]);
  const isLatest = official.isLatest;
  return typeof isLatest === "boolean" ? isLatest : true;
}

function getMcpRegistryUpdatedAt(
  item: Record<string, unknown>,
): string | undefined {
  const meta = asRecord(item._meta);
  const official = asRecord(meta["io.modelcontextprotocol.registry/official"]);
  return (
    getString(official.updatedAt) ??
    getString(official.publishedAt) ??
    getString(official.statusChangedAt) ??
    undefined
  );
}

function buildMcpRegistryOriginUrl(
  baseUrl: string,
  serverName: string,
  fallbackUrl: string | undefined,
): string {
  try {
    const url = new URL(baseUrl);
    url.hash = serverName;
    return url.toString();
  } catch {
    return fallbackUrl ?? serverName;
  }
}

function extractMcpRegistryRemoteTypes(
  server: Record<string, unknown>,
): string[] {
  const remotes = Array.isArray(server.remotes) ? server.remotes : [];
  return remotes
    .map((remote) => asRecord(remote))
    .flatMap((remote) => getString(remote.type) ?? []);
}

function buildIndexedReferenceItem(
  source: SourceDefinition,
  context: SourceSyncContext,
  url: URL,
  options: IndexedReferenceOptions,
): AssetCatalogEntry {
  const manifestEntry =
    options.manifestEntry ?? buildManifestEntryFromUrl(url) ?? url.toString();
  return buildReferenceSourceCatalogEntry(
    source,
    context.demandProfile,
    context.selectionRegistry,
    {
      harvestedItem: {
        displayName: options.displayName ?? buildDisplayNameFromUrl(url),
        originUrl: url.toString(),
        summary:
          options.summary ??
          `${source.name} indexed item for ${buildDisplayNameFromUrl(url)}`,
        capabilities: decodePathSegments(url.pathname),
        assetKind: options.assetKind,
        compatibilityMode: options.compatibilityMode,
        installMethod: options.installMethod,
        manifestEntry,
        installs: options.installs,
        lastUpdated: options.lastUpdated,
      },
    },
  );
}

async function fetchRequiredText(
  url: string,
  allowedOrigins: readonly string[],
  options: SourceSyncFetchOptions = {},
): Promise<string> {
  const content = await fetchTextWithGuards(url, {
    allowedOrigins,
    headers: SOURCE_SYNC_HEADERS,
    maxBytes: options.maxBytes ?? SOURCE_SYNC_FETCH_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? SOURCE_SYNC_TIMEOUT_MS,
  });
  if (content === null) {
    throw new Error(`Failed to fetch ${url}`);
  }
  return content;
}

async function fetchRequiredJson(
  url: string,
  allowedOrigins: readonly string[],
  options: SourceSyncFetchOptions = {},
): Promise<unknown> {
  const content = await fetchJsonWithGuards(url, {
    allowedOrigins,
    headers: SOURCE_SYNC_HEADERS,
    maxBytes: options.maxBytes ?? SOURCE_SYNC_FETCH_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? SOURCE_SYNC_TIMEOUT_MS,
  });
  if (content === null) {
    throw new Error(`Failed to fetch ${url}`);
  }
  return content;
}

async function resolveSitemapLeafUrls(
  rootSitemapUrl: string,
  allowedOrigins: readonly string[],
  leafSitemapPredicate?: (url: URL) => boolean,
): Promise<string[]> {
  const xml = await fetchRequiredText(rootSitemapUrl, allowedOrigins);
  const sitemapIndexUrls = parseSitemapIndex(xml, rootSitemapUrl).filter(
    (url) => isAllowedOriginUrl(url, allowedOrigins),
  );

  if (sitemapIndexUrls.length === 0) {
    return [rootSitemapUrl];
  }

  return sitemapIndexUrls
    .filter((url) => (leafSitemapPredicate ? leafSitemapPredicate(url) : true))
    .map((url) => url.toString())
    .sort((left, right) => left.localeCompare(right));
}

function parseSitemapIndex(content: string, baseUrl: string): URL[] {
  return [...content.matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>/giu)].flatMap(
    (match) => toSameOriginUrl(match[1] ?? "", baseUrl),
  );
}

function parseUrlSet(content: string, baseUrl: string): URL[] {
  return [...content.matchAll(/<url>\s*<loc>([^<]+)<\/loc>/giu)].flatMap(
    (match) => toSameOriginUrl(match[1] ?? "", baseUrl),
  );
}

function extractNormalizedLinks(
  content: string,
  baseUrl: string,
  allowedOrigins: readonly string[],
  pattern: RegExp,
): URL[] {
  const matches = [...content.matchAll(pattern)]
    .flatMap((match) => toSameOriginUrl(match[0] ?? "", baseUrl))
    .filter((url) => isAllowedOriginUrl(url, allowedOrigins))
    .map(stripUrlQueryAndHash);
  return dedupeUrls(matches);
}

function toSameOriginUrl(rawUrl: string, baseUrl: string): URL[] {
  try {
    return [stripUrlQueryAndHash(new URL(rawUrl, baseUrl))];
  } catch {
    return [];
  }
}

function stripUrlQueryAndHash(url: URL): URL {
  const normalizedUrl = new URL(url.toString());
  normalizedUrl.hash = "";
  normalizedUrl.search = "";
  return normalizedUrl;
}

function isAllowedOriginUrl(
  url: URL,
  allowedOrigins: readonly string[],
): boolean {
  return allowedOrigins.some(
    (origin) => origin.toLowerCase() === url.origin.toLowerCase(),
  );
}

function dedupeUrls(urls: URL[]): URL[] {
  return [...new Map(urls.map((url) => [url.toString(), url])).values()];
}

function getAllowedOrigins(...urls: Array<string | undefined>): string[] {
  return [
    ...new Set(urls.flatMap((url) => getAllowedOrigin(url)).filter(Boolean)),
  ] as string[];
}

function getAllowedOrigin(url: string | undefined): string[] {
  if (!url) {
    return [];
  }
  try {
    return [new URL(url).origin];
  } catch {
    return [];
  }
}

function getPreviousCursorStates(
  previousState: SourceSyncSourceState | undefined,
): SourceSyncCursorState[] {
  if (!previousState) {
    return [];
  }

  const currentCursors = Array.isArray(previousState.cursors)
    ? previousState.cursors
    : [];
  if (currentCursors.length > 0) {
    return currentCursors;
  }

  const legacyQueries = (
    previousState as SourceSyncSourceState & {
      queries?: LegacySourceSyncQueryState[];
    }
  ).queries;
  return Array.isArray(legacyQueries)
    ? legacyQueries.map((query) => ({
        cursorId: query.query,
        nextToken: String(query.nextPage),
        completed: query.completed,
      }))
    : [];
}

function restoreFiniteCursorState(
  previousCursor: SourceSyncCursorState | undefined,
  initialCursor: SourceSyncCursorState,
): SourceSyncCursorState {
  if (!previousCursor || previousCursor.completed) {
    return { ...initialCursor };
  }

  return {
    cursorId: initialCursor.cursorId,
    nextToken: previousCursor.nextToken ?? initialCursor.nextToken,
    completed: false,
  };
}

function parsePositiveIntegerToken(
  value: string | undefined,
  fallback: number,
): number {
  const parsedValue = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback;
}

function parseNonNegativeIntegerToken(
  value: string | undefined,
  fallback: number,
): number {
  const parsedValue = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsedValue) && parsedValue >= 0
    ? parsedValue
    : fallback;
}

function countEntriesForSource(
  entriesById: Map<string, AssetCatalogEntry>,
  sourceId: string,
): number {
  return [...entriesById.values()].filter(
    (entry) => entry.source.sourceId === sourceId,
  ).length;
}

function buildDisplayNameFromUrl(url: URL): string {
  const segments = decodePathSegments(url.pathname).filter(
    (segment) => segment.length > 0,
  );
  if (segments.length === 0) {
    return url.hostname;
  }

  return segments[segments.length - 1] ?? url.hostname;
}

function buildManifestEntryFromUrl(url: URL): string | undefined {
  const segments = decodePathSegments(url.pathname).filter(
    (segment) => segment.length > 0,
  );
  if (segments.length === 0) {
    return undefined;
  }

  return segments.join("/");
}

function decodePathSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

function extractPypiPackageNameFromUrl(url: URL): string | undefined {
  const segments = decodePathSegments(url.pathname);
  if (segments[0] !== "project") {
    return undefined;
  }
  return segments[1];
}

function extractSwiftPackageNameFromUrl(url: URL): string | undefined {
  const segments = decodePathSegments(url.pathname);
  if (segments.length < 2) {
    return undefined;
  }
  return `${segments[0]}/${segments[1]}`;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringifyUnknown(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
