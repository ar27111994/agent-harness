import { join } from "node:path";
import { copyFile, mkdir } from "node:fs/promises";

import { isGitHubRepoSource } from "./github.js";
import {
  inspectCatalog,
  printCatalogStats,
} from "./domains/discovery/catalog-inspection.js";
import {
  hasHelpFlag,
  isFlagLike,
  printUnknownArgumentError,
  rejectUnknownFlags,
} from "./cli-help-format.js";

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
import {
  getActiveDeadline,
  assertNotDeadlineExceeded,
} from "./lib/deadline.js";
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
} from "./types.js";

/**
 * Dispatches the discover CLI command group.
 */
import {
  printDiscoverHelp,
  printDiscoverSubcommandHelp,
} from "./discover-help.js";
import {
  REJECTION_SAMPLE_SIZE,
  applyPerSourceCap,
  applyRelevanceFilter,
  computeAcceptanceRate,
  computeDemandRelevantSourceIds,
  computeSourceDiversityWarning,
  getEnabledSourceIds,
  printDiscoveryBreadthSummary,
} from "./discover-pipeline.js";

const DISCOVER_AI_ENRICH_FLAGS = new Set([
  "--ai-enrich",
  "--no-ai-enrich",
  "--force",
  "--require-ai-enrich",
]);
const DISCOVER_FULL_KNOWN_FLAGS = new Set([
  ...DISCOVER_AI_ENRICH_FLAGS,
  "--quiet",
  "--summary",
  "--no-sync",
  "--sync-all",
  "--max-scan-bytes",
]);
const DISCOVER_FULL_FLAGS_WITH_VALUES = new Set(["--max-scan-bytes"]);

/** Minimum number of sources before the first-run --no-sync hint appears. */
const FIRST_RUN_SYNC_HINT_MIN_SOURCES = 6;

/**
 * Decides whether to proactively print the first-run `--no-sync` hint
 * (#439). The hint must appear WITHOUT requiring a skipped-source condition:
 * the first sync of many sources is the case where a 60-120s silent phase
 * makes the pipeline look hung. Suppressed when the user already opted out
 * (--no-sync/--sync-all), when quiet mode is active, or on non-first runs.
 */
function shouldShowFirstRunSyncHint(
  priorSyncState: SourceSyncState | null,
  effectiveSourceCount: number,
  quietMode: boolean,
  noSync: boolean,
  syncAll: boolean,
): boolean {
  if (quietMode || noSync || syncAll) {
    return false;
  }
  if (effectiveSourceCount < FIRST_RUN_SYNC_HINT_MIN_SOURCES) {
    return false;
  }
  const hasPriorSync = (priorSyncState?.sources.length ?? 0) > 0;
  return !hasPriorSync;
}

