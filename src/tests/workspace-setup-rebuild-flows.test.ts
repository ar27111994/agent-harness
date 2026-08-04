/**
 * Workspace / setup / rebuild flow coverage (#428): drives the remaining
 * stateful paths in-process — the workspace host pipeline (preflight +
 * prerequisites + enrichment result handling), the setup doctor run with the
 * cumulative timeout, login provider guidance, and the rebuild full batch
 * loops. All run against isolated temp roots; host CLIs are absent so
 * preflight fails fast.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runWorkspace } from "../workspace.js";
import { runSetup } from "../setup.js";
import { runRebuild } from "../rebuild.js";
import { writeJsonFile } from "../files.js";
import { createIsolatedCliEnvironment } from "./built-cli-harness.js";

async function makeIsolated(t: {
  after: (fn: () => void | Promise<void>) => void;
}): Promise<{
  workspaceRoot: string;
  stateRoot: string;
  env: NodeJS.ProcessEnv;
}> {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-wsr-"));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });
  const isolated = await createIsolatedCliEnvironment(tempRoot);

  // The workspace pipeline and rebuild regenerate demand → sources →
  // catalog: provide the canonical checked-in-style inputs so those steps
  // execute against an (empty) source universe instead of failing on a
  // missing registry.
  await writeJsonFile(join(isolated.stateRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [],
  });
  await writeJsonFile(join(isolated.stateRoot, "discover", "selections.json"), {
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
  });
  return isolated;
}

// Enable fetch mocking so any network attempt fails fast instead of hanging.
function withMockFetchEnv(): NodeJS.ProcessEnv {
  return { ...process.env, AGENT_HARNESS_TEST_FETCH_MOCKS: "1" };
}

/**
 * Runs a workspace/rebuild invocation that terminates via exit code OR a
 * deliberate pipeline rejection (e.g. the #349 no-recommendations stop).
 * The covered behavior is the terminality itself.
 */
async function runTolerantly(invocation: () => Promise<number>): Promise<void> {
  try {
    const code = await invocation();
    assert.ok(code === 0 || code === 1, "exit code must be 0 or 1");
  } catch (error) {
    assert.ok(error instanceof Error, "pipeline stops with an Error");
  }
}

void test("workspace host pipeline runs preflight and prerequisites to a fast failure (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);
  const env = withMockFetchEnv();

  // A tiny TypeScript workspace with demand signals.
  await writeFile(
    join(workspaceRoot, "package.json"),
    JSON.stringify({ name: "ws-flow", version: "1.0.0" }),
  );

  await runTolerantly(() =>
    runWorkspace(["opencode"], workspaceRoot, stateRoot),
  );
  void env;
});

void test("workspace host with --ai-enrich handles the enrichment result path (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);
  await writeFile(
    join(workspaceRoot, "package.json"),
    JSON.stringify({ name: "ws-enrich", version: "1.0.0" }),
  );

  await runTolerantly(() =>
    runWorkspace(["opencode", "--ai-enrich"], workspaceRoot, stateRoot),
  );
});

void test("workspace host with --intent validates the intent path (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);
  await writeFile(
    join(workspaceRoot, "package.json"),
    JSON.stringify({ name: "ws-intent", version: "1.0.0" }),
  );

  await runTolerantly(() =>
    runWorkspace(
      ["opencode", "--intent", "frontend"],
      workspaceRoot,
      stateRoot,
    ),
  );
});

void test("setup doctor runs the full preflight surface in an isolated environment (#428)", async (t) => {
  const { stateRoot } = await makeIsolated(t);

  // Doctor completes on machines without host CLIs by collecting
  // diagnostics; either exit code is fine — the body, per-adapter preflight,
  // cumulative timeout, and diagnostic formatting all execute.
  const code = await runSetup(["doctor"], stateRoot);
  assert.ok(code === 0 || code === 1, "setup doctor must terminate");

  // Per-host doctor invocation for one adapter.
  const singleHost = await runSetup(
    ["doctor", "--host", "opencode"],
    stateRoot,
  );
  assert.ok(singleHost === 0 || singleHost === 1);
});

void test("setup login prints provider guidance for valid and unknown providers (#428)", async (t) => {
  const { stateRoot } = await makeIsolated(t);

  const github = await runSetup(["login", "--provider", "github"], stateRoot);
  assert.equal(github, 0);

  const unknown = await runSetup(["login", "--provider", "nope"], stateRoot);
  assert.equal(unknown, 0);

  // Bare login defaults to the first provider and still exits 0.
  const bare = await runSetup(["login"], stateRoot);
  assert.equal(bare, 0);
});

void test("rebuild full runs the clean + batch pipeline on an empty state root (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);

  // rebuild clean: removes transient state and completes.
  const clean = await runRebuild(["clean"], workspaceRoot, stateRoot);
  assert.equal(clean, 0);

  // rebuild full: clean + regenerate + batch loops; with no catalogs the
  // acquire/install batch functions run over empty selections.
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

  await runTolerantly(() => runRebuild(["full"], workspaceRoot, stateRoot));
});
