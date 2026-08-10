import { join } from "node:path";
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";

import {
  inspectCatalog,
  printCatalogStats,
} from "./domains/discovery/catalog-inspection.js";
import {
  handleUnknownCommand,
  hasHelpFlag,
  hasUnknownFlag,
} from "./cli-help-format.js";

import { readJsonLinesFile, pathExists, toPosixPath } from "./files.js";
import { getRuntimeConfig } from "./config/runtime.js";
import {
  orchestrateAiEnrichment,
  type AiEnrichmentOrchestrationResult,
} from "./domains/discovery/ai-enrichment.js";
import { writeDiscoverDiffReport } from "./domains/discovery/diff.js";
import { writeEnvironmentIndex } from "./domains/discovery/environment-index.js";
import { writeArdCatalog, getArdPublisherFqdn } from "./ard-catalog.js";
import { generateSourceIndex } from "./domains/discovery/source-index.js";
import {
  loadSourceSyncState,
  syncIndexedSources,
  type SourceSyncState,
} from "./domains/discovery/source-sync.js";
import {
  CATALOG_INDEX_OUTPUT_PATH,
  CATALOG_OUTPUT_PATH,
  SOURCE_SYNC_ENTRIES_OUTPUT_PATH,
} from "./domains/discovery/output-paths.js";
import {
  isCatalogIndexFresh,
  writeCatalogIndexMeta,
} from "./domains/discovery/catalog-index.js";
import type { SourceHealthReport } from "./domains/discovery/source-health.js";

import type { AssetCatalogEntry } from "./types.js";

/**
 * Dispatches the discover CLI command group.
 */
import {
  printDiscoverHelp,
  printDiscoverSubcommandHelp,
} from "./discover-help.js";
import {
  applyPerSourceCap,
  computeAcceptanceRate,
  computeDemandRelevantSourceIds,
  computeSourceDiversityWarning,
  getEnabledSourceIds,
  printDiscoveryBreadthSummary,
} from "./discover-pipeline.js";
import {
  generateCatalog,
  generateDemandProfile,
  generateSelectionOutputs,
} from "./domains/discovery/catalog-generation.js";

/**
 * Re-exports demand profile construction for programmatic discovery callers.
 */
export { buildDemandProfile } from "./domains/discovery/demand-profile.js";

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
  // Simplified null-aware check: priorSyncState is null on the very first
  // run (no state file written yet) — that is a live first-run path, so both
  // arms are exercised by the hint tests.
  const hasPriorSync =
    priorSyncState !== null && priorSyncState.sources.length > 0;
  return !hasPriorSync;
}

