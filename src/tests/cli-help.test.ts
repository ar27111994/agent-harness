import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createIsolatedCliEnvironment,
  repositoryRoot,
  runBuiltCli,
} from "./built-cli-harness.js";

/** Reads the expected version from the project package.json. */
async function readExpectedVersion(): Promise<string> {
  const raw = await readFile(join(repositoryRoot, "package.json"), "utf8");
  const pkg = JSON.parse(raw) as { version: string };
  return pkg.version;
}

void test("subcommand --help exits without preparing state", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-help-"));

  try {
    const { workspaceRoot, stateRoot, env } =
      await createIsolatedCliEnvironment(tempRoot, { createStateRoot: false });
    const { stdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["discover", "demand-profile", "--help"],
    });

    assert.match(stdout, /discover commands:/u);
    assert.match(stdout, /breadth\s+Run the widest practical discovery pass/u);
    assert.match(stdout, /recall\s+Alias for discover breadth/u);
    assert.match(stdout, /candidate-pool\s+Alias for discover breadth/u);
    assert.doesNotMatch(stdout, /Demand profile written/u);

    const { stdout: leadingHelpStdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["help", "discover"],
    });

    assert.match(leadingHelpStdout, /discover commands:/u);

    const { stdout: directGroupHelpStdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["discover"],
    });

    assert.match(directGroupHelpStdout, /discover commands:/u);

    const { stdout: stageHelpStdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["help", "stage"],
    });

    assert.match(
      stageHelpStdout,
      /stage commands \(install is a supported alias\):/u,
    );
    assert.match(
      stageHelpStdout,
      /bundle\s+Stage mirrored assets from mirror bundle locks/u,
    );
    assert.equal(existsSync(stateRoot), false);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("--version prints version and exits 0 without state", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-version-"));
  const expectedVersion = await readExpectedVersion();

  try {
    const { workspaceRoot, env } = await createIsolatedCliEnvironment(
      tempRoot,
      {
        createStateRoot: false,
      },
    );

    const { stdout, stderr } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      timeout: 15_000,
      args: ["--version"],
    });

    assert.equal(stdout.trim(), expectedVersion);
    assert.equal(stderr, "");
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("-V prints version and exits 0 without state", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-version-"));
  const expectedVersion = await readExpectedVersion();

  try {
    const { workspaceRoot, env } = await createIsolatedCliEnvironment(
      tempRoot,
      {
        createStateRoot: false,
      },
    );

    const { stdout, stderr } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      timeout: 15_000,
      args: ["-V"],
    });

    assert.equal(stdout.trim(), expectedVersion);
    assert.equal(stderr, "");
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("--version works with --state-root", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-version-"));
  const expectedVersion = await readExpectedVersion();

  try {
    const { workspaceRoot, stateRoot, env } =
      await createIsolatedCliEnvironment(tempRoot, { createStateRoot: true });

    const { stdout, stderr } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 15_000,
      args: ["--version"],
    });

    assert.equal(stdout.trim(), expectedVersion);
    assert.equal(stderr, "");
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("discover full --help shows full-specific help not parent index (#367)", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-help-"));

  try {
    const { workspaceRoot, stateRoot, env } =
      await createIsolatedCliEnvironment(tempRoot, { createStateRoot: false });
    const { stdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["discover", "full", "--help"],
    });

    assert.match(stdout, /discover full/u);
    assert.match(stdout, /Run the complete discovery pipeline/u);
    assert.match(stdout, /demand-profile.*Scan the working directory/u);
    assert.match(stdout, /--quiet.*Suppress expected source health warnings/u);
    assert.doesNotMatch(stdout, /Demand profile written/u);
    assert.equal(existsSync(stateRoot), false);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("discover breadth --help shows breadth-specific help not parent index (#367)", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-help-"));

  try {
    const { workspaceRoot, stateRoot, env } =
      await createIsolatedCliEnvironment(tempRoot, { createStateRoot: false });
    const { stdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["discover", "breadth", "--help"],
    });

    assert.match(stdout, /discover breadth/u);
    assert.match(stdout, /widest practical discovery pass/u);
    assert.match(stdout, /recall.*Same as discover breadth/u);
    assert.equal(existsSync(stateRoot), false);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("recommend explain --help shows explain-specific help (#364)", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-help-"));

  try {
    const { workspaceRoot, stateRoot, env } =
      await createIsolatedCliEnvironment(tempRoot, { createStateRoot: false });
    const { stdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["recommend", "explain", "--help"],
    });

    assert.match(stdout, /recommend explain/u);
    assert.match(stdout, /--asset.*<assetId>/u);
    assert.match(stdout, /--json/u);
    assert.match(stdout, /Explanation states:/u);
    assert.equal(existsSync(stateRoot), false);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("recommend report --help shows parent recommend help", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-help-"));

  try {
    const { workspaceRoot, stateRoot, env } =
      await createIsolatedCliEnvironment(tempRoot, { createStateRoot: false });
    const { stdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["recommend", "report", "--help"],
    });

    assert.match(stdout, /recommend commands:/u);
    assert.match(stdout, /explain.*Explain why an asset/u);
    assert.equal(existsSync(stateRoot), false);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("mutating domains show help when --help is passed instead of executing", async () => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-mutating-help-"),
  );

  try {
    const { workspaceRoot, stateRoot, env } =
      await createIsolatedCliEnvironment(tempRoot, { createStateRoot: false });

    // mirror plan --help should show mirror help, not execute generateMirrorPlan
    const { stdout: mirrorStdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["mirror", "plan", "--help"],
    });
    assert.match(mirrorStdout, /mirror commands:/u);
    assert.match(mirrorStdout, /plan\s+Summarize mirror readiness/u);
    assert.doesNotMatch(mirrorStdout, /Mirror plan written/u);

    // install bundle --help should show install help, not execute
    const { stdout: installStdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["install", "bundle", "--help"],
    });
    assert.match(
      installStdout,
      /stage commands \(install is a supported alias\):/u,
    );

    // activate --help should show activate help
    const { stdout: activateStdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["activate", "--help"],
    });
    assert.match(activateStdout, /activate commands:/u);

    // quarantine --help should show quarantine help
    const { stdout: quarantineStdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["quarantine", "--help"],
    });
    assert.match(quarantineStdout, /quarantine commands:/u);

    // Non-mutating: discover full --help should show subcommand-specific help
    const { stdout: discoverFullStdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["discover", "full", "--help"],
    });
    assert.match(discoverFullStdout, /discover full/u);
    assert.match(
      discoverFullStdout,
      /demand-profile\s+Scan the working directory/u,
    );

    // Mutating-domain --help must not create any state
    assert.equal(
      existsSync(stateRoot),
      false,
      "stateRoot must not be created by --help",
    );
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});
