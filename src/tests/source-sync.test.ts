import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readJsonFile, readJsonLinesFile, writeJsonFile } from "../files.js";
import { syncIndexedSources } from "../domains/discovery/source-sync.js";

type SourceSyncReport = {
  schemaVersion: 1;
  generatedAt: string;
  sources: Array<{
    sourceId: string;
    coverageMode: string;
    status: string;
    indexedEntryCount: number;
    reason?: string;
  }>;
};

void test("source sync indexes sitemap and html backed sources instead of sampling them", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-"),
  );
  const cleanupFetch = installFetchMock({
    "https://cursor.com/sitemap-marketplace.xml": xmlResponse([
      "<urlset>",
      "<url><loc>https://cursor.com/marketplace/acme/inspector</loc></url>",
      "</urlset>",
    ]),
    "https://skills.sh/sitemap.xml": xmlResponse([
      "<sitemapindex>",
      "<sitemap><loc>https://skills.sh/sitemap-skills-1.xml</loc></sitemap>",
      "<sitemap><loc>https://skills.sh/sitemap-agents.xml</loc></sitemap>",
      "</sitemapindex>",
    ]),
    "https://skills.sh/sitemap-skills-1.xml": xmlResponse([
      "<urlset>",
      "<url><loc>https://skills.sh/vercel/next-js-deployer</loc></url>",
      "</urlset>",
    ]),
    "https://skills.sh/sitemap-agents.xml": xmlResponse([
      "<urlset>",
      "<url><loc>https://skills.sh/agents/security-reviewer</loc></url>",
      "</urlset>",
    ]),
    "https://clawhub.ai/plugins?sort=downloads": htmlResponse([
      '<a href="/plugins/openclaw/toolbox">Toolbox</a>',
      '<a href="/plugins/openclaw/workflow-kit">Workflow Kit</a>',
    ]),
    "https://pypi.org/sitemap.xml": xmlResponse([
      "<sitemapindex>",
      "<sitemap><loc>https://pypi.org/00.sitemap.xml</loc></sitemap>",
      "</sitemapindex>",
    ]),
    "https://pypi.org/00.sitemap.xml": xmlResponse([
      "<urlset>",
      "<url><loc>https://pypi.org/project/fastmcp/</loc></url>",
      "</urlset>",
    ]),
    "https://zed.dev/extensions": htmlResponse([
      '<a href="/extensions/acme-theme">Acme Theme</a>',
    ]),
    "https://pi.dev/packages": htmlResponse([
      '<a href="/packages/%40acme/agent-pack">Agent Pack</a>',
    ]),
  });

  try {
    await writeTestSourceRegistry(projectRoot, [
      buildSource(
        "cursor-marketplace",
        "marketplace",
        {
          baseUrl: "https://cursor.com/marketplace",
          sitemapUrl: "https://cursor.com/sitemap-marketplace.xml",
        },
        ["cursor"],
        ["plugin"],
        "official-marketplace",
        {
          name: "Cursor",
          verified: true,
        },
      ),
      buildSource(
        "skills-sh",
        "registry",
        {
          baseUrl: "https://skills.sh",
          sitemapUrl: "https://skills.sh/sitemap.xml",
        },
        ["copilot-vscode"],
        ["skill", "agent"],
        "unverified-community",
        {
          name: "skills.sh",
          verified: false,
        },
      ),
      buildSource(
        "clawhub",
        "registry",
        {
          baseUrl: "https://clawhub.ai/skills",
          pluginsUrl: "https://clawhub.ai/plugins?sort=downloads",
        },
        ["copilot-vscode"],
        ["plugin", "skill"],
        "unverified-community",
        {
          name: "OpenClaw Community",
          verified: false,
        },
        { officialPreferred: false, allowMirror: false, allowInstall: false },
      ),
      buildSource(
        "pypi-registry",
        "package-registry",
        {
          baseUrl: "https://pypi.org",
          sitemapUrl: "https://pypi.org/sitemap.xml",
        },
        ["copilot-vscode"],
        ["mcp-server", "plugin"],
        "official-marketplace",
        {
          name: "PyPI",
          verified: true,
        },
      ),
      buildSource(
        "zed-extension-registry",
        "registry",
        {
          baseUrl: "https://zed.dev/extensions",
        },
        ["zed"],
        ["extension"],
        "official-marketplace",
        {
          name: "Zed",
          verified: true,
        },
      ),
      buildSource(
        "pi-packages",
        "registry",
        {
          baseUrl: "https://pi.dev/packages",
        },
        ["pi"],
        ["skill", "agent"],
        "official-compatible",
        {
          name: "Pi",
          verified: true,
        },
      ),
      buildSource(
        "github-awesome-copilot",
        "repo",
        {
          repo: "https://github.com/github/awesome-copilot",
        },
        ["copilot-vscode"],
        ["skill"],
        "official-first-party",
        {
          name: "GitHub",
          verified: true,
        },
      ),
      buildSource(
        "cursor-docs",
        "docs",
        {
          docsUrl: "https://docs.cursor.com",
        },
        ["cursor"],
        ["reference-pack"],
        "official-first-party",
        {
          name: "Cursor",
          verified: true,
        },
      ),
    ]);

    await syncIndexedSources(projectRoot);

    const report = await readJsonFile<SourceSyncReport>(
      join(projectRoot, "discover", "output", "source-sync.json"),
    );
    const byId = new Map(
      report.sources.map((source) => [source.sourceId, source]),
    );

    assert.equal(byId.get("cursor-docs")?.coverageMode, "direct");
    assert.equal(byId.get("github-awesome-copilot")?.coverageMode, "rotating");
    assert.equal(byId.get("cursor-marketplace")?.coverageMode, "indexed");
    assert.equal(byId.get("cursor-marketplace")?.status, "complete");
    assert.equal(byId.get("skills-sh")?.coverageMode, "indexed");
    assert.equal(byId.get("skills-sh")?.status, "complete");
    assert.equal(byId.get("clawhub")?.coverageMode, "indexed");
    assert.equal(byId.get("clawhub")?.status, "partial");
    assert.equal(byId.get("pypi-registry")?.coverageMode, "indexed");
    assert.equal(byId.get("zed-extension-registry")?.coverageMode, "indexed");
    assert.equal(byId.get("pi-packages")?.coverageMode, "indexed");
    assert.equal(
      report.sources.some((source) => source.coverageMode === "sampled"),
      false,
    );
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("source sync indexes official feed and api package registries", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-"),
  );
  const cleanupFetch = installFetchMock({
    "https://replicate.npmjs.com/_changes?since=0&limit=50": jsonResponse({
      last_seq: "5-g1AAA",
      results: [{ id: "fastmcp-server" }],
    }),
    "https://registry.npmjs.org/fastmcp-server": jsonResponse({
      name: "fastmcp-server",
      description: "Model Context Protocol server toolkit",
      keywords: ["mcp", "server"],
      repository: {
        type: "git",
        url: "https://github.com/acme/fastmcp-server",
      },
      time: { modified: "2026-05-10T10:00:00.000Z" },
    }),
    "https://crates.io/api/v1/crates?page=1&per_page=50": jsonResponse({
      crates: [
        {
          id: "cargo-agent",
          name: "cargo-agent",
          description: "Agent runtime crate",
          repository: "https://github.com/acme/cargo-agent",
          updated_at: "2026-05-09T00:00:00.000Z",
        },
      ],
    }),
    "https://index.golang.org/index?since=1970-01-01T00%3A00%3A00Z&limit=50":
      textResponse(
        '{"Path":"github.com/acme/go-agent","Timestamp":"2026-05-08T00:00:00Z"}\n',
      ),
    "https://search.maven.org/solrsearch/select?q=*%3A*&rows=50&start=0&wt=json":
      jsonResponse({
        response: {
          numFound: 1,
          docs: [
            {
              id: "com.acme:agent-core",
              g: "com.acme",
              a: "agent-core",
              timestamp: 1746835200000,
            },
          ],
        },
      }),
    "https://api.nuget.org/v3/index.json": jsonResponse({
      resources: [
        {
          "@id": "https://azuresearch-usnc.nuget.org/query",
          "@type": "SearchQueryService",
        },
      ],
    }),
    "https://azuresearch-usnc.nuget.org/query?q=&skip=0&take=50&prerelease=true&semVerLevel=2.0.0":
      jsonResponse({
        totalHits: 1,
        data: [
          {
            id: "Acme.AgentTools",
            description: "Agent utilities for .NET",
            tags: ["agent", "tooling"],
          },
        ],
      }),
    "https://packagist.org/packages/list.json": jsonResponse({
      packageNames: ["acme/agent-tools"],
    }),
    "https://registry.modelcontextprotocol.io/v0/servers": jsonResponse({
      servers: [
        {
          server: {
            name: "io.acme/agent-registry",
            title: "Acme Registry",
            description: "Hosted MCP server catalog for Acme agents.",
            version: "1.0.0",
            remotes: [
              {
                type: "streamable-http",
                url: "https://mcp.acme.test/server",
              },
            ],
          },
          _meta: {
            "io.modelcontextprotocol.registry/official": {
              isLatest: true,
              updatedAt: "2026-05-10T12:00:00.000Z",
            },
          },
        },
      ],
      metadata: {
        count: 1,
      },
    }),
    "https://rubygems.org/gems?page=1": htmlResponse([
      '<a href="/gems/agent_tools">Agent Tools</a>',
    ]),
    "https://swiftpackageindex.com/sitemap.xml": xmlResponse([
      "<urlset>",
      "<url><loc>https://swiftpackageindex.com/acme/SwiftAgent</loc></url>",
      "</urlset>",
    ]),
  });

  try {
    await writeTestSourceRegistry(projectRoot, [
      buildSource(
        "npm-registry",
        "package-registry",
        {
          baseUrl: "https://www.npmjs.com",
          changesApi: "https://replicate.npmjs.com/_changes",
        },
        ["copilot-vscode"],
        ["mcp-server", "plugin"],
        "official-marketplace",
        {
          name: "npm",
          verified: true,
        },
      ),
      buildSource(
        "cargo-registry",
        "package-registry",
        {
          baseUrl: "https://crates.io",
          apiUrl: "https://crates.io/api/v1/crates",
        },
        ["copilot-vscode"],
        ["plugin"],
        "official-marketplace",
        {
          name: "crates.io",
          verified: true,
        },
      ),
      buildSource(
        "go-registry",
        "package-registry",
        {
          baseUrl: "https://pkg.go.dev",
          indexApi: "https://index.golang.org/index",
        },
        ["copilot-vscode"],
        ["plugin"],
        "official-marketplace",
        {
          name: "Go",
          verified: true,
        },
      ),
      buildSource(
        "maven-registry",
        "package-registry",
        {
          baseUrl: "https://central.sonatype.com",
          searchApi: "https://search.maven.org/solrsearch/select",
        },
        ["copilot-vscode"],
        ["plugin"],
        "official-marketplace",
        {
          name: "Maven Central",
          verified: true,
        },
      ),
      buildSource(
        "nuget-registry",
        "package-registry",
        {
          baseUrl: "https://www.nuget.org",
          serviceIndexUrl: "https://api.nuget.org/v3/index.json",
        },
        ["copilot-vscode"],
        ["plugin"],
        "official-marketplace",
        {
          name: "NuGet",
          verified: true,
        },
      ),
      buildSource(
        "packagist-registry",
        "package-registry",
        {
          baseUrl: "https://packagist.org",
          listApi: "https://packagist.org/packages/list.json",
        },
        ["copilot-vscode"],
        ["plugin"],
        "official-marketplace",
        {
          name: "Packagist",
          verified: true,
        },
      ),
      buildSource(
        "rubygems-registry",
        "package-registry",
        {
          baseUrl: "https://rubygems.org",
        },
        ["copilot-vscode"],
        ["plugin"],
        "official-marketplace",
        {
          name: "RubyGems",
          verified: true,
        },
      ),
      buildSource(
        "swift-package-index",
        "package-registry",
        {
          baseUrl: "https://swiftpackageindex.com",
          sitemapUrl: "https://swiftpackageindex.com/sitemap.xml",
        },
        ["copilot-vscode"],
        ["plugin"],
        "official-compatible",
        {
          name: "Swift Package Index",
          verified: true,
        },
      ),
      buildSource(
        "mcp-registry",
        "registry",
        {
          baseUrl: "https://registry.modelcontextprotocol.io/",
          apiUrl: "https://registry.modelcontextprotocol.io/v0/servers",
        },
        ["copilot-vscode", "opencode", "shared"],
        ["mcp-server"],
        "official-first-party",
        {
          name: "Model Context Protocol",
          verified: true,
        },
        {
          officialPreferred: true,
          allowMirror: false,
          allowInstall: true,
        },
      ),
    ]);

    await syncIndexedSources(projectRoot);

    const report = await readJsonFile<SourceSyncReport>(
      join(projectRoot, "discover", "output", "source-sync.json"),
    );
    const byId = new Map(
      report.sources.map((source) => [source.sourceId, source]),
    );

    assert.equal(byId.get("npm-registry")?.coverageMode, "indexed");
    assert.equal(byId.get("npm-registry")?.status, "partial");
    assert.equal(byId.get("go-registry")?.status, "partial");
    assert.equal(byId.get("cargo-registry")?.coverageMode, "indexed");
    assert.equal(byId.get("maven-registry")?.coverageMode, "indexed");
    assert.equal(byId.get("nuget-registry")?.coverageMode, "indexed");
    assert.equal(byId.get("packagist-registry")?.coverageMode, "indexed");
    assert.equal(byId.get("rubygems-registry")?.coverageMode, "indexed");
    assert.equal(byId.get("swift-package-index")?.coverageMode, "indexed");
    assert.equal(byId.get("mcp-registry")?.coverageMode, "indexed");
    assert.equal(byId.get("mcp-registry")?.status, "complete");
    assert.equal(
      report.sources.some((source) => source.coverageMode === "sampled"),
      false,
    );
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("source sync keeps html-backed sources partial when a later page fetch fails", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-"),
  );
  const cleanupFetch = installFetchMock({
    "https://pi.dev/packages": htmlResponse([
      '<a href="/packages/%40acme/agent-pack">Agent Pack</a>',
      '<a href="/packages?page=2">2</a>',
    ]),
    "https://pi.dev/packages?page=2": () => {
      throw new Error("timed out while fetching page 2");
    },
  });

  try {
    await writeTestSourceRegistry(projectRoot, [
      buildSource(
        "pi-packages",
        "registry",
        {
          baseUrl: "https://pi.dev/packages",
        },
        ["pi"],
        ["skill", "agent"],
        "official-compatible",
        {
          name: "Pi",
          verified: true,
        },
      ),
    ]);

    await syncIndexedSources(projectRoot);

    const report = await readJsonFile<SourceSyncReport>(
      join(projectRoot, "discover", "output", "source-sync.json"),
    );
    const piPackages = report.sources.find(
      (source) => source.sourceId === "pi-packages",
    );

    assert.equal(piPackages?.coverageMode, "indexed");
    assert.equal(piPackages?.status, "partial");
    assert.match(piPackages?.reason ?? "", /page=2/u);
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("source sync reruns completed finite sources and evicts removed entries", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-"),
  );
  let syncRunCount = 0;
  const cleanupFetch = installFetchMock({
    "https://pi.dev/packages": () => {
      syncRunCount += 1;
      return htmlResponse(
        syncRunCount === 1
          ? ['<a href="/packages/%40acme/old-pack">Old Pack</a>']
          : ['<a href="/packages/%40acme/new-pack">New Pack</a>'],
      );
    },
  });

  try {
    await writeTestSourceRegistry(projectRoot, [
      buildSource(
        "pi-packages",
        "registry",
        {
          baseUrl: "https://pi.dev/packages",
        },
        ["pi"],
        ["skill", "agent"],
        "official-compatible",
        {
          name: "Pi",
          verified: true,
        },
      ),
    ]);

    await syncIndexedSources(projectRoot);
    const firstEntries = await readJsonLinesFile<{ id: string }>(
      join(projectRoot, "state", "discover", "source-sync.entries.jsonl"),
    );

    await syncIndexedSources(projectRoot);
    const secondEntries = await readJsonLinesFile<{ id: string }>(
      join(projectRoot, "state", "discover", "source-sync.entries.jsonl"),
    );

    assert.equal(syncRunCount, 2);
    assert.equal(firstEntries.length, 1);
    assert.equal(secondEntries.length, 1);
    assert.notEqual(secondEntries[0]?.id, firstEntries[0]?.id);
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

async function writeTestSourceRegistry(
  projectRoot: string,
  sources: unknown[],
): Promise<void> {
  await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources,
  });
  await writeJsonFile(join(projectRoot, "discover", "selections.json"), {
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
  });
}

function buildSource(
  id: string,
  kind: string,
  endpoints: Record<string, string>,
  hosts: string[],
  assetKinds: string[],
  authorityTier: string,
  publisher: { name: string; verified: boolean },
  rules?: {
    officialPreferred: boolean;
    allowMirror: boolean;
    allowInstall: boolean;
  },
): Record<string, unknown> {
  return {
    id,
    name: id,
    kind,
    authorityTier,
    publisher,
    hosts,
    assetKinds,
    discoveryMode: "catalog",
    priority: 80,
    enabled: true,
    endpoints,
    rules: rules ?? {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  };
}

function installFetchMock(
  responses: Record<string, Response | (() => Response)>,
): () => void {
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
    const responder = responses[url];
    if (!responder) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return typeof responder === "function" ? responder() : responder.clone();
  };

  return () => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
      return;
    }
    process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFetchMockFlag;
  };
}

function textResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function htmlResponse(lines: string[]): Response {
  return new Response(lines.join("\n"), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function xmlResponse(lines: string[]): Response {
  return new Response(lines.join(""), {
    status: 200,
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
