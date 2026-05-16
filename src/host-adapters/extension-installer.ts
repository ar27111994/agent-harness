import { execFile } from "node:child_process";
import { extname } from "node:path";
import { promisify } from "node:util";

import { getRuntimeConfig } from "../config/runtime.js";
import type { AssetCatalogEntry } from "../types.js";

const execFileAsync = promisify(execFile);

/**
 * Defines the supported extension install operation values.
 */
export type ExtensionInstallOperation = "install" | "verify" | "remove";

/**
 * Describes extension install action data exchanged by the lifecycle pipeline.
 */
export interface ExtensionInstallAction {
  host: string;
  extensionId: string;
  executable: string;
  installArgs: string[];
  verifyArgs: string[];
  removeArgs: string[];
  command: string;
  verifyCommand: string;
  removeCommand: string;
}

/**
 * Describes native install result data exchanged by the lifecycle pipeline.
 */
export interface NativeInstallResult {
  host: string;
  extensionId: string;
  operation: ExtensionInstallOperation;
  success: boolean;
  installed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  message: string;
}

/**
 * Describes native command result data exchanged by the lifecycle pipeline.
 */
export interface NativeCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Defines the supported native command executor values.
 */
export type NativeCommandExecutor = (
  executable: string,
  args: string[],
) => Promise<NativeCommandResult>;

const VS_CODE_EXTENSION_ID_PATTERN =
  /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/iu;

/**
 * Builds vs code extension install actions from the provided inputs.
 */
export function buildVsCodeExtensionInstallActions(
  extensionIds: string[],
): ExtensionInstallAction[] {
  return buildExtensionInstallActions({
    extensionIds,
    executable: "code",
    host: "copilot-vscode",
  });
}

/**
 * Builds extension install actions from the provided inputs.
 */
export function buildExtensionInstallActions(options: {
  extensionIds: string[];
  executable: string;
  host: string;
}): ExtensionInstallAction[] {
  return options.extensionIds
    .filter(isValidVsCodeExtensionId)
    .map((extensionId) => {
      const installArgs = ["--install-extension", extensionId];
      const verifyArgs = ["--list-extensions", "--show-versions"];
      const removeArgs = ["--uninstall-extension", extensionId];

      return {
        host: options.host,
        extensionId,
        executable: options.executable,
        installArgs,
        verifyArgs,
        removeArgs,
        command: formatCommand(options.executable, installArgs),
        verifyCommand: formatCommand(options.executable, verifyArgs),
        removeCommand: formatCommand(options.executable, removeArgs),
      };
    });
}

/**
 * Returns whether the provided value matches valid vs code extension id.
 */
export function isValidVsCodeExtensionId(extensionId: string): boolean {
  return VS_CODE_EXTENSION_ID_PATTERN.test(extensionId);
}

/**
 * Resolves vs code extension id from the provided inputs.
 */
export function resolveVsCodeExtensionId(
  asset: AssetCatalogEntry,
): string | undefined {
  const candidates = [asset.install.manifestEntry, asset.id];
  return candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && isValidVsCodeExtensionId(candidate),
  );
}

/**
 * Formats extension install actions for user-facing output.
 */
export function formatExtensionInstallActions(
  actions: ExtensionInstallAction[],
): string[] {
  return actions.map(
    (action) =>
      `${action.host}:${action.extensionId} install=${quoteFormattedCommand(action.command)} verify=${quoteFormattedCommand(action.verifyCommand)} remove=${quoteFormattedCommand(action.removeCommand)}`,
  );
}

/**
 * Executes execute extension install action through the configured runtime executor.
 */
export async function executeExtensionInstallAction(
  action: ExtensionInstallAction,
  operation: ExtensionInstallOperation,
  executor: NativeCommandExecutor = executeNativeCommand,
): Promise<NativeInstallResult> {
  if (operation === "verify") {
    return verifyExtensionInstallAction(action, executor, true);
  }

  const args = operation === "install" ? action.installArgs : action.removeArgs;
  const commandResult = await executor(action.executable, args);
  if (commandResult.exitCode !== 0) {
    return {
      host: action.host,
      extensionId: action.extensionId,
      operation,
      success: false,
      installed: false,
      exitCode: commandResult.exitCode,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
      message: `${operation} command failed for ${action.extensionId}`,
    };
  }

  const verifyResult = await verifyExtensionInstallAction(
    action,
    executor,
    operation === "install",
  );
  return {
    ...verifyResult,
    operation,
    stdout: [commandResult.stdout, verifyResult.stdout]
      .filter((value) => value.length > 0)
      .join("\n"),
    stderr: [commandResult.stderr, verifyResult.stderr]
      .filter((value) => value.length > 0)
      .join("\n"),
  };
}

