import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

import { loadRuntimeConfig } from "../config/runtime.js";
import { toPosixPath } from "../files.js";

export function resolvePortablePath(
  value: string | undefined,
  projectRoot: string,
): string {
  if (!value) {
    return projectRoot;
  }

  const homeDirectory = loadRuntimeConfig().paths.homeDirectory;
  const expandedValue = value
    .replace(/^~(?=$|[\\/])/u, homeDirectory)
    .replace(/\$\{HOME\}/gu, homeDirectory)
    .replace(/%USERPROFILE%/giu, homeDirectory);

  return isAbsolute(expandedValue)
    ? normalize(expandedValue)
    : join(projectRoot, expandedValue);
}

export function toHomeRelativePath(pathValue: string): string {
  const homeDirectory = loadRuntimeConfig().paths.homeDirectory;
  const relativePath = relative(homeDirectory, resolve(pathValue));

  if (relativePath === "") {
    return "~";
  }

  if (!relativePath.startsWith("..") && !isAbsolute(relativePath)) {
    return `~/${toPosixPath(relativePath)}`;
  }

  return toPosixPath(pathValue).split(sep).join("/");
}

export function isPathInsideRoot(pathValue: string, rootPath: string): boolean {
  const relativePath = relative(resolve(rootPath), resolve(pathValue));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}
