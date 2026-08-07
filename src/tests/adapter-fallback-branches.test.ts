/**
 * Adapter fallback-branch coverage (#428 follow-up): the three call sites
 * that compute `requiresLifecycleHostPaths ?? mutatesHostPaths` (wire.ts,
 * workspace.ts, setup doctor) plus the setup login-guidance / hosts-table
 * runtime-metadata branches. `requiresLifecycleHostPaths` is OPTIONAL on
 * HostAdapter, so the `??` fallback is live behavior for adapters that only
 * declare `mutatesHostPaths` — covered here with fixture adapters injected
 * through the registry seam instead of c8-ignores.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { HostAdapter } from "../host-adapters/registry.js";
import {
  listHostAdapters,
  resolveHostAdapter,
  setHostAdaptersForTests,
} from "../host-adapters/registry.js";
import { runSetup } from "../setup.js";
import { runWire } from "../wire.js";
import { runWorkspace } from "../workspace.js";

/** Fixture adapter WITHOUT requiresLifecycleHostPaths (fallback live branch). */
function buildFallbackAdapter(id: string): HostAdapter {
  return {
    id,
    aliases: [],
    displayName: `Fallback Adapter ${id}`,
    lifecycleHost: "opencode",
    recommendationHost: "opencode",
    defaultBundleIds: [],
    mutatesHostPaths: true,
    // requiresLifecycleHostPaths deliberately omitted: exercises the ?? arm.
    runtime: {
      executable: "fixture-cli",
      versionArgs: ["--version"],
    },
    capabilities: [{ assetKind: "skill", behaviors: ["stage", "wire"] }],
    wire: async () => {},
  };
}

/** Fixture adapter with runtime metadata but no versionArgs/readinessArgs/guidance. */
function buildPartialRuntimeAdapter(id: string): HostAdapter {
  return {
    id,
    aliases: [],
    displayName: `Partial Runtime Adapter ${id}`,
    lifecycleHost: "opencode",
    recommendationHost: "opencode",
    defaultBundleIds: [],
    mutatesHostPaths: false,
    requiresLifecycleHostPaths: false,
    runtime: {
      executable: "partial-cli",
      // no versionArgs / readinessArgs / guidance on purpose
    },
    capabilities: [{ assetKind: "skill", behaviors: ["stage", "wire"] }],
    wire: async () => {},
  };
}

function withFixtureAdapters<T>(
  fixtureAdapters: HostAdapter[],
  fn: () => Promise<T>,
): Promise<T> {
  const snapshot = listHostAdapters();
  setHostAdaptersForTests([...snapshot, ...fixtureAdapters]);
  return fn().finally(() => {
    setHostAdaptersForTests(snapshot);
  });
}

async function makeStateRoot(): Promise<{
  root: string;
  workspaceRoot: string;
  stateRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-adapter-fallback-"));
  const workspaceRoot = join(root, "workspace");
  const stateRoot = join(root, "state");
  return { root, workspaceRoot, stateRoot };
}

// ─── wire.ts: requiresLifecycleHostPaths ?? mutatesHostPaths (#428) ──────────

void test("wire preview resolves requiresLifecycleHostPaths through the mutatesHostPaths fallback", async (t) => {
  const { root, workspaceRoot, stateRoot } = await makeStateRoot();
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await withFixtureAdapters(
    [buildFallbackAdapter("fallback-wire")],
    async () => {
      assert.ok(
        resolveHostAdapter("fallback-wire"),
        "fixture adapter registered",
      );
      const code = await runWire(["fallback-wire"], workspaceRoot, stateRoot);
      assert.equal(code, 0, "wire preview completes with the fallback adapter");
    },
  );
});

void test("wire reset mode takes the reset diagnostics arm", async (t) => {
  const { root, workspaceRoot, stateRoot } = await makeStateRoot();
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await withFixtureAdapters(
    [buildFallbackAdapter("fallback-reset")],
    async () => {
      const code = await runWire(
        ["fallback-reset", "--reset"],
        workspaceRoot,
        stateRoot,
      );
      assert.equal(code, 0, "wire --reset completes through the reset arm");
    },
  );
});

// ─── workspace.ts: requiresLifecycleHostPaths ?? mutatesHostPaths (#428) ─────