/**
 * Verifies verify extension install action using host runtime output.
 */
export async function verifyExtensionInstallAction(
  action: ExtensionInstallAction,
  executor: NativeCommandExecutor = executeNativeCommand,
  expectedInstalled = true,
): Promise<NativeInstallResult> {
  const commandResult = await executor(action.executable, action.verifyArgs);
  const installed =
    commandResult.exitCode === 0 &&
    verifyVsCodeExtensionInstalled(commandResult.stdout, action.extensionId);
  const success =
    commandResult.exitCode === 0 && installed === expectedInstalled;

  return {
    host: action.host,
    extensionId: action.extensionId,
    operation: "verify",
    success,
    installed,
    exitCode: commandResult.exitCode,
    stdout: commandResult.stdout,
    stderr: commandResult.stderr,
    message: success
      ? `${action.extensionId} is ${installed ? "installed" : "not installed"}`
      : `${action.extensionId} is ${installed ? "installed" : "not installed"}; expected ${expectedInstalled ? "installed" : "absent"}`,
  };
}

/**
 * Verifies verify vs code extension installed using host runtime output.
 */
export function verifyVsCodeExtensionInstalled(
  listExtensionsOutput: string,
  extensionId: string,
): boolean {
  const normalizedExtensionId = extensionId.toLowerCase();
  return listExtensionsOutput
    .split(/\r?\n/u)
    .map((line) => line.trim().split("@")[0]?.toLowerCase() ?? "")
    .some((lineExtensionId) => lineExtensionId === normalizedExtensionId);
}

async function executeNativeCommand(
  executable: string,
  args: string[],
): Promise<NativeCommandResult> {
  let lastError: unknown = null;

  for (const candidateExecutable of buildExecutableCandidates(executable)) {
    try {
      const hostCommandConfig = getRuntimeConfig().hostCommands;
      const result = await execFileAsync(candidateExecutable, args, {
        shell: shouldRunCandidateThroughShell(candidateExecutable),
        windowsHide: true,
        timeout: hostCommandConfig.nativeTimeoutMs,
        maxBuffer: hostCommandConfig.nativeMaxBufferBytes,
      });
      return {
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      lastError = error;
      const execError = error as Error & { code?: number | string };
      if (execError.code === "ENOENT") {
        continue;
      }
      return toNativeCommandResult(execError);
    }
  }

  return toNativeCommandResult(lastError);
}

function shouldRunCandidateThroughShell(candidateExecutable: string): boolean {
  const extension = extname(candidateExecutable).toLowerCase();
  return (
    process.platform === "win32" &&
    (extension === ".cmd" || extension === ".bat")
  );
}

function buildExecutableCandidates(executable: string): string[] {
  if (process.platform !== "win32" || extname(executable).length > 0) {
    return [executable];
  }

  return [
    executable,
    `${executable}.cmd`,
    `${executable}.exe`,
    `${executable}.bat`,
  ];
}

function toNativeCommandResult(error: unknown): NativeCommandResult {
  const execError = error as Error & {
    code?: number | string;
    stdout?: string;
    stderr?: string;
  };
  return {
    exitCode:
      typeof execError?.code === "number"
        ? execError.code
        : Number.MAX_SAFE_INTEGER,
    stdout: execError?.stdout ?? "",
    stderr: execError?.stderr ?? execError?.message ?? String(error),
  };
}

function formatCommand(executable: string, args: string[]): string {
  return [executable, ...args].map(formatCommandToken).join(" ");
}

function formatCommandToken(value: string): string {
  return /^[A-Za-z0-9._:/=-]+$/u.test(value)
    ? value
    : quoteFormattedCommand(value);
}

function quoteFormattedCommand(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * Exposes pure extension-installer helpers for focused behavioral coverage.
 */
export const extensionInstallerInternals = {
  buildExecutableCandidates,
  formatCommand,
  shouldRunCandidateThroughShell,
  toNativeCommandResult,
};
