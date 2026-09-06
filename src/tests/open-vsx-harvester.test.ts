import { setHttpTestFetchMocks } from "./env-test-utils.js";
import assert from "node:assert/strict";
import test from "node:test";

import {
  harvestOpenVsxExtensions,
  openVsxHarvesterInternals,
} from "../domains/discovery/open-vsx-harvester.js";
import { buildReferenceSourceCatalogEntry } from "../domains/discovery/reference-source-harvester.js";
import type {
  DemandProfile,
  SelectionRegistry,
  SourceDefinition,
} from "../types.js";

const DEFAULT_SEARCH_ENDPOINT = "https://open-vsx.org/api/-/search";

void test("Open VSX endpoint resolution keeps requests on the trusted registry", () => {
  const { resolveOpenVsxEndpoint } = openVsxHarvesterInternals;

  assert.equal(resolveOpenVsxEndpoint(source({})), DEFAULT_SEARCH_ENDPOINT);
  assert.equal(
    resolveOpenVsxEndpoint(
      source({
        apiUrl: "https://open-vsx.org/api/primary",
        searchUrl: "https://open-vsx.org/api/secondary",
        repo: "https://open-vsx.org/api/tertiary",
      }),
    ),
    "https://open-vsx.org/api/primary",
  );
  assert.equal(
    resolveOpenVsxEndpoint(
      source({
        searchUrl: "https://open-vsx.org/api/search",
        repo: "https://open-vsx.org/api/repo",
      }),
    ),
    "https://open-vsx.org/api/search",
  );
  assert.equal(
    resolveOpenVsxEndpoint(source({ repo: DEFAULT_SEARCH_ENDPOINT })),
    DEFAULT_SEARCH_ENDPOINT,
  );
  assert.equal(
    resolveOpenVsxEndpoint(
      source({ repo: "https://evil.example/api/-/search" }),
    ),
    DEFAULT_SEARCH_ENDPOINT,
  );
  assert.equal(
    resolveOpenVsxEndpoint(source({ repo: "not a valid URL" })),
    DEFAULT_SEARCH_ENDPOINT,
  );
});

void test("Open VSX demand queries are bounded to useful trimmed signals", () => {
  const { buildOpenVsxQuery } = openVsxHarvesterInternals;

  assert.equal(buildOpenVsxQuery(null), "ai agent coding");
  assert.equal(buildOpenVsxQuery(demandProfile()), "ai agent coding");
  assert.equal(
    buildOpenVsxQuery(
      demandProfile({
        languages: [" TypeScript ", " ", "ignored-language"],
        frameworks: [" React ", "Next.js", "ignored-framework"],
        concerns: [" Testing ", "Security", "ignored-concern"],
        tooling: [" pnpm ", "Vitest", "ignored-tool"],
      }),
    ),
    "TypeScript React Next.js Testing Security pnpm Vitest",
  );
});

void test("Open VSX payload parsing accepts known collection keys and rejects malformed entries", () => {
  const { isRecord, readExtensionRecords } = openVsxHarvesterInternals;

  assert.equal(isRecord({ ok: true }), true);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord("record"), false);

  assert.deepEqual(readExtensionRecords(null), []);
  assert.deepEqual(readExtensionRecords({}), []);
  assert.deepEqual(
    readExtensionRecords({
      extensions: [{ name: "one" }, null, [], "invalid"],
    }),
    [{ name: "one" }],
  );
  assert.deepEqual(readExtensionRecords({ results: [{ name: "two" }] }), [
    { name: "two" },
  ]);
  assert.deepEqual(
    readExtensionRecords({ extensions: { items: [{ name: "nested" }] } }),
    [{ name: "nested" }],
  );
  assert.deepEqual(readExtensionRecords({ items: [{ name: "three" }] }), [
    { name: "three" },
  ]);
});

void test("Open VSX scalar helpers normalize registry metadata", () => {
  const {
    readFiniteNumber,
    readPublisherVerification,
    readString,
    tokenize,
    uniqueStrings,
  } = openVsxHarvesterInternals;

  assert.equal(readString("  useful  "), "useful");
  assert.equal(readString("   "), undefined);
  assert.equal(readString(42), undefined);

  assert.equal(readFiniteNumber(123), 123);
  assert.equal(readFiniteNumber(Number.POSITIVE_INFINITY), undefined);
  assert.equal(readFiniteNumber("123"), undefined);

  assert.deepEqual(tokenize("A x TS--Testing 123"), ["ts", "testing", "123"]);
  assert.deepEqual(uniqueStrings(["open-vsx", "extension", "extension"]), [
    "open-vsx",
    "extension",
  ]);
  assert.equal(
    readPublisherVerification({ publisher: { verified: true } }),
    true,
  );
  assert.equal(readPublisherVerification({}), false);
});

