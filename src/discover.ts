import { join } from "node:path";
import { copyFile, mkdir } from "node:fs/promises";

import { isGitHubRepoSource } from "./github.js";
import {
  inspectCatalog,
  printCatalogStats,
} from "./domains/discovery/catalog-inspection.js";
import { printCommandHelp } from "./lib/cli-output.js";

import {
  readJsonFile,
  readJsonLinesFile,
  readJsonFileOrNull,
  toPosixPath,
  writeJsonFile,
  writeJsonLinesFile,
} from "./files.js";
import { getRuntimeConfig } from "./config/runtime.js";
import {
  compareSelectionCandidates,
  filterCatalogEntriesByDemandRelevance,
  groupCatalogEntriesForSelection,
  buildRejectionSummary,
  buildSelectionReason,
} from "./domains/discovery/catalog-selection.js";
import {
  compareAssetCatalogEntries,
  compareSourcesByPriority,
  enhanceTrustForEntry,
  mergeRemoteCatalogEntries,
} from "./domains/discovery/catalog-utils.js";
import {
  orchestrateAiEnrichment,
  type AiEnrichmentOrchestrationResult,
} from "./domains/discovery/ai-enrichment.js";
import { writeAssetLifecycleFingerprintReport } from "./domains/discovery/asset-fingerprints.js";
import { writeSourceCandidateQueue } from "./domains/discovery/candidate-queue.js";
import { buildDemandProfile } from "./domains/discovery/demand-profile.js";
import { writeDiscoverDiffReport } from "./domains/discovery/diff.js";
import { writeEnvironmentIndex } from "./domains/discovery/environment-index.js";
import { writeArdCatalog, getArdPublisherFqdn } from "./ard-catalog.js";
import { harvestGitHubRepoSource } from "./domains/discovery/github-harvester.js";
import { generateSourceIndex } from "./domains/discovery/source-index.js";
import {
  getIndexedSourceIds,
  loadIndexedCatalogEntries,
  loadSourceSyncState,
  syncIndexedSources,
  type SourceSyncState,
} from "./domains/discovery/source-sync.js";
import {
  harvestLocalDirectorySource,
  harvestLocalManifestSource,
} from "./domains/discovery/local-harvesters.js";
import { loadSourceRegistry } from "./domains/discovery/source-registry.js";
import {
  CATALOG_INDEX_OUTPUT_PATH,
  CATALOG_OUTPUT_PATH,
  DEMAND_PROFILE_OUTPUT_PATH,
  REJECTED_CATALOG_OUTPUT_PATH,
  UNKNOWN_SIGNALS_OUTPUT_PATH,
  REMOTE_CATALOG_STATE_OUTPUT_PATH,
  SELECTED_CATALOG_OUTPUT_PATH,
  SELECTION_REPORT_OUTPUT_PATH,
  SOURCE_SYNC_ENTRIES_OUTPUT_PATH,
} from "./domains/discovery/output-paths.js";
import {
  isCatalogIndexFresh,
  writeCatalogIndexMeta,
} from "./domains/discovery/catalog-index.js";
import { harvestOfficialSkillIndexes } from "./domains/discovery/official-index-harvester.js";
import { harvestPackageRegistrySource } from "./domains/discovery/package-registry-harvester.js";
import { harvestReferenceSource } from "./domains/discovery/reference-source-harvester.js";
import {
  loadRemoteHarvestState,
  writeRemoteHarvestState,
} from "./domains/discovery/remote-state.js";
import { writeSourceHealthReports } from "./domains/discovery/source-health.js";
import type { SourceHealthReport } from "./domains/discovery/source-health.js";
import { writeSourceUtilizationReport } from "./domains/discovery/source-utilization.js";
import { writeSourceVerificationReport } from "./domains/discovery/source-verification.js";
import { writeUnknownSignalReport } from "./domains/discovery/unknown-signals.js";
import {
  SemanticScorer,
  buildDemandQueryText,
} from "./domains/discovery/semantic-scoring.js";
import {
  assertAssetCatalogEntry,
  assertDemandProfile,
  assertSelectionRegistry,
} from "./manifest-validation.js";

import type {
  AssetCatalogEntry,
  DemandProfile,
  SelectionDuplicateDecision,
  SelectionRegistry,
  SelectionReport,
  SourceDefinition,
  SourceIndex,
} from "./types.js";

/**
 * Dispatches the discover CLI command group.
 */
