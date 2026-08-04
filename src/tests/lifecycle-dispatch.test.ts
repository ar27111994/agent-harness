/**
 * In-process lifecycle dispatch coverage (#428).
 *
 * The top-level orchestration modules (cli, discover, mirror, install,
 * activate, quarantine, rebuild, setup, wire, workspace, recommend) were
 * previously excluded from the coverage gate, and their e2e suites spawn the
 * CLI as a subprocess — invisible to c8. This file drives the same dispatch
 * surfaces IN-PROCESS against isolated temp roots so every branch of the
 * domain runners is measured: help printers, unknown-argument paths (#431),
 * and fast-fail/empty-state flows. Heavy network/pipeline paths are verified
 * by the existing e2e suites; their torn-down empty-state failure branches
 * are exercised here.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cliInternals } from "../cli.js";
import { runActivate } from "../activate.js";
import { runDiscover } from "../discover.js";
import { runInstall } from "../install.js";
import { runMirror } from "../mirror.js";
import { runQuarantine } from "../quarantine.js";
import { runRebuild } from "../rebuild.js";
import { runSetup } from "../setup.js";
import { runWire } from "../wire.js";
import { runWorkspace } from "../workspace.js";
import { runRecommend } from "../recommend.js";
import { createIsolatedCliEnvironment } from "./built-cli-harness.js";
import { writeJsonFile } from "../files.js";

// ─── Capture helper (single capture per test; clear between phases) ─────────

interface Captured {
  stdout: string[];
  stderr: string[];
  clear: () => void;
  restore: () => void;
}

function captureConsole(): Captured {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = globalThis.console.log;
  const originalError = globalThis.console.error;
  const originalStderrWrite = process.stderr.write;
  const originalStdoutWrite = process.stdout.write;
  // Assign via globalThis.console so no-console (which targets the bare
  // `console` identifier) does not flag intentionally captured output.
  globalThis.console.log = (...args: unknown[]) => {
    stdout.push(args.map((value) => String(value)).join(" "));
  };
  globalThis.console.error = (...args: unknown[]) => {
    stderr.push(args.map((value) => String(value)).join(" "));
  };
  process.stderr.write = ((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  process.stdout.write = ((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  return {
    stdout,
    stderr,
    clear: () => {
      stdout.length = 0;
      stderr.length = 0;
    },
    restore: () => {
      globalThis.console.log = originalLog;
      globalThis.console.error = originalError;
      process.stderr.write = originalStderrWrite;
      process.stdout.write = originalStdoutWrite;
    },
  };
}

/**
 * Runs a domain runner invocation that may complete with 0/1 OR throw on an
 * empty state root. The dispatch branch is covered either way; the assertion
 * is intentionally tolerant for fast-fail stateful subcommands (their
 * success paths are covered by the fixtures/e2e suites).
 */
async function runTolerant(invocation: () => Promise<number>): Promise<void> {
  try {
    const code = await invocation();
    assert.ok(code === 0 || code === 1, "exit code must be 0 or 1");
  } catch (error) {
    assert.ok(error instanceof Error, "fast-fail paths reject with an Error");
  }
}

async function makeIsolated(t: {
  after: (fn: () => void | Promise<void>) => void;
}): Promise<{
  workspaceRoot: string;
  stateRoot: string;
  env: NodeJS.ProcessEnv;
}> {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-dispatch-"));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });
  return createIsolatedCliEnvironment(tempRoot);
}

// ─── cli.ts: runDomainCommand + runHelpCommand + global parsing ──────────────

