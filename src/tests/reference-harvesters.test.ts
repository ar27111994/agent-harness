import assert from "node:assert/strict";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { harvestReferenceItems } from "../domains/discovery/reference-harvesters.js";
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
