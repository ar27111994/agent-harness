import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(import.meta.url))),
);
const cliPath = join(repositoryRoot, "dist", "cli.js");
const hosts = ["vscode", "opencode", "cursor", "zed", "claude-code", "pi"];

const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-cli-smoke-"));
try {
  const workspaceRoot = join(tempRoot, "workspace");
  const stateRoot = join(tempRoot, "state");
  const homeRoot = join(tempRoot, "home");
  const appDataRoot = join(tempRoot, "appdata");
  const xdgConfigRoot = join(tempRoot, "xdg");

  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(stateRoot, { recursive: true });
  await mkdir(
    resolveVsCodeSettingsDirectory(homeRoot, appDataRoot, xdgConfigRoot),
    {
      recursive: true,
    },
  );
  await mkdir(resolveOpenCodeDirectory(homeRoot, appDataRoot, xdgConfigRoot), {
    recursive: true,
  });

  const env = {
    ...process.env,
    AGENT_HARNESS_STATE_ROOT: stateRoot,
    APPDATA: appDataRoot,
    HOME: homeRoot,
    USERPROFILE: homeRoot,
    XDG_CONFIG_HOME: xdgConfigRoot,
  };

  await runCli(workspaceRoot, env, ["setup", "hosts"]);
  await runCli(workspaceRoot, env, ["install", "native", "--host", "vscode"]);

  for (const host of hosts) {
    await runCli(workspaceRoot, env, ["wire", host, "--preview"]);
    await runCli(workspaceRoot, env, ["wire", host, "--apply"]);
    await runCli(workspaceRoot, env, ["wire", host, "--reset"]);
  }

  console.log(`CLI smoke completed with isolated workspace ${workspaceRoot}`);
} finally {
  await rm(tempRoot, { force: true, recursive: true });
}

async function runCli(
  cwd: string,
  env: NodeJS.ProcessEnv,
  args: string[],
): Promise<void> {
  await execFileAsync(process.execPath, [cliPath, "--no-dotenv", ...args], {
    cwd,
    env,
    maxBuffer: 5_000_000,
    timeout: 120_000,
    windowsHide: true,
  });
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
