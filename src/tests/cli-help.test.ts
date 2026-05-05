import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

void test("subcommand --help exits without preparing state", async () => {
  const repositoryRoot = dirname(
    dirname(dirname(fileURLToPath(import.meta.url))),
  );
  const cliPath = join(repositoryRoot, "dist", "cli.js");
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-help-"));
  const workspaceRoot = join(tempRoot, "workspace");
  const stateRoot = join(tempRoot, "state");

  try {
    await mkdir(workspaceRoot, { recursive: true });
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        cliPath,
        "--no-dotenv",
        "--state-root",
        stateRoot,
        "discover",
        "demand-profile",
        "--help",
      ],
      {
        cwd: workspaceRoot,
        env: process.env,
        timeout: 30_000,
        windowsHide: true,
      },
    );

    assert.match(stdout, /discover commands:/u);
    assert.doesNotMatch(stdout, /Demand profile written/u);

    const { stdout: leadingHelpStdout } = await execFileAsync(
      process.execPath,
      [cliPath, "--no-dotenv", "--state-root", stateRoot, "help", "discover"],
      {
        cwd: workspaceRoot,
        env: process.env,
        timeout: 30_000,
        windowsHide: true,
      },
    );

    assert.match(leadingHelpStdout, /discover commands:/u);

    const { stdout: directGroupHelpStdout } = await execFileAsync(
      process.execPath,
      [cliPath, "--no-dotenv", "--state-root", stateRoot, "discover"],
      {
        cwd: workspaceRoot,
        env: process.env,
        timeout: 30_000,
        windowsHide: true,
      },
    );

    assert.match(directGroupHelpStdout, /discover commands:/u);
    assert.equal(existsSync(stateRoot), false);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});
