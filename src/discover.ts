import { stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  fetchGitHubRepoSnapshot,
  isGitHubRepoSource,
  type GitHubRepoSnapshot,
} from "./github.js";
import {
  extractRepositoryUrlFromNpmMetadata,
  extractRepositoryUrlFromPypiMetadata,
  fetchNpmPackageMetadata,
  fetchPypiPackageMetadata,
} from "./package-registries.js";
import {
  buildOfficialIndexAssetStatus,
  fetchOfficialIndexPageContent,
} from "./official-index.js";
import { getOptionValue } from "./lib/cli-options.js";
import { fetchTextWithGuards } from "./lib/http.js";
import {
  listFilesRecursive,
  listFilesRecursiveWithTelemetry,
  pathExists,
  readJsonFile,
  readJsonLinesFile,
  readJsonFileOrNull,
  readTextFileOrNull,
  toPosixPath,
  toRelativePosixPath,
  writeJsonFile,
  writeJsonLinesFile,
} from "./files.js";
import { getRuntimeConfig } from "./config/runtime.js";
import {
  collectDetectorSignals,
  isDetectorInspectableFile,
} from "./domains/discovery/detectors.js";
import { buildGeneratedLocalSources } from "./domains/discovery/local-sources.js";
import { resolvePortablePath } from "./lib/paths.js";
import type {
  AssetCatalogEntry,
  AssetContextCost,
  AssetKind,
  AssetRisk,
  AssetStatus,
  CompatibilityMode,
  DemandEvidence,
  DemandProfile,
  DemandSignalSet,
  HostTarget,
  SelectionDuplicateDecision,
  SelectionRegistry,
  SelectionReport,
  SourceDefinition,
  SourceIndex,
  SourceRegistry,
} from "./types.js";

interface PackageJsonShape {
  author?: string | { name?: string };
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: {
    node?: string;
  };
  keywords?: string[];
  name?: string;
}

interface ActorJsonShape {
  categories?: string[];
  description?: string;
  dockerfile?: string;
  title?: string;
  webServerSchema?: string;
}

interface LocalManifestShape {
  updatedAt?: string;
  entries?: string[];
}

interface SourcePackShape {
  schemaVersion: number;
  entries: Array<{
    id: string;
    repo: string;
    authorityTier?: SourceDefinition["authorityTier"];
    publisher?: string;
    publisherVerified?: boolean;
    hosts?: HostTarget[];
    assetKinds?: AssetKind[];
    priority?: number;
    enabled?: boolean;
    name?: string;
  }>;
}

interface OfficialSkillIndexShape {
  schemaVersion: number;
  indexes: Array<{
    id: string;
    kind: string;
    url: string;
    description?: string;
  }>;
}

interface RemoteHarvestState {
  schemaVersion: number;
  generatedAt: string;
  nextRepoOffset: number;
  completedSourceIds: string[];
}

interface ParsedMarkdownMetadata {
  fields: Record<string, string | string[]>;
  heading: string | null;
  description: string | null;
  tags: string[];
  dependencies: string[];
  lineCount: number;
  body: string;
}

interface ClassifiedLocalFile {
  assetKind: AssetKind;
  compatibilityMode: CompatibilityMode;
  hosts: HostTarget[];
}

const APIFY_ACTOR_JSON_PATH_PATTERN = /[\\/]\.actor[\\/]actor\.json$/iu;
const LOGGING_TEXT_MARKERS = ["logger", "logging", "debugger", "debug"];
const MOCKING_TEXT_MARKERS = ["mock", "mocking"];
const REPLAY_TEXT_MARKERS = ["replay", "forwarding", "forwarder"];
const WEBHOOK_TEXT_MARKERS = ["webhook", "webhooks"];

const DEMAND_PROFILE_OUTPUT_PATH = [
  "discover",
  "output",
  "demand-profile.json",
];
const SOURCE_INDEX_OUTPUT_PATH = ["discover", "output", "source-index.json"];
const CATALOG_OUTPUT_PATH = ["discover", "catalog.assets.jsonl"];
const SELECTED_CATALOG_OUTPUT_PATH = [
  "discover",
  "output",
  "catalog.selected.jsonl",
];
const REJECTED_CATALOG_OUTPUT_PATH = [
  "discover",
  "output",
  "catalog.rejected.jsonl",
];
const SELECTION_REPORT_OUTPUT_PATH = [
  "discover",
  "output",
  "selection-report.json",
];
const SOURCE_UTILIZATION_OUTPUT_PATH = [
  "discover",
  "output",
  "source-utilization.json",
];
const REMOTE_HARVEST_STATE_OUTPUT_PATH = [
  "state",
  "discover",
  "remote-harvest.json",
];
const REMOTE_CATALOG_STATE_OUTPUT_PATH = [
  "state",
  "discover",
  "remote-catalog.jsonl",
];
const OFFICIAL_INDEX_CONTENT_MAX_BYTES = 1_000_000;
const OFFICIAL_INDEX_ALLOWED_ORIGINS = [
  "https://raw.githubusercontent.com",
] as const;

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
  const scanResult = await listFilesRecursiveWithTelemetry(scanRoot);
  const scannedFiles = scanResult.files;
  const evidence: DemandEvidence[] = [];
  const aggregateSignals = createEmptySignalSet();

  for (const filePath of scannedFiles) {
    const fileName = basename(filePath);

    if (!shouldInspectFile(fileName, filePath)) {
      continue;
    }

    const matchedSignals = collectStaticSignals(fileName, filePath);

    collectDetectorSignals(fileName, filePath, matchedSignals);

    if (fileName === "package.json") {
      await enrichPackageJsonSignals(filePath, matchedSignals);
    }

    if (fileName === "requirements.txt") {
      await enrichRequirementsSignals(filePath, matchedSignals);
    }

    if (fileName === "pyproject.toml") {
      await enrichPyProjectSignals(filePath, matchedSignals);
    }

    if (isActorJsonFile(fileName, filePath)) {
      await enrichActorJsonSignals(filePath, matchedSignals);
    }

    if (!hasAnySignals(matchedSignals)) {
      continue;
    }

    mergeSignals(aggregateSignals, matchedSignals);
    evidence.push({
      path: toRelativePosixPath(scanRoot, filePath),
      fileName,
      matchedSignals,
    });
  }

  const demandProfile: DemandProfile = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: toPosixPath(scanRoot),
    summary: {
      scannedFiles: scannedFiles.length,
      matchedFiles: evidence.length,
      scanTruncated: scanResult.telemetry.truncated,
      truncationReason: scanResult.telemetry.truncationReason,
      scannedBytes: scanResult.telemetry.visitedBytes,
    },
    signals: sortSignalSet(aggregateSignals),
    evidence: evidence.sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
  };

  const outputPath = join(projectRoot, ...DEMAND_PROFILE_OUTPUT_PATH);
  await writeJsonFile(outputPath, demandProfile);

  console.log(`Demand profile written to ${toPosixPath(outputPath)}`);
}

async function generateSourceIndex(projectRoot: string): Promise<void> {
  const sourceRegistry = await loadSourceRegistry(projectRoot);
  const selectionRegistry = await readJsonFile<SelectionRegistry>(
    join(projectRoot, "discover", "selections.json"),
  );
  const enabledSources = sourceRegistry.sources
    .filter((source) => source.enabled)
    .sort(compareSourcesByPriority);

  const sourceIndex: SourceIndex = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceCount: enabledSources.length,
    byAuthorityTier: countBy(enabledSources, (source) => source.authorityTier),
    byKind: countBy(enabledSources, (source) => source.kind),
    hostCoverage: countHosts(enabledSources),
    communityDefaultPolicy:
      selectionRegistry.selectionPolicies.communityDefaultPolicy,
    enabledSources: enabledSources.map((source) => ({
      id: source.id,
      kind: source.kind,
      authorityTier: source.authorityTier,
      priority: source.priority,
      hosts: source.hosts,
    })),
  };

  const outputPath = join(projectRoot, ...SOURCE_INDEX_OUTPUT_PATH);
  await writeJsonFile(outputPath, sourceIndex);

  console.log(`Source index written to ${toPosixPath(outputPath)}`);
}

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

async function writeSourceUtilizationReport(
  projectRoot: string,
  enabledSources: SourceDefinition[],
  catalogEntries: AssetCatalogEntry[],
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

  const sources = enabledSources.map((source) => {
    const sourceEntries = catalogEntriesBySource.get(source.id) ?? [];
    const operationalEntries = sourceEntries.filter((entry) =>
      isOperationalCatalogEntry(entry),
    );
    return {
      id: source.id,
      kind: source.kind,
      configured: true,
      operational: operationalEntries.length > 0,
      harvestedEntries: sourceEntries.length,
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

function isOperationalCatalogEntry(entry: AssetCatalogEntry): boolean {
  return (
    entry.evidence.manifestFound ||
    entry.status.mirrorEligible ||
    entry.status.installEligible ||
    entry.status.activationEligible
  );
}

async function loadRemoteHarvestState(
  projectRoot: string,
): Promise<RemoteHarvestState> {
  return (
    (await readJsonFileOrNull<RemoteHarvestState>(
      join(projectRoot, ...REMOTE_HARVEST_STATE_OUTPUT_PATH),
    )) ?? {
      schemaVersion: 1,
      generatedAt: new Date(0).toISOString(),
      nextRepoOffset: 0,
      completedSourceIds: [],
    }
  );
}

async function writeRemoteHarvestState(
  projectRoot: string,
  state: RemoteHarvestState,
): Promise<void> {
  await writeJsonFile(
    join(projectRoot, ...REMOTE_HARVEST_STATE_OUTPUT_PATH),
    state,
  );
}

async function loadSourceRegistry(
  projectRoot: string,
): Promise<SourceRegistry> {
  const baseRegistry = await readJsonFile<SourceRegistry>(
    join(projectRoot, "discover", "sources.json"),
  );
  const sourcePackDirectory = join(projectRoot, "discover", "source-packs");

  const registryWithLocalSeeds = mergeSourceDefinitions(
    baseRegistry,
    buildGeneratedLocalSources(),
  );

  if (!(await pathExists(sourcePackDirectory))) {
    return registryWithLocalSeeds;
  }

  const sourcePackFiles = (await listFilesRecursive(sourcePackDirectory))
    .filter((filePath) => filePath.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));

  const generatedSources: SourceDefinition[] = [];
  const existingSourceIds = new Set(
    registryWithLocalSeeds.sources.map((source) => source.id),
  );
  const existingRepoUrls = new Set(
    registryWithLocalSeeds.sources
      .map((source) => source.endpoints.repo?.toLowerCase())
      .filter((value): value is string => typeof value === "string"),
  );

  for (const sourcePackFile of sourcePackFiles) {
    const sourcePack = await readJsonFile<SourcePackShape>(sourcePackFile);
    for (const entry of sourcePack.entries) {
      const normalizedRepoUrl = entry.repo.toLowerCase();
      if (
        existingSourceIds.has(entry.id) ||
        existingRepoUrls.has(normalizedRepoUrl)
      ) {
        continue;
      }

      generatedSources.push({
        id: entry.id,
        name: entry.name ?? humanizeSlug(lastPathSegment(entry.repo)),
        kind: "repo",
        authorityTier: entry.authorityTier ?? "trusted-community",
        publisher: {
          name: entry.publisher ?? entry.repo.split("/")[3] ?? entry.id,
          verified: entry.publisherVerified ?? false,
          owner: entry.repo.split("/")[3],
        },
        hosts: entry.hosts ?? ["copilot-vscode", "opencode"],
        assetKinds: entry.assetKinds ?? [
          "skill",
          "agent",
          "instruction",
          "workflow",
          "plugin",
          "mcp-server",
        ],
        discoveryMode: "catalog",
        priority: entry.priority ?? 60,
        enabled: entry.enabled ?? true,
        endpoints: {
          repo: entry.repo,
        },
        rules: {
          officialPreferred: true,
          allowMirror: false,
          allowInstall: false,
        },
      });

      existingSourceIds.add(entry.id);
      existingRepoUrls.add(normalizedRepoUrl);
    }
  }

  return {
    ...registryWithLocalSeeds,
    sources: [...registryWithLocalSeeds.sources, ...generatedSources],
  };
}

/**
 * Merges generated local seeds with checked-in sources while refreshing
 * machine-specific endpoints and preserving user-editable source settings.
 */
function mergeSourceDefinitions(
  baseRegistry: SourceRegistry,
  generatedSources: SourceDefinition[],
): SourceRegistry {
  const mergedSources = [...baseRegistry.sources];
  const sourceIndexes = new Map(
    mergedSources.map((source, index) => [source.id, index] as const),
  );

  for (const source of generatedSources) {
    const existingIndex = sourceIndexes.get(source.id);

    if (existingIndex !== undefined) {
      mergedSources[existingIndex] = {
        ...source,
        ...mergedSources[existingIndex],
        endpoints: source.endpoints,
      };
      continue;
    }

    mergedSources.push(source);
    sourceIndexes.set(source.id, mergedSources.length - 1);
  }

  return {
    ...baseRegistry,
    sources: mergedSources,
  };
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

async function printCatalogStats(projectRoot: string): Promise<void> {
  const catalogEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...CATALOG_OUTPUT_PATH),
  );
  const selectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...SELECTED_CATALOG_OUTPUT_PATH),
  );
  const rejectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...REJECTED_CATALOG_OUTPUT_PATH),
  );

  const stats = {
    catalogCount: catalogEntries.length,
    selectedCount: selectedEntries.length,
    rejectedCount: rejectedEntries.length,
    bySource: countBy(catalogEntries, (entry) => entry.source.sourceId),
    byAuthorityTier: countBy(
      catalogEntries,
      (entry) => entry.source.authorityTier,
    ),
    byAssetKind: countBy(catalogEntries, (entry) => entry.assetKind),
    byCompatibility: countBy(
      catalogEntries,
      (entry) => entry.compatibilityMode,
    ),
    byHost: countHostsForCatalog(catalogEntries),
  };

  console.log(JSON.stringify(stats, null, 2));
}

