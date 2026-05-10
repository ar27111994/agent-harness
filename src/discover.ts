import { join } from "node:path";

import { isGitHubRepoSource } from "./github.js";
import {
  inspectCatalog,
  printCatalogStats,
} from "./domains/discovery/catalog-inspection.js";

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
import { buildDemandProfile } from "./domains/discovery/demand-profile.js";
import { harvestGitHubRepoSource } from "./domains/discovery/github-harvester.js";
import { generateSourceIndex } from "./domains/discovery/source-index.js";
import {
  harvestLocalDirectorySource,
  harvestLocalManifestSource,
} from "./domains/discovery/local-harvesters.js";
import { loadSourceRegistry } from "./domains/discovery/source-registry.js";
import {
  CATALOG_OUTPUT_PATH,
  DEMAND_PROFILE_OUTPUT_PATH,
  REJECTED_CATALOG_OUTPUT_PATH,
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
import { writeSourceUtilizationReport } from "./domains/discovery/source-utilization.js";
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
      await generateDemandProfile(workingDirectory, projectRoot);
      return 0;
    case "sources":
      await generateSourceIndex(projectRoot);
      return 0;
    case "catalog":
      await generateCatalog(projectRoot);
      return 0;
    case "select": {
      const aiEnrichmentFlags = parseAiEnrichmentFlags(rest);
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
      await generateDemandProfile(workingDirectory, projectRoot);
      await generateSourceIndex(projectRoot);
      await generateCatalog(projectRoot);
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
): Promise<void> {
  const demandProfile = await buildDemandProfile(scanRoot);
  const outputPath = join(projectRoot, ...DEMAND_PROFILE_OUTPUT_PATH);
  await writeJsonFile(outputPath, demandProfile);

  console.log(`Demand profile written to ${toPosixPath(outputPath)}`);
}

/**
 * Re-exports demand profile construction for programmatic discovery callers.
 */
export { buildDemandProfile } from "./domains/discovery/demand-profile.js";

async function generateCatalog(projectRoot: string): Promise<void> {
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
    switch (source.kind) {
      case "local-manifest":
        catalogEntries.push(
          ...(await harvestLocalManifestSource(
            source,
            demandProfile,
            selectionRegistry,
            projectRoot,
          )),
        );
        break;
      case "local-directory":
        catalogEntries.push(
          ...(await harvestLocalDirectorySource(
            source,
            demandProfile,
            selectionRegistry,
            projectRoot,
          )),
        );
        break;
      case "package-registry":
        catalogEntries.push(
          ...(await harvestPackageRegistrySource(
            source,
            demandProfile,
            selectionRegistry,
          )),
        );
        break;
      case "docs":
      case "marketplace":
      case "registry":
        catalogEntries.push(
          ...(await harvestReferenceSource(
            source,
            demandProfile,
            selectionRegistry,
          )),
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
      harvestedRepoEntries.push(
        ...(await harvestGitHubRepoSource(
          source,
          demandProfile,
          selectionRegistry,
          projectRoot,
        )),
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

  catalogEntries.push(...mergedRemoteCatalogEntries);

  catalogEntries.push(
    ...(await harvestOfficialSkillIndexes(
      projectRoot,
      demandProfile,
      selectionRegistry,
    )),
  );

  const sortedEntries = catalogEntries
    .map((entry) => enhanceTrustForEntry(entry))
    .sort(compareAssetCatalogEntries);
  const outputPath = join(projectRoot, ...CATALOG_OUTPUT_PATH);
  await writeJsonLinesFile(outputPath, sortedEntries);
  await writeSourceUtilizationReport(
    projectRoot,
    enabledSources,
    sortedEntries,
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
}

async function generateSelectionOutputs(projectRoot: string): Promise<void> {
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
  const rejectedEntries: AssetCatalogEntry[] = [
    ...relevanceFilter.rejectedEntries,
  ];
  const duplicateDecisions: SelectionDuplicateDecision[] = [];

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
      rejectedEntries.push(...rejectedGroupEntries);
      duplicateDecisions.push({
        duplicateGroup: groupKey,
        selectedAssetId: selectedEntry.id,
        rejectedAssetIds: rejectedGroupEntries.map((entry) => entry.id),
        selectionReason: buildSelectionReason(selectedEntry, selectionRegistry),
      });
    }
  }

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

  console.log(
    `Selection outputs written to ${toPosixPath(join(projectRoot, "discover", "output"))} (${sortedSelectedEntries.length} selected, ${sortedRejectedEntries.length} rejected)`,
  );
}

function parseAiEnrichmentFlags(args: readonly string[]): {
  explicitRequested: boolean;
  disableRequested: boolean;
  force: boolean;
  requireSuccess: boolean;
} {
  const explicitRequested = args.includes("--ai-enrich");
  const disableRequested = args.includes("--no-ai-enrich");

  if (explicitRequested && disableRequested) {
    throw new Error("--ai-enrich and --no-ai-enrich cannot be used together.");
  }

  return {
    explicitRequested,
    disableRequested,
    force: args.includes("--force"),
    requireSuccess: args.includes("--require-ai-enrich"),
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

function printDiscoverHelp(): void {
  console.log(`discover commands:
  demand-profile   Scan the working directory and write discover/output/demand-profile.json
  sources          Summarize enabled discovery sources into discover/output/source-index.json
  catalog          Harvest local sources into discover/catalog.assets.jsonl
  select           Apply canonical selection rules and write selected/rejected JSONL outputs
  full             Run demand-profile, sources, catalog, and select in one pass
  stats            Print catalog summary counts grouped by source, kind, host, and authority
  enrich           Run bounded AI-assisted enrichment against the selected catalog
  inspect          Print catalog entries filtered by --source <id> or --id <assetId>

AI enrichment options:
  --ai-enrich            Explicitly request enrichment after select/full
  --no-ai-enrich         Explicitly skip enrichment for this select/full run
  --force                Ignore unchanged-input cache reuse and force a new provider call
  --require-ai-enrich    Fail the command when enrichment does not complete or reuse successfully`);
}