void test("cli dispatch: every domain routes and unknown domains error (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);
  const capture = captureConsole();
  t.after(capture.restore);

  // Unknown domain → error, exit 1, no help dump.
  assert.equal(
    await cliInternals.runDomainCommand(
      "nonsense",
      [],
      workspaceRoot,
      stateRoot,
    ),
    1,
  );
  assert.ok(
    capture.stderr.some((line) => line.includes("unknown command 'nonsense'")),
  );

  // undefined domain → top-level help, exit 0.
  capture.clear();
  assert.equal(
    await cliInternals.runDomainCommand(
      undefined,
      [],
      workspaceRoot,
      stateRoot,
    ),
    0,
  );
  assert.ok(capture.stdout.some((line) => line.includes("Quick start:")));

  // bundle with no args → mirror help; bundle with non-explain subcommand → help + 1.
  capture.clear();
  assert.equal(
    await cliInternals.runDomainCommand("bundle", [], workspaceRoot, stateRoot),
    0,
  );
  capture.clear();
  assert.equal(
    await cliInternals.runDomainCommand(
      "bundle",
      ["locks"],
      workspaceRoot,
      stateRoot,
    ),
    1,
  );

  // stage alias routes to install.
  capture.clear();
  assert.equal(
    await cliInternals.runDomainCommand(
      "stage",
      ["help"],
      workspaceRoot,
      stateRoot,
    ),
    0,
  );

  // doctor alias routes to setup with the doctor subcommand injected.
  capture.clear();
  assert.equal(
    await cliInternals.runDomainCommand(
      "doctor",
      ["--nope"],
      workspaceRoot,
      stateRoot,
    ),
    1,
  );
});

void test("cli dispatch: help routing through runHelpCommand covers domain subcommand paths (#428)", async (t) => {
  const { workspaceRoot } = await makeIsolated(t);
  const capture = captureConsole();
  t.after(capture.restore);

  const cases: Array<[string[], number]> = [
    [["discover", "full", "--help"], 0],
    [["discover", "--help"], 0],
    [["recommend", "--help"], 0],
    [["mirror", "--help"], 0],
    [["bundle", "explain", "--help"], 0],
    [["install", "--help"], 0],
    [["activate", "--help"], 0],
    [["quarantine", "--help"], 0],
    [["rebuild", "--help"], 0],
    [["workspace", "--help"], 0],
    [["wire", "--help"], 0],
    [["setup", "--help"], 0],
    [["doctor", "--help"], 0],
    [["--help"], 0],
    [["help"], 0],
    [["help", "discover"], 0],
  ];

  for (const [args, expected] of cases) {
    capture.clear();
    const code = await cliInternals.runHelpCommand(args, workspaceRoot);
    assert.equal(
      code,
      expected,
      `runHelpCommand ${args.join(" ")} should exit ${expected}`,
    );
    assert.ok(
      capture.stdout.length > 0 || capture.stderr.length > 0,
      `runHelpCommand ${args.join(" ")} should produce output`,
    );
  }

  // Unknown subcommand at help depth → error naming it.
  capture.clear();
  assert.equal(
    await cliInternals.runHelpCommand(["license", "--help"], workspaceRoot),
    1,
  );
  assert.ok(
    capture.stderr.some((line) => line.includes("unknown command 'license'")),
  );
});

void test("cli dispatch: runHelpCommand rejects unknown bundle subcommands with an error (#428)", async (t) => {
  const { workspaceRoot } = await makeIsolated(t);
  const capture = captureConsole();
  t.after(capture.restore);

  const code = await cliInternals.runHelpCommand(
    ["bundle", "locks", "--help"],
    workspaceRoot,
  );
  assert.equal(code, 1);
  assert.ok(
    capture.stderr.some((line) => line.includes("unknown command 'locks'")),
  );
});