async function harvestPackageRegistrySource(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
): Promise<AssetCatalogEntry[]> {
  const registryKind = source.id === "pypi-registry" ? "pypi" : "npm";
  const packageCandidates = collectPackageCandidatesFromDemandProfile(
    demandProfile,
    registryKind,
  );
  const entries: AssetCatalogEntry[] = [];

  for (const packageName of packageCandidates) {
    if (source.id === "npm-registry") {
      const npmMetadata = await fetchNpmPackageMetadata(packageName);
      if (!npmMetadata) {
        continue;
      }

      entries.push(
        buildPackageRegistryCatalogEntry(
          source,
          packageName,
          npmMetadata.description ?? packageName,
          extractRepositoryUrlFromNpmMetadata(npmMetadata),
          demandProfile,
          selectionRegistry,
          "npm",
        ),
      );
      continue;
    }

    if (source.id === "pypi-registry") {
      const pypiMetadata = await fetchPypiPackageMetadata(packageName);
      if (!pypiMetadata) {
        continue;
      }

      entries.push(
        buildPackageRegistryCatalogEntry(
          source,
          packageName,
          pypiMetadata.info.summary ?? packageName,
          extractRepositoryUrlFromPypiMetadata(pypiMetadata),
          demandProfile,
          selectionRegistry,
          "pypi",
        ),
      );
    }
  }

  return entries;
}

function collectPackageCandidatesFromDemandProfile(
  demandProfile: DemandProfile | null,
  registryKind: "npm" | "pypi",
): string[] {
  if (!demandProfile) {
    return [];
  }

  const packageCandidates = new Set<string>();

  for (const evidence of demandProfile.evidence) {
    const joinedSignals = [
      ...evidence.matchedSignals.frameworks,
      ...evidence.matchedSignals.concerns,
      ...evidence.matchedSignals.tooling,
    ];

    for (const signal of joinedSignals) {
      const dependencyPrefix = `${registryKind}:`;
      if (signal.startsWith(dependencyPrefix)) {
        packageCandidates.add(signal.slice(dependencyPrefix.length));
      }
    }
  }

  return [...packageCandidates].sort((left, right) =>
    left.localeCompare(right),
  );
}

function buildPackageRegistryCatalogEntry(
  source: SourceDefinition,
  packageName: string,
  description: string,
  repositoryUrl: string | undefined,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
  registryKind: "npm" | "pypi",
): AssetCatalogEntry {
  const capabilities = uniqueStrings([
    ...splitIntoKeywords(packageName),
    ...splitIntoKeywords(description),
    registryKind,
  ]).filter((token) => !GENERIC_CAPABILITY_TOKENS.has(token));
  const assetKind = packageName.includes("mcp")
    ? ("mcp-server" satisfies AssetKind)
    : ("plugin" satisfies AssetKind);
  const hosts =
    assetKind === "mcp-server"
      ? (["shared"] satisfies HostTarget[])
      : source.hosts;
  const compatibilityMode =
    assetKind === "mcp-server"
      ? ("native" satisfies CompatibilityMode)
      : ("adaptable" satisfies CompatibilityMode);

  return {
    id: buildCatalogId(`${source.id}:${registryKind}`, packageName),
    displayName: packageName,
    assetKind,
    hosts,
    compatibilityMode,
    source: {
      sourceId: source.id,
      authorityTier: source.authorityTier,
      sourceKind: source.kind,
      sourcePriority: source.priority,
      originUrl: repositoryUrl ?? source.endpoints.baseUrl,
      publisher: source.publisher?.name ?? source.id,
      publisherVerified: source.publisher?.verified ?? false,
    },
    trust: {
      score: computeTrustScore({
        authorityTier: source.authorityTier,
        sourceKind: source.kind,
        sourcePriority: source.priority,
        publisherVerified: source.publisher?.verified ?? false,
        compatibilityMode,
        installMethod: `${registryKind}-metadata`,
      }),
      signals: buildTrustSignals({
        authorityTier: source.authorityTier,
        sourceKind: source.kind,
        sourcePriority: source.priority,
        publisherVerified: source.publisher?.verified ?? false,
        compatibilityMode,
        installMethod: `${registryKind}-metadata`,
      }),
    },
    capabilities,
    install: {
      method: `${registryKind}-metadata`,
      nativeHosts: compatibilityMode === "native" ? hosts : undefined,
      adaptableHosts: compatibilityMode === "adaptable" ? hosts : undefined,
      manifestEntry: packageName,
    },
    evidence: {
      manifestFound: true,
      readmeFound: false,
      examplesFound: false,
      docsLinked: Boolean(repositoryUrl),
      lineCount: 1,
      rootPath: repositoryUrl ?? source.endpoints.baseUrl,
    },
    maintenance: {
      lastUpdated: new Date().toISOString(),
      stars: 0,
      releaseCadence: `${registryKind}-metadata`,
    },
    risk: buildRisk(false, false, false),
    contextCost: {
      sizeClass: "tiny",
      estimatedPromptWeight: 1,
    },
    fit: {
      portfolioFit: computePortfolioFit(capabilities, demandProfile),
      hostFit: computeHostFit(hosts, compatibilityMode),
    },
    dedupe: {
      duplicateGroup: findDuplicateGroup(capabilities, selectionRegistry),
      candidateRankHint: buildCandidateRankHint(source.authorityTier),
    },
    status: {
      cataloged: true,
      mirrorEligible: false,
      installEligible: false,
      activationEligible: false,
    },
  };
}

async function harvestReferenceSource(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
): Promise<AssetCatalogEntry[]> {
  const originUrl = getReferenceSourceOriginUrl(source);
  const harvestedContent = await fetchOfficialIndexPageContent(originUrl);

  return [
    buildReferenceSourceCatalogEntry(source, demandProfile, selectionRegistry, {
      harvestedContent: harvestedContent ?? undefined,
      originUrl,
    }),
  ];
}

function buildReferenceSourceCatalogEntry(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
  options: {
    harvestedContent?: string;
    originUrl?: string;
  } = {},
): AssetCatalogEntry {
  const originUrl = options.originUrl ?? getReferenceSourceOriginUrl(source);
  const assetKind: AssetKind = "reference-pack";
  const harvestedContent = options.harvestedContent;
  const wasHarvested = typeof harvestedContent === "string";
  const capabilities = uniqueStrings([
    ...splitIntoKeywords(source.name),
    ...splitIntoKeywords(source.id),
    ...splitIntoKeywords(harvestedContent ?? ""),
    source.kind,
    assetKind,
  ]).filter((token) => !GENERIC_CAPABILITY_TOKENS.has(token));
  const compatibilityMode: CompatibilityMode = wasHarvested
    ? "adaptable"
    : source.kind === "marketplace"
      ? "partial"
      : "reference-only";

  return {
    id: buildCatalogId(source.id, originUrl),
    displayName: source.name,
    assetKind,
    hosts: source.hosts,
    compatibilityMode,
    source: {
      sourceId: source.id,
      authorityTier: source.authorityTier,
      sourceKind: source.kind,
      sourcePriority: source.priority,
      originUrl,
      publisher: source.publisher?.name ?? source.id,
      publisherVerified: source.publisher?.verified ?? false,
    },
    trust: {
      score: computeTrustScore({
        authorityTier: source.authorityTier,
        sourceKind: source.kind,
        sourcePriority: source.priority,
        publisherVerified: source.publisher?.verified ?? false,
        compatibilityMode,
        installMethod: wasHarvested
          ? `${source.kind}-summary`
          : `${source.kind}-reference`,
      }),
      signals: buildTrustSignals({
        authorityTier: source.authorityTier,
        sourceKind: source.kind,
        sourcePriority: source.priority,
        publisherVerified: source.publisher?.verified ?? false,
        compatibilityMode,
        installMethod: wasHarvested
          ? `${source.kind}-summary`
          : `${source.kind}-reference`,
      }),
    },
    capabilities,
    install: {
      method: wasHarvested
        ? `${source.kind}-summary`
        : `${source.kind}-reference`,
      adaptableHosts: source.hosts,
      manifestEntry: originUrl,
    },
    evidence: {
      manifestFound: wasHarvested,
      readmeFound: wasHarvested,
      examplesFound: false,
      docsLinked: true,
      lineCount: harvestedContent?.split(/\r?\n/u).length ?? 1,
      rootPath: originUrl,
    },
    maintenance: {
      lastUpdated: new Date().toISOString(),
      stars: 0,
      releaseCadence: "source-reference",
    },
    risk: buildRisk(false, false, false),
    contextCost: {
      sizeClass: "tiny",
      estimatedPromptWeight: 1,
    },
    fit: {
      portfolioFit: computePortfolioFit(capabilities, demandProfile),
      hostFit: computeHostFit(source.hosts, compatibilityMode),
    },
    dedupe: {
      duplicateGroup: findDuplicateGroup(capabilities, selectionRegistry),
      candidateRankHint: buildCandidateRankHint(source.authorityTier),
    },
    status: {
      cataloged: true,
      mirrorEligible: wasHarvested && source.rules.allowMirror,
      installEligible: false,
      activationEligible: false,
    },
  };
}

function getReferenceSourceOriginUrl(source: SourceDefinition): string {
  return (
    source.endpoints.docsUrl ??
    source.endpoints.baseUrl ??
    source.endpoints.repo ??
    source.id
  );
}

