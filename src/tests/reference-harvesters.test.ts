import assert from "node:assert/strict";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import {
  fetchVsCodeMarketplaceItemsForQuery,
  harvestReferenceItems,
} from "../domains/discovery/reference-harvesters.js";
import type { DemandProfile, SourceDefinition } from "../types.js";

void test("generic docs harvester extracts same-origin reference links", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  globalThis.fetch = async () =>
    new Response(
      `<html><head><title>Docs Home</title></head><body>
        <a href="/guide">Guide</a>
        <a href="https://external.invalid/ignore">External</a>
      </body></html>`,
      { status: 200 },
    );
  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  const items = await harvestReferenceItems(buildDocsSource(), null);

  assert.equal(items.length, 2);
  assert.equal(items[0]?.assetKind, "reference-pack");
  assert.ok(
    items.some((item) => item.originUrl === "https://example.com/guide"),
  );
  assert.ok(
    items.every(
      (item) => new URL(item.originUrl).origin === "https://example.com",
    ),
  );
});

void test("generic extension registry items stay reference-only", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  globalThis.fetch = async () =>
    new Response("# Extension Gallery\n\nReview extension metadata.\n", {
      status: 200,
    });
  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  const items = await harvestReferenceItems(
    buildExtensionRegistrySource(),
    null,
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.assetKind, "reference-pack");
  assert.equal(items[0]?.installMethod, "registry-summary");
});

void test("generic docs harvester respects configured reference caps", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const previousMaxItems =
    process.env.AGENT_HARNESS_GENERIC_REFERENCE_MAX_ITEMS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  process.env.AGENT_HARNESS_GENERIC_REFERENCE_MAX_ITEMS = "2";
  clearRuntimeConfigForTests();
  globalThis.fetch = async () =>
    new Response(
      `<html><head><title>Docs Home</title></head><body>
        <a href="/guide">Guide</a>
        <a href="/api">API</a>
        <a href="/faq">FAQ</a>
      </body></html>`,
      { status: 200 },
    );
  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
    if (previousMaxItems === undefined) {
      delete process.env.AGENT_HARNESS_GENERIC_REFERENCE_MAX_ITEMS;
    } else {
      process.env.AGENT_HARNESS_GENERIC_REFERENCE_MAX_ITEMS = previousMaxItems;
    }
    clearRuntimeConfigForTests();
  });

  const items = await harvestReferenceItems(buildDocsSource(), null);

  assert.equal(items.length, 2);
  assert.equal(items[0]?.originUrl, "https://example.com");
  assert.equal(items[1]?.originUrl, "https://example.com/guide");
});

