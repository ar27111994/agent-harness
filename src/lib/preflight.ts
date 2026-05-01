import { access } from "node:fs/promises";
import { join } from "node:path";

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

export async function runHostPreflight(
  host: string,
): Promise<PreflightDiagnostic[]> {
  const diagnostics = await runConfigPreflight();

  if (host === "copilot-vscode") {
    diagnostics.push(
      await checkPathExists(
        join(resolveVsCodeUserSettingsPath(), ".."),
        "vscode-user-settings-directory",
      ),
      {
        severity: "info",
        code: "vscode-native-install-boundary",
        message:
          "VS Code wire-in stages curated agent assets and settings, but native extension installation is handled by the extension installer flow.",
      },
    );
  }

  if (host === "opencode") {
    diagnostics.push(
      await checkPathExists(
        resolveDefaultOpenCodeConfigRoot(),
        "opencode-config-directory",
      ),
      {
        severity: "info",
        code: "opencode-project-overlay",
        message:
          "OpenCode wire-in writes a project-local .opencode overlay and managed links.",
      },
    );
  }

  return diagnostics;
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

export async function checkPathExists(
  pathValue: string,
  code: string,
): Promise<PreflightDiagnostic> {
  try {
    await access(pathValue);
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