async function inspectCatalog(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const sourceId = getOptionValue(args, "--source");
  const assetId = getOptionValue(args, "--id");
  const limit = Number(getOptionValue(args, "--limit") ?? "20");
  const catalogEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...CATALOG_OUTPUT_PATH),
  );

  let matches = catalogEntries;

  if (sourceId) {
    matches = matches.filter((entry) => entry.source.sourceId === sourceId);
  }

  if (assetId) {
    matches = matches.filter((entry) => entry.id === assetId);
  }

  console.log(
    JSON.stringify(
      {
        totalMatches: matches.length,
        sourceId: sourceId ?? null,
        assetId: assetId ?? null,
        results: matches.slice(0, limit),
      },
      null,
      2,
    ),
  );
}

async function harvestOfficialSkillIndexes(
  projectRoot: string,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
): Promise<AssetCatalogEntry[]> {
  const indexConfigPath = join(
    projectRoot,
    "discover",
    "official-skills-indexes.json",
  );
  const indexConfig =
    await readJsonFileOrNull<OfficialSkillIndexShape>(indexConfigPath);
  if (!indexConfig) {
    return [];
  }

  const entries: AssetCatalogEntry[] = [];

  const seenIds = new Set<string>();

  for (const index of indexConfig.indexes) {
    const content = await fetchOfficialIndexContent(index.url);
    if (!content) {
      continue;
    }

    const officialSkillRepoUrlsByOwnerAndSlug =
      extractOfficialSkillRepoUrls(content);

    for (const parsedEntry of parseOfficialIndexEntries(
      content,
      demandProfile,
      selectionRegistry,
    )) {
      const sourceIdParts = parsedEntry.source.sourceId.split(":");
      const owner = sourceIdParts[1];
      const manifestEntry = parsedEntry.install.manifestEntry;
      const officialRepoUrl =
        owner && manifestEntry
          ? officialSkillRepoUrlsByOwnerAndSlug.get(`${owner}:${manifestEntry}`)
          : undefined;
      const entry = officialRepoUrl
        ? {
            ...parsedEntry,
            evidence: {
              ...parsedEntry.evidence,
              rootPath: officialRepoUrl,
            },
          }
        : parsedEntry;

      if (seenIds.has(entry.id)) {
        continue;
      }

      seenIds.add(entry.id);
      entries.push(entry);

      if (owner && manifestEntry) {
        const resolvedRepoSource = await resolveOfficialIndexEntryToRepoSource(
          owner,
          manifestEntry,
          entry,
          projectRoot,
          officialRepoUrl,
        );
        if (resolvedRepoSource && !seenIds.has(resolvedRepoSource.id)) {
          seenIds.add(resolvedRepoSource.id);
          entries.push(resolvedRepoSource);
        }
      }
    }
  }

  return entries;
}

async function fetchOfficialIndexContent(url: string): Promise<string | null> {
  return fetchTextWithGuards(url, {
    allowedOrigins: OFFICIAL_INDEX_ALLOWED_ORIGINS,
    headers: buildOfficialIndexHeaders(),
    maxBytes: OFFICIAL_INDEX_CONTENT_MAX_BYTES,
  });
}

function buildOfficialIndexHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    "User-Agent": "agent-harness",
  };

  const githubToken = getRuntimeConfig().github.token;
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  return headers;
}

function parseOfficialIndexEntries(
  content: string,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
): AssetCatalogEntry[] {
  const matches = [
    ...content.matchAll(
      /\*\*\[([^\]]+)\]\((https:\/\/officialskills\.sh\/([^/]+)\/skills\/([^)]+))\)\*\*\s*-\s*([^\n]+)/gu,
    ),
  ];
  const entries: AssetCatalogEntry[] = [];

  for (const match of matches) {
    const displayName = match[1]?.trim();
    const originUrl = match[2]?.trim();
    const owner = match[3]?.trim();
    const slug = match[4]?.trim();
    const description = match[5]?.trim() ?? "";

    if (!displayName || !originUrl || !owner || !slug) {
      continue;
    }

    const authorityTier = isOfficialIndexOwner(owner)
      ? "official-first-party"
      : "trusted-community";
    const capabilities = uniqueStrings([
      ...splitIntoKeywords(owner),
      ...splitIntoKeywords(slug),
      ...splitIntoKeywords(description),
    ]).filter((token) => !GENERIC_CAPABILITY_TOKENS.has(token));
    const hosts = owner.includes("scopeblind")
      ? (["copilot-vscode", "opencode", "shared"] satisfies HostTarget[])
      : (["copilot-vscode", "opencode"] satisfies HostTarget[]);
    const assetKind = determineOfficialIndexAssetKind(owner, slug, description);
    const compatibilityMode =
      authorityTier === "official-first-party"
        ? ("native" satisfies CompatibilityMode)
        : ("adaptable" satisfies CompatibilityMode);

    entries.push({
      id: buildCatalogId(`official-index:${owner}`, slug),
      displayName,
      assetKind,
      hosts,
      compatibilityMode,
      source: {
        sourceId: `official-index:${owner}`,
        authorityTier,
        sourceKind: "docs",
        sourcePriority: authorityTier === "official-first-party" ? 100 : 70,
        originUrl,
        publisher: owner,
        publisherVerified: authorityTier === "official-first-party",
      },
      trust: {
        score: computeTrustScore({
          authorityTier,
          sourceKind: "docs",
          sourcePriority: authorityTier === "official-first-party" ? 100 : 70,
          publisherVerified: authorityTier === "official-first-party",
          compatibilityMode,
          installMethod: "official-index-entry",
        }),
        signals: buildTrustSignals({
          authorityTier,
          sourceKind: "docs",
          sourcePriority: authorityTier === "official-first-party" ? 100 : 70,
          publisherVerified: authorityTier === "official-first-party",
          compatibilityMode,
          installMethod: "official-index-entry",
        }),
      },
      capabilities,
      install: {
        method: "official-index-entry",
        nativeHosts: compatibilityMode === "native" ? hosts : undefined,
        adaptableHosts: compatibilityMode === "adaptable" ? hosts : undefined,
        manifestEntry: slug,
      },
      evidence: {
        manifestFound: true,
        readmeFound: false,
        examplesFound: false,
        docsLinked: true,
        lineCount: 1,
        rootPath: originUrl,
      },
      maintenance: {
        lastUpdated: new Date().toISOString(),
        stars: 0,
        releaseCadence: "index-listed",
      },
      risk: buildRisk(false, false, false),
      contextCost: {
        sizeClass: "tiny",
        estimatedPromptWeight: 1,
      },
      fit: {
        portfolioFit: computePortfolioFit(capabilities, demandProfile),
        hostFit: computeHostFit(hosts, compatibilityMode),
      },
      dedupe: {
        duplicateGroup:
          buildOfficialIndexDuplicateGroup(owner, slug) ??
          findDuplicateGroup(capabilities, selectionRegistry),
        candidateRankHint: buildCandidateRankHint(authorityTier),
      },
      status: buildOfficialIndexAssetStatus(authorityTier),
    });
  }

  return entries;
}

function determineOfficialIndexAssetKind(
  owner: string,
  slug: string,
  description: string,
): AssetKind {
  const combinedText = `${owner} ${slug} ${description}`.toLowerCase();

  if (combinedText.includes("mcp")) {
    return "mcp-server";
  }

  if (combinedText.includes("workflow") || combinedText.includes("playbook")) {
    return "workflow";
  }

  if (
    combinedText.includes("guide") ||
    combinedText.includes("reference") ||
    combinedText.includes("cookbook")
  ) {
    return "reference-pack";
  }

  if (combinedText.includes("plugin") || combinedText.includes("extension")) {
    return "plugin";
  }

  return "skill";
}

function buildOfficialIndexDuplicateGroup(owner: string, slug: string): string {
  return `official-index:${owner}:${slug}`;
}

function isOfficialIndexOwner(owner: string): boolean {
  return [
    "anthropics",
    "supabase",
    "google-gemini",
    "stripe",
    "trycourier",
    "callstackincubator",
    "better-auth",
    "tinybirdco",
    "hashicorp",
    "sanity-io",
    "firecrawl",
    "neondatabase",
    "clickhouse",
    "remotion-dev",
    "replicate",
    "typefully",
    "vercel-labs",
    "cloudflare",
    "netlify",
    "google-labs",
    "huggingface",
    "microsoft",
    "openai",
    "figma",
    "expo",
    "flutter",
    "genkit-ai",
    "firebase",
    "apify",
    "duckdb",
    "scopeblind",
  ].includes(owner);
}

async function resolveOfficialIndexEntryToRepoSource(
  owner: string,
  slug: string,
  entry: AssetCatalogEntry,
  projectRoot: string,
  officialRepoUrl?: string,
): Promise<AssetCatalogEntry | null> {
  const sourceRegistry = await loadSourceRegistry(projectRoot);
  const matchingSource = sourceRegistry.sources.find((source) => {
    const repoUrl = source.endpoints.repo?.toLowerCase();
    if (officialRepoUrl && repoUrl === officialRepoUrl.toLowerCase()) {
      return true;
    }

    return (
      repoUrl?.includes(`/${owner.toLowerCase()}/`) &&
      source.authorityTier === entry.source.authorityTier
    );
  });

  if (!matchingSource) {
    return null;
  }

  return {
    ...entry,
    id: buildCatalogId(matchingSource.id, slug),
    source: {
      sourceId: matchingSource.id,
      authorityTier: matchingSource.authorityTier,
      sourceKind: matchingSource.kind,
      sourcePriority: matchingSource.priority,
      originUrl: matchingSource.endpoints.repo ?? entry.source.originUrl,
      publisher: matchingSource.publisher?.name ?? entry.source.publisher,
      publisherVerified:
        matchingSource.publisher?.verified ?? entry.source.publisherVerified,
    },
    trust: {
      score: computeTrustScore({
        authorityTier: matchingSource.authorityTier,
        sourceKind: matchingSource.kind,
        sourcePriority: matchingSource.priority,
        publisherVerified: matchingSource.publisher?.verified ?? false,
        compatibilityMode: entry.compatibilityMode,
        installMethod: "github-tree-metadata",
      }),
      signals: buildTrustSignals({
        authorityTier: matchingSource.authorityTier,
        sourceKind: matchingSource.kind,
        sourcePriority: matchingSource.priority,
        publisherVerified: matchingSource.publisher?.verified ?? false,
        compatibilityMode: entry.compatibilityMode,
        installMethod: "github-tree-metadata",
      }),
    },
    install: {
      ...entry.install,
      method: "github-tree-metadata",
    },
    evidence: {
      ...entry.evidence,
      rootPath: matchingSource.endpoints.repo ?? entry.evidence.rootPath,
    },
    maintenance: {
      ...entry.maintenance,
      releaseCadence: "active",
    },
    dedupe: {
      ...entry.dedupe,
      duplicateGroup: buildOfficialIndexDuplicateGroup(owner, slug),
    },
    status: {
      ...entry.status,
      mirrorEligible: matchingSource.rules.allowMirror,
      installEligible: matchingSource.rules.allowMirror,
      activationEligible: matchingSource.rules.allowMirror,
    },
  };
}

