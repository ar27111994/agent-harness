import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createIsolatedCliEnvironment,
  runBuiltCli,
} from "./built-cli-harness.js";

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
