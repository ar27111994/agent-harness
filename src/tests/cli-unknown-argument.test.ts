/**
 * CLI unknown-argument behavior (#431) — end-to-end assertions that an
 * unknown option or command prints a conventional error naming the argument
 * (stderr) plus a usage pointer, exits 1, and never dumps the full help text
 * or executes the requested pipeline.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { builtCliPath, repositoryRoot } from "./built-cli-harness.js";

const execFileAsync = promisify(execFile);

interface CliFailure {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs the built CLI expecting a non-zero exit and returns exit code plus
 * captured output. execFile rejects on non-zero exits, so the rejection is
 * converted into a structured result.
 */
async function runCliExpectFailure(
  args: string[],
  options: { cwd?: string } = {},
): Promise<CliFailure> {
  const cwd = options.cwd ?? repositoryRoot;
  try {
    await execFileAsync(
      process.execPath,
      [builtCliPath, "--no-dotenv", ...args],
      {
        cwd,
        env: {
          ...process.env,
          AGENT_HARNESS_TEST_FETCH_MOCKS: "1",
        },
        timeout: 60_000,
        windowsHide: true,
        encoding: "utf8",
      },
    );
    assert.fail(`expected non-zero exit for args: ${args.join(" ")}`);
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    assert.ok(
      typeof failure.code === "number" && failure.code !== 0,
      `args ${args.join(" ")} must exit non-zero`,
    );
    return {
      exitCode: failure.code ?? 1,
      stdout: String(failure.stdout ?? ""),
      stderr: String(failure.stderr ?? ""),
    };
  }
}

async function runCliExpectSuccess(args: string[]): Promise<string> {
  const result = await execFileAsync(
    process.execPath,
    [builtCliPath, "--no-dotenv", ...args],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        AGENT_HARNESS_TEST_FETCH_MOCKS: "1",
      },
      timeout: 60_000,
      windowsHide: true,
      encoding: "utf8",
    },
  );
  return String(result.stdout);
}

void test("unknown top-level option prints an error, no help dump, exit 1 (#431)", async () => {
  const result = await runCliExpectFailure(["--invalid-flag"]);

  assert.match(result.stderr, /error: unknown option '--invalid-flag'/u);
  assert.match(
    result.stderr,
    /Run 'agent-harness <command> --help' for usage/u,
  );
  assert.doesNotMatch(result.stdout, /Quick start/u, "must not dump full help");
  assert.equal(result.exitCode, 1);
});

void test("unknown top-level command prints an error naming the command, no help dump, exit 1 (#431)", async () => {
  const result = await runCliExpectFailure(["license"]);

  assert.match(result.stderr, /error: unknown command 'license'/u);
  assert.doesNotMatch(result.stdout, /Quick start/u, "must not dump full help");
  assert.equal(result.exitCode, 1);
});

void test("unknown flag at domain depth prints an error instead of the domain help dump (#431)", async () => {
  const result = await runCliExpectFailure(["discover", "--badflag"]);

  assert.match(result.stderr, /error: unknown option '--badflag'/u);
  assert.doesNotMatch(
    result.stdout,
    /discover commands:/u,
    "must not dump discover help",
  );
  assert.equal(result.exitCode, 1);
});

void test("unknown flag at subcommand depth fails before executing the pipeline (#431)", async () => {
  const result = await runCliExpectFailure(["discover", "full", "--badflag"]);

  assert.match(result.stderr, /error: unknown option '--badflag'/u);
  assert.match(
    result.stderr,
    /Run 'agent-harness discover full --help' for usage/u,
  );
  assert.doesNotMatch(
    result.stdout,
    /\[discover full\]/u,
    "pipeline must not start",
  );
  assert.equal(result.exitCode, 1);
});

void test("flag-less subcommands reject every flag (#431)", async () => {
  const blocksResult = await runCliExpectFailure([
    "discover",
    "breadth",
    "--nope",
  ]);
  assert.match(blocksResult.stderr, /error: unknown option '--nope'/u);
  assert.equal(blocksResult.exitCode, 1);

  const statsResult = await runCliExpectFailure([
    "discover",
    "stats",
    "--json",
  ]);
  assert.match(statsResult.stderr, /error: unknown option '--json'/u);
  assert.equal(statsResult.exitCode, 1);
});

void test("unknown option in workspace host invocation fails before the pipeline starts (#431)", async () => {
  const result = await runCliExpectFailure([
    "workspace",
    "opencode",
    "--badflag",
  ]);

  assert.match(result.stderr, /error: unknown option '--badflag'/u);
  assert.doesNotMatch(result.stdout, /Starting opencode workspace pipeline/u);
  assert.equal(result.exitCode, 1);
});

void test("valid flags and --help remain unchanged (#431)", async () => {
  // --help at every depth still prints help and exits 0.
  const topHelp = await runCliExpectSuccess(["--help"]);
  assert.match(topHelp, /Quick start:/u);

  const domainHelp = await runCliExpectSuccess(["discover", "--help"]);
  assert.match(domainHelp, /discover commands:/u);

  const subHelp = await runCliExpectSuccess(["discover", "full", "--help"]);
  assert.match(subHelp, /discover full/u);

  // Known subcommand flags still pass validation (sync --full routes to the
  // full-index branch without tripping the unknown-flag check).
  const syncHelp = await runCliExpectSuccess(["discover", "sync", "--help"]);
  assert.match(syncHelp, /discover sync/u);
});

void test("unknown flag with --help present still prints help (help wins) (#431)", async () => {
  const help = await runCliExpectSuccess(["discover", "--badflag", "--help"]);
  assert.match(help, /discover commands:/u);
});

void test("isolated workspace sees the same unknown-option behavior (#431)", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-unknown-arg-"));
  const result = await runCliExpectFailure(["--nope"], { cwd: tempRoot });

  assert.match(result.stderr, /error: unknown option '--nope'/u);
  assert.equal(result.exitCode, 1);
});
