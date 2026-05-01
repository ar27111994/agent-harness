import { homedir } from "node:os";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

import { getRuntimeConfig } from "../config/runtime.js";

export function resolveHomeRelativePath(pathValue: string): string {
  if (pathValue === "~") {
    return homedir();
  }

  if (pathValue.startsWith(`~${sep}`) || pathValue.startsWith("~/")) {
    return join(homedir(), pathValue.slice(2));
  }

  return pathValue;
}

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

export function toHomeRelativePath(pathValue: string): string {
  const homeDirectory = homedir();
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

export function resolveDefaultOpenCodeConfigRoot(): string {
  return join(homedir(), ".config", "opencode");
}
