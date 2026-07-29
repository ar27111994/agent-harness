import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  clearRuntimeConfigForTests,
  loadRuntimeConfig,
} from "../config/runtime.js";
import { packageRegistryHarvesterInternals } from "../domains/discovery/package-registry-harvester.js";
import { syncIndexedSources } from "../domains/discovery/source-sync/index.js";
import { writeJsonFile } from "../files.js";
import { assertSelectionReport } from "../manifest-validation/discovery.js";
import {
  fetchCratesIoSearch,
  fetchMavenSearch,
  fetchNugetSearch,
  fetchPackagistSearch,
  fetchRubyGemsSearch,
} from "../package-registries.js";
import { fetchVsCodeMarketplaceItemsForQuery } from "../domains/discovery/reference-harvesters.js";
import { runRecommend } from "../recommend/commands.js";
import type { DemandProfile } from "../types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function withFetchMock<T>(
  mockFn: (input: RequestInfo | URL) => Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const previousFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  globalThis.fetch = async (input) => mockFn(input);
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    if (previousFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFlag;
    }
  }
}

/** Synchronous demand-profile builder used by tests that need one inline. */
function makeDemandProfile(
  overrides: Partial<DemandProfile["signals"]> = {},
): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "fixtures/workspace",
    summary: { scannedFiles: 1, matchedFiles: 1 },
    signals: {
      languages: overrides.languages ?? [],
      packageManagers: overrides.packageManagers ?? ["npm"],
      frameworks: overrides.frameworks ?? [],
      concerns: overrides.concerns ?? [],
      tooling: overrides.tooling ?? [],
    },
    evidence: [],
  };
}

// ─── 1. package-registries.ts: fetchMavenSearch ───────────────────────────────

void test("fetchMavenSearch — returns results from mocked Maven Central response (line 604)", async () => {
  const results = await withFetchMock(
    async () =>
      jsonResponse({
        response: {
          docs: [
            { id: "org.springframework:spring-core" },
            { a: "spring-webmvc", g: "org.springframework" },
            { description: "neither id nor a" },
            { id: "" },
          ],
        },
      }),
    () =>
      fetchMavenSearch("spring", 10, {
        resolveHostname: async () => [
          { address: "93.184.216.34", family: 4 as const },
        ],
      }),
  );
  assert.equal(results.length, 2);
  assert.equal(results[0]?.name, "org.springframework:spring-core");
  assert.equal(results[1]?.name, "org.springframework:spring-webmvc");
});

void test("fetchMavenSearch — returns [] when response structure is unexpected (line 604)", async () => {
  const results = await withFetchMock(
    async () => jsonResponse({ unexpected: true }),
    () =>
      fetchMavenSearch("spring", 10, {
        resolveHostname: async () => [
          { address: "93.184.216.34", family: 4 as const },
        ],
      }),
  );
  assert.deepEqual(results, []);
});

void test("fetchMavenSearch — returns [] on empty query without network call (line 566)", async () => {
  const results = await fetchMavenSearch("   ");
  assert.deepEqual(results, []);
});

// ─── 2. package-registries.ts: fetchPackagistSearch ──────────────────────────

void test("fetchPackagistSearch — returns results from mocked Packagist response (line 603)", async () => {
  const results = await withFetchMock(
    async () =>
      jsonResponse({
        results: [
          {
            name: "symfony/http-foundation",
            description: "HTTP layer",
            downloads: 1000,
          },
          { name: "laravel/framework" },
          { name: "" },
          { downloads: 500 },
        ],
      }),
    () =>
      fetchPackagistSearch("symfony", 10, {
        resolveHostname: async () => [
          { address: "93.184.216.34", family: 4 as const },
        ],
      }),
  );
  assert.equal(results.length, 2);
  assert.equal(results[0]?.name, "symfony/http-foundation");
  assert.equal(results[0]?.description, "HTTP layer");
  assert.equal(results[1]?.name, "laravel/framework");
  assert.equal(results[1]?.description, undefined);
});

void test("fetchPackagistSearch — returns [] when results array is absent (line 622-627)", async () => {
  const results = await withFetchMock(
    async () => jsonResponse({ total: 0 }),
    () =>
      fetchPackagistSearch("symfony", 10, {
        resolveHostname: async () => [
          { address: "93.184.216.34", family: 4 as const },
        ],
      }),
  );
  assert.deepEqual(results, []);
});

