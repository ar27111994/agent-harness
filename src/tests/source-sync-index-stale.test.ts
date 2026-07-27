import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeJsonFile } from "../files.js";
import { clearRuntimeConfig } from "../config/runtime.js";
import { syncIndexedSources, loadSourceSyncState } from "../domains/discovery/source-sync.js";

void test("syncIndexedSources catch block: prior stale state → fallback persists", async () => {
  const root = await mkdtemp(join(tmpdir(), "ah-ss-"));
  process.env.AGENT_HARNESS_HOME = root;
  clearRuntimeConfig();

  try {
    const dd = join(root, "discover");
    const od = join(dd, "output");
    await mkdir(od, { recursive: true });

    // Both source-registry.json and sources.json are required.
    await writeJsonFile(join(dd, "source-registry.json"), {
      schemaVersion: 1, sources: [{
        id: "swift-package-index", name: "SPI", kind: "package-registry",
        authorityTier: "trusted-community", hosts: ["opencode"], assetKinds: ["skill"],
        discoveryMode: "catalog", priority: 70, enabled: true,
        endpoints: { sitemapUrl: "https://invalid.example.invalid/sitemap.xml" },
        rules: { officialPreferred: true, allowMirror: false, allowInstall: false },
      }],
    });
    await writeJsonFile(join(dd, "sources.json"), { schemaVersion: 1, sources: [] });
    await writeJsonFile(join(dd, "selections.json"), { schemaVersion: 1, selectionPolicies: {}, selections: {} });

    // Prior state: stale with 1 entry.
    await writeJsonFile(join(od, "source-sync.json"), {
      schemaVersion: 1, generatedAt: new Date().toISOString(),
      sources: [{ sourceId: "swift-package-index", coverageMode: "indexed", status: "stale", indexedEntryCount: 1, cursors: [{ cursorId: "main", completed: true }] }],
    });
    await writeFile(join(od, "source-sync-entries.jsonl"), JSON.stringify({ id: "e1", source: { sourceId: "swift-package-index" } }) + "\n", "utf8");

    await syncIndexedSources(root);

    const st = await loadSourceSyncState(root);
    const s = st.sources.find((x) => x.sourceId === "swift-package-index");
    assert.ok(s, "source state should exist");
    assert.ok(s?.status === "stale" || s?.status === "failed", `expected stale/failed, got ${s?.status}`);
  } finally {
    process.env.AGENT_HARNESS_HOME = undefined;
    clearRuntimeConfig();
    await rm(root, { recursive: true, force: true });
  }
});
