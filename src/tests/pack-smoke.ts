import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Single source of truth (package-audit doctrine): the packed-tarball entry
// list, the npm-pack payload normalizer, and the shell-less npm resolver all
// live in scripts/package-audit.mjs; require(esm) (Node >= 22.12) is the
// typed, suppression-free way for a TS test to consume them. Reusing
// `toPackRecordList` and `buildNpmInvocation` here keeps pack-smoke aligned
// with `release:package-audit` / `release:package-smoke`, which already pass.
const require = createRequire(import.meta.url);
const { REQUIRED_PACKED_FILES, toPackRecordList, buildNpmInvocation } =
  require("../../scripts/package-audit.mjs") as {
    REQUIRED_PACKED_FILES: readonly string[];
    toPackRecordList: (
      value: unknown,
    ) => Array<{ filename?: string; files?: Array<{ path: string }> }>;
    buildNpmInvocation: (
      args: string[],
      options?: Record<string, unknown>,
    ) => { command: string; commandArgs: string[]; shell: boolean };
  };

const execFileAsync = promisify(execFile);
const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(import.meta.url))),
);

const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-pack-smoke-"));
let packedTarballPath: string | null = null;
// Cold CI runners (Windows hosted agents with real-time AV scanning) can
// take well over two minutes on `npm install` of the packed tarball. The
// bounds below are hard anti-hang limits, set generous enough that a
// healthy run never trips them (review: 120s was flaked once on
// windows-latest while ubuntu/macos passed the same commit).
const NPM_STEP_TIMEOUT_MS = 300_000;
try {
  const packResult = await runNpm(["pack", "--json", "--ignore-scripts"], {
    cwd: repositoryRoot,
    maxBuffer: 10_000_000,
    timeout: NPM_STEP_TIMEOUT_MS,
    windowsHide: true,
  });
  // npm <12 emits an ARRAY of pack records; npm 12+ emits an OBJECT keyed by
  // package name (`{ "@scope/name": { filename, files, ... } }`). Normalize
  // both shapes through the single source of truth so the assert below stays
  // meaningful: it must still fail loudly when a pack yields no tarball.
  const packedFileName = toPackRecordList(JSON.parse(packResult.stdout))[0]
    ?.filename;
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
    timeout: NPM_STEP_TIMEOUT_MS,
    windowsHide: true,
  });
  await runNpm(["install", packedTarballPath, "--ignore-scripts"], {
    cwd: workspaceRoot,
    maxBuffer: 10_000_000,
    timeout: NPM_STEP_TIMEOUT_MS,
    windowsHide: true,
  });

  // Review: inspect the tarball CONTENTS, not just installability — a files
  // whitelist drift (e.g. a dropped discover/seeds or docs file) would pass
  // `setup hosts` but break consumers. `tar -tf` lists entries verbatim and
  // ships on all three CI platforms. The basename + cwd form avoids MSYS GNU
  // tar misreading a `C:\...` argument as a remote host.
  const tarList = await execFileAsync("tar", ["-tf", packedFileName], {
    cwd: repositoryRoot,
    maxBuffer: 10_000_000,
    timeout: 60_000,
    windowsHide: true,
  });
  const tarLines = tarList.stdout.split(/\r?\n/u);
  // One source of truth (package-audit doctrine): the tarball must contain
  // every entry the release audit pins, verbatim, prefixed by the npm
  // `package/` root.
  for (const entry of REQUIRED_PACKED_FILES) {
    if (!tarLines.includes(`package/${entry}`)) {
      throw new Error(`packed tarball missing required entry: ${entry}`);
    }
  }
  // Review: detect node_modules only as a COMPLETE path component, never as
  // an arbitrary substring — a file like `package/node_modules-policy.md`
  // is a legitimate packed document, while any `package/node_modules/...`
  // entry is a packaging leak.
  if (tarLines.some((line) => line.split("/").includes("node_modules"))) {
    throw new Error("packed tarball must not contain node_modules entries");
  }

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
      timeout: NPM_STEP_TIMEOUT_MS,
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
  // Resolve the npm JS CLI shell-less (DEP0190 doctrine): npm_execpath when
  // set, else npm_config_prefix / the node install's bundled npm. Never
  // spawn bare `npm.cmd` through a shell on Windows.
  const invocation = buildNpmInvocation(args);
  const strippedOptions = {
    ...(options ?? {}),
    env: {
      ...((options?.env as NodeJS.ProcessEnv | undefined) ?? process.env),
    },
  };
  const result = await execFileAsync(
    invocation.command,
    invocation.commandArgs,
    {
      ...strippedOptions,
      encoding: "utf8",
      shell: invocation.shell,
    },
  );

  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}