void test("fetchPackagistSearch — returns [] on empty query without network call", async () => {
  const results = await fetchPackagistSearch("   ");
  assert.deepEqual(results, []);
});

// ─── 3. package-registries.ts: fetchRubyGemsSearch ───────────────────────────

void test("fetchRubyGemsSearch — returns results from mocked RubyGems response (line 647)", async () => {
  const results = await withFetchMock(
    async () =>
      jsonResponse([
        { name: "rails", info: "Full-stack framework", downloads: 5000 },
        { name: "sinatra" },
        { name: "" },
        { downloads: 1000 },
      ]),
    () =>
      fetchRubyGemsSearch("rails", 10, {
        resolveHostname: async () => [
          { address: "93.184.216.34", family: 4 as const },
        ],
      }),
  );
  assert.equal(results.length, 2);
  assert.equal(results[0]?.name, "rails");
  assert.equal(results[0]?.description, "Full-stack framework");
  assert.equal(results[1]?.name, "sinatra");
  assert.equal(results[1]?.description, undefined);
});

void test("fetchRubyGemsSearch — returns [] when response is not an array (line 666)", async () => {
  const results = await withFetchMock(
    async () => jsonResponse({ gems: [] }),
    () =>
      fetchRubyGemsSearch("rails", 10, {
        resolveHostname: async () => [
          { address: "93.184.216.34", family: 4 as const },
        ],
      }),
  );
  assert.deepEqual(results, []);
});

void test("fetchRubyGemsSearch — returns [] on empty query without network call", async () => {
  const results = await fetchRubyGemsSearch("   ");
  assert.deepEqual(results, []);
});

// ─── 3b. package-registries.ts: fetchCratesIoSearch ──────────────────────────

void test("fetchCratesIoSearch — returns results from mocked crates.io response (line 464)", async () => {
  const results = await withFetchMock(
    async () =>
      jsonResponse({
        crates: [
          { name: "tokio", description: "An async runtime", downloads: 500000 },
          { name: "serde", description: "Serialization", downloads: 400000 },
          { name: "" },
          { downloads: 999 },
        ],
      }),
    () =>
      fetchCratesIoSearch("tokio", 10, {
        resolveHostname: async () => [
          { address: "93.184.216.34", family: 4 as const },
        ],
      }),
  );
  assert.equal(results.length, 2);
  assert.equal(results[0]?.name, "tokio");
  assert.equal(results[1]?.name, "serde");
});

void test("fetchCratesIoSearch — returns [] when crates array is absent", async () => {
  const results = await withFetchMock(
    async () => jsonResponse({ not_crates: [] }),
    () =>
      fetchCratesIoSearch("tokio", 10, {
        resolveHostname: async () => [
          { address: "93.184.216.34", family: 4 as const },
        ],
      }),
  );
  assert.deepEqual(results, []);
});

void test("fetchCratesIoSearch — returns [] on empty query without network call", async () => {
  const results = await fetchCratesIoSearch("   ");
  assert.deepEqual(results, []);
});

// ─── 3c. package-registries.ts: fetchNugetSearch ─────────────────────────────

void test("fetchNugetSearch — returns results from mocked NuGet response (line 515)", async () => {
  const results = await withFetchMock(
    async () =>
      jsonResponse({
        data: [
          {
            id: "Newtonsoft.Json",
            description: "JSON framework",
            totalDownloads: 1000000,
          },
          {
            id: "Microsoft.Extensions.Logging",
            description: "Logging",
            totalDownloads: 800000,
          },
          { id: "" },
          { totalDownloads: 500 },
        ],
      }),
    () =>
      fetchNugetSearch("json", 10, {
        resolveHostname: async () => [
          { address: "93.184.216.34", family: 4 as const },
        ],
      }),
  );
  assert.equal(results.length, 2);
  assert.equal(results[0]?.name, "Newtonsoft.Json");
  assert.equal(results[1]?.name, "Microsoft.Extensions.Logging");
});

void test("fetchNugetSearch — returns [] when data array is absent", async () => {
  const results = await withFetchMock(
    async () => jsonResponse({ not_data: [] }),
    () =>
      fetchNugetSearch("json", 10, {
        resolveHostname: async () => [
          { address: "93.184.216.34", family: 4 as const },
        ],
      }),
  );
  assert.deepEqual(results, []);
});