function extractOfficialSkillRepoUrls(content: string): Map<string, string> {
  const repoUrls = new Map<string, string>();
  const blocks = content.split(/(?=^#\s+)/mu);

  for (const block of blocks) {
    const titleMatch = /^#\s+([^\n]+)$/mu.exec(block);
    const repoMatch = /https:\/\/github\.com\/([^/]+\/[^/\s)]+)/u.exec(block);
    if (!titleMatch || !repoMatch) {
      continue;
    }

    const title = titleMatch[1].trim();
    const ownerMatch = /([A-Za-z0-9_-]+)\//u.exec(repoMatch[1]);
    const owner = ownerMatch?.[1];
    if (!owner) {
      continue;
    }

    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
    repoUrls.set(`${owner}:${slug}`, `https://github.com/${repoMatch[1]}`);
  }

  return repoUrls;
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

async function harvestGitHubRepoSource(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
  projectRoot: string,
): Promise<AssetCatalogEntry[]> {
  try {
    const snapshot = await fetchGitHubRepoSnapshot(source, projectRoot);

    if (!snapshot) {
      return [];
    }

    return snapshot.tree.entries
      .map((entry) =>
        buildGitHubCatalogEntry(
          snapshot,
          source,
          entry.path,
          demandProfile,
          selectionRegistry,
        ),
      )
      .filter((entry): entry is AssetCatalogEntry => entry !== null);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`Skipping repo source ${source.id}: ${errorMessage}`);
    return [];
  }
}

async function harvestLocalManifestSource(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
  projectRoot: string,
): Promise<AssetCatalogEntry[]> {
  if (source.id === "local-antigravity-manifest") {
    await loadAntigravityManifestEntrySet(projectRoot);
    return [];
  }

  const filePath = resolveEndpointPath(source.endpoints.file, projectRoot);
  const manifest = await readJsonFileOrNull<LocalManifestShape>(filePath);

  if (!manifest?.entries || manifest.entries.length === 0) {
    return [];
  }

  const fileStat = await stat(filePath);
  const updatedAt = manifest.updatedAt ?? fileStat.mtime.toISOString();
  const originUrl = pathToFileURL(filePath).toString();

  return manifest.entries.map((manifestEntry) => {
    const assetKind = classifyManifestEntryAssetKind(manifestEntry);
    const hosts =
      assetKind === "mcp-server"
        ? (["shared"] satisfies HostTarget[])
        : source.hosts;
    const compatibilityMode: CompatibilityMode =
      assetKind === "mcp-server" ? "native" : "adaptable";
    const capabilities = collectManifestCapabilities(manifestEntry);

    return {
      id: buildCatalogId(source.id, manifestEntry),
      displayName: humanizeSlug(lastPathSegment(manifestEntry)),
      assetKind,
      hosts,
      compatibilityMode,
      source: {
        sourceId: source.id,
        authorityTier: source.authorityTier,
        sourceKind: source.kind,
        sourcePriority: source.priority,
        originUrl,
        publisher: source.publisher?.name ?? source.id,
        publisherVerified: source.publisher?.verified ?? false,
      },
      trust: {
        score: computeTrustScore({
          authorityTier: source.authorityTier,
          sourceKind: source.kind,
          sourcePriority: source.priority,
          publisherVerified: source.publisher?.verified ?? false,
          compatibilityMode,
          installMethod: "manifest-entry",
        }),
        signals: buildTrustSignals({
          authorityTier: source.authorityTier,
          sourceKind: source.kind,
          sourcePriority: source.priority,
          publisherVerified: source.publisher?.verified ?? false,
          compatibilityMode,
          installMethod: "manifest-entry",
        }),
      },
      capabilities,
      install: {
        method: "manifest-entry",
        adaptableHosts: hosts,
        manifestEntry,
      },
      evidence: {
        manifestFound: true,
        readmeFound: false,
        examplesFound: false,
        docsLinked: false,
        lineCount: 1,
        filePath: toPosixPath(filePath),
        rootPath: toPosixPath(dirname(filePath)),
      },
      maintenance: {
        lastUpdated: updatedAt,
        stars: 0,
        releaseCadence: "local-curated",
      },
      risk: {
        level: "low",
        hasHooks: false,
        hasExecScripts: false,
        requiresNetwork: false,
      },
      contextCost: {
        sizeClass: "tiny",
        estimatedPromptWeight: 1,
      },
      fit: {
        portfolioFit: computePortfolioFit(capabilities, demandProfile),
        hostFit: computeHostFit(hosts, compatibilityMode),
      },
      dedupe: {
        duplicateGroup: findDuplicateGroup(capabilities, selectionRegistry),
        candidateRankHint: buildCandidateRankHint(source.authorityTier),
      },
      status: buildAssetStatus(source),
    };
  });
}

async function harvestLocalDirectorySource(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
  projectRoot: string,
): Promise<AssetCatalogEntry[]> {
  const rootPath = resolveEndpointPath(source.endpoints.path, projectRoot);

  if (!(await pathExists(rootPath))) {
    return [];
  }

  const files = await listFilesRecursive(rootPath);
  const entries: AssetCatalogEntry[] = [];
  const antigravityManifestEntries =
    source.id === "local-antigravity-skills"
      ? await loadAntigravityManifestEntrySet(projectRoot)
      : null;

  for (const filePath of files) {
    const relativePath = toRelativePosixPath(rootPath, filePath);
    const classification = classifyLocalDirectoryFile(source, relativePath);

    if (!classification) {
      continue;
    }

    if (source.id === "local-antigravity-skills") {
      const antigravitySkillKey = toAntigravityManifestEntry(relativePath);
      if (
        !antigravitySkillKey ||
        !antigravityManifestEntries?.has(antigravitySkillKey)
      ) {
        continue;
      }
    }

    const content = await readTextFileOrNull(filePath);
    if (content === null) {
      continue;
    }

    const fileStat = await stat(filePath);
    const metadata = extractMarkdownMetadata(content);
    const capabilities = collectDirectoryCapabilities(relativePath, metadata);
    const risk = await determineRisk(
      source,
      classification.assetKind,
      filePath,
      content,
    );
    const sourceId =
      source.id === "local-antigravity-skills"
        ? "local-antigravity-manifest"
        : source.id;

    entries.push({
      id: buildCatalogId(sourceId, relativePath),
      displayName:
        getFirstStringField(metadata.fields.name) ??
        metadata.heading ??
        humanizeSlug(lastPathSegment(relativePath)),
      assetKind: classification.assetKind,
      hosts: classification.hosts,
      compatibilityMode: classification.compatibilityMode,
      source: {
        sourceId,
        authorityTier: source.authorityTier,
        sourceKind: source.kind,
        sourcePriority: source.priority,
        originUrl: pathToFileURL(filePath).toString(),
        publisher: source.publisher?.name ?? source.id,
        publisherVerified: source.publisher?.verified ?? false,
      },
      trust: {
        score: computeTrustScore({
          authorityTier: source.authorityTier,
          sourceKind: source.kind,
          sourcePriority: source.priority,
          publisherVerified: source.publisher?.verified ?? false,
          compatibilityMode: classification.compatibilityMode,
          installMethod: "local-file",
        }),
        signals: buildTrustSignals({
          authorityTier: source.authorityTier,
          sourceKind: source.kind,
          sourcePriority: source.priority,
          publisherVerified: source.publisher?.verified ?? false,
          compatibilityMode: classification.compatibilityMode,
          installMethod: "local-file",
        }),
      },
      capabilities,
      install: {
        method: "local-file",
        nativeHosts:
          classification.compatibilityMode === "native"
            ? classification.hosts
            : undefined,
        adaptableHosts:
          classification.compatibilityMode === "adaptable"
            ? classification.hosts
            : undefined,
        relativePath,
        dependencies: metadata.dependencies,
      },
      evidence: {
        manifestFound: true,
        readmeFound: classification.assetKind === "skill",
        examplesFound: false,
        docsLinked: /https?:\/\//iu.test(content),
        frontmatterFound: Object.keys(metadata.fields).length > 0,
        lineCount: metadata.lineCount,
        dependencies: metadata.dependencies,
        filePath: toPosixPath(filePath),
        rootPath: toPosixPath(rootPath),
      },
      maintenance: {
        lastUpdated: fileStat.mtime.toISOString(),
        stars: 0,
        releaseCadence: "local",
      },
      risk,
      contextCost: classifyContextCost(metadata.lineCount),
      fit: {
        portfolioFit: computePortfolioFit(capabilities, demandProfile),
        hostFit: computeHostFit(
          classification.hosts,
          classification.compatibilityMode,
        ),
      },
      dedupe: {
        duplicateGroup: findDuplicateGroup(capabilities, selectionRegistry),
        candidateRankHint: buildCandidateRankHint(source.authorityTier),
      },
      status: buildAssetStatus(source),
    });
  }

  return entries;
}

async function loadAntigravityManifestEntrySet(
  projectRoot: string,
): Promise<Set<string>> {
  const antigravityManifestPath = resolveEndpointPath(
    "~/.agents/skills/.antigravity-install-manifest.json",
    projectRoot,
  );
  const manifest = await readJsonFileOrNull<LocalManifestShape>(
    antigravityManifestPath,
  );

  return new Set((manifest?.entries ?? []).map((entry) => entry.toLowerCase()));
}

function classifyManifestEntryAssetKind(manifestEntry: string): AssetKind {
  const normalizedEntry = manifestEntry.toLowerCase();

  if (normalizedEntry.includes("mcp")) {
    return "mcp-server";
  }

  if (normalizedEntry.includes("plugin")) {
    return "plugin";
  }

  if (normalizedEntry.includes("agent")) {
    return "agent";
  }

  return "skill";
}

function collectManifestCapabilities(manifestEntry: string): string[] {
  return uniqueStrings(splitIntoKeywords(manifestEntry));
}

function buildGitHubCatalogEntry(
  snapshot: GitHubRepoSnapshot,
  source: SourceDefinition,
  relativePath: string,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
): AssetCatalogEntry | null {
  const classification = classifyGitHubTreePath(relativePath, source);

  if (!classification) {
    return null;
  }

  const capabilities = collectGitHubCapabilities(relativePath, snapshot);
  const hosts =
    classification.assetKind === "mcp-server"
      ? (["shared"] satisfies HostTarget[])
      : classification.hosts;
  const contextCost = { sizeClass: "tiny", estimatedPromptWeight: 1 } as const;
  const risk = buildGitHubRisk(classification.assetKind);
  const githubFileUrl = `${snapshot.repoSummary.htmlUrl}/blob/${snapshot.repoSummary.defaultBranch}/${relativePath}`;

  return {
    id: buildCatalogId(source.id, relativePath),
    displayName: humanizeSlug(lastPathSegment(relativePath)),
    assetKind: classification.assetKind,
    hosts,
    compatibilityMode: classification.compatibilityMode,
    source: {
      sourceId: source.id,
      authorityTier: source.authorityTier,
      sourceKind: source.kind,
      sourcePriority: source.priority,
      originUrl: githubFileUrl,
      publisher: source.publisher?.name ?? source.id,
      publisherVerified: source.publisher?.verified ?? false,
    },
    trust: {
      score: computeTrustScore({
        authorityTier: source.authorityTier,
        sourceKind: source.kind,
        sourcePriority: source.priority,
        publisherVerified: source.publisher?.verified ?? false,
        compatibilityMode: classification.compatibilityMode,
        installMethod: "github-tree-metadata",
      }),
      signals: buildTrustSignals({
        authorityTier: source.authorityTier,
        sourceKind: source.kind,
        sourcePriority: source.priority,
        publisherVerified: source.publisher?.verified ?? false,
        compatibilityMode: classification.compatibilityMode,
        installMethod: "github-tree-metadata",
      }),
    },
    capabilities,
    install: {
      method: "github-tree-metadata",
      nativeHosts:
        classification.compatibilityMode === "native" ? hosts : undefined,
      adaptableHosts:
        classification.compatibilityMode === "adaptable" ? hosts : undefined,
      relativePath,
    },
    evidence: {
      manifestFound: true,
      readmeFound: snapshot.readme !== null,
      examplesFound: false,
      docsLinked: true,
      filePath: relativePath,
      rootPath: snapshot.repoSummary.htmlUrl,
    },
    maintenance: {
      lastUpdated: snapshot.repoSummary.updatedAt ?? snapshot.fetchedAt,
      stars: snapshot.repoSummary.stars,
      releaseCadence: snapshot.repoSummary.archived ? "archived" : "active",
    },
    risk,
    contextCost,
    fit: {
      portfolioFit: computePortfolioFit(capabilities, demandProfile),
      hostFit: computeHostFit(hosts, classification.compatibilityMode),
    },
    dedupe: {
      duplicateGroup: findDuplicateGroup(capabilities, selectionRegistry),
      candidateRankHint: buildCandidateRankHint(source.authorityTier),
    },
    status: buildAssetStatus(source),
  };
}

function classifyGitHubTreePath(
  relativePath: string,
  source: SourceDefinition,
): {
  assetKind: AssetKind;
  compatibilityMode: CompatibilityMode;
  hosts: HostTarget[];
} | null {
  const normalizedPath = relativePath.toLowerCase();
  const nativeHosts = source.hosts.length === 1 ? source.hosts : undefined;
  const adaptableHosts = source.hosts.length > 1 ? source.hosts : source.hosts;

  if (
    normalizedPath.endsWith("/skill.md") ||
    normalizedPath.endsWith("/skill.md")
  ) {
    return {
      assetKind: "skill",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
    };
  }

  if (
    /(^|\/)(agents?|subagents)(\/|$)/u.test(normalizedPath) &&
    normalizedPath.endsWith(".md")
  ) {
    return {
      assetKind: "agent",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
    };
  }

  if (
    normalizedPath.endsWith("copilot-instructions.md") ||
    (/(^|\/)(instructions?)(\/|$)/u.test(normalizedPath) &&
      normalizedPath.endsWith(".md"))
  ) {
    return {
      assetKind: "instruction",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
    };
  }

  if (
    /(^|\/)(workflows?)(\/|$)/u.test(normalizedPath) &&
    /\.(md|ya?ml|json)$/u.test(normalizedPath)
  ) {
    return {
      assetKind: "workflow",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
    };
  }

  if (
    /(^|\/)(hooks?)(\/|$)/u.test(normalizedPath) &&
    /\.(md|sh|js|ts|ya?ml|json)$/u.test(normalizedPath)
  ) {
    return {
      assetKind: "hook",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
    };
  }

  if (
    /(^|\/)(plugins?)(\/|$)/u.test(normalizedPath) &&
    /\.(md|sh|js|ts|json)$/u.test(normalizedPath)
  ) {
    return {
      assetKind: "plugin",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
    };
  }

  if (
    /mcp/u.test(normalizedPath) &&
    /\.(md|json|js|ts|ya?ml)$/u.test(normalizedPath)
  ) {
    return {
      assetKind: "mcp-server",
      compatibilityMode: "native",
      hosts: ["shared"],
    };
  }

  if (isGenericRepositoryArtifact(normalizedPath)) {
    return {
      assetKind: "reference-pack",
      compatibilityMode: "reference-only",
      hosts: source.hosts,
    };
  }

  return null;
}

function isGenericRepositoryArtifact(normalizedPath: string): boolean {
  return (
    /(^|\/)(readme|docs?|notebooks?|data|datasets?|research|papers?|design|media|cad|hardware|firmware|models?|examples?)(\/|\.|$)/u.test(
      normalizedPath,
    ) ||
    /\.(ipynb|csv|parquet|jsonl|bib|tex|stl|step|kicad_pcb|uproject|godot)$/u.test(
      normalizedPath,
    )
  );
}

function collectGitHubCapabilities(
  relativePath: string,
  snapshot: GitHubRepoSnapshot,
): string[] {
  return uniqueStrings([
    ...snapshot.repoSummary.topics,
    ...(snapshot.repoSummary.language ? [snapshot.repoSummary.language] : []),
    ...splitIntoKeywords(snapshot.repoSummary.fullName),
    ...splitIntoKeywords(snapshot.repoSummary.description ?? ""),
    ...splitIntoKeywords(relativePath),
  ]).filter((token) => !GENERIC_CAPABILITY_TOKENS.has(token));
}

function buildGitHubRisk(assetKind: AssetKind): AssetRisk {
  if (assetKind === "plugin" || assetKind === "hook") {
    return {
      level: "medium",
      hasHooks: assetKind === "hook",
      hasExecScripts: true,
      requiresNetwork: false,
    };
  }

  return {
    level: "low",
    hasHooks: false,
    hasExecScripts: false,
    requiresNetwork: false,
  };
}

function classifyLocalDirectoryFile(
  source: SourceDefinition,
  relativePath: string,
): ClassifiedLocalFile | null {
  if (source.id === "local-antigravity-skills") {
    if (!/^.+\/SKILL\.md$/iu.test(relativePath)) {
      return null;
    }

    return {
      assetKind: "skill",
      compatibilityMode: "adaptable",
      hosts: source.hosts,
    };
  }

  if (source.id === "local-opencode-config") {
    if (/^skills\/[^/]+\/SKILL\.md$/iu.test(relativePath)) {
      return {
        assetKind: "skill",
        compatibilityMode: "native",
        hosts: source.hosts,
      };
    }

    if (/^agent\/.+\.md$/iu.test(relativePath)) {
      return {
        assetKind: "agent",
        compatibilityMode: "native",
        hosts: source.hosts,
      };
    }

    if (/^plugin\/.+\.(ts|js|mts|cts)$/iu.test(relativePath)) {
      return {
        assetKind: "plugin",
        compatibilityMode: "native",
        hosts: source.hosts,
      };
    }

    return null;
  }

  if (source.id === "local-opencode-context") {
    if (!relativePath.endsWith(".md")) {
      return null;
    }

    if (/\/workflows\//iu.test(`/${relativePath}`)) {
      return {
        assetKind: "workflow",
        compatibilityMode: "native",
        hosts: source.hosts,
      };
    }

    return {
      assetKind: "reference-pack",
      compatibilityMode: "native",
      hosts: source.hosts,
    };
  }

  return null;
}

function toAntigravityManifestEntry(relativePath: string): string | null {
  if (!relativePath.endsWith("/SKILL.md")) {
    return null;
  }

  return relativePath.replace(/\/SKILL\.md$/u, "").toLowerCase();
}

function extractMarkdownMetadata(content: string): ParsedMarkdownMetadata {
  const { fields, body } = parseFrontmatter(content);
  const heading = extractHeading(body);
  const description =
    getFirstStringField(fields.description) ??
    extractDescriptionFromBody(body, heading);
  const tags = getStringArrayField(fields.tags);
  const dependencies = getStringArrayField(fields.dependencies);
  const lineCount = content.split(/\r?\n/u).length;

  return {
    fields,
    heading,
    description,
    tags,
    dependencies,
    lineCount,
    body,
  };
}

function parseFrontmatter(content: string): {
  fields: Record<string, string | string[]>;
  body: string;
} {
  if (!content.startsWith("---")) {
    return { fields: {}, body: content };
  }

  const lines = content.split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") {
    return { fields: {}, body: content };
  }

  const supportedKeys = new Set([
    "name",
    "description",
    "tags",
    "dependencies",
    "mode",
    "compatibility",
  ]);
  const fields: Record<string, string | string[]> = {};
  let currentArrayKey: string | null = null;
  let bodyStartIndex = 1;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmedLine = line.trim();

    if (trimmedLine === "---") {
      bodyStartIndex = index + 1;
      break;
    }

    if (trimmedLine.length === 0) {
      continue;
    }

    const topLevelMatch =
      line === trimmedLine
        ? /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u.exec(trimmedLine)
        : null;
    if (topLevelMatch) {
      const [, key, rawValue] = topLevelMatch;
      if (!supportedKeys.has(key)) {
        currentArrayKey = null;
        continue;
      }

      if (rawValue.length === 0) {
        fields[key] = [];
        currentArrayKey = key;
        continue;
      }

      fields[key] = parseFrontmatterValue(rawValue);
      currentArrayKey = Array.isArray(fields[key]) ? key : null;
      continue;
    }

    if (currentArrayKey && /^-\s+/u.test(trimmedLine)) {
      const currentValue = fields[currentArrayKey];
      const items = Array.isArray(currentValue) ? currentValue : [];
      items.push(stripWrappingQuotes(trimmedLine.replace(/^-\s+/u, "")));
      fields[currentArrayKey] = items;
      continue;
    }

    currentArrayKey = null;
  }

  return {
    fields,
    body: lines.slice(bodyStartIndex).join("\n"),
  };
}

