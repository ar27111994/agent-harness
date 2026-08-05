import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(import.meta.url))),
);
const npmCliPath = process.env.npm_execpath;

const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-pack-smoke-"));
let packedTarballPath: string | null = null;
try {
  const packResult = await runNpm(["pack", "--json", "--ignore-scripts"], {
    cwd: repositoryRoot,
    maxBuffer: 10_000_000,
    timeout: 120_000,
    windowsHide: true,
  });
  const packedFiles = JSON.parse(packResult.stdout) as Array<{
    filename: string;
  }>;
  const packedFileName = packedFiles[0]?.filename;
  if (!packedFileName) {
    throw new Error("npm pack did not report a tarball filename");
  }

  packedTarballPath = resolve(repositoryRoot, packedFileName);
  const workspaceRoot = join(tempRoot, "workspace");
  const stateRoot = join(tempRoot, "state");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(stateRoot, { recursive: true });

  await runNpm(["init", "-y"], {
    cwd: workspaceRoot,
    maxBuffer: 5_000_000,
    timeout: 120_000,
    windowsHide: true,
  });
  await runNpm(["install", packedTarballPath, "--ignore-scripts"], {
    cwd: workspaceRoot,
    maxBuffer: 10_000_000,
    timeout: 120_000,
    windowsHide: true,
  });

  const installedCli = join(
    workspaceRoot,
    "node_modules",
    "@ar27111994",
    "agent-harness",
    "dist",
    "cli.js",
  );
  await execFileAsync(
    process.execPath,
    [installedCli, "--no-dotenv", "--state-root", stateRoot, "setup", "hosts"],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        AGENT_HARNESS_STATE_ROOT: stateRoot,
      },
      maxBuffer: 5_000_000,
      timeout: 120_000,
      windowsHide: true,
    },
  );

  console.log(`Pack smoke installed and executed ${packedTarballPath}`);
} finally {
  await rm(tempRoot, { force: true, recursive: true });
  if (packedTarballPath) {
    await rm(packedTarballPath, { force: true });
  }
}

async function runNpm(
  args: string[],
  options: Parameters<typeof execFileAsync>[2],
): Promise<{ stdout: string; stderr: string }> {
  const strippedOptions = {
    ...(options ?? {}),
    env: {
      ...((options?.env as NodeJS.ProcessEnv | undefined) ?? process.env),
    },
  };
  const result = npmCliPath
    ? await execFileAsync(process.execPath, [npmCliPath, ...args], {
        ...strippedOptions,
        encoding: "utf8",
      })
    : await execFileAsync(
        process.platform === "win32" ? "npm.cmd" : "npm",
        args,
        {
          ...strippedOptions,
          encoding: "utf8",
          shell: process.platform === "win32",
        },
      );

  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}