export async function runDiscover(
  args: string[],
  workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [command = "help", ...rest] = args;

  // Subcommands with dedicated help handlers get routed inside the switch.
  // For all other subcommands, --help/-h shows the parent discover help.
  const hasHelpFlag = rest.includes("--help") || rest.includes("-h");
  const hasSpecificHelp = new Set([
    "full",
    "breadth",
    "recall",
    "candidate-pool",
  ]);
  if (hasHelpFlag && !hasSpecificHelp.has(command)) {
    printDiscoverHelp();
    return 0;
  }

  switch (command) {
    case "demand-profile":
      logDiscoverPhase(
        "discover demand-profile",
        1,
        1,
        "Scanning workspace demand",
      );
      await generateDemandProfile(workingDirectory, projectRoot);
      return 0;
    case "sources":
      logDiscoverPhase("discover sources", 1, 1, "Refreshing source index");
      await generateSourceIndex(projectRoot);
      return 0;
    case "catalog":
      logDiscoverPhase("discover catalog", 1, 1, "Building discovery catalog");
      await generateCatalog(projectRoot);
      return 0;
    case "index": {
      logDiscoverPhase("discover index", 1, 1, "Building full catalog index");
      const pageCap =
        getRuntimeConfig().discovery.sourceSyncMaxPagesForIndexBuild;
      // When pageCap is 0, use an unlimited sentinel rather than omitting
      // the option — omission falls back to the runtime default (10 pages),
      // defeating the purpose of configuring unlimited index builds.
      await syncIndexedSources(
        projectRoot,
        pageCap === 0
          ? { maxPagesPerRun: Number.MAX_SAFE_INTEGER }
          : pageCap > 0
            ? { maxPagesPerRun: pageCap }
            : undefined,
      );
      // Copy the source-sync entries snapshot to catalog-index.jsonl so that
      // `discover sync` and `discover select` can read it without touching
      // the internal source-sync state paths.
      const syncEntriesPath = join(
        projectRoot,
        ...SOURCE_SYNC_ENTRIES_OUTPUT_PATH,
      );
      const indexPath = join(projectRoot, ...CATALOG_INDEX_OUTPUT_PATH);
      await mkdir(join(projectRoot, "discover", "output"), {
        recursive: true,
      });
      await copyFile(syncEntriesPath, indexPath);
      // Read back to get the entry count for metadata.
      const indexedEntries = await readJsonLinesFile<AssetCatalogEntry>(
        indexPath,
        (v: unknown) => v as AssetCatalogEntry,
      );
      await writeCatalogIndexMeta(projectRoot, indexedEntries.length);
      process.stdout.write(
        `[discover index] Catalog index written: ${indexedEntries.length} entries → ${indexPath}\n`,
      );
      return 0;
    }
    case "sync": {
      const forceFullFlag = rest.includes("--full");
      if (!forceFullFlag && (await isCatalogIndexFresh(projectRoot))) {
        // The index is fresh but source-sync state may be stale or empty.
        // Copy the index snapshot into source-sync.entries.jsonl so downstream
        // catalog generation reads the correct set of indexed entries.
        const syncEntriesPath = join(
          projectRoot,
          "state",
          "discover",
          "source-sync.entries.jsonl",
        );
        const indexPath = join(projectRoot, ...CATALOG_INDEX_OUTPUT_PATH);
        await mkdir(join(projectRoot, "state", "discover"), {
          recursive: true,
        });
        await copyFile(indexPath, syncEntriesPath);
        process.stdout.write(
          "[discover sync] Using fresh local catalog index — loaded into source-sync state.\n" +
            "  Run 'discover index' or 'discover sync --full' to force a re-harvest.\n",
        );
      } else {
        logDiscoverPhase("discover sync", 1, 1, "Syncing indexed sources");
        await syncIndexedSources(projectRoot);
      }
      return 0;
    }
    case "select": {
      const aiEnrichmentFlags = parseAiEnrichmentFlags(rest);
      logDiscoverPhase("discover select", 1, 1, "Applying selection rules");
      await generateSelectionOutputs(projectRoot); // flags not applicable in select mode
      return handleAiEnrichmentResult(
        await orchestrateAiEnrichment(projectRoot, {
          trigger: "after-select",
          explicitRequested: aiEnrichmentFlags.explicitRequested,
          disableRequested: aiEnrichmentFlags.disableRequested,
          force: aiEnrichmentFlags.force,
          requireSuccess: aiEnrichmentFlags.requireSuccess,
          suggestedCommand: "'agent-harness discover select --ai-enrich'",
        }),
      );
    }
    case "full": {
      if (hasHelpFlag) {
        printDiscoverFullHelp();
        return 0;
      }
      const aiEnrichmentFlags = parseAiEnrichmentFlags(rest);
      const quietMode = rest.includes("--quiet");
      const summaryMode = rest.includes("--summary");
      logDiscoverPhase("discover full", 1, 5, "Scanning workspace demand");
      await generateDemandProfile(workingDirectory, projectRoot);
      logDiscoverPhase("discover full", 2, 5, "Refreshing source index");
      await generateSourceIndex(projectRoot);
      logDiscoverPhase("discover full", 3, 5, "Syncing indexed sources");
      await syncIndexedSources(projectRoot);
      logDiscoverPhase("discover full", 4, 5, "Building discovery catalog");
      await generateCatalog(projectRoot);
      logDiscoverPhase("discover full", 5, 5, "Applying selection rules");
      const result = await generateSelectionOutputs(projectRoot, {
        quietMode,
        summaryMode,
      });
      if (quietMode || summaryMode) {
        printSourceHealthSummary(result.sourceHealthReport, {
          quietMode,
          summaryMode,
        });
      }
      return handleAiEnrichmentResult(
        await orchestrateAiEnrichment(projectRoot, {
          trigger: "after-select",
          explicitRequested: aiEnrichmentFlags.explicitRequested,
          disableRequested: aiEnrichmentFlags.disableRequested,
          force: aiEnrichmentFlags.force,
          requireSuccess: aiEnrichmentFlags.requireSuccess,
          suggestedCommand: "'agent-harness discover full --ai-enrich'",
        }),
      );
    }
    case "breadth":
    case "recall":
    case "candidate-pool":
      if (hasHelpFlag) {
        printDiscoverBreadthHelp();
        return 0;
      }
      await runDiscoveryBreadth(workingDirectory, projectRoot);
      return 0;
    case "enrich":
      return handleAiEnrichmentResult(
        await orchestrateAiEnrichment(projectRoot, {
          trigger: "manual",
          explicitRequested: true,
          disableRequested: false,
          force: rest.includes("--force"),
          requireSuccess: rest.includes("--require-ai-enrich"),
        }),
      );
    case "stats":
      await printCatalogStats(projectRoot);
      return 0;
    case "diff":
      await writeDiscoverDiffReport(projectRoot, rest);
      return 0;
    case "environment-index":
      await writeEnvironmentIndex(projectRoot, rest);
      return 0;
    case "ard-export": {
      // Try to resolve a real version from the workspace root (not --state-root)
      // so the ARD catalog carries the correct publisher version.
      const { readFile } = await import("node:fs/promises");
      let pkgVersion: string | undefined;
      try {
        const pkgRaw = await readFile("package.json", "utf8");
        pkgVersion = (JSON.parse(pkgRaw) as { version?: string }).version;
      } catch {
        // package.json unavailable — writeArdCatalog will fall back to "0.0.0".
      }
      const { filePath, entryCount } = await writeArdCatalog(
        projectRoot,
        pkgVersion,
      );
      const quietMode = rest.includes("--quiet");
      if (!quietMode) {
        console.log(
          `ARD ai-catalog.json written to ${toPosixPath(filePath)} (${entryCount} ${entryCount === 1 ? "entry" : "entries"}, publisher: ${getArdPublisherFqdn()})`,
        );
      }
      return 0;
    }
    case "inspect":
      await inspectCatalog(projectRoot, rest);
      return 0;
    case "help":
      printDiscoverHelp();
      return 0;
    default:
      printDiscoverHelp();
      return 1;
  }
}

