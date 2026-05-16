/**
 * Targeted tests for source-sync.ts exported helper functions:
 * - getIndexedSourceIds
 * - loadSourceSyncState (default when missing)
 * - loadIndexedCatalogEntries (empty when missing)
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getIndexedSourceIds,
  loadIndexedCatalogEntries,
  loadSourceSyncState,
} from "../domains/discovery/source-sync.js";
import type { SourceSyncState } from "../domains/discovery/source-sync.js";

void test("getIndexedSourceIds returns source ids where coverage is indexed and status is partial or complete", () => {
  const state: SourceSyncState = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources: [
      {
        sourceId: "cursor-marketplace",
        coverageMode: "indexed",
        status: "complete",
        indexedEntryCount: 42,
        cursors: [],
      },
      {
        sourceId: "skills-sh",
        coverageMode: "indexed",
        status: "partial",
        indexedEntryCount: 10,
        cursors: [],
      },
      {
        sourceId: "github-awesome",
        coverageMode: "rotating",
        status: "complete",
        indexedEntryCount: 0,
        cursors: [],
      },
      {
        sourceId: "cursor-docs",
        coverageMode: "direct",
        status: "not-applicable",
        indexedEntryCount: 0,
        cursors: [],
      },
      {
        sourceId: "failed-source",
        coverageMode: "indexed",
        status: "failed",
        indexedEntryCount: 0,
        cursors: [],
      },
    ],
  };

  const ids = getIndexedSourceIds(state);

  assert.ok(
    ids.has("cursor-marketplace"),
    "complete indexed source should be included",
  );
  assert.ok(ids.has("skills-sh"), "partial indexed source should be included");
  assert.equal(
    ids.has("github-awesome"),
    false,
    "rotating source should not be included",
  );
  assert.equal(
    ids.has("cursor-docs"),
    false,
    "direct source should not be included",
  );
  assert.equal(
    ids.has("failed-source"),
    false,
    "failed indexed source should not be included",
  );
});

void test("loadSourceSyncState returns empty default state when file is missing", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-helpers-"),
  );

  try {
    const state = await loadSourceSyncState(root);

    assert.equal(state.schemaVersion, 1);
    assert.deepEqual(state.sources, []);
    assert.equal(state.generatedAt, new Date(0).toISOString());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("loadIndexedCatalogEntries returns empty array when file is missing", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-helpers-"),
  );

  try {
    const entries = await loadIndexedCatalogEntries(root);

    assert.deepEqual(entries, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
