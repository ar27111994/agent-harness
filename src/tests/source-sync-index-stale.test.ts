/**
 * Tests source-sync index.ts catch block — exercises stale-data fallback
 * with a prior "stale" state (covers index.ts:203).
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeJsonFile } from "../files.js";
import { clearRuntimeConfig } from "../config/runtime.js";
import {
  syncIndexedSources,
  loadSourceSyncState,
} from "../domains/discovery/source-sync.js";

void test("syncIndexedSources catch block: prior stale state → fallback persists", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-ss-stale-"));
  process.env.AGENT_HARNESS_HOME = tempRoot;
  clearRuntimeConfig();

  try {
    const discoverDir = join(tempRoot, "discover");
    const outputDir = join(discoverDir, "output");
    await mkdir(outputDir, { recursive: true });

    // Source that will trigger a sitemap fetch failure.
    await writeJsonFile(join(discoverDir, "source-registry.json"), {
      schemaVersion: 1,
      sources: [
        {
          id: "swift-package-index",
          name: "Swift Package Index",
          kind: "package-registry",
          authorityTier: "trusted-community",
          hosts: ["opencode"],
          assetKinds: ["skill"],
          discoveryMode: "catalog",
          priority: 70,
          enabled: true,
          endpoints: {
            sitemapUrl: "https://invalid.example.invalid/sitemap.xml",
          },
          rules: {
            officialPreferred: true,
            allowMirror: false,
            allowInstall: false,
          },
        },
      ],
    });

    await writeJsonFile(join(discoverDir, "selections.json"), {
      schemaVersion: 1,
      selections: {},
    });

    // Pre-populate prior state as "stale" with 1 indexed entry.
    await writeJsonFile(join(outputDir, "source-sync.json"), {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sources: [
        {
          sourceId: "swift-package-index",
          coverageMode: "indexed",
          status: "stale",
          indexedEntryCount: 1,
          cursors: [{ cursorId: "main", completed: true }],
        },
      ],
    });

    await writeFile(
      join(outputDir, "source-sync-entries.jsonl"),
      JSON.stringify({
        id: "entry-1",
        source: { sourceId: "swift-package-index" },
      }) + "\n",
      "utf8",
    );

    await syncIndexedSources(tempRoot);

    const state = await loadSourceSyncState(tempRoot);
    const src = state.sources.find((s) => s.sourceId === "swift-package-index");
    assert.ok(src, "source state should exist after sync attempt");
    // Even if fetch fails, the state should be updated (stale or failed).
    assert.ok(
      src?.status === "stale" || src?.status === "failed",
      `expected stale or failed, got ${src?.status}`,
    );
  } finally {
    process.env.AGENT_HARNESS_HOME = undefined;
    clearRuntimeConfig();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
