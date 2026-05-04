import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

import { getRuntimeConfig } from "../config/runtime.js";

/**
 * Resolves home relative path from the provided inputs.
 */
export function resolveHomeRelativePath(pathValue: string): string {
  if (pathValue === "~") {
    return getRuntimeConfig().paths.homeDirectory;
  }

  if (pathValue.startsWith(`~${sep}`) || pathValue.startsWith("~/")) {
    return join(getRuntimeConfig().paths.homeDirectory, pathValue.slice(2));
  }

  return pathValue;
}

/**
 * Resolves portable path from the provided inputs.
 */
export function resolvePortablePath(
  pathValue: string | undefined,
  projectRoot: string,
): string {
  if (!pathValue || pathValue.length === 0) {
    return projectRoot;
  }

  const expandedValue = resolveHomeRelativePath(pathValue);
  return isAbsolute(expandedValue)
    ? normalize(expandedValue)
    : resolve(projectRoot, expandedValue);
}

/**
 * Provides to home relative path for the lifecycle pipeline.
 */
export function toHomeRelativePath(pathValue: string): string {
  const homeDirectory = getRuntimeConfig().paths.homeDirectory;
  const normalizedPath = normalize(pathValue);
  const relativeToHome = relative(homeDirectory, normalizedPath);

  if (
    relativeToHome === "" ||
    (!relativeToHome.startsWith("..") && !isAbsolute(relativeToHome))
  ) {
    return relativeToHome === ""
      ? "~"
      : `~/${relativeToHome.split(sep).join("/")}`;
  }

  return normalizedPath.split(sep).join("/");
}

/**
 * Resolves vs code user settings path from the provided inputs.
 */
export function resolveVsCodeUserSettingsPath(): string {
  const config = getRuntimeConfig();

  if (process.platform === "win32") {
    return join(
      config.paths.appData ??
        join(config.paths.homeDirectory, "AppData", "Roaming"),
      "Code",
      "User",
      "settings.json",
    );
  }

  if (process.platform === "darwin") {
    return join(
      config.paths.homeDirectory,
      "Library",
      "Application Support",
      "Code",
      "User",
      "settings.json",
    );
  }

  return join(config.paths.xdgConfigHome, "Code", "User", "settings.json");
}

/**
 * Resolves default open code config root from the provided inputs.
 */
export function resolveDefaultOpenCodeConfigRoot(): string {
  const config = getRuntimeConfig();

  if (process.platform === "win32") {
    return join(
      config.paths.appData ??
        join(config.paths.homeDirectory, "AppData", "Roaming"),
      "opencode",
    );
  }

  if (process.platform === "darwin") {
    return join(
      config.paths.homeDirectory,
      "Library",
      "Application Support",
      "opencode",
    );
  }

  return join(config.paths.xdgConfigHome, "opencode");
}
