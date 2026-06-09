import { join } from "node:path";

import { readJsonLinesFile, writeJsonFile } from "../../files.js";
import type { AssetCatalogEntry, SourceDefinition } from "../../types.js";
import {
  CATALOG_MAINTENANCE_CANDIDATES_OUTPUT_PATH,
  CATALOG_OUTPUT_PATH,
  SOURCE_DRIFT_OUTPUT_PATH,
  SOURCE_HEALTH_OUTPUT_PATH,
} from "./output-paths.js";
import type { SourceSyncState } from "./source-sync.js";

/**
 * Describes one source's deterministic health and drift state.
 */
export interface SourceHealthEntry {
  sourceId: string;
  kind: SourceDefinition["kind"];
  authorityTier: SourceDefinition["authorityTier"];
  status:
    | "active"
    | "dormant"
    | "never-synced"
    | "stale"
    | "broken"
    | "ambiguous-trust"
    | "newly-productive";
  severity: "ok" | "warning" | "error";
  coverageMode: string;
  syncStatus: string;
  harvestedEntries: number;
  indexedEntries: number;
  selectedEntries: number;
  rejectedEntries: number;
  duplicateRate: number;
  reasons: string[];
  suggestedAction:
    | "none"
    | "review-source"
    | "refresh-sync"
    | "disable-or-replace"
    | "verify-official-owner";
}

/**
 * Describes deterministic source/catalogue health outputs.
 */
export interface SourceHealthReport {
  schemaVersion: number;
  generatedAt: string;
  sourceCount: number;
  severeCount: number;
  warningCount: number;
  sources: SourceHealthEntry[];
}

/**
 * Writes source health, drift, and maintenance-candidate reports.
 */
export async function writeSourceHealthReports(
  projectRoot: string,
  enabledSources: SourceDefinition[],
  selectedEntries: AssetCatalogEntry[],
  rejectedEntries: AssetCatalogEntry[],
  sourceSyncState?: SourceSyncState,
): Promise<SourceHealthReport> {
  const catalogEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...CATALOG_OUTPUT_PATH),
  );
  const report = buildSourceHealthReport(
    enabledSources,
    catalogEntries,
    selectedEntries,
    rejectedEntries,
    sourceSyncState,
  );
  const drift = {
    schemaVersion: 1,
    generatedAt: report.generatedAt,
    sources: report.sources.filter((source) => source.severity !== "ok"),
  };
  const maintenanceCandidates = {
    schemaVersion: 1,
    generatedAt: report.generatedAt,
    candidates: report.sources.filter(
      (source) => source.suggestedAction !== "none",
    ),
  };

  await writeJsonFile(join(projectRoot, ...SOURCE_HEALTH_OUTPUT_PATH), report);
  await writeJsonFile(join(projectRoot, ...SOURCE_DRIFT_OUTPUT_PATH), drift);
  await writeJsonFile(
    join(projectRoot, ...CATALOG_MAINTENANCE_CANDIDATES_OUTPUT_PATH),
    maintenanceCandidates,
  );

  return report;
}

/**
 * Builds deterministic source/catalogue health from local lifecycle artifacts.
 */