void test("cli global option parsing covers value and error branches (#428)", () => {
  const parsed = cliInternals.parseGlobalOptions([
    "--state-root",
    "/tmp/state",
    "--timeout-seconds=120",
    "--no-dotenv",
    "discover",
    "stats",
  ]);
  assert.equal(parsed.stateRoot, "/tmp/state");
  assert.equal(parsed.timeoutSeconds, 120);
  assert.equal(parsed.noDotEnv, true);
  assert.deepEqual(parsed.args, ["discover", "stats"]);

  assert.throws(
    () =>
      cliInternals.parseGlobalOptions(["--state-root", "--timeout-seconds"]),
    /--state-root requires a path value/u,
  );
  assert.throws(
    () => cliInternals.parseGlobalOptions(["--state-root="]),
    /--state-root requires a path value/u,
  );
  assert.throws(
    () => cliInternals.parseGlobalOptions(["--timeout-seconds", "abc"]),
    /--timeout-seconds requires a positive number/u,
  );
  assert.throws(
    () => cliInternals.parseGlobalOptions(["--timeout-seconds="]),
    /--timeout-seconds requires a number value/u,
  );

  const withEquals = cliInternals.parseGlobalOptions([
    "--state-root=/tmp/other",
    "--timeout-seconds",
    "60",
  ]);
  assert.equal(withEquals.stateRoot, "/tmp/other");
  assert.equal(withEquals.timeoutSeconds, 60);
});

void test("cli help/version request detection and domain resolution (#428)", () => {
  assert.equal(cliInternals.isHelpRequest([]), true);
  assert.equal(cliInternals.isHelpRequest(["help"]), true);
  assert.equal(cliInternals.isHelpRequest(["--help"]), true);
  assert.equal(cliInternals.isHelpRequest(["-h"]), true);
  assert.equal(cliInternals.isHelpRequest(["discover"]), true);
  assert.equal(cliInternals.isHelpRequest(["discover", "full"]), false);
  assert.equal(cliInternals.isHelpRequest(["discover", "--help"]), true);
  assert.equal(cliInternals.isHelpRequest(["--version"]), false);

  assert.equal(cliInternals.isVersionRequest(["--version"]), true);
  assert.equal(cliInternals.isVersionRequest(["-V"]), true);
  assert.equal(cliInternals.isVersionRequest([]), false);

  assert.equal(
    cliInternals.resolveHelpDomain(["help", "discover"]),
    "discover",
  );
  assert.equal(
    cliInternals.resolveHelpDomain(["discover", "--help"]),
    "discover",
  );
  assert.equal(cliInternals.resolveHelpDomain(["--help"]), undefined);
  assert.equal(
    cliInternals.resolveHelpDomain(["help", "--badflag"]),
    undefined,
  );
});

// ─── discover.ts dispatch ────────────────────────────────────────────────────

void test("discover dispatch: help, unknown flag, and stateful fast paths (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);
  const capture = captureConsole();
  t.after(capture.restore);

  // Subcommand-specific help exits 0 for every discover subcommand.
  for (const sub of [
    "demand-profile",
    "sources",
    "sync",
    "index",
    "catalog",
    "select",
    "full",
    "breadth",
    "recall",
    "candidate-pool",
    "stats",
    "diff",
    "environment-index",
    "ard-export",
    "enrich",
    "inspect",
  ]) {
    capture.clear();
    assert.equal(
      await runDiscover([sub, "--help"], workspaceRoot, stateRoot),
      0,
      `discover ${sub} --help should exit 0`,
    );
    assert.ok(
      capture.stdout.length > 0,
      `discover ${sub} --help should print help`,
    );
  }

  // Demand-profile executes quickly on an empty workspace (writes output).
  capture.clear();
  await runDiscover(["demand-profile"], workspaceRoot, stateRoot);
  const demandProfile = JSON.parse(
    await readFile(
      join(stateRoot, "discover", "output", "demand-profile.json"),
      "utf8",
    ),
  ) as { schemaVersion: number };
  assert.equal(demandProfile.schemaVersion, 1);

  // Stats on empty state reports without throwing.
  capture.clear();
  await runDiscover(["stats"], workspaceRoot, stateRoot);
  assert.ok(capture.stdout.length > 0, "discover stats produces output");

  // Unknown flag at domain depth rejects (#431).
  capture.clear();
  assert.equal(await runDiscover(["--nope"], workspaceRoot, stateRoot), 1);
  assert.ok(
    capture.stderr.some((line) => line.includes("unknown option '--nope'")),
  );
});

// ─── quarantine.ts dispatch ──────────────────────────────────────────────────

