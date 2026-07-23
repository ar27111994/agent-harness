import { join, relative } from "node:path";

import {
  listFilesRecursive,
  pathExists,
  readJsonFile,
  readJsonFileOrNull,
  toPosixPath,
  writeJsonFile,
} from "../../files.js";
import { assertSelectionRegistry } from "../../manifest-validation.js";
import type {
  SelectionRegistry,
  SourceDefinition,
  SourceIndex,
} from "../../types.js";
import { countBy } from "./catalog-utils.js";
import { SOURCE_INDEX_OUTPUT_PATH } from "./output-paths.js";
import { loadSourceRegistry } from "./source-registry.js";
import { loadSourceSyncState } from "./source-sync.js";

interface OfficialSkillIndexConfig {
  indexes?: Array<{ id?: string }>;
}

interface OfficialUpstreamsConfig {
  owners?: Record<string, string[]>;
}

/**
 * Generates source index artifacts for the lifecycle pipeline.
 */
export async function generateSourceIndex(
  projectRoot: string,
): Promise<SourceIndex> {
  const sourceRegistry = await loadSourceRegistry(projectRoot);
  const selectionRegistry = await readJsonFile<SelectionRegistry>(
    join(projectRoot, "discover", "selections.json"),
    assertSelectionRegistry,
  );
  const enabledSources = sourceRegistry.sources
    .filter((source) => source.enabled)
    .sort(compareSourcesByPriority);
  const sourceSyncState = await loadSourceSyncState(projectRoot);
  const sourceSyncById = new Map(
    sourceSyncState.sources.map((source) => [source.sourceId, source]),
  );

  const sourceIndex: SourceIndex = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceCount: enabledSources.length,
    byAuthorityTier: countBy(enabledSources, (source) => source.authorityTier),
    byKind: countBy(enabledSources, (source) => source.kind),
    hostCoverage: countHosts(enabledSources),
    communityDefaultPolicy:
      selectionRegistry.selectionPolicies.communityDefaultPolicy,
    configurationInputs: await buildDiscoveryConfigurationInputs(projectRoot),
    enabledSources: enabledSources.map((source) => {
      const syncState = sourceSyncById.get(source.id);

      return {
        id: source.id,
        kind: source.kind,
        authorityTier: source.authorityTier,
        priority: source.priority,
        hosts: source.hosts,
        coverageMode:
          syncState?.coverageMode ??
          defaultCoverageModeForSourceKind(source.kind),
        syncStatus:
          syncState?.status ?? defaultSyncStatusForSourceKind(source.kind),
        indexedEntryCount: syncState?.indexedEntryCount,
        lastSyncedAt: syncState?.lastSyncedAt,
        syncReason: syncState?.reason,
      };
    }),
  };

  const outputPath = join(projectRoot, ...SOURCE_INDEX_OUTPUT_PATH);
  await writeJsonFile(outputPath, sourceIndex);

  console.log(`Source index written to ${toPosixPath(outputPath)}`);
  return sourceIndex;
}

async function buildDiscoveryConfigurationInputs(
  projectRoot: string,
): Promise<SourceIndex["configurationInputs"]> {
  const sourcePackDirectory = join(projectRoot, "discover", "source-packs");
  const sourcePackFiles = (await pathExists(sourcePackDirectory))
    ? (await listFilesRecursive(sourcePackDirectory))
        .filter((filePath) => filePath.endsWith(".json"))
        .map((filePath) => toPosixPath(relative(projectRoot, filePath)))
        .sort((left, right) => left.localeCompare(right))
    : [];
  const officialSkillIndexes =
    (
      await readJsonFileOrNull<OfficialSkillIndexConfig>(
        join(projectRoot, "discover", "official-skills-indexes.json"),
      )
    )?.indexes ?? [];
  const officialUpstreams =
    (
      await readJsonFileOrNull<OfficialUpstreamsConfig>(
        join(projectRoot, "discover", "official-upstreams.json"),
      )
    )?.owners ?? {};

  return {
    checkedInRegistryPath: "discover/sources.json",
    sourcePackFiles,
    officialSkillIndexIds: officialSkillIndexes
      .flatMap((entry) => (typeof entry?.id === "string" ? [entry.id] : []))
      .sort((left, right) => left.localeCompare(right)),
    officialUpstreamNamespaces: Object.keys(officialUpstreams).sort(
      (left, right) => left.localeCompare(right),
    ),
  };
}

function compareSourcesByPriority(
  left: SourceDefinition,
  right: SourceDefinition,
): number {
  const priorityDifference = right.priority - left.priority;
  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  return left.id.localeCompare(right.id);
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

function defaultCoverageModeForSourceKind(
  kind: SourceDefinition["kind"],
): "direct" | "rotating" | "sampled" | "indexed" {
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

  // ard-registry sources use indexed (cursor-based) coverage.
  if (kind === "ard-registry") {
    return "indexed";
  }

  return "sampled";
}

function defaultSyncStatusForSourceKind(
  kind: SourceDefinition["kind"],
): "not-applicable" | "unsupported" {
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

export const sourceIndexInternals = {
  defaultCoverageModeForSourceKind,
} as const;
