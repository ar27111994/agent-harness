/**
 * Directly tests github.ts catch-block path (lines 427-439) by calling
 * readGitHubRepoSnapshotCache and updateGitHubSourceHealth internals.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { githubInternals } from "../github.js";
import { clearRuntimeConfig } from "../config/runtime.js";

const { readGitHubRepoSnapshotCache, updateGitHubSourceHealth } = githubInternals;

void test("readGitHubRepoSnapshotCache returns null for missing cache", async () => {
  const r = await readGitHubRepoSnapshotCache("/nonexistent/path.json");
  assert.equal(r, null);
});

void test("readGitHubRepoSnapshotCache returns parsed snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "gh-cache-"));
  try {
    const cacheDir = join(root, "state", "remote-cache", "github");
    await mkdir(cacheDir, { recursive: true });
    const snap = { fetchedAt: "2026-01-01T00:00:00.000Z", owner: "o", repo: "r", sourceId: "s",
      repoSummary: { name: "r", fullName: "o/r", description: null, defaultBranch: "main", updatedAt: null, pushedAt: null, stars: 0, language: null, topics: [], archived: false, htmlUrl: "x" },
      readme: null, tree: { sha: "s", truncated: false, entries: [] } };
    await writeFile(join(cacheDir, "o__r.json"), JSON.stringify(snap), "utf8");
    const cached = await readGitHubRepoSnapshotCache(join(cacheDir, "o__r.json"));
    assert.deepEqual(cached, snap);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("updateGitHubSourceHealth writes and reads health state", async () => {
  const root = await mkdtemp(join(tmpdir(), "gh-health-"));
  process.env.AGENT_HARNESS_HOME = root;
  clearRuntimeConfig();
  try {
    await updateGitHubSourceHealth(root, "test:o/r", {
      sourceId: "test",
      owner: "o",
      repo: "r",
      lastAttemptAt: new Date().toISOString(),
      lastFailureAt: new Date().toISOString(),
      degradedMode: true,
      degradedReason: "fetch-failed-cache-fallback",
      usedCacheLastAttempt: true,
      lastError: "network failure",
    });
    // Read back to verify persistence.
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(join(root, "state", "remote-cache", "github", "source-health.json"), "utf8");
    const health = JSON.parse(raw);
    assert.equal(health.entries["test:o/r"]?.degradedReason, "fetch-failed-cache-fallback");
  } finally {
    process.env.AGENT_HARNESS_HOME = undefined;
    clearRuntimeConfig();
    await rm(root, { recursive: true, force: true });
  }
});
