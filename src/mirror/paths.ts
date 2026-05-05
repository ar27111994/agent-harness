import { resolve } from "node:path";

import {
  resolveDefaultClaudeCodeConfigRoot,
  resolveDefaultCursorConfigRoot,
  resolveDefaultOpenCodeConfigRoot,
  resolveHomeRelativePath,
} from "../lib/paths.js";
import {
  resolveAllowedAbsolutePath,
  resolveAllowedRealFilePath,
  sanitizeMirrorId,
} from "../lib/safe-paths.js";

/**
 * Re-exports mirror identifier sanitization for mirror path callers.
 */
export { sanitizeMirrorId };

/**
 * Builds mirror evidence allowed roots from the provided inputs.
 */
export function buildMirrorEvidenceAllowedRoots(
  projectRoot: string,
  workingDirectory: string,
): string[] {
  return [
    projectRoot,
    workingDirectory,
    resolveHomeRelativePath("~/.agents/skills"),
    resolveDefaultOpenCodeConfigRoot(),
    resolveDefaultClaudeCodeConfigRoot(),
    resolveDefaultCursorConfigRoot(),
  ].map((rootPath) => resolve(rootPath));
}

/**
 * Resolves allowed mirror evidence file path from the provided inputs.
 */
export function resolveAllowedMirrorEvidenceFilePath(
  filePath: string,
  allowedRoots: readonly string[],
): string | null {
  return resolveAllowedAbsolutePath(filePath, allowedRoots);
}

/**
 * Resolves allowed mirror evidence file path for read from the provided inputs.
 */
export async function resolveAllowedMirrorEvidenceFilePathForRead(
  filePath: string,
  allowedRoots: readonly string[],
): Promise<string | null> {
  return resolveAllowedRealFilePath(filePath, allowedRoots);
}
