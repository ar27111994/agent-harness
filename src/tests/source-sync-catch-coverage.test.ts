import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeJsonFile } from "../files.js";
import { clearRuntimeConfig } from "../config/runtime.js";
import { syncIndexedSources, loadSourceSyncState } from "../domains/discovery/source-sync.js";

void test("syncIndexedSources enters catch block on source-sync failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "ah-ss-catch-"));
  process.env.AGENT_HARNESS_HOME = root;
  clearRuntimeConfig();
  try {
    const dd = join(root, "discover");
    const od = join(dd, "output");
    await mkdir(od, { recursive: true });

    // Minimal project state required by syncIndexedSources.
    await writeJsonFile(join(dd, "source-registry.json"), {
      schemaVersion: 1,
      sources: [{
        id: "clawhub", name: "ClawHub", kind: "package-registry",
        authorityTier: "trusted-community", hosts: ["opencode"],
        assetKinds: ["plugin"], discoveryMode: "catalog", priority: 70,
        enabled: true,
        endpoints: { pluginsUrl: "https://invalid.example.invalid/plugins" },
        rules: { officialPreferred: true, allowMirror: false, allowInstall: false },
      }],
    });
    await writeJsonFile(join(dd, "sources.json"), { schemaVersion: 1, sources: [] });
    await writeJsonFile(join(dd, "selections.json"), {
      schemaVersion: 1,
      selectionPolicies: { officialBeatsPopularity: true },
      selections: {},
    });
    await writeJsonFile(join(dd, "official-skills-indexes.json"), {
      schemaVersion: 1, indexes: [],
    });

    // Prior state: complete with 1 entry.
    await writeJsonFile(join(od, "source-sync.json"), {
      schemaVersion: 1, generatedAt: new Date().toISOString(),
      sources: [{
        sourceId: "clawhub", coverageMode: "indexed", status: "complete",
        indexedEntryCount: 1, cursors: [{ cursorId: "main", completed: true }],
      }],
    });
    await writeFile(join(od, "source-sync-entries.jsonl"),
      JSON.stringify({ id: "e1", source: { sourceId: "clawhub" } }) + "\n", "utf8");

    await syncIndexedSources(root);

    const st = await loadSourceSyncState(root);
    const s = st.sources.find((x) => x.sourceId === "clawhub");
    assert.ok(s, "source should exist in state after sync attempt");
    // Should be failed or stale after the invalid URL fetch fails.
    assert.ok(s?.status !== "complete", "should not remain complete after fetch failure");
  } finally {
    process.env.AGENT_HARNESS_HOME = undefined;
    clearRuntimeConfig();
    await rm(root, { recursive: true, force: true });
  }
});
