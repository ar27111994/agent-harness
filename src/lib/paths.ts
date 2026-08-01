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
 * Normalizes an MSYS/Cygwin-style Windows path (e.g. /c/Projects/foo) to a
 * native Windows path (C:\\Projects\\foo). No-op on non-Windows platforms
 * and on paths that don't match the MSYS pattern.
 *
 * Ticket: #397 — MSYS path mangling of --state-root.
 */
export function normalizeMsysPath(
  pathValue: string,
  platform?: string,
): string {
  if ((platform ?? process.platform) !== "win32") return pathValue;
  return convertMsysToWindowsPath(pathValue);
}

/**
 * Converts an MSYS-style path to a native Windows path.
 * Exported for testing — use normalizeMsysPath for production use.
 */
export function convertMsysToWindowsPath(pathValue: string): string {
  const match = pathValue.match(/^\/([a-zA-Z])(\/|$)/u);
  if (!match) return pathValue;
  const drive = `${match[1].toUpperCase()}:`;
  // Bare drive letter (e.g. /c) → C:\
  if (match[2] === "") return drive;
  return `${drive}${pathValue.slice(2).replace(/\//g, "\\")}`;
}

/**
 * Resolves portable path from the provided inputs.
 * On Windows, normalises MSYS-style paths (/c/X → C:\\X) before resolution.
 */
export function resolvePortablePath(
  pathValue: string | undefined,
  projectRoot: string,
): string {
  if (!pathValue || pathValue.length === 0) {
    return projectRoot;
  }

  const expandedValue = resolveHomeRelativePath(normalizeMsysPath(pathValue));
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

/**
 * Resolves default Claude Code config root from the provided inputs.
 */
export function resolveDefaultClaudeCodeConfigRoot(): string {
  return join(getRuntimeConfig().paths.homeDirectory, ".claude");
}

/**
 * Resolves default Cursor config root from the provided inputs.
 */
export function resolveDefaultCursorConfigRoot(): string {
  return join(getRuntimeConfig().paths.homeDirectory, ".cursor");
}
