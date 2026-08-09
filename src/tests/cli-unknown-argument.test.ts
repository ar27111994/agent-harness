/**
 * CLI unknown-argument behavior (#431) — end-to-end assertions that an
 * unknown option or command prints a conventional error naming the argument
 * (stderr) plus a usage pointer, exits 1, and never dumps the full help text
 * or executes the requested pipeline.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { builtCliPath, repositoryRoot } from "./built-cli-harness.js";
import { setupInternals } from "../setup.js";

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
          NODE_V8_COVERAGE: undefined,
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
        NODE_V8_COVERAGE: undefined,
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

void test("setup flag-spec guard is inert for subcommands without a spec", async () => {
  // The dispatch switch only consults the guard for doctor/hosts/login;
  // an unknown subcommand must never be misread as a flag rejection.
  assert.equal(
    await setupInternals.hasUnknownFlagsForSetupCommand(
      "not-a-setup-subcommand",
      ["--host"],
    ),
    false,
  );
});

// ─── #445 full-domain sweep ─────────────────────────────────────────────────
//
// Every domain subcommand that previously parsed options ad hoc (recommend,
// mirror, install, activate, quarantine, rebuild, discover inspect/diff/
// environment-index/ard-export) must reject unknown flags with the same
// `error: unknown option 'X'` + usage-pointer convention the discover/wire/
// workspace/setup domains already use — before doing any work or writing
// state.

interface UnknownFlagCase {
  domain: string;
  subcommand: string;
  flag: string;
  /** Success-marker substring whose absence proves the command did not run. */
  marker?: string;
}

const UNKNOWN_FLAG_SWEEP: UnknownFlagCase[] = [
  {
    domain: "mirror",
    subcommand: "plan",
    flag: "--bogus",
    marker: "Mirror plan written",
  },
  { domain: "mirror", subcommand: "locks", flag: "--bogus" },
  {
    domain: "mirror",
    subcommand: "acquire",
    flag: "--batch-szie",
    marker: "Mirror acquire complete",
  },
  { domain: "mirror", subcommand: "diff", flag: "--bogus" },
  { domain: "mirror", subcommand: "explain", flag: "--bogus" },
  { domain: "mirror", subcommand: "bundle-explain", flag: "--bogus" },
  { domain: "bundle", subcommand: "explain", flag: "--bogus" },
  { domain: "install", subcommand: "bundle", flag: "--bogus" },
  { domain: "install", subcommand: "native", flag: "--bogus" },
  { domain: "install", subcommand: "refresh", flag: "--bogus" },
  { domain: "install", subcommand: "reconcile", flag: "--bogus" },
  { domain: "install", subcommand: "diff", flag: "--bogus" },
  { domain: "install", subcommand: "explain", flag: "--bogus" },
  { domain: "install", subcommand: "generations", flag: "--bogus" },
  { domain: "install", subcommand: "reset", flag: "--bogus" },
  { domain: "stage", subcommand: "bundle", flag: "--bogus" },
  {
    domain: "activate",
    subcommand: "host",
    flag: "--rec-host",
    marker: "Activation views written",
  },
  { domain: "activate", subcommand: "diff", flag: "--bogus" },
  { domain: "activate", subcommand: "explain", flag: "--bogus" },
  { domain: "activate", subcommand: "rollback", flag: "--bogus" },
  { domain: "activate", subcommand: "reset", flag: "--bogus" },
  { domain: "quarantine", subcommand: "list", flag: "--bogus" },
  { domain: "quarantine", subcommand: "inspect", flag: "--bogus" },
  { domain: "quarantine", subcommand: "report", flag: "--bogus" },
  { domain: "quarantine", subcommand: "approve", flag: "--bogus" },
  { domain: "quarantine", subcommand: "reject", flag: "--bogus" },
  { domain: "quarantine", subcommand: "pin", flag: "--bogus" },
  { domain: "rebuild", subcommand: "clean", flag: "--bogus" },
  { domain: "rebuild", subcommand: "full", flag: "--bogus" },
  {
    domain: "recommend",
    subcommand: "report",
    flag: "--bogus",
    marker: "Building recommendation report",
  },
  { domain: "recommend", subcommand: "explain", flag: "--bogus" },
  { domain: "recommend", subcommand: "evaluate", flag: "--bogus" },
  { domain: "recommend", subcommand: "ai-review", flag: "--bogus" },
  { domain: "recommend", subcommand: "policy:print", flag: "--bogus" },
  { domain: "discover", subcommand: "inspect", flag: "--bogus" },
  { domain: "discover", subcommand: "diff", flag: "--bogus" },
  { domain: "discover", subcommand: "environment-index", flag: "--bogus" },
  { domain: "discover", subcommand: "ard-export", flag: "--bogus" },
];

void test("every domain subcommand rejects unknown flags, exits non-zero, and does not run (#445)", async () => {
  for (const entry of UNKNOWN_FLAG_SWEEP) {
    const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-flag-sweep-"));
    const args = [
      entry.domain,
      entry.subcommand,
      entry.flag,
      ...(entry.domain === "mirror" && entry.subcommand === "acquire"
        ? ["5"]
        : []),
      "--state-root",
      tempRoot,
    ];
    const result = await runCliExpectFailure(args);

    assert.match(
      result.stderr,
      new RegExp(`unknown option '${entry.flag}'`, "u"),
      `${entry.domain} ${entry.subcommand} ${entry.flag} must name the unknown option`,
    );
    assert.equal(
      result.exitCode,
      1,
      `${entry.domain} ${entry.subcommand} ${entry.flag} must exit 1`,
    );
    if (entry.marker) {
      assert.doesNotMatch(
        result.stdout,
        new RegExp(escapeRegExp(entry.marker), "u"),
        `${entry.domain} ${entry.subcommand} must not run (marker '${entry.marker}' absent)`,
      );
    }
  }
});

void test("unknown-flag rejection happens before any state mutation, in-process (#445)", async () => {
  const { cliInternals } = await import("../cli.js");
  for (const entry of UNKNOWN_FLAG_SWEEP) {
    const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-flag-sweep-"));
    const exitCode = await cliInternals.runDomainCommand(
      entry.domain,
      [entry.subcommand, entry.flag],
      tempRoot,
      tempRoot,
    );
    assert.equal(
      exitCode,
      1,
      `${entry.domain} ${entry.subcommand} ${entry.flag} must exit 1`,
    );
    const created = await readdir(tempRoot);
    assert.deepEqual(
      created,
      [],
      `${entry.domain} ${entry.subcommand} ${entry.flag} must not create state`,
    );
  }
});

void test("--help still short-circuits before unknown-flag validation on every sweep domain (#445)", async () => {
  const helpCases = [
    ["mirror", "acquire", "--help"],
    ["install", "native", "--help"],
    ["activate", "host", "--help"],
    ["quarantine", "list", "--help"],
    ["rebuild", "clean", "--help"],
    ["recommend", "evaluate", "--help"],
    ["discover", "inspect", "--help"],
  ] as const;
  for (const args of helpCases) {
    const help = await runCliExpectSuccess([...args]);
    assert.ok(
      help.length > 0,
      `${args.join(" ")} --help must print help and exit 0`,
    );
  }
  // help also wins when an unknown flag accompanies it.
  const mixedHelp = await runCliExpectSuccess([
    "mirror",
    "acquire",
    "--batch-szie",
    "5",
    "--help",
  ]);
  assert.match(mixedHelp, /mirror acquire/u);
});

/**
 * Escapes regex metacharacters for literal substring matching.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
