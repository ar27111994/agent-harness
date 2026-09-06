/**
 * catalog-generation — demand profile, catalog, and selection output writers
 * for the discover command group (#434).
 *
 * Extracted from discover.ts so the CLI dispatch module stays under the
 * ~600-line real-logic budget: demand scanning, the bounded repo-harvest
 * catalog loop (with the exhaustive per-kind dispatch), and the selection
 * output pipeline (relevance filtering, duplicate grouping, per-source cap,
 * rejection sampling, and the written report set).
 */

import { join } from "node:path";

import { getRuntimeConfig } from "../../config/runtime.js";
import {
  toPosixPath,
  readJsonFile,
  readJsonFileOrNull,
  readJsonLinesFile,
  writeJsonFile,
  writeJsonLinesFile,
} from "../../files.js";
import { buildDemandProfile } from "./demand-profile.js";
import {
  compareSelectionCandidates,
  groupCatalogEntriesForSelection,
  buildRejectionSummary,
  buildSelectionReason,
} from "./catalog-selection.js";
import {
  compareAssetCatalogEntries,
  compareSourcesByPriority,
  enhanceTrustForEntry,
  mergeRemoteCatalogEntries,
} from "./catalog-utils.js";
import {
  REJECTION_SAMPLE_SIZE,
  applyPerSourceCap,
  applyRelevanceFilter,
  buildStratifiedRejectionSample,
  computeAcceptanceRate,
  computeSourceDiversityWarning,
  harvestCatalogSourceEntries,
} from "../../discover-pipeline.js";
import { writeAssetLifecycleFingerprintReport } from "./asset-fingerprints.js";
import { writeSourceCandidateQueue } from "./candidate-queue.js";
import { writeSourceHealthReports } from "./source-health.js";
import type { SourceHealthReport } from "./source-health.js";
import { writeSourceUtilizationReport } from "./source-utilization.js";
import { writeSourceVerificationReport } from "./source-verification.js";
import { writeUnknownSignalReport } from "./unknown-signals.js";
import { harvestGitHubRepoSource } from "./github-harvester.js";
import { harvestOfficialSkillIndexes } from "./official-index-harvester.js";
import {
  getIndexedSourceIds,
  loadIndexedCatalogEntries,
  loadSourceSyncState,
  type SourceSyncState,
} from "./source-sync.js";
import { loadSourceRegistry } from "./source-registry.js";
import {
  CATALOG_OUTPUT_PATH,
  DEMAND_PROFILE_OUTPUT_PATH,
  REJECTED_CATALOG_OUTPUT_PATH,
  REMOTE_CATALOG_STATE_OUTPUT_PATH,
  SELECTED_CATALOG_OUTPUT_PATH,
  SELECTION_REPORT_OUTPUT_PATH,
  UNKNOWN_SIGNALS_OUTPUT_PATH,
} from "./output-paths.js";
import {
  loadRemoteHarvestState,
  writeRemoteHarvestState,
} from "./remote-state.js";
import {
  getActiveDeadline,
  assertNotDeadlineExceeded,
} from "../../lib/deadline.js";
import {
  assertAssetCatalogEntry,
  assertDemandProfile,
  assertSelectionRegistry,
} from "../../manifest-validation.js";
import { isGitHubRepoSource } from "../../github.js";

import type {
  AssetCatalogEntry,
  DemandProfile,
  SelectionDuplicateDecision,
  SelectionRegistry,
  SelectionReport,
  SourceDefinition,
} from "../../types.js";

/**
 * Appends entries into a target array in place.
 */
function appendCatalogEntries(
  target: AssetCatalogEntry[],
  entries: readonly AssetCatalogEntry[],
): void {
  for (const entry of entries) {
    target.push(entry);
  }
}

/**
 * Scans the workspace for demand signals, writes the demand profile and the
 * unknown-signal backlog, and returns the profile for downstream phases.
 */
export async function generateDemandProfile(
  scanRoot: string,
  projectRoot: string,
  maxBytes?: number,
): Promise<DemandProfile> {
  const demandProfile = await buildDemandProfile(scanRoot, { maxBytes });
  const outputPath = join(projectRoot, ...DEMAND_PROFILE_OUTPUT_PATH);
  await writeJsonFile(outputPath, demandProfile);

  const unknownSignalsOutputPath = join(
    projectRoot,
    ...UNKNOWN_SIGNALS_OUTPUT_PATH,
  );
  const unknownSignalsReport = await writeUnknownSignalReport(
    scanRoot,
    unknownSignalsOutputPath,
  );

  console.log(`Demand profile written to ${toPosixPath(outputPath)}`);
  console.log(
    `Unknown signal backlog written to ${toPosixPath(unknownSignalsOutputPath)} (${unknownSignalsReport.summary.signalCount} signals)`,
  );
  return demandProfile;
}