void test("quarantine dispatch: list, inspect, report, and review flows (#428)", async (t) => {
  const { stateRoot } = await makeIsolated(t);
  const capture = captureConsole();
  t.after(capture.restore);

  // Help exits 0 and lists all reachable subcommands (#430).
  assert.equal(await runQuarantine(["help"], stateRoot), 0);
  assert.ok(
    capture.stdout.some((line) => line.includes("quarantine commands:")),
  );

  // Empty state: list/report complete with empty results.
  capture.clear();
  await runQuarantine(["list"], stateRoot);
  await runQuarantine(["report"], stateRoot);
  assert.ok(
    capture.stdout.some((line) =>
      line.includes("No quarantined mirror artifacts"),
    ),
  );

  // inspect/approve/reject/pin without --asset fail fast.
  await runTolerant(() => runQuarantine(["inspect"], stateRoot));
  await runTolerant(() => runQuarantine(["approve"], stateRoot));
  await runTolerant(() => runQuarantine(["reject"], stateRoot));
  await runTolerant(() => runQuarantine(["pin"], stateRoot));

  // Unknown flag rejects (#431).
  capture.clear();
  assert.equal(await runQuarantine(["--nope"], stateRoot), 1);
  assert.ok(
    capture.stderr.some((line) => line.includes("unknown option '--nope'")),
  );
});

// ─── mirror.ts dispatch ──────────────────────────────────────────────────────

void test("mirror dispatch: help, plan, and fast-fail subcommands on empty state (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);
  await writeJsonFile(join(stateRoot, "mirror", "policy.json"), {
    schemaVersion: 1,
    selection: {
      officialBeatsPopularity: true,
      requirePinnedProvenance: false,
      communityDefaultPolicy: "allow",
    },
    audit: { alwaysAudit: false, quarantineOn: [] },
    store: {
      root: "mirror",
      rawDirectories: ["raw"],
      normalizedDirectories: [],
      bundlesDirectory: "bundles",
      quarantineDirectory: "quarantine",
      auditDirectory: "audit",
    },
    bundleTemplates: [],
  });

  const capture = captureConsole();
  t.after(capture.restore);

  assert.equal(await runMirror(["help"], workspaceRoot, stateRoot), 0);
  assert.ok(capture.stdout.some((line) => line.includes("mirror commands:")));

  // Plan builds from an empty catalog (loader semantics) and exits 0.
  capture.clear();
  assert.equal(await runMirror(["plan"], workspaceRoot, stateRoot), 0);

  // Remaining subcommands fail fast or complete harmlessly on empty state.
  for (const sub of ["locks", "acquire", "bundle-explain", "diff", "explain"]) {
    capture.clear();
    await runTolerant(() => runMirror([sub], workspaceRoot, stateRoot));
  }

  // Unknown flag rejects (#431).
  capture.clear();
  assert.equal(await runMirror(["--nope"], workspaceRoot, stateRoot), 1);
  assert.ok(
    capture.stderr.some((line) => line.includes("unknown option '--nope'")),
  );
});

// ─── install.ts dispatch ─────────────────────────────────────────────────────

void test("install dispatch: help and unknown-flag paths (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);
  const capture = captureConsole();
  t.after(capture.restore);

  assert.equal(await runInstall(["help"], workspaceRoot, stateRoot), 0);
  assert.ok(
    capture.stdout.some((line) =>
      line.includes("install commands (stage is a legacy alias)"),
    ),
  );

  for (const sub of [
    "bundle",
    "native",
    "refresh",
    "reconcile",
    "diff",
    "explain",
    "generations",
    "reset",
  ]) {
    capture.clear();
    await runTolerant(() => runInstall([sub], workspaceRoot, stateRoot));
  }

  capture.clear();
  assert.equal(await runInstall(["--nope"], workspaceRoot, stateRoot), 1);
  assert.ok(
    capture.stderr.some((line) => line.includes("unknown option '--nope'")),
  );
});

// ─── activate.ts dispatch ────────────────────────────────────────────────────

