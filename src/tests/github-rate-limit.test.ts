/**
 * Tests for GitHub 403/429 rate-limit handling in fetchGitHubJsonOptional.
 *
 * Verifies that rate-limited responses return null instead of throwing,
 * so the maintenance pipeline can skip affected repos gracefully.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fetchGitHubRepoSnapshot } from "../github.js";
import { githubInternals } from "../github.js";

function mockFetch(status: number, body?: string): void {
  globalThis.fetch = (async () => new Response(body ?? "", { status })) as typeof globalThis.fetch;
}

void test("fetchGitHubJsonOptional returns null on 403 (secondary rate limit)", async (t) => {
  const orig = globalThis.fetch;
  t.after(() => { globalThis.fetch = orig; });
  mockFetch(403, "rate limited");
  assert.equal(await githubInternals.fetchGitHubJsonOptional("/repos/octo/repo"), null);
});

void test("fetchGitHubJsonOptional returns null on 429 (primary rate limit)", async (t) => {
  const orig = globalThis.fetch;
  t.after(() => { globalThis.fetch = orig; });
  mockFetch(429, "rate limited");
  assert.equal(await githubInternals.fetchGitHubJsonOptional("/repos/octo/repo"), null);
});

void test("fetchGitHubJsonOptional still throws on 500 (server error)", async (t) => {
  const orig = globalThis.fetch;
  t.after(() => { globalThis.fetch = orig; });
  mockFetch(500, "nope");
  await assert.rejects(
    githubInternals.fetchGitHubJsonOptional("/repos/octo/repo"),
    /500 Server Error/,
  );
});

void test("fetchGitHubJsonOptional returns null on 404 (unchanged behavior)", async (t) => {
  const orig = globalThis.fetch;
  t.after(() => { globalThis.fetch = orig; });
  mockFetch(404);
  assert.equal(await githubInternals.fetchGitHubJsonOptional("/repos/octo/repo"), null);
});

// ── Error → cache fallback (github.ts:427-439 coverage) ──────────────────

void test("fetchGitHubRepoSnapshot falls back to cache on network error", async (t) => {
  const orig = globalThis.fetch;
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-gh-rl-"));
  t.after(async () => {
    globalThis.fetch = orig;
    await rm(tempRoot, { recursive: true, force: true });
  });

  // Seed a cached snapshot.
  const cacheDir = join(tempRoot, "state", "remote-cache", "github");
  await mkdir(cacheDir, { recursive: true });
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

  // Mock: first call succeeds (repo info), second call throws (tree fetch).
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    if (callCount === 1) return new Response(JSON.stringify(snapshot.repoSummary), { status: 200 });
    throw new Error("network failure");
  }) as typeof globalThis.fetch;

  const source = {
    id: "test", name: "test", kind: "repo" as const,
    authorityTier: "trusted-community" as const, hosts: ["opencode" as const],
    assetKinds: ["skill" as const], discoveryMode: "catalog" as const,
    priority: 70, enabled: true,
    endpoints: { repo: "https://github.com/octocat/hello-world" },
    rules: { officialPreferred: true, allowMirror: true, allowInstall: true },
  };
  const result = await fetchGitHubRepoSnapshot(source, tempRoot);
  assert.deepEqual(result, snapshot, "should return cached snapshot on fetch error");
});
