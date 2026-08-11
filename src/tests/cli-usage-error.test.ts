/**
 * CLI user-input error formatting (#446) — end-to-end and in-process
 * assertions that argument-validation failures print a one-line actionable
 * message plus a usage pointer with a non-zero exit — never raw Node stack
 * frames — and that `setup login --provider <unknown>` exits non-zero.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CliUsageError, printCliUsageError } from "../cli-help-format.js";
import {
  type BuiltCliRunResult,
  runCliExpectFailure,
  runCliExpectSuccess,
} from "./built-cli-harness.js";
import { cliInternals } from "../cli.js";
import { getOptionValue } from "../lib/cli-options.js";
import { parseSessionIntent } from "../lib/session-intent.js";

/**
 * Asserts the stderr of a user-input failure is a clean one-liner: no
 * internal `at ... (file://...)` stack frames, an `error:` message, and a
 * usage pointer.
 */
function assertStackFreeStderr(
  result: BuiltCliRunResult,
  messagePattern: RegExp,
  context: string,
): void {
  assert.match(result.stderr, messagePattern, `${context}: message`);
  assert.doesNotMatch(
    result.stderr,
    /\(file:\/\//u,
    `${context}: must not contain file:// stack frames`,
  );
  assert.doesNotMatch(
    result.stderr,
    /^\s*at /mu,
    `${context}: must not contain stack frame lines`,
  );
  assert.match(
    result.stderr,
    /Run 'agent-harness .*--help' for usage\./u,
    `${context}: usage pointer`,
  );
  assert.equal(result.exitCode, 1, `${context}: exit code 1`);
}

// ─── ticket repros (spawned, built CLI) ─────────────────────────────────────

void test("activate host with an invalid host prints a clean error (#446)", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-usage-err-"));
  context.after(() => rm(tempRoot, { recursive: true, force: true }));
  const result = await runCliExpectFailure([
    "activate",
    "host",
    "--host",
    "nosuchhost",
    "--state-root",
    tempRoot,
  ]);
  assertStackFreeStderr(
    result,
    /error: Invalid --host value: nosuchhost\./u,
    "activate host --host nosuchhost",
  );
});

void test("recommend report with an invalid intent prints a clean error (#446)", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-usage-err-"));
  context.after(() => rm(tempRoot, { recursive: true, force: true }));
  const result = await runCliExpectFailure([
    "recommend",
    "report",
    "--intent",
    "nosuchintent",
    "--state-root",
    tempRoot,
  ]);
  assertStackFreeStderr(
    result,
    /error: Invalid --intent value 'nosuchintent'\./u,
    "recommend report --intent nosuchintent",
  );
});

void test("discover diff without --baseline prints a clean error (#446)", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-usage-err-"));
  context.after(() => rm(tempRoot, { recursive: true, force: true }));
  const result = await runCliExpectFailure([
    "discover",
    "diff",
    "--state-root",
    tempRoot,
  ]);
  assertStackFreeStderr(
    result,
    /error: discover diff requires --baseline <stateRoot>/u,
    "discover diff (no --baseline)",
  );
});

void test("mirror explain without --asset/--mirror prints a clean error (#446)", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-usage-err-"));
  context.after(() => rm(tempRoot, { recursive: true, force: true }));
  const result = await runCliExpectFailure([
    "mirror",
    "explain",
    "--state-root",
    tempRoot,
  ]);
  assertStackFreeStderr(
    result,
    /error: mirror explain requires --asset or --mirror/u,
    "mirror explain (no args)",
  );
});

void test("quarantine approve with a missing artifact prints a clean error (#446)", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-usage-err-"));
  context.after(() => rm(tempRoot, { recursive: true, force: true }));
  const result = await runCliExpectFailure([
    "quarantine",
    "approve",
    "--asset",
    "foo",
    "--state-root",
    tempRoot,
  ]);
  assertStackFreeStderr(
    result,
    /error: No matching mirror artifact found for quarantine review\./u,
    "quarantine approve --asset foo",
  );
});

void test("install generations pin without --generation prints a clean error (#446)", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-usage-err-"));
  context.after(() => rm(tempRoot, { recursive: true, force: true }));
  const result = await runCliExpectFailure([
    "install",
    "generations",
    "pin",
    "--host",
    "copilot-vscode",
    "--state-root",
    tempRoot,
  ]);
  assertStackFreeStderr(
    result,
    /error: generations pin\/unpin requires --host and --generation/u,
    "install generations pin (no --generation)",
  );
});

