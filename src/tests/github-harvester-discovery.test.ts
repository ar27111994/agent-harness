import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { harvestGitHubRepoSource } from "../domains/discovery/github-harvester.js";
import type { SelectionRegistry, SourceDefinition } from "../types.js";

void test("github harvester classifies repository artifacts and carries repository trust evidence", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-harvester-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url === "https://api.github.com/repos/acme/toolbox") {
      return jsonResponse({
        name: "toolbox",
        full_name: "acme/toolbox",
        description: "Repository with installable agent assets",
        default_branch: "main",
        updated_at: "2026-05-15T00:00:00.000Z",
        pushed_at: "2026-05-15T00:00:00.000Z",
        stargazers_count: 321,
        language: "TypeScript",
        topics: ["agent", "tooling"],
        archived: false,
        html_url: "https://github.com/acme/toolbox",
      });
    }

    if (
      url ===
      "https://api.github.com/repos/acme/toolbox/git/trees/main?recursive=1"
    ) {
      return jsonResponse({
        sha: "tree-sha",
        truncated: false,
        tree: [
          { path: "skills/repo-guide/SKILL.md", type: "blob", sha: "1" },
          { path: "agents/security.md", type: "blob", sha: "2" },
          { path: "docs/reference.md", type: "blob", sha: "3" },
          {
            path: "plugins/acme/.cursor-plugin/plugin.json",
            type: "blob",
            sha: "4",
          },
          { path: "hooks/audit.js", type: "blob", sha: "5" },
          { path: "mcp-server/index.ts", type: "blob", sha: "6" },
          { path: "SECURITY.md", type: "blob", sha: "7" },
          { path: "LICENSE", type: "blob", sha: "8" },
          { path: ".github/workflows/ci.yml", type: "blob", sha: "9" },
          { path: "tests/repo-guide.test.ts", type: "blob", sha: "10" },
        ],
      });
    }

    if (url === "https://api.github.com/repos/acme/toolbox/readme") {
      return jsonResponse({
        path: "README.md",
        sha: "readme-sha",
        size: 120,
        html_url: "https://github.com/acme/toolbox/blob/main/README.md",
        download_url:
          "https://raw.githubusercontent.com/acme/toolbox/main/README.md",
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFetchMockFlag;
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  const entries = await harvestGitHubRepoSource(
    buildSource(),
    null,
    buildSelectionRegistry(),
    projectRoot,
  );
  const byPath = new Map(
    entries.map((entry) => [entry.install.relativePath, entry]),
  );

  assert.equal(byPath.get("skills/repo-guide/SKILL.md")?.assetKind, "skill");
  assert.equal(byPath.get("agents/security.md")?.assetKind, "agent");
  assert.equal(byPath.get("docs/reference.md")?.assetKind, "reference-pack");
  assert.equal(
    byPath.get("plugins/acme/.cursor-plugin/plugin.json")?.assetKind,
    "plugin",
  );
  assert.equal(byPath.get("hooks/audit.js")?.assetKind, "hook");
  assert.equal(byPath.get("mcp-server/index.ts")?.assetKind, "mcp-server");
  assert.deepEqual(byPath.get("mcp-server/index.ts")?.hosts, ["shared"]);
  assert.equal(byPath.get("hooks/audit.js")?.risk.level, "medium");
  assert.equal(
    byPath.get("plugins/acme/.cursor-plugin/plugin.json")?.risk.hasExecScripts,
    true,
  );
  assert.ok(
    byPath
      .get("skills/repo-guide/SKILL.md")
      ?.trust.signals.includes("security-policy-present"),
  );
  assert.ok(
    byPath
      .get("skills/repo-guide/SKILL.md")
      ?.trust.signals.includes("license-present"),
  );
  assert.ok(
    byPath
      .get("skills/repo-guide/SKILL.md")
      ?.trust.signals.includes("ci-workflows-present"),
  );
  assert.ok(
    byPath
      .get("skills/repo-guide/SKILL.md")
      ?.trust.signals.includes("tests-present"),
  );
});

void test("github harvester classifies Penpot MCP package server sources", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-harvester-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

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
        description: "Penpot open-source design tool with MCP server",
        default_branch: "main",
        updated_at: "2026-05-15T00:00:00.000Z",
        pushed_at: "2026-05-15T00:00:00.000Z",
        stargazers_count: 45000,
        language: "TypeScript",
        topics: ["penpot", "design", "mcp"],
        archived: false,
        html_url: "https://github.com/penpot/penpot",
      });
    }

    if (
      url ===
      "https://api.github.com/repos/penpot/penpot/git/trees/main?recursive=1"
    ) {
      return jsonResponse({
        sha: "tree-sha",
        truncated: false,
        tree: [
          { path: "mcp/packages/server/src/index.ts", type: "blob", sha: "1" },
          { path: "mcp/packages/plugin/src/plugin.ts", type: "blob", sha: "2" },
          { path: "mcp/README.md", type: "blob", sha: "3" },
          {
            path: ".opencode/skills/internal/SKILL.md",
            type: "blob",
            sha: "4",
          },
        ],
      });
    }

    if (url === "https://api.github.com/repos/penpot/penpot/readme") {
      return jsonResponse({
        path: "README.md",
        sha: "readme-sha",
        size: 120,
        html_url: "https://github.com/penpot/penpot/blob/main/README.md",
        download_url:
          "https://raw.githubusercontent.com/penpot/penpot/main/README.md",
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFetchMockFlag;
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  const entries = await harvestGitHubRepoSource(
    {
      ...buildSource(),
      id: "penpot-mcp-pack",
      authorityTier: "official-first-party",
      publisher: { name: "Penpot", verified: true, owner: "penpot" },
      hosts: ["opencode", "shared"],
      assetKinds: ["mcp-server", "reference-pack"],
      includePaths: ["mcp/README.md", "mcp/packages/server/**"],
      excludePaths: ["mcp/packages/plugin/**"],
      endpoints: { repo: "https://github.com/penpot/penpot" },
    },
    null,
    buildSelectionRegistry(),
    projectRoot,
  );
  const byPath = new Map(
    entries.map((entry) => [entry.install.relativePath, entry]),
  );

  assert.equal(
    byPath.get("mcp/packages/server/src/index.ts")?.assetKind,
    "mcp-server",
  );
  assert.deepEqual(byPath.get("mcp/packages/server/src/index.ts")?.hosts, [
    "shared",
  ]);
  assert.equal(byPath.get("mcp/README.md")?.assetKind, "reference-pack");
  assert.equal(byPath.has("mcp/packages/plugin/src/plugin.ts"), false);
  assert.equal(byPath.has(".opencode/skills/internal/SKILL.md"), false);
});

void test("github harvester classifies adaptable multi-host assets without publisher metadata", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-harvester-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url === "https://api.github.com/repos/acme/adaptable-toolbox") {
      return jsonResponse({
        name: "adaptable-toolbox",
        full_name: "acme/adaptable-toolbox",
        description: "Repository with portable agent assets",
        default_branch: "main",
        updated_at: null,
        pushed_at: null,
        stargazers_count: 7,
        language: "Markdown",
        topics: [],
        archived: true,
        html_url: "https://github.com/acme/adaptable-toolbox",
      });
    }

    if (
      url ===
      "https://api.github.com/repos/acme/adaptable-toolbox/git/trees/main?recursive=1"
    ) {
      return jsonResponse({
        sha: "tree-sha",
        truncated: false,
        tree: [
          { path: "guides/SKILL.md", type: "blob", sha: "1" },
          { path: "agents/portable.md", type: "blob", sha: "agent-sha" },
          { path: "hooks/portable.js", type: "blob", sha: "hook-sha" },
          { path: ".github/copilot-instructions.md", type: "blob", sha: "2" },
          { path: "rules/frontend.mdc", type: "blob", sha: "3" },
          { path: "prompt-templates/review.md", type: "blob", sha: "4" },
          { path: "workflow/deploy.json", type: "blob", sha: "5" },
          { path: "plugins/helper.md", type: "blob", sha: "6" },
          { path: "data/findings.csv", type: "blob", sha: "7" },
          { path: "src/ignored.ts", type: "blob", sha: "8" },
          { path: "docs", type: "tree", sha: "9" },
        ],
      });
    }

    if (url === "https://api.github.com/repos/acme/adaptable-toolbox/readme") {
      return new Response(null, { status: 404 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFetchMockFlag;
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  const source = buildSource();
  delete source.publisher;
  source.endpoints.repo = "https://github.com/acme/adaptable-toolbox";
  source.hosts = ["cursor", "opencode"];

  const entries = await harvestGitHubRepoSource(
    source,
    null,
    buildSelectionRegistry(),
    projectRoot,
  );
  const byPath = new Map(
    entries.map((entry) => [entry.install.relativePath, entry]),
  );

  assert.equal(byPath.get("guides/SKILL.md")?.compatibilityMode, "adaptable");
  assert.deepEqual(byPath.get("guides/SKILL.md")?.install.adaptableHosts, [
    "cursor",
    "opencode",
  ]);
  assert.equal(byPath.get("guides/SKILL.md")?.source.publisher, source.id);
  assert.equal(byPath.get("guides/SKILL.md")?.source.publisherVerified, false);
  assert.equal(byPath.get("agents/portable.md")?.assetKind, "agent");
  assert.equal(
    byPath.get("agents/portable.md")?.compatibilityMode,
    "adaptable",
  );
  assert.deepEqual(byPath.get("agents/portable.md")?.hosts, [
    "cursor",
    "opencode",
  ]);
  assert.equal(byPath.get("hooks/portable.js")?.assetKind, "hook");
  assert.equal(byPath.get("hooks/portable.js")?.compatibilityMode, "adaptable");
  assert.deepEqual(byPath.get("hooks/portable.js")?.hosts, [
    "cursor",
    "opencode",
  ]);
  assert.equal(
    byPath.get("guides/SKILL.md")?.maintenance.releaseCadence,
    "archived",
  );
  assert.ok(byPath.get("guides/SKILL.md")?.maintenance.lastUpdated);
  assert.equal(
    byPath.get(".github/copilot-instructions.md")?.assetKind,
    "instruction",
  );
  assert.equal(byPath.get("rules/frontend.mdc")?.assetKind, "instruction");
  assert.equal(
    byPath.get("prompt-templates/review.md")?.assetKind,
    "prompt-pack",
  );
  assert.equal(byPath.get("workflow/deploy.json")?.assetKind, "workflow");
  assert.equal(byPath.get("plugins/helper.md")?.assetKind, "plugin");
  assert.equal(byPath.get("data/findings.csv")?.assetKind, "reference-pack");
  assert.equal(byPath.has("src/ignored.ts"), false);
  assert.equal(byPath.has("docs"), false);
});

void test("github harvester skips sources when fetching fails with non-Error values", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-harvester-"),
  );
  const originalFetch = globalThis.fetch;
  const originalConsoleWarn = globalThis.console.warn;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const warnings: string[] = [];
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async () => {
    throw "network offline";
  };
  globalThis.console.warn = (...args: unknown[]) => {
    warnings.push(args.map((value) => String(value)).join(" "));
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    globalThis.console.warn = originalConsoleWarn;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFetchMockFlag;
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  assert.deepEqual(
    await harvestGitHubRepoSource(
      buildSource(),
      null,
      buildSelectionRegistry(),
      projectRoot,
    ),
    [],
  );
  assert.match(warnings.join("\n"), /network offline/u);
});

void test("github harvester drops unrecognized repository files", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-harvester-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url === "https://api.github.com/repos/acme/toolbox") {
      return jsonResponse({
        name: "toolbox",
        full_name: "acme/toolbox",
        description: null,
        default_branch: "main",
        updated_at: "2026-05-15T00:00:00.000Z",
        pushed_at: "2026-05-15T00:00:00.000Z",
        stargazers_count: 0,
        language: null,
        topics: [],
        archived: false,
        html_url: "https://github.com/acme/toolbox",
      });
    }

    if (
      url ===
      "https://api.github.com/repos/acme/toolbox/git/trees/main?recursive=1"
    ) {
      return jsonResponse({
        sha: "tree-sha",
        truncated: false,
        tree: [
          { path: "src/main.ts", type: "blob", sha: "1" },
          { path: "internal/config.yaml", type: "blob", sha: "2" },
        ],
      });
    }

    if (url === "https://api.github.com/repos/acme/toolbox/readme") {
      return new Response(null, { status: 404 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFetchMockFlag;
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  assert.deepEqual(
    await harvestGitHubRepoSource(
      buildSource(),
      null,
      buildSelectionRegistry(),
      projectRoot,
    ),
    [],
  );
});

void test("github harvester skips truncated repository trees", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-harvester-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url === "https://api.github.com/repos/acme/toolbox") {
      return jsonResponse({
        name: "toolbox",
        full_name: "acme/toolbox",
        description: null,
        default_branch: "main",
        updated_at: "2026-05-15T00:00:00.000Z",
        pushed_at: "2026-05-15T00:00:00.000Z",
        stargazers_count: 0,
        language: null,
        topics: [],
        archived: false,
        html_url: "https://github.com/acme/toolbox",
      });
    }

    if (
      url ===
      "https://api.github.com/repos/acme/toolbox/git/trees/main?recursive=1"
    ) {
      return jsonResponse({ sha: "tree-sha", truncated: true, tree: [] });
    }

    if (url === "https://api.github.com/repos/acme/toolbox/readme") {
      return new Response(null, { status: 404 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFetchMockFlag;
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  const entries = await harvestGitHubRepoSource(
    buildSource(),
    null,
    buildSelectionRegistry(),
    projectRoot,
  );

  assert.deepEqual(entries, []);
});

void test("github harvester reports guarded fetch failures and preserves native single-host classifications", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-harvester-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const warningMessages: string[] = [];
  const originalWarn = console.warn;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url === "https://api.github.com/repos/acme/native-toolbox") {
      return jsonResponse({
        name: "native-toolbox",
        full_name: "acme/native-toolbox",
        description: "Native host assets",
        default_branch: "main",
        updated_at: "2026-05-15T00:00:00.000Z",
        pushed_at: "2026-05-15T00:00:00.000Z",
        stargazers_count: 1,
        language: null,
        topics: [],
        archived: false,
        html_url: "https://github.com/acme/native-toolbox",
      });
    }

    if (
      url ===
      "https://api.github.com/repos/acme/native-toolbox/git/trees/main?recursive=1"
    ) {
      return jsonResponse({
        sha: "tree-sha",
        truncated: false,
        tree: [
          { path: "subagents/reviewer.md", type: "blob", sha: "1" },
          { path: "instructions/backend.md", type: "blob", sha: "2" },
          { path: "prompts/review.md", type: "blob", sha: "3" },
          { path: "workflows/release.yaml", type: "blob", sha: "4" },
          { path: "hooks/check.sh", type: "blob", sha: "5" },
        ],
      });
    }

    if (url === "https://api.github.com/repos/acme/native-toolbox/readme") {
      return new Response(null, { status: 404 });
    }

    throw "guarded network failure";
  };
  console.warn = (message?: unknown) => {
    warningMessages.push(String(message));
  };

  context.after(async () => {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFetchMockFlag;
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  const nativeSource = buildSource();
  nativeSource.endpoints.repo = "https://github.com/acme/native-toolbox";
  const entries = await harvestGitHubRepoSource(
    nativeSource,
    null,
    buildSelectionRegistry(),
    projectRoot,
  );
  const byPath = new Map(
    entries.map((entry) => [entry.install.relativePath, entry]),
  );

  for (const relativePath of [
    "subagents/reviewer.md",
    "instructions/backend.md",
    "prompts/review.md",
    "workflows/release.yaml",
    "hooks/check.sh",
  ]) {
    assert.equal(byPath.get(relativePath)?.compatibilityMode, "native");
    assert.deepEqual(byPath.get(relativePath)?.install.nativeHosts, ["cursor"]);
  }

  const failingSource = buildSource();
  failingSource.endpoints.repo = "https://github.com/acme/failing-toolbox";
  assert.deepEqual(
    await harvestGitHubRepoSource(
      failingSource,
      null,
      buildSelectionRegistry(),
      projectRoot,
    ),
    [],
  );
  assert.ok(
    warningMessages.some(
      (message) =>
        message.includes("Skipping repo source github-source:") &&
        message.includes("guarded network failure"),
    ),
  );
});

function buildSource(): SourceDefinition {
  return {
    id: "github-source",
    name: "github-source",
    kind: "repo",
    authorityTier: "trusted-community",
    publisher: { name: "acme", verified: false, owner: "acme" },
    hosts: ["cursor"],
    assetKinds: [
      "skill",
      "agent",
      "instruction",
      "workflow",
      "plugin",
      "hook",
      "mcp-server",
      "reference-pack",
    ],
    discoveryMode: "catalog",
    priority: 80,
    enabled: true,
    endpoints: { repo: "https://github.com/acme/toolbox" },
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
