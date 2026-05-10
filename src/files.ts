import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  appendFile,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, relative, sep } from "node:path";
import { createInterface } from "node:readline";

import { getRuntimeConfig } from "./config/runtime.js";

const FILE_STAT_CONCURRENCY = 16;

/**
 * Defines default ignored directory names shared by the lifecycle pipeline.
 */
export const DEFAULT_IGNORED_DIRECTORY_NAMES = new Set([
  ".agent",
  ".git",
  ".idea",
  ".next",
  ".nuxt",
  ".tmp",
  ".agent-harness",
  ".claude",
  ".cursor",
  ".dart_tool",
  ".opencode",
  ".pi",
  ".specify",
  ".zed",
  "activate",
  "build",
  "coverage",
  "dist",
  "discover/output",
  "install",
  "mirror",
  "node_modules",
  "state",
  "vendor",
  ".cache",
  ".gradle",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".terraform",
  ".venv",
  "DerivedData",
  "Pods",
  "obj",
  "target",
  "venv",
]);

/**
 * Defines the supported json validator values.
 */
export type JsonValidator<T> = (
  value: unknown,
  context: string,
) => asserts value is T;

/**
 * Resolves project root from the provided inputs.
 */
export function resolveProjectRoot(scriptFilePath: string): string {
  const scriptDirectory = dirname(scriptFilePath);
  const directoryName = basename(scriptDirectory);

  if (directoryName === "dist" || directoryName === "src") {
    return dirname(scriptDirectory);
  }

  return scriptDirectory;
}

/**
 * Provides path exists for the lifecycle pipeline.
 */
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Provides path entry exists for the lifecycle pipeline.
 */
export async function pathEntryExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures ensure directory exists or is ready for use.
 */
export async function ensureDirectory(directoryPath: string): Promise<void> {
  try {
    await mkdir(directoryPath, { recursive: true });
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (
      (errorCode === "EEXIST" || errorCode === "EINVAL") &&
      (await isUsableDirectoryPath(directoryPath))
    ) {
      return;
    }

    throw error;
  }
}

/**
 * Reads json file from project state.
 */
export async function readJsonFile<T>(
  filePath: string,
  validator?: JsonValidator<T>,
): Promise<T> {
  const content = await readFile(filePath, "utf8");
  let parsedContent: unknown;

  try {
    parsedContent = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${toPosixPath(filePath)}: ${getErrorMessage(error)}`,
      { cause: error },
    );
  }

  if (validator) {
    const validate: JsonValidator<T> = validator;
    validate(parsedContent, toPosixPath(filePath));
  }

  return parsedContent as T;
}

/**
 * Reads json file or null from project state.
 */
export async function readJsonFileOrNull<T>(
  filePath: string,
  validator?: JsonValidator<T>,
): Promise<T | null> {
  try {
    return await readJsonFile<T>(filePath, validator);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

/**
 * Reads text file or null from project state.
 */
export async function readTextFileOrNull(
  filePath: string,
): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

/**
 * Reads binary file bytes or null from project state.
 */
export async function readBinaryFileOrNull(
  filePath: string,
): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

/**
 * Writes json file to project state.
 */
export async function writeJsonFile(
  filePath: string,
  value: unknown,
): Promise<void> {
  await ensureDirectory(dirname(filePath));
  const json = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filePath, json, "utf8");
}

/**
 * Writes text file to project state.
 */
export async function writeTextFile(
  filePath: string,
  value: string,
): Promise<void> {
  await ensureDirectory(dirname(filePath));
  await writeFile(filePath, value, "utf8");
}

/**
 * Writes binary file bytes to project state.
 */
export async function writeBinaryFile(
  filePath: string,
  value: Buffer,
): Promise<void> {
  await ensureDirectory(dirname(filePath));
  await writeFile(filePath, value);
}

/**
 * Snapshots file if exists from the provided inputs.
 */
export async function snapshotFileIfExists(
  sourcePath: string,
  snapshotPath: string,
): Promise<void> {
  const content = await readTextFileOrNull(sourcePath);

  if (content === null) {
    return;
  }

  await writeTextFile(snapshotPath, content);
}

/**
 * Writes json file with snapshot to project state.
 */
export async function writeJsonFileWithSnapshot(
  filePath: string,
  snapshotPath: string,
  value: unknown,
): Promise<void> {
  await snapshotFileIfExists(filePath, snapshotPath);
  await writeJsonFile(filePath, value);
}

/**
 * Writes json lines file with snapshot to project state.
 */
export async function writeJsonLinesFileWithSnapshot(
  filePath: string,
  snapshotPath: string,
  values: unknown[],
): Promise<void> {
  await snapshotFileIfExists(filePath, snapshotPath);
  await writeJsonLinesFile(filePath, values);
}

/**
 * Reads json lines file from project state.
 */
export async function readJsonLinesFile<T>(
  filePath: string,
  validator?: JsonValidator<T>,
): Promise<T[]> {
  if (!(await pathExists(filePath))) {
    return [];
  }

  const values: T[] = [];
  const fileStream = createReadStream(filePath, { encoding: "utf8" });
  const lineReader = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  let lineNumber = 0;

  try {
    for await (const rawLine of lineReader) {
      lineNumber += 1;
      const line = rawLine.trim();
      if (line.length === 0) {
        continue;
      }

      let parsedLine: unknown;

      try {
        parsedLine = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Invalid JSONL in ${toPosixPath(filePath)}:${lineNumber}: ${getErrorMessage(error)}`,
          { cause: error },
        );
      }

      if (validator) {
        const validate: JsonValidator<T> = validator;
        validate(parsedLine, `${toPosixPath(filePath)}:${lineNumber}`);
      }

      values.push(parsedLine as T);
    }
  } finally {
    lineReader.close();
    fileStream.destroy();
  }

  return values;
}

