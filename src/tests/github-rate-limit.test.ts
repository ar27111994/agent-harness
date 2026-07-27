/**
 * Tests for GitHub 403/429 rate-limit handling in fetchGitHubJsonOptional.
 *
 * Verifies that rate-limited responses return null instead of throwing,
 * so the maintenance pipeline can skip affected repos gracefully.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fetchGitHubRepoSnapshot } from "../github.js";
import { githubInternals } from "../github.js";

/**
 * Captures and restores globalThis.fetch around a test body, preventing
 * cross-test pollution from mock fetch assignments.
 */
async function withFetchRestored<T>(body: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  try {
    return await body();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void test("fetchGitHubJsonOptional returns null on 403 (secondary rate limit)", async () => {
  await withFetchRestored(async () => {
    globalThis.fetch = async () =>
      new Response("rate limited", { status: 403, statusText: "Forbidden" });

    const result = await githubInternals.fetchGitHubJsonOptional(
      "/repos/octo/repo",
    );
    assert.equal(result, null, "403 should return null instead of throwing");
  });
});

void test("fetchGitHubJsonOptional returns null on 429 (primary rate limit)", async () => {
  await withFetchRestored(async () => {
    globalThis.fetch = async () =>
      new Response("rate limited", { status: 429, statusText: "Too Many Requests" });

    const result = await githubInternals.fetchGitHubJsonOptional(
      "/repos/octo/repo",
    );
    assert.equal(result, null, "429 should return null instead of throwing");
  });
});

void test("fetchGitHubJsonOptional still throws on 500 (server error)", async () => {
  await withFetchRestored(async () => {
    globalThis.fetch = async () =>
      new Response("nope", { status: 500, statusText: "Server Error" });

    await assert.rejects(
      githubInternals.fetchGitHubJsonOptional("/repos/octo/repo"),
      /500 Server Error/,
      "500 should still throw — rate-limit handling doesn't affect server errors",
    );
  });
});

void test("fetchGitHubJsonOptional returns null on 404 (unchanged behavior)", async () => {
  await withFetchRestored(async () => {
    globalThis.fetch = async () => new Response("missing", { status: 404 });

    const result = await githubInternals.fetchGitHubJsonOptional(
      "/repos/octo/repo",
    );
    assert.equal(result, null, "404 should return null (existing behavior)");
  });
});

// ── Error → cache fallback (lines 425-437 coverage) ─────────────────────

void test("fetchGitHubRepoSnapshot falls back to cache when tree fetch throws", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-gh-rate-limit-"));
  const cacheDir = join(tempRoot, "state", "remote-cache", "github");
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(cacheDir, { recursive: true });

  // Seed a cached snapshot.
  const snapshot = {
    fetchedAt: "2026-01-01T00:00:00.000Z",
    owner: "octocat",
    repo: "hello-world",
    sourceId: "test",
    repoSummary: { name: "hello-world", fullName: "octocat/hello-world", description: null, defaultBranch: "main", updatedAt: null, pushedAt: null, stars: 0, language: null, topics: [], archived: false, htmlUrl: "https://github.com/octocat/hello-world" },
    readme: null,
    tree: { sha: "tree-sha", truncated: false, entries: [] },
  };
  await writeFile(join(cacheDir, "octocat__hello-world.json"), JSON.stringify(snapshot), "utf8");

  await withFetchRestored(async () => {
    // Mock: repo fetch succeeds (200), tree fetch throws (network error).
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(JSON.stringify(snapshot.repoSummary), { status: 200 });
      }
      throw new Error("network failure");
    }) as typeof globalThis.fetch;

    const source = {
      id: "test",
      name: "test",
      kind: "repo" as const,
      authorityTier: "trusted-community" as const,
      hosts: ["opencode" as const],
      assetKinds: ["skill" as const],
      discoveryMode: "catalog" as const,
      priority: 70,
      enabled: true,
      endpoints: { repo: "https://github.com/octocat/hello-world" },
      rules: { officialPreferred: true, allowMirror: true, allowInstall: true },
    };
    const result = await fetchGitHubRepoSnapshot(source, tempRoot);

    assert.deepEqual(result, snapshot, "should return cached snapshot on fetch error");
  });

  // Clean up temp directory.
  await rm(tempRoot, { recursive: true, force: true });
});
