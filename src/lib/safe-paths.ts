import { isAbsolute, relative, resolve, sep } from "node:path";

export function sanitizeMirrorId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-");
}

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