export async function runDiscover(
  args: string[],
  workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [command = "help", ...rest] = args;

  // Subcommands with dedicated help handlers get routed inside the switch.
  // For all other subcommands, --help/-h shows the parent discover help.
  const helpRequested = hasHelpFlag(rest);
  const hasSpecificHelp = new Set([
    "full",
    "breadth",
    "recall",
    "candidate-pool",
    "sources",
    "demand-profile",
    "catalog",
    "sync",
    "index",
    "select",
    "stats",
    "enrich",
    "ard-export",
    "diff",
    "environment-index",
    "inspect",
  ]);
  if (helpRequested && !hasSpecificHelp.has(command)) {
    printDiscoverHelp();
    return 0;
  }

  // Subcommand-specific help: print targeted help instead of executing.
  if (helpRequested && hasSpecificHelp.has(command)) {
    printDiscoverSubcommandHelp(command);
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
      if (
        rejectUnknownFlags(
          rest,
          new Set(["--full"]),
          new Set(),
          "agent-harness discover sync --help",
        )
      ) {
        return 1;
      }
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
      if (
        rejectUnknownFlags(
          rest,
          DISCOVER_AI_ENRICH_FLAGS,
          new Set(),
          "agent-harness discover select --help",
        )
      ) {
        return 1;
      }
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
      if (
        rejectUnknownFlags(
          rest,
          DISCOVER_FULL_KNOWN_FLAGS,
          DISCOVER_FULL_FLAGS_WITH_VALUES,
          "agent-harness discover full --help",
        )
      ) {
        return 1;
      }
      const aiEnrichmentFlags = parseAiEnrichmentFlags(rest);
      const quietMode = rest.includes("--quiet");
      const summaryMode = rest.includes("--summary");
      const noSync = rest.includes("--no-sync");
      const syncAll = rest.includes("--sync-all");
      const maxBytesIndex = rest.indexOf("--max-scan-bytes");
      let maxBytes: number | undefined;
      if (maxBytesIndex >= 0) {
        if (maxBytesIndex + 1 >= rest.length) {
          throw new Error("discover full --max-scan-bytes requires a value");
        }
        const raw = rest[maxBytesIndex + 1];
        const parsed = Number(raw);
        if (
          !Number.isFinite(parsed) ||
          parsed <= 0 ||
          !Number.isSafeInteger(parsed)
        ) {
          throw new Error(
            `discover full --max-scan-bytes requires a positive safe integer (got: ${JSON.stringify(raw)})`,
          );
        }
        maxBytes = parsed;
      }
      logDiscoverPhase("discover full", 1, 5, "Scanning workspace demand");
      const demandProfile = await generateDemandProfile(
        workingDirectory,
        projectRoot,
        maxBytes,
      );
      logDiscoverPhase("discover full", 2, 5, "Refreshing source index");
      await generateSourceIndex(projectRoot);
      if (noSync) {
        logDiscoverPhase(
          "discover full",
          3,
          5,
          "Skipping source sync (--no-sync)",
        );
        console.warn(
          "[discover full] --no-sync: skipping indexed source sync, using existing source-sync state.",
        );
      } else {
        // Compute demand-relevant sources to skip irrelevant registries
        // on first run (#419). Use --sync-all to sync every enabled source.
        const demandSourceIds = syncAll
          ? undefined
          : computeDemandRelevantSourceIds(demandProfile);
        if (demandSourceIds && !quietMode) {
          const enabledSourceIds = await getEnabledSourceIds(projectRoot);
          const allEnabledCount = enabledSourceIds.length;
          const filteredCount = enabledSourceIds.filter((id) =>
            demandSourceIds.has(id),
          ).length;
          const skippedCount = allEnabledCount - filteredCount;
          if (skippedCount > 0) {
            const primaryLang = demandProfile.signals.languages[0] ?? "unknown";
            console.log(
              `[discover full] Detected ${primaryLang} project. ` +
                `Syncing ${filteredCount}/${allEnabledCount} demand-relevant sources ` +
                `(${skippedCount} skipped). ` +
                `Use --sync-all for full sync or --no-sync to skip entirely.`,
            );
          }
        }
        // Proactive first-run hint (#439): before the (potentially minutes-
        // long) sync phase starts, tell interactive users that cached-state
        // opt-outs exist — even when no source was skipped.
        const effectiveSyncSourceCount =
          demandSourceIds?.size ??
          (await getEnabledSourceIds(projectRoot)).length;
        const priorSyncState = await loadSourceSyncState(projectRoot);
        if (
          shouldShowFirstRunSyncHint(
            priorSyncState,
            effectiveSyncSourceCount,
            quietMode,
            noSync,
            syncAll,
          )
        ) {
          process.stderr.write(
            `[discover full] First-time sync of ${effectiveSyncSourceCount} sources may take several minutes — pass --no-sync to use cached discovery state or --sync-all to sync every enabled source.\n`,
          );
        }
        logDiscoverPhase("discover full", 3, 5, "Syncing indexed sources");
        await syncIndexedSources(
          projectRoot,
          demandSourceIds ? { sourceIds: demandSourceIds } : undefined,
        );
      }
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
      // These subcommands take no options; any flag is unknown (#431).
      if (
        rejectUnknownFlags(
          rest,
          new Set(),
          new Set(),
          "agent-harness discover breadth --help",
        )
      ) {
        return 1;
      }
      await runDiscoveryBreadth(workingDirectory, projectRoot);
      return 0;
    case "enrich":
      if (
        rejectUnknownFlags(
          rest,
          new Set(["--force", "--require-ai-enrich"]),
          new Set(),
          "agent-harness discover enrich --help",
        )
      ) {
        return 1;
      }
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
      if (
        rejectUnknownFlags(
          rest,
          new Set(),
          new Set(),
          "agent-harness discover stats --help",
        )
      ) {
        return 1;
      }
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
      // Flag-like first tokens are unknown options: name them instead of
      // dumping the parent help (#431). Non-flag unknown subcommands still
      // show parent help with a non-zero exit.
      if (isFlagLike(command)) {
        printUnknownArgumentError(command);
        return 1;
      }
      printDiscoverHelp();
      return 1;
  }
}

async function generateDemandProfile(
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

  const totalSources = nonRepoSources.length + repoSources.length;
  let processedSources = 0;
  const deadline = getActiveDeadline();

  process.stderr.write(
    `[discover catalog] Building catalog from ${totalSources} enabled sources\n`,
  );

  for (const source of nonRepoSources) {
    processedSources++;
    process.stderr.write(
      `[discover catalog] ${processedSources}/${totalSources} ${source.id} (${source.kind})\n`,
    );
    assertNotDeadlineExceeded(deadline, `discover catalog source ${source.id}`);
    if (indexedSourceIds.has(source.id)) {
      const indexedEntries =
        indexedCatalogEntriesBySourceId.get(source.id) ?? [];
      appendCatalogEntries(catalogEntries, indexedEntries);
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
    processedSources++;
    process.stderr.write(
      `[discover catalog] ${processedSources}/${totalSources} ${source.id} (repo)\n`,
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
    `[discover catalog] Writing catalog (${catalogEntries.length} entries)...\n`,
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

export const discoverInternals = {
  applyPerSourceCap,
  computeAcceptanceRate,
  computeSourceDiversityWarning,
  computeDemandRelevantSourceIds,
  getEnabledSourceIds,
  shouldShowFirstRunSyncHint,
};

/**
 * Source IDs that are always demand-relevant regardless of project type.
 * These sources provide universal assets (MCP servers, skills directories)
 * that apply to any project.
 */
