import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createIsolatedCliEnvironment,
  repositoryRoot,
  runBuiltCli,
} from "./built-cli-harness.js";
import { runDiscover } from "../discover.js";

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

    assert.match(stdout, /discover demand-profile/u);
    assert.match(stdout, /Scan workspace for demand signals/u);
    assert.doesNotMatch(stdout, /discover commands:/u);
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
      /install commands \(stage is a legacy alias\):/u,
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

void test("recommend report --help shows report-specific help (#416)", async () => {
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

    assert.match(stdout, /recommend report/u);
    assert.match(stdout, /recommendation report/u);
    assert.match(stdout, /--ai-review/u);
    assert.equal(existsSync(stateRoot), false);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("recommend evaluate --help shows evaluate-specific help (#416)", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-help-"));

  try {
    const { workspaceRoot, stateRoot, env } =
      await createIsolatedCliEnvironment(tempRoot, { createStateRoot: false });
    const { stdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["recommend", "evaluate", "--help"],
    });

    assert.match(stdout, /recommend evaluate/u);
    assert.match(stdout, /golden recommendation fixtures/u);
    assert.match(stdout, /--write/u);
    assert.equal(existsSync(stateRoot), false);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("recommend unknown-subcommand --help shows parent help (#416)", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-help-"));

  try {
    const { workspaceRoot, stateRoot, env } =
      await createIsolatedCliEnvironment(tempRoot, { createStateRoot: false });
    const { stdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["recommend", "unknown", "--help"],
    });

    assert.match(stdout, /recommend commands:/u);
    assert.equal(existsSync(stateRoot), false);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("recommend ai-review --help shows ai-review-specific help (#416)", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-help-"));

  try {
    const { workspaceRoot, stateRoot, env } =
      await createIsolatedCliEnvironment(tempRoot, { createStateRoot: false });
    const { stdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["recommend", "ai-review", "--help"],
    });

    assert.match(stdout, /recommend ai-review/u);
    assert.match(stdout, /AI review/u);
    assert.match(stdout, /--apply/u);
    assert.equal(existsSync(stateRoot), false);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("recommend policy:print --help shows policy-print-specific help (#416)", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-help-"));

  try {
    const { workspaceRoot, stateRoot, env } =
      await createIsolatedCliEnvironment(tempRoot, { createStateRoot: false });
    const { stdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["recommend", "policy:print", "--help"],
    });

    assert.match(stdout, /recommend policy:print/u);
    assert.match(stdout, /--host/u);
    assert.match(stdout, /--compact/u);
    assert.equal(existsSync(stateRoot), false);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("stage refresh --help shows install heading (legacy alias consistency) (#417)", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-help-"));

  try {
    const { workspaceRoot, stateRoot, env } =
      await createIsolatedCliEnvironment(tempRoot, { createStateRoot: false });
    const { stdout } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["stage", "refresh", "--help"],
    });

    // Even when invoked via legacy 'stage' alias, help should show 'install'
    assert.match(stdout, /install refresh/u);
    assert.match(stdout, /Refresh staged install state/u);
    assert.equal(existsSync(stateRoot), false);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("discover full --help documents --sync-all flag (#419)", async () => {
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

    assert.match(stdout, /--sync-all/u);
    assert.match(stdout, /demand-based filtering/u);
    assert.equal(existsSync(stateRoot), false);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("subcommand --help shows subcommand-specific help distinct from parent (#383)", async () => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-subcommand-help-"),
  );

  try {
    const { workspaceRoot, stateRoot, env } =
      await createIsolatedCliEnvironment(tempRoot, { createStateRoot: false });

    // mirror locks --help should show locks-specific help, not parent mirror index
    const { stdout: mirrorLocks } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["mirror", "locks", "--help"],
    });
    assert.match(mirrorLocks, /mirror locks/u);
    assert.match(mirrorLocks, /Generate bundle lock files/u);
    assert.doesNotMatch(mirrorLocks, /mirror commands:/u);
    assert.doesNotMatch(mirrorLocks, /Mirror locks generated/u);

    // mirror plan --help should show plan-specific help
    const { stdout: mirrorPlan } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["mirror", "plan", "--help"],
    });
    assert.match(mirrorPlan, /mirror plan/u);
    assert.match(mirrorPlan, /Summarize mirror readiness/u);
    assert.doesNotMatch(mirrorPlan, /mirror commands:/u);

    // mirror bundle-explain --help should show bundle-explain-specific help
    const { stdout: mirrorBundleExplain } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["mirror", "bundle-explain", "--help"],
    });
    assert.match(mirrorBundleExplain, /bundle explain/u);
    assert.match(mirrorBundleExplain, /bundle membership/u);
    assert.doesNotMatch(mirrorBundleExplain, /mirror commands:/u);

    // install bundle --help should show bundle-specific help
    const { stdout: stageBundle } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["install", "bundle", "--help"],
    });
    assert.match(stageBundle, /install bundle/u);
    assert.match(stageBundle, /Stage mirrored assets from bundle locks/u);
    assert.doesNotMatch(
      stageBundle,
      /install commands \(stage is a legacy alias\):/u,
    );

    // activate host --help should show host-specific help
    const { stdout: activateHost } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["activate", "host", "--help"],
    });
    assert.match(activateHost, /activate host/u);
    assert.match(activateHost, /Materialize active host views/u);
    assert.doesNotMatch(activateHost, /activate commands:/u);

    // discover sources --help should show sources-specific help
    const { stdout: discoverSources } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["discover", "sources", "--help"],
    });
    assert.match(discoverSources, /discover sources/u);
    assert.match(discoverSources, /Refresh the discovery source index/u);
    assert.doesNotMatch(discoverSources, /discover commands:/u);

    // discover demand-profile --help should show demand-profile-specific help
    const { stdout: discoverDemand } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["discover", "demand-profile", "--help"],
    });
    assert.match(discoverDemand, /discover demand-profile/u);
    assert.match(discoverDemand, /Scan workspace for demand signals/u);
    assert.doesNotMatch(discoverDemand, /discover commands:/u);

    // discover sync --help should show sync-specific help
    const { stdout: discoverSync } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["discover", "sync", "--help"],
    });
    assert.match(discoverSync, /discover sync/u);
    assert.match(discoverSync, /Synchronize discovered sources/u);
    assert.doesNotMatch(discoverSync, /discover commands:/u);

    // install refresh --help should show refresh-specific help
    const { stdout: stageRefresh } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["install", "refresh", "--help"],
    });
    assert.match(stageRefresh, /install refresh/u);
    assert.match(stageRefresh, /Refresh staged install state/u);
    assert.doesNotMatch(
      stageRefresh,
      /install commands \(stage is a legacy alias\):/u,
    );

    // activate diff --help should show diff-specific help
    const { stdout: activateDiff } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["activate", "diff", "--help"],
    });
    assert.match(activateDiff, /activate diff/u);
    assert.match(activateDiff, /Compare activation states/u);
    assert.doesNotMatch(activateDiff, /activate commands:/u);

    // activate reset --help should show reset-specific help
    const { stdout: activateReset } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["activate", "reset", "--help"],
    });
    assert.match(activateReset, /activate reset/u);
    assert.match(activateReset, /Remove activation outputs/u);
    assert.doesNotMatch(activateReset, /activate commands:/u);

    // quarantine list --help should show list-specific help
    const { stdout: quarantineList } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["quarantine", "list", "--help"],
    });
    assert.match(quarantineList, /quarantine list/u);
    assert.match(quarantineList, /List quarantined mirror artifacts/u);

    // quarantine approve --help should show approve-specific help
    const { stdout: quarantineApprove } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["quarantine", "approve", "--help"],
    });
    assert.match(quarantineApprove, /quarantine approve/u);
    assert.match(quarantineApprove, /Approve a quarantined artifact/u);

    // rebuild clean --help should show clean-specific help
    const { stdout: rebuildClean } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["rebuild", "clean", "--help"],
    });
    assert.match(rebuildClean, /rebuild clean/u);
    assert.match(rebuildClean, /Remove all generated state/u);

    // rebuild full --help should show full-specific help
    const { stdout: rebuildFull } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["rebuild", "full", "--help"],
    });
    assert.match(rebuildFull, /rebuild full/u);
    assert.match(rebuildFull, /Full clean rebuild from sources/u);

    // workspace opencode --help should show host-specific help
    const { stdout: workspaceOc } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["workspace", "opencode", "--help"],
    });
    assert.match(workspaceOc, /workspace opencode/u);
    assert.match(workspaceOc, /Run full pipeline for OpenCode/u);

    // wire cursor --help should show host-specific help
    const { stdout: wireCursor } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["wire", "cursor", "--help"],
    });
    assert.match(wireCursor, /wire cursor/u);
    assert.match(wireCursor, /Wire activated assets into Cursor/u);

    // setup doctor --help should show doctor-specific help
    const { stdout: setupDoctor } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["setup", "doctor", "--help"],
    });
    assert.match(setupDoctor, /setup doctor/u);
    assert.match(setupDoctor, /Check host CLI readiness/u);

    // setup hosts --help should show hosts-specific help
    const { stdout: setupHosts } = await runBuiltCli({
      cwd: workspaceRoot,
      env,
      stateRoot,
      timeout: 30_000,
      args: ["setup", "hosts", "--help"],
    });
    assert.match(setupHosts, /setup hosts/u);
    assert.match(setupHosts, /List registered host adapters/u);

    // Subcommand --help must not create any state
    assert.equal(
      existsSync(stateRoot),
      false,
      "stateRoot must not be created by --help",
    );
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("discover full --no-sync skips source sync and prints warning (#382)", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-nosync-"));

  try {
    const { workspaceRoot, stateRoot } = await createIsolatedCliEnvironment(
      tempRoot,
      { createStateRoot: true },
    );

    await writeFile(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "test-nosync", version: "1.0.0" }),
      "utf8",
    );

    // Seed an EMPTY offline source universe before the run, mirroring the
    // workspace-setup-rebuild-flows suites. This keeps the discovery pass
    // fully local: the catalog phase must not touch live registries, so the
    // test is deterministic instead of depending on network latency/rate
    // limits (a cold-root spawn with the checked-in source defaults used to
    // take 90–180s of live harvesting and flaked under load).
    await mkdir(join(stateRoot, "discover"), { recursive: true });
    await writeFile(
      join(stateRoot, "discover", "sources.json"),
      JSON.stringify({ schemaVersion: 1, sources: [] }),
      "utf8",
    );
    await writeFile(
      join(stateRoot, "discover", "selections.json"),
      JSON.stringify({
        schemaVersion: 1,
        selectionPolicies: {
          officialBeatsPopularity: true,
          starsAreTieBreakerOnly: true,
          preferNativeOverAdaptable: true,
          preferLowerRiskWhenEquivalent: true,
          preferLowerContextCostWhenEquivalent: true,
          communityDefaultPolicy: "catalog-only-unless-promoted",
        },
        rankingOrder: [],
        duplicateGroups: [],
      }),
      "utf8",
    );

    const warnings: string[] = [];
    const stderrLines: string[] = [];
    const originalWarn = console.warn;
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((value) => String(value)).join(" "));
    };
    process.stderr.write = (
      chunk: Uint8Array | string,
      encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void,
    ): boolean => {
      if (typeof chunk === "string") {
        stderrLines.push(chunk);
      }
      if (typeof encodingOrCb === "function") {
        return originalStderrWrite(chunk, encodingOrCb);
      }
      if (encodingOrCb !== undefined) {
        return originalStderrWrite(chunk, encodingOrCb, cb);
      }
      return originalStderrWrite(chunk);
    };

    let exitCode = -1;
    try {
      exitCode = await runDiscover(
        ["full", "--no-sync"],
        workspaceRoot,
        stateRoot,
      );
    } finally {
      console.warn = originalWarn;
      process.stderr.write = originalStderrWrite;
    }

    assert.equal(exitCode, 0);
    assert.ok(
      [...warnings, ...stderrLines].some((line) =>
        line.includes("--no-sync: skipping indexed source sync"),
      ),
      "must print --no-sync warning",
    );

    // The sync phase must not have been executed: no source-sync state file
    // may exist for an empty universe.
    const syncStatePath = join(
      stateRoot,
      "discover",
      "output",
      "source-sync.json",
    );
    const syncStateExists = await readFile(syncStatePath, "utf8").then(
      () => true,
      () => false,
    );
    assert.equal(syncStateExists, false);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});
