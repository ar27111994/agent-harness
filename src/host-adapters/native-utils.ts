import { readdir, rmdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import {
  readJsonFileOrNull,
  readTextFileOrNull,
  removeManagedSection,
  removePath,
  toPosixPath,
  upsertManagedSection,
  writeJsonFile,
  writeTextFile,
} from "../files.js";
import {
  collectHostNativeFilePayloads,
  applyHostNativeFilePayloads,
} from "./native-config.js";
import type {
  AssetCatalogEntry,
  AssetHostNativeConfigMap,
  AssetKind,
  ManagedTextFileSnapshot,
  NativeConfigOperation,
  WirePlanManifest,
} from "../types.js";

/**
 * JSON object type alias.
 */
export type JsonObject = Record<string, unknown>;

/**
 * Activation lifecycle host identifier.
 */
export type LifecycleActivationHost = "copilot-vscode" | "opencode";

/**
 * Native wiring spec for a single AI coding host.
 */
export interface NativeHostSpec {
  host: "cursor" | "zed" | "claude-code" | "pi" | "codex";
  displayName: string;
  activationHost: LifecycleActivationHost;
  previewHost: string;
  managedRootSegments: string[];
  targetPathSegments: string[][];
  notes: string[];
}

/**
 * Materialized native asset held in activation state.
 */
export interface NativeAsset {
  assetId: string;
  assetKind: AssetKind;
  displayName: string;
  compatibilityMode: AssetCatalogEntry["compatibilityMode"];
  content: string;
  extensionId?: string;
  hostNativeConfig?: AssetHostNativeConfigMap;
}

/**
 * Materialized native asset buckets keyed by kind.
 */
export interface MaterializedNativeAssets {
  instructionFiles: string[];
  agentFiles: string[];
  skillDirs: string[];
  pluginDirs: string[];
  hookFiles: string[];
  workflowFiles: string[];
  referenceFiles: string[];
  extensionIds: string[];
  mcpServers: string[];
}

/**
 * Shared options for per-host native file write functions.
 */
export interface WireNativeFilesOptions {
  workspaceRoot: string;
  managedRoot: string;
  nativeAssets: NativeAsset[];
  materializedAssets: MaterializedNativeAssets;
  mcpServers: string[];
}

/**
 * Applies host-native structured file payloads.
 */
export async function applyStructuredNativeConfig(
  workspaceRoot: string,
  host: "cursor" | "zed" | "claude-code" | "pi" | "codex",
  options: {
    nativeAssets: NativeAsset[];
  },
): Promise<NativeConfigOperation[]> {
  const payloads = collectHostNativeFilePayloads(options.nativeAssets, host);

  if (payloads.length === 0) {
    return [];
  }

  return applyHostNativeFilePayloads({
    workspaceRoot,
    host,
    payloads,
  });
}

/**
 * Exposes text-file snapshot restore for per-host adapter use.
 */
export async function restoreManagedTextFileSnapshot(
  filePath: string,
  snapshots: ManagedTextFileSnapshot[] | undefined,
  fallbackRestore: () => Promise<void>,
): Promise<void> {
  const snapshot = snapshots?.find(
    (entry) => entry.path === toPosixPath(filePath),
  );

  if (!snapshot) {
    await fallbackRestore();
    return;
  }

  if (snapshot.content === null) {
    await removePath(filePath);
    return;
  }

  await writeTextFile(filePath, snapshot.content);
}

/**
 * Restores a managed section from a text-file snapshot, scoped to a single
 * markerId. Other managed sections in the file are preserved.
 *
 * - If a snapshot with non-null content exists: extract the managed section
 *   from the snapshot and apply only that section to the current file.
 * - If the snapshot content is null or no snapshot exists: remove the
 *   managed section from the current file via the fallback.
 */
export async function restoreManagedSectionFromSnapshot(
  filePath: string,
  snapshots: ManagedTextFileSnapshot[] | undefined,
  markerId: string,
  fallbackRemove: () => Promise<void>,
): Promise<void> {
  const snapshot = snapshots?.find(
    (entry) => entry.path === toPosixPath(filePath),
  );

  if (!snapshot) {
    await fallbackRemove();
    return;
  }

  const currentContent = await readTextFileOrNull(filePath);

  if (snapshot.content === null) {
    // File didn't exist at snapshot time — just remove the section
    if (currentContent !== null) {
      const removed = removeManagedSection({
        originalContent: currentContent,
        markerId,
      });
      if (removed.trim().length === 0) {
        await removePath(filePath);
      } else {
        await writeTextFile(filePath, removed);
      }
    }
    return;
  }

  // Snapshot has content — extract the managed section from it and
  // insert/replace only that section in the current file, preserving
  // other hosts' sections.
  const snapshotSection = extractManagedSectionContent(
    snapshot.content,
    markerId,
  );

  if (currentContent === null) {
    if (snapshotSection !== null) {
      await writeTextFile(
        filePath,
        upsertManagedSection({
          originalContent: "",
          markerId,
          bodyLines: snapshotSection.split("\n"),
        }),
      );
    }
    return;
  }

  // Remove the current managed section, insert the snapshot version
  const removed = removeManagedSection({
    originalContent: currentContent,
    markerId,
  });

  if (snapshotSection === null) {
    // Section was removed between snapshot and now
    if (removed.trim().length === 0) {
      await removePath(filePath);
    } else {
      await writeTextFile(filePath, removed);
    }
    return;
  }

  // Insert the snapshot section
  const restored = upsertManagedSection({
    originalContent: removed,
    markerId,
    bodyLines: snapshotSection.split("\n"),
  });
  await writeTextFile(filePath, restored);
}

/**
 * Extracts the content of a managed section by markerId from text.
 * Returns null if no such section exists.
 */
function extractManagedSectionContent(
  text: string,
  markerId: string,
): string | null {
  const beginTag = `${markerId}:begin`;
  const endTag = `${markerId}:end`;
  const beginIdx = text.indexOf(beginTag);
  if (beginIdx === -1) return null;
  const contentStart = text.indexOf("\n", beginIdx) + 1;
  const endIdx = text.indexOf(endTag, contentStart);
  if (endIdx === -1) return null;
  // Find the line start of the end tag
  const endLineStart = text.lastIndexOf("\n", endIdx);
  return text.slice(contentStart, endLineStart === -1 ? endIdx : endLineStart);
}

/**
 * Validates wire-plan text snapshots are within the managed restore set.
 */
export function validateManagedTextFileSnapshots(
  wirePlan: WirePlanManifest | null,
  allowedPaths: string[],
  context: string,
): WirePlanManifest | null {
  if (!wirePlan || wirePlan.textFileSnapshots === undefined) {
    return wirePlan;
  }

  const allowedSnapshotPaths = new Set(
    allowedPaths.map((pathValue) => toPosixPath(pathValue)),
  );
  const seenPaths = new Set<string>();

  for (const snapshot of wirePlan.textFileSnapshots) {
    if (!allowedSnapshotPaths.has(snapshot.path)) {
      throw new Error(
        `${toPosixPath(context)} contains textFileSnapshots path outside the managed restore set: ${snapshot.path}`,
      );
    }

    if (seenPaths.has(snapshot.path)) {
      throw new Error(
        `${toPosixPath(context)} contains duplicate textFileSnapshots entry: ${snapshot.path}`,
      );
    }

    seenPaths.add(snapshot.path);
  }

  return wirePlan;
}

/**
 * Exposes managed-section upsert for per-host adapter use.
 */
export async function upsertManagedSectionFile(
  filePath: string,
  markerId: string,
  bodyLines: string[],
): Promise<void> {
  const existingContent = (await readTextFileOrNull(filePath)) ?? "";
  await writeTextFile(
    filePath,
    upsertManagedSection({
      originalContent: existingContent,
      markerId,
      bodyLines,
    }),
  );
}

/**
 * Exposes managed-section removal for per-host adapter use.
 */
export async function removeManagedSectionFile(
  filePath: string,
  markerId: string,
): Promise<void> {
  const existingContent = await readTextFileOrNull(filePath);
  if (existingContent === null) {
    return;
  }

  const nextContent = removeManagedSection({
    originalContent: existingContent,
    markerId,
  });
  if (nextContent.trim().length === 0) {
    await removePath(filePath);
    return;
  }

  await writeTextFile(filePath, nextContent);
}

/**
 * Exposes JSON-file merge for per-host adapter use.
 */
export async function mergeJsonFile(
  filePath: string,
  patch: JsonObject,
): Promise<void> {
  const currentValue = await readJsonFileOrNull<unknown>(filePath);
  const currentObject =
    currentValue === null ? {} : assertJsonObject(currentValue, filePath);
  await writeJsonFile(filePath, mergeJsonObjects(currentObject, patch));
}

/**
 * Ensures an existing host settings file can be safely object-merged.
 */
export function assertJsonObject(value: unknown, filePath: string): JsonObject {
  if (isJsonObject(value)) {
    return value;
  }

  throw new Error(
    `Expected ${toPosixPath(filePath)} to contain a JSON object, but found ${describeJsonValue(value)}.`,
  );
}

/**
 * Describes a JSON value's runtime type for error messages.
 */
export function describeJsonValue(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }

  return value === null ? "null" : typeof value;
}

