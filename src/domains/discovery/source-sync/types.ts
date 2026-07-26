/**
 * Types shared across all source-sync sub-modules.
 *
 * These are the stable public contracts used by the orchestrator, registry
 * adapters, and caller modules. Nothing in this file imports from sibling
 * modules; it is the leaf of every import chain inside source-sync/.
 */

import type {
  AssetCatalogEntry,
  AssetKind,
  CompatibilityMode,
  DemandProfile,
  SelectionRegistry,
  SourceCoverageMode,
  SourceSyncStatus,
} from "../../../types.js";

// ─── Re-exported cursor / state types ────────────────────────────────────────

/**
 * Legacy per-query cursor state written by versions before cursor arrays were
 * introduced. Retained only for migration from old state files.
 */
export interface LegacySourceSyncQueryState {
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

// ─── Internal context ────────────────────────────────────────────────────────

/** Mutable per-source context threaded through sync calls. */
export interface SourceSyncContext {
  demandProfile: DemandProfile | null;
  selectionRegistry: SelectionRegistry;
  entriesById: Map<string, AssetCatalogEntry>;
  entriesDirty: boolean;
  previousState: SourceSyncSourceState | undefined;
  observedEntryIds: Set<string>;
  /**
   * Optional override for the maximum pages to fetch per run.
   * When set, takes precedence over `getRuntimeConfig().discovery.sourceSyncMaxPagesPerRun`.
   * Used by `discover index` to raise the cap without mutating `process.env`.
   */
  maxPagesPerRunOverride?: number;
}

// ─── Fetch options ────────────────────────────────────────────────────────────

/** Per-request fetch tuning: byte cap, timeout, and retry options. */
export interface SourceSyncFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  /** Max retry attempts for transient fetch failures (default 3). */
  maxRetries?: number;
  /** Base backoff delay in ms for exponential retry (default 1 000). */
  retryBaseDelayMs?: number;
}

// ─── Reference item options ───────────────────────────────────────────────────

/** Options for building an indexed reference catalog entry from a URL. */
export interface IndexedReferenceOptions {
  assetKind: AssetKind;
  compatibilityMode: CompatibilityMode;
  installMethod: string;
  manifestEntry?: string;
  displayName?: string;
  summary?: string;
  lastUpdated?: string;
  installs?: number;
}
