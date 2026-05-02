import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";

import { getRuntimeConfig } from "../config/runtime.js";
import type {
  HostAdapter,
  HostRuntimeSpec,
} from "../host-adapters/registry.js";
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

/**
 * Runs adapter-specific readiness checks such as optional host CLI detection.
 */
export async function runAdapterPreflight(
  adapter: HostAdapter,
): Promise<PreflightDiagnostic[]> {
  if (!adapter.runtime) {
    return [];
  }

  return [
    await checkExecutableOnPath(
      adapter.runtime.executable,
      `${adapter.id}-cli`,
      "warning",
      adapter.runtime.guidance,
    ),
  ];
}

/**
 * Runs runtime checks required before native install operations execute.
 */
export async function runNativeInstallPreflight(
  adapter: HostAdapter,
): Promise<PreflightDiagnostic[]> {
  const diagnostics = await runAdapterRuntimePreflight(
    adapter.runtime,
    adapter.id,
    true,
  );
  if (!adapter.nativeInstall) {
    diagnostics.push({
      severity: "error",
      code: `${adapter.id}-native-install-unsupported`,
      message: `${adapter.displayName} does not expose a native install provider.`,
      action:
        "Use wire preview/apply for project-local assets or choose a host with native install support.",
    });
  }

  return diagnostics;
}

async function runAdapterRuntimePreflight(
  runtime: HostRuntimeSpec | undefined,
  adapterId: string,
  required: boolean,
): Promise<PreflightDiagnostic[]> {
  if (!runtime) {
    return required
      ? [
          {
            severity: "error",
            code: `${adapterId}-runtime-unconfigured`,
            message: `No runtime executable is configured for ${adapterId}.`,
          },
        ]
      : [];
  }

  return [
    await checkExecutableOnPath(
      runtime.executable,
      `${adapterId}-cli`,
      required ? "error" : "warning",
      runtime.guidance,
    ),
  ];
}

/**
 * Runs lifecycle-host preflight checks, optionally enforcing writable host
 * paths for operations that mutate host-native settings.
 */
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

/**
 * Builds a diagnostic that reports whether a host executable is available.
 */
export async function checkExecutableOnPath(
  executableName: string,
  code: string,
  missingSeverity: PreflightSeverity = "warning",
  guidance?: string,
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
    severity: missingSeverity,
    code,
    message: `${executableName} was not found on PATH.`,
    action:
      guidance ??
      "Install the host CLI or ensure it is available on PATH if you want runtime readiness validation beyond project-local file wiring.",
  };
}

/**
 * Searches PATH for an executable, honoring PATHEXT on Windows.
 */
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

/**
 * Checks file-system accessibility for a path with the requested access mode.
 */
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
