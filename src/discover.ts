import { join } from "node:path";

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
  CATALOG_OUTPUT_PATH,
  DEMAND_PROFILE_OUTPUT_PATH,
  REJECTED_CATALOG_OUTPUT_PATH,
  UNKNOWN_SIGNALS_OUTPUT_PATH,
  REMOTE_CATALOG_STATE_OUTPUT_PATH,
  SELECTED_CATALOG_OUTPUT_PATH,
  SELECTION_REPORT_OUTPUT_PATH,
} from "./domains/discovery/output-paths.js";
import { harvestOfficialSkillIndexes } from "./domains/discovery/official-index-harvester.js";
import { harvestPackageRegistrySource } from "./domains/discovery/package-registry-harvester.js";
import { harvestReferenceSource } from "./domains/discovery/reference-source-harvester.js";
import {
  loadRemoteHarvestState,
  writeRemoteHarvestState,
} from "./domains/discovery/remote-state.js";
import { writeSourceHealthReports } from "./domains/discovery/source-health.js";
import { writeSourceUtilizationReport } from "./domains/discovery/source-utilization.js";
import { writeSourceVerificationReport } from "./domains/discovery/source-verification.js";
import { writeUnknownSignalReport } from "./domains/discovery/unknown-signals.js";
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
    case "sync":
      logDiscoverPhase("discover sync", 1, 1, "Syncing indexed sources");
      await syncIndexedSources(projectRoot);
      return 0;
    case "select": {
      const aiEnrichmentFlags = parseAiEnrichmentFlags(rest);
      logDiscoverPhase("discover select", 1, 1, "Applying selection rules");
      await generateSelectionOutputs(projectRoot);
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
      const aiEnrichmentFlags = parseAiEnrichmentFlags(rest);
      logDiscoverPhase("discover full", 1, 5, "Scanning workspace demand");
      await generateDemandProfile(workingDirectory, projectRoot);
      logDiscoverPhase("discover full", 2, 5, "Refreshing source index");
      await generateSourceIndex(projectRoot);
      logDiscoverPhase("discover full", 3, 5, "Syncing indexed sources");
      await syncIndexedSources(projectRoot);
      logDiscoverPhase("discover full", 4, 5, "Building discovery catalog");
      await generateCatalog(projectRoot);
      logDiscoverPhase("discover full", 5, 5, "Applying selection rules");
      await generateSelectionOutputs(projectRoot);
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

async function generateSelectionOutputs(projectRoot: string): Promise<{
  selectionReport: SelectionReport;
  selectedEntries: AssetCatalogEntry[];
  rejectedEntries: AssetCatalogEntry[];
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
  const relevanceFilter = filterCatalogEntriesByDemandRelevance(
    catalogEntries,
    demandProfile,
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

  // Derive the flat rejected-entries list from the log so we have a single
  // source of truth (the log) driving both the JSONL output and the report.
  const rejectedEntryIds = new Set(rejectionLog.map((r) => r.assetId));
  const catalogById = new Map(catalogEntries.map((e) => [e.id, e]));
  const rejectedEntries = [...rejectedEntryIds]
    .map((id) => catalogById.get(id))
    .filter((e): e is AssetCatalogEntry => e !== undefined);

  // Build rejectionSummary — stable reason → count covering 100% of rejections.
  const rejectionSummary = buildRejectionSummary(rejectionLog);

  // sampleRejected — up to 20 entries for quick spot-checking.
  const SAMPLE_SIZE = 20;
  const sampleRejected = rejectionLog.slice(0, SAMPLE_SIZE);

  const sortedSelectedEntries = selectedEntries.sort(
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
    duplicateDecisions: duplicateDecisions.sort((left, right) =>
      left.duplicateGroup.localeCompare(right.duplicateGroup),
    ),
    rejectionSummary,
    sampleRejected,
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
  console.log(
    `Source health reports written (${sourceHealthReport.severeCount} severe, ${sourceHealthReport.warningCount} warnings)`,
  );
  console.log(
    `Source candidate queue written (${sourceCandidateQueue.candidateCount} candidates, ${sourceCandidateQueue.reviewRequiredCount} review-required)`,
  );

  return {
    selectionReport,
    selectedEntries: sortedSelectedEntries,
    rejectedEntries: sortedRejectedEntries,
  };
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
  await generateSourceIndex(projectRoot);
  logDiscoverPhase("discover breadth", 3, 5, "Syncing indexed sources");
  await syncIndexedSources(projectRoot);
  const sourceIndex = await generateSourceIndex(projectRoot);
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
          "Persist indexed discovery results for supported high-volume sources",
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
