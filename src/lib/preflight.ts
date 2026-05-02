import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";

import { getRuntimeConfig } from "../config/runtime.js";
import {
  resolveDefaultOpenCodeConfigRoot,
  resolveVsCodeUserSettingsPath,
} from "./paths.js";

export type PreflightSeverity = "info" | "warning" | "error";

export interface PreflightDiagnostic {
  severity: PreflightSeverity;
  code: string;
  message: string;
  action?: string;
}

export async function runConfigPreflight(): Promise<PreflightDiagnostic[]> {
  const diagnostics: PreflightDiagnostic[] = [];
  const config = getRuntimeConfig();

  if (!config.github.token) {
    diagnostics.push({
      severity: "info",
      code: "github-token-optional",
      message:
        "No GitHub token is configured; unauthenticated GitHub requests may be rate limited.",
      action:
        "Set GITHUB_PERSONAL_ACCESS_TOKEN or GITHUB_TOKEN for higher discovery throughput.",
    });
  }

  return diagnostics;
}

export async function runAdapterPreflight(
  adapterId: string,
): Promise<PreflightDiagnostic[]> {
  const executableByAdapter: Record<string, string> = {
    "copilot-vscode": "code",
    opencode: "opencode",
    cursor: "cursor",
    zed: "zed",
    "claude-code": "claude",
    pi: "pi",
  };
  const executableName = executableByAdapter[adapterId];

  if (!executableName) {
    return [];
  }

  return [await checkExecutableOnPath(executableName, `${adapterId}-cli`)];
}

export async function runHostPreflight(
  host: string,
  options: { requireHostPaths?: boolean } = {},
): Promise<PreflightDiagnostic[]> {
  const diagnostics = await runConfigPreflight();

  if (host === "copilot-vscode") {
    const requireHostPaths = options.requireHostPaths ?? false;
    if (requireHostPaths) {
      diagnostics.push(
        requireDiagnostic(
          await checkPathExists(
            dirname(resolveVsCodeUserSettingsPath()),
            "vscode-user-settings-directory",
            constants.W_OK,
          ),
          true,
        ),
      );
    }
    diagnostics.push({
      severity: "info",
      code: "vscode-native-install-boundary",
      message:
        "VS Code wire-in stages curated agent assets and settings, but native extension installation is handled by the extension installer flow.",
    });
  }

  if (host === "opencode") {
    const requireHostPaths = options.requireHostPaths ?? false;
    if (requireHostPaths) {
      diagnostics.push(
        requireDiagnostic(
          await checkPathExists(
            resolveDefaultOpenCodeConfigRoot(),
            "opencode-config-directory",
            constants.W_OK,
          ),
          true,
        ),
      );
    }
    diagnostics.push({
      severity: "info",
      code: "opencode-project-overlay",
      message:
        "OpenCode wire-in writes a project-local .opencode overlay and managed links.",
    });
  }

  return diagnostics;
}

function requireDiagnostic(
  diagnostic: PreflightDiagnostic,
  required: boolean,
): PreflightDiagnostic {
  if (required && diagnostic.severity === "warning") {
    return {
      ...diagnostic,
      severity: "error",
    };
  }

  return diagnostic;
}

export function assertNoPreflightErrors(
  diagnostics: PreflightDiagnostic[],
): void {
  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (errors.length === 0) {
    return;
  }

  throw new Error(formatPreflightDiagnostics(errors));
}

export function formatPreflightDiagnostics(
  diagnostics: PreflightDiagnostic[],
): string {
  return diagnostics
    .map((diagnostic) => {
      const action = diagnostic.action ? ` Action: ${diagnostic.action}` : "";
      return `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${action}`;
    })
    .join("\n");
}

async function checkExecutableOnPath(
  executableName: string,
  code: string,
): Promise<PreflightDiagnostic> {
  const executablePath = await findExecutableOnPath(executableName);
  if (executablePath) {
    return {
      severity: "info",
      code,
      message: `Found ${executableName} at ${executablePath}.`,
    };
  }

  return {
    severity: "warning",
    code,
    message: `${executableName} was not found on PATH.`,
    action:
      "Install the host CLI or ensure it is available on PATH if you want runtime readiness validation beyond project-local file wiring.",
  };
}

async function findExecutableOnPath(
  executableName: string,
): Promise<string | null> {
  const pathEntries = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((entry) => entry.length > 0);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .filter((entry) => entry.length > 0)
      : [""];

  for (const pathEntry of pathEntries) {
    for (const extension of extensions) {
      const candidate = join(pathEntry, `${executableName}${extension}`);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }

  return null;
}

export async function checkPathExists(
  pathValue: string,
  code: string,
  mode = constants.F_OK,
): Promise<PreflightDiagnostic> {
  try {
    await access(pathValue, mode);
    return {
      severity: "info",
      code,
      message: `Found ${pathValue}.`,
    };
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode && errorCode !== "ENOENT") {
      return {
        severity: "error",
        code,
        message: `Unable to access ${pathValue}: ${errorCode}.`,
        action:
          "Check permissions and confirm the path is readable by the current user.",
      };
    }

    return {
      severity: "warning",
      code,
      message: `Expected path was not found: ${pathValue}.`,
      action:
        "Install the host or run setup after the host has created its user configuration directory.",
    };
  }
}
