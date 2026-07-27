import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fetchGitHubRepoSnapshot } from "../github.js";
import { githubInternals } from "../github.js";

void test("fetchGitHubJsonOptional: 403 → null", async (t) => {
  const o = globalThis.fetch;
  t.after(() => { globalThis.fetch = o; });
  globalThis.fetch = async () => new Response("", { status: 403, statusText: "Forbidden" });
  assert.equal(await githubInternals.fetchGitHubJsonOptional("/r"), null);
});

void test("fetchGitHubJsonOptional: 429 → null", async (t) => {
  const o = globalThis.fetch;
  t.after(() => { globalThis.fetch = o; });
  globalThis.fetch = async () => new Response("", { status: 429, statusText: "Too Many Requests" });
  assert.equal(await githubInternals.fetchGitHubJsonOptional("/r"), null);
});

void test("fetchGitHubJsonOptional: 500 → throws", async (t) => {
  const o = globalThis.fetch;
  t.after(() => { globalThis.fetch = o; });
  globalThis.fetch = async () => new Response("", { status: 500, statusText: "Server Error" });
  await assert.rejects(githubInternals.fetchGitHubJsonOptional("/r"), /500 Server Error/);
});

void test("fetchGitHubJsonOptional: 404 → null", async (t) => {
  const o = globalThis.fetch;
  t.after(() => { globalThis.fetch = o; });
  globalThis.fetch = async () => new Response("", { status: 404 });
  assert.equal(await githubInternals.fetchGitHubJsonOptional("/r"), null);
});

void test("fetchGitHubRepoSnapshot: cache fallback on fetch error", async (t) => {
  const o = globalThis.fetch;
  const root = await mkdtemp(join(tmpdir(), "gh-rl-"));
  t.after(async () => { globalThis.fetch = o; await rm(root, { recursive: true, force: true }); });

  const cd = join(root, "state", "remote-cache", "github");
  await mkdir(cd, { recursive: true });
  const snap = { fetchedAt: "2026-01-01T00:00:00.000Z", owner: "octocat", repo: "hw", sourceId: "t",
    repoSummary: { name: "hw", fullName: "octocat/hw", description: null, defaultBranch: "main", updatedAt: null, pushedAt: null, stars: 0, language: null, topics: [], archived: false, htmlUrl: "x" },
    readme: null, tree: { sha: "s", truncated: false, entries: [] } };
  await writeFile(join(cd, "octocat__hw.json"), JSON.stringify(snap), "utf8");

  let n = 0;
  globalThis.fetch = (async () => { n++; if (n === 1) return new Response(JSON.stringify(snap.repoSummary), { status: 200 }); throw new Error("fail"); }) as typeof globalThis.fetch;

  const s = { id: "t", name: "t", kind: "repo" as const, authorityTier: "trusted-community" as const, hosts: ["opencode" as const], assetKinds: ["skill" as const], discoveryMode: "catalog" as const, priority: 70, enabled: true, endpoints: { repo: "https://github.com/octocat/hw" }, rules: { officialPreferred: true, allowMirror: true, allowInstall: true } };
  assert.deepEqual(await fetchGitHubRepoSnapshot(s, root), snap);
});
