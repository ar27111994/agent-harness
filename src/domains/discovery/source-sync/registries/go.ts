/**
 * Go module index registry adapter for source-sync.
 *
 * Owns: Go module index feed sync and go-specific cursor management.
 */

import type { SourceDefinition } from "../../../../types.js";
import {
  buildPackageRegistryCatalogEntry,
  requirePackageRegistryKind,
} from "../../package-registry-harvester.js";

import {
  countEntriesForSource,
  getPreviousCursorStates,
  upsertIndexedCatalogEntry,
} from "../state.js";
import {
  SOURCE_SYNC_BATCH_SIZE,
  fetchRequiredText,
  getAllowedOrigins,
  getString,
  isRecord,
} from "../fetching.js";
import type { SourceSyncContext, SourceSyncSourceState } from "../types.js";

/**
 * Syncs the Go module index using the official JSON-lines feed
 * (`index.golang.org/index`) with a timestamp cursor.
 */
export async function syncGoRegistrySource(
  source: SourceDefinition,
  context: SourceSyncContext,
): Promise<SourceSyncSourceState> {
  const previousCursor = getPreviousCursorStates(context.previousState)[0] ?? {
    cursorId: "index",
    nextToken: "1970-01-01T00:00:00Z",
    completed: false,
  };

  const [cursorTimestamp, cursorLastSeenPath] = parseGoCursorToken(
    previousCursor.nextToken,
  );

  const apiUrl = new URL(
    source.endpoints.indexApi ?? "https://index.golang.org/index",
  );
  apiUrl.searchParams.set("since", cursorTimestamp);
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

  let lastTimestamp = cursorTimestamp;
  let lastPath: string | null = cursorLastSeenPath;

  // When resuming mid-timestamp-bucket, skip rows until we pass the last
  // entry we already processed (identified by its module path).
  let pastTieBreaker = cursorLastSeenPath === null;

  for (const row of rows) {
    const packageName = getString(row.Path);
    if (!packageName) {
      continue;
    }
    const timestamp = getString(row.Timestamp) ?? cursorTimestamp;

    // Advance past the tie-breaker boundary on the first row with a new
    // timestamp, or once we've seen the stored lastSeenPath in the same bucket.
    if (!pastTieBreaker) {
      if (timestamp !== cursorTimestamp) {
        // Crossed into a new timestamp bucket — resume normally.
        pastTieBreaker = true;
      } else if (packageName === cursorLastSeenPath) {
        // Found the last-processed entry in the same bucket — all rows after
        // this point are new and should be processed.
        pastTieBreaker = true;
        continue;
      } else {
        // Still inside the already-processed portion of the bucket.
        continue;
      }
    }

    const entry = buildPackageRegistryCatalogEntry(
      source,
      packageName,
      packageName,
      undefined,
      timestamp,
      context.demandProfile,
      context.selectionRegistry,
      requirePackageRegistryKind(source),
    );
    upsertIndexedCatalogEntry(context, entry);
    lastTimestamp = timestamp;
    lastPath = packageName;
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
        nextToken: buildGoCursorToken(lastTimestamp, lastPath),
        completed: false,
      },
    ],
  };
}

/**
 * Encodes a Go index cursor token as `"timestamp|lastSeenPath"` or plain
 * `"timestamp"` when no path has been seen yet. This lets us pack a tie-breaker
 * into the single `nextToken` string without changing the cursor schema.
 */
function buildGoCursorToken(
  timestamp: string,
  lastSeenPath: string | null,
): string {
  if (lastSeenPath === null) {
    return timestamp;
  }
  return `${timestamp}|${lastSeenPath}`;
}

/**
 * Parses a Go index cursor token produced by {@link buildGoCursorToken}.
 * Returns `[timestamp, lastSeenPath]` where `lastSeenPath` is `null` for
 * legacy cursors that only stored a bare timestamp.
 */
function parseGoCursorToken(
  token: string | undefined,
): [string, string | null] {
  const raw = token ?? "1970-01-01T00:00:00Z";
  const pipeIndex = raw.indexOf("|");
  if (pipeIndex === -1) {
    return [raw, null];
  }
  return [raw.slice(0, pipeIndex), raw.slice(pipeIndex + 1)];
}