/**
 * Builds the discovery catalog: harvests non-repo sources through the
 * exhaustive per-kind dispatcher, runs the bounded repo-harvest batch from
 * the persisted offset, merges cached remote entries, enriches trust, and
 * writes the sorted catalog plus utilization and remote-harvest state.
 */
export async function generateCatalog(projectRoot: string): Promise<{
  catalogEntries: AssetCatalogEntry[];
  enabledSources: SourceDefinition[];
  sourceSyncState: SourceSyncState;
}> {
  const sourceRegistry = await loadSourceRegistry(projectRoot);
  const selectionRegistry = await readJsonFile<SelectionRegistry>(
    join(projectRoot, "discover", "selections.json"),
    assertSelectionRegistry,
  );
  const demandProfile = await readJsonFileOrNull<DemandProfile>(
    join(projectRoot, "discover", "output", "demand-profile.json"),
    assertDemandProfile,
  );
  const enabledSources = sourceRegistry.sources
    .filter((source) => source.enabled)
    .sort(compareSourcesByPriority);
  const sourceSyncState = await loadSourceSyncState(projectRoot);
  const indexedSourceIds = getIndexedSourceIds(sourceSyncState);
  const indexedCatalogEntries = await loadIndexedCatalogEntries(projectRoot);
  const indexedCatalogEntriesBySourceId = new Map<
    string,
    AssetCatalogEntry[]
  >();
  for (const entry of indexedCatalogEntries) {
    const sourceEntries = indexedCatalogEntriesBySourceId.get(
      entry.source.sourceId,
    );
    if (sourceEntries) {
      sourceEntries.push(entry);
    } else {
      indexedCatalogEntriesBySourceId.set(entry.source.sourceId, [entry]);
    }
  }
  const remoteHarvestState = await loadRemoteHarvestState(projectRoot);
  const repoBatchSize = getRuntimeConfig().batches.remoteHarvest;
  const cachedRemoteCatalogEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...REMOTE_CATALOG_STATE_OUTPUT_PATH),
    assertAssetCatalogEntry,
  );

  const catalogEntries: AssetCatalogEntry[] = [];
  const repoSources = enabledSources.filter(
    (source): source is SourceDefinition & { kind: "repo" } =>
      source.kind === "repo",
  );
  // Narrow the element type to the non-repo union so the per-source switch
  // below can carry a compile-time exhaustiveness check (satisfies never).
  const nonRepoSources = enabledSources.filter(
    (
      source,
    ): source is SourceDefinition & {
      kind: Exclude<SourceDefinition["kind"], "repo">;
    } => source.kind !== "repo",
  );

  const repoSlice = repoSources.slice(
    remoteHarvestState.nextRepoOffset,
    remoteHarvestState.nextRepoOffset + repoBatchSize,
  );
  const scheduledSourceCount = nonRepoSources.length + repoSlice.length;
  let processedSources = 0;
  const deadline = getActiveDeadline();

  process.stderr.write(
    `[discover catalog] Scheduled ${scheduledSourceCount} source(s) this pass from ${enabledSources.length} enabled asset-producing sources (${repoSlice.length}/${repoSources.length} repo sources in the rotating batch).\n`,
  );

  for (const source of nonRepoSources) {
    processedSources += 1;
    process.stderr.write(
      `[discover catalog] source ${processedSources}/${scheduledSourceCount}: ${source.id} (${source.kind})\n`,
    );
    assertNotDeadlineExceeded(deadline, `discover catalog source ${source.id}`);
    if (indexedSourceIds.has(source.id)) {
      const indexedEntries =
        indexedCatalogEntriesBySourceId.get(source.id) ?? [];
      appendCatalogEntries(catalogEntries, indexedEntries);
      continue;
    }

    appendCatalogEntries(
      catalogEntries,
      await harvestCatalogSourceEntries(
        source,
        source.kind,
        demandProfile,
        selectionRegistry,
        projectRoot,
      ),
    );
  }

  const harvestedRepoEntries: AssetCatalogEntry[] = [];

  for (const source of repoSlice) {
    processedSources += 1;
    process.stderr.write(
      `[discover catalog] source ${processedSources}/${scheduledSourceCount}: ${source.id} (repo)\n`,
    );
    assertNotDeadlineExceeded(deadline, `discover catalog repo ${source.id}`);
    if (isGitHubRepoSource(source)) {
      appendCatalogEntries(
        harvestedRepoEntries,
        await harvestGitHubRepoSource(
          source,
          demandProfile,
          selectionRegistry,
          projectRoot,
        ),
      );
    }
  }

  process.stderr.write(
    `[discover catalog] Local/indexed subtotal: ${catalogEntries.length} entries; freshly harvested repo entries: ${harvestedRepoEntries.length}; merging cached remote state next.\n`,
  );

  const repoSliceSourceIds = new Set(repoSlice.map((source) => source.id));
  const mergedRemoteCatalogEntries = mergeRemoteCatalogEntries(
    cachedRemoteCatalogEntries,
    harvestedRepoEntries,
    repoSliceSourceIds,
  );
  await writeJsonLinesFile(
    join(projectRoot, ...REMOTE_CATALOG_STATE_OUTPUT_PATH),
    mergedRemoteCatalogEntries,
  );

  appendCatalogEntries(catalogEntries, mergedRemoteCatalogEntries);

  appendCatalogEntries(
    catalogEntries,
    await harvestOfficialSkillIndexes(projectRoot, demandProfile),
  );

  const sortedEntries = [
    ...new Map(
      catalogEntries.map((entry) => [entry.id, enhanceTrustForEntry(entry)]),
    ).values(),
  ].sort(compareAssetCatalogEntries);
  const outputPath = join(projectRoot, ...CATALOG_OUTPUT_PATH);
  await writeJsonLinesFile(outputPath, sortedEntries);
  await writeSourceUtilizationReport(
    projectRoot,
    enabledSources,
    sortedEntries,
    sourceSyncState,
  );
  await writeRemoteHarvestState(projectRoot, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    nextRepoOffset:
      remoteHarvestState.nextRepoOffset + repoBatchSize >= repoSources.length
        ? 0
        : remoteHarvestState.nextRepoOffset + repoBatchSize,
    completedSourceIds: repoSlice.map((source) => source.id),
  });

  console.log(
    `Catalog written to ${toPosixPath(outputPath)} (${sortedEntries.length} total deduplicated entries)`,
  );

  return {
    catalogEntries: sortedEntries,
    enabledSources,
    sourceSyncState,
  };
}

