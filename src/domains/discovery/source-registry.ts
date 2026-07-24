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
import {
  applySourceVerificationDemotions,
  buildSourceVerificationReport,
} from "./source-verification.js";

interface SourcePackShape {
  schemaVersion: number;
  entries: Array<{
    id: string;
    repo: string;
    /** Source kind — defaults to "repo" when absent. */
    kind?: SourceDefinition["kind"];
    /** Required: authority tier classifying trust level of this source. */
    authorityTier: SourceDefinition["authorityTier"];
    publisher?: string;
    publisherVerified?: boolean;
    hosts?: HostTarget[];
    /** Required: at least one asset kind must be declared. */
    assetKinds: AssetKind[];
    includePaths?: string[];
    excludePaths?: string[];
    mcpServerPaths?: string[];
    priority?: number;
    enabled?: boolean;
    name?: string;
  }>;
}

/**
 * Loads source registry from project state.
 */
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
    return applySourceVerification(projectRoot, registryWithLocalSeeds);
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
      .map((source) => normalizeRepoIdentity(source.endpoints.repo))
      .filter((value): value is string => typeof value === "string"),
  );

  for (const sourcePackFile of sourcePackFiles) {
    const sourcePack = await readJsonFile<SourcePackShape>(
      sourcePackFile,
      assertSourcePackShape,
    );
    for (const entry of sourcePack.entries) {
      const normalizedRepoUrl = normalizeRepoIdentity(entry.repo);
      if (
        existingSourceIds.has(entry.id) ||
        (normalizedRepoUrl && existingRepoUrls.has(normalizedRepoUrl))
      ) {
        continue;
      }

      const repoOwner = getRepoOwner(entry.repo);
      generatedSources.push({
        id: entry.id,
        name: entry.name ?? humanizeSlug(lastPathSegment(entry.repo)),
        kind: entry.kind ?? "repo",
        /* c8 ignore next 2 -- authorityTier is required by assertRequiredEnum; ?? fallback is a type-safe defensive guard that cannot be reached at runtime */
        authorityTier: entry.authorityTier ?? "trusted-community",
        publisher: {
          name: entry.publisher ?? repoOwner,
          verified: entry.publisherVerified ?? false,
          owner: repoOwner,
        },
        hosts: entry.hosts ?? ["copilot-vscode", "opencode"],
        /* c8 ignore next 8 -- assetKinds is required by assertRequiredEnumArray; ?? fallback is a type-safe defensive guard that cannot be reached at runtime */
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
        includePaths: entry.includePaths,
        excludePaths: entry.excludePaths,
        mcpServerPaths: entry.mcpServerPaths,
        rules: {
          officialPreferred: true,
          allowMirror: false,
          allowInstall: false,
        },
      });

      existingSourceIds.add(entry.id);
      if (normalizedRepoUrl) {
        existingRepoUrls.add(normalizedRepoUrl);
      }
    }
  }

  return applySourceVerification(projectRoot, {
    ...registryWithLocalSeeds,
    sources: [...registryWithLocalSeeds.sources, ...generatedSources],
  });
}

