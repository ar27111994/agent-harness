import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeJsonFile } from "../files.js";
import { harvestOfficialSkillIndexes } from "../domains/discovery/official-index-harvester.js";
import type { DemandProfile, SourceDefinition } from "../types.js";

interface OfficialUpstreamResolutionTestReport {
  resolvedCount: number;
  unresolvedCount: number;
  ambiguousCount: number;
  resolved: Array<{
    slug: string;
    source?: string;
    sourceId?: string;
  }>;
  unresolved: Array<{
    slug: string;
  }>;
  ambiguous: Array<{
    candidates: string[];
  }>;
}

interface OfficialUpstreamCacheTestReport {
  entries: Array<{
    repoUrl: string;
  }>;
}

void test("official index harvester parses entries, resolves repo-backed sources, and dedupes duplicates", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-official-index-"),
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

    if (
      url === "https://raw.githubusercontent.com/acme/official/main/index.md"
    ) {
      return new Response(
        [
          "# Anthropic",
          "**[Workflow Kit](https://officialskills.sh/anthropics/skills/workflow-kit)** - Reference cookbook for testing workflows.",
          "Repo: https://github.com/anthropics/workflow-kit",
          "",
          "# Scopeblind",
          "**[MCP Gateway](https://officialskills.sh/scopeblind/skills/mcp-gateway)** - MCP server plugin for gateway access.",
          "Repo: https://github.com/scopeblind/mcp-gateway",
          "",
          "# Anthropic duplicate",
          "**[Workflow Kit](https://officialskills.sh/anthropics/skills/workflow-kit)** - Reference cookbook for testing workflows.",
          "Repo: https://github.com/anthropics/workflow-kit",
        ].join("\n"),
        {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        },
      );
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

  await writeJsonFile(
    join(projectRoot, "discover", "official-skills-indexes.json"),
    {
      schemaVersion: 1,
      indexes: [
        {
          id: "official-index",
          kind: "markdown",
          url: "https://raw.githubusercontent.com/acme/official/main/index.md",
        },
      ],
    },
  );
  await writeJsonFile(
    join(projectRoot, "discover", "official-upstreams.json"),
    {
      schemaVersion: 1,
      owners: {
        anthropics: ["anthropics"],
        scopeblind: ["scopeblind"],
      },
    },
  );
  await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [
      buildSource(
        "anthropics-workflow-kit",
        "https://github.com/anthropics/workflow-kit",
        "official-first-party",
      ),
      buildSource(
        "scopeblind-gateway",
        "https://github.com/scopeblind/mcp-gateway",
        "official-first-party",
      ),
    ],
  });

  const entries = await harvestOfficialSkillIndexes(
    projectRoot,
    buildDemandProfile(),
  );
  const ids = entries.map((entry) => entry.id).sort();

  assert.deepEqual(ids, [
    "anthropics-workflow-kit:workflow-kit",
    "official-index:anthropics:workflow-kit",
    "official-index:scopeblind:mcp-gateway",
    "scopeblind-gateway:mcp-gateway",
  ]);

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  assert.equal(
    byId.get("official-index:anthropics:workflow-kit")?.assetKind,
    "workflow",
  );
  assert.equal(
    byId.get("official-index:anthropics:workflow-kit")?.compatibilityMode,
    "native",
  );
  assert.deepEqual(byId.get("official-index:scopeblind:mcp-gateway")?.hosts, [
    "copilot-vscode",
    "opencode",
    "shared",
  ]);
  assert.equal(
    byId.get("official-index:scopeblind:mcp-gateway")?.assetKind,
    "mcp-server",
  );
  assert.equal(
    byId.get("anthropics-workflow-kit:workflow-kit")?.source.sourceId,
    "anthropics-workflow-kit",
  );
  assert.equal(
    byId.get("anthropics-workflow-kit:workflow-kit")?.install.method,
    "github-tree-metadata",
  );
  assert.equal(
    byId.get("anthropics-workflow-kit:workflow-kit")?.status.installEligible,
    true,
  );
  assert.equal(
    byId.get("anthropics-workflow-kit:workflow-kit")?.evidence.rootPath,
    "https://github.com/anthropics/workflow-kit",
  );

  const resolutionReport = await readJson<OfficialUpstreamResolutionTestReport>(
    projectRoot,
    ["discover", "output", "official-upstream-resolution.json"],
  );
  assert.equal(resolutionReport.resolvedCount, 2);
  assert.equal(resolutionReport.unresolvedCount, 0);
  assert.equal(resolutionReport.ambiguousCount, 0);
  assert.deepEqual(
    resolutionReport.resolved
      .map((entry: { sourceId?: string }) => entry.sourceId)
      .sort(),
    ["anthropics-workflow-kit", "scopeblind-gateway"],
  );

  const resolutionCache = await readJson<OfficialUpstreamCacheTestReport>(
    projectRoot,
    ["state", "discover", "official-upstream-cache.json"],
  );
  assert.deepEqual(
    resolutionCache.entries
      .map((entry: { repoUrl: string }) => entry.repoUrl)
      .sort(),
    [
      "https://github.com/anthropics/workflow-kit",
      "https://github.com/scopeblind/mcp-gateway",
    ],
  );
});