/**
 * Runs the selection pipeline: demand-relevance filter, duplicate grouping,
 * per-source cap, stratified rejection sampling, and the written output set
 * (selected/rejected JSONL, selection report, fingerprints, source
 * verification/health reports, candidate queue).
 */
export async function generateSelectionOutputs(
  projectRoot: string,
  options: { quietMode?: boolean; summaryMode?: boolean } = {},
): Promise<{
  selectionReport: SelectionReport;
  selectedEntries: AssetCatalogEntry[];
  rejectedEntries: AssetCatalogEntry[];
  sourceHealthReport: SourceHealthReport;
}> {
  const selectionRegistry = await readJsonFile<SelectionRegistry>(
    join(projectRoot, "discover", "selections.json"),
    assertSelectionRegistry,
  );
  const catalogEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...CATALOG_OUTPUT_PATH),
    assertAssetCatalogEntry,
  );
  const demandProfile = await readJsonFileOrNull<DemandProfile>(
    join(projectRoot, ...DEMAND_PROFILE_OUTPUT_PATH),
    assertDemandProfile,
  );
  const config = getRuntimeConfig();

  const relevanceFilter = await applyRelevanceFilter(
    catalogEntries,
    demandProfile,
    config,
  );
  const groupedEntries = groupCatalogEntriesForSelection(
    relevanceFilter.selectedEntries,
  );
  const selectedEntries: AssetCatalogEntry[] = [];
  // Track rejection reason alongside each rejected entry so we can build
  // rejectionSummary and sampleRejected without a second pass.
  const rejectionLog: Array<{ assetId: string; reason: string }> = [];
  const duplicateDecisions: SelectionDuplicateDecision[] = [];

  for (const entry of relevanceFilter.rejectedEntries) {
    rejectionLog.push({ assetId: entry.id, reason: "demand-relevance" });
  }

  for (const [groupKey, groupEntries] of groupedEntries) {
    const sortedGroupEntries = [...groupEntries].sort((left, right) =>
      compareSelectionCandidates(left, right, selectionRegistry),
    );
    // Groups are guaranteed non-empty (groupCatalogEntriesForSelection only
    // ever pushes onto existing arrays), so the first element is present by
    // construction — no defensive guard needed.
    const selectedEntry = sortedGroupEntries[0];

    selectedEntries.push(selectedEntry);

    if (sortedGroupEntries.length > 1) {
      const rejectedGroupEntries = sortedGroupEntries.slice(1);
      for (const entry of rejectedGroupEntries) {
        rejectionLog.push({ assetId: entry.id, reason: "duplicate" });
      }
      duplicateDecisions.push({
        duplicateGroup: groupKey,
        selectedAssetId: selectedEntry.id,
        rejectedAssetIds: rejectedGroupEntries.map((entry) => entry.id),
        selectionReason: buildSelectionReason(selectedEntry, selectionRegistry),
      });
    }
  }

  // Per-source entry cap — prevent a single source from dominating the
  // selected set. Sort by descending source priority first so higher-quality
  // entries are retained when the cap removes lower-quality same-source entries.
  selectedEntries.sort(
    (a, b) => b.source.sourcePriority - a.source.sourcePriority,
  );
  const MAX_ENTRIES_PER_SOURCE = config.discovery.maxEntriesPerSource;
  const { kept: cappedSelectedEntries, capped: capRejections } =
    applyPerSourceCap(selectedEntries, MAX_ENTRIES_PER_SOURCE);
  for (const { assetId } of capRejections) {
    rejectionLog.push({ assetId, reason: "source-cap" });
  }
  const sourceDiversityWarning = computeSourceDiversityWarning(
    cappedSelectedEntries,
    MAX_ENTRIES_PER_SOURCE,
  );

  // Derive the flat rejected-entries list from the log so we have a single
  // source of truth (the log) driving both the JSONL output and the report.
  // Filter directly over catalogEntries using the id set — avoids allocating
  // a full-catalog [id, entry][] tuple array and a throwaway Map.
  const rejectedEntryIds = new Set(rejectionLog.map((r) => r.assetId));
  const rejectedEntries = catalogEntries.filter((e) =>
    rejectedEntryIds.has(e.id),
  );

  // Build rejectionSummary — stable reason → count covering 100% of rejections.
  const rejectionSummary = buildRejectionSummary(rejectionLog);

  // sampleRejected — stratified sample of up to REJECTION_SAMPLE_SIZE entries,
  // guaranteeing at least one entry per distinct rejection reason.
  const sampleRejected = buildStratifiedRejectionSample(
    rejectionLog,
    REJECTION_SAMPLE_SIZE,
  );

  const sortedSelectedEntries = cappedSelectedEntries.sort(
    compareAssetCatalogEntries,
  );
  const sortedRejectedEntries = rejectedEntries.sort(
    compareAssetCatalogEntries,
  );
  const selectionReport: SelectionReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputCount: catalogEntries.length,
    selectedCount: sortedSelectedEntries.length,
    rejectedCount: sortedRejectedEntries.length,
    acceptanceRate: computeAcceptanceRate(
      catalogEntries.length,
      sortedSelectedEntries.length,
    ),
    duplicateDecisions: duplicateDecisions.sort((left, right) =>
      left.duplicateGroup.localeCompare(right.duplicateGroup),
    ),
    rejectionSummary,
    sampleRejected,
    ...(sourceDiversityWarning !== undefined ? { sourceDiversityWarning } : {}),
  };

  await writeJsonLinesFile(
    join(projectRoot, ...SELECTED_CATALOG_OUTPUT_PATH),
    sortedSelectedEntries,
  );
  await writeJsonLinesFile(
    join(projectRoot, ...REJECTED_CATALOG_OUTPUT_PATH),
    sortedRejectedEntries,
  );
  await writeJsonFile(
    join(projectRoot, ...SELECTION_REPORT_OUTPUT_PATH),
    selectionReport,
  );
  const fingerprintReport =
    await writeAssetLifecycleFingerprintReport(projectRoot);
  const sourceRegistry = await loadSourceRegistry(projectRoot);
  const sourceVerificationReport = await writeSourceVerificationReport(
    projectRoot,
    sourceRegistry.sources,
  );
  const sourceSyncState = await loadSourceSyncState(projectRoot);
  const enabledSources = sourceRegistry.sources.filter(
    (source) => source.enabled,
  );
  const sourceHealthReport = await writeSourceHealthReports(
    projectRoot,
    enabledSources,
    sortedSelectedEntries,
    sortedRejectedEntries,
    sourceSyncState,
  );
  const sourceCandidateQueue = await writeSourceCandidateQueue(
    projectRoot,
    enabledSources,
  );

  console.log(
    `Selection outputs written to ${toPosixPath(join(projectRoot, "discover", "output"))} (${sortedSelectedEntries.length} selected, ${sortedRejectedEntries.length} rejected)`,
  );
  console.log(
    `Asset lifecycle fingerprints written (${fingerprintReport.assetCount} assets, ${fingerprintReport.duplicateGroupCount} duplicate groups)`,
  );
  console.log(
    `Source verification report written (${sourceVerificationReport.demotedSourceCount} deterministic demotions)`,
  );
  if (!options.quietMode && !options.summaryMode) {
    console.log(
      `Source health reports written (${sourceHealthReport.errorCount} errors, ${sourceHealthReport.warningCount} warnings)`,
    );
  }
  console.log(
    `Source candidate queue written (${sourceCandidateQueue.candidateCount} candidates, ${sourceCandidateQueue.reviewRequiredCount} review-required)`,
  );

  return {
    selectionReport,
    selectedEntries: sortedSelectedEntries,
    rejectedEntries: sortedRejectedEntries,
    sourceHealthReport,
  };
}