/**
 * Writes json lines file to project state.
 */
export async function writeJsonLinesFile(
  filePath: string,
  values: unknown[],
): Promise<void> {
  await ensureDirectory(dirname(filePath));
  const tempPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const chunkSizeBytes = 1_000_000;
  let chunk = "";

  try {
    await writeFile(tempPath, "", "utf8");

    for (const value of values) {
      const line = `${JSON.stringify(value)}\n`;
      if (
        chunk.length > 0 &&
        Buffer.byteLength(chunk) + Buffer.byteLength(line) > chunkSizeBytes
      ) {
        await appendFile(tempPath, chunk, "utf8");
        chunk = "";
      }
      chunk += line;
    }

    if (chunk.length > 0) {
      await appendFile(tempPath, chunk, "utf8");
    }

    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

/**
 * Provides copy path for the lifecycle pipeline.
 */
export async function copyPath(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  await ensureDirectory(dirname(destinationPath));
  await cp(sourcePath, destinationPath, { recursive: true, force: true });
}

/**
 * Creates directory link for use by the lifecycle pipeline.
 */
export async function createDirectoryLink(
  linkPath: string,
  targetPath: string,
): Promise<void> {
  if (!(await pathEntryExists(targetPath))) {
    throw new Error(
      `Cannot create directory link because target does not exist: ${toPosixPath(targetPath)}`,
    );
  }

  if (await pathEntryExists(linkPath)) {
    throw new Error(
      `Cannot create managed directory link because the destination already exists: ${toPosixPath(linkPath)}`,
    );
  }

  await ensureDirectory(dirname(linkPath));
  await symlink(
    targetPath,
    linkPath,
    process.platform === "win32" ? "junction" : "dir",
  );
}

/**
 * Provides replace directory link for the lifecycle pipeline.
 */
export async function replaceDirectoryLink(
  linkPath: string,
  targetPath: string,
): Promise<void> {
  const temporaryLinkPath = `${linkPath}.next`;

  if (await pathEntryExists(temporaryLinkPath)) {
    await removePath(temporaryLinkPath);
  }

  await createDirectoryLink(temporaryLinkPath, targetPath);

  if (await pathEntryExists(linkPath)) {
    await removePath(linkPath);
  }

  await ensureDirectory(dirname(linkPath));
  await rename(temporaryLinkPath, linkPath);
}

/**
 * Provides remove path for the lifecycle pipeline.
 */
export async function removePath(targetPath: string): Promise<void> {
  await rm(targetPath, { recursive: true, force: true });
}

/**
 * Ensures ensure clean directory exists or is ready for use.
 */
export async function ensureCleanDirectory(
  directoryPath: string,
): Promise<void> {
  await removePath(directoryPath);
  await ensureDirectory(directoryPath);
}

/**
 * Creates content hash for use by the lifecycle pipeline.
 */
export function createContentHash(content: string | Buffer): string {
  return typeof content === "string"
    ? createHash("sha256").update(content, "utf8").digest("hex")
    : createHash("sha256").update(content).digest("hex");
}

/**
 * Provides upsert managed section for the lifecycle pipeline.
 */
export function upsertManagedSection(options: {
  originalContent: string;
  markerId: string;
  bodyLines: string[];
}): string {
  const { originalContent, markerId, bodyLines } = options;
  const beginMarker = `<!-- ${markerId}:begin -->`;
  const endMarker = `<!-- ${markerId}:end -->`;
  const sectionContent = [beginMarker, ...bodyLines, endMarker].join("\n");
  const sectionPattern = new RegExp(
    `${escapeRegExp(beginMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`,
    "u",
  );

  if (sectionPattern.test(originalContent)) {
    return originalContent.replace(sectionPattern, sectionContent);
  }

  const trimmedOriginalContent = originalContent.trimEnd();
  return trimmedOriginalContent.length > 0
    ? `${trimmedOriginalContent}\n\n${sectionContent}\n`
    : `${sectionContent}\n`;
}

/**
 * Provides remove managed section for the lifecycle pipeline.
 */
export function removeManagedSection(options: {
  originalContent: string;
  markerId: string;
}): string {
  const { originalContent, markerId } = options;
  const beginMarker = `<!-- ${markerId}:begin -->`;
  const endMarker = `<!-- ${markerId}:end -->`;
  const sectionPattern = new RegExp(
    `\n?${escapeRegExp(beginMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}\n?`,
    "u",
  );

  if (!sectionPattern.test(originalContent)) {
    return originalContent;
  }

  return originalContent.replace(sectionPattern, "\n").trimEnd() + "\n";
}

async function isUsableDirectoryPath(directoryPath: string): Promise<boolean> {
  try {
    const entry = await lstat(directoryPath);
    if (entry.isDirectory()) {
      return true;
    }
    if (!entry.isSymbolicLink()) {
      return false;
    }

    return (await stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Provides to posix path for the lifecycle pipeline.
 */
export function toPosixPath(filePath: string): string {
  return filePath.split(sep).join("/");
}

/**
 * Provides to relative posix path for the lifecycle pipeline.
 */
export function toRelativePosixPath(
  rootPath: string,
  filePath: string,
): string {
  return toPosixPath(relative(rootPath, filePath));
}

/**
 * Provides count non empty lines for the lifecycle pipeline.
 */
export function countNonEmptyLines(content: string): number {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

/**
 * Describes scan budget options data exchanged by the lifecycle pipeline.
 */
export interface ScanBudgetOptions {
  maxDepth?: number;
  maxFiles?: number;
  maxBytes?: number;
}

interface IgnorePattern {
  raw: string;
  normalized: string;
  directoryOnly: boolean;
  basenameOnly: boolean;
  negated: boolean;
  regex: RegExp;
}

/**
 * Describes scan budget telemetry data exchanged by the lifecycle pipeline.
 */
export interface ScanBudgetTelemetry {
  visitedFiles: number;
  visitedBytes: number;
  truncated: boolean;
  truncationReason?: string;
}

/**
 * Provides list files recursive for the lifecycle pipeline.
 */
export async function listFilesRecursive(
  rootPath: string,
  ignoredDirectoryNames: ReadonlySet<string> = DEFAULT_IGNORED_DIRECTORY_NAMES,
  budgetOptions: ScanBudgetOptions = {},
): Promise<string[]> {
  return listFilesRecursiveWithTelemetry(
    rootPath,
    ignoredDirectoryNames,
    budgetOptions,
  ).then((result) => result.files);
}

/**
 * Provides list files recursive with telemetry for the lifecycle pipeline.
 */
export async function listFilesRecursiveWithTelemetry(
  rootPath: string,
  ignoredDirectoryNames: ReadonlySet<string> = DEFAULT_IGNORED_DIRECTORY_NAMES,
  budgetOptions: ScanBudgetOptions = {},
): Promise<{ files: string[]; telemetry: ScanBudgetTelemetry }> {
  const runtimeBudget = getRuntimeConfig().scan;
  const telemetry: ScanBudgetTelemetry = {
    visitedFiles: 0,
    visitedBytes: 0,
    truncated: false,
  };
  const ignorePatterns = await loadIgnorePatterns(rootPath);
  const files = await collectFilesFromDirectory(
    rootPath,
    rootPath,
    ignoredDirectoryNames,
    ignorePatterns,
    {
      maxDepth: budgetOptions.maxDepth ?? runtimeBudget.maxDepth,
      maxFiles: budgetOptions.maxFiles ?? runtimeBudget.maxFiles,
      maxBytes: budgetOptions.maxBytes ?? runtimeBudget.maxBytes,
    },
    telemetry,
    0,
  );
  telemetry.truncated =
    telemetry.truncated || Boolean(telemetry.truncationReason);

  return { files, telemetry };
}

async function collectFilesFromDirectory(
  rootPath: string,
  directoryPath: string,
  ignoredDirectoryNames: ReadonlySet<string>,
  ignorePatterns: IgnorePattern[],
  budgetOptions: Required<ScanBudgetOptions>,
  telemetry: ScanBudgetTelemetry,
  depth: number,
): Promise<string[]> {
  if (telemetry.truncated) {
    return [];
  }

  if (depth > budgetOptions.maxDepth) {
    telemetry.truncated = true;
    telemetry.truncationReason ??= "max-depth";
    return [];
  }

  const entries = await readdir(directoryPath, { withFileTypes: true });
  const collectedFiles: string[] = [];
  const fileEntries: Array<{ entryPath: string; relativeEntryPath: string }> =
    [];
  const directoryEntries: Array<{ entryPath: string }> = [];

  for (const entry of entries) {
    if (telemetry.truncated) {
      break;
    }

    const entryPath = `${directoryPath}${sep}${entry.name}`;
    const relativeEntryPath = toRelativePosixPath(rootPath, entryPath);

    if (entry.isDirectory()) {
      if (
        shouldSkipDefaultIgnoredDirectory(
          relativeEntryPath,
          entry.name,
          ignoredDirectoryNames,
        ) ||
        shouldSkipIgnoredDirectory(
          relativeEntryPath,
          entry.name,
          ignorePatterns,
        )
      ) {
        continue;
      }

      directoryEntries.push({ entryPath });
      continue;
    }

    if (entry.isFile()) {
      if (
        isIgnoredByPattern(relativeEntryPath, entry.name, false, ignorePatterns)
      ) {
        continue;
      }

      fileEntries.push({ entryPath, relativeEntryPath });
    }
  }

  const fileStats = await mapWithConcurrency(
    fileEntries,
    FILE_STAT_CONCURRENCY,
    async (fileEntry) => {
      if (telemetry.truncated) {
        return null;
      }

      const stats = await lstat(fileEntry.entryPath).catch(() => null);
      return stats?.isFile() ? { ...fileEntry, size: stats.size } : null;
    },
  );

  for (const fileStat of fileStats) {
    if (telemetry.truncated) {
      break;
    }
    if (fileStat === null) {
      continue;
    }

    telemetry.visitedFiles += 1;
    telemetry.visitedBytes += fileStat.size;

    if (telemetry.visitedFiles > budgetOptions.maxFiles) {
      telemetry.truncated = true;
      telemetry.truncationReason = "max-files";
      break;
    }

    if (telemetry.visitedBytes > budgetOptions.maxBytes) {
      telemetry.truncated = true;
      telemetry.truncationReason = "max-bytes";
      break;
    }

    collectedFiles.push(fileStat.entryPath);
  }

  for (const directoryEntry of directoryEntries) {
    if (telemetry.truncated) {
      break;
    }

    if (depth + 1 > budgetOptions.maxDepth) {
      telemetry.truncationReason ??= "max-depth";
      continue;
    }

    const nestedFiles = await collectFilesFromDirectory(
      rootPath,
      directoryEntry.entryPath,
      ignoredDirectoryNames,
      ignorePatterns,
      budgetOptions,
      telemetry,
      depth + 1,
    );
    collectedFiles.push(...nestedFiles);
  }

  return collectedFiles;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += concurrency) {
    results.push(
      ...(await Promise.all(
        values.slice(index, index + concurrency).map(task),
      )),
    );
  }
  return results;
}

function shouldSkipDefaultIgnoredDirectory(
  relativeEntryPath: string,
  entryName: string,
  ignoredDirectoryNames: ReadonlySet<string>,
): boolean {
  return (
    ignoredDirectoryNames.has(entryName) ||
    ignoredDirectoryNames.has(relativeEntryPath)
  );
}

async function loadIgnorePatterns(rootPath: string): Promise<IgnorePattern[]> {
  const ignoreFileNames = [".agent-harnessignore", ".gitignore", ".ignore"];
  const patterns: IgnorePattern[] = [];

  for (const ignoreFileName of ignoreFileNames) {
    const content = await readTextFileOrNull(
      `${rootPath}${sep}${ignoreFileName}`,
    );
    if (!content) {
      continue;
    }

    patterns.push(...parseIgnorePatterns(content));
  }

  return patterns;
}

function parseIgnorePatterns(content: string): IgnorePattern[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const negated = line.startsWith("!");
      const patternText = negated ? line.slice(1) : line;
      const directoryOnly = patternText.endsWith("/");
      const normalized = patternText
        .replace(/^\/+|\/+$/gu, "")
        .replace(/\\/gu, "/");
      return {
        raw: line,
        normalized,
        directoryOnly,
        basenameOnly: !normalized.includes("/"),
        negated,
        regex: globPatternToRegExp(normalized),
      };
    })
    .filter((pattern) => pattern.normalized.length > 0);
}

function isIgnoredByPattern(
  relativePath: string,
  basenameValue: string,
  isDirectory: boolean,
  patterns: IgnorePattern[],
): boolean {
  let ignored = false;

  for (const pattern of patterns) {
    if (
      !matchesIgnorePattern(relativePath, basenameValue, isDirectory, pattern)
    ) {
      continue;
    }

    ignored = !pattern.negated;
  }

  return ignored;
}

function shouldSkipIgnoredDirectory(
  relativePath: string,
  basenameValue: string,
  patterns: IgnorePattern[],
): boolean {
  return (
    isIgnoredByPattern(relativePath, basenameValue, true, patterns) &&
    !patterns.some(
      (pattern) =>
        pattern.negated &&
        !pattern.basenameOnly &&
        patternMayMatchDescendant(pattern, relativePath),
    )
  );
}

function matchesIgnorePattern(
  relativePath: string,
  basenameValue: string,
  isDirectory: boolean,
  pattern: IgnorePattern,
): boolean {
  if (pattern.directoryOnly && !isDirectory) {
    return false;
  }

  if (pattern.basenameOnly) {
    return pattern.regex.test(basenameValue);
  }

  if (pattern.regex.test(relativePath)) {
    return true;
  }

  if (pattern.normalized.endsWith("/**")) {
    return relativePath === pattern.normalized.slice(0, -3);
  }

  return false;
}

function patternMayMatchDescendant(
  pattern: IgnorePattern,
  relativeDirectoryPath: string,
): boolean {
  const literalPrefix = pattern.normalized
    .split(/[?*]/u)[0]
    .replace(/\/+$/u, "");
  return (
    pattern.normalized === relativeDirectoryPath ||
    pattern.normalized.startsWith(`${relativeDirectoryPath}/`) ||
    literalPrefix === relativeDirectoryPath ||
    literalPrefix.startsWith(`${relativeDirectoryPath}/`)
  );
}

function globPatternToRegExp(pattern: string): RegExp {
  let expression = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const nextCharacter = pattern[index + 1];

    if (character === "*" && nextCharacter === "*") {
      expression += ".*";
      index += 1;
      continue;
    }

    if (character === "*") {
      expression += "[^/]*";
      continue;
    }

    if (character === "?") {
      expression += "[^/]";
      continue;
    }

    expression += escapeRegExp(character);
  }

  return new RegExp(`${expression}$`, "u");
}
