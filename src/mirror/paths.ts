import { resolve } from "node:path";

import { resolveDefaultOpenCodeConfigRoot, resolveHomeRelativePath } from "../lib/paths.js";
import { resolveAllowedAbsolutePath } from "../lib/safe-paths.js";

export function buildMirrorEvidenceAllowedRoots(
  projectRoot: string,
  workingDirectory: string,
): string[] {
  return [
    projectRoot,
    workingDirectory,
    resolveHomeRelativePath("~/.agents/skills"),
    resolveDefaultOpenCodeConfigRoot(),
  ].map((rootPath) => resolve(rootPath));
}

export function resolveAllowedMirrorEvidenceFilePath(
  filePath: string,
  allowedRoots: readonly string[],
): string | null {
  return resolveAllowedAbsolutePath(filePath, allowedRoots);
}

export function sanitizeMirrorId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-");
}
