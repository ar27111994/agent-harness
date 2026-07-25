import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
