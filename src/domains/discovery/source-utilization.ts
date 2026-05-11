import { join } from "node:path";

import { writeJsonFile } from "../../files.js";
import type {
  AssetCatalogEntry,
  SourceCoverageMode,
  SourceDefinition,
  SourceSyncStatus,
} from "../../types.js";
import type { SourceSyncState } from "./source-sync.js";
import { countBy } from "./catalog-utils.js";
import { SOURCE_UTILIZATION_OUTPUT_PATH } from "./output-paths.js";

/**
 * Writes source utilization report to project state.
 */
export async function writeSourceUtilizationReport(
  projectRoot: string,
  enabledSources: SourceDefinition[],
  catalogEntries: AssetCatalogEntry[],
  sourceSyncState?: SourceSyncState,
): Promise<void> {
  const catalogEntriesBySource = new Map<string, AssetCatalogEntry[]>();
  for (const entry of catalogEntries) {
    const sourceEntries = catalogEntriesBySource.get(entry.source.sourceId);
    if (sourceEntries) {
      sourceEntries.push(entry);
    } else {
      catalogEntriesBySource.set(entry.source.sourceId, [entry]);
    }
  }

  const sourceSyncById = new Map(
    (sourceSyncState?.sources ?? []).map((source) => [source.sourceId, source]),
  );
  const sources = enabledSources.map((source) => {
    const sourceEntries = catalogEntriesBySource.get(source.id) ?? [];
    const operationalEntries = sourceEntries.filter((entry) =>
      isOperationalCatalogEntry(entry),
    );
    const syncState = sourceSyncById.get(source.id);
    return {
      id: source.id,
      kind: source.kind,
      configured: true,
      operational: operationalEntries.length > 0,
      harvestedEntries: sourceEntries.length,
      indexedEntries: syncState?.indexedEntryCount ?? 0,
      coverageMode:
        syncState?.coverageMode ??
        defaultCoverageModeForSourceKind(source.kind),
      syncStatus:
        syncState?.status ?? defaultSyncStatusForSourceKind(source.kind),
      operationalEntries: operationalEntries.length,
      status:
        operationalEntries.length > 0
          ? "active"
          : sourceEntries.length > 0
            ? "reference-only"
            : "dormant",
    };
  });

  await writeJsonFile(join(projectRoot, ...SOURCE_UTILIZATION_OUTPUT_PATH), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    configuredSourceCount: enabledSources.length,
    operationalSourceCount: sources.filter((source) => source.operational)
      .length,
    dormantSourceCount: sources.filter((source) => source.status === "dormant")
      .length,
    byKind: countBy(enabledSources, (source) => source.kind),
    harvestedByKind: countBy(
      catalogEntries,
      (entry) => entry.source.sourceKind,
    ),
    sources,
  });
}

function defaultCoverageModeForSourceKind(
  kind: SourceDefinition["kind"],
): SourceCoverageMode {
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

function defaultSyncStatusForSourceKind(
  kind: SourceDefinition["kind"],
): SourceSyncStatus {
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

function isOperationalCatalogEntry(entry: AssetCatalogEntry): boolean {
  return (
    entry.evidence.manifestFound ||
    entry.status.mirrorEligible ||
    entry.status.installEligible ||
    entry.status.activationEligible
  );
}
