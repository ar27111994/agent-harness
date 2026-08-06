/**
 * Entry-guard probes (#428): the packaged entry points (dist/cli.js,
 * dist/wire.js, dist/workspace.js) only execute their module-scope guard
 * bodies when run AS the entry script, which in-process tests cannot do.
 * These serial spawns run each entry directly. They deliberately KEEP
 * NODE_V8_COVERAGE intact so the child coverage merges into the gate —
 * safe because they are serial, awaited subprocesses (never parallel),
 * and exit within milliseconds.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

const repositoryRoot = join(import.meta.dirname, "..", "..");

async function mkdtempTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "agent-harness-entry-probe-"));
}

async function rmTempDir(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}

async function runEntry(
  entry: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(
      process.execPath,
      [join(repositoryRoot, "dist", entry), ...args],
      {
        cwd: repositoryRoot,
        // KEEP process.env (including NODE_V8_COVERAGE under c8): the child
        // must contribute coverage for the entry-guard bodies it executes.
        env: process.env,
        timeout: 60_000,
        maxBuffer: 5_000_000,
      },
    );
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error: unknown) {
    const execError = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode: execError.code ?? 1,
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
    };
  }
}

void test("built cli.js entry guard prints the version and fails loudly on bad options (#428)", async () => {
  const version = await runEntry("cli.js", ["--version"]);
  assert.equal(version.exitCode, 0);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/u);

  // --state-root with a missing value throws inside main(): the guard's
  // catch turns it into a clean exit code 1.
  const failure = await runEntry("cli.js", ["--state-root"]);
  assert.equal(failure.exitCode, 1);
});

void test("built cli.js entry guard executes the full main path with dotenv loading (#428)", async () => {
  const tempRoot = await mkdtempTempDir();
  try {
    // No --no-dotenv: main() loads .env from the working directory (the repo
    // root has one), prepares the state root, and dispatches to install help.
    const result = await runEntry("cli.js", [
      "--state-root",
      tempRoot,
      "install",
      "help",
    ]);
    assert.equal(result.exitCode, 0);
    assert.ok(
      result.stdout.includes("install commands"),
      `expected install help, got: ${result.stdout.slice(0, 200)}`,
    );
  } finally {
    await rmTempDir(tempRoot);
  }
});

void test("built cli.js entry guard treats a bare default domain as a help request (#428)", async () => {
  const result = await runEntry("cli.js", ["discover"]);
  assert.equal(result.exitCode, 0);
  assert.ok(
    result.stdout.includes("discover commands:"),
    `expected discover help for a bare default domain, got: ${result.stdout.slice(0, 200)}`,
  );
});

void test("built wire.js entry guard routes help and prints it (#428)", async () => {
  const result = await runEntry("wire.js", ["help"]);
  assert.equal(result.exitCode, 0);
  assert.ok(
    result.stdout.includes("wire"),
    `expected wire help output, got: ${result.stdout.slice(0, 200)}`,
  );
});

void test("built wire.js entry guard catches runWire rejections (#428)", async () => {
  // Conflicting mode flags throw inside getWireMode; the entry guard's catch
  // converts the rejection into exit code 1.
  const result = await runEntry("wire.js", ["opencode", "--apply", "--reset"]);
  assert.equal(result.exitCode, 1);
});

void test("built workspace.js entry guard catches runWorkspace rejections (#428)", async () => {
  const result = await runEntry("workspace.js", [
    "opencode",
    "--ai-enrich",
    "--no-ai-enrich",
  ]);
  assert.equal(result.exitCode, 1);
});

void test("built workspace.js entry guard routes help and prints it (#428)", async () => {
  const result = await runEntry("workspace.js", ["help"]);
  assert.equal(result.exitCode, 0);
  assert.ok(
    result.stdout.includes("workspace commands:"),
    `expected workspace help output, got: ${result.stdout.slice(0, 200)}`,
  );
});
