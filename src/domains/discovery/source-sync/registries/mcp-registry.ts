/**
 * MCP Registry adapter for source-sync.
 *
 * Owns: paginated MCP registry server list sync, entry construction/filtering,
 * and MCP-specific metadata extraction helpers.
 */

import type { AssetCatalogEntry, SourceDefinition } from "../../../../types.js";
import { buildReferenceSourceCatalogEntry } from "../../reference-source-harvester.js";
import { splitIntoKeywords, uniqueStrings } from "../../catalog-utils.js";

import {
  countEntriesForSource,
  getPreviousCursorStates,
  restoreFiniteCursorState,
  upsertIndexedCatalogEntry,
  getEffectiveMaxPagesPerRun,
} from "../state.js";
import {
  asRecord,
  fetchRequiredJson,
  getAllowedOrigins,
  getString,
} from "../fetching.js";
import type { SourceSyncContext, SourceSyncSourceState } from "../types.js";

/**
 * Syncs the MCP registry using the paginated servers API with a single
 * resumable offset cursor.
 */
export async function syncMcpRegistrySource(
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
    pageCount < getEffectiveMaxPagesPerRun(context) && !completed;
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

/**
 * Constructs an `AssetCatalogEntry` from a raw MCP registry server object.
 * Returns null when the required `name` field is absent or the entry is not
 * the latest version.
 */
export function buildMcpRegistryCatalogEntry(
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

/**
 * Returns true when the raw MCP registry item represents the latest version
 * of its server. Defaults to true when the `isLatest` meta flag is absent.
 */
export function isLatestMcpRegistryEntry(
  item: Record<string, unknown>,
): boolean {
  const meta = asRecord(item._meta);
  const official = asRecord(meta["io.modelcontextprotocol.registry/official"]);
  const isLatest = official.isLatest;
  return typeof isLatest === "boolean" ? isLatest : true;
}

/**
 * Extracts the `updatedAt` / `publishedAt` / `statusChangedAt` timestamp from
 * a raw MCP registry item's official metadata block.
 */
export function getMcpRegistryUpdatedAt(
  item: Record<string, unknown>,
): string | undefined {
  const meta = asRecord(item._meta);
  const official = asRecord(meta["io.modelcontextprotocol.registry/official"]);
  return (
    getString(official.updatedAt) ??
    getString(official.publishedAt) ??
    getString(official.statusChangedAt)
  );
}

/**
 * Constructs a stable origin URL for an MCP registry server by appending the
 * server name as the URL hash fragment.
 */
export function buildMcpRegistryOriginUrl(
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

/**
 * Extracts the list of remote transport type strings from a raw MCP server
 * object's `remotes` array.
 */
export function extractMcpRegistryRemoteTypes(
  server: Record<string, unknown>,
): string[] {
  const remotes = Array.isArray(server.remotes) ? server.remotes : [];
  return remotes
    .map((remote) => asRecord(remote))
    .flatMap((remote) => getString(remote.type) ?? []);
}
