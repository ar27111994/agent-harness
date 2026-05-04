import { join } from "node:path";

import { readJsonFile, toPosixPath, writeJsonFile } from "../../files.js";
import { assertSelectionRegistry } from "../../manifest-validation.js";
import type {
  SelectionRegistry,
  SourceDefinition,
  SourceIndex,
} from "../../types.js";
import { countBy } from "./catalog-utils.js";
import { SOURCE_INDEX_OUTPUT_PATH } from "./output-paths.js";
import { loadSourceRegistry } from "./source-registry.js";

/**
 * Generates source index artifacts for the lifecycle pipeline.
 */
export async function generateSourceIndex(projectRoot: string): Promise<void> {
  const sourceRegistry = await loadSourceRegistry(projectRoot);
  const selectionRegistry = await readJsonFile<SelectionRegistry>(
    join(projectRoot, "discover", "selections.json"),
    assertSelectionRegistry,
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
