import {
  access,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, relative, sep } from "node:path";
import { createHash } from "node:crypto";

import { getRuntimeConfig } from "./config/runtime.js";

export const DEFAULT_IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".idea",
  ".next",
  ".nuxt",
  ".tmp",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
  ".cache",
  ".gradle",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".terraform",
  ".venv",
  "DerivedData",
  "Library",
  "Pods",
  "bin",
  "obj",
  "target",
  "venv",
]);

export type JsonValidator<T> = (
  value: unknown,
  context: string,
) => asserts value is T;

export function resolveProjectRoot(scriptFilePath: string): string {
  const scriptDirectory = dirname(scriptFilePath);
  const directoryName = basename(scriptDirectory);

  if (directoryName === "dist" || directoryName === "src") {
    return dirname(scriptDirectory);
  }

  return scriptDirectory;
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function pathEntryExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
}

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

export async function readJsonFileOrNull<T>(
  filePath: string,
  validator?: JsonValidator<T>,
): Promise<T | null> {
  if (!(await pathExists(filePath))) {
    return null;
  }

  return readJsonFile<T>(filePath, validator);
}

export async function readTextFileOrNull(
  filePath: string,
): Promise<string | null> {
  if (!(await pathExists(filePath))) {
    return null;
  }

  return readFile(filePath, "utf8");
}

export async function writeJsonFile(
  filePath: string,
  value: unknown,
): Promise<void> {
  await ensureDirectory(dirname(filePath));
  const json = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filePath, json, "utf8");
}

export async function writeTextFile(
  filePath: string,
  value: string,
): Promise<void> {
  await ensureDirectory(dirname(filePath));
  await writeFile(filePath, value, "utf8");
}

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

export async function writeJsonFileWithSnapshot(
  filePath: string,
  snapshotPath: string,
  value: unknown,
): Promise<void> {
  await snapshotFileIfExists(filePath, snapshotPath);
  await writeJsonFile(filePath, value);
}

export async function writeJsonLinesFileWithSnapshot(
  filePath: string,
  snapshotPath: string,
  values: unknown[],
): Promise<void> {
  await snapshotFileIfExists(filePath, snapshotPath);
  await writeJsonLinesFile(filePath, values);
}

export async function readJsonLinesFile<T>(
  filePath: string,
  validator?: JsonValidator<T>,
): Promise<T[]> {
  const content = await readTextFileOrNull(filePath);

  if (!content) {
    return [];
  }

  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      let parsedLine: unknown;

      try {
        parsedLine = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Invalid JSONL in ${toPosixPath(filePath)}:${index + 1}: ${getErrorMessage(error)}`,
          { cause: error },
        );
      }

      if (validator) {
        const validate: JsonValidator<T> = validator;
        validate(parsedLine, `${toPosixPath(filePath)}:${index + 1}`);
      }

      return parsedLine as T;
    });
}

export async function writeJsonLinesFile(
  filePath: string,
  values: unknown[],
): Promise<void> {
  const serializedContent = values
    .map((value) => JSON.stringify(value))
    .join("\n");
  await writeTextFile(
    filePath,
    serializedContent.length > 0 ? `${serializedContent}\n` : "",
  );
}

export async function copyPath(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  await ensureDirectory(dirname(destinationPath));
  await cp(sourcePath, destinationPath, { recursive: true, force: true });
}

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

export async function removePath(targetPath: string): Promise<void> {
  await rm(targetPath, { recursive: true, force: true });
}

export async function ensureCleanDirectory(
  directoryPath: string,
): Promise<void> {
  await removePath(directoryPath);
  await ensureDirectory(directoryPath);
}

export function createContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

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
  return originalContent.replace(sectionPattern, "\n").trimEnd() + "\n";
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

export function toPosixPath(filePath: string): string {
  return filePath.split(sep).join("/");
}

export function toRelativePosixPath(
  rootPath: string,
  filePath: string,
): string {
  return toPosixPath(relative(rootPath, filePath));
}

export function countNonEmptyLines(content: string): number {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

export interface ScanBudgetOptions {
  maxDepth?: number;
  maxFiles?: number;
  maxBytes?: number;
}

export interface ScanBudgetTelemetry {
  visitedFiles: number;
  visitedBytes: number;
  truncated: boolean;
  truncationReason?: string;
}

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
  const files = await collectFilesFromDirectory(
    rootPath,
    ignoredDirectoryNames,
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
  directoryPath: string,
  ignoredDirectoryNames: ReadonlySet<string>,
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

  for (const entry of entries) {
    if (telemetry.truncated) {
      break;
    }

    const entryPath = `${directoryPath}${sep}${entry.name}`;

    if (entry.isDirectory()) {
      if (ignoredDirectoryNames.has(entry.name)) {
        continue;
      }

      if (depth + 1 > budgetOptions.maxDepth) {
        telemetry.truncationReason ??= "max-depth";
        continue;
      }

      const nestedFiles = await collectFilesFromDirectory(
        entryPath,
        ignoredDirectoryNames,
        budgetOptions,
        telemetry,
        depth + 1,
      );
      collectedFiles.push(...nestedFiles);
      continue;
    }

    if (entry.isFile()) {
      const fileStat = await lstat(entryPath);
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

      collectedFiles.push(entryPath);
    }
  }

  return collectedFiles;
}
