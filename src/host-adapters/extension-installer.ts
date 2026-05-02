import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { AssetCatalogEntry } from "../types.js";

const execFileAsync = promisify(execFile);

export type ExtensionInstallOperation = "install" | "verify" | "remove";

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

export interface NativeCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type NativeCommandExecutor = (
  executable: string,
  args: string[],
) => Promise<NativeCommandResult>;

const VS_CODE_EXTENSION_ID_PATTERN =
  /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/iu;

export function buildVsCodeExtensionInstallActions(
  extensionIds: string[],
): ExtensionInstallAction[] {
  return extensionIds.filter(isValidVsCodeExtensionId).map((extensionId) => {
    const executable = "code";
    const installArgs = ["--install-extension", extensionId];
    const verifyArgs = ["--list-extensions", "--show-versions"];
    const removeArgs = ["--uninstall-extension", extensionId];

    return {
      host: "copilot-vscode",
      extensionId,
      executable,
      installArgs,
      verifyArgs,
      removeArgs,
      command: formatCommand(executable, installArgs),
      verifyCommand: formatCommand(executable, verifyArgs),
      removeCommand: formatCommand(executable, removeArgs),
    };
  });
}

export function isValidVsCodeExtensionId(extensionId: string): boolean {
  return VS_CODE_EXTENSION_ID_PATTERN.test(extensionId);
}

export function resolveVsCodeExtensionId(
  asset: AssetCatalogEntry,
): string | undefined {
  const candidates = [asset.install.manifestEntry, asset.id];
  return candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && isValidVsCodeExtensionId(candidate),
  );
}

export function formatExtensionInstallActions(
  actions: ExtensionInstallAction[],
): string[] {
  return actions.map(
    (action) =>
      `${action.host}:${action.extensionId} install=${quoteFormattedCommand(action.command)} verify=${quoteFormattedCommand(action.verifyCommand)} remove=${quoteFormattedCommand(action.removeCommand)}`,
  );
}

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
  try {
    const result = await execFileAsync(executable, args, {
      shell: false,
      windowsHide: true,
    });
    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const execError = error as Error & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode:
        typeof execError.code === "number"
          ? execError.code
          : Number.MAX_SAFE_INTEGER,
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? execError.message,
    };
  }
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
