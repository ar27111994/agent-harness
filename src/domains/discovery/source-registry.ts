import { join } from "node:path";

import { listFilesRecursive, pathExists, readJsonFile } from "../../files.js";
import { assertSourceRegistry } from "../../manifest-validation.js";
import type {
  AssetKind,
  HostTarget,
  SourceDefinition,
  SourceRegistry,
} from "../../types.js";
import { buildGeneratedLocalSources } from "./local-sources.js";

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

export async function loadSourceRegistry(
  projectRoot: string,
): Promise<SourceRegistry> {
  const baseRegistry = await readJsonFile<SourceRegistry>(
    join(projectRoot, "discover", "sources.json"),
    assertSourceRegistry,
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

function lastPathSegment(value: string): string {
  const normalizedValue = value.replace(/\/+$/u, "");
  const segments = normalizedValue
    .split(/[\\/]/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const lastSegment = segments.at(-1);
  return lastSegment ?? value;
}

function humanizeSlug(value: string): string {
  return value
    .replace(/[-_]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\b\w/gu, (character) => character.toUpperCase());
}
