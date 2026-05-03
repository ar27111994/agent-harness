import { join } from "node:path";

import { listFilesRecursive, pathExists, readJsonFile } from "../../files.js";
import { assertSourceRegistry } from "../../manifest-validation.js";
import {
  ASSET_KINDS,
  AUTHORITY_TIERS,
  assertHostTarget,
} from "../../manifest-validation/primitives.js";
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
    const sourcePack = await readJsonFile<SourcePackShape>(
      sourcePackFile,
      assertSourcePackShape,
    );
    for (const entry of sourcePack.entries) {
      const normalizedRepoUrl = entry.repo.toLowerCase();
      if (
        existingSourceIds.has(entry.id) ||
        existingRepoUrls.has(normalizedRepoUrl)
      ) {
        continue;
      }

      const repoOwner = getRepoOwner(entry.repo);
      generatedSources.push({
        id: entry.id,
        name: entry.name ?? humanizeSlug(lastPathSegment(entry.repo)),
        kind: "repo",
        authorityTier: entry.authorityTier ?? "trusted-community",
        publisher: {
          name: entry.publisher ?? repoOwner ?? entry.id,
          verified: entry.publisherVerified ?? false,
          owner: repoOwner,
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

function assertSourcePackShape(
  value: unknown,
  context: string,
): asserts value is SourcePackShape {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertArray(record.entries, `${context}.entries`).forEach((entry, index) => {
    const entryRecord = assertRecord(entry, `${context}.entries[${index}]`);
    assertString(entryRecord.id, `${context}.entries[${index}].id`);
    assertString(entryRecord.repo, `${context}.entries[${index}].repo`);
    assertOptionalEnum(
      entryRecord.authorityTier,
      AUTHORITY_TIERS,
      `${context}.entries[${index}].authorityTier`,
    );
    assertOptionalString(
      entryRecord.publisher,
      `${context}.entries[${index}].publisher`,
    );
    if (
      entryRecord.publisherVerified !== undefined &&
      typeof entryRecord.publisherVerified !== "boolean"
    ) {
      throw new Error(
        `${context}.entries[${index}].publisherVerified must be a boolean`,
      );
    }
    assertOptionalHostTargetArray(
      entryRecord.hosts,
      `${context}.entries[${index}].hosts`,
    );
    assertOptionalEnumArray(
      entryRecord.assetKinds,
      ASSET_KINDS,
      `${context}.entries[${index}].assetKinds`,
    );
    if (
      entryRecord.priority !== undefined &&
      typeof entryRecord.priority !== "number"
    ) {
      throw new Error(`${context}.entries[${index}].priority must be a number`);
    }
    if (
      entryRecord.enabled !== undefined &&
      typeof entryRecord.enabled !== "boolean"
    ) {
      throw new Error(`${context}.entries[${index}].enabled must be a boolean`);
    }
    assertOptionalString(entryRecord.name, `${context}.entries[${index}].name`);
  });
}

function assertRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }

  return value as Record<string, unknown>;
}

function assertArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }

  return value;
}

function assertString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new Error(`${context} must be a string`);
  }

  return value;
}

function assertNumber(value: unknown, context: string): number {
  if (typeof value !== "number") {
    throw new Error(`${context} must be a number`);
  }

  return value;
}

function assertOptionalString(value: unknown, context: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${context} must be a string when set`);
  }
}

function assertOptionalHostTargetArray(value: unknown, context: string): void {
  if (value === undefined) {
    return;
  }

  assertArray(value, context).forEach((entry, index) => {
    assertHostTarget(entry, `${context}[${index}]`);
  });
}

function assertOptionalEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  context: string,
): void {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "string" || !allowedValues.includes(value as T)) {
    throw new Error(`${context} must be one of: ${allowedValues.join(", ")}`);
  }
}

function assertOptionalEnumArray<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  context: string,
): void {
  if (value === undefined) {
    return;
  }

  assertArray(value, context).forEach((entry, index) => {
    assertOptionalEnum(entry, allowedValues, `${context}[${index}]`);
  });
}

function getRepoOwner(repo: string): string | undefined {
  const normalizedRepo = repo.trim().replace(/\.git$/u, "");
  const sshMatch = /^git@[^:]+:(.+)$/u.exec(normalizedRepo);
  const pathLikeRepo =
    sshMatch?.[1] ?? extractUrlPath(normalizedRepo) ?? normalizedRepo;
  const segments = pathLikeRepo
    .replace(/^\/+|\/+$/gu, "")
    .split("/")
    .filter((segment) => segment.length > 0);

  return segments.length >= 2 ? segments[segments.length - 2] : undefined;
}

function extractUrlPath(value: string): string | undefined {
  try {
    return new URL(value).pathname;
  } catch {
    return undefined;
  }
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
