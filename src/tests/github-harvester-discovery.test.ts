import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  harvestGitHubRepoSource,
  githubHarvesterInternals,
} from "../domains/discovery/github-harvester.js";
import type {
  GitHubRepoSnapshot,
  SelectionRegistry,
  SourceDefinition,
} from "../types.js";

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
          {
            path: "mcp/packages/serverish/src/index.ts",
            type: "blob",
            sha: "6",
          },
          { path: "mcp/packages/plugin/src/plugin.ts", type: "blob", sha: "2" },
          { path: "mcp/README.md", type: "blob", sha: "3" },
          { path: "docs/mcp/index.md", type: "blob", sha: "5" },
          { path: "docs/mcpx/example.md", type: "blob", sha: "7" },
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
      includePaths: [
        "/mcp/README.md",
        " ./mcp/packages/server/** ",
        "docs\\mcp\\**",
      ],
      excludePaths: ["/mcp/packages/plugin/**"],
      mcpServerPaths: ["mcp/packages/server/src/**"],
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
  assert.equal(byPath.get("docs/mcp/index.md")?.assetKind, "reference-pack");
  assert.equal(byPath.has("mcp/packages/serverish/src/index.ts"), false);
  assert.equal(byPath.has("docs/mcpx/example.md"), false);
  assert.equal(byPath.has("mcp/packages/plugin/src/plugin.ts"), false);
  assert.equal(byPath.has(".opencode/skills/internal/SKILL.md"), false);
});