void test("install native with an invalid operation prints a clean error (#446)", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-usage-err-"));
  context.after(() => rm(tempRoot, { recursive: true, force: true }));
  const result = await runCliExpectFailure([
    "install",
    "native",
    "--host",
    "vscode",
    "--operation",
    "nosuchop",
    "--state-root",
    tempRoot,
  ]);
  assertStackFreeStderr(
    result,
    /error: Invalid native install operation 'nosuchop'\./u,
    "install native --operation nosuchop",
  );
});

void test("recommend policy:print with an invalid host prints a clean error (#446)", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-usage-err-"));
  context.after(() => rm(tempRoot, { recursive: true, force: true }));
  const result = await runCliExpectFailure([
    "recommend",
    "policy:print",
    "--host",
    "nosuchhost",
    "--state-root",
    tempRoot,
  ]);
  assertStackFreeStderr(
    result,
    /error: recommend policy:print requires --host to be one of:/u,
    "recommend policy:print --host nosuchhost",
  );
});

void test("setup login with an unknown provider exits non-zero (#446)", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-usage-err-"));
  context.after(() => rm(tempRoot, { recursive: true, force: true }));
  const result = await runCliExpectFailure([
    "setup",
    "login",
    "--provider",
    "nosuch",
    "--state-root",
    tempRoot,
  ]);
  assert.match(result.stderr, /error: Unknown login provider 'nosuch'\./u);
  assert.match(
    result.stderr,
    /Run 'agent-harness setup login --help' for usage\./u,
  );
  assert.doesNotMatch(result.stderr, /\(file:\/\//u);
  assert.notEqual(result.exitCode, 0);
});

void test("setup login with a valid provider still exits 0 (#446)", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-usage-err-"));
  context.after(() => rm(tempRoot, { recursive: true, force: true }));
  const stdout = await runCliExpectSuccess([
    "setup",
    "login",
    "--provider",
    "github",
    "--state-root",
    tempRoot,
  ]);
  assert.match(stdout, /github login guidance/u);
});

// ─── review wave: install --host validation and bundle-lookup misses ───────

void test("install reconcile with an invalid host prints a clean error (review)", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-usage-err-"));
  context.after(() => rm(tempRoot, { recursive: true, force: true }));
  const result = await runCliExpectFailure([
    "install",
    "reconcile",
    "--host",
    "nosuchhost",
    "--state-root",
    tempRoot,
  ]);
  assertStackFreeStderr(
    result,
    /error: Unknown --host 'nosuchhost'\./u,
    "install reconcile --host nosuchhost",
  );
});

void test("install reset with an invalid host prints a clean error (review)", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-usage-err-"));
  context.after(() => rm(tempRoot, { recursive: true, force: true }));
  const result = await runCliExpectFailure([
    "install",
    "reset",
    "--host",
    "nosuchhost",
    "--state-root",
    tempRoot,
  ]);
  assertStackFreeStderr(
    result,
    /error: Unknown --host 'nosuchhost'\./u,
    "install reset --host nosuchhost",
  );
});

void test("install refresh with an invalid host prints a clean error (review)", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-usage-err-"));
  context.after(() => rm(tempRoot, { recursive: true, force: true }));
  const result = await runCliExpectFailure([
    "install",
    "refresh",
    "--host",
    "nosuchhost",
    "--state-root",
    tempRoot,
  ]);
  assertStackFreeStderr(
    result,
    /error: Unknown --host 'nosuchhost'\./u,
    "install refresh --host nosuchhost",
  );
});

void test("bundle explain with an unknown bundle prints a clean error (review)", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-usage-err-"));
  context.after(() => rm(tempRoot, { recursive: true, force: true }));
  const result = await runCliExpectFailure([
    "bundle",
    "explain",
    "no-such-bundle",
    "--state-root",
    tempRoot,
  ]);
  assertStackFreeStderr(
    result,
    /error: Bundle lock not found: 'no-such-bundle'\./u,
    "bundle explain no-such-bundle",
  );
});

// ─── error class + formatter units ──────────────────────────────────────────