void test("VS Code marketplace harvester produces native extension assets", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  let observedMethod: string | undefined;
  const observedBodies: string[] = [];
  globalThis.fetch = async (_url, init) => {
    observedMethod = init?.method;
    observedBodies.push(String(init?.body ?? ""));
    return new Response(
      JSON.stringify({
        results: [
          {
            extensions: [
              {
                extensionName: "copilot",
                displayName: "GitHub Copilot",
                shortDescription: "AI pair programmer",
                publisher: { publisherName: "GitHub" },
                statistics: [{ statisticName: "install", value: 42 }],
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  const items = await harvestReferenceItems(
    buildMarketplaceSource(),
    buildDemandProfile(),
  );

  assert.equal(observedMethod, "POST");
  assert.ok(observedBodies.some((body) => /mcp/u.test(body)));
  assert.equal(items[0]?.assetKind, "extension");
  assert.equal(items[0]?.compatibilityMode, "native");
  assert.equal(items[0]?.installMethod, "vscode-extension");
  assert.equal(items[0]?.manifestEntry, "GitHub.copilot");
});

void test("generic docs harvester handles invalid origins markdown links and failed fetches", async (context) => {
  assert.deepEqual(
    await harvestReferenceItems(
      { ...buildDocsSource(), endpoints: { docsUrl: "not-a-url" } },
      null,
    ),
    [],
  );

  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  const responses = [
    new Response("missing", { status: 404 }),
    new Response(
      [
        "# SDK &amp; Reference",
        "",
        "See [Guide &amp; API](/guide#install) and [External](https://external.invalid/nope).",
        "Repeat [Guide &amp; API](/guide#other).",
        "Numeric &#65; and hex &#x42; entities.",
      ].join("\n"),
      { status: 200 },
    ),
  ];
  globalThis.fetch = async () =>
    responses.shift() ?? new Response("", { status: 500 });
  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  assert.deepEqual(await harvestReferenceItems(buildDocsSource(), null), []);

  const items = await harvestReferenceItems(buildDocsSource(), null);

  assert.equal(items.length, 2);
  assert.equal(items[0]?.displayName, "SDK &amp; Reference");
  assert.match(items[0]?.summary ?? "", /Numeric A and hex B/u);
  assert.deepEqual(
    items.map((item) => item.originUrl),
    ["https://example.com", "https://example.com/guide"],
  );
});

void test("VS Code marketplace normalization skips malformed entries and uses safe fallbacks", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  const responses = [
    new Response(JSON.stringify({ results: "not-an-array" }), { status: 200 }),
    new Response(
      JSON.stringify({
        results: [
          { ignored: true },
          { results: "not-an-array" },
          {
            extensions: [
              null,
              { extensionName: "no-publisher", publisher: "acme" },
              { publisher: { publisherName: "missing-name" } },
              {
                extensionName: "agent-helper",
                publisher: { displayName: "Acme Tools" },
                url: "https://external.invalid/items/agent-helper",
                statistics: [
                  "bad",
                  { statisticName: "install", value: "many" },
                ],
              },
              {
                extensionName: "plain-helper",
                publisher: { publisherName: "Acme" },
              },
            ],
          },
        ],
      }),
      { status: 200 },
    ),
  ];
  globalThis.fetch = async () =>
    responses.shift() ??
    new Response(JSON.stringify({ results: [] }), { status: 200 });
  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  assert.deepEqual(
    await fetchVsCodeMarketplaceItemsForQuery(
      buildMarketplaceSource(),
      "agent",
      {
        pageNumber: 1,
        pageSize: 10,
      },
    ),
    [],
  );

  const items = await fetchVsCodeMarketplaceItemsForQuery(
    buildMarketplaceSource(),
    "agent",
    { pageNumber: 1, pageSize: 10 },
  );

  assert.equal(items.length, 2);
  assert.equal(items[0]?.displayName, "Acme Tools.agent-helper");
  assert.equal(items[0]?.summary, "Acme Tools.agent-helper");
  assert.equal(
    items[0]?.originUrl,
    "https://marketplace.visualstudio.com/items?itemName=Acme%20Tools.agent-helper",
  );
  assert.equal(items[0]?.installs, undefined);
});

void test("generic docs harvester falls back to source names and ignores malformed links", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  globalThis.fetch = async () =>
    new Response(
      [
        "Plain reference content without a heading.",
        '<a href="http://%">Broken</a>',
        '<a href="/valid">Valid Link</a>',
        "[   ](/blank-text)",
      ].join("\n"),
      { status: 200 },
    );
  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  const items = await harvestReferenceItems(buildDocsSource(), null);

  assert.equal(items[0]?.displayName, "Example Docs");
  assert.deepEqual(
    items.map((item) => item.originUrl),
    ["https://example.com", "https://example.com/valid"],
  );
});

void test("generic docs harvester resolves fallback origins and preserves invalid entities", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  const infiniteEntity = `&#${"9".repeat(400)};`;
  const responses = [
    new Response(
      `<title>Base Docs</title><p>${infiniteEntity} &#99999999; &unknown;</p>`,
      {
        status: 200,
      },
    ),
    new Response("# Repo Docs\n\nSee [Guide](/guide).", { status: 200 }),
  ];
  globalThis.fetch = async () =>
    responses.shift() ?? new Response("unexpected", { status: 500 });
  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  const baseItems = await harvestReferenceItems(
    {
      ...buildDocsSource(),
      endpoints: { baseUrl: "https://example.com/base" },
    },
    null,
  );
  const repoItems = await harvestReferenceItems(
    { ...buildDocsSource(), endpoints: { repo: "https://example.com/repo" } },
    null,
  );
  const invalidIdItems = await harvestReferenceItems(
    { ...buildDocsSource(), endpoints: {}, id: "not-a-url" },
    null,
  );

  assert.equal(baseItems[0]?.displayName, "Base Docs");
  assert.match(baseItems[0]?.summary ?? "", /&#99999999; &unknown;/u);
  assert.equal(
    repoItems.find((item) => item.originUrl === "https://example.com/repo")
      ?.displayName,
    "Repo Docs",
  );
  assert.deepEqual(
    new Set(repoItems.map((item) => item.originUrl)),
    new Set(["https://example.com/repo", "https://example.com/guide"]),
  );
  assert.deepEqual(invalidIdItems, []);
});

void test("VS Code marketplace harvester uses default queries and rejects invalid API origins", async (context) => {
  const invalidSource = {
    ...buildMarketplaceSource(),
    endpoints: { marketplaceApi: "not-a-url" },
  };
  assert.deepEqual(await harvestReferenceItems(invalidSource, null), []);
  assert.deepEqual(
    await fetchVsCodeMarketplaceItemsForQuery(invalidSource, "copilot", {
      pageNumber: 1,
      pageSize: 10,
    }),
    [],
  );

  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  const observedQueries: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      filters?: Array<{
        criteria?: Array<{ filterType?: number; value?: string }>;
      }>;
    };
    const query = body.filters?.[0]?.criteria?.find(
      (criterion) => criterion.filterType === 10,
    )?.value;
    if (query) {
      observedQueries.push(query);
    }
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  assert.deepEqual(
    await harvestReferenceItems(
      {
        ...buildMarketplaceSource(),
        endpoints: { baseUrl: "https://marketplace.visualstudio.com" },
      },
      null,
    ),
    [],
  );
  assert.deepEqual(
    await fetchVsCodeMarketplaceItemsForQuery(
      {
        ...buildMarketplaceSource(),
        endpoints: { baseUrl: "https://marketplace.visualstudio.com" },
      },
      "copilot",
      { pageNumber: 1, pageSize: 10 },
    ),
    [],
  );
  assert.deepEqual([...observedQueries].sort(), [
    "ai",
    "copilot",
    "copilot",
    "mcp",
    "testing",
  ]);
});

void test("VS Code marketplace normalization keeps allowed item URLs and finite install stats", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            extensions: [
              {
                extensionName: "copilot",
                displayName: "GitHub Copilot",
                shortDescription: "AI pair programmer",
                publisher: { publisherName: "GitHub" },
                url: "https://marketplace.visualstudio.com/items?itemName=GitHub.copilot",
                statistics: [
                  { statisticName: "rating", value: 4.8 },
                  { statisticName: "install", value: 1234 },
                ],
                lastUpdated: "2026-05-14T00:00:00.000Z",
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );
  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  const items = await fetchVsCodeMarketplaceItemsForQuery(
    buildMarketplaceSource(),
    "copilot",
    { pageNumber: 2, pageSize: 5 },
  );

  assert.equal(
    items[0]?.originUrl,
    "https://marketplace.visualstudio.com/items?itemName=GitHub.copilot",
  );
  assert.equal(items[0]?.installs, 1234);
  assert.equal(items[0]?.lastUpdated, "2026-05-14T00:00:00.000Z");
  assert.ok(items[0]?.capabilities.includes("pair"));
});

function restoreFetchMockFlag(previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    return;
  }

  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousValue;
}

function buildDocsSource(): SourceDefinition {
  return {
    id: "docs-example",
    name: "Example Docs",
    kind: "docs",
    authorityTier: "official-first-party",
    hosts: ["copilot-vscode"],
    assetKinds: ["reference-pack"],
    discoveryMode: "catalog",
    priority: 100,
    enabled: true,
    endpoints: { docsUrl: "https://example.com" },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: false,
    },
  };
}

function buildExtensionRegistrySource(): SourceDefinition {
  return {
    id: "zed-extension-registry",
    name: "Zed Extension Gallery",
    kind: "registry",
    authorityTier: "official-marketplace",
    hosts: ["zed"],
    assetKinds: ["extension", "reference-pack"],
    discoveryMode: "catalog",
    priority: 90,
    enabled: true,
    endpoints: { baseUrl: "https://example.com/extensions" },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: false,
    },
  };
}

function buildMarketplaceSource(): SourceDefinition {
  return {
    id: "vscode-marketplace",
    name: "VS Code Marketplace",
    kind: "marketplace",
    authorityTier: "official-marketplace",
    hosts: ["copilot-vscode"],
    assetKinds: ["extension"],
    discoveryMode: "catalog",
    priority: 95,
    enabled: true,
    endpoints: {
      baseUrl: "https://marketplace.visualstudio.com",
      marketplaceApi:
        "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery",
    },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  };
}

function buildDemandProfile(): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "/tmp/project",
    summary: {
      scannedFiles: 1,
      matchedFiles: 1,
    },
    signals: {
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: [],
      concerns: ["mcp"],
      tooling: [],
    },
    evidence: [],
  };
}