function parseFrontmatterValue(value: string): string | string[] {
  const trimmedValue = value.trim();

  if (trimmedValue.startsWith("[") && trimmedValue.endsWith("]")) {
    return trimmedValue
      .slice(1, -1)
      .split(",")
      .map((item) => stripWrappingQuotes(item.trim()))
      .filter((item) => item.length > 0);
  }

  return stripWrappingQuotes(trimmedValue);
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/gu, "");
}

function getFirstStringField(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return null;
}

function getStringArrayField(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.filter((item) => item.length > 0);
  }

  if (typeof value === "string" && value.length > 0) {
    return [value];
  }

  return [];
}

function extractHeading(body: string): string | null {
  const lines = body.split(/\r?\n/u);

  for (const line of lines) {
    const match = /^#\s+(.+)$/u.exec(line.trim());
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

function extractDescriptionFromBody(
  body: string,
  heading: string | null,
): string | null {
  const lines = body.split(/\r?\n/u);

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (
      trimmedLine.length === 0 ||
      trimmedLine === heading ||
      trimmedLine.startsWith("#") ||
      trimmedLine.startsWith("<!--") ||
      trimmedLine.startsWith("**")
    ) {
      continue;
    }

    return trimmedLine;
  }

  return null;
}

function collectDirectoryCapabilities(
  relativePath: string,
  metadata: ParsedMarkdownMetadata,
): string[] {
  const pathTokens = splitIntoKeywords(relativePath);
  const headingTokens = metadata.heading
    ? splitIntoKeywords(metadata.heading)
    : [];
  const descriptionTokens = metadata.description
    ? splitIntoKeywords(metadata.description)
    : [];

  return uniqueStrings([
    ...metadata.tags,
    ...pathTokens,
    ...headingTokens,
    ...descriptionTokens,
  ]).filter((token) => !GENERIC_CAPABILITY_TOKENS.has(token));
}

async function determineRisk(
  source: SourceDefinition,
  assetKind: AssetKind,
  filePath: string,
  content: string,
): Promise<AssetRisk> {
  if (assetKind === "plugin") {
    const hasHooks = /\bevent\s*\(/u.test(content);
    const hasExecScripts = /await\s+\$`|\bspawn\(|\bexec\(/u.test(content);
    const requiresNetwork = /fetch\(|https?:\/\//iu.test(content);
    return buildRisk(hasHooks, hasExecScripts, requiresNetwork);
  }

  if (assetKind === "skill") {
    const routerExists = await pathExists(join(dirname(filePath), "router.sh"));
    const scriptsDirectoryExists = await pathExists(
      join(dirname(filePath), "scripts"),
    );
    const hasHooks = /\bhooks?\s*:/iu.test(content);
    const hasExecScripts = routerExists || scriptsDirectoryExists;
    const requiresNetwork = /fetch\(|https?:\/\//iu.test(content);
    return buildRisk(hasHooks, hasExecScripts, requiresNetwork);
  }

  if (assetKind === "agent") {
    const hasHooks = false;
    const hasExecScripts = false;
    const requiresNetwork = false;
    return buildRisk(hasHooks, hasExecScripts, requiresNetwork);
  }

  if (source.id === "local-opencode-context") {
    return buildRisk(false, false, false);
  }

  return buildRisk(false, false, false);
}

function buildRisk(
  hasHooks: boolean,
  hasExecScripts: boolean,
  requiresNetwork: boolean,
): AssetRisk {
  if ((hasHooks && hasExecScripts) || (hasExecScripts && requiresNetwork)) {
    return {
      level: "high",
      hasHooks,
      hasExecScripts,
      requiresNetwork,
    };
  }

  if (hasHooks || hasExecScripts || requiresNetwork) {
    return {
      level: "medium",
      hasHooks,
      hasExecScripts,
      requiresNetwork,
    };
  }

  return {
    level: "low",
    hasHooks,
    hasExecScripts,
    requiresNetwork,
  };
}

function classifyContextCost(lineCount: number): AssetContextCost {
  if (lineCount <= 40) {
    return { sizeClass: "tiny", estimatedPromptWeight: 1 };
  }

  if (lineCount <= 160) {
    return { sizeClass: "small", estimatedPromptWeight: 2 };
  }

  if (lineCount <= 400) {
    return { sizeClass: "medium", estimatedPromptWeight: 4 };
  }

  return { sizeClass: "large", estimatedPromptWeight: 8 };
}

function computePortfolioFit(
  capabilities: string[],
  demandProfile: DemandProfile | null,
): number {
  if (!demandProfile) {
    return 0;
  }

  const demandTerms = new Set<string>(
    [
      ...demandProfile.signals.languages,
      ...demandProfile.signals.packageManagers,
      ...demandProfile.signals.frameworks,
      ...demandProfile.signals.concerns,
      ...demandProfile.signals.tooling,
    ].flatMap((value) => splitIntoKeywords(value)),
  );

  if (demandTerms.size === 0) {
    return 0;
  }

  const capabilityTerms = new Set<string>(
    capabilities.flatMap((value) => splitIntoKeywords(value)),
  );
  let matchCount = 0;

  for (const demandTerm of demandTerms) {
    if (capabilityTerms.has(demandTerm)) {
      matchCount += 1;
    }
  }

  if (matchCount === 0) {
    return 0;
  }

  return Number(Math.min(1, matchCount / 3).toFixed(2));
}

function computeHostFit(
  hosts: HostTarget[],
  compatibilityMode: CompatibilityMode,
): number {
  if (compatibilityMode === "native") {
    return hosts.length > 1 ? 1 : 0.95;
  }

  if (compatibilityMode === "adaptable") {
    return 0.7;
  }

  if (compatibilityMode === "partial") {
    return 0.45;
  }

  if (compatibilityMode === "reference-only") {
    return 0.2;
  }

  return 0;
}

function findDuplicateGroup(
  capabilities: string[],
  selectionRegistry: SelectionRegistry,
): string | undefined {
  const capabilitySet = new Set(
    capabilities.flatMap((capability) => splitIntoKeywords(capability)),
  );

  for (const duplicateGroup of selectionRegistry.duplicateGroups) {
    const duplicateTokens = splitIntoKeywords(duplicateGroup.capability);
    if (duplicateTokens.every((token) => capabilitySet.has(token))) {
      return duplicateGroup.id;
    }
  }

  return undefined;
}

function buildCandidateRankHint(authorityTier: string): string {
  if (
    authorityTier === "official-first-party" ||
    authorityTier === "official-marketplace"
  ) {
    return "preferred-official";
  }

  if (authorityTier === "trusted-local") {
    return "preferred-local";
  }

  if (authorityTier === "trusted-community") {
    return "candidate-community";
  }

  return "candidate-catalog";
}

function mergeRemoteCatalogEntries(
  existingEntries: AssetCatalogEntry[],
  newEntries: AssetCatalogEntry[],
  refreshedSourceIds: Set<string>,
): AssetCatalogEntry[] {
  const retainedEntries = existingEntries.filter(
    (entry) => !refreshedSourceIds.has(entry.source.sourceId),
  );
  const byId = new Map<string, AssetCatalogEntry>(
    retainedEntries.map((entry) => [entry.id, entry]),
  );

  for (const entry of newEntries) {
    byId.set(entry.id, entry);
  }

  return [...byId.values()].sort(compareAssetCatalogEntries);
}

function buildAssetStatus(source: SourceDefinition): AssetStatus {
  return {
    cataloged: true,
    mirrorEligible: source.rules.allowMirror,
    installEligible: false,
    activationEligible: false,
  };
}

function groupCatalogEntriesForSelection(
  catalogEntries: AssetCatalogEntry[],
): Map<string, AssetCatalogEntry[]> {
  const groupedEntries = new Map<string, AssetCatalogEntry[]>();

  for (const entry of catalogEntries) {
    const groupKey = entry.dedupe.duplicateGroup ?? entry.id;
    const existingEntries = groupedEntries.get(groupKey) ?? [];
    existingEntries.push(entry);
    groupedEntries.set(groupKey, existingEntries);
  }

  return groupedEntries;
}

function compareSelectionCandidates(
  left: AssetCatalogEntry,
  right: AssetCatalogEntry,
  selectionRegistry: SelectionRegistry,
): number {
  const canonicalSourceDifference = compareNumberDescending(
    getCanonicalSourceRank(left.install.method),
    getCanonicalSourceRank(right.install.method),
  );
  if (canonicalSourceDifference !== 0) {
    return canonicalSourceDifference;
  }

  const authorityDifference = compareNumberDescending(
    getAuthorityRank(left.source.authorityTier),
    getAuthorityRank(right.source.authorityTier),
  );
  if (authorityDifference !== 0) {
    return authorityDifference;
  }

  const compatibilityDifference = compareNumberDescending(
    getCompatibilityRank(left.compatibilityMode),
    getCompatibilityRank(right.compatibilityMode),
  );
  if (compatibilityDifference !== 0) {
    return compatibilityDifference;
  }

  const portfolioFitDifference = compareNumberDescending(
    left.fit.portfolioFit,
    right.fit.portfolioFit,
  );
  if (portfolioFitDifference !== 0) {
    return portfolioFitDifference;
  }

  const riskDifference = compareNumberAscending(
    getRiskRank(left.risk.level),
    getRiskRank(right.risk.level),
  );
  if (riskDifference !== 0) {
    return riskDifference;
  }

  const contextCostDifference = compareNumberAscending(
    getContextSizeRank(left.contextCost.sizeClass),
    getContextSizeRank(right.contextCost.sizeClass),
  );
  if (contextCostDifference !== 0) {
    return contextCostDifference;
  }

  const maintenanceDifference = compareStringDescending(
    left.maintenance.lastUpdated,
    right.maintenance.lastUpdated,
  );
  if (maintenanceDifference !== 0) {
    return maintenanceDifference;
  }

  if (selectionRegistry.selectionPolicies.starsAreTieBreakerOnly) {
    const starsDifference = compareNumberDescending(
      left.maintenance.stars,
      right.maintenance.stars,
    );
    if (starsDifference !== 0) {
      return starsDifference;
    }
  }

  return left.id.localeCompare(right.id);
}

function buildSelectionReason(
  selectedEntry: AssetCatalogEntry,
  selectionRegistry: SelectionRegistry,
): string {
  const duplicateGroupId = selectedEntry.dedupe.duplicateGroup;

  if (duplicateGroupId) {
    const configuredDuplicateGroup = selectionRegistry.duplicateGroups.find(
      (duplicateGroup) => duplicateGroup.id === duplicateGroupId,
    );
    if (configuredDuplicateGroup) {
      return configuredDuplicateGroup.selectionReason;
    }
  }

  if (selectedEntry.source.authorityTier.startsWith("official")) {
    return "Selected because official sources outrank lower-authority alternatives regardless of popularity.";
  }

  if (selectedEntry.source.authorityTier === "trusted-local") {
    return "Selected because the local curated source outranked lower-trust alternatives after official-preference checks.";
  }

  return "Selected by compatibility, portfolio fit, risk, and context-cost ordering.";
}

function getAuthorityRank(authorityTier: string): number {
  const authorityRanks: Record<string, number> = {
    "official-first-party": 6,
    "official-marketplace": 5,
    "official-compatible": 4,
    "trusted-local": 3,
    "trusted-community": 2,
    "unverified-community": 1,
  };

  return authorityRanks[authorityTier] ?? 0;
}

function getCompatibilityRank(compatibilityMode: CompatibilityMode): number {
  const compatibilityRanks: Record<CompatibilityMode, number> = {
    native: 5,
    adaptable: 4,
    partial: 3,
    "reference-only": 2,
    incompatible: 1,
  };

  return compatibilityRanks[compatibilityMode];
}

function getRiskRank(riskLevel: AssetRisk["level"]): number {
  const riskRanks: Record<AssetRisk["level"], number> = {
    low: 1,
    medium: 2,
    high: 3,
  };

  return riskRanks[riskLevel];
}

function getContextSizeRank(sizeClass: AssetContextCost["sizeClass"]): number {
  const sizeRanks: Record<AssetContextCost["sizeClass"], number> = {
    tiny: 1,
    small: 2,
    medium: 3,
    large: 4,
  };

  return sizeRanks[sizeClass];
}

function computeTrustScore(input: {
  authorityTier: string;
  sourceKind: string;
  sourcePriority: number;
  publisherVerified: boolean;
  compatibilityMode: CompatibilityMode;
  installMethod: string;
}): number {
  const baseAuthorityScore = getAuthorityRank(input.authorityTier) * 10;
  const sourcePriorityScore = Math.min(
    20,
    Math.round(input.sourcePriority / 5),
  );
  const verificationScore = input.publisherVerified ? 10 : 0;
  const compatibilityScore = getCompatibilityRank(input.compatibilityMode) * 4;
  const installMethodScore =
    input.installMethod === "local-file"
      ? 10
      : input.installMethod === "github-tree-metadata"
        ? 8
        : input.installMethod === "official-index-entry"
          ? 6
          : 4;

  return (
    baseAuthorityScore +
    sourcePriorityScore +
    verificationScore +
    compatibilityScore +
    installMethodScore
  );
}

function buildTrustSignals(input: {
  authorityTier: string;
  sourceKind: string;
  sourcePriority: number;
  publisherVerified: boolean;
  compatibilityMode: CompatibilityMode;
  installMethod: string;
}): string[] {
  const signals = [
    `authority:${input.authorityTier}`,
    `source-kind:${input.sourceKind}`,
    `source-priority:${input.sourcePriority}`,
    `compatibility:${input.compatibilityMode}`,
    `install-method:${input.installMethod}`,
  ];

  if (input.publisherVerified) {
    signals.push("publisher-verified");
  }

  return signals;
}

function enhanceTrustForEntry(entry: AssetCatalogEntry): AssetCatalogEntry {
  let adjustedTrustScore = entry.trust.score;
  const adjustedTrustSignals = [...entry.trust.signals];

  if (entry.maintenance.stars >= 1000) {
    adjustedTrustScore += 10;
    adjustedTrustSignals.push("stars:1000+");
  } else if (entry.maintenance.stars >= 100) {
    adjustedTrustScore += 8;
    adjustedTrustSignals.push("stars:100+");
  } else if (entry.maintenance.stars >= 10) {
    adjustedTrustScore += 4;
    adjustedTrustSignals.push("stars:10+");
  }

  if (entry.maintenance.releaseCadence === "active") {
    adjustedTrustScore += 5;
    adjustedTrustSignals.push("maintenance:active");
  }

  if (entry.maintenance.releaseCadence === "archived") {
    adjustedTrustScore -= 12;
    adjustedTrustSignals.push("maintenance:archived");
  }

  if (entry.evidence.readmeFound) {
    adjustedTrustScore += 4;
    adjustedTrustSignals.push("readme-present");
  }

  if (entry.evidence.docsLinked) {
    adjustedTrustScore += 4;
    adjustedTrustSignals.push("docs-linked");
  }

  if (entry.evidence.frontmatterFound) {
    adjustedTrustScore += 2;
    adjustedTrustSignals.push("frontmatter-present");
  }

  if ((entry.evidence.dependencies?.length ?? 0) > 0) {
    adjustedTrustScore += 2;
    adjustedTrustSignals.push("dependencies-declared");
  }

  if (entry.risk.level === "medium") {
    adjustedTrustScore -= 5;
    adjustedTrustSignals.push("risk:medium");
  }

  if (entry.risk.level === "high") {
    adjustedTrustScore -= 15;
    adjustedTrustSignals.push("risk:high");
  }

  if (
    entry.source.authorityTier === "trusted-community" &&
    entry.maintenance.stars === 0 &&
    !entry.evidence.readmeFound
  ) {
    adjustedTrustScore -= 8;
    adjustedTrustSignals.push("community:low-evidence");
  }

  return {
    ...entry,
    trust: {
      score: adjustedTrustScore,
      signals: adjustedTrustSignals,
    },
  };
}

function getCanonicalSourceRank(installMethod: string): number {
  const canonicalSourceRanks: Record<string, number> = {
    "local-file": 4,
    "github-tree-metadata": 3,
    "manifest-entry": 2,
  };

  return canonicalSourceRanks[installMethod] ?? 1;
}

function compareNumberDescending(left: number, right: number): number {
  return right - left;
}

function compareNumberAscending(left: number, right: number): number {
  return left - right;
}

function compareStringDescending(left: string, right: string): number {
  return right.localeCompare(left);
}

function resolveEndpointPath(
  endpointValue: string | undefined,
  projectRoot: string,
): string {
  if (!endpointValue) {
    return projectRoot;
  }

  return resolvePortablePath(endpointValue, projectRoot);
}

function buildCatalogId(sourceId: string, assetPath: string): string {
  return `${sourceId}:${encodeCatalogPath(assetPath)}`;
}

function compareAssetCatalogEntries(
  left: AssetCatalogEntry,
  right: AssetCatalogEntry,
): number {
  return left.id.localeCompare(right.id);
}

function encodeCatalogPath(assetPath: string): string {
  return assetPath
    .replace(/\\/gu, "/")
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase().replace(/[^a-z0-9-]+/gu, "-"))
    .join("__");
}

function splitIntoKeywords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/\.md$/u, "")
    .replace(/\.(ts|js|mts|cts)$/u, "")
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 1);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function lastPathSegment(value: string): string {
  const normalizedValue = value.replace(/\/+/gu, "/");
  const segments = normalizedValue
    .split("/")
    .filter((segment) => segment.length > 0);
  const lastSegment = segments[segments.length - 1] ?? value;
  return lastSegment.replace(/\.(md|ts|js|mts|cts)$/u, "");
}

function humanizeSlug(value: string): string {
  return value
    .split(/[-_/]+/u)
    .filter((segment) => segment.length > 0)
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

const GENERIC_CAPABILITY_TOKENS = new Set([
  "agent",
  "agents",
  "context",
  "core",
  "files",
  "md",
  "opencode",
  "plugin",
  "plugins",
  "skill",
  "skills",
  "subagents",
]);

function shouldInspectFile(fileName: string, filePath: string): boolean {
  if (
    fileName.endsWith(".csproj") ||
    fileName.endsWith(".tf") ||
    fileName.endsWith(".tfvars")
  ) {
    return true;
  }

  if (
    fileName.startsWith("playwright.config.") ||
    fileName.startsWith("vitest.config.") ||
    fileName.startsWith("jest.config.")
  ) {
    return true;
  }

  if (/openapi|swagger/iu.test(fileName)) {
    return true;
  }

  const inspectableNames = new Set([
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "tsconfig.json",
    "pyproject.toml",
    "requirements.txt",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "Gemfile",
    "composer.json",
    "Package.swift",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "deno.json",
  ]);

  if (inspectableNames.has(fileName)) {
    return true;
  }

  return (
    /docker-compose\./iu.test(filePath) ||
    isDetectorInspectableFile(fileName, filePath)
  );
}

function isActorJsonFile(fileName: string, filePath: string): boolean {
  return (
    /^actor\.json$/iu.test(fileName) ||
    APIFY_ACTOR_JSON_PATH_PATTERN.test(filePath)
  );
}

function collectStaticSignals(
  fileName: string,
  filePath: string,
): DemandSignalSet {
  const matchedSignals = createEmptySignalSet();

  if (fileName === "package.json") {
    addSignals(matchedSignals.languages, ["javascript"]);
    addSignals(matchedSignals.packageManagers, ["npm"]);
  }

  if (fileName === "package-lock.json") {
    addSignals(matchedSignals.packageManagers, ["npm"]);
  }

  if (fileName === "pnpm-lock.yaml") {
    addSignals(matchedSignals.packageManagers, ["pnpm"]);
  }

  if (fileName === "yarn.lock") {
    addSignals(matchedSignals.packageManagers, ["yarn"]);
  }

  if (fileName === "tsconfig.json") {
    addSignals(matchedSignals.languages, ["typescript"]);
    addSignals(matchedSignals.tooling, ["typescript"]);
  }

  if (fileName === "pyproject.toml" || fileName === "requirements.txt") {
    addSignals(matchedSignals.languages, ["python"]);
    addSignals(matchedSignals.packageManagers, ["pip"]);
  }

  if (fileName === "Cargo.toml") {
    addSignals(matchedSignals.languages, ["rust"]);
    addSignals(matchedSignals.packageManagers, ["cargo"]);
  }

  if (fileName === "go.mod") {
    addSignals(matchedSignals.languages, ["go"]);
    addSignals(matchedSignals.packageManagers, ["go-modules"]);
  }

  if (
    fileName === "pom.xml" ||
    fileName === "build.gradle" ||
    fileName === "build.gradle.kts"
  ) {
    addSignals(matchedSignals.languages, ["java"]);
    addSignals(matchedSignals.packageManagers, ["maven-gradle"]);
  }

  if (fileName.endsWith(".csproj")) {
    addSignals(matchedSignals.languages, ["csharp"]);
    addSignals(matchedSignals.packageManagers, ["nuget"]);
  }

  if (fileName === "Gemfile") {
    addSignals(matchedSignals.languages, ["ruby"]);
    addSignals(matchedSignals.packageManagers, ["bundler"]);
  }

  if (fileName === "composer.json") {
    addSignals(matchedSignals.languages, ["php"]);
    addSignals(matchedSignals.packageManagers, ["composer"]);
  }

  if (fileName === "Package.swift") {
    addSignals(matchedSignals.languages, ["swift"]);
    addSignals(matchedSignals.packageManagers, ["swiftpm"]);
  }

  if (fileName === "deno.json") {
    addSignals(matchedSignals.languages, ["typescript"]);
    addSignals(matchedSignals.tooling, ["deno"]);
  }

  if (
    fileName === "Dockerfile" ||
    fileName === "docker-compose.yml" ||
    fileName === "docker-compose.yaml" ||
    fileName.startsWith("docker-compose.")
  ) {
    addSignals(matchedSignals.concerns, ["containerization", "infrastructure"]);
    addSignals(matchedSignals.tooling, ["docker"]);
  }

  if (fileName.endsWith(".tf") || fileName.endsWith(".tfvars")) {
    addSignals(matchedSignals.concerns, ["terraform", "infrastructure"]);
    addSignals(matchedSignals.tooling, ["terraform"]);
  }

  if (fileName.startsWith("playwright.config.")) {
    addSignals(matchedSignals.concerns, ["e2e-testing", "testing"]);
    addSignals(matchedSignals.tooling, ["playwright"]);
  }

  if (
    fileName.startsWith("vitest.config.") ||
    fileName.startsWith("jest.config.")
  ) {
    addSignals(matchedSignals.concerns, ["testing"]);
    addSignals(matchedSignals.tooling, [
      fileName.startsWith("vitest") ? "vitest" : "jest",
    ]);
  }

  if (/openapi|swagger/iu.test(fileName)) {
    addSignals(matchedSignals.concerns, ["api-design", "openapi"]);
    addSignals(matchedSignals.tooling, ["openapi"]);
  }

  if (
    /\.actor[/]/iu.test(filePath) ||
    /^actor\.json$/iu.test(fileName) ||
    /input_schema\.json$/iu.test(fileName)
  ) {
    addSignals(matchedSignals.frameworks, ["apify"]);
    addSignals(matchedSignals.concerns, [
      "actor-development",
      "automation",
      "web-scraping",
    ]);
    addSignals(matchedSignals.tooling, ["actor"]);
  }

  return matchedSignals;
}

async function enrichPackageJsonSignals(
  filePath: string,
  matchedSignals: DemandSignalSet,
): Promise<void> {
  const packageJson = await readJsonFileOrNull<PackageJsonShape>(filePath);

  if (!packageJson) {
    return;
  }

  const dependencyNames = new Set<string>([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);
  const packageTextSignals = [
    packageJson.name ?? "",
    packageJson.description ?? "",
    ...(packageJson.keywords ?? []),
    typeof packageJson.author === "string"
      ? packageJson.author
      : (packageJson.author?.name ?? ""),
  ]
    .join(" ")
    .toLowerCase();
  const hasExpress = hasDependency(dependencyNames, ["express"]);
  const hasFastify = hasDependency(dependencyNames, ["fastify"]);
  const hasNestJs = hasDependency(dependencyNames, ["@nestjs/core"]);
  const hasDuckDb = hasDependency(dependencyNames, [
    "@duckdb/node-api",
    "duckdb",
  ]);

  if (hasDependency(dependencyNames, ["typescript"])) {
    addSignals(matchedSignals.languages, ["typescript"]);
    addSignals(matchedSignals.tooling, ["typescript"]);
  }

  if (packageJson.engines?.node) {
    addSignals(matchedSignals.tooling, ["node"]);
  }

  if (hasDependency(dependencyNames, ["react"])) {
    addSignals(matchedSignals.frameworks, ["react"]);
    addSignals(matchedSignals.concerns, ["frontend"]);
  }

  if (hasDependency(dependencyNames, ["next"])) {
    addSignals(matchedSignals.frameworks, ["nextjs"]);
    addSignals(matchedSignals.concerns, ["frontend", "fullstack"]);
  }

  if (hasDependency(dependencyNames, ["astro", "@astrojs/"])) {
    addSignals(matchedSignals.frameworks, ["astro"]);
    addSignals(matchedSignals.concerns, ["frontend"]);
  }

  if (hasDependency(dependencyNames, ["svelte", "@sveltejs/"])) {
    addSignals(matchedSignals.frameworks, ["svelte"]);
    addSignals(matchedSignals.concerns, ["frontend"]);
  }

  if (hasDependency(dependencyNames, ["hono"])) {
    addSignals(matchedSignals.frameworks, ["hono"]);
    addSignals(matchedSignals.concerns, ["backend", "api-design"]);
  }

  if (hasExpress || hasFastify || hasNestJs) {
    addSignals(matchedSignals.frameworks, ["node-backend"]);
    addSignals(matchedSignals.concerns, ["backend"]);
    addSignals(matchedSignals.tooling, ["node"]);
  }

  if (hasExpress) {
    addSignals(matchedSignals.frameworks, ["express"]);
  }

  if (hasFastify) {
    addSignals(matchedSignals.frameworks, ["fastify"]);
  }

  if (hasNestJs) {
    addSignals(matchedSignals.frameworks, ["nestjs"]);
  }

  if (hasDependency(dependencyNames, ["@playwright/test", "playwright"])) {
    addSignals(matchedSignals.concerns, ["e2e-testing", "testing"]);
    addSignals(matchedSignals.tooling, ["playwright"]);
  }

  if (hasDependency(dependencyNames, ["vitest", "jest"])) {
    addSignals(matchedSignals.concerns, ["testing"]);
  }

  if (
    hasDependency(dependencyNames, [
      "@modelcontextprotocol",
      "modelcontextprotocol",
    ])
  ) {
    addSignals(matchedSignals.concerns, ["mcp"]);
    addSignals(matchedSignals.tooling, ["mcp"]);
  }

  if (hasDependency(dependencyNames, ["@supabase/", "supabase"])) {
    addSignals(matchedSignals.frameworks, ["supabase"]);
    addSignals(matchedSignals.concerns, ["backend", "database"]);
  }

  if (hasDuckDb || containsAnyText(packageTextSignals, ["duckdb"])) {
    addSignals(matchedSignals.concerns, ["database", "analytics"]);
    addSignals(matchedSignals.tooling, ["duckdb"]);
  }

  if (
    hasDependency(dependencyNames, ["apify", "@apify/"]) ||
    containsAnyText(packageTextSignals, [
      "apify",
      "actor",
      "webhook-debugger-logger",
    ])
  ) {
    addSignals(matchedSignals.frameworks, ["apify"]);
    addSignals(matchedSignals.concerns, [
      "automation",
      "actor-development",
      "web-scraping",
    ]);
    addSignals(matchedSignals.tooling, ["actor", "crawler"]);
  }

  if (containsAnyText(packageTextSignals, WEBHOOK_TEXT_MARKERS)) {
    addSignals(matchedSignals.concerns, ["webhook", "integration"]);
    addSignals(matchedSignals.tooling, ["webhook"]);
  }

  if (containsAnyText(packageTextSignals, REPLAY_TEXT_MARKERS)) {
    addSignals(matchedSignals.concerns, ["replay"]);
  }

  if (containsAnyText(packageTextSignals, MOCKING_TEXT_MARKERS)) {
    addSignals(matchedSignals.concerns, ["mocking"]);
  }

  if (containsAnyText(packageTextSignals, LOGGING_TEXT_MARKERS)) {
    addSignals(matchedSignals.concerns, ["logging", "debugging"]);
  }

  if (hasDependency(dependencyNames, ["drizzle-orm", "prisma"])) {
    addSignals(matchedSignals.concerns, ["database"]);
    addSignals(matchedSignals.tooling, ["orm"]);
  }

  addPackageDependencySignals(matchedSignals, "npm", [...dependencyNames]);

  if (hasDependency(dependencyNames, ["openai", "anthropic", "genkit"])) {
    addSignals(matchedSignals.concerns, ["ai"]);
    addSignals(matchedSignals.tooling, ["ai-sdk"]);
  }
}

async function enrichRequirementsSignals(
  filePath: string,
  matchedSignals: DemandSignalSet,
): Promise<void> {
  const content = await readTextFileOrNull(filePath);
  if (!content) {
    return;
  }

  const dependencyNames = content
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+#.*$/u, "").trim())
    .filter(isPlainRequirementLine)
    .filter((line) => !isPythonDirectReference(line))
    .map((line) => line.split(/\s+@\s+|[<>=~!;[]/u)[0]?.trim())
    .filter(isPlainPackageName);

  addPackageDependencySignals(matchedSignals, "pypi", dependencyNames);
  enrichPythonDependencySignals(matchedSignals, dependencyNames);
}

async function enrichPyProjectSignals(
  filePath: string,
  matchedSignals: DemandSignalSet,
): Promise<void> {
  const content = await readTextFileOrNull(filePath);
  if (!content) {
    return;
  }

  const dependencyNames = extractPyProjectDependencyNames(content);

  addPackageDependencySignals(matchedSignals, "pypi", dependencyNames);
  enrichPythonDependencySignals(matchedSignals, dependencyNames);
}

function extractPyProjectDependencyNames(content: string): string[] {
  const dependencyNames: string[] = [];
  let currentSection = "";
  let inDependencyList = false;

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+#.*$/u, "").trim();
    const sectionMatch = line.match(/^\[([^\]]+)\]$/u);
    if (sectionMatch) {
      currentSection = sectionMatch[1]?.trim() ?? "";
      inDependencyList = false;
      continue;
    }

    if (isPyProjectDependencyListStart(line, currentSection)) {
      inDependencyList = true;
    }

    if (!inDependencyList) {
      const poetryDependencyName = extractPoetryDependencyName(
        line,
        currentSection,
      );
      if (poetryDependencyName) {
        dependencyNames.push(poetryDependencyName);
      }
      continue;
    }

    for (const dependencyMatch of line.matchAll(/["']([^"']+)["']/gu)) {
      const dependencySpecifier = dependencyMatch[1]?.trim();
      if (isPythonDirectReference(dependencySpecifier)) {
        continue;
      }

      const packageName = dependencySpecifier
        ?.split(/\s+@\s+|[<>=~!;[]/u)[0]
        ?.trim();
      if (isPlainPackageName(packageName)) {
        dependencyNames.push(packageName);
      }
    }

    const unquotedLine = line.replaceAll(/["'][^"']*["']/gu, "");
    if (unquotedLine.includes("]")) {
      inDependencyList = false;
    }
  }

  return uniqueStrings(dependencyNames);
}

/**
 * Extracts one package name from Poetry dependency table entries.
 */
function extractPoetryDependencyName(
  line: string,
  currentSection: string,
): string | null {
  if (!isPoetryDependencySection(currentSection)) {
    return null;
  }

  const dependencyMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/u);
  const dependencyName = dependencyMatch?.[1];
  const dependencySpec = dependencyMatch?.[2]?.trim();
  if (
    !dependencyName ||
    dependencyName.toLowerCase() === "python" ||
    isPythonDirectReference(dependencySpec)
  ) {
    return null;
  }

  return isPlainPackageName(dependencyName) ? dependencyName : null;
}

/**
 * Identifies Poetry sections that contain runtime or grouped dependencies.
 */
function isPoetryDependencySection(currentSection: string): boolean {
  return (
    currentSection === "tool.poetry.dependencies" ||
    currentSection === "tool.poetry.dev-dependencies" ||
    /^tool\.poetry\.group\.[^.]+\.dependencies$/u.test(currentSection)
  );
}

/**
 * Identifies PEP 621 dependency arrays that should emit PyPI evidence.
 */
function isPyProjectDependencyListStart(
  line: string,
  currentSection: string,
): boolean {
  if (currentSection === "project") {
    return /^dependencies\s*=\s*\[/u.test(line);
  }

  if (currentSection === "project.optional-dependencies") {
    return /^[A-Za-z0-9_.-]+\s*=\s*\[/u.test(line);
  }

  return false;
}

function isPlainRequirementLine(line: string): boolean {
  return (
    line.length > 0 &&
    !line.startsWith("#") &&
    !line.startsWith("-") &&
    !line.includes("://") &&
    !/^(git\+|https?:|file:|ssh\+|\.\/|\.\.\/|\/)/iu.test(line)
  );
}

function isPythonDirectReference(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return /\s+@\s+(?:[\\/]|\.\.?[\\/]|[a-z]:[\\/]|file:|path:|git\+|hg\+|ssh:\/\/|git:\/\/|https?:\/\/)/iu.test(
    value,
  );
}

function isPlainPackageName(value: string | undefined): value is string {
  return Boolean(value && /^[a-z0-9_.-]+$/iu.test(value));
}

function enrichPythonDependencySignals(
  matchedSignals: DemandSignalSet,
  dependencyNames: string[],
): void {
  const normalizedNames = new Set(
    dependencyNames.map((name) => name.toLowerCase()),
  );

  if (
    hasAnyDependency(normalizedNames, [
      "fastapi",
      "django",
      "flask",
      "litestar",
    ])
  ) {
    addSignals(matchedSignals.concerns, ["backend", "api-design"]);
    addSignals(matchedSignals.frameworks, ["python-backend"]);
  }

  if (
    hasAnyDependency(normalizedNames, ["pandas", "polars", "duckdb", "numpy"])
  ) {
    addSignals(matchedSignals.concerns, ["data", "analytics"]);
  }

  if (
    hasAnyDependency(normalizedNames, [
      "torch",
      "tensorflow",
      "scikit-learn",
      "transformers",
    ])
  ) {
    addSignals(matchedSignals.concerns, ["machine-learning", "ai"]);
  }
}

function addPackageDependencySignals(
  matchedSignals: DemandSignalSet,
  registryKind: "npm" | "pypi",
  dependencyNames: string[],
): void {
  const ignoredPrefixes = registryKind === "npm" ? ["@types/"] : [];
  const normalizedNames = dependencyNames
    .map((dependencyName) => dependencyName.trim())
    .filter((dependencyName) => dependencyName.length > 0)
    .filter(
      (dependencyName) =>
        !ignoredPrefixes.some((prefix) => dependencyName.startsWith(prefix)),
    )
    .slice(0, 50)
    .map((dependencyName) => `${registryKind}:${dependencyName}`);

  addSignals(matchedSignals.tooling, normalizedNames);
}

function hasAnyDependency(
  dependencyNames: Set<string>,
  candidates: string[],
): boolean {
  return candidates.some((candidate) => dependencyNames.has(candidate));
}

async function enrichActorJsonSignals(
  filePath: string,
  matchedSignals: DemandSignalSet,
): Promise<void> {
  const actorJson = await readJsonFileOrNull<ActorJsonShape>(filePath);

  if (!actorJson) {
    return;
  }

  const actorTextSignals = [
    actorJson.title ?? "",
    actorJson.description ?? "",
    ...(actorJson.categories ?? []).map((value) => value.replaceAll("_", " ")),
  ]
    .join(" ")
    .toLowerCase();

  if (actorJson.dockerfile) {
    addSignals(matchedSignals.concerns, ["containerization"]);
    addSignals(matchedSignals.tooling, ["docker"]);
  }

  if (actorJson.webServerSchema) {
    addSignals(matchedSignals.concerns, ["backend"]);
  }

  if (containsAnyText(actorTextSignals, WEBHOOK_TEXT_MARKERS)) {
    addSignals(matchedSignals.concerns, ["webhook", "integration"]);
    addSignals(matchedSignals.tooling, ["webhook"]);
  }

  if (containsAnyText(actorTextSignals, REPLAY_TEXT_MARKERS)) {
    addSignals(matchedSignals.concerns, ["replay"]);
  }

  if (containsAnyText(actorTextSignals, MOCKING_TEXT_MARKERS)) {
    addSignals(matchedSignals.concerns, ["mocking"]);
  }

  if (containsAnyText(actorTextSignals, LOGGING_TEXT_MARKERS)) {
    addSignals(matchedSignals.concerns, ["logging", "debugging"]);
  }

  if (containsAnyText(actorTextSignals, ["integration"])) {
    addSignals(matchedSignals.concerns, ["integration"]);
  }
}

function hasDependency(
  dependencyNames: Set<string>,
  prefixes: string[],
): boolean {
  for (const dependencyName of dependencyNames) {
    for (const prefix of prefixes) {
      if (dependencyName === prefix || dependencyName.startsWith(prefix)) {
        return true;
      }
    }
  }

  return false;
}

function containsAnyText(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function addSignals(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function mergeSignals(target: DemandSignalSet, source: DemandSignalSet): void {
  addSignals(target.languages, source.languages);
  addSignals(target.packageManagers, source.packageManagers);
  addSignals(target.frameworks, source.frameworks);
  addSignals(target.concerns, source.concerns);
  addSignals(target.tooling, source.tooling);
}

function sortSignalSet(signalSet: DemandSignalSet): DemandSignalSet {
  return {
    languages: [...signalSet.languages].sort(),
    packageManagers: [...signalSet.packageManagers].sort(),
    frameworks: [...signalSet.frameworks].sort(),
    concerns: [...signalSet.concerns].sort(),
    tooling: [...signalSet.tooling].sort(),
  };
}

function createEmptySignalSet(): DemandSignalSet {
  return {
    languages: [],
    packageManagers: [],
    frameworks: [],
    concerns: [],
    tooling: [],
  };
}

function hasAnySignals(signalSet: DemandSignalSet): boolean {
  return [
    signalSet.languages,
    signalSet.packageManagers,
    signalSet.frameworks,
    signalSet.concerns,
    signalSet.tooling,
  ].some((values) => values.length > 0);
}

function compareSourcesByPriority(
  left: SourceDefinition,
  right: SourceDefinition,
): number {
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }

  return left.id.localeCompare(right.id);
}

function countBy<T>(
  items: T[],
  getKey: (item: T) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

function countHosts(sources: SourceDefinition[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const source of sources) {
    for (const host of source.hosts) {
      counts[host] = (counts[host] ?? 0) + 1;
    }
  }

  return counts;
}

function countHostsForCatalog(
  entries: AssetCatalogEntry[],
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const entry of entries) {
    for (const host of entry.hosts) {
      counts[host] = (counts[host] ?? 0) + 1;
    }
  }

  return counts;
}
