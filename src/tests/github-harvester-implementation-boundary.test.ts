import { setHttpTestFetchMocks } from "./env-test-utils.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { harvestGitHubRepoSource } from "../domains/discovery/github-harvester.js";
import type { SelectionRegistry, SourceDefinition } from "../types.js";

void test("pack harvester does not emit MCP implementation files as assets", async (context) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-impl-pack-"));
  const originalFetch = globalThis.fetch;
  const previousMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  setHttpTestFetchMocks(true);

  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url === "https://api.github.com/repos/acme/impl-pack") {
      return jsonResponse({
        name: "impl-pack",
        full_name: "acme/impl-pack",
        description: "MCP implementation fixture",
        default_branch: "main",
        updated_at: "2026-08-01T00:00:00.000Z",
        pushed_at: "2026-08-01T00:00:00.000Z",
        stargazers_count: 1,
        language: "TypeScript",
        topics: ["mcp"],
        archived: false,
        html_url: "https://github.com/acme/impl-pack",
      });
    }
    if (
      url ===
      "https://api.github.com/repos/acme/impl-pack/git/trees/main?recursive=1"
    ) {
      return jsonResponse({
        sha: "tree",
        truncated: false,
        tree: [
          { path: "mcp/server/src/semantic_search.ts", type: "blob", sha: "a" },
          { path: "mcp/server/src/health.ts", type: "blob", sha: "b" },
          { path: "mcp/server/data/api_types.yml", type: "blob", sha: "c" },
          { path: "CLAUDE.md", type: "blob", sha: "d" },
          { path: "agents.md", type: "blob", sha: "e" },
        ],
      });
    }
    if (url === "https://api.github.com/repos/acme/impl-pack/readme") {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousMockFlag === undefined) {
      setHttpTestFetchMocks(false);
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousMockFlag;
      setHttpTestFetchMocks(previousMockFlag === "1");
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  const entries = await harvestGitHubRepoSource(
    source(),
    null,
    selectionRegistry(),
    projectRoot,
  );
  assert.deepEqual(entries, []);
});

void test("pack harvester still recognizes a conventional MCP executable entrypoint", async (context) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-mcp-entry-"));
  const originalFetch = globalThis.fetch;
  const previousMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  setHttpTestFetchMocks(true);

  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url === "https://api.github.com/repos/acme/impl-pack") {
      return jsonResponse({
        name: "impl-pack",
        full_name: "acme/impl-pack",
        description: "MCP implementation fixture",
        default_branch: "main",
        updated_at: "2026-08-01T00:00:00.000Z",
        pushed_at: "2026-08-01T00:00:00.000Z",
        stargazers_count: 1,
        language: "TypeScript",
        topics: ["mcp"],
        archived: false,
        html_url: "https://github.com/acme/impl-pack",
      });
    }
    if (
      url ===
      "https://api.github.com/repos/acme/impl-pack/git/trees/main?recursive=1"
    ) {
      return jsonResponse({
        sha: "tree",
        truncated: false,
        tree: [{ path: "mcp-server/index.ts", type: "blob", sha: "entry" }],
      });
    }
    if (url === "https://api.github.com/repos/acme/impl-pack/readme") {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousMockFlag === undefined) {
      setHttpTestFetchMocks(false);
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousMockFlag;
      setHttpTestFetchMocks(previousMockFlag === "1");
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  const entries = await harvestGitHubRepoSource(
    source(),
    null,
    selectionRegistry(),
    projectRoot,
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.assetKind, "mcp-server");
  assert.equal(entries[0]?.install.relativePath, "mcp-server/index.ts");
});

function source(): SourceDefinition {
  return {
    id: "impl-pack",
    name: "Implementation pack fixture",
    kind: "repo",
    authorityTier: "trusted-community",
    publisher: { name: "acme", verified: true, owner: "acme" },
    hosts: ["shared"],
    assetKinds: ["mcp-server", "instruction"],
    discoveryMode: "catalog",
    priority: 70,
    enabled: true,
    endpoints: { repo: "https://github.com/acme/impl-pack" },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  };
}

function selectionRegistry(): SelectionRegistry {
  return {
    schemaVersion: 1,
    selectionPolicies: {
      officialBeatsPopularity: true,
      starsAreTieBreakerOnly: true,
      preferNativeOverAdaptable: true,
      preferLowerRiskWhenEquivalent: true,
      preferLowerContextCostWhenEquivalent: true,
      communityDefaultPolicy: "catalog-only-unless-promoted",
    },
    rankingOrder: ["authorityTier"],
    duplicateGroups: [],
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
