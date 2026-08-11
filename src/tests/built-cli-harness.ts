import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Defines repository root for built CLI test harnesses.
 */
export const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(import.meta.url))),
);

/**
 * Defines built CLI entrypoint for test harnesses.
 */
export const builtCliPath = join(repositoryRoot, "dist", "cli.js");

/**
 * Creates isolated workspace/state roots and host config directories for CLI tests.
 */
export async function createIsolatedCliEnvironment(
  tempRoot: string,
  options: {
    createStateRoot?: boolean;
  } = {},
): Promise<{
  workspaceRoot: string;
  stateRoot: string;
  env: NodeJS.ProcessEnv;
}> {
  const workspaceRoot = join(tempRoot, "workspace");
  const stateRoot = join(tempRoot, "state");
  const homeRoot = join(tempRoot, "home");
  const appDataRoot = join(tempRoot, "appdata");
  const xdgConfigRoot = join(tempRoot, "xdg");

  await mkdir(workspaceRoot, { recursive: true });
  if (options.createStateRoot ?? true) {
    await mkdir(stateRoot, { recursive: true });
  }
  await mkdir(
    resolveVsCodeSettingsDirectory(homeRoot, appDataRoot, xdgConfigRoot),
    {
      recursive: true,
    },
  );
  await mkdir(resolveOpenCodeDirectory(homeRoot, appDataRoot, xdgConfigRoot), {
    recursive: true,
  });

  return {
    workspaceRoot,
    stateRoot,
    env: {
      ...process.env,
      // Prevent spawned CLI subprocesses from inheriting c8's V8-coverage
      // output directory: their independently-recorded coverage re-enters
      // the c8 merge with different column ranges, producing duplicate
      // DA records on the same line (one hit, one zero) that the gate
      // counts as missed lines across ~every module the CLI imports.
      NODE_V8_COVERAGE: undefined,
      AGENT_HARNESS_HOME: homeRoot,
      AGENT_HARNESS_STATE_ROOT: stateRoot,
      APPDATA: appDataRoot,
      HOME: homeRoot,
      USERPROFILE: homeRoot,
      XDG_CONFIG_HOME: xdgConfigRoot,
    },
  };
}

/**
 * Runs the built CLI with a stable test harness configuration.
 */
export async function runBuiltCli(options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  args: string[];
  stateRoot?: string;
  timeout?: number;
}): Promise<{ stdout: string; stderr: string }> {
  const prefixedArgs = ["--no-dotenv"];
  if (options.stateRoot) {
    prefixedArgs.push("--state-root", options.stateRoot);
  }

  const result = await execFileAsync(
    process.execPath,
    [builtCliPath, ...prefixedArgs, ...options.args],
    {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: 5_000_000,
      timeout: options.timeout ?? 120_000,
      windowsHide: true,
      encoding: "utf8",
    },
  );

  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}

/**
 * Runs the built CLI expecting a non-zero exit and returns exit code plus
 * captured output. execFile rejects on non-zero exits, so the rejection is
 * converted into a structured result.
 */
export async function runCliExpectFailure(
  args: string[],
  options: { cwd?: string } = {},
): Promise<BuiltCliRunResult> {
  const cwd = options.cwd ?? repositoryRoot;
  try {
    await execFileAsync(
      process.execPath,
      [builtCliPath, "--no-dotenv", ...args],
      {
        cwd,
        env: {
          ...process.env,
          NODE_V8_COVERAGE: undefined,
          AGENT_HARNESS_TEST_FETCH_MOCKS: "1",
        },
        timeout: 60_000,
        maxBuffer: 5_000_000,
        windowsHide: true,
        encoding: "utf8",
      },
    );
    assert.fail(`expected non-zero exit for args: ${args.join(" ")}`);
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    assert.ok(
      typeof failure.code === "number" && failure.code !== 0,
      `args ${args.join(" ")} must exit non-zero`,
    );
    return {
      exitCode: failure.code ?? 1,
      stdout: String(failure.stdout ?? ""),
      stderr: String(failure.stderr ?? ""),
    };
  }
}

/**
 * Runs the built CLI expecting a zero exit and returns stdout.
 */
export async function runCliExpectSuccess(
  args: string[],
  options: { cwd?: string } = {},
): Promise<string> {
  const cwd = options.cwd ?? repositoryRoot;
  const result = await execFileAsync(
    process.execPath,
    [builtCliPath, "--no-dotenv", ...args],
    {
      cwd,
      env: {
        ...process.env,
        NODE_V8_COVERAGE: undefined,
        AGENT_HARNESS_TEST_FETCH_MOCKS: "1",
      },
      timeout: 60_000,
      maxBuffer: 5_000_000,
      windowsHide: true,
      encoding: "utf8",
    },
  );
  return String(result.stdout);
}

/**
 * Describes a structured built-CLI failure result.
 */
export interface BuiltCliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function resolveVsCodeSettingsDirectory(
  homeRoot: string,
  appDataRoot: string,
  xdgConfigRoot: string,
): string {
  if (process.platform === "win32") {
    return join(appDataRoot, "Code", "User");
  }

  if (process.platform === "darwin") {
    return join(homeRoot, "Library", "Application Support", "Code", "User");
  }

  return join(xdgConfigRoot, "Code", "User");
}

function resolveOpenCodeDirectory(
  homeRoot: string,
  appDataRoot: string,
  xdgConfigRoot: string,
): string {
  if (process.platform === "win32") {
    return join(appDataRoot, "opencode");
  }

  if (process.platform === "darwin") {
    return join(homeRoot, "Library", "Application Support", "opencode");
  }

  return join(xdgConfigRoot, "opencode");
}
