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
  groupCatalogEntriesForSelection,
  buildSelectionReason,
} from "./domains/discovery/catalog-selection.js";
import {
  compareAssetCatalogEntries,
  compareSourcesByPriority,
  enhanceTrustForEntry,
  mergeRemoteCatalogEntries,
} from "./domains/discovery/catalog-utils.js";
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

import type {
  AssetCatalogEntry,
  DemandProfile,
  SelectionDuplicateDecision,
  SelectionRegistry,
  SelectionReport,
} from "./types.js";

export async function runDiscover(
  args: string[],
  workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [command = "help"] = args;

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
    case "select":
      await generateSelectionOutputs(projectRoot);
      return 0;
    case "stats":
      await printCatalogStats(projectRoot);
      return 0;
    case "inspect":
      await inspectCatalog(projectRoot, args.slice(1));
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

export { buildDemandProfile } from "./domains/discovery/demand-profile.js";

async function generateCatalog(projectRoot: string): Promise<void> {
  const sourceRegistry = await loadSourceRegistry(projectRoot);
  const selectionRegistry = await readJsonFile<SelectionRegistry>(
    join(projectRoot, "discover", "selections.json"),
  );
  const demandProfile = await readJsonFileOrNull<DemandProfile>(
    join(projectRoot, "discover", "output", "demand-profile.json"),
  );
  const enabledSources = sourceRegistry.sources
    .filter((source) => source.enabled)
    .sort(compareSourcesByPriority);
  const remoteHarvestState = await loadRemoteHarvestState(projectRoot);
  const repoBatchSize = getRuntimeConfig().batches.remoteHarvest;
  const cachedRemoteCatalogEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...REMOTE_CATALOG_STATE_OUTPUT_PATH),
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
  );
  const catalogEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...CATALOG_OUTPUT_PATH),
  );
  const groupedEntries = groupCatalogEntriesForSelection(catalogEntries);
  const selectedEntries: AssetCatalogEntry[] = [];
  const rejectedEntries: AssetCatalogEntry[] = [];
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

function printDiscoverHelp(): void {
  console.log(`discover commands:
  demand-profile   Scan the working directory and write discover/output/demand-profile.json
  sources          Summarize enabled discovery sources into discover/output/source-index.json
  catalog          Harvest local sources into discover/catalog.assets.jsonl
  select           Apply canonical selection rules and write selected/rejected JSONL outputs
  stats            Print catalog summary counts grouped by source, kind, host, and authority
  inspect          Print catalog entries filtered by --source <id> or --id <assetId>`);
}