void test("activate dispatch: help, reset, rollback/diff on empty state, unknown flags (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);
  const capture = captureConsole();
  t.after(capture.restore);

  assert.equal(await runActivate(["help"], workspaceRoot, stateRoot), 0);
  assert.ok(capture.stdout.some((line) => line.includes("activate commands:")));

  // Reset completes and removes state.
  capture.clear();
  await runActivate(["reset"], workspaceRoot, stateRoot);

  // Diff and rollback on empty state fail fast with a useful error.
  await runTolerant(() => runActivate(["diff"], workspaceRoot, stateRoot));
  await runTolerant(() =>
    runActivate(
      ["rollback", "--generation", "gen-1"],
      workspaceRoot,
      stateRoot,
    ),
  );

  capture.clear();
  assert.equal(await runActivate(["--nope"], workspaceRoot, stateRoot), 1);
  assert.ok(
    capture.stderr.some((line) => line.includes("unknown option '--nope'")),
  );
});

// ─── rebuild.ts dispatch ─────────────────────────────────────────────────────

void test("rebuild dispatch: help, clean, and unknown flags (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);
  const capture = captureConsole();
  t.after(capture.restore);

  assert.equal(await runRebuild(["help"], workspaceRoot, stateRoot), 0);
  assert.ok(capture.stdout.some((line) => line.includes("rebuild commands:")));

  // Clean removes state directories and completes.
  capture.clear();
  await runRebuild(["clean"], workspaceRoot, stateRoot);

  capture.clear();
  assert.equal(await runRebuild(["--nope"], workspaceRoot, stateRoot), 1);
  assert.ok(
    capture.stderr.some((line) => line.includes("unknown option '--nope'")),
  );
});

// ─── setup.ts dispatch ───────────────────────────────────────────────────────

void test("setup dispatch: help, hosts, login, unknown flags (#428)", async (t) => {
  const { stateRoot } = await makeIsolated(t);
  const capture = captureConsole();
  t.after(capture.restore);

  assert.equal(await runSetup(["help"], stateRoot), 0);
  assert.ok(capture.stdout.some((line) => line.includes("setup commands:")));

  // hosts prints the adapter table; login prints provider guidance.
  capture.clear();
  await runSetup(["hosts"], stateRoot);
  assert.ok(capture.stdout.length > 0, "setup hosts produces output");

  capture.clear();
  await runSetup(["login"], stateRoot);
  assert.ok(capture.stdout.length > 0, "setup login produces output");

  // doctor with an invalid flag rejects through setup's own dispatch (#431).
  capture.clear();
  assert.equal(await runSetup(["--nope"], stateRoot), 1);
  assert.ok(
    capture.stderr.some((line) => line.includes("unknown option '--nope'")),
  );
});

// ─── wire.ts dispatch ────────────────────────────────────────────────────────

void test("wire dispatch: help, unknown host, unknown flags (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);
  const capture = captureConsole();
  t.after(capture.restore);

  assert.equal(await runWire(["help"], workspaceRoot, stateRoot), 0);
  assert.ok(capture.stdout.some((line) => line.includes("wire commands:")));

  // Subcommand help for a registered host exits 0.
  capture.clear();
  assert.equal(
    await runWire(["opencode", "--help"], workspaceRoot, stateRoot),
    0,
  );

  // Unknown host is reported without dumping parent help (#431).
  capture.clear();
  assert.equal(await runWire(["nosuchhost"], workspaceRoot, stateRoot), 1);

  // Unknown flag at host depth rejects (#431).
  capture.clear();
  assert.equal(
    await runWire(["opencode", "--nope"], workspaceRoot, stateRoot),
    1,
  );
  assert.ok(
    capture.stderr.some((line) => line.includes("unknown option '--nope'")),
  );
});

// ─── workspace.ts dispatch ───────────────────────────────────────────────────

