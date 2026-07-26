import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, dirname, join, win32 } from "node:path";

import { getRuntimeConfig } from "../config/runtime.js";
import type {
  HostAdapter,
  HostRuntimeSpec,
} from "../host-adapters/registry.js";
import {
  resolveDefaultOpenCodeConfigRoot,
  resolveVsCodeUserSettingsPath,
} from "./paths.js";

/**
 * Defines the supported preflight severity values.
 */
export type PreflightSeverity = "info" | "warning" | "error";

/**
 * Describes preflight diagnostic data exchanged by the lifecycle pipeline.
 */
export interface PreflightDiagnostic {
  severity: PreflightSeverity;
  code: string;
  message: string;
  action?: string;
}

/**
 * Dispatches the config preflight CLI command group.
 */
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
  abortSignal?: AbortSignal,
): Promise<PreflightDiagnostic[]> {
  // Short-circuit when cumulative timeout has already fired.
  if (abortSignal?.aborted) {
    return [
      {
        severity: "warning",
        code: `${adapter.id}-preflight-skipped`,
        message:
          "Preflight check skipped — cumulative timeout already expired.",
      },
    ];
  }
  return runAdapterRuntimePreflight(
    adapter.runtime,
    adapter.id,
    false,
    abortSignal,
  );
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
  abortSignal?: AbortSignal,
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

  const executableDiagnostic = await checkExecutableOnPath(
    runtime.executable,
    `${adapterId}-cli`,
    required ? "error" : "warning",
    runtime.guidance,
  );
  const diagnostics = [executableDiagnostic];

  if (executableDiagnostic.severity !== "info") {
    return diagnostics;
  }

  if (runtime.versionArgs?.length) {
    diagnostics.push(
      await checkRuntimeCommand({
        executable: runtime.executable,
        args: runtime.versionArgs,
        code: `${adapterId}-version`,
        failureSeverity: required ? "error" : "warning",
        successMessage: `${runtime.executable} version command completed successfully.`,
        failureAction:
          runtime.guidance ??
          "Confirm the host CLI is installed correctly and can report its version.",
        abortSignal,
      }),
    );
  }

  if (runtime.readinessArgs?.length) {
    diagnostics.push(
      await checkRuntimeCommand({
        executable: runtime.executable,
        args: runtime.readinessArgs,
        code: `${adapterId}-readiness`,
        failureSeverity: required ? "error" : "warning",
        successMessage: `${runtime.executable} readiness command completed successfully.`,
        failureAction:
          runtime.guidance ??
          "Sign in to the host CLI and confirm marketplace/runtime access is available.",
        abortSignal,
      }),
    );
  }

  return diagnostics;
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

/**
 * Validates unknown data as no preflight errors.
 */
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

/**
 * Formats preflight diagnostics for user-facing output.
 */
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
interface FindExecutableOptions {
  accessPath?: typeof access;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

function getExecutableSearchExtensions(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  return platform === "win32"
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
        .split(";")
        .filter((entry) => entry.length > 0)
    : [""];
}

function getExecutableAccessMode(platform: NodeJS.Platform): number {
  return platform === "win32" ? constants.F_OK : constants.X_OK;
}

async function findExecutableOnPath(
  executableName: string,
  options: FindExecutableOptions = {},
): Promise<string | null> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const accessPath = options.accessPath ?? access;
  const pathDelimiter = platform === "win32" ? win32.delimiter : delimiter;
  const joinPath = platform === "win32" ? win32.join : join;
  const pathEntries = (env.PATH ?? "")
    .split(pathDelimiter)
    .filter((entry) => entry.length > 0);
  const extensions = getExecutableSearchExtensions(platform, env);
  const accessMode = getExecutableAccessMode(platform);

  for (const pathEntry of pathEntries) {
    for (const extension of extensions) {
      const candidate = joinPath(pathEntry, `${executableName}${extension}`);
      try {
        await accessPath(candidate, accessMode);
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
interface RuntimeCommandCheckOptions {
  executable: string;
  args: string[];
  code: string;
  failureSeverity: PreflightSeverity;
  successMessage: string;
  failureAction: string;
}

async function checkRuntimeCommand(
  options: RuntimeCommandCheckOptions & { abortSignal?: AbortSignal },
): Promise<PreflightDiagnostic> {
  const result = await runRuntimeCommand(
    options.executable,
    options.args,
    options.abortSignal,
  );
  if (result.exitCode === 0) {
    return {
      severity: "info",
      code: options.code,
      message: options.successMessage,
    };
  }

  return {
    severity: options.failureSeverity,
    code: options.code,
    message: `${options.executable} ${options.args.join(" ")} failed: ${result.message}`,
    action: options.failureAction,
  };
}

async function runRuntimeCommand(
  executable: string,
  args: string[],
  abortSignal?: AbortSignal,
): Promise<{ exitCode: number | null; message: string }> {
  // Short-circuit when already aborted — don't spawn at all.
  if (abortSignal?.aborted) {
    return { exitCode: null, message: "cancelled by cumulative timeout" };
  }

  const timeoutMs = getRuntimeConfig().hostCommands.preflightTimeoutMs;
  const resolvedExecutable = await resolveRuntimeExecutable(executable);
  const spawnSpec = buildRuntimeCommandSpawnSpec({
    args,
    executable,
    platform: process.platform,
    resolvedExecutable,
  });

  return new Promise((resolve) => {
    const child = spawn(spawnSpec.executable, spawnSpec.args, {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
      signal: abortSignal,
    });
    let settled = false;
    let stderr = "";
    const finish = (exitCode: number | null, message: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, message });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(null, `timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(0, 2_000);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(null, error.code ?? error.message);
    });
    child.on("close", (exitCode) => {
      finish(exitCode, stderr.trim() || `exit code ${String(exitCode)}`);
    });
  });
}

async function resolveRuntimeExecutable(
  executable: string,
  platform: NodeJS.Platform = process.platform,
  findExecutable: typeof findExecutableOnPath = findExecutableOnPath,
): Promise<string> {
  if (platform !== "win32") {
    return executable;
  }

  return resolveFoundExecutable(
    executable,
    await findExecutable(executable, { platform }),
  );
}

function resolveFoundExecutable(
  executable: string,
  foundExecutable: string | null,
): string {
  return foundExecutable ?? executable;
}

interface RuntimeCommandSpawnSpecOptions {
  executable: string;
  args: string[];
  resolvedExecutable: string;
  platform?: NodeJS.Platform;
}

function buildRuntimeCommandSpawnSpec(
  options: RuntimeCommandSpawnSpecOptions,
): { executable: string; args: string[] } {
  const platform = options.platform ?? process.platform;
  const isWindowsShellWrapper =
    platform === "win32" && /\.(?:cmd|bat)$/iu.test(options.resolvedExecutable);

  if (!isWindowsShellWrapper) {
    return {
      executable: options.resolvedExecutable,
      args: options.args,
    };
  }

  // We intentionally avoid `shell: true` here because Windows wrapper paths
  // with spaces (notably VS Code's `code.cmd`) were misparsed during real-host
  // validation. PowerShell preserves the executable path and argv boundaries
  // while still invoking `.cmd` / `.bat` wrappers reliably.
  return {
    executable: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      buildWindowsPowerShellCommand(options.executable, options.args),
    ],
  };
}

function buildWindowsPowerShellCommand(
  executable: string,
  args: string[],
): string {
  const quotedExecutable = quotePowerShellLiteral(executable);
  const quotedArgs = args.map((argument) => quotePowerShellLiteral(argument));
  return [`& ${quotedExecutable}`, ...quotedArgs].join(" ");
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

/**
 * Provides check path exists for the lifecycle pipeline.
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

/**
 * Exposes focused preflight helpers for deterministic platform-branch tests.
 */
export const preflightInternals = {
  buildRuntimeCommandSpawnSpec,
  buildWindowsPowerShellCommand,
  findExecutableOnPath,
  getExecutableAccessMode,
  getExecutableSearchExtensions,
  quotePowerShellLiteral,
  resolveFoundExecutable,
  resolveRuntimeExecutable,
  runRuntimeCommand,
};