void test("official index harvester resolves page repositories, caches them, and reports unresolved and ambiguous entries", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-official-index-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  const fetchedUrls: string[] = [];

  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    fetchedUrls.push(url);

    if (
      url === "https://raw.githubusercontent.com/acme/official/main/index.md"
    ) {
      return new Response(
        [
          "# Page only",
          "**[Page Repo](https://officialskills.sh/anthropics/skills/page-repo)** - Workflow from page metadata.",
          "",
          "# Search only",
          "**[Search Repo](https://officialskills.sh/anthropics/skills/search-repo)** - Workflow from repository search.",
          "",
          "# Missing",
          "**[Missing Repo](https://officialskills.sh/anthropics/skills/missing-repo)** - Workflow without a repo.",
          "",
          "# Ambiguous",
          "**[Wrong Owner](https://officialskills.sh/anthropics/skills/wrong-owner)** - Workflow with a third-party repo.",
        ].join("\n"),
        {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        },
      );
    }

    if (url === "https://officialskills.sh/anthropics/skills/page-repo") {
      return new Response(
        '<html><body><a href="https://github.com/anthropics/page-repo">View on GitHub</a></body></html>',
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }

    if (url === "https://officialskills.sh/anthropics/skills/search-repo") {
      return new Response("<html><body>No repository here.</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url === "https://officialskills.sh/anthropics/skills/missing-repo") {
      return new Response("<html><body>No repository here.</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url === "https://officialskills.sh/anthropics/skills/wrong-owner") {
      return new Response(
        '<html><body><a href="https://github.com/community/wrong-owner">View on GitHub</a></body></html>',
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }

    if (url.startsWith("https://api.github.com/search/repositories?")) {
      const parsedUrl = new URL(url);
      const query = parsedUrl.searchParams.get("q") ?? "";
      if (query.includes("search-repo")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                full_name: "anthropics/search-repo",
                html_url: "https://github.com/anthropics/search-repo",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          },
        );
      }

      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
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

  await writeJsonFile(
    join(projectRoot, "discover", "official-skills-indexes.json"),
    {
      schemaVersion: 1,
      indexes: [
        {
          id: "official-index",
          kind: "markdown",
          url: "https://raw.githubusercontent.com/acme/official/main/index.md",
        },
      ],
    },
  );
  await writeJsonFile(
    join(projectRoot, "discover", "official-upstreams.json"),
    {
      schemaVersion: 1,
      owners: {
        anthropics: ["anthropics"],
      },
    },
  );
  await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [
      buildSource(
        "anthropics-page-repo",
        "https://github.com/anthropics/page-repo",
        "official-first-party",
      ),
    ],
  });

  const firstEntries = await harvestOfficialSkillIndexes(projectRoot, null);
  assert.equal(
    firstEntries.find(
      (entry) => entry.id === "official-index:anthropics:page-repo",
    )?.evidence.rootPath,
    "https://github.com/anthropics/page-repo",
  );
  assert.equal(
    firstEntries.find((entry) => entry.id === "anthropics-page-repo:page-repo")
      ?.source.sourceId,
    "anthropics-page-repo",
  );

  const firstReport = await readJson<OfficialUpstreamResolutionTestReport>(
    projectRoot,
    ["discover", "output", "official-upstream-resolution.json"],
  );
  assert.equal(firstReport.resolvedCount, 2);
  assert.equal(firstReport.unresolvedCount, 1);
  assert.equal(firstReport.ambiguousCount, 1);
  const resolvedBySlug = new Map<
    string,
    { source?: string; sourceId?: string }
  >(
    firstReport.resolved.map(
      (entry: { slug: string; source?: string; sourceId?: string }) => [
        entry.slug,
        entry,
      ],
    ),
  );
  assert.equal(resolvedBySlug.get("page-repo")?.source, "page");
  assert.equal(
    resolvedBySlug.get("page-repo")?.sourceId,
    "anthropics-page-repo",
  );
  assert.equal(resolvedBySlug.get("search-repo")?.source, "search");
  assert.equal(firstReport.unresolved[0]?.slug, "missing-repo");
  assert.deepEqual(firstReport.ambiguous[0]?.candidates, [
    "https://github.com/community/wrong-owner",
  ]);

  const pageFetchCount = fetchedUrls.filter(
    (url) => url === "https://officialskills.sh/anthropics/skills/page-repo",
  ).length;
  assert.equal(pageFetchCount, 1);

  await harvestOfficialSkillIndexes(projectRoot, null);
  const secondPageFetchCount = fetchedUrls.filter(
    (url) => url === "https://officialskills.sh/anthropics/skills/page-repo",
  ).length;
  assert.equal(secondPageFetchCount, 1);
});

