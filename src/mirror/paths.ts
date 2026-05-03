import { resolve } from "node:path";

import {
  resolveDefaultOpenCodeConfigRoot,
  resolveHomeRelativePath,
} from "../lib/paths.js";
import {
  resolveAllowedAbsolutePath,
  sanitizeMirrorId,
} from "../lib/safe-paths.js";

export { sanitizeMirrorId };

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
