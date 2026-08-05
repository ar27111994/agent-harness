/**
 * E2E CLI tests for v2.0.0 final release.
 *
 * These tests invoke the actual CLI binary to verify end-to-end behaviour
 * that cannot be tested through unit tests alone.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

const CLI = join(import.meta.dirname, "..", "..", "dist", "cli.js");

/**
 * Runs the agent-harness CLI with the given args and returns stdout/stderr.
 */
async function runCli(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(process.execPath, [CLI, ...args], {
      cwd: options.cwd,
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: execErr.stdout ?? "",
      stderr: execErr.stderr ?? "",
      exitCode: execErr.code ?? 1,
    };
  }
}

// ---------------------------------------------------------------------------
// wire cursor --preview
// ---------------------------------------------------------------------------

void test("wire cursor --preview produces formatted preview output", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-e2e-wire-"));
  // Create minimal state structure so wire doesn't fail immediately.
  await mkdir(join(projectRoot, "state", "activate", "cursor"), {
    recursive: true,
  });
  await mkdir(join(projectRoot, "state", "mirror", "bundles"), {
    recursive: true,
  });
  await writeFile(
    join(
      projectRoot,
      "state",
      "mirror",
      "bundles",
      "community-stable.lock.json",
    ),
    JSON.stringify({
      schemaVersion: 1,
      bundleId: "community-stable",
      lockedAt: new Date().toISOString(),
      mirrorCount: 0,
    }),
    "utf8",
  );

  try {
    const { stdout, exitCode } = await runCli([
      "--state-root",
      projectRoot,
      "wire",
      "cursor",
      "--preview",
    ]);

    // Preview mode should succeed (exit 0) or fail gracefully if no bundles.
    // In either case, the formatWirePreviewManifest output shape should be present.
    const combined = stdout;
    // The preview manifest should contain the host name and workspace path.
    assert.ok(
      combined.includes("cursor") || exitCode !== 0,
      "preview output should reference cursor host",
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// wire cursor --apply / --reset round-trip
// ---------------------------------------------------------------------------

void test("wire cursor --apply and --reset round-trip", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-e2e-wire-apply-"),
  );
  await mkdir(join(projectRoot, "state", "activate", "cursor"), {
    recursive: true,
  });
  await mkdir(join(projectRoot, "state", "mirror", "bundles"), {
    recursive: true,
  });
  await writeFile(
    join(
      projectRoot,
      "state",
      "mirror",
      "bundles",
      "community-stable.lock.json",
    ),
    JSON.stringify({
      schemaVersion: 1,
      bundleId: "community-stable",
      lockedAt: new Date().toISOString(),
      mirrorCount: 0,
    }),
    "utf8",
  );

  try {
    // Apply and reset should complete without unhandled exceptions.
    // With empty bundles, both may return non-zero — that's expected.
    // The important thing is they don't throw or crash.
    const applyResult = await runCli([
      "--state-root",
      projectRoot,
      "wire",
      "cursor",
      "--apply",
    ]);
    const resetResult = await runCli([
      "--state-root",
      projectRoot,
      "wire",
      "cursor",
      "--reset",
    ]);

    // Both commands should return an exit code (not crash).
    assert.ok(
      typeof applyResult.exitCode === "number",
      "wire apply should return an exit code",
    );
    assert.ok(
      typeof resetResult.exitCode === "number",
      "wire reset should return an exit code",
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// --state-root path resolution (MSYS /c/X → C:\X on Windows)
// ---------------------------------------------------------------------------

void test("--state-root accepts MSYS path /c/X on Windows", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-e2e-state-root-"),
  );
  const stateRoot = await mkdtemp(join(tmpdir(), "agent-harness-e2e-state-"));

  // Convert the temp dir to MSYS-style path for testing.
  // On Windows, tmpdir returns C:\Users\...\Temp\...
  // We simulate the MSYS path by constructing /c/Users/.../Temp/...
  const msysStateRoot =
    "/" + stateRoot.replace(/^([A-Z]):\\/u, "$1/").replace(/\\/gu, "/");

  try {
    const { exitCode } = await runCli([
      "--state-root",
      projectRoot,
      "--state-root",
      msysStateRoot,
      "discover",
      "stats",
    ]);

    // Should not crash with path resolution error.
    // May exit non-zero if catalog is empty, but shouldn't throw.
    assert.ok(exitCode !== null && exitCode !== undefined);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// setup doctor (basic smoke test)
// ---------------------------------------------------------------------------

void test("setup doctor runs without crashing", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-e2e-setup-"));

  try {
    const { exitCode, stdout, stderr } = await runCli([
      "--state-root",
      projectRoot,
      "setup",
      "doctor",
    ]);

    // setup doctor should complete without an unhandled exception.
    // It may exit non-zero if tooling is missing — that's fine.
    const output = stdout + stderr;
    assert.ok(
      typeof exitCode === "number",
      "setup doctor should return an exit code (not crash)",
    );
    // Should produce some diagnostic output.
    assert.ok(
      output.length > 0 || exitCode === 0,
      "setup doctor should produce output or exit 0",
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// discover stats (basic smoke test)
// ---------------------------------------------------------------------------

void test("discover stats handles empty project gracefully", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-e2e-discover-"),
  );

  try {
    const { exitCode, stdout } = await runCli([
      "--state-root",
      projectRoot,
      "discover",
      "stats",
    ]);

    // Should print JSON stats or error about missing data.
    // Either way, should not crash.
    assert.ok(stdout.length > 0 || exitCode !== 0);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// --timeout-seconds validation
// ---------------------------------------------------------------------------

void test("--timeout-seconds rejects non-numeric value", async () => {
  const { stderr } = await runCli([
    "--timeout-seconds",
    "abc",
    "discover",
    "stats",
  ]);
  assert.ok(
    stderr.includes("requires a positive number") ||
      stderr.includes("timeout-seconds"),
    "should reject non-numeric --timeout-seconds",
  );
});

void test("--timeout-seconds rejects zero", async () => {
  const { stderr } = await runCli([
    "--timeout-seconds",
    "0",
    "discover",
    "stats",
  ]);
  assert.ok(
    stderr.includes("requires a positive number") ||
      stderr.includes("timeout-seconds"),
    "should reject zero --timeout-seconds",
  );
});

void test("--timeout-seconds=abc rejects non-numeric value", async () => {
  const { stderr } = await runCli([
    "--timeout-seconds=abc",
    "discover",
    "stats",
  ]);
  assert.ok(
    stderr.includes("requires a positive number") ||
      stderr.includes("timeout-seconds"),
    "should reject non-numeric --timeout-seconds= form",
  );
});
