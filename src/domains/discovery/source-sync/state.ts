/**
 * State and cursor management for source-sync.
 *
 * Owns: loading/writing SourceSyncState, cursor restoration, legacy query
 * migration, token parsing, and entry count helpers. These are the only
 * functions that touch the on-disk sync state files directly.
 */

import { join } from "node:path";

import {
  pathExists,
  readJsonFileOrNull,
  readJsonLinesFile,
  writeJsonFile,
  writeJsonLinesFile,
} from "../../../files.js";
import { assertAssetCatalogEntry } from "../../../manifest-validation.js";
import type { AssetCatalogEntry } from "../../../types.js";
import {
  SOURCE_SYNC_ENTRIES_OUTPUT_PATH,
  SOURCE_SYNC_REPORT_OUTPUT_PATH,
  SOURCE_SYNC_STATE_OUTPUT_PATH,
} from "../output-paths.js";

import type {
  LegacySourceSyncQueryState,
  SourceSyncContext,
  SourceSyncCursorState,
  SourceSyncSourceState,
  SourceSyncState,
} from "./types.js";
import { getRuntimeConfig } from "../../../config/runtime.js";

// ─── State I/O ────────────────────────────────────────────────────────────────

/**
 * Loads persisted source sync state from disk.
 * Returns a zeroed state when no file exists.
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
 * Writes the resolved sync state and (when dirty or missing) entries to disk,
 * then emits a human-readable summary to stdout.
 */
export async function persistSourceSyncResults(
  projectRoot: string,
  nextState: SourceSyncState,
  entriesById: Map<string, AssetCatalogEntry>,
  entriesDirty: boolean,
): Promise<void> {
  const entriesPath = join(projectRoot, ...SOURCE_SYNC_ENTRIES_OUTPUT_PATH);
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

/**
 * Returns the source ids that should be treated as indexed during catalog
 * generation (partial or complete indexed sources).
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

// ─── Cursor helpers ───────────────────────────────────────────────────────────

/**
 * Returns the current cursor states for a source, migrating from the legacy
 * query-based format when no cursor array is present.
 */
export function getPreviousCursorStates(
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

/**
 * Restores a cursor from previous state for a finite (completable) source,
 * resetting it to the initial position when the previous cursor is completed.
 */
export function restoreFiniteCursorState(
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

// ─── Entry helpers ────────────────────────────────────────────────────────────

/**
 * Counts catalog entries attributed to a specific source.
 */
export function countEntriesForSource(
  entriesById: Map<string, AssetCatalogEntry>,
  sourceId: string,
): number {
  return [...entriesById.values()].filter(
    (entry) => entry.source.sourceId === sourceId,
  ).length;
}

/**
 * Upserts a catalog entry into the context map, marking the context dirty
 * only when the entry is genuinely new or changed.
 */
export function upsertIndexedCatalogEntry(
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

/**
 * Explicitly removes a single indexed catalog entry by ID, recording the
 * catalog as dirty so the change is persisted. Used by adapters that receive
 * explicit delete signals from their upstream feed (e.g. npm changes feed).
 */
export function deleteIndexedCatalogEntry(
  context: SourceSyncContext,
  entryId: string,
): void {
  if (context.entriesById.has(entryId)) {
    context.entriesById.delete(entryId);
    context.entriesDirty = true;
  }
}

/**
 * Returns true when all cursors from the previous sync state have
 * `completed: true`, or when there is no previous state at all.
 *
 * Used by the orchestrator to decide whether this run constitutes a fresh
 * full re-scan (all cursors were reset to their initial positions). Only when
 * every cursor started from scratch can we trust that `observedEntryIds`
 * covers the entire source and safely prune missing entries.
 */
export function allPreviousCursorsCompleted(
  previousState: SourceSyncSourceState | undefined,
): boolean {
  if (!previousState) {
    return true;
  }

  const cursors = getPreviousCursorStates(previousState);
  return cursors.length === 0 || cursors.every((cursor) => cursor.completed);
}

/**
 * Removes indexed entries for a source that were not observed in the latest
 * sync run, keeping the catalog accurate after item deletions upstream.
 */
export function pruneMissingIndexedEntriesForSource(
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

// ─── Structural equality ──────────────────────────────────────────────────────

/**
 * Returns true when two indexed catalog entries are structurally equal,
 * independent of property key order.
 */
export function areIndexedCatalogEntriesEqual(
  left: AssetCatalogEntry,
  right: AssetCatalogEntry,
): boolean {
  return stableStringify(left) === stableStringify(right);
}

/**
 * Serializes `value` to JSON with all object keys sorted recursively, producing
 * a stable string suitable for deep-equality comparisons.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

/**
 * Recursively sorts the keys of every plain object within `value`, returning a
 * structurally equivalent value with deterministic key order.
 */
export function sortJsonValue(value: unknown): unknown {
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

// ─── Token parsing ────────────────────────────────────────────────────────────

/**
 * Parses `value` as a base-10 positive integer, returning `fallback` when the
 * value is absent, non-numeric, or not strictly positive.
 */
export function parsePositiveIntegerToken(
  value: string | undefined,
  fallback: number,
): number {
  const parsedValue = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback;
}

/**
 * Parses `value` as a base-10 non-negative integer, returning `fallback` when
 * the value is absent, non-numeric, or negative.
 */
export function parseNonNegativeIntegerToken(
  value: string | undefined,
  fallback: number,
): number {
  const parsedValue = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsedValue) && parsedValue >= 0
    ? parsedValue
    : fallback;
}

/**
 * Returns the effective max pages per source-sync run for the given context.
 *
 * Prefers `context.maxPagesPerRunOverride` when set (used by `discover index`
 * to raise the cap for a full-index build without mutating `process.env`).
 * Falls back to the runtime config value.
 */
export function getEffectiveMaxPagesPerRun(context: SourceSyncContext): number {
  return (
    context.maxPagesPerRunOverride ??
    getRuntimeConfig().discovery.sourceSyncMaxPagesPerRun
  );
}