void test("workspace resolves requiresLifecycleHostPaths through the mutatesHostPaths fallback", async (t) => {
  const { root, workspaceRoot, stateRoot } = await makeStateRoot();
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const { mkdir } = await import("node:fs/promises");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(join(stateRoot, "discover"), { recursive: true });
  await mkdir(join(stateRoot, "mirror"), { recursive: true });

  // Minimal sources/selection inputs so the pipeline can start.
  await writeFile(
    join(stateRoot, "discover", "sources.json"),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sources: [],
    }),
  );
  await writeFile(
    join(stateRoot, "discover", "selections.json"),
    JSON.stringify({
      schemaVersion: 1,
      selectionPolicies: {},
    }),
  );
  await writeFile(
    join(stateRoot, "mirror", "policy.json"),
    JSON.stringify({
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
    }),
  );

  // The fallback adapter's lifecycleHost is opencode; the fixture declares
  // mutatesHostPaths without requiresLifecycleHostPaths. Stub the preflight
  // trio to fast-fail BEFORE the full workspace pipeline: the
  // requiresLifecycleHostPaths fallback (the branch under test) runs before
  // preflight, and the error diagnostic stops the run at
  // assertNoPreflightErrors instead of needing complete pipeline state.
  await withFixtureAdapters(
    [buildFallbackAdapter("fallback-workspace")],
    async () => {
      await assert.rejects(
        () =>
          runWorkspace(["fallback-workspace"], workspaceRoot, stateRoot, {
            runHostPreflight: async () => [
              {
                severity: "error",
                code: "test-fast-fail",
                message: "intentional preflight failure",
              },
            ],
            runAdapterPreflight: async () => [],
            collectActivatedAssetPrerequisiteDiagnostics: async () => [],
          }),
        /test-fast-fail/u,
        "workspace surfaces the intentional preflight failure",
      );
    },
  );
});

// ─── setup doctor: requiresLifecycleHostPaths ?? mutatesHostPaths (#428) ─────

void test("setup doctor prints the requiresLifecycleHostPaths fallback for adapters without the field", async (t) => {
  const { root, stateRoot } = await makeStateRoot();
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const lines: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(" "));
  });
  const stderrLines: string[] = [];
  t.mock.method(globalThis.console, "error", (...args: unknown[]) => {
    stderrLines.push(args.map((value) => String(value)).join(" "));
  });

  await withFixtureAdapters(
    [buildFallbackAdapter("fallback-doctor")],
    async () => {
      const code = await runSetup(
        ["doctor", "--host", "fallback-doctor"],
        stateRoot,
      );
      assert.equal(code, 0);
    },
  );

  assert.ok(
    lines.some((line) => line.includes("Requires lifecycle host paths: true")),
    `expected the mutatesHostPaths fallback to print, got: ${lines.join("\n")}`,
  );
  void stderrLines;
});

// ─── setup login guidance: adapter runtime.guidance branch (#428) ────────────

void test("setup login falls back to generic guidance when adapter runtime has no guidance", async (t) => {
  const { root, stateRoot } = await makeStateRoot();
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });

  await withFixtureAdapters(
    [buildPartialRuntimeAdapter("partial-login")],
    async () => {
      const code = await runSetup(
        ["login", "--provider", "partial-login"],
        stateRoot,
      );
      assert.equal(code, 0);
    },
  );

  assert.ok(
    output.some((line) => line.includes("setup doctor --host partial-login")),
    `expected adapter guidance fallback output, got: ${output.join("\n")}`,
  );
});

// ─── setup hosts: printHosts runtime-metadata branches (#428) ────────────────

void test("setup hosts prints runtime capabilities and none-placeholders for partial-runtime adapters", async (t) => {
  const { root, stateRoot } = await makeStateRoot();
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });

  await withFixtureAdapters(
    [buildPartialRuntimeAdapter("partial-hosts")],
    async () => {
      const code = await runSetup(["hosts"], stateRoot);
      assert.equal(code, 0);
    },
  );

  assert.ok(
    output.some((line) => line.includes("partial-hosts")),
    `expected hosts table to include the fixture, got: ${output.join("\n")}`,
  );
  assert.ok(
    output.some(
      (line) =>
        line.includes("runtimeChecks=none") ||
        line.includes("runtime=partial-cli"),
    ),
    `expected runtime placeholder arms for the partial adapter, got: ${output.join("\n")}`,
  );
});