void test("official index harvester ignores missing configs and unavailable fetches", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-official-index-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async () => new Response(null, { status: 404 });

  context.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFetchMockFlag;
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [],
  });

  assert.deepEqual(await harvestOfficialSkillIndexes(projectRoot, null), []);

  await writeJsonFile(
    join(projectRoot, "discover", "official-skills-indexes.json"),
    {
      schemaVersion: 1,
      indexes: [
        {
          id: "official-index",
          kind: "markdown",
          url: "https://raw.githubusercontent.com/acme/official/main/index.md",
        },
      ],
    },
  );

  assert.deepEqual(await harvestOfficialSkillIndexes(projectRoot, null), []);
});

void test("official index harvester skips malformed rows and resolves fallback repo sources without publisher metadata", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-official-index-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async () =>
    new Response(
      [
        "**[   ](https://officialskills.sh/community/skills/blank-name)** - Malformed row should be skipped.",
        "**[Useful Skill](https://officialskills.sh/community/skills/useful-skill)** - Useful community workflow guidance.",
      ].join("\n"),
      {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      },
    );

  context.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFetchMockFlag;
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  await writeJsonFile(
    join(projectRoot, "discover", "official-skills-indexes.json"),
    {
      schemaVersion: 1,
      indexes: [
        {
          id: "official-index",
          kind: "markdown",
          url: "https://raw.githubusercontent.com/acme/official/main/index.md",
        },
      ],
    },
  );
  await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [
      buildSourceWithoutPublisher(
        "gitlab-community-skill",
        "https://gitlab.com/community/useful-skill",
        "trusted-community",
      ),
      buildSourceWithoutPublisher(
        "community-useful-skill",
        "https://github.com/community/useful-skill",
        "trusted-community",
      ),
    ],
  });

  const entries = await harvestOfficialSkillIndexes(projectRoot, null);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  assert.deepEqual([...byId.keys()].sort(), [
    "community-useful-skill:useful-skill",
    "official-index:community:useful-skill",
  ]);
  assert.equal(byId.get("official-index:community:blank-name"), undefined);
  assert.equal(
    byId.get("community-useful-skill:useful-skill")?.source.publisher,
    "community",
  );
  assert.equal(
    byId.get("community-useful-skill:useful-skill")?.source.publisherVerified,
    false,
  );
});

async function readJson<T>(
  projectRoot: string,
  pathParts: string[],
): Promise<T> {
  return JSON.parse(
    await readFile(join(projectRoot, ...pathParts), "utf8"),
  ) as T;
}

function buildDemandProfile(): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "fixtures/workspace",
    summary: {
      scannedFiles: 1,
      matchedFiles: 1,
    },
    signals: {
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: ["workflow"],
      concerns: ["testing"],
      tooling: ["mcp"],
    },
    evidence: [],
  };
}

function buildSource(
  id: string,
  repo: string,
  authorityTier: SourceDefinition["authorityTier"],
): SourceDefinition {
  return {
    id,
    name: id,
    kind: "repo",
    authorityTier,
    publisher: { name: id, verified: true },
    hosts: ["copilot-vscode", "opencode", "shared"],
    assetKinds: ["workflow", "mcp-server", "reference-pack"],
    discoveryMode: "catalog",
    priority: 90,
    enabled: true,
    endpoints: { repo },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  };
}

function buildSourceWithoutPublisher(
  id: string,
  repo: string,
  authorityTier: SourceDefinition["authorityTier"],
): SourceDefinition {
  const source = buildSource(id, repo, authorityTier);
  delete source.publisher;
  return source;
}
