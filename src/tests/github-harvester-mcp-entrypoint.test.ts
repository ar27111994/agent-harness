/**
 * Regression tests for the Penpot MCP server-catalog classification defect
 * (PR #489 finding 2): test/declaration/html files under a broad
 * `mcpServerPaths` declaration were misclassified as standalone `mcp-server`
 * assets. Two levers are pinned here:
 *
 * 1. The harvester guard: `isExecutableMcpServerPath` must reject type
 *    declarations, `*.test.*`/`*.spec.*`/`__tests__` files, and non-code
 *    documents even when their path matches `mcpServerPaths`.
 * 2. The source-pack correction: narrowing `mcpServerPaths` to the genuine
 *    entrypoint leaves exactly one MCP server entry per package.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  githubHarvesterInternals,
  harvestGitHubRepoSource,
} from "../domains/discovery/github-harvester.js";
import { setHttpTestFetchMocks } from "./env-test-utils.js";
import type { SelectionRegistry, SourceDefinition } from "../types.js";

/**
 * A source whose `mcpServerPaths` is broad enough to claim the whole Penpot
 * server `src` directory. With the guard, only executable module entrypoints
 * (and not tests, type declarations, or non-code documents) are classified as
 * `mcp-server`.
 */
function penpotLikeSource(mcpServerPaths: string[]): SourceDefinition {
  return {
    id: "penpot-mcp-pack",
    name: "Penpot MCP",
    kind: "repo",
    authorityTier: "official-first-party",
    publisher: { name: "Penpot", verified: true, owner: "penpot" },
    hosts: ["shared"],
    assetKinds: ["mcp-server", "reference-pack"],
    discoveryMode: "catalog",
    priority: 100,
    enabled: true,
    endpoints: { repo: "https://github.com/penpot/penpot" },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
    includePaths: ["mcp/packages/server/**"],
    mcpServerPaths,
  };
}

void test("mcpServerPaths guard rejects test, declaration, and non-code paths as mcp-server", () => {
  const source = penpotLikeSource(["mcp/packages/server/src/**"]);

  // A genuine executable module entrypoint is still an MCP server.
  assert.equal(
    githubHarvesterInternals.isExecutableMcpServerPath(
      "mcp/packages/server/src/index.ts",
      source,
    ),
    true,
  );

  // A declared server entrypoint written in another language remains eligible.
  assert.equal(
    githubHarvesterInternals.isExecutableMcpServerPath("src/server.py", {
      ...source,
      mcpServerPaths: ["src/server.py"],
    }),
    true,
  );

  // A test file is not an installable MCP server entrypoint.
  assert.equal(
    githubHarvesterInternals.isExecutableMcpServerPath(
      "mcp/packages/server/src/PluginBridge.test.ts",
      source,
    ),
    false,
  );

  // A type declaration is not an installable MCP server entrypoint.
  assert.equal(
    githubHarvesterInternals.isExecutableMcpServerPath(
      "mcp/packages/server/src/types/nrepl-client.d.ts",
      source,
    ),
    false,
  );

  // A non-code document is not an installable MCP server entrypoint.
  assert.equal(
    githubHarvesterInternals.isExecutableMcpServerPath(
      "mcp/packages/server/src/static/repl.html",
      source,
    ),
    false,
  );

  // A file under a `__tests__` directory is not an installable entrypoint.
  assert.equal(
    githubHarvesterInternals.isExecutableMcpServerPath(
      "mcp/packages/server/src/__tests__/index.ts",
      source,
    ),
    false,
  );
});

void test("penpot pack emits only the genuine server entrypoint as mcp-server", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-penpot-mcp-"),
  );
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

    if (url === "https://api.github.com/repos/penpot/penpot") {
      return jsonResponse({
        name: "penpot",
        full_name: "penpot/penpot",
        description: "Design tool for teams",
        default_branch: "main",
        updated_at: "2026-08-01T00:00:00.000Z",
        pushed_at: "2026-08-01T00:00:00.000Z",
        stargazers_count: 100,
        language: "Clojure",
        topics: ["mcp", "design"],
        archived: false,
        html_url: "https://github.com/penpot/penpot",
      });
    }
    if (
      url ===
      "https://api.github.com/repos/penpot/penpot/git/trees/main?recursive=1"
    ) {
      return jsonResponse({
        sha: "tree",
        truncated: false,
        tree: [
          { path: "mcp/packages/server/README.md", type: "blob", sha: "r" },
          {
            path: "mcp/packages/server/src/index.ts",
            type: "blob",
            sha: "i1",
          },
          {
            path: "mcp/packages/server/src/PenpotMcpServer.ts",
            type: "blob",
            sha: "i2",
          },
          {
            path: "mcp/packages/server/src/tools/ExportShapeTool.ts",
            type: "blob",
            sha: "i3",
          },
          {
            path: "mcp/packages/server/src/PluginBridge.test.ts",
            type: "blob",
            sha: "t1",
          },
          {
            path: "mcp/packages/server/src/types/nrepl-client.d.ts",
            type: "blob",
            sha: "d1",
          },
          {
            path: "mcp/packages/server/src/static/repl.html",
            type: "blob",
            sha: "h1",
          },
        ],
      });
    }
    if (url === "https://api.github.com/repos/penpot/penpot/readme") {
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
    penpotLikeSource(["mcp/packages/server/src/index.ts"]),
    null,
    selectionRegistry(),
    projectRoot,
  );

  const mcpServers = entries.filter(
    (entry) => entry.assetKind === "mcp-server",
  );
  assert.equal(mcpServers.length, 1);
  assert.equal(
    mcpServers[0]?.install.relativePath,
    "mcp/packages/server/src/index.ts",
  );

  const relativePaths = entries.map((entry) => entry.install.relativePath);
  assert.equal(
    relativePaths.includes("mcp/packages/server/src/PluginBridge.test.ts"),
    false,
  );
  assert.equal(
    relativePaths.includes("mcp/packages/server/src/types/nrepl-client.d.ts"),
    false,
  );
  assert.equal(
    relativePaths.includes("mcp/packages/server/src/static/repl.html"),
    false,
  );
  assert.equal(
    relativePaths.includes("mcp/packages/server/src/PenpotMcpServer.ts"),
    false,
  );
  assert.equal(
    relativePaths.includes("mcp/packages/server/src/tools/ExportShapeTool.ts"),
    false,
  );

  // The package README remains a reference asset.
  assert.equal(
    entries.some(
      (entry) =>
        entry.assetKind === "reference-pack" &&
        entry.install.relativePath === "mcp/packages/server/README.md",
    ),
    true,
  );
});

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
