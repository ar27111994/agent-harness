/**
 * Targeted tests for github-harvester.ts branch coverage gaps:
 * - classifyGitHubTreePath: instruction, prompt-pack, workflow, mcp-server paths
 * - multi-host source (adaptable mode)
 * - archived repository handling
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { harvestGitHubRepoSource } from "../domains/discovery/github-harvester.js";
import { restoreEnvVar } from "./env-test-utils.js";
import type { SelectionRegistry, SourceDefinition } from "../types.js";

void test("github harvester classifies instruction, prompt-pack, workflow, and mcp-server paths", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-paths-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url === "https://api.github.com/repos/acme/multi-type") {
      return jsonResponse({
        name: "multi-type",
        full_name: "acme/multi-type",
        description: "Multi-type repo",
        default_branch: "main",
        updated_at: "2026-05-15T00:00:00.000Z",
        pushed_at: "2026-05-15T00:00:00.000Z",
        stargazers_count: 10,
        language: "TypeScript",
        topics: ["mcp", "agent"],
        archived: false,
        html_url: "https://github.com/acme/multi-type",
      });
    }

    if (
      url ===
      "https://api.github.com/repos/acme/multi-type/git/trees/main?recursive=1"
    ) {
      return jsonResponse({
        sha: "tree-sha",
        truncated: false,
        tree: [
          // instruction: copilot-instructions.md
          { path: ".github/copilot-instructions.md", type: "blob", sha: "i1" },
          // instruction: agents.md
          { path: "agents.md", type: "blob", sha: "i2" },
          // instruction: instructions/custom.md
          { path: "instructions/custom.md", type: "blob", sha: "i3" },
          // instruction: rules/frontend.mdc
          { path: "rules/frontend.mdc", type: "blob", sha: "i4" },
          // prompt-pack: commands/fix.md
          { path: "commands/fix.md", type: "blob", sha: "p1" },
          // prompt-pack: prompts/debug.md
          { path: "prompts/debug.md", type: "blob", sha: "p2" },
          // workflow: workflows/deploy.yaml
          { path: "workflows/deploy.yaml", type: "blob", sha: "w1" },
          // workflow: workflows/ci.json
          { path: "workflows/ci.json", type: "blob", sha: "w2" },
          // mcp-server executable path
          { path: "mcp-server/index.js", type: "blob", sha: "m1" },
          { path: "servers/my-mcp-server/index.ts", type: "blob", sha: "m2" },
          // not classified: random file
          { path: "random/file.bin", type: "blob", sha: "u1" },
        ],
      });
    }

    if (url === "https://api.github.com/repos/acme/multi-type/readme") {
      return new Response(null, { status: 404 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFlag);
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  const entries = await harvestGitHubRepoSource(
    buildMultiHostSource(),
    null,
    buildSelectionRegistry(),
    projectRoot,
  );
  const byPath = new Map(entries.map((e) => [e.install.relativePath, e]));

  assert.equal(
    byPath.get(".github/copilot-instructions.md")?.assetKind,
    "instruction",
  );
  assert.equal(byPath.get("agents.md")?.assetKind, "instruction");
  assert.equal(byPath.get("instructions/custom.md")?.assetKind, "instruction");
  assert.equal(byPath.get("rules/frontend.mdc")?.assetKind, "instruction");
  assert.equal(byPath.get("commands/fix.md")?.assetKind, "prompt-pack");
  assert.equal(byPath.get("prompts/debug.md")?.assetKind, "prompt-pack");
  assert.equal(byPath.get("workflows/deploy.yaml")?.assetKind, "workflow");
  assert.equal(byPath.get("workflows/ci.json")?.assetKind, "workflow");
  assert.equal(byPath.get("mcp-server/index.js")?.assetKind, "mcp-server");
  assert.deepEqual(byPath.get("mcp-server/index.js")?.hosts, ["shared"]);
  assert.equal(
    byPath.get("servers/my-mcp-server/index.ts")?.assetKind,
    "mcp-server",
  );
  assert.equal(byPath.has("random/file.bin"), false);

  // With multi-host source, compatibility mode should be adaptable
  assert.equal(byPath.get("commands/fix.md")?.compatibilityMode, "adaptable");
  assert.equal(
    byPath.get("workflows/deploy.yaml")?.compatibilityMode,
    "adaptable",
  );
});

void test("github harvester marks archived repos as archived releaseCadence", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-archived-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url === "https://api.github.com/repos/acme/multi-type") {
      return jsonResponse({
        name: "multi-type",
        full_name: "acme/multi-type",
        description: null,
        default_branch: "main",
        updated_at: "2024-01-01T00:00:00.000Z",
        pushed_at: "2024-01-01T00:00:00.000Z",
        stargazers_count: 0,
        language: null,
        topics: [],
        archived: true,
        html_url: "https://github.com/acme/multi-type",
      });
    }

    if (
      url ===
      "https://api.github.com/repos/acme/multi-type/git/trees/main?recursive=1"
    ) {
      return jsonResponse({
        sha: "t1",
        truncated: false,
        tree: [{ path: "skills/readme/SKILL.md", type: "blob", sha: "s1" }],
      });
    }

    if (url === "https://api.github.com/repos/acme/multi-type/readme") {
      return new Response(null, { status: 404 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFlag);
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  const entries = await harvestGitHubRepoSource(
    buildMultiHostSource(),
    null,
    buildSelectionRegistry(),
    projectRoot,
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.maintenance.releaseCadence, "archived");
});

void test("github harvester handles errors gracefully and returns empty array", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-error-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async () => {
    throw new Error("Network error");
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFlag);
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  const entries = await harvestGitHubRepoSource(
    buildMultiHostSource(),
    null,
    buildSelectionRegistry(),
    projectRoot,
  );

  assert.deepEqual(entries, []);
});

void test("github harvester classifies docs and notebooks as reference-packs", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-docs-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url === "https://api.github.com/repos/acme/multi-type") {
      return jsonResponse({
        name: "multi-type",
        full_name: "acme/multi-type",
        description: "Docs repo",
        default_branch: "main",
        updated_at: "2026-05-15T00:00:00.000Z",
        pushed_at: "2026-05-15T00:00:00.000Z",
        stargazers_count: 0,
        language: null,
        topics: [],
        archived: false,
        html_url: "https://github.com/acme/multi-type",
      });
    }

    if (
      url ===
      "https://api.github.com/repos/acme/multi-type/git/trees/main?recursive=1"
    ) {
      return jsonResponse({
        sha: "t1",
        truncated: false,
        tree: [
          { path: "docs/guide.md", type: "blob", sha: "d1" },
          { path: "README.md", type: "blob", sha: "d2" },
          { path: "references/api.md", type: "blob", sha: "d3" },
          { path: "notebooks/analysis.ipynb", type: "blob", sha: "d4" },
          { path: "examples/demo.py", type: "blob", sha: "d5" },
        ],
      });
    }

    if (url === "https://api.github.com/repos/acme/multi-type/readme") {
      return new Response(null, { status: 404 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFlag);
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  const entries = await harvestGitHubRepoSource(
    buildMultiHostSource(),
    null,
    buildSelectionRegistry(),
    projectRoot,
  );
  const byPath = new Map(entries.map((e) => [e.install.relativePath, e]));

  assert.equal(byPath.get("docs/guide.md")?.assetKind, "reference-pack");
  assert.equal(byPath.get("README.md")?.assetKind, "reference-pack");
  assert.equal(byPath.get("references/api.md")?.assetKind, "reference-pack");
  assert.equal(
    byPath.get("notebooks/analysis.ipynb")?.assetKind,
    "reference-pack",
  );
  assert.equal(byPath.get("examples/demo.py")?.assetKind, "reference-pack");
});

void test("github harvester returns no entries when source has no repository endpoint", async () => {
  const entries = await harvestGitHubRepoSource(
    { ...buildMultiHostSource(), endpoints: {} },
    null,
    buildSelectionRegistry(),
    process.cwd(),
  );

  assert.deepEqual(entries, []);
});

function buildMultiHostSource(): SourceDefinition {
  return {
    id: "github-source",
    name: "github-source",
    kind: "repo",
    authorityTier: "trusted-community",
    publisher: { name: "acme", verified: false, owner: "acme" },
    hosts: ["cursor", "copilot-vscode"],
    assetKinds: [
      "skill",
      "agent",
      "instruction",
      "workflow",
      "plugin",
      "hook",
      "mcp-server",
      "reference-pack",
      "prompt-pack",
    ],
    discoveryMode: "catalog",
    priority: 80,
    enabled: true,
    endpoints: { repo: "https://github.com/acme/multi-type" },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  };
}

function buildSelectionRegistry(): SelectionRegistry {
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
    rankingOrder: [],
    duplicateGroups: [],
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
