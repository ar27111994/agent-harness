/**
 * source-sync orchestrator.
 *
 * Owns: the `syncIndexedSources` driver loop, `synchronizeIndexedSource`
 * dispatch table, and the three public query helpers that callers outside this
 * module need (`loadSourceSyncState`, `getIndexedSourceIds`,
 * `loadIndexedCatalogEntries`).
 *
 * All per-source logic is delegated to the sub-modules under this directory:
 *   state.ts       – state I/O, cursor helpers, entry upsert/prune
 *   fetching.ts    – SSRF-safe fetch, URL helpers, sitemap/HTML parsing
 *   references.ts  – URL→catalog entry construction, package name extractors
 *   reporting.ts   – non-indexed source classification
 *   html.ts        – generic sitemap and paginated HTML sync drivers
 *   registries/    – one adapter per registry / marketplace
 */

import { join } from "node:path";

import {
  readJsonFile,
  readJsonFileOrNull,
  readJsonLinesFile,
} from "../../../files.js";
import {
  assertAssetCatalogEntry,
  assertDemandProfile,
  assertSelectionRegistry,
} from "../../../manifest-validation.js";
import type {
  AssetCatalogEntry,
  DemandProfile,
  SelectionRegistry,
  SourceDefinition,
} from "../../../types.js";
import { loadSourceRegistry } from "../source-registry.js";
import { loadRemoteHarvestState } from "../remote-state.js";
import { SOURCE_SYNC_ENTRIES_OUTPUT_PATH } from "../output-paths.js";

import {
  countEntriesForSource,
  getIndexedSourceIds,
  getPreviousCursorStates,
  loadIndexedCatalogEntries,
  loadSourceSyncState,
  persistSourceSyncResults,
  pruneMissingIndexedEntriesForSource,
  allPreviousCursorsCompleted,
} from "./state.js";
import { getErrorMessage } from "./fetching.js";
import { classifyNonIndexedSource } from "./reporting.js";
import {
  extractPypiPackageNameFromUrl,
  extractSwiftPackageNameFromUrl,
  decodePathSegments,
} from "./references.js";
import {
  syncSitemapReferenceSource,
  syncSitemapPackageRegistrySource,
  syncHtmlReferenceSource,
  syncHtmlPackageRegistrySource,
} from "./html.js";
import { syncVsCodeMarketplaceSource } from "./registries/vscode-marketplace.js";
import { syncClawHubPlugins } from "./registries/clawhub.js";
import { syncMcpRegistrySource } from "./registries/mcp-registry.js";
import { syncNpmRegistrySource } from "./registries/npm.js";
import { syncCargoRegistrySource } from "./registries/crates.js";
import { syncGoRegistrySource } from "./registries/go.js";
import { syncMavenRegistrySource } from "./registries/maven.js";
import { syncNuGetRegistrySource } from "./registries/nuget.js";
import { syncPackagistRegistrySource } from "./registries/packagist.js";
import type {
  SourceSyncContext,
  SourceSyncSourceState,
  SourceSyncState,
} from "./types.js";

// Re-export public types and helpers so callers don't need to know the
// internal module layout.
/**
 * Re-exported cursor and state types from the source-sync sub-module tree.
 * Imported here so external callers can use a single import path.
 */
export type {
  SourceSyncCursorState,
  SourceSyncSourceState,
  SourceSyncState,
} from "./types.js";
/**
 * Re-exported state helpers from the source-sync sub-module tree.
 * Imported here so external callers can use a single import path.
 */
export { loadSourceSyncState, getIndexedSourceIds, loadIndexedCatalogEntries };

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Runs persistent indexed source sync for all enabled high-volume sources.
 * Reads previous state from disk, advances cursors by up to
 * `sourceSyncMaxPagesPerRun` pages per source, and writes the updated state,
 * entries, and report back to disk.
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
        allPreviousCursorsCompleted(context.previousState)
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

  await persistSourceSyncResults(
    projectRoot,
    nextState,
    entriesById,
    entriesDirty,
  );
}

// ─── Source dispatch table ────────────────────────────────────────────────────

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
        pageUrlTemplate: `${source.endpoints.baseUrl ?? "https://zed.dev/extensions"}?page={page}`,
        pageUrlForNumber: (pageNumber) => {
          const base = source.endpoints.baseUrl ?? "https://zed.dev/extensions";
          return pageNumber === 1 ? base : `${base}?page=${pageNumber}`;
        },
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
