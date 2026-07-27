/**
 * source-sync — public re-export barrel.
 *
 * The implementation has been decomposed into focused sub-modules under
 * src/domains/discovery/source-sync/. This file is kept as a stable re-export
 * point so that all existing callers continue to import from
 * "./source-sync.js" without modification.
 *
 * Public API:
 *   syncIndexedSources        – top-level driver (called by discover.ts)
 *   loadSourceSyncState       – read persisted state
 *   getIndexedSourceIds       – query helper
 *   loadIndexedCatalogEntries – load persisted entries
 *   SourceSyncState           – aggregate state type
 *   SourceSyncSourceState     – per-source state type
 *   SourceSyncCursorState     – cursor type
 *   sourceSyncInternals       – test escape-hatch (internal functions)
 */

export type {
  SourceSyncCursorState,
  SourceSyncSourceState,
  SourceSyncState,
} from "./source-sync/types.js";

export {
  syncIndexedSources,
  loadSourceSyncState,
  getIndexedSourceIds,
  loadIndexedCatalogEntries,
} from "./source-sync/index.js";

// ─── Test escape-hatch ────────────────────────────────────────────────────────
// `sourceSyncInternals` bundles all internal helper functions that tests reach
// into directly. Callers should treat this as unstable — these are not part of
// the public API contract. Production code must not import from this object.

import {
  areIndexedCatalogEntriesEqual,
  stableStringify,
  sortJsonValue,
  countEntriesForSource,
  getPreviousCursorStates,
  restoreFiniteCursorState,
  parsePositiveIntegerToken,
  parseNonNegativeIntegerToken,
  allPreviousCursorsCompleted,
} from "./source-sync/state.js";
import {
  fetchRequiredText,
  fetchRequiredJson,
  isNonTransientError,
  resolveSitemapLeafUrls,
  parseSitemapIndex,
  parseUrlSet,
  toSameOriginUrl,
  stripUrlQueryAndHash,
  isAllowedOriginUrl,
  dedupeUrls,
  getAllowedOrigins,
  getAllowedOrigin,
  normalizeStringArray,
  asRecord,
  getString,
  getNumber,
  stringifyUnknown,
  getErrorMessage,
  hasHttpStatus,
  NonTransientFetchError,
  fetchWithRetry,
} from "./source-sync/fetching.js";
import {
  buildDisplayNameFromUrl,
  buildIndexedReferenceItem,
  buildManifestEntryFromUrl,
  decodePathSegments,
  extractPypiPackageNameFromUrl,
  extractSwiftPackageNameFromUrl,
} from "./source-sync/references.js";
import { classifyNonIndexedSource } from "./source-sync/reporting.js";
import {
  syncSitemapPackageRegistrySource,
  syncHtmlPackageRegistrySource,
} from "./source-sync/html.js";
import {
  syncMcpRegistrySource,
  buildMcpRegistryCatalogEntry,
  isLatestMcpRegistryEntry,
  getMcpRegistryUpdatedAt,
  buildMcpRegistryOriginUrl,
  extractMcpRegistryRemoteTypes,
} from "./source-sync/registries/mcp-registry.js";
import { syncNpmRegistrySource } from "./source-sync/registries/npm.js";
import { syncCargoRegistrySource } from "./source-sync/registries/crates.js";
import { syncGoRegistrySource } from "./source-sync/registries/go.js";
import { syncMavenRegistrySource } from "./source-sync/registries/maven.js";
import {
  syncNuGetRegistrySource,
  resolveNuGetSearchQueryServiceUrl,
} from "./source-sync/registries/nuget.js";

/**
 * Internal helpers exported for test-only use. Not part of the public API.
 * Allows the test suite to exercise internal logic without importing from
 * internal sub-module paths directly.
 */
export const sourceSyncInternals = {
  areIndexedCatalogEntriesEqual,
  stableStringify,
  sortJsonValue,
  classifyNonIndexedSource,
  resolveNuGetSearchQueryServiceUrl,
  syncSitemapPackageRegistrySource,
  syncHtmlPackageRegistrySource,
  syncMcpRegistrySource,
  syncNpmRegistrySource,
  syncCargoRegistrySource,
  syncGoRegistrySource,
  syncMavenRegistrySource,
  syncNuGetRegistrySource,
  buildMcpRegistryCatalogEntry,
  isLatestMcpRegistryEntry,
  getMcpRegistryUpdatedAt,
  buildMcpRegistryOriginUrl,
  extractMcpRegistryRemoteTypes,
  fetchRequiredText,
  fetchRequiredJson,
  resolveSitemapLeafUrls,
  parseSitemapIndex,
  parseUrlSet,
  toSameOriginUrl,
  stripUrlQueryAndHash,
  isAllowedOriginUrl,
  dedupeUrls,
  getAllowedOrigins,
  getAllowedOrigin,
  getPreviousCursorStates,
  restoreFiniteCursorState,
  parsePositiveIntegerToken,
  parseNonNegativeIntegerToken,
  countEntriesForSource,
  buildDisplayNameFromUrl,
  buildIndexedReferenceItem,
  buildManifestEntryFromUrl,
  decodePathSegments,
  extractPypiPackageNameFromUrl,
  extractSwiftPackageNameFromUrl,
  normalizeStringArray,
  asRecord,
  getString,
  getNumber,
  stringifyUnknown,
  getErrorMessage,
  allPreviousCursorsCompleted,
  hasHttpStatus,
  NonTransientFetchError,
  isNonTransientError,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- generic function exported for testing
  fetchWithRetry,
};