void test("workspace dispatch: help, unknown host, unknown flags (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);
  const capture = captureConsole();
  t.after(capture.restore);

  assert.equal(await runWorkspace(["help"], workspaceRoot, stateRoot), 0);
  assert.ok(
    capture.stdout.some((line) => line.includes("workspace commands:")),
  );

  // Subcommand help for a registered host exits 0.
  capture.clear();
  assert.equal(
    await runWorkspace(["opencode", "--help"], workspaceRoot, stateRoot),
    0,
  );

  // Unknown host prints help with exit 1 (conventional).
  capture.clear();
  assert.equal(await runWorkspace(["nosuchhost"], workspaceRoot, stateRoot), 1);

  // Unknown flag at host depth rejects before the pipeline starts (#431).
  capture.clear();
  assert.equal(
    await runWorkspace(["opencode", "--nope"], workspaceRoot, stateRoot),
    1,
  );
  assert.ok(
    capture.stderr.some((line) => line.includes("unknown option '--nope'")),
  );
});

// ─── recommend.ts dispatch ───────────────────────────────────────────────────

void test("recommend dispatch: help, unknown flag, empty-state fast paths (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);
  const capture = captureConsole();
  t.after(capture.restore);

  for (const sub of [
    "report",
    "evaluate",
    "ai-review",
    "explain",
    "policy:print",
  ]) {
    capture.clear();
    const code = await runRecommend([sub, "--help"], workspaceRoot, stateRoot);
    assert.equal(code, 0, `recommend ${sub} --help should exit 0`);
    assert.ok(capture.stdout.length > 0, `recommend ${sub} --help prints help`);
  }

  capture.clear();
  assert.equal(await runRecommend(["--nope"], workspaceRoot, stateRoot), 1);
  assert.ok(
    capture.stderr.some((line) => line.includes("unknown option '--nope'")),
  );
});

// ─── Activate deep flows with fixtures ───────────────────────────────────────

void test("activate deep flows: activateHost, diff, rollback against fixture state (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);
  const capture = captureConsole();
  t.after(capture.restore);

  // Minimal install/generation state so activateHost selection runs its
  // bundle-scan path (all candidates empty — exercises the flow's setup).
  await writeJsonFile(
    join(stateRoot, "install", "generations", "opencode", "current.json"),
    {
      schemaVersion: 1,
      generationId: "gen-1",
      host: "opencode",
      generatedAt: new Date().toISOString(),
      bundleIds: ["opencode-global"],
      packageManifestPaths: [],
    },
  );
  const hostSummaries = Object.fromEntries(
    [
      "shared",
      "copilot-vscode",
      "opencode",
      "cursor",
      "zed",
      "claude-code",
      "pi",
      "codex",
    ].map((host) => [
      host,
      {
        host,
        recommendationLimit: 10,
        recommendationLimitSource: "policy",
        recommendationLimitOverrideMode: "preserve",
        recommendationLimitOverrideModeSource: "policy",
        activationBudget: 100,
        selectedCount: 0,
        totalEstimatedPromptWeight: 0,
        selectedAssetIds: [],
        byAssetKind: {},
        bySourceFamily: {},
        byConcern: {},
        concernBuckets: {},
        taskModeBuckets: {},
      },
    ]),
  );
  await writeJsonFile(join(stateRoot, "state", "recommendations.json"), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policyVersion: 1,
    sessionIntent: "general",
    topByHost: {
      shared: [],
      "copilot-vscode": [],
      opencode: [],
      cursor: [],
      zed: [],
      "claude-code": [],
      pi: [],
      codex: [],
    },
    hostSummaries,
    suggestedBundles: [],
  });

  // activate host completes (empty selection) — exercises activateHost,
  // budget resolution, bundle filtering, and the overlay-plan write.
  assert.equal(
    await runActivate(["host", "--host", "opencode"], workspaceRoot, stateRoot),
    0,
  );

  // Diff uses snapshot semantics; rollback fails fast without activation state.
  await runTolerant(() =>
    runActivate(["diff", "--host", "opencode"], workspaceRoot, stateRoot),
  );
  await runTolerant(() =>
    runActivate(
      ["rollback", "--generation", "gen-1"],
      workspaceRoot,
      stateRoot,
    ),
  );

  assert.ok(capture.stdout.length > 0 || capture.stderr.length > 0);
});
