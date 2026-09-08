import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
// Anti-hang bound for the packed-package smoke's spawn steps (npm pack,
// npm install, installed-CLI exec). A cold ubuntu/macos/windows hosted runner
// with a fresh npm cache plus real-time AV can exceed 120s on `npm install` of
// a local tarball while warm/local runs finish in ~3s; SIGTERM at exactly the
// execFile timeout with empty stdout/stderr is the cold-runner signature, not a
// hang. 300s matches the `smoke:pack` counterpart (NPM_STEP_TIMEOUT_MS).
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_BUFFER = 10_000_000;

/**
 * Files every packed tarball must contain, pinned so missing runtime or
 * trust documentation fails the release audit instead of shipping broken.
 * The audit tests build their fixtures from this same list so the fixture
 * always represents a compliant package (no drift between the checker and
 * the check).
 */
export const REQUIRED_PACKED_FILES = [
  "dist/cli.js",
  "dist/cli.d.ts",
  // Split-domain runtime modules must ship with the tarball — the earlier
  // activate/ split was silently excluded until pack-smoke caught it at
  // runtime; pin every domain split here so the audit fails instead.
  "dist/activate/help.js",
  "dist/activate/selection.js",
  "dist/activate/state.js",
  "dist/quarantine/help.js",
  "dist/quarantine/state.js",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "docs/guides/V1-TO-V2-UPGRADE.md",
  "docs/guides/V2-CONTRACT.md",
  "docs/guides/TRUST-CENTER.md",
  "docs/guides/SAFE-DEFAULTS.md",
  "docs/guides/RELEASE-PROCESS.md",
  "docs/playbooks/QUARANTINE-PLAYBOOK.md",
  "docs/guides/HARNESS-MAINTENANCE-GUIDE.md",
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

/**
 * Normalizes npm's `pack --json` payload into a list of pack records. npm <12
 * emits an ARRAY of pack objects; npm 12+ emits an OBJECT keyed by package
 * name (`{ "@scope/name": { files, filename, ... } }`). Returning the full
 * object/array as a flat list lets callers treat the result uniformly without
 * breaking on either shape (review: npm-12 pack --json format change).
 * Returns the flattened list (possibly empty).
 */
export function toPackRecordList(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.values(value);
  }
  return [];
}

export async function runPackageAudit({ cwd = process.cwd() } = {}) {
  const packResult = await runNpm(
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd,
    },
  );
  const packEntries = toPackRecordList(JSON.parse(packResult.stdout));
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
    const packEntries = toPackRecordList(JSON.parse(packResult.stdout));
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

/**
 * Resolves the path to npm's JS CLI so `npm` can be launched shell-less via
 * `node <npm-cli>`. This avoids `shell: true` entirely — the DEP0190 doctrine
 * forbids passing args through a shell on Windows (args concatenate unescaped,
 * cmd.exe re-parses them), and `npm.cmd` cannot be spawned directly by
 * `execFile` without a shell. Resolution order:
 *   1. an explicit npmExecPath option (tests inject a fake npm here);
 *   2. process.env.npm_execpath (set by `npm run` under the real gate);
 *   3. npm_config_prefix/node_modules/npm/bin/npm-cli.js — plus the POSIX
 *      `lib/node_modules` layout distro packages use (prefix/lib/node_modules);
 *   4. the node install's bundled npm (dirname(process.execPath)/node_modules)
 *      and its POSIX lib sibling (dirname/../lib/node_modules).
 * Each candidate is checked with existsSync; the first existing path wins, so a
 * guessed-but-absent layout never launches a dead `node <path>`. When no
 * candidate exists the resolver returns "" so buildNpmInvocation can fall back
 * to bare `npm` — the POSIX `npm` is a shell-script with a shebang and spawns
 * cleanly shell-less, while on Windows there is no shell-less bare launcher
 * (review / CodeRabbit: a nonexistent default must not defeat the fallback).
 */
export function resolveNpmCliPath(options = {}, exists = existsSync) {
  const explicit =
    options.npmExecPath !== undefined
      ? options.npmExecPath
      : process.env.npm_execpath;
  if (explicit) return explicit;
  const candidates = [];
  const prefix = options.npmConfigPrefix ?? process.env.npm_config_prefix;
  const execDir = dirname(process.execPath).replaceAll("\\", "/");
  if (prefix) {
    candidates.push(
      posixJoin(prefix, "node_modules", "npm", "bin", "npm-cli.js"),
    );
    // POSIX distro packages install node_modules under prefix/lib.
    candidates.push(
      posixJoin(prefix, "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    );
  }
  candidates.push(
    posixJoin(execDir, "node_modules", "npm", "bin", "npm-cli.js"),
  );
  // POSIX: the bundled npm may sit next to the lib tree (execDir/../lib).
  candidates.push(
    posix.join(
      execDir,
      "..",
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  );
  return candidates.find((candidate) => exists(candidate)) ?? "";
}

const posixJoin = (...parts) => posix.join(...parts);

export function buildNpmInvocation(args, options = {}) {
  const nodeExecPath = options.nodeExecPath ?? process.execPath;
  const npmCliPath = resolveNpmCliPath(options, options.exists);
  const platform = options.platform ?? process.platform;
  if (npmCliPath) {
    // Always node + npm-cli, shell-less (DEP0190: never a shell).
    return {
      command: nodeExecPath,
      commandArgs: [npmCliPath, ...args],
      shell: false,
    };
  }
  // No npm JS CLI was found. Bare `npm` is a shell-script shebang on POSIX and
  // spawns cleanly with shell: false — the doctrine violation is Windows
  // `npm.cmd`, which cannot launch shell-less. Reintroducing bare `npm` on
  // win32 would reopen the DEP0190 trap the audit exists to prevent, so that
  // combination fails loudly with a descriptive error instead of a dead path.
  if (platform === "win32") {
    throw new Error(
      "Cannot resolve an npm JS CLI (node_modules/npm/bin/npm-cli.js absent); " +
        "bare npm.cmd cannot be spawned shell-less (DEP0190).",
    );
  }
  return {
    command: "npm",
    commandArgs: [...args],
    shell: false,
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
