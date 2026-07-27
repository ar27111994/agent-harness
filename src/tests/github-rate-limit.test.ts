/**
 * Tests for GitHub 403/429 rate-limit handling in fetchGitHubJsonOptional.
 *
 * Verifies that rate-limited responses return null instead of throwing,
 * so the maintenance pipeline can skip affected repos gracefully.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { githubInternals } from "../github.js";

void test("fetchGitHubJsonOptional returns null on 403 (secondary rate limit)", async () => {
  globalThis.fetch = async () =>
    new Response("rate limited", { status: 403, statusText: "Forbidden" });

  const result = await githubInternals.fetchGitHubJsonOptional(
    "/repos/octo/repo",
  );
  assert.equal(result, null, "403 should return null instead of throwing");
});

void test("fetchGitHubJsonOptional returns null on 429 (primary rate limit)", async () => {
  globalThis.fetch = async () =>
    new Response("rate limited", { status: 429, statusText: "Too Many Requests" });

  const result = await githubInternals.fetchGitHubJsonOptional(
    "/repos/octo/repo",
  );
  assert.equal(result, null, "429 should return null instead of throwing");
});

void test("fetchGitHubJsonOptional still throws on 500 (server error)", async () => {
  globalThis.fetch = async () =>
    new Response("nope", { status: 500, statusText: "Server Error" });

  await assert.rejects(
    githubInternals.fetchGitHubJsonOptional("/repos/octo/repo"),
    /500 Server Error/,
    "500 should still throw — rate-limit handling doesn't affect server errors",
  );
});

void test("fetchGitHubJsonOptional returns null on 404 (unchanged behavior)", async () => {
  globalThis.fetch = async () => new Response("missing", { status: 404 });

  const result = await githubInternals.fetchGitHubJsonOptional(
    "/repos/octo/repo",
  );
  assert.equal(result, null, "404 should return null (existing behavior)");
});

// ── Error → cache fallback (lines 425-437 coverage) ─────────────────────

void test("fetchGitHubRepoSnapshot falls back to cache when tree fetch throws", async () => {
  // Seed a cached snapshot.
  const cachePath = "state/remote-cache/github/octocat__hello-world.json";
  const { mkdir, writeFile, rm } = await import("node:fs/promises");
  await mkdir("state/remote-cache/github", { recursive: true });

  const snapshot = {
    fetchedAt: "2026-01-01T00:00:00.000Z",
    owner: "octocat",
    repo: "hello-world",
    sourceId: "test",
    repoSummary: { name: "hello-world", fullName: "octocat/hello-world", description: null, defaultBranch: "main", updatedAt: null, pushedAt: null, stars: 0, language: null, topics: [], archived: false, htmlUrl: "https://github.com/octocat/hello-world" },
    readme: null,
    tree: { sha: "tree-sha", truncated: false, entries: [] },
  };
  await writeFile(cachePath, JSON.stringify(snapshot), "utf8");

  // Mock: repo fetch succeeds (200), tree fetch throws (network error).
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    if (callCount === 1) {
      // Repo fetch: return 200.
      return new Response(JSON.stringify(snapshot.repoSummary), { status: 200 });
    }
    // Tree/readme fetch: throw network error.
    throw new Error("network failure");
  }) as typeof globalThis.fetch;

  // This should fall through the try block → catch → cache fallback.
  const { fetchGitHubRepoSnapshot } = await import("../github.js");
  const result = await fetchGitHubRepoSnapshot(
    { owner: "octocat", repo: "hello-world", sourceId: "test" },
    "",
  );

  assert.deepEqual(result, snapshot, "should return cached snapshot on fetch error");

  // Clean up.
  globalThis.fetch = undefined as unknown as typeof globalThis.fetch;
  await rm("state", { recursive: true, force: true });
});