/**
 * Exposes managed Zed settings removal for per-host adapter use.
 *
 * Tolerates malformed (non-object) settings files by returning without
 * modification — safe for reset/cleanup paths. The corresponding upsert
 * path (writeZedNativeFiles) uses mergeJsonFile which rejects non-object
 * payloads via assertJsonObject.
 */
export async function removeManagedZedSettings(
  filePath: string,
  workspaceRoot: string,
): Promise<void> {
  const existingValue = await readJsonFileOrNull<unknown>(filePath);
  const settings = asJsonObject(existingValue);
  if (!settings) {
    return;
  }

  const agent = asJsonObject(settings.agent);
  const profiles = asJsonObject(agent?.profiles);
  if (profiles) {
    delete profiles["agent-harness"];
  }
  if (profiles && Object.keys(profiles).length === 0 && agent) {
    delete agent.profiles;
  }
  if (agent && Object.keys(agent).length === 0) {
    delete settings.agent;
  }

  await writeOrRemoveJsonFile(filePath, settings, workspaceRoot);
}

/**
 * Exposes managed Pi settings upsert for per-host adapter use.
 */
export async function upsertManagedPiSettings(filePath: string): Promise<void> {
  const existingValue = await readJsonFileOrNull<unknown>(filePath);
  const settings =
    existingValue === null ? {} : assertJsonObject(existingValue, filePath);
  delete settings.agentHarness;

  addManagedStringArrayEntries(settings, "skills", ["skills/agent-harness"]);
  addManagedStringArrayEntries(settings, "prompts", [
    "prompts/agent-harness.md",
  ]);

  await writeOrRemoveJsonFile(filePath, settings);
}