void test("github harvester does not treat generic mcp package server directories as MCP servers", async (context) => {
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

    if (url === "https://api.github.com/repos/acme/monorepo") {
      return jsonResponse({
        name: "monorepo",
        full_name: "acme/monorepo",
        description: "Generic monorepo",
        default_branch: "main",
        updated_at: "2026-05-15T00:00:00.000Z",
        pushed_at: "2026-05-15T00:00:00.000Z",
        stargazers_count: 100,
        language: "TypeScript",
        topics: ["typescript"],
        archived: false,
        html_url: "https://github.com/acme/monorepo",
      });
    }

    if (
      url ===
      "https://api.github.com/repos/acme/monorepo/git/trees/main?recursive=1"
    ) {
      return jsonResponse({
        sha: "tree-sha",
        truncated: false,
        tree: [
          { path: "mcp/packages/server/src/index.ts", type: "blob", sha: "1" },
          { path: "mcp-server/index.ts", type: "blob", sha: "2" },
        ],
      });
    }

    if (url === "https://api.github.com/repos/acme/monorepo/readme") {
      return jsonResponse({
        path: "README.md",
        sha: "readme-sha",
        size: 120,
        html_url: "https://github.com/acme/monorepo/blob/main/README.md",
        download_url:
          "https://raw.githubusercontent.com/acme/monorepo/main/README.md",
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
      endpoints: { repo: "https://github.com/acme/monorepo" },
    },
    null,
    buildSelectionRegistry(),
    projectRoot,
  );
  const byPath = new Map(
    entries.map((entry) => [entry.install.relativePath, entry]),
  );

  assert.equal(byPath.has("mcp/packages/server/src/index.ts"), false);
  assert.equal(byPath.get("mcp-server/index.ts")?.assetKind, "mcp-server");
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

function textResponse(value: string): Response {
  return new Response(value, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

void test("github harvester emits oms-signed signal for assets with skill.oms.sig sibling and oms-trust-anchor for repo with root cert", async (context) => {
  // Generate real crypto material so blob validation passes.
  const { generateKeyPairSync, createSign } = await import("node:crypto");
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const pemContent = publicKey.export({ type: "spki", format: "pem" });

  // Asset content that the OMS sig signs (must match the SKILL.md in the tree)
  const assetContent = [
    "---",
    "name: cuda-debugger",
    "description: CUDA debugging skill",
    "---",
    "",
    "# CUDA Debugger",
    "Debug CUDA kernels with this skill.",
  ].join("\n");

  const signer = createSign("SHA256");
  signer.update(assetContent);
  const sigContent = signer.sign(privateKey, "base64");

  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-oms-trust-"));
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

    if (url === "https://api.github.com/repos/nvidia/skills") {
      return jsonResponse({
        name: "skills",
        full_name: "nvidia/skills",
        description: "Official NVIDIA agent skills catalog",
        default_branch: "main",
        updated_at: "2026-05-01T00:00:00.000Z",
        pushed_at: "2026-05-01T00:00:00.000Z",
        stargazers_count: 88,
        language: "Markdown",
        topics: ["skills", "nvidia", "agent"],
        archived: false,
        html_url: "https://github.com/nvidia/skills",
      });
    }

    // Blob API — return cryptographically plausible content for OMS files
    if (
      url === "https://api.github.com/repos/nvidia/skills/git/blobs/cert-sha"
    ) {
      return textResponse(pemContent);
    }
    if (
      url === "https://api.github.com/repos/nvidia/skills/git/blobs/sig-sha"
    ) {
      return textResponse(sigContent);
    }

    // SKILL.md asset content (signed by the OMS sig)
    if (
      url === "https://api.github.com/repos/nvidia/skills/git/blobs/skill-sha"
    ) {
      return textResponse(assetContent);
    }

    if (
      url ===
      "https://api.github.com/repos/nvidia/skills/git/trees/main?recursive=1"
    ) {
      return jsonResponse({
        sha: "tree-sha",
        truncated: false,
        tree: [
          // Root cert — marks the whole repo as OMS-anchored
          {
            path: "nv-agent-root-cert.pem",
            type: "blob",
            sha: "cert-sha",
            size: 1024,
          },
          // Signed skill — has a sibling .oms.sig
          {
            path: "skills/cuda-debugger/SKILL.md",
            type: "blob",
            sha: "skill-sha",
          },
          {
            path: "skills/cuda-debugger/skill.oms.sig",
            type: "blob",
            sha: "sig-sha",
            size: 256,
          },
          // Unsigned skill — no .oms.sig sibling
          {
            path: "skills/model-monitor/SKILL.md",
            type: "blob",
            sha: "unsigned-sha",
          },
          { path: "LICENSE", type: "blob", sha: "lic-sha" },
        ],
      });
    }

    if (url === "https://api.github.com/repos/nvidia/skills/readme") {
      return jsonResponse({
        path: "README.md",
        sha: "readme-sha",
        size: 80,
        html_url: "https://github.com/nvidia/skills/blob/main/README.md",
        download_url:
          "https://raw.githubusercontent.com/nvidia/skills/main/README.md",
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

  const nvidiaSource = buildSource();
  nvidiaSource.endpoints.repo = "https://github.com/nvidia/skills";

  const entries = await harvestGitHubRepoSource(
    nvidiaSource,
    null,
    buildSelectionRegistry(),
    projectRoot,
  );
  const byPath = new Map(
    entries.map((entry) => [entry.install.relativePath, entry]),
  );

  const signedSkill = byPath.get("skills/cuda-debugger/SKILL.md");
  const unsignedSkill = byPath.get("skills/model-monitor/SKILL.md");

  assert.ok(signedSkill, "signed SKILL.md should be cataloged");
  assert.ok(unsignedSkill, "unsigned SKILL.md should be cataloged");

  // Signed asset: both oms-signed (per-asset) and oms-trust-anchor (repo-level)
  assert.ok(
    signedSkill.trust.signals.includes("oms-signed"),
    "signed skill must carry oms-signed signal",
  );
  assert.ok(
    signedSkill.trust.signals.includes("oms-trust-anchor"),
    "signed skill must carry oms-trust-anchor repo signal",
  );

  // Unsigned asset: trust-anchor present (repo-level) but no per-asset oms-signed
  assert.ok(
    !unsignedSkill.trust.signals.includes("oms-signed"),
    "unsigned skill must not carry oms-signed signal",
  );
  assert.ok(
    unsignedSkill.trust.signals.includes("oms-trust-anchor"),
    "unsigned skill still carries oms-trust-anchor from repo-level cert",
  );

  // Score of signed skill must exceed that of unsigned skill by exactly 5 points
  assert.equal(
    signedSkill.trust.score - unsignedSkill.trust.score,
    5,
    "oms-signed adds +5 to trust score",
  );
});

void test("collectRepositoryTrustEvidence does not award oms-trust-anchor when pemVerified is false or absent", () => {
  // Minimal snapshot with PEM-cert blob in tree but no verified flag.
  const snapshot = {
    sourceId: "test",
    owner: "fake",
    repo: "fake",
    fetchedAt: new Date().toISOString(),
    repoSummary: {
      name: "fake",
      fullName: "fake/fake",
      description: null,
      defaultBranch: "main",
      updatedAt: null,
      pushedAt: null,
      stars: 0,
      language: null,
      topics: [],
      archived: false,
      htmlUrl: "https://github.com/fake/fake",
    },
    readme: { path: "README.md", content: "" },
    tree: {
      sha: "tree-sha",
      truncated: false,
      entries: [
        { path: "nv-agent-root-cert.pem", type: "blob", size: 1024, sha: "x" },
        { path: "skills/test/SKILL.md", type: "blob", size: 100, sha: "y" },
        {
          path: "skills/test/skill.oms.sig",
          type: "blob",
          size: 256,
          sha: "z",
        },
      ],
    },
  } as unknown as GitHubRepoSnapshot;

  // Without pemVerified — no PEM trust signal
  const { collectRepositoryTrustEvidence } = githubHarvesterInternals;
  const withoutPem = collectRepositoryTrustEvidence(snapshot);
  assert.ok(
    !withoutPem.signals.includes("oms-trust-anchor"),
    "oms-trust-anchor must not be present when pemVerified is absent",
  );

  // With pemVerified=false — still no PEM trust signal
  const withFalse = collectRepositoryTrustEvidence({
    ...snapshot,
    pemVerified: false,
  });
  assert.ok(
    !withFalse.signals.includes("oms-trust-anchor"),
    "oms-trust-anchor must not be present when pemVerified is false",
  );

  // With pemVerified=true — trust signal awarded
  const withTrue = collectRepositoryTrustEvidence({
    ...snapshot,
    pemVerified: true,
  });
  assert.ok(
    withTrue.signals.includes("oms-trust-anchor"),
    "oms-trust-anchor must be present when pemVerified is true",
  );
});

void test("collectRepositoryTrustEvidence: pemVerified gate", () => {
  const s = { sourceId:"t",owner:"f",repo:"f",fetchedAt:new Date().toISOString(),repoSummary:{name:"f",fullName:"f/f",description:null,defaultBranch:"main",updatedAt:null,pushedAt:null,stars:0,language:null,topics:[],archived:false,htmlUrl:"https://github.com/f/f"},readme:{path:"README.md",content:""},tree:{sha:"x",truncated:false,entries:[{path:"nv-agent-root-cert.pem",type:"blob",size:1024,sha:"x"}]}} as unknown as GitHubRepoSnapshot;
  const { collectRepositoryTrustEvidence } = githubHarvesterInternals;
  assert.ok(!collectRepositoryTrustEvidence(s).signals.includes("oms-trust-anchor"), "absent when pemVerified missing");
  assert.ok(!collectRepositoryTrustEvidence({...s,pemVerified:false}).signals.includes("oms-trust-anchor"), "absent when pemVerified false");
  assert.ok(collectRepositoryTrustEvidence({...s,pemVerified:true}).signals.includes("oms-trust-anchor"), "present when pemVerified true");
});
