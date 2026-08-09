import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Provides sanitize mirror id for the lifecycle pipeline.
 */
export function sanitizeMirrorId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-");
}

/**
 * Provides sanitize asset id for the lifecycle pipeline.
 */
export function sanitizeAssetId(value: string): string {
  const base =
    replaceRunsWithDash(value, isSafeAssetIdCharacter).replace(
      /^-+|-+$/gu,
      "",
    ) || "asset";
  const suffix = createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `${base}-${suffix}`;
}

/**
 * Returns whether the character is safe to keep verbatim in a sanitized
 * asset id.
 */
function isSafeAssetIdCharacter(character: string): boolean {
  return /[a-zA-Z0-9_-]/u.test(character);
}

/**
 * Replaces each maximal run of characters for which `isAllowed` returns
 * false with a single "-" (linear, no regex backtracking).
 *
 * Equivalent to `value.replace(/[^...]+/g, "-")` for a single class, but a
 * regex with a `+` over a negated character class is flagged by CodeQL as a
 * polynomial-reDoS risk on adversarial input; a plain one-character-at-a-time
 * scan is unconditionally linear.
 */
export function replaceRunsWithDash(
  value: string,
  isAllowed: (character: string) => boolean,
): string {
  let result = "";
  let inRun = false;

  for (const character of value) {
    if (isAllowed(character)) {
      result += character;
      inRun = false;
    } else if (!inRun) {
      result += "-";
      inRun = true;
    }
  }

  return result;
}

/**
 * Returns whether the provided value matches path within root.
 */
export function isPathWithinRoot(
  rootPath: string,
  targetPath: string,
): boolean {
  const resolvedRoot = resolve(rootPath);
  const resolvedTarget = resolve(targetPath);
  const relativeTarget = relative(resolvedRoot, resolvedTarget);

  return (
    relativeTarget === "" ||
    (relativeTarget !== ".." &&
      !relativeTarget.startsWith(`..${sep}`) &&
      !isAbsolute(relativeTarget))
  );
}

/**
 * Resolves safe mirror file path from the provided inputs.
 */
export function resolveSafeMirrorFilePath(
  rawRoot: string,
  relativePath: string,
  operation: "read" | "write" = "write",
): string {
  const resolvedRoot = resolve(rawRoot);
  const resolvedTarget = resolve(resolvedRoot, relativePath);
  const relativeTarget = relative(resolvedRoot, resolvedTarget);

  if (
    relativeTarget.length === 0 ||
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error(
      `Refusing to ${operation} mirrored artifact outside raw root: ${relativePath}`,
    );
  }

  return resolvedTarget;
}

/**
 * Resolves allowed absolute path from the provided inputs.
 */
export function resolveAllowedAbsolutePath(
  pathValue: string,
  allowedRoots: readonly string[],
): string | null {
  const trimmedPath = pathValue.trim();
  if (trimmedPath.length === 0 || !isAbsolute(trimmedPath)) {
    return null;
  }

  const resolvedPath = resolve(trimmedPath);
  return allowedRoots.some((rootPath) =>
    isPathWithinRoot(rootPath, resolvedPath),
  )
    ? resolvedPath
    : null;
}

/**
 * Resolves allowed real file path from the provided inputs.
 */
export async function resolveAllowedRealFilePath(
  pathValue: string,
  allowedRoots: readonly string[],
): Promise<string | null> {
  const resolvedPath = resolveAllowedAbsolutePath(pathValue, allowedRoots);
  if (!resolvedPath) {
    return null;
  }

  const pathStats = await lstat(resolvedPath).catch(() => null);
  if (!pathStats?.isFile() || pathStats.isSymbolicLink()) {
    return null;
  }

  const [realTargetPath, realRootPaths] = await Promise.all([
    realpath(resolvedPath).catch(() => null),
    Promise.all(
      allowedRoots.map((rootPath) => realpath(rootPath).catch(() => null)),
    ),
  ]);

  if (!realTargetPath) {
    return null;
  }

  return realRootPaths.some(
    (realRootPath) =>
      realRootPath !== null && isPathWithinRoot(realRootPath, realTargetPath),
  )
    ? realTargetPath
    : null;
}