/**
 * Exposes managed Pi settings removal for per-host adapter use.
 *
 * Tolerates malformed (non-object) settings files by returning without
 * modification — safe for reset/cleanup paths.  See
 * removeManagedZedSettings above for the rationale behind the
 * reset-vs-wiring asymmetry.
 */
export async function removeManagedPiSettings(
  filePath: string,
  workspaceRoot: string,
): Promise<void> {
  const existingValue = await readJsonFileOrNull<unknown>(filePath);
  const settings = asJsonObject(existingValue);
  if (!settings) {
    return;
  }

  removeManagedStringArrayEntries(settings, "skills", ["skills/agent-harness"]);
  removeManagedStringArrayEntries(settings, "prompts", [
    "prompts/agent-harness.md",
  ]);
  delete settings.agentHarness;

  await writeOrRemoveJsonFile(filePath, settings, workspaceRoot);
}

/**
 * Exposes write-or-remove JSON helper for per-host adapter use.
 */
export async function writeOrRemoveJsonFile(
  filePath: string,
  value: JsonObject,
  cleanupRoot?: string,
): Promise<void> {
  if (Object.keys(value).length === 0) {
    await removePath(filePath);
    if (cleanupRoot) {
      await removeEmptyParentDirectories(dirname(filePath), cleanupRoot);
    }
    return;
  }

  await writeJsonFile(filePath, value);
}

/**
 * Exposes empty-directory cleanup for per-host adapter use.
 */