export function buildSourceHealthReport(
  enabledSources: SourceDefinition[],
  catalogEntries: AssetCatalogEntry[],
  selectedEntries: AssetCatalogEntry[],
  rejectedEntries: AssetCatalogEntry[],
  sourceSyncState?: SourceSyncState,
): SourceHealthReport {
  const catalogBySource = groupBySource(catalogEntries);
  const selectedBySource = groupBySource(selectedEntries);
  const rejectedBySource = groupBySource(rejectedEntries);
  const syncBySource = new Map(
    (sourceSyncState?.sources ?? []).map((state) => [state.sourceId, state]),
  );

  const sources = enabledSources
    .map((source) => {
      const catalogCount = catalogBySource.get(source.id)?.length ?? 0;
      const selectedCount = selectedBySource.get(source.id)?.length ?? 0;
      const rejectedCount = rejectedBySource.get(source.id)?.length ?? 0;
      const syncState = syncBySource.get(source.id);
      const duplicateRate = computeDuplicateRate(
        catalogBySource.get(source.id) ?? [],
      );
      const reasons: string[] = [];
      let status: SourceHealthEntry["status"] = "active";
      let severity: SourceHealthEntry["severity"] = "ok";
      let suggestedAction: SourceHealthEntry["suggestedAction"] = "none";

      if (syncState?.status === "failed") {
        status = "broken";
        severity = "error";
        suggestedAction = "refresh-sync";
        reasons.push(syncState.reason ?? "source sync failed");
      } else if (catalogCount === 0) {
        severity = "warning";
        suggestedAction = "review-source";

        if (syncState === undefined) {
          // Source has never been synced in this state root at all.
          // For repo-kind sources this is expected when running from an
          // isolated workspace state root that does not contain the
          // pre-populated GitHub API cache.
          status = "never-synced";
          if (source.kind === "repo") {
            reasons.push(
              "source has never been synced in this state root — " +
                "repo-kind sources require the GitHub API cache to be " +
                "populated first; run: agent-harness discover sync --source " +
                source.id,
            );
          } else {
            reasons.push(
              `source has never been synced in this state root ` +
                `(kind: ${source.kind}); run agent-harness discover sync ` +
                `--source ${source.id} to populate it`,
            );
          }
        } else {
          // Source has been synced before but produced zero catalog entries.
          status = "dormant";
          if (source.kind === "repo") {
            reasons.push(
              "source produced no catalog entries — " +
                "repo-kind sources depend on the GitHub API cache from the " +
                "agent-harness state root; running from an isolated workspace " +
                "state root that lacks this cache will always appear dormant; " +
                "run: agent-harness discover sync --source " +
                source.id,
            );
          } else if (source.kind === "local-directory") {
            reasons.push(
              "local-directory source produced no catalog entries — " +
                "verify the source path exists and contains agent-harness " +
                "manifest files",
            );
          } else if (source.kind === "local-manifest") {
            reasons.push(
              "local-manifest source produced no catalog entries — " +
                "verify the manifest file path is correct and the file is valid",
            );
          } else {
            // package-registry, docs, and any future kind
            reasons.push(
              `${source.kind} source produced no catalog entries on last sync — ` +
                "verify the source configuration and re-run " +
                `agent-harness discover sync --source ${source.id}`,
            );
          }
        }
      } else if (selectedCount === 0 && rejectedCount > 0) {
        status = "stale";
        severity = "warning";
        suggestedAction = "review-source";
        reasons.push("source produced entries but none survived selection");
      }

      if (
        source.authorityTier === "official-first-party" &&
        !source.publisher?.verified
      ) {
        status = "ambiguous-trust";
        severity = "error";
        suggestedAction = "verify-official-owner";
        reasons.push(
          "official-first-party source is not marked publisherVerified",
        );
      }

      if (duplicateRate > 0.5) {
        severity = severity === "error" ? "error" : "warning";
        suggestedAction =
          suggestedAction === "none" ? "review-source" : suggestedAction;
        reasons.push(`duplicate rate is ${(duplicateRate * 100).toFixed(0)}%`);
      }

      return {
        sourceId: source.id,
        kind: source.kind,
        authorityTier: source.authorityTier,
        status,
        severity,
        coverageMode:
          syncState?.coverageMode ?? defaultCoverageMode(source.kind),
        syncStatus: syncState?.status ?? defaultSyncStatus(source.kind),
        harvestedEntries: catalogCount,
        indexedEntries: syncState?.indexedEntryCount ?? 0,
        selectedEntries: selectedCount,
        rejectedEntries: rejectedCount,
        duplicateRate,
        reasons,
        suggestedAction,
      };
    })
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceCount: sources.length,
    severeCount: sources.filter((source) => source.severity === "error").length,
    warningCount: sources.filter((source) => source.severity === "warning")
      .length,
    sources,
  };
}

function groupBySource(
  entries: AssetCatalogEntry[],
): Map<string, AssetCatalogEntry[]> {
  const bySource = new Map<string, AssetCatalogEntry[]>();
  for (const entry of entries) {
    const sourceEntries = bySource.get(entry.source.sourceId) ?? [];
    sourceEntries.push(entry);
    bySource.set(entry.source.sourceId, sourceEntries);
  }
  return bySource;
}

function computeDuplicateRate(entries: AssetCatalogEntry[]): number {
  if (entries.length === 0) {
    return 0;
  }
  const groupCounts = new Map<string, number>();
  for (const { dedupe } of entries) {
    if (dedupe.duplicateGroup !== undefined) {
      groupCounts.set(
        dedupe.duplicateGroup,
        (groupCounts.get(dedupe.duplicateGroup) ?? 0) + 1,
      );
    }
  }
  const duplicateEntries = entries.filter(
    ({ dedupe }) =>
      dedupe.duplicateGroup !== undefined &&
      groupCounts.get(dedupe.duplicateGroup)! > 1,
  );
  return Number((duplicateEntries.length / entries.length).toFixed(4));
}

function defaultCoverageMode(kind: SourceDefinition["kind"]): string {
  if (kind === "repo") {
    return "rotating";
  }
  if (
    kind === "docs" ||
    kind === "local-directory" ||
    kind === "local-manifest"
  ) {
    return "direct";
  }
  return "sampled";
}

function defaultSyncStatus(kind: SourceDefinition["kind"]): string {
  if (
    kind === "repo" ||
    kind === "docs" ||
    kind === "local-directory" ||
    kind === "local-manifest"
  ) {
    return "not-applicable";
  }
  return "unsupported";
}
