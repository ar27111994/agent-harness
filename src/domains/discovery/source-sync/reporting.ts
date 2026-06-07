/**
 * Reporting helpers for source-sync.
 *
 * Owns: classification of non-indexed (repo/docs/local) sources into their
 * appropriate coverage mode and status. Used by the orchestrator to produce
 * the sync state report for sources that do not use the persistent indexed
 * sync flow.
 */

import type { SourceDefinition } from "../../../types.js";

import type { SourceSyncSourceState } from "./types.js";

/**
 * Derives a SourceSyncSourceState for a source that is not handled by
 * persistent indexed sync — repo, docs, local-directory, and local-manifest
 * sources all fall into this path.
 */
export function classifyNonIndexedSource(
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