void test("CliUsageError is an Error carrying the message and usage hint (#446)", () => {
  const error = new CliUsageError("boom", "agent-harness x --help");
  assert.ok(error instanceof Error);
  assert.ok(error instanceof CliUsageError);
  assert.equal(error.name, "CliUsageError");
  assert.equal(error.message, "boom");
  assert.equal(error.usageHint, "agent-harness x --help");
  assert.equal(new CliUsageError("plain").usageHint, undefined);
});

void test("printCliUsageError prints a one-line message plus usage pointer (#446)", () => {
  const stderr: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    stderr.push(args.map((value) => String(value)).join(" "));
  };
  try {
    printCliUsageError(
      new CliUsageError("bad input", "agent-harness custom --help"),
    );
    printCliUsageError(new CliUsageError("no hint"));
  } finally {
    console.error = originalError;
  }
  assert.equal(stderr[0], "error: bad input");
  assert.equal(stderr[1], "Run 'agent-harness custom --help' for usage.");
  assert.equal(stderr[2], "error: no hint");
  assert.equal(stderr[3], "Run 'agent-harness <command> --help' for usage.");
});

void test("shared option/intent validators throw CliUsageError (#446)", () => {
  assert.throws(
    () => getOptionValue(["--host"], "--host"),
    (error: unknown) =>
      error instanceof CliUsageError &&
      error.message === "Missing value for '--host'.",
  );
  assert.throws(
    () => parseSessionIntent("nosuchintent"),
    (error: unknown) =>
      error instanceof CliUsageError &&
      /Invalid --intent value 'nosuchintent'\./u.test(error.message),
  );
});

// ─── in-process main() path (#446) ──────────────────────────────────────────

void test("main() maps user-input errors to a clean one-line exit without stacks (#446)", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-usage-err-"));
  context.after(() => rm(tempRoot, { recursive: true, force: true }));
  const stateRoot = join(tempRoot, "state");
  const originalArgv = process.argv;
  const stderr: string[] = [];
  const originalError = console.error;
  const originalStderrWrite = process.stderr.write;
  console.error = (...args: unknown[]) => {
    stderr.push(args.map((value) => String(value)).join(" "));
  };
  process.stderr.write = ((chunk: unknown): boolean => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    process.argv = [
      process.execPath,
      "dist/cli.js",
      "--no-dotenv",
      "--state-root",
      stateRoot,
      "recommend",
      "report",
      "--intent",
      "nosuchintent",
    ];
    const exitCode = await cliInternals.main();
    assert.equal(exitCode, 1);
    const stderrText = stderr.join("\n");
    assert.match(stderrText, /error: Invalid --intent value 'nosuchintent'\./u);
    assert.doesNotMatch(stderrText, /\(file:\/\//u, "no stack frames");
    assert.match(
      stderrText,
      /Run 'agent-harness recommend --help' for usage\./u,
    );
  } finally {
    process.argv = originalArgv;
    console.error = originalError;
    process.stderr.write = originalStderrWrite;
  }
});

void test("main() rethrows internal (non-user-input) errors for stackful top-level handling (#446)", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-usage-err-"));
  context.after(() => rm(tempRoot, { recursive: true, force: true }));
  const stateRoot = join(tempRoot, "state");
  const originalArgv = process.argv;
  try {
    // `mirror bundle-explain <bundle>` on an EXISTING but corrupt lock file
    // hits a JSON parse failure — an internal data-integrity error, not a
    // user-input validation error (a MISSING lock is CliUsageError; a
    // malformed one is a real bug). main() must propagate the ORIGINAL
    // internal error (reject) rather than swallow it as a CliUsageError, so
    // the outer catch keeps full stack context (#446, review).
    await mkdir(join(stateRoot, "mirror", "bundles"), { recursive: true });
    await writeFile(
      join(stateRoot, "mirror", "bundles", "broken-bundle.lock.json"),
      "{ this is not json",
      "utf8",
    );
    process.argv = [
      process.execPath,
      "dist/cli.js",
      "--no-dotenv",
      "--state-root",
      stateRoot,
      "mirror",
      "bundle-explain",
      "broken-bundle",
    ];
    await assert.rejects(
      cliInternals.main(),
      (error: unknown) =>
        !(error instanceof CliUsageError) &&
        error instanceof Error &&
        /Unexpected token|JSON/u.test(error.message),
      "internal errors must propagate as the original parse error (corrupt lock file)",
    );
  } finally {
    process.argv = originalArgv;
  }
});
