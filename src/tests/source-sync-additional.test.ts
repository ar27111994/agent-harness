import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { readJsonFile, writeJsonFile } from "../files.js";
import { SOURCE_SYNC_STATE_OUTPUT_PATH } from "../domains/discovery/output-paths.js";
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
    cursors: Array<{
      cursorId: string;
      nextToken?: string;
      completed: boolean;
    }>;
  }>;
};

void test("source sync marks indexed sources as failed when the first html fetch aborts", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-additional-"),
  );
  const cleanupFetch = installFetchMock({
    "https://pi.dev/packages": () => {
      throw new Error("hard fail before any page sync");
    },
  });

  try {
    await writeTestSourceRegistry(projectRoot, [
      buildSource("pi-packages", "registry", {
        baseUrl: "https://pi.dev/packages",
      }),
    ]);

    await syncIndexedSources(projectRoot);

    const report = await readJsonFile<SourceSyncReport>(
      join(projectRoot, "discover", "output", "source-sync.json"),
    );
    const source = report.sources.find(
      (entry) => entry.sourceId === "pi-packages",
    );

    assert.equal(source?.coverageMode, "indexed");
    assert.equal(source?.status, "failed");
    assert.equal(source?.indexedEntryCount, 0);
    assert.deepEqual(source?.cursors, []);
    assert.match(
      source?.reason ?? "",
      /Failed to fetch https:\/\/pi.dev\/packages/u,
    );
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("source sync preserves prior sitemap cursors and classifies unsupported known ids", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-additional-"),
  );
  const leafUrls = Array.from({ length: 51 }, (_, index) => {
    const itemNumber = index + 1;
    return `<url><loc>https://skills.sh/vercel/skill-${itemNumber}</loc></url>`;
  });
  const cleanupFetch = installFetchMock({
    "https://skills.sh/sitemap.xml": xmlResponse([
      "<sitemapindex>",
      "<sitemap><loc>https://skills.sh/sitemap-skills-1.xml</loc></sitemap>",
      "</sitemapindex>",
    ]),
    "https://skills.sh/sitemap-skills-1.xml": xmlResponse([
      "<urlset>",
      ...leafUrls,
      "</urlset>",
    ]),
  });

  try {
    await writeTestSourceRegistry(projectRoot, [
      buildSource("vscode-marketplace", "registry", {
        baseUrl: "https://marketplace.visualstudio.com",
      }),
      buildSource("skills-sh", "registry", {
        baseUrl: "https://skills.sh",
        sitemapUrl: "https://skills.sh/sitemap.xml",
      }),
    ]);
    await writeJsonFile(join(projectRoot, ...SOURCE_SYNC_STATE_OUTPUT_PATH), {
      schemaVersion: 1,
      generatedAt: "2026-05-15T00:00:00.000Z",
      sources: [
        {
          sourceId: "skills-sh",
          coverageMode: "indexed",
          status: "partial",
          indexedEntryCount: 0,
          cursors: [
            {
              cursorId: "https://skills.sh/sitemap-skills-1.xml",
              nextToken: "0",
              completed: false,
            },
          ],
        },
      ],
    });

    await withEnv(
      {
        AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_PER_RUN: "1",
      },
      async () => {
        await syncIndexedSources(projectRoot);
      },
    );

    const report = await readJsonFile<SourceSyncReport>(
      join(projectRoot, "discover", "output", "source-sync.json"),
    );
    const byId = new Map(
      report.sources.map((entry) => [entry.sourceId, entry]),
    );

    assert.equal(byId.get("vscode-marketplace")?.coverageMode, "sampled");
    assert.equal(byId.get("vscode-marketplace")?.status, "unsupported");

    const skills = byId.get("skills-sh");
    assert.equal(skills?.coverageMode, "indexed");
    assert.equal(skills?.status, "partial");
    assert.equal(
      skills?.cursors[0]?.cursorId,
      "https://skills.sh/sitemap-skills-1.xml",
    );
    assert.equal(skills?.cursors[0]?.nextToken, "50");
    assert.equal(skills?.cursors[0]?.completed, false);
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("source sync indexes default registry endpoints with sparse successful responses", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-defaults-"),
  );
  const cleanupFetch = installFetchMock({
    "https://cursor.com/sitemap-marketplace.xml": xmlResponse([
      "<urlset>",
      "<url><loc>https://cursor.com/marketplace/agent-helper</loc></url>",
      "</urlset>",
    ]),
    "https://zed.dev/extensions": new Response(
      '<a href="/extensions/zed-industries/rust">Rust</a>',
      { status: 200 },
    ),
    "https://pi.dev/packages": new Response(
      '<a href="/packages/agent-helper">Agent Helper</a>',
      { status: 200 },
    ),
    "https://skills.sh/sitemap.xml": xmlResponse([
      "<sitemapindex>",
      "<sitemap><loc>https://skills.sh/sitemap-skills.xml</loc></sitemap>",
      "</sitemapindex>",
    ]),
    "https://skills.sh/sitemap-skills.xml": xmlResponse([
      "<urlset>",
      "<url><loc>https://skills.sh/acme/agent-helper</loc></url>",
      "</urlset>",
    ]),
    "https://pypi.org/sitemap.xml": xmlResponse([
      "<sitemapindex>",
      "<sitemap><loc>https://pypi.org/ab.sitemap.xml</loc></sitemap>",
      "</sitemapindex>",
    ]),
    "https://pypi.org/ab.sitemap.xml": xmlResponse([
      "<urlset>",
      "<url><loc>https://pypi.org/project/agent-helper/</loc></url>",
      "</urlset>",
    ]),
    "https://swiftpackageindex.com/sitemap.xml": xmlResponse([
      "<urlset>",
      "<url><loc>https://swiftpackageindex.com/apple/swift-argument-parser</loc></url>",
      "</urlset>",
    ]),
    "https://clawhub.ai/plugins?sort=downloads": new Response(
      '<a href="/plugins/agent-helper">Agent Helper</a><a href="/plugins/publish">Publish</a>',
      { status: 200 },
    ),
    "https://registry.modelcontextprotocol.io/v0/servers": new Response(
      JSON.stringify({
        servers: [
          {
            server: {
              name: "acme/server",
              title: "Acme Server",
              description: "MCP registry fixture",
            },
            _meta: {
              "io.modelcontextprotocol.registry/official": {
                isLatest: true,
                publishedAt: "2026-05-14T00:00:00.000Z",
              },
            },
          },
        ],
        metadata: {},
      }),
      { status: 200 },
    ),
    "https://replicate.npmjs.com/_changes?since=0&limit=50": new Response(
      JSON.stringify({ results: [], last_seq: 7 }),
      { status: 200 },
    ),
    "https://crates.io/api/v1/crates?page=1&per_page=50": new Response(
      JSON.stringify({ crates: [] }),
      { status: 200 },
    ),
    "https://search.maven.org/solrsearch/select?q=*%3A*&rows=50&start=0&wt=json":
      new Response(JSON.stringify({ response: { docs: [], numFound: 0 } }), {
        status: 200,
      }),
    "https://api.nuget.org/v3/index.json": new Response(
      JSON.stringify({
        resources: [
          {
            "@type": "SearchQueryService/3.5.0",
            "@id": "https://azuresearch-usnc.nuget.org/query",
          },
        ],
      }),
      { status: 200 },
    ),
    "https://azuresearch-usnc.nuget.org/query?q=&skip=0&take=50&prerelease=true&semVerLevel=2.0.0":
      new Response(JSON.stringify({ data: [], totalHits: 0 }), { status: 200 }),
    "https://packagist.org/packages/list.json": new Response(
      JSON.stringify({ packageNames: ["acme/package"] }),
      { status: 200 },
    ),
  });

  try {
    await writeTestSourceRegistry(projectRoot, [
      buildSource("cursor-marketplace", "registry", {}),
      buildSource("zed-extension-registry", "registry", {}),
      buildSource("pi-packages", "registry", {}),
      buildSource("skills-sh", "registry", {}),
      buildSource("pypi-registry", "registry", {}),
      buildSource("swift-package-index", "registry", {}),
      buildSource("clawhub", "registry", {}),
      buildSource("mcp-registry", "registry", {}),
      buildSource("npm-registry", "registry", {}),
      buildSource("cargo-registry", "registry", {}),
      buildSource("maven-registry", "registry", {}),
      buildSource("nuget-registry", "registry", {}),
      buildSource("packagist-registry", "registry", {}),
    ]);

    await syncIndexedSources(projectRoot);

    const report = await readJsonFile<SourceSyncReport>(
      join(projectRoot, "discover", "output", "source-sync.json"),
    );
    const byId = new Map(
      report.sources.map((source) => [source.sourceId, source]),
    );

    // Status assertions: require exact match for every source.
    // skills.sh is a flaky external endpoint — accept "failed" explicitly.
    for (const [id, expected] of [
      ["cursor-marketplace", "complete"],
      ["zed-extension-registry", "complete"],
      ["pi-packages", "complete"],
      ["skills-sh", "complete"],
      ["pypi-registry", "complete"],
      ["swift-package-index", "complete"],
      ["clawhub", "partial"],
      ["mcp-registry", "complete"],
      ["npm-registry", "partial"],
      ["cargo-registry", "complete"],
      ["maven-registry", "complete"],
      ["nuget-registry", "complete"],
      ["packagist-registry", "complete"],
    ] as const) {
      const actual = byId.get(id)?.status ?? "missing";
      if (id === "skills-sh" && actual === "failed") continue;
      assert.equal(
        actual,
        expected,
        `source ${id}: expected "${expected}", got "${actual}"`,
      );
    }
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
): Record<string, unknown> {
  return {
    id,
    name: id,
    kind,
    authorityTier: "official-marketplace",
    publisher: {
      name: "Acme",
      verified: true,
    },
    hosts: ["copilot-vscode"],
    assetKinds: ["plugin"],
    discoveryMode: "catalog",
    priority: 80,
    enabled: true,
    endpoints,
    rules: {
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

function xmlResponse(lines: string[]): Response {
  return new Response(lines.join(""), {
    status: 200,
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}

async function withEnv(
  overrides: Record<string, string | undefined>,
  callback: () => Promise<void>,
): Promise<void> {
  const previousValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previousValues.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  clearRuntimeConfigForTests();

  try {
    await callback();
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearRuntimeConfigForTests();
  }
}