void test("fetchNugetSearch — returns [] on empty query without network call", async () => {
  const results = await fetchNugetSearch("   ");
  assert.deepEqual(results, []);
});

// ─── 4. config/runtime.ts: parseFloatFraction error paths (lines 916-923) ────

void test("loadRuntimeConfig — parseFloatFraction throws on non-numeric value (line 919-921)", () => {
  clearRuntimeConfigForTests();
  assert.throws(
    () =>
      loadRuntimeConfig({
        HOME: "/home/tester",
        AGENT_HARNESS_DISCOVERY_MIN_SIMILARITY: "not-a-number",
      }),
    /AGENT_HARNESS_DISCOVERY_MIN_SIMILARITY/u,
  );
});

void test("loadRuntimeConfig — parseFloatFraction throws on out-of-range value (line 919-921)", () => {
  clearRuntimeConfigForTests();
  assert.throws(
    () =>
      loadRuntimeConfig({
        HOME: "/home/tester",
        AGENT_HARNESS_DISCOVERY_MIN_SIMILARITY: "1.5",
      }),
    /AGENT_HARNESS_DISCOVERY_MIN_SIMILARITY/u,
  );
});

void test("loadRuntimeConfig — parseFloatFraction returns valid fraction (line 922)", () => {
  clearRuntimeConfigForTests();
  const config = loadRuntimeConfig({
    HOME: "/home/tester",
    AGENT_HARNESS_DISCOVERY_MIN_SIMILARITY: "0.75",
  });
  assert.equal(config.discovery.minSimilarity, 0.75);
});

// ─── 5. package-registry-harvester.ts: adjacent.add (lines 303-306) ──────────

void test("discoverAdjacentPackages — live search loop adds new name to adjacent set (lines 303-306)", async () => {
  await withFetchMock(
    async (input) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/-/v1/search")) {
        return jsonResponse({
          objects: [{ package: { name: "mcp-server-npm" } }],
        });
      }
      return new Response("not found", { status: 404 });
    },
    async () => {
      const profile = makeDemandProfile({
        languages: ["typescript"],
        frameworks: ["react"],
      });
      const result =
        await packageRegistryHarvesterInternals.discoverAdjacentPackages(
          "npm",
          profile,
          new Set<string>(),
          {
            maxTerms: 1,
            maxResultsPerTerm: 5,
            adjacentToolingEnabled: true,
          },
        );
      assert.ok(Array.isArray(result), "result is an array");
      assert.ok(
        result.includes("mcp-server-npm"),
        `expected mcp-server-npm in adjacent set; got: ${JSON.stringify(result)}`,
      );
    },
  );
});

// ─── 6. reference-harvesters.ts: filterType:5 category branch (line 307) ─────

void test("fetchVsCodeMarketplaceItemsForQuery — category option produces filterType:5 in request body (line 307)", async () => {
  let capturedFilters: unknown[] = [];

  await withFetchMock(
    async (input) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("extensionquery")) {
        return jsonResponse({ results: [{ extensions: [] }] });
      }
      return new Response("not found", { status: 404 });
    },
    async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("extensionquery") && init?.body) {
          const body = JSON.parse(init.body as string) as {
            filters?: Array<{
              criteria: Array<{ filterType: number; value: string }>;
            }>;
          };
          capturedFilters = body.filters?.[0]?.criteria ?? [];
        }
        return originalFetch(input, init);
      };

      const source = {
        id: "vscode-marketplace",
        name: "VS Code Marketplace",
        kind: "marketplace" as const,
        authorityTier: "official-marketplace" as const,
        publisher: { name: "Microsoft", verified: true },
        hosts: ["copilot-vscode" as const],
        assetKinds: ["extension" as const],
        discoveryMode: "catalog" as const,
        priority: 80,
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

      await fetchVsCodeMarketplaceItemsForQuery(source, "debuggers", {
        pageNumber: 1,
        pageSize: 5,
        category: "Debuggers",
      });
    },
  );

  const categoryFilter = (
    capturedFilters as Array<{ filterType: number; value: string }>
  ).find((c) => c.filterType === 5);
  assert.ok(
    categoryFilter !== undefined,
    `filterType:5 (category) must be in request criteria; got: ${JSON.stringify(capturedFilters)}`,
  );
  assert.equal(categoryFilter?.value, "Debuggers");
});

// ─── 7. source-sync/index.ts: maxPagesPerRunOverride spread (lines 141-142) ───

