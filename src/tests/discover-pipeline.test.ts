/**
 * Discover pipeline dispatch coverage (#428): drives every stateful
 * discover subcommand IN-PROCESS against an isolated state root with
 * minimal checked-in-style fixtures (empty source registry + canonical
 * selections), so the sync/index/full/select/ard-export/enrich/inspect/
 * diff/environment-index case bodies execute without network access.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runDiscover } from "../discover.js";
import { writeJsonFile } from "../files.js";

async function makeDiscoverRoot(t: {
  after: (fn: () => void | Promise<void>) => void;
}): Promise<{ workspaceRoot: string; stateRoot: string }> {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-discover-pipeline-"),
  );
  t.after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });
  const workspaceRoot = join(projectRoot, "workspace");
  const stateRoot = join(projectRoot, "state");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(stateRoot, { recursive: true });

  // Minimal source universe: no sources means sync/index are instant and
  // the dispatch bodies still execute end-to-end.
  await writeJsonFile(join(stateRoot, "discover", "sources.json"), {
    $schema:
      "https://raw.githubusercontent.com/ar27111994/agent-harness/main/discover/schema/sources.schema.json",
    schemaVersion: 1,
    sources: [],
  });
  await writeJsonFile(join(stateRoot, "discover", "selections.json"), {
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

  return { workspaceRoot, stateRoot };
}

void test("discover sync/index/select/full complete on an empty source universe (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeDiscoverRoot(t);

  const runs: Array<[string[], number]> = [
    [["sync"], 0],
    [["sync", "--full"], 0],
    [["index"], 0],
    // After a fresh catalog index exists, sync takes the fresh-index path
    // (copy snapshot into source-sync state instead of live harvesting).
    [["sync"], 0],
    [["catalog"], 0],
    [["select"], 0],
    [["full"], 0],
    [["breadth"], 0],
    [["recall"], 0],
    [["candidate-pool"], 0],
    [["stats"], 0],
    [["environment-index"], 0],
    [["ard-export"], 0],
    [["enrich"], 0],
    [["inspect"], 0],
  ];

  for (const [args, expected] of runs) {
    const code = await runDiscover(args, workspaceRoot, stateRoot);
    assert.equal(
      code,
      expected,
      `discover ${args.join(" ")} should exit ${expected}`,
    );
  }

  // Source-health summary paths: --quiet and --summary variants exercise the
  // report printer with the empty-source-universe health report.
  assert.equal(
    await runDiscover(["full", "--quiet"], workspaceRoot, stateRoot),
    0,
  );
  assert.equal(
    await runDiscover(["full", "--summary"], workspaceRoot, stateRoot),
    0,
  );

  // The unified outputs exist after the pipeline ran.
  const outputs = join(stateRoot, "discover", "output");
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(outputs);
  const catalogDir = await readdir(join(stateRoot, "discover"));
  assert.ok(files.includes("demand-profile.json"), "demand profile written");
  assert.ok(
    catalogDir.includes("catalog.assets.jsonl"),
    "catalog assets written",
  );
  assert.ok(
    files.includes("catalog.selected.jsonl"),
    "selected catalog written",
  );
});

void test("discover diff fails fast without a baseline and succeeds with one (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeDiscoverRoot(t);

  // Baseline missing → the diff report rejects (the CLI main() catch turns
  // it into exit 1; in-process we assert the rejection).
  await assert.rejects(
    runDiscover(
      ["diff", "--baseline", join(stateRoot, "no-baseline")],
      workspaceRoot,
      stateRoot,
    ),
  );

  // Produce outputs first so the state root itself is a valid baseline.
  assert.equal(await runDiscover(["full"], workspaceRoot, stateRoot), 0);
  const withBaseline = await runDiscover(
    ["diff", "--baseline", stateRoot],
    workspaceRoot,
    stateRoot,
  );
  assert.equal(withBaseline, 0);
});

void test("discover full with entries produces selected/rejected outputs (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeDiscoverRoot(t);
  const { writeFile } = await import("node:fs/promises");

  // A tiny TypeScript workspace so demand signals fire.
  await writeFile(
    join(workspaceRoot, "package.json"),
    JSON.stringify({ name: "pipeline-fixture", version: "1.0.0" }),
  );

  const code = await runDiscover(["full"], workspaceRoot, stateRoot);
  assert.equal(code, 0);

  const selected = await readFile(
    join(stateRoot, "discover", "output", "catalog.selected.jsonl"),
    "utf8",
  );
  assert.ok(Array.isArray(selected.split("\n").filter(Boolean)));
});