export async function removeEmptyParentDirectories(
  startDirectory: string,
  stopDirectory: string,
  removeDirectory: typeof rmdir = rmdir,
): Promise<void> {
  const boundary = resolve(stopDirectory);
  let currentDirectory = resolve(startDirectory);
  const relativeToBoundary = relative(boundary, currentDirectory);

  if (
    /^(?:\.\.)(?:[\\/]|$)/u.test(relativeToBoundary) ||
    isAbsolute(relativeToBoundary)
  ) {
    throw new Error(
      `Expected directory '${toPosixPath(currentDirectory)}' to be within cleanup boundary '${toPosixPath(boundary)}'.`,
    );
  }

  while (currentDirectory !== boundary) {
    let entries: string[];
    try {
      entries = await readdir(currentDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }

    if (entries.length > 0) {
      return;
    }

    try {
      await removeDirectory(currentDirectory);
    } catch (error) {
      if (isBenignRemoveDirectoryRace(error)) {
        return;
      }
      throw error;
    }

    currentDirectory = dirname(currentDirectory);
  }
}

/**
 * Exposes benign race detection for per-host adapter use.
 */
export function isBenignRemoveDirectoryRace(error: unknown): boolean {
  const errorCode = (error as NodeJS.ErrnoException).code;
  return (
    errorCode === "ENOENT" ||
    errorCode === "ENOTEMPTY" ||
    errorCode === "EEXIST"
  );
}

/**
 * Exposes managed instruction line builder for per-host adapter use.
 */
export function buildManagedInstructionLines(options: {
  hostName: string;
  managedRoot: string;
  nativeAssets: NativeAsset[];
  materializedAssets: MaterializedNativeAssets;
  mcpServers: string[];
}): string[] {
  const lines = [
    `# Agent Harness for ${options.hostName}`,
    "",
    "Agent Harness has wired curated project assets into this workspace.",
    `Managed asset root: ${toPosixPath(options.managedRoot)}`,
    "",
    "## Active assets",
  ];

  if (options.nativeAssets.length === 0) {
    lines.push("- No active assets were found at wire time.");
  } else {
    for (const asset of options.nativeAssets) {
      lines.push(
        `- ${asset.displayName} (${asset.assetKind}, ${asset.assetId})`,
      );
    }
  }

  appendMaterializedAssetPathLines(lines, options.materializedAssets);

  if (options.mcpServers.length > 0) {
    lines.push("", "## MCP references");
    for (const mcpServer of options.mcpServers) {
      lines.push(`- ${mcpServer}`);
    }
  }

  lines.push(
    "",
    "## Usage guidance",
    "- Prefer the curated assets above when they match the current task.",
    "- Treat hooks, plugins, extensions, and MCP references as opt-in capabilities that may require host-specific trust or setup.",
    "- Review managed files before committing project-local host configuration.",
  );

  return lines;
}

function appendMaterializedAssetPathLines(
  lines: string[],
  materializedAssets: MaterializedNativeAssets,
): void {
  const pathGroups = [
    ["Instruction files", materializedAssets.instructionFiles],
    ["Agent files", materializedAssets.agentFiles],
    ["Skill directories", materializedAssets.skillDirs],
    ["Plugin directories", materializedAssets.pluginDirs],
    ["Hook files", materializedAssets.hookFiles],
    ["Workflow and prompt files", materializedAssets.workflowFiles],
    ["Reference files", materializedAssets.referenceFiles],
  ] as const;
  const populatedPathGroups = pathGroups.filter(
    ([, paths]) => paths.length > 0,
  );

  if (
    populatedPathGroups.length === 0 &&
    materializedAssets.extensionIds.length === 0
  ) {
    return;
  }

  lines.push("", "## Wired asset locations");
  for (const [heading, paths] of populatedPathGroups) {
    lines.push("", `### ${heading}`);
    for (const path of paths) {
      lines.push(`- ${toPosixPath(path)}`);
    }
  }

  if (materializedAssets.extensionIds.length > 0) {
    lines.push("", "### Extension IDs");
    for (const extensionId of materializedAssets.extensionIds) {
      lines.push(`- ${extensionId}`);
    }
  }
}

/**
 * Exposes asset content section builder for per-host adapter use.
 */
export function buildNativeAssetContentSections(
  nativeAssets: NativeAsset[],
  assetKinds: AssetKind[],
): string[] {
  const selectedAssets = nativeAssets.filter((nativeAsset) =>
    assetKinds.includes(nativeAsset.assetKind),
  );

  if (selectedAssets.length === 0) {
    return [];
  }

  const lines = ["", "## Selected asset content"];
  for (const asset of selectedAssets) {
    lines.push(
      "",
      `### ${asset.displayName}`,
      "",
      `- Asset ID: ${asset.assetId}`,
      `- Asset kind: ${asset.assetKind}`,
      "",
      asset.content.trim(),
    );
  }

  return lines;
}

/**
 * Exposes asset markdown builder for per-host adapter use.
 */
export function buildAssetMarkdown(nativeAsset: NativeAsset): string {
  return [
    `# ${nativeAsset.displayName}`,
    "",
    `- Asset ID: ${nativeAsset.assetId}`,
    `- Asset kind: ${nativeAsset.assetKind}`,
    "",
    "## Content",
    "",
    nativeAsset.content.trim(),
    "",
  ].join("\n");
}

/**
 * Exposes agent-file builder for per-host adapter use.
 */
export function buildAgentFile(
  name: string,
  description: string,
  bodyLines: string[],
): string {
  return [
    "---",
    `name: ${quoteFrontmatterScalar(name)}`,
    `description: ${quoteFrontmatterScalar(description)}`,
    "---",
    "",
    ...bodyLines,
    "",
  ].join("\n");
}

/**
 * Exposes skill-file builder for per-host adapter use.
 */
export function buildSkillFile(
  name: string,
  description: string,
  bodyLines: string[],
): string {
  return [
    "---",
    `name: ${quoteFrontmatterScalar(name)}`,
    `description: ${quoteFrontmatterScalar(description)}`,
    "---",
    "",
    ...bodyLines,
    "",
  ].join("\n");
}

/**
 * Exposes prompt-template builder for per-host adapter use.
 */
export function buildPromptTemplate(
  description: string,
  bodyLines: string[],
): string {
  return [
    "---",
    `description: ${quoteFrontmatterScalar(description)}`,
    "---",
    "",
    ...bodyLines,
    "",
  ].join("\n");
}

function quoteFrontmatterScalar(value: string): string {
  return JSON.stringify(value.replace(/\r\n?/gu, "\n"));
}

/** Lookup table mapping AssetKind to managed directory names. */
const ASSET_KIND_DIRECTORY_NAMES: Record<string, string> = {
  "mcp-server": "mcp-servers",
  "prompt-pack": "prompt-packs",
  "reference-pack": "reference-packs",
};

/**
 * Exposes asset-kind directory-name resolver for per-host adapter use.
 */
export function directoryNameForAssetKind(assetKind: AssetKind): string {
  return ASSET_KIND_DIRECTORY_NAMES[assetKind] ?? `${assetKind}s`;
}

/**
 * Returns a sorted deduplicated array of strings.
 */
export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/**
 * Exposes JSON-object merge helper for per-host adapter use.
 */
export function mergeJsonObjects(
  base: JsonObject,
  patch: JsonObject,
): JsonObject {
  const merged: JsonObject = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    const existingValue = merged[key];
    if (Array.isArray(value)) {
      // Preserve patch arrays as-is — direct replacement preserves
      // structured/mixed values, ordering, and non-string entries.
      // uniqueStrings/coerceStringArray would drop non-string values
      // and deduplicate/reorder entries, which is incorrect for
      // general JSON arrays (e.g., manifest configs with objects).
      merged[key] = value;
      continue;
    }

    if (isJsonObject(value) && isJsonObject(existingValue)) {
      merged[key] = mergeJsonObjects(existingValue, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

function asJsonObject(value: unknown): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

/**
 * Exposes JSON-object guard for per-host adapter use.
 */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function addManagedStringArrayEntries(
  settings: JsonObject,
  key: string,
  entriesToAdd: readonly string[],
): void {
  settings[key] = mergeStringArraysPreservingOrder(
    coerceStringArray(settings[key]),
    entriesToAdd,
  );
}

/**
 * Exposes managed string-array removal for per-host adapter use.
 */
export function removeManagedStringArrayEntries(
  settings: JsonObject,
  key: string,
  entriesToRemove: readonly string[],
): void {
  if (!(key in settings)) {
    return;
  }

  const nextValues = coerceStringArray(settings[key]).filter(
    (entry) => !entriesToRemove.includes(entry),
  );
  if (nextValues.length === 0) {
    delete settings[key];
    return;
  }

  settings[key] = nextValues;
}

/**
 * Exposes string-array merge with order preservation for per-host adapter use.
 */
export function mergeStringArraysPreservingOrder(
  existingValues: readonly string[],
  additionalValues: readonly string[],
): string[] {
  const mergedValues: string[] = [];
  const seen = new Set<string>();

  for (const entry of [...existingValues, ...additionalValues]) {
    if (seen.has(entry)) {
      continue;
    }

    seen.add(entry);
    mergedValues.push(entry);
  }

  return mergedValues;
}
