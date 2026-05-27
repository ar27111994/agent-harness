import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BUFFER = 10_000_000;
const REQUIRED_PACKED_FILES = [
  "dist/cli.js",
  "dist/cli.d.ts",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "V1-TO-V2-UPGRADE.md",
  "V2-CONTRACT.md",
  "TRUST-CENTER.md",
  "SAFE-DEFAULTS.md",
  "RELEASE-PROCESS.md",
  "QUARANTINE-PLAYBOOK.md",
  "HARNESS-MAINTENANCE-GUIDE.md",
  "discover/sources.json",
  "mirror/policy.json",
];
const FORBIDDEN_PACKED_PATH_PATTERNS = [
  /^(?:src|scripts|\.github|node_modules|coverage|\.tmp)\//u,
  /^(?:activate|install|state|\.agent-harness|\.opencode|\.openclaw|\.cursor|\.zed|\.claude|\.pi)\//u,
  /^(?:AGENTS|CLAUDE|HEARTBEAT|IDENTITY|SOUL|SYSTEM|TOOLS|USER)\.md$/u,
  /^(?!\.env\.example$).*\.env(?:\..*)?$/u,
  /^.*\.log$/u,
  /^.*\.tgz$/u,
];

export async function runPackageAudit({ cwd = process.cwd() } = {}) {
  const packResult = await runNpm(
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd,
    },
  );
  const packEntries = JSON.parse(packResult.stdout);
  const pack = packEntries[0];
  if (!pack || !Array.isArray(pack.files)) {
    throw new Error("npm pack --dry-run did not return a package file list.");
  }

  const files = pack.files.map((file) => file.path).sort();
  const missingRequiredFiles = REQUIRED_PACKED_FILES.filter(
    (requiredFile) => !files.includes(requiredFile),
  );
  const forbiddenFiles = files.filter((file) =>
    FORBIDDEN_PACKED_PATH_PATTERNS.some((pattern) => pattern.test(file)),
  );

  if (missingRequiredFiles.length > 0 || forbiddenFiles.length > 0) {
    throw new Error(
      [
        "Package audit failed.",
        missingRequiredFiles.length
          ? `Missing required files: ${missingRequiredFiles.join(", ")}`
          : undefined,
        forbiddenFiles.length
          ? `Forbidden files: ${forbiddenFiles.join(", ")}`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const summary = {
    package: pack.name,
    version: pack.version,
    filename: pack.filename,
    fileCount: files.length,
    unpackedSize: pack.unpackedSize,
    requiredFiles: REQUIRED_PACKED_FILES,
  };

  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

export async function runPackedPackageSmoke({ cwd = process.cwd() } = {}) {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-release-smoke-"),
  );
  let packedTarballPath;

  try {
    const packResult = await runNpm(["pack", "--json", "--ignore-scripts"], {
      cwd,
    });
    const packEntries = JSON.parse(packResult.stdout);
    const packedFileName = packEntries[0]?.filename;
    if (!packedFileName) {
      throw new Error("npm pack did not report a tarball filename.");
    }

    packedTarballPath = resolve(cwd, packedFileName);
    const workspaceRoot = join(tempRoot, "workspace");
    const stateRoot = join(tempRoot, "state");
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(
      join(workspaceRoot, "package.json"),
      `${JSON.stringify({ name: "agent-harness-release-smoke", private: true }, null, 2)}\n`,
      "utf8",
    );
    await runNpm(["install", packedTarballPath, "--ignore-scripts"], {
      cwd: workspaceRoot,
    });

    const installedCli = join(
      workspaceRoot,
      "node_modules",
      "@ar27111994",
      "agent-harness",
      "dist",
      "cli.js",
    );
    await execNode(
      [
        installedCli,
        "--no-dotenv",
        "--state-root",
        stateRoot,
        "setup",
        "hosts",
      ],
      { cwd: workspaceRoot },
    );

    console.log(`Packed package smoke test passed for ${packedTarballPath}`);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
    if (packedTarballPath) {
      await rm(packedTarballPath, { force: true });
    }
  }
}

export function buildNpmInvocation(args, options = {}) {
  const npmCliPath = options.npmExecPath ?? process.env.npm_execpath;
  const platform = options.platform ?? process.platform;
  const nodeExecPath = options.nodeExecPath ?? process.execPath;
  const command = npmCliPath
    ? nodeExecPath
    : platform === "win32"
      ? "npm.cmd"
      : "npm";
  const commandArgs = npmCliPath ? [npmCliPath, ...args] : args;
  return {
    command,
    commandArgs,
    shell: !npmCliPath && platform === "win32",
  };
}

async function runNpm(args, options) {
  const invocation = buildNpmInvocation(args);
  return execFileAsync(invocation.command, invocation.commandArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: DEFAULT_MAX_BUFFER,
    timeout: DEFAULT_TIMEOUT_MS,
    windowsHide: true,
    shell: invocation.shell,
  });
}

async function execNode(args, options) {
  return execFileAsync(process.execPath, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 5_000_000,
    timeout: DEFAULT_TIMEOUT_MS,
    windowsHide: true,
  });
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function resolvePackageAuditAction(command) {
  return command === "smoke" ? runPackedPackageSmoke : runPackageAudit;
}

export function toPackageAuditErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

if (isDirectExecution) {
  const command = process.argv[2] ?? "audit";
  const action = resolvePackageAuditAction(command);
  action().catch((error) => {
    console.error(toPackageAuditErrorMessage(error));
    process.exitCode = 1;
  });
}
