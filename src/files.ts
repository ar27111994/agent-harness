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
  ".worktrees",
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
    if (!(await shouldIgnoreEnsureDirectoryError(directoryPath, error))) {
      throw error;
    }
  }
}

/**
 * Reads json file from project state.
 */
export async function readJsonFile<T>(
  filePath: string,
  validator?: JsonValidator<T>,
): Promise<T> {
  const content = (await readFileWithTransientRetry(
    filePath,
    "utf8",
  )) as string;
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
    return (await readFileWithTransientRetry(filePath, "utf8")) as string;
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
    return (await readFileWithTransientRetry(filePath)) as Buffer;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

/** Test-only hook for simulating filesystem failures in the atomic JSON writer. */
type RenameFile = (
  sourcePath: string,
  destinationPath: string,
) => Promise<void>;
let jsonWriteRenameOverride: RenameFile | undefined;

/** Test-only hook for simulating destination-removal failures (rm EPERM races). */
type RemoveFile = (path: string, options: { force?: boolean }) => Promise<void>;
let jsonWriteRemoveOverride: RemoveFile | undefined;

/**
 * Test-only hook for simulating open failures in the atomic-reader path
 * (#427/#428): readers retry the same Windows-transient window as the
 * writer, so the churn contract (old | absent | complete-new, never a
 * transient error) holds from both sides.
 */
type ReadFileOverride = (
  filePath: string,
  encoding?: BufferEncoding,
) => Promise<string | Buffer>;
let readFileOpenOverride: ReadFileOverride | undefined;

const WINDOWS_REPLACE_RETRY_BACKOFF_MS = 25;
const MAX_WINDOWS_REPLACE_RETRIES = 4;

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads a file with a bounded retry on Windows-transient open failures.
 *
 * The atomic writer (renameJsonWriteTemp) already retries EPERM/EACCES on
 * the destination during its remove-and-rename window; a concurrent READER
 * opening the same path can hit the same momentary lock (AV scan, open
 * handle, a competing writer's rename). Readers retry the identical bounded
 * window so the atomic-write contract is symmetric: a reader observes old |
 * absent | complete-new content — never a transient open error. ENOENT is
 * never retried: absent is part of the contract and the OrNull readers map
 * it to null unchanged.
 */
async function readFileWithTransientRetry(
  filePath: string,
  encoding?: BufferEncoding,
): Promise<string | Buffer> {
  let lastOpenFailure: unknown;

  for (let attempt = 0; attempt <= MAX_WINDOWS_REPLACE_RETRIES; attempt += 1) {
    try {
      if (readFileOpenOverride !== undefined) {
        return await readFileOpenOverride(filePath, encoding);
      }
      return await readFile(filePath, encoding ?? null);
    } catch (error) {
      const failingCode = (error as NodeJS.ErrnoException).code;
      if (failingCode !== "EPERM" && failingCode !== "EACCES") {
        throw error;
      }
      lastOpenFailure = error;
      if (attempt < MAX_WINDOWS_REPLACE_RETRIES) {
        await delay(WINDOWS_REPLACE_RETRY_BACKOFF_MS * 2 ** (attempt + 1));
      }
    }
  }

  throw lastOpenFailure;
}

/**
 * Renames a write-temp onto its final path.
 *
 * Windows replaces an existing destination with a single `rename` in the
 * common case, but a momentarily locked destination (AV scan, open handle,
 * or a concurrent writer's own rename — observed as EPERM/EACCES) needs a
 * bounded retry with a remove-and-retry fallback. Readers never observe
 * partial content: at every point the destination holds the old file, no
 * file, or the complete new file.
 */
async function renameJsonWriteTemp(
  tempPath: string,
  filePath: string,
): Promise<void> {
  let lastReplaceFailure: unknown;

  for (let attempt = 0; attempt <= MAX_WINDOWS_REPLACE_RETRIES; attempt += 1) {
    try {
      if (jsonWriteRenameOverride !== undefined) {
        await jsonWriteRenameOverride(tempPath, filePath);
      } else {
        await rename(tempPath, filePath);
      }
      return;
    } catch (error) {
      const failingCode = (error as NodeJS.ErrnoException).code;
      if (failingCode !== "EPERM" && failingCode !== "EACCES") {
        throw error;
      }
      lastReplaceFailure = error;

      if (attempt < MAX_WINDOWS_REPLACE_RETRIES) {
        // Windows quirk: rename over an existing file can fail with
        // EPERM/EACCES when the destination is momentarily locked (AV
        // scan, open handle, concurrent writer). Remove the destination
        // and retry after exponential backoff so the lock can clear;
        // the full window (~775ms) comfortably outlasts a rename burst
        // from concurrent writers on the same destination.
        try {
          const removeFile = jsonWriteRemoveOverride ?? rm;
          await removeFile(filePath, { force: true });
        } catch (rmError) {
          // The destination can be locked by a competing writer's handle;
          // the unlink itself then fails with EPERM/EACCES. That lock is
          // best-effort clearing — skip the removal and let the backoff +
          // rename retry below handle it.
          const rmCode = (rmError as NodeJS.ErrnoException).code;
          if (rmCode !== "EPERM" && rmCode !== "EACCES") {
            throw rmError;
          }
        }
        await delay(WINDOWS_REPLACE_RETRY_BACKOFF_MS * 2 ** (attempt + 1));
      }
    }
  }

  throw lastReplaceFailure;
}

/**
 * Writes json file to project state.
 *
 * Atomic by design (#427): content is written to a `.tmp` sibling and then
 * renamed over the destination, so a crash or power loss mid-write can never
 * leave a truncated/corrupt JSON state file. On failure the temp file is
 * removed before the error propagates.
 */
export async function writeJsonFile(
  filePath: string,
  value: unknown,
): Promise<void> {
  await ensureDirectory(dirname(filePath));
  const tempPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await renameJsonWriteTemp(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
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
  const values: T[] = [];
  let fileStream: ReturnType<typeof createReadStream> | undefined;
  let lineReader: ReturnType<typeof createInterface> | undefined;
  let lineNumber = 0;

  try {
    fileStream = createReadStream(filePath, { encoding: "utf8" });
    lineReader = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

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
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }
    throw error;
  } finally {
    lineReader?.close();
    fileStream?.destroy();
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
  let chunkByteLength = 0;

  try {
    await writeFile(tempPath, "", "utf8");

    for (const value of values) {
      const line = `${JSON.stringify(value)}\n`;
      const lineByteLength = Buffer.byteLength(line);
      if (
        chunk.length > 0 &&
        chunkByteLength + lineByteLength > chunkSizeBytes
      ) {
        await appendFile(tempPath, chunk, "utf8");
        chunk = "";
        chunkByteLength = 0;
      }
      chunk += line;
      chunkByteLength += lineByteLength;
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
  await symlink(targetPath, linkPath, getDirectorySymlinkType());
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

type DirectorySymlinkType = "dir" | "junction";

/**
 * File extensions that are almost never source-code and are likely to consume
 * large amounts of the byte budget without contributing any demand signals.
 * Files with these extensions are sorted *last* within each directory so that
 * source files are accounted for first.
 */
const BINARY_SCAN_DEPRIORITY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".bmp",
  ".tiff",
  ".tif",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".eot",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".webm",
  ".avi",
  ".mov",
  ".mkv",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".jar",
  ".war",
  ".ear",
  ".class",
  ".so",
  ".dylib",
  ".dll",
  ".exe",
  ".bin",
  ".dat",
  ".db",
  ".sqlite",
  // NOTE: .proto is intentionally NOT in this list — protobuf definitions are
  // signal-rich source inputs and must not be deprioritised under scan budgets.
  ".pb",
  ".parquet",
  ".pyc",
  ".pyd",
  ".pyo",
  ".o",
  ".a",
  ".lib",
  ".node",
  ".wasm",
]);

/**
 * Returns true when the file should be sorted *after* source-code files
 * during budget accounting so the byte budget is spent on signal-rich
 * content first.
 */
function isLowPriorityForScanBudget(entryPath: string): boolean {
  const dotIndex = entryPath.lastIndexOf(".");
  if (dotIndex === -1) {
    return false;
  }
  return BINARY_SCAN_DEPRIORITY_EXTENSIONS.has(
    entryPath.slice(dotIndex).toLowerCase(),
  );
}

interface PendingFileEntry {
  entryPath: string;
  relativeEntryPath: string;
}

interface CollectedFileStat extends PendingFileEntry {
  size: number;
}

interface FileLikeStats {
  isFile(): boolean;
  size: number;
}

function getDirectorySymlinkType(
  platform: NodeJS.Platform = process.platform,
): DirectorySymlinkType {
  return platform === "win32" ? "junction" : "dir";
}

function toCollectedFileStat(
  fileEntry: PendingFileEntry,
  stats: FileLikeStats | null,
): CollectedFileStat | null {
  return stats?.isFile() ? { ...fileEntry, size: stats.size } : null;
}

function compactCollectedFileStats(
  fileStats: Array<CollectedFileStat | null>,
): CollectedFileStat[] {
  return fileStats.flatMap((fileStat) => (fileStat ? [fileStat] : []));
}

async function shouldIgnoreEnsureDirectoryError(
  directoryPath: string,
  error: unknown,
): Promise<boolean> {
  const errorCode = (error as NodeJS.ErrnoException).code;
  return (
    (errorCode === "EEXIST" || errorCode === "EINVAL") &&
    (await isUsableDirectoryPath(directoryPath))
  );
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

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/**
 * Provides to posix path for the lifecycle pipeline.
 */
export function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/gu, "/").split(sep).join("/");
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
  const fileEntries: PendingFileEntry[] = [];
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

  const fileStats = compactCollectedFileStats(
    await mapWithConcurrency(
      fileEntries,
      FILE_STAT_CONCURRENCY,
      async (fileEntry) => {
        if (telemetry.truncated) {
          return null;
        }

        const stats = await lstat(fileEntry.entryPath).catch(() => null);
        return toCollectedFileStat(fileEntry, stats);
      },
    ),
  );

  // Sort so source/text files come before binary/asset files, ensuring the
  // byte budget is spent on signal-rich content first.
  fileStats.sort((left, right) => {
    const leftLow = isLowPriorityForScanBudget(left.entryPath) ? 1 : 0;
    const rightLow = isLowPriorityForScanBudget(right.entryPath) ? 1 : 0;
    const priorityDiff = leftLow - rightLow;
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    // Deterministic tie-breaker: stable lexicographic order by path ensures
    // scan truncation behaviour is reproducible across platforms/filesystems.
    // The `=== 0` case (identical paths) is unreachable in practice since a
    // filesystem directory cannot contain two entries at the exact same path.
    // c8 ignore: Node 22 V8 instruments nested ternary arms as separate branches;
    // the equal-path arm is structurally impossible from a real directory listing.
    /* c8 ignore next 5 */
    return left.entryPath < right.entryPath
      ? -1
      : left.entryPath > right.entryPath
        ? 1
        : 0;
  });

  for (const fileStat of fileStats) {
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

/**
 * Exposes narrow file-module internals for focused behavioral coverage.
 */
export const filesInternals = {
  shouldIgnoreEnsureDirectoryError,
  isUsableDirectoryPath,
  getDirectorySymlinkType,
  getErrorMessage,
  collectFilesFromDirectory,
  globPatternToRegExp,
  compactCollectedFileStats,
  toCollectedFileStat,
  isLowPriorityForScanBudget,
  BINARY_SCAN_DEPRIORITY_EXTENSIONS,
  renameJsonWriteTemp,
  /** Test-only: replaces the atomic-writer remove step (failure injection, #428). */
  setJsonWriteRemoveOverride(override: RemoveFile | undefined): void {
    jsonWriteRemoveOverride = override;
  },
  /** Test-only: replaces the atomic-writer rename step (failure injection, #427). */
  setJsonWriteRenameOverride(override: RenameFile | undefined): void {
    jsonWriteRenameOverride = override;
  },
  /** Test-only: replaces the atomic-reader open step (failure injection, #427/#428). */
  setReadFileOpenOverride(override: ReadFileOverride | undefined): void {
    readFileOpenOverride = override;
  },
};