void test("Open VSX harvest handles rich, fallback, bounded, and failed responses", async (t) => {
  const originalFetch = globalThis.fetch;
  const previousMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  setHttpTestFetchMocks(true);

  const requestedUrls: string[] = [];
  const responses = [
    new Response(
      JSON.stringify({
        extensions: [
          {
            namespace: { name: "acme", verified: false },
            name: "useful-extension",
            displayName: "Useful Extension",
            description: "TypeScript extension helper",
            version: "2.1.0",
            downloadCount: 123,
            timestamp: "2026-08-18T00:00:00.000Z",
            namespaceVerified: false,
          },
          {
            namespace: "acme space",
            name: "tool/name",
            displayName: "   ",
            downloadCount: "not-a-number",
          },
          { name: "missing-namespace" },
          { namespace: "acme" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
    new Response(
      JSON.stringify({
        extensions: Array.from({ length: 30 }, (_, index) => ({
          namespace: "bounded",
          name: `extension-${index}`,
        })),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
    new Response("registry unavailable", { status: 503 }),
    new Response(JSON.stringify({ extensions: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ];

  globalThis.fetch = async (input) => {
    requestedUrls.push(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    const response = responses.shift();
    assert.ok(response, "unexpected Open VSX fetch");
    return response;
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (previousMockFlag === undefined) {
      setHttpTestFetchMocks(false);
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousMockFlag;
      setHttpTestFetchMocks(previousMockFlag === "1");
    }
  });

  const richResults = await harvestOpenVsxExtensions(source(), null);
  assert.equal(richResults.length, 2);

  const rich = richResults[0];
  assert.ok(rich);
  assert.equal(rich.displayName, "Useful Extension");
  assert.equal(rich.manifestEntry, "acme.useful-extension");
  assert.equal(rich.publisherName, "acme");
  assert.equal(rich.publisherVerified, false);
  assert.equal(rich.installs, 123);
  assert.equal(Reflect.get(rich, "version"), "2.1.0");
  assert.equal(rich.lastUpdated, "2026-08-18T00:00:00.000Z");
  assert.equal(
    rich.capabilities.filter((capability) => capability === "extension").length,
    1,
  );

  const fallback = richResults[1];
  assert.ok(fallback);
  assert.equal(fallback.displayName, "acme space.tool/name");
  assert.equal(fallback.summary, "");
  assert.equal(fallback.installs, 0);
  assert.equal(fallback.lastUpdated, undefined);
  assert.equal("version" in fallback, false);
  assert.equal(
    fallback.originUrl,
    "https://open-vsx.org/extension/acme%20space/tool%2Fname",
  );

  const boundedResults = await harvestOpenVsxExtensions(
    source(),
    demandProfile({ languages: ["TypeScript"] }),
  );
  assert.equal(boundedResults.length, 25);

  const failedResults = await harvestOpenVsxExtensions(source(), null);
  assert.deepEqual(failedResults, []);

  const untrustedResults = await harvestOpenVsxExtensions(
    source({ repo: "https://evil.example/api/-/search" }),
    null,
  );
  assert.deepEqual(untrustedResults, []);

  assert.equal(requestedUrls.length, 4);
  assert.match(
    requestedUrls[0] ?? "",
    /^https:\/\/open-vsx\.org\/api\/-\/search\?/u,
  );
  assert.match(requestedUrls[0] ?? "", /query=ai\+agent\+coding/u);
  assert.match(requestedUrls[0] ?? "", /size=25/u);
  assert.match(requestedUrls[0] ?? "", /offset=0/u);
  assert.match(requestedUrls[1] ?? "", /query=TypeScript/u);
  assert.match(
    requestedUrls[3] ?? "",
    /^https:\/\/open-vsx\.org\/api\/-\/search\?/u,
  );
});

void test("Open VSX item verification does not inherit source publisher trust", () => {
  const entry = buildReferenceSourceCatalogEntry(
    source(),
    null,
    buildSelectionRegistry(),
    {
      harvestedItem: {
        displayName: "Unverified Extension",
        originUrl: "https://open-vsx.org/extension/unverified/example",
        summary: "",
        capabilities: ["extension"],
        assetKind: "extension",
        compatibilityMode: "native",
        installMethod: "open-vsx-registry",
        publisherName: "unverified",
        publisherVerified: false,
      },
    },
  );

  assert.equal(entry.source.publisher, "unverified");
  assert.equal(entry.source.publisherVerified, false);
  assert.equal(entry.trust.signals.includes("publisher-verified"), false);
});

void test("Open VSX harvest ignores invalid JSON responses", async (t) => {
  const originalFetch = globalThis.fetch;
  const previousMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  setHttpTestFetchMocks(true);
  globalThis.fetch = async () => new Response("{", { status: 200 });
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (previousMockFlag === undefined) {
      setHttpTestFetchMocks(false);
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousMockFlag;
      setHttpTestFetchMocks(previousMockFlag === "1");
    }
  });

  assert.deepEqual(await harvestOpenVsxExtensions(source(), null), []);
});

function demandProfile(
  signals: Partial<DemandProfile["signals"]> = {},
): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-20T00:00:00.000Z",
    scanRoot: ".",
    summary: { scannedFiles: 0, matchedFiles: 0 },
    signals: {
      languages: [],
      packageManagers: [],
      frameworks: [],
      concerns: [],
      tooling: [],
      ...signals,
    },
    evidence: [],
  };
}

function source(
  endpoints: Record<string, string> = { repo: DEFAULT_SEARCH_ENDPOINT },
): SourceDefinition {
  return {
    id: "open-vsx-registry",
    name: "Open VSX Registry",
    kind: "registry",
    authorityTier: "official-compatible",
    publisher: {
      name: "Eclipse Foundation",
      verified: true,
      owner: "eclipse",
    },
    hosts: ["copilot-vscode", "cursor"],
    assetKinds: ["extension"],
    discoveryMode: "catalog",
    priority: 90,
    enabled: true,
    endpoints,
    rules: {
      officialPreferred: true,
      allowMirror: false,
      allowInstall: false,
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