async function generateDemandProfile(
  scanRoot: string,
  projectRoot: string,
): Promise<DemandProfile> {
  const demandProfile = await buildDemandProfile(scanRoot);
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
 * Re-exports demand profile construction for programmatic discovery callers.
 */
export { buildDemandProfile } from "./domains/discovery/demand-profile.js";

async function generateCatalog(projectRoot: string): Promise<{
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
  const repoSources = enabledSources.filter((source) => source.kind === "repo");
  const nonRepoSources = enabledSources.filter(
    (source) => source.kind !== "repo",
  );

  for (const source of nonRepoSources) {
    if (indexedSourceIds.has(source.id)) {
      appendCatalogEntries(
        catalogEntries,
        indexedCatalogEntriesBySourceId.get(source.id) ?? [],
      );
      continue;
    }

    switch (source.kind) {
      case "local-manifest":
        appendCatalogEntries(
          catalogEntries,
          await harvestLocalManifestSource(
            source,
            demandProfile,
            selectionRegistry,
            projectRoot,
          ),
        );
        break;
      case "local-directory":
        appendCatalogEntries(
          catalogEntries,
          await harvestLocalDirectorySource(
            source,
            demandProfile,
            selectionRegistry,
            projectRoot,
          ),
        );
        break;
      case "package-registry":
        appendCatalogEntries(
          catalogEntries,
          await harvestPackageRegistrySource(
            source,
            demandProfile,
            selectionRegistry,
          ),
        );
        break;
      case "docs":
      case "marketplace":
      case "registry":
        appendCatalogEntries(
          catalogEntries,
          await harvestReferenceSource(
            source,
            demandProfile,
            selectionRegistry,
          ),
        );
        break;
      default:
        break;
    }
  }

  const repoSlice = repoSources.slice(
    remoteHarvestState.nextRepoOffset,
    remoteHarvestState.nextRepoOffset + repoBatchSize,
  );
  const harvestedRepoEntries: AssetCatalogEntry[] = [];

  for (const source of repoSlice) {
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
    `Catalog written to ${toPosixPath(outputPath)} (${sortedEntries.length} entries)`,
  );

  return {
    catalogEntries: sortedEntries,
    enabledSources,
    sourceSyncState,
  };
}

function appendCatalogEntries(
  target: AssetCatalogEntry[],
  entries: readonly AssetCatalogEntry[],
): void {
  for (const entry of entries) {
    target.push(entry);
  }
}

async function generateSelectionOutputs(
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
    const selectedEntry = sortedGroupEntries[0];

    if (!selectedEntry) {
      continue;
    }

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
  const sampleRejected: typeof rejectionLog = [];
  const seenReasons = new Set<string>();
  // Pass 1: take one representative per reason (cap at REJECTION_SAMPLE_SIZE
  // in the unlikely but possible case where there are more than
  // REJECTION_SAMPLE_SIZE distinct rejection reasons).
  for (const entry of rejectionLog) {
    if (sampleRejected.length >= REJECTION_SAMPLE_SIZE) break;
    if (!seenReasons.has(entry.reason)) {
      seenReasons.add(entry.reason);
      sampleRejected.push(entry);
    }
  }
  // Pass 2: top up to REJECTION_SAMPLE_SIZE with the earliest un-sampled entries.
  // Use a Set of sampled object references so the membership check stays O(1).
  const sampledSet = new Set(sampleRejected);
  for (const entry of rejectionLog) {
    if (sampleRejected.length >= REJECTION_SAMPLE_SIZE) break;
    if (!sampledSet.has(entry)) {
      sampleRejected.push(entry);
      sampledSet.add(entry);
    }
  }

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
      `Source health reports written (${sourceHealthReport.severeCount} severe, ${sourceHealthReport.warningCount} warnings)`,
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

/**
 * Prints a filtered or summarized source health summary based on mode flags.
 * Only called when `--quiet` or `--summary` is active on `discover full`.
 *
 * - `--quiet`: suppresses expected warnings; prints only errors or all-clear.
 * - `--summary`: prints aggregate warning breakdown by reason.
 */
function printSourceHealthSummary(
  report: SourceHealthReport,
  options: { quietMode: boolean; summaryMode: boolean },
): void {
  if (options.quietMode) {
    if (report.severeCount > 0) {
      console.log(
        `Source health: ${report.severeCount} severe issue(s) require attention (${report.warningCount} warnings suppressed by --quiet).`,
      );
    } else {
      console.log(
        `Source health: all clear (${report.warningCount} warnings suppressed by --quiet).`,
      );
    }
    return;
  }

  if (options.summaryMode) {
    const byReason = new Map<string, number>();
    // Aggregate warnings only (exclude errors) — the summary is about
    // warning noise reduction, not about error diagnosis.
    for (const source of report.sources) {
      if (source.severity !== "warning") continue;
      for (const reason of source.reasons) {
        byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
      }
    }
    const lines = [...byReason.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([reason, count]) => `  ${count} sources: ${reason}`);
    console.log(
      `Source health: ${report.severeCount} severe, ${report.warningCount} warnings — breakdown:` +
        (lines.length > 0 ? `\n${lines.join("\n")}` : " none"),
    );
  }
}

function parseAiEnrichmentFlags(args: readonly string[]): {
  explicitRequested: boolean;
  disableRequested: boolean;
  force: boolean;
  requireSuccess: boolean;
} {
  const explicitRequested = args.includes("--ai-enrich");
  const disableRequested = args.includes("--no-ai-enrich");
  const requireSuccess = args.includes("--require-ai-enrich");

  if (explicitRequested && disableRequested) {
    throw new Error("--ai-enrich and --no-ai-enrich cannot be used together.");
  }

  if (disableRequested && requireSuccess) {
    throw new Error(
      "--no-ai-enrich and --require-ai-enrich cannot be used together.",
    );
  }

  return {
    explicitRequested,
    disableRequested,
    force: args.includes("--force"),
    requireSuccess,
  };
}

function handleAiEnrichmentResult(
  result: AiEnrichmentOrchestrationResult,
): number {
  if (result.note) {
    console.log(result.note);
  }

  return result.shouldFail ? 1 : 0;
}

function logDiscoverPhase(
  commandLabel: string,
  step: number,
  total: number,
  description: string,
): void {
  console.log(`[${commandLabel}] ${step}/${total} ${description}...`);
}

async function runDiscoveryBreadth(
  workingDirectory: string,
  projectRoot: string,
): Promise<void> {
  logDiscoverPhase("discover breadth", 1, 5, "Scanning workspace demand");
  const demandProfile = await generateDemandProfile(
    workingDirectory,
    projectRoot,
  );
  logDiscoverPhase("discover breadth", 2, 5, "Refreshing source index");
  const sourceIndex = await generateSourceIndex(projectRoot);
  logDiscoverPhase("discover breadth", 3, 5, "Syncing indexed sources");
  await syncIndexedSources(projectRoot);
  logDiscoverPhase("discover breadth", 4, 5, "Building discovery catalog");
  const { catalogEntries, enabledSources } = await generateCatalog(projectRoot);
  logDiscoverPhase("discover breadth", 5, 5, "Applying selection rules");
  const { selectionReport } = await generateSelectionOutputs(projectRoot);

  printDiscoveryBreadthSummary({
    demandProfile,
    sourceIndex,
    enabledSources,
    catalogEntries,
    selectionReport,
  });
}

function printDiscoveryBreadthSummary(input: {
  demandProfile: DemandProfile;
  sourceIndex: SourceIndex;
  enabledSources: SourceDefinition[];
  catalogEntries: AssetCatalogEntry[];
  selectionReport: SelectionReport;
}): void {
  const demandSignalCount = countDemandSignals(input.demandProfile);
  const indexedSourceCount = input.sourceIndex.enabledSources.filter(
    (source) => source.coverageMode === "indexed",
  ).length;
  const operationalSourceCount = countOperationalSources(input.catalogEntries);
  const assessment = assessDiscoveryBreadth({
    demandProfile: input.demandProfile,
    catalogEntries: input.catalogEntries,
    operationalSourceCount,
    selectionReport: input.selectionReport,
    sourceCount: input.enabledSources.length,
  });

  console.log("Discovery breadth complete.");
  console.log(`Assessment: ${assessment.kind}`);
  console.log(`Reason: ${assessment.reason}`);
  console.log(
    `Signals: ${demandSignalCount} across ${input.demandProfile.evidence.length} evidence file(s)`,
  );
  console.log(
    `Sources: ${input.sourceIndex.sourceCount} enabled (${indexedSourceCount} indexed, ${operationalSourceCount} operational)`,
  );
  console.log(
    `Selection: ${input.catalogEntries.length} catalog entries -> ${input.selectionReport.selectedCount} selected / ${input.selectionReport.rejectedCount} rejected`,
  );
  console.log("Next steps:");
  for (const nextStep of assessment.nextSteps) {
    console.log(`- ${nextStep}`);
  }
}

function countDemandSignals(demandProfile: DemandProfile): number {
  return new Set([
    ...demandProfile.signals.languages,
    ...demandProfile.signals.packageManagers,
    ...demandProfile.signals.frameworks,
    ...demandProfile.signals.concerns,
    ...demandProfile.signals.tooling,
  ]).size;
}

function countOperationalSources(catalogEntries: AssetCatalogEntry[]): number {
  const operationalSourceIds = new Set<string>();

  for (const entry of catalogEntries) {
    if (
      entry.evidence.manifestFound ||
      entry.status.mirrorEligible ||
      entry.status.installEligible ||
      entry.status.activationEligible
    ) {
      operationalSourceIds.add(entry.source.sourceId);
    }
  }

  return operationalSourceIds.size;
}

function assessDiscoveryBreadth(input: {
  demandProfile: DemandProfile;
  sourceCount: number;
  operationalSourceCount: number;
  catalogEntries: AssetCatalogEntry[];
  selectionReport: SelectionReport;
}): {
  kind:
    | "detection-limited"
    | "source-coverage-limited"
    | "selection-limited"
    | "ranking-ready";
  reason: string;
  nextSteps: string[];
} {
  const demandSignalCount = countDemandSignals(input.demandProfile);

  if (input.demandProfile.evidence.length === 0 || demandSignalCount === 0) {
    return {
      kind: "detection-limited",
      reason:
        "The demand profile is too sparse to trust candidate-pool breadth yet.",
      nextSteps: [
        "Confirm you are running from the real workspace root.",
        "Inspect discover/output/demand-profile.json and verify real manifests are visible.",
        "Check .gitignore, .ignore, and .agent-harnessignore for accidentally hidden manifests.",
      ],
    };
  }

  if (
    input.sourceCount === 0 ||
    input.catalogEntries.length === 0 ||
    input.operationalSourceCount === 0
  ) {
    return {
      kind: "source-coverage-limited",
      reason:
        "The active discovery universe is not producing a broad operational catalog yet.",
      nextSteps: [
        "Inspect discover/output/source-index.json and discover/output/source-utilization.json.",
        "If the checked-in source universe is still too narrow, widen the active state-root discovery inputs: discover/sources.json, discover/source-packs/*.json, discover/official-skills-indexes.json, and discover/official-upstreams.json.",
        "Rerun 'agent-harness discover breadth' after changing the active state-root discovery inputs.",
      ],
    };
  }

  if (
    input.selectionReport.selectedCount === 0 ||
    (input.catalogEntries.length >= 25 &&
      input.selectionReport.selectedCount <=
        Math.max(3, Math.floor(input.catalogEntries.length * 0.05)))
  ) {
    return {
      kind: "selection-limited",
      reason:
        "Discovery is producing candidates, but the selected set is still narrow enough that selection filtering may be the bottleneck.",
      nextSteps: [
        "Inspect discover/output/selection-report.json plus catalog.selected.jsonl and catalog.rejected.jsonl.",
        "Only change recommendation policy after confirming the right assets are missing from the selected set.",
        "If the selected set already contains the right assets, the next step is ranking rather than more breadth.",
      ],
    };
  }

  return {
    kind: "ranking-ready",
    reason:
      "The candidate pool looks broad enough to judge recommendation quality instead of recall first.",
    nextSteps: [
      "Run 'agent-harness recommend report' next.",
      "If the final ordering still feels wrong, inspect 'agent-harness recommend explain --host <host> --asset <asset-id>' and 'agent-harness recommend policy:print --host <host>'.",
      "Use the recommendation policy playbook only after confirming that breadth/selection are not the bottleneck.",
    ],
  };
}

function printDiscoverHelp(): void {
  printCommandHelp({
    heading: "discover commands:",
    entries: [
      {
        command: "demand-profile",
        description:
          "Scan the working directory and write discover/output/demand-profile.json",
      },
      {
        command: "sources",
        description:
          "Summarize enabled discovery sources into discover/output/source-index.json",
      },
      {
        command: "sync",
        description:
          "Persist indexed discovery results — uses local index when fresh, live harvest otherwise (see 'discover index')",
      },
      {
        command: "index",
        description:
          "Build a full offline catalog index by fully paginating all indexed sources (slow, scheduled — run once or in CI)",
      },
      {
        command: "catalog",
        description: "Harvest local sources into discover/catalog.assets.jsonl",
      },
      {
        command: "select",
        description:
          "Apply canonical selection rules and write selected/rejected JSONL outputs",
      },
      {
        command: "full",
        description:
          "Run demand-profile, sources, sync, catalog, and select in one pass",
      },
      {
        command: "breadth",
        description:
          "Run the widest practical discovery pass and print candidate-pool guidance",
      },
      {
        command: "recall",
        description: "Alias for discover breadth",
      },
      {
        command: "candidate-pool",
        description: "Alias for discover breadth",
      },
      {
        command: "stats",
        description:
          "Print catalog summary counts grouped by source, kind, host, and authority",
      },
      {
        command: "diff",
        description:
          "Compare discovery outputs against --baseline <stateRoot> (--json for agents)",
      },
      {
        command: "environment-index",
        description:
          "Write experimental read-only query metadata to discover/output/environment-index.json",
      },
      {
        command: "ard-export",
        description:
          "Export selected catalog to ARD ai-catalog.json format at .well-known/ai-catalog.json",
      },
      {
        command: "enrich",
        description:
          "Run bounded AI-assisted enrichment against the selected catalog",
      },
      {
        command: "inspect",
        description:
          "Print catalog entries filtered by --source <id> or --id <assetId>",
      },
    ],
    sections: [
      {
        title: "AI enrichment options:",
        lines: [
          "--ai-enrich         Explicitly request enrichment after select/full",
          "--no-ai-enrich      Explicitly skip enrichment for this select/full run",
          "--force             Bypass cache reuse and automatic policy skips, forcing a new provider call when enrichment runs",
          "--require-ai-enrich Fail the command when enrichment does not complete or reuse successfully",
        ],
      },
    ],
  });
}

/**
 * Prints help for `discover full`.
 */
function printDiscoverFullHelp(): void {
  printCommandHelp({
    heading: "discover full — Run the complete discovery pipeline in one pass",
    entries: [
      {
        command: "Steps executed in order:",
        description: "",
      },
      {
        command: "  1. demand-profile",
        description: "Scan the working directory for demand signals",
      },
      {
        command: "  2. sources",
        description: "Refresh the source index",
      },
      {
        command: "  3. sync",
        description: "Sync indexed sources to local state",
      },
      {
        command: "  4. catalog",
        description: "Build the unified asset catalog",
      },
      {
        command: "  5. select",
        description: "Apply canonical selection rules",
      },
    ],
    sections: [
      {
        title: "Options:",
        lines: [
          "--ai-enrich         Run AI enrichment after selection",
          "--no-ai-enrich      Skip AI enrichment",
          "--quiet             Suppress expected source health warnings",
          "--summary           Print aggregate warning breakdown by reason",
        ],
      },
      {
        title: "Outputs:",
        lines: [
          "discover/output/demand-profile.json",
          "discover/output/source-index.json",
          "discover/output/catalog.assets.jsonl",
          "discover/output/catalog.selected.jsonl",
          "discover/output/catalog.rejected.jsonl",
          "discover/output/selection-report.json",
        ],
      },
    ],
  });
}

/**
 * Prints help for `discover breadth` (aliases: recall, candidate-pool).
 */
function printDiscoverBreadthHelp(): void {
  printCommandHelp({
    heading:
      "discover breadth — Run the widest practical discovery pass (aliases: recall, candidate-pool)",
    entries: [
      {
        command: "Description:",
        description: "",
      },
      {
        command:
          "  Runs demand-profile followed by a maximally broad discovery",
        description: "",
      },
      {
        command:
          "  pass that prioritizes candidate-pool coverage over precision.",
        description: "",
      },
      {
        command:
          "  Useful for surveying available assets before narrowing down.",
        description: "",
      },
    ],
    sections: [
      {
        title: "Options:",
        lines: [
          "--state-root <path>  Write state under this path",
          "--ai-enrich          Run AI enrichment after breadth scan",
        ],
      },
      {
        title: "Aliases:",
        lines: [
          "discover recall           Same as discover breadth",
          "discover candidate-pool   Same as discover breadth",
        ],
      },
    ],
  });
}

/**
 * Applies demand-relevance filtering to the catalog, using semantic similarity
 * scoring when enabled and available, falling back to keyword-overlap gating.
 *
 * All scorer branching lives here so `generateSelectionOutputs` stays clean.
 */
async function applyRelevanceFilter(
  catalogEntries: AssetCatalogEntry[],
  demandProfile: DemandProfile | null,
  config: ReturnType<typeof getRuntimeConfig>,
): Promise<{
  selectedEntries: AssetCatalogEntry[];
  rejectedEntries: AssetCatalogEntry[];
}> {
  if (config.discovery.semanticScoringEnabled) {
    const scorer = new SemanticScorer({
      minSimilarity: config.discovery.semanticScoringMinSimilarity,
    });
    await scorer.tryInit();
    if (scorer.available) {
      const semanticResult = await scorer.filterAndRank(
        catalogEntries,
        demandProfile,
      );
      if (semanticResult) {
        console.log(
          `[semantic-scoring] scored ${catalogEntries.length} entries ` +
            `(threshold=${config.discovery.semanticScoringMinSimilarity}, ` +
            `query="${buildDemandQueryText(demandProfile).slice(0, 60)}...")`,
        );
        return {
          selectedEntries: semanticResult.selected,
          rejectedEntries: semanticResult.rejected,
        };
      }
      console.warn(
        "[semantic-scoring] scorer unavailable after init — falling back to keyword gate",
      );
    } else {
      console.warn(
        "[semantic-scoring] @xenova/transformers not installed — falling back to keyword gate",
      );
    }
  }
  return filterCatalogEntriesByDemandRelevance(catalogEntries, demandProfile);
}

/**
 * Applies a per-source entry cap to a pre-sorted list of catalog entries.
 *
 * Entries are visited in the order provided; the first `maxPerSource` entries
 * for each `source.sourceId` are kept, and any excess are returned in the
 * `capped` array so callers can add rejection-log entries.
 *
 * @param entries - Pre-sorted selected entries (insertion order preserved).
 * @param maxPerSource - Maximum entries to retain per unique `source.sourceId`.
 * @returns `{ kept, capped }` — kept entries in original order; capped entries
 *   as `{ assetId }` objects suitable for rejection logging.
 */
export function applyPerSourceCap(
  entries: AssetCatalogEntry[],
  maxPerSource: number,
): { kept: AssetCatalogEntry[]; capped: Array<{ assetId: string }> } {
  const sourceCountMap = new Map<string, number>();
  const kept: AssetCatalogEntry[] = [];
  const capped: Array<{ assetId: string }> = [];
  for (const entry of entries) {
    const sourceId = entry.source.sourceId;
    const count = sourceCountMap.get(sourceId) ?? 0;
    // 0 means unlimited — skip the cap check entirely.
    if (maxPerSource > 0 && count >= maxPerSource) {
      capped.push({ assetId: entry.id });
    } else {
      sourceCountMap.set(sourceId, count + 1);
      kept.push(entry);
    }
  }
  return { kept, capped };
}

/** Threshold fraction above which a source triggers a diversity warning. */
const SOURCE_DIVERSITY_WARNING_THRESHOLD = 0.2;

/**
 * Maximum number of sample rejected entries in SelectionReport.sampleRejected.
 * Guarantees at least one entry per distinct rejection reason.
 */
const REJECTION_SAMPLE_SIZE = 20;

/**
 * Returns a human-readable warning when any single source contributes more
 * than 20% of the provided (already-capped) selected entries.  Returns
 * `undefined` when the set is well-diversified or empty.
 *
 * @param cappedEntries - Selected entries after the per-source cap.
 * @param maxPerSource - The cap value in effect, included in the message so
 *   the operator knows which knob to turn.
 */
export function computeSourceDiversityWarning(
  cappedEntries: AssetCatalogEntry[],
  maxPerSource: number,
): string | undefined {
  if (cappedEntries.length === 0) {
    return undefined;
  }
  const sourceCounts = new Map<string, number>();
  for (const entry of cappedEntries) {
    const id = entry.source.sourceId;
    sourceCounts.set(id, (sourceCounts.get(id) ?? 0) + 1);
  }
  for (const [sourceId, count] of sourceCounts.entries()) {
    const fraction = count / cappedEntries.length;
    if (fraction > SOURCE_DIVERSITY_WARNING_THRESHOLD) {
      const pct = Math.round(fraction * 100);
      return (
        `Source "${sourceId}" contributes ${pct}% of selected entries ` +
        `(${count}/${cappedEntries.length}). ` +
        `Consider lowering AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE ` +
        `(currently ${maxPerSource}) to improve diversity.`
      );
    }
  }
  return undefined;
}

/**
 * Computes the acceptance rate as a fraction 0–1.
 * Returns 0 when inputCount is 0 to avoid division by zero.
 * Rounded to 4 decimal places for diagnostic use.
 */
export function computeAcceptanceRate(
  inputCount: number,
  selectedCount: number,
): number {
  if (inputCount === 0) {
    return 0;
  }
  return Number((selectedCount / inputCount).toFixed(4));
}

/**
 * Exposes narrow discover internals for focused per-source-cap tests.
 */
export const discoverInternals = {
  applyPerSourceCap,
  computeAcceptanceRate,
  computeSourceDiversityWarning,
};
