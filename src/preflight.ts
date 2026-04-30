import { access } from "node:fs/promises";

import { loadRuntimeConfig } from "./config/runtime.js";
import { toPosixPath } from "./files.js";
import type { HostTarget } from "./types.js";

export interface PreflightDiagnostic {
  scope: string;
  level: "info" | "warning" | "error";
  message: string;
}

export async function runPreflightChecks(options: {
  host?: HostTarget;
  mode: "preview" | "apply" | "reset" | "workspace";
}): Promise<PreflightDiagnostic[]> {
  const diagnostics: PreflightDiagnostic[] = [];
  const config = loadRuntimeConfig();

  diagnostics.push({
    scope: "config",
    level: "info",
    message: `Using home directory ${toPosixPath(config.paths.homeDirectory)}`,
  });

  if (options.host === "copilot-vscode") {
    diagnostics.push({
      scope: "vscode",
      level: "info",
      message: `VS Code user settings path resolves to ${toPosixPath(
        config.paths.vsCodeUserSettingsPath,
      )}`,
    });
  }

  if (options.mode === "apply" || options.mode === "workspace") {
    await checkWritableHome(config.paths.homeDirectory, diagnostics);
  }

  return diagnostics;
}

export function printPreflightDiagnostics(
  diagnostics: PreflightDiagnostic[],
): void {
  for (const diagnostic of diagnostics) {
    console.log(
      `[${diagnostic.level}] ${diagnostic.scope}: ${diagnostic.message}`,
    );
  }
}

async function checkWritableHome(
  homeDirectory: string,
  diagnostics: PreflightDiagnostic[],
): Promise<void> {
  try {
    await access(homeDirectory);
  } catch {
    diagnostics.push({
      scope: "filesystem",
      level: "error",
      message: `Home directory is not accessible: ${toPosixPath(homeDirectory)}`,
    });
  }
}
