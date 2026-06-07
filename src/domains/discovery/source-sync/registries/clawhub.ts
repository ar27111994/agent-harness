/**
 * ClawHub plugin catalog adapter for source-sync.
 *
 * Owns: server-rendered ClawHub plugin page crawl and single-snapshot cursor.
 */

import type { SourceDefinition } from "../../../../types.js";

import { countEntriesForSource, upsertIndexedCatalogEntry } from "../state.js";
import {
  extractNormalizedLinks,
  getAllowedOrigins,
  fetchRequiredText,
} from "../fetching.js";
import { buildIndexedReferenceItem } from "../references.js";
import type { SourceSyncContext, SourceSyncSourceState } from "../types.js";

/**
 * Syncs the ClawHub plugin catalog by scraping the server-rendered plugin
 * listing page and extracting plugin links.
 */
export async function syncClawHubPlugins(
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