/**
 * Dispatches the discover command group: subcommand-specific help first,
 * then the stateful pipeline subcommands and their strict-flag validation.
 */
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
      // pageCap is validated as a non-negative integer, so the only two
      // cases are zero (unlimited) and positive (bounded).
      await syncIndexedSources(
        projectRoot,
        pageCap === 0
          ? { maxPagesPerRun: Number.MAX_SAFE_INTEGER }
          : { maxPagesPerRun: pageCap },
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
        hasUnknownFlag(
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
        hasUnknownFlag(
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
        hasUnknownFlag(
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
        hasUnknownFlag(
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
        hasUnknownFlag(
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
        hasUnknownFlag(
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
      if (
        hasUnknownFlag(
          rest,
          new Set(["--baseline", "--json"]),
          new Set(["--baseline"]),
          "agent-harness discover diff --help",
        )
      ) {
        return 1;
      }
      await writeDiscoverDiffReport(projectRoot, rest);
      return 0;
    case "environment-index":
      if (
        hasUnknownFlag(
          rest,
          new Set(["--json"]),
          new Set(),
          "agent-harness discover environment-index --help",
        )
      ) {
        return 1;
      }
      await writeEnvironmentIndex(projectRoot, rest);
      return 0;
    case "ard-export": {
      if (
        hasUnknownFlag(
          rest,
          new Set(["--quiet"]),
          new Set(),
          "agent-harness discover ard-export --help",
        )
      ) {
        return 1;
      }
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
      if (
        hasUnknownFlag(
          rest,
          new Set(["--source", "--id", "--limit"]),
          new Set(["--source", "--id", "--limit"]),
          "agent-harness discover inspect --help",
        )
      ) {
        return 1;
      }
      await inspectCatalog(projectRoot, rest);
      return 0;
    case "help":
      printDiscoverHelp();
      return 0;
    default:
      return handleUnknownCommand(command, printDiscoverHelp);
  }
}

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
  // Breadth is a full discovery pass that REPLACES the catalog/selection
  // outputs, silently invalidating lifecycle state built from the previous
  // catalog (recommendations, mirror locks, install generations, activation
  // manifests). Warn before overwriting and report the pool-size delta in
  // the summary (#452).
  const invalidation = await buildBreadthStateInvalidationReport(projectRoot);
  if (invalidation.invalidatedArtifacts.length > 0) {
    console.log(
      `[discover breadth] Warning: this pass REPLACES the discovery outputs. Lifecycle state built from the previous catalog is now stale: ${invalidation.invalidatedArtifacts.join(", ")}. Re-run 'agent-harness recommend report' and the affected mirror/install/activate commands to rebuild it.`,
    );
  }

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
    previousCatalogEntryCount: invalidation.priorCatalogEntryCount,
  });
}

/**
 * Builds the breadth state-invalidation report (#452): the previous catalog
 * entry count (line count of discover/catalog.assets.jsonl, null when no
 * prior pass exists) and the lifecycle artifacts built from the previous
 * catalog that a breadth pass will invalidate (recommendations, mirror
 * locks, install generations, activation manifests).
 */
export async function buildBreadthStateInvalidationReport(
  stateRoot: string,
): Promise<{
  priorCatalogEntryCount: number | null;
  invalidatedArtifacts: string[];
}> {
  const invalidatedArtifacts: string[] = [];

  if (await pathExists(join(stateRoot, "state", "recommendations.json"))) {
    invalidatedArtifacts.push("state/recommendations.json");
  }
  const mirrorLocks = await listMatchingFileNames(
    join(stateRoot, "mirror", "bundles"),
    (name) => name.endsWith(".lock.json"),
    4,
  );
  for (const lockName of mirrorLocks.slice(0, 3)) {
    invalidatedArtifacts.push(`mirror/bundles/${lockName}`);
  }
  if (mirrorLocks.length > 3) {
    invalidatedArtifacts.push(
      `mirror/bundles (+${mirrorLocks.length - 3} more lock files)`,
    );
  }
  if (await directoryHasAnyEntry(join(stateRoot, "install", "generations"))) {
    invalidatedArtifacts.push("install/generations");
  }
  for (const hostName of await listDirectoryNames(
    join(stateRoot, "activate"),
  )) {
    invalidatedArtifacts.push(`activate/${hostName}`);
  }

  return {
    priorCatalogEntryCount: await countCatalogEntryLines(
      join(stateRoot, ...CATALOG_OUTPUT_PATH),
    ),
    invalidatedArtifacts,
  };
}

/**
 * Counts the non-empty lines of a JSONL catalog file, or null when absent.
 */
async function countCatalogEntryLines(
  catalogPath: string,
): Promise<number | null> {
  const content = await readFile(catalogPath, "utf8").catch(() => null);
  if (content === null) {
    return null;
  }
  return content.split("\n").filter((line) => line.trim().length > 0).length;
}

/**
 * Lists file names in a directory matching a predicate, capped for display.
 * Missing directories contribute nothing.
 */
async function listMatchingFileNames(
  directory: string,
  matches: (name: string) => boolean,
  limit: number,
): Promise<string[]> {
  return (await readdir(directory).catch(() => []))
    .filter(matches)
    .slice(0, limit);
}

/**
 * Returns whether a directory contains at least one entry.
 */
async function directoryHasAnyEntry(directory: string): Promise<boolean> {
  return (await readdir(directory).catch(() => [])).length > 0;
}

/**
 * Lists immediate subdirectory names of a directory.
 */
async function listDirectoryNames(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/**
 * Exposes narrow discover internals for focused per-source-cap tests.
 */
export const discoverInternals = {
  applyPerSourceCap,
  buildBreadthStateInvalidationReport,
  computeAcceptanceRate,
  computeSourceDiversityWarning,
  computeDemandRelevantSourceIds,
  getEnabledSourceIds,
  shouldShowFirstRunSyncHint,
  printSourceHealthSummary,
  handleAiEnrichmentResult,
};

/**
 * Source IDs that are always demand-relevant regardless of project type.
 * These sources provide universal assets (MCP servers, skills directories)
 * that apply to any project.
 */