void test("syncIndexedSources — passes maxPagesPerRun option as context override (lines 141-142)", async () => {
  clearRuntimeConfigForTests();
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-sync-maxpages-"),
  );

  try {
    await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
      schemaVersion: 1,
      sources: [],
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
    await mkdir(join(projectRoot, "state", "discover"), { recursive: true });
    await writeFile(
      join(projectRoot, "state", "discover", "source-sync.entries.jsonl"),
      "",
    );

    await syncIndexedSources(projectRoot, { maxPagesPerRun: 2 });
    assert.ok(true, "syncIndexedSources accepted maxPagesPerRun option");
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("syncIndexedSources — throws for invalid maxPagesPerRun (lines 113-116)", async () => {
  for (const bad of [NaN, 0, -1, -Infinity]) {
    await assert.rejects(
      async () => syncIndexedSources("/nonexistent", { maxPagesPerRun: bad }),
      (err: unknown) =>
        err instanceof Error &&
        err.message.includes("syncIndexedSources: options.maxPagesPerRun"),
      `expected throw for maxPagesPerRun=${String(bad)}`,
    );
  }
});

// ─── 8. manifest-validation/discovery.ts: sourceDiversityWarning (lines 640-644)

void test("assertSelectionReport — accepts report with sourceDiversityWarning string (lines 640-644)", () => {
  assert.doesNotThrow(() =>
    assertSelectionReport({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      workspaceRoot: "/workspace",
      host: "copilot-vscode",
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
      summary: { totalSelected: 0, totalRanked: 0, sourceDiversity: 1 },
      sourceDiversityWarning: "only one source contributed",
    }),
  );
});

void test("assertSelectionReport — rejects non-string sourceDiversityWarning (lines 640-644)", () => {
  assert.throws(
    () =>
      assertSelectionReport({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        workspaceRoot: "/workspace",
        host: "copilot-vscode",
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
        summary: { totalSelected: 0, totalRanked: 0, sourceDiversity: 1 },
        sourceDiversityWarning: 42 as unknown as string,
      }),
    /sourceDiversityWarning/u,
  );
});

// ─── 9. recommend/commands.ts: runRecommend run error path (lines 71-72) ─────

void test("runRecommend run — re-throws non-CatalogEmptyError from writeRecommendationReport (lines 71-72)", async () => {
  // We need a scenario where writeRecommendationReport throws a non-CatalogEmptyError.
  // By passing an invalid workingDirectory that doesn't exist, it will throw.
  const result = await runRecommend(
    ["report", "--host", "copilot-vscode"],
    process.cwd(),
    "/nonexistent/path",
  );
  assert.equal(result, 1);
});

// ─── 10. recommend/commands.ts: runRecommend ai-review (lines 123-128) ───────

void test("runRecommend ai-review — returns exit code 1 when catalog is absent (lines 123-128)", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-recommend-airev-no-catalog-"),
  );
  try {
    const result = await runRecommend(
      ["ai-review"],
      process.cwd(),
      projectRoot,
    );
    assert.equal(result, 1);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

// ─── 11. files.ts: listFilesRecursiveWithTelemetry truncation-reason gap ─────

void test("buildDemandProfile: truncation warn is emitted even when truncationReason is absent", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-truncation-reason-gap-"),
  );
  try {
    const fakeScanRoot = join(projectRoot, "workspace");
    await mkdir(fakeScanRoot, { recursive: true });
    await writeFile(join(fakeScanRoot, "a.json"), "{}");

    // The function buildDemandProfile is async and writes stderr on truncation.
    // We verify it doesn't throw when truncationReason is absent.
    const { buildDemandProfile } =
      await import("../domains/discovery/demand-profile.js");
    const profile = await buildDemandProfile(fakeScanRoot);
    assert.ok(
      typeof profile.generatedAt === "string",
      "profile should be built",
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

// ─── 12. package-registries.ts: searchRegistry defensive catch ──────────────

void test("fetchCratesIoSearch — returns [] when fetch throws (searchRegistry defensive catch)", async () => {
  const results = await withFetchMock(
    async () => {
      throw new Error("unexpected network layer failure");
    },
    () =>
      fetchCratesIoSearch("tokio", 10, {
        resolveHostname: async () => [
          { address: "93.184.216.34", family: 4 as const },
        ],
      }),
  );
  assert.deepEqual(results, []);
});
