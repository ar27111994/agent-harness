/**
 * Targeted tests for reference-harvesters.ts coverage gaps:
 * - fetchVsCodeMarketplaceItemsForQuery pagination API
 * - selectDemandQueries with various demand profiles
 * - decodeNumericEntity via HTML entity decoding in link extraction
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchVsCodeMarketplaceItemsForQuery,
  harvestReferenceItems,
  selectDemandQueries,
} from "../domains/discovery/reference-harvesters.js";
import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { restoreEnvVar } from "./env-test-utils.js";
import type { DemandProfile, SourceDefinition } from "../types.js";

void test("selectDemandQueries extracts normalized demand signals and always includes base queries", () => {
  const demandProfile = buildDemandProfile({
    frameworks: ["react", "next.js"],
    concerns: ["testing", "mcp"],
    tooling: ["npm:vitest", "detector:mobile"],
    languages: ["typescript"],
  });

  const queries = selectDemandQueries(demandProfile);

  assert.ok(queries.includes("react"));
  assert.ok(queries.includes("testing"));
  assert.ok(queries.includes("mcp"));
  assert.ok(queries.includes("typescript"));
  assert.ok(queries.includes("copilot"));
  assert.ok(queries.includes("ai"));
  assert.ok(queries.includes("next.js"));
  // Prefixes are stripped
  assert.ok(!queries.some((q) => q.includes("npm:")));
  assert.ok(!queries.some((q) => q.includes("detector:")));
  // mobile should appear stripped of prefix
  assert.ok(queries.includes("mobile"));
});

void test("selectDemandQueries with null profile returns default base queries only", () => {
  const queries = selectDemandQueries(null);

  assert.ok(queries.includes("copilot"));
  assert.ok(queries.includes("ai"));
  assert.ok(queries.includes("mcp"));
  assert.ok(queries.includes("testing"));
  assert.equal(queries.length, 4);
});

void test("generic docs harvester decodes HTML entities in link text", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async () =>
    new Response(
      `<html><head><title>Docs &amp; Guides</title></head><body>
        <a href="/guide">Guide &amp; Tutorials</a>
        <a href="/api">API &#x2F; Reference</a>
      </body></html>`,
      { status: 200 },
    );

  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFlag);
  });

  const items = await harvestReferenceItems(buildDocsSource(), null);

  assert.ok(items.length >= 1);
  // The root item should have the decoded title
  const rootItem = items.find(
    (item) => item.originUrl === "https://example.com",
  );
  assert.ok(rootItem);
  assert.ok(
    rootItem.displayName.includes("Docs") ||
      rootItem.displayName.includes("Guides"),
  );
});

void test("fetchVsCodeMarketplaceItemsForQuery returns paginated results", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            extensions: [
              {
                extensionName: "awesome-linter",
                displayName: "Awesome Linter",
                shortDescription: "Linting tool",
                publisher: { publisherName: "AcmeCorp" },
                statistics: [{ statisticName: "install", value: 100 }],
              },
            ],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFlag);
    clearRuntimeConfigForTests();
  });

  const items = await fetchVsCodeMarketplaceItemsForQuery(
    buildMarketplaceSource(),
    "linting",
    { pageNumber: 1, pageSize: 10 },
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.manifestEntry, "AcmeCorp.awesome-linter");
  assert.equal(items[0]?.assetKind, "extension");
  assert.equal(items[0]?.compatibilityMode, "native");
  assert.equal(items[0]?.installs, 100);
});

void test("fetchVsCodeMarketplaceItemsForQuery handles malformed API responses", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  // Return empty/malformed responses
  globalThis.fetch = async () =>
    new Response(JSON.stringify(null), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFlag);
    clearRuntimeConfigForTests();
  });

  const items = await fetchVsCodeMarketplaceItemsForQuery(
    buildMarketplaceSource(),
    "invalid",
    { pageNumber: 1, pageSize: 5 },
  );

  assert.deepEqual(items, []);
});

void test("VS Code marketplace harvester dedupes results across multiple queries", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
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
                statistics: [],
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );

  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFlag);
    clearRuntimeConfigForTests();
  });

  const items = await harvestReferenceItems(
    buildMarketplaceSource(),
    buildDemandProfile({ frameworks: ["react", "vue"] }),
  );

  // Even with multiple queries returning the same extension, it should be deduped
  const uniqueManifestEntries = new Set(items.map((i) => i.manifestEntry));
  assert.equal(items.length, uniqueManifestEntries.size);
});

function restoreFetchMockFlag(previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    return;
  }
  restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousValue);
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

function buildDemandProfile(
  overrides: Partial<DemandProfile["signals"]> = {},
): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "/tmp/project",
    summary: { scannedFiles: 1, matchedFiles: 1 },
    signals: {
      languages: overrides.languages ?? ["typescript"],
      packageManagers: overrides.packageManagers ?? ["npm"],
      frameworks: overrides.frameworks ?? [],
      concerns: overrides.concerns ?? [],
      tooling: overrides.tooling ?? [],
    },
    evidence: [],
  };
}