async function applySourceVerification(
  projectRoot: string,
  registry: SourceRegistry,
): Promise<SourceRegistry> {
  const verificationReport = await buildSourceVerificationReport(
    projectRoot,
    registry.sources,
  );

  return {
    ...registry,
    sources: applySourceVerificationDemotions(
      registry.sources,
      verificationReport,
    ),
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
    assertNonEmptyString(entryRecord.id, `${context}.entries[${index}].id`);
    assertRepositoryString(
      entryRecord.repo,
      `${context}.entries[${index}].repo`,
    );
    assertOptionalEnum(
      entryRecord.kind,
      [
        "repo",
        "docs",
        "marketplace",
        "registry",
        "package-registry",
        "local-manifest",
        "local-directory",
      ],
      `${context}.entries[${index}].kind`,
    );
    assertRequiredEnum(
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
    assertRequiredEnumArray(
      entryRecord.assetKinds,
      ASSET_KINDS,
      `${context}.entries[${index}].assetKinds`,
    );
    assertOptionalStringArray(
      entryRecord.includePaths,
      `${context}.entries[${index}].includePaths`,
    );
    assertOptionalStringArray(
      entryRecord.excludePaths,
      `${context}.entries[${index}].excludePaths`,
    );
    assertOptionalStringArray(
      entryRecord.mcpServerPaths,
      `${context}.entries[${index}].mcpServerPaths`,
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

function assertNonEmptyString(value: unknown, context: string): string {
  const stringValue = assertString(value, context);
  if (stringValue.trim().length === 0) {
    throw new Error(`${context} must not be empty`);
  }

  return stringValue;
}

function assertRepositoryString(value: unknown, context: string): string {
  const stringValue = assertNonEmptyString(value, context);
  const normalizedValue = stringValue.trim().replace(/\.git\/?$/u, "");
  const sshMatch = /^git@[^:]+:(.+)$/u.exec(normalizedValue);
  const repositoryPath = sshMatch
    ? sshMatch[1]!
    : (extractUrlPath(normalizedValue) ?? normalizedValue);
  const segments = repositoryPath
    .replace(/^\/+|\/+$/gu, "")
    .split(/[/\\]/u)
    .filter((segment) => segment.trim().length > 0);
  if (segments.length < 2) {
    throw new Error(`${context} must include repository owner and name`);
  }

  return stringValue;
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

function assertRequiredEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  context: string,
): void {
  if (value === undefined) {
    throw new Error(`${context} is required`);
  }

  if (typeof value !== "string" || !allowedValues.includes(value as T)) {
    throw new Error(`${context} must be one of: ${allowedValues.join(", ")}`);
  }
}

function assertRequiredEnumArray<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  context: string,
): void {
  if (value === undefined) {
    throw new Error(`${context} is required`);
  }

  const items = assertArray(value, context);
  if (items.length === 0) {
    throw new Error(`${context} must contain at least one value`);
  }

  items.forEach((entry, index) => {
    /* c8 ignore next 2 */
    if (entry == null) {
      throw new Error(`${context}[${index}] must not be null or undefined`);
    }
    assertOptionalEnum(entry, allowedValues, `${context}[${index}]`);
  });
}

function assertOptionalStringArray(value: unknown, context: string): void {
  if (value === undefined) {
    return;
  }

  assertArray(value, context).forEach((entry, index) => {
    assertNonEmptyString(entry, `${context}[${index}]`);
  });
}

function normalizeRepoIdentity(repo: string | undefined): string | undefined {
  if (!repo) {
    return undefined;
  }

  const normalizedRepo = repo.trim().replace(/\.git$/u, "");
  const sshMatch = /^git@([^:]+):(.+)$/u.exec(normalizedRepo);
  if (sshMatch) {
    return `${sshMatch[1]!}/${sshMatch[2]!}`
      .replace(/^\/+|\/+$/gu, "")
      .toLowerCase();
  }

  const urlPath = extractUrlPath(normalizedRepo);
  if (urlPath) {
    const parsedUrl = new URL(normalizedRepo);
    return `${parsedUrl.hostname}/${urlPath}`
      .replace(/\/+/gu, "/")
      .replace(/^\/+|\/+$/gu, "")
      .toLowerCase();
  }

  return normalizedRepo.replace(/^\/+|\/+$/gu, "").toLowerCase();
}

function getRepoOwner(repo: string): string {
  const normalizedRepo = repo.trim().replace(/\.git$/u, "");
  const sshMatch = /^git@[^:]+:(.+)$/u.exec(normalizedRepo);
  const pathLikeRepo = sshMatch
    ? sshMatch[1]!
    : (extractUrlPath(normalizedRepo) ?? normalizedRepo);
  const segments = pathLikeRepo
    .replace(/^\/+|\/+$/gu, "")
    .split(/[/\\]/u)
    .filter((segment) => segment.length > 0);

  return segments[segments.length - 2]!;
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
    .split(/[/\\]/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return segments[segments.length - 1]!;
}

function humanizeSlug(value: string): string {
  return value
    .replace(/[-_]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\b\w/gu, (character) => character.toUpperCase());
}
