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
