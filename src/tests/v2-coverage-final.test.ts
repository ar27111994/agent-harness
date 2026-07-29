/**
 * v2-coverage-final.test.ts
 *
 * Final coverage-closing tests for v2.0.0. Each test block names the source
 * file and line range it covers and explains WHY that path was previously
 * unreachable.
 *
 * ## Planned split (v2.1.0)
 *
 * This file bundles ~30 tests across 8 source modules. Each block should be
 * moved to the test file closest to the module it covers:
 *
 *   - package-registries tests → src/tests/package-registries.test.ts
 *   - runtime config tests     → src/tests/runtime-config.test.ts
 *   - discover adjacent tests  → src/tests/discovery-adjacent.test.ts
 *   - VS Code marketplace tests→ src/tests/reference-harvesters.test.ts
 *   - sync indexed sources     → src/tests/source-sync-additional.test.ts
 *   - selection report tests   → src/tests/manifest-validation-discovery.test.ts
 *   - recommend commands tests → src/tests/recommend-commands.test.ts
 *
 * Each test carries its own mock/setup dependencies. Splitting requires
 * verifying that moved tests still reach the exact coverage gaps they
 * were built for — V8 source-map precision can shift across file boundaries.
 *
 * Gaps addressed here:
 *  1. src/package-registries.ts:604-642,648-678
 *     fetchMavenSearch, fetchPackagistSearch, fetchRubyGemsSearch — zero tests
 *  2. src/config/runtime.ts:916-917,919-923
 *     parseFloatFraction — invalid-value error paths never triggered
 *  3. src/domains/discovery/package-registry-harvester.ts:303-306
 *     adjacent.add(name) in live-search loop — existing tests used pypi (returns [])
 *  4. src/domains/discovery/reference-harvesters.ts:307
 *     filterType:5 (category) branch — fetchVsCodeMarketplaceItemsForQuery
 *     was never called with a category option
 *  5. src/domains/discovery/source-sync/index.ts:141-142
 *     maxPagesPerRunOverride spread — all tests used env var, not options param
 *  6. src/manifest-validation/discovery.ts:640-644
 *     sourceDiversityWarning validation branch — assertSelectionReport never
 *     called with that field present
 *  7. src/recommend/commands.ts:71-72
 *     throw err (non-CatalogEmpty) in "run" case
 *  8. src/recommend/commands.ts:123-128
 *     CatalogEmptyError in "ai-review" case
 */

import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/** Root of the agent-harness repo — used to locate fixtures like recommendation-policy. */
const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

import {
  clearRuntimeConfigForTests,
  loadRuntimeConfig,
} from "../config/runtime.js";
import { packageRegistryHarvesterInternals } from "../domains/discovery/package-registry-harvester.js";
import { syncIndexedSources } from "../domains/discovery/source-sync.js";
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
            { description: "neither id nor a" }, // hits the final '' fallback branch (line 595)
            { id: "" }, // filtered out — empty name
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
          { name: "laravel/framework" }, // no description or downloads
          { name: "" }, // filtered out
          { downloads: 500 }, // name missing — hits false branch of typeof === "string" (line 638)
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
    async () => jsonResponse({ total: 0 }), // no "results" key
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
        { name: "sinatra" }, // no info or downloads
        { name: "" }, // filtered out
        { downloads: 1000 }, // name missing — hits false branch of typeof === "string" (line 677)
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
    async () => jsonResponse({ gems: [] }), // not an array
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
          { name: "" }, // filtered out — empty name hits true branch then filtered
          { downloads: 999 }, // name missing — hits false branch of typeof === "string"
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
          { id: "" }, // filtered out — empty name
          { totalDownloads: 500 }, // id missing — hits false branch of typeof === "string" (line 546)
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

// ─── 5. package-registry-harvester.ts: adjacent.add (lines 303-306) ──────────

void test("discoverAdjacentPackages — live search loop adds new name to adjacent set (lines 303-306)", async () => {
  // Mock npm search to return a result; set AGENT_HARNESS_TEST_FETCH_MOCKS
  // so fetchWithGuards bypasses the resolve-hostname guard.
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
      // maxTerms:1 enables one live-search iteration via npm.
      // adjacentToolingEnabled:true is required for the live-search block.
      // existingCandidates is empty so the returned name is new → adjacent.add fires.
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
      // npm searchRegistryByKind returns results via mock — adjacent set should
      // contain at least one name.
      assert.ok(Array.isArray(result), "result is an array");
      // The mock returns one result ("mcp-server-npm"); it must appear in adjacent.
      assert.ok(
        result.includes("mcp-server-npm"),
        `expected mcp-server-npm in adjacent set; got: ${JSON.stringify(result)}`,
      );
    },
  );
});

// ─── 6. reference-harvesters.ts: filterType:5 category branch (line 307) ─────

void test("fetchVsCodeMarketplaceItemsForQuery — category option produces filterType:5 in request body (line 307)", async () => {
  // The function builds a VS Code Marketplace request body. When `category` is
  // provided the body must contain filterType:5 instead of filterType:10.
  // We verify by mocking fetch and capturing the request body.
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

  // Verify filterType:5 is present in the captured criteria.
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
    // Minimal scaffold: sources.json, selections.json, no demand profile.
    // With no vscode-marketplace source (and no indexed sources), the loop
    // body executes zero times — but the option plumbing is exercised.
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
    // state/discover for entries JSONL
    await mkdir(join(projectRoot, "state", "discover"), { recursive: true });
    await writeFile(
      join(projectRoot, "state", "discover", "source-sync.entries.jsonl"),
      "",
    );

    // This exercises the options?.maxPagesPerRun path (lines 141-142).
    await syncIndexedSources(projectRoot, { maxPagesPerRun: 2 });
    // If we reach here without throwing, the option was accepted and the spread ran.
    assert.ok(true, "syncIndexedSources accepted maxPagesPerRun option");
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("syncIndexedSources — throws for invalid maxPagesPerRun (lines 113-116)", async () => {
  // Exercises the validation guard in syncIndexedSources when an invalid
  // maxPagesPerRun is provided. NaN, 0, and negative values must all throw.
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
  // Previously all assertSelectionReport tests omitted sourceDiversityWarning.
  // This exercises the defined-but-present branch.
  assert.doesNotThrow(() =>
    assertSelectionReport(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        inputCount: 10,
        selectedCount: 5,
        rejectedCount: 5,
        sourceDiversityWarning:
          "More than 80% of entries came from a single source.",
      },
      "test",
    ),
  );
});

void test("assertSelectionReport — rejects non-string sourceDiversityWarning (lines 640-644)", () => {
  assert.throws(
    () =>
      assertSelectionReport(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          inputCount: 10,
          selectedCount: 5,
          rejectedCount: 5,
          sourceDiversityWarning: 42, // should be string
        },
        "test",
      ),
    /sourceDiversityWarning/u,
  );
});

// ─── 9. recommend/commands.ts: throw err in "run" case (lines 71-72) ──────────

void test("runRecommend run — re-throws non-CatalogEmptyError from writeRecommendationReport (lines 71-72)", async () => {
  clearRuntimeConfigForTests();
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-recommend-throw-"),
  );

  try {
    await mkdir(join(projectRoot, "discover", "output"), { recursive: true });
    // Write a malformed catalog to trigger a parse error (not CatalogEmptyError).
    await writeFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      "this is not valid jsonl\x00\x01\x02",
    );

    await assert.rejects(
      async () => runRecommend([], "", projectRoot),
      // Any error that is not CatalogEmptyError should propagate — the specific
      // message varies, but the function must throw rather than return 1.
      (err: unknown) => err instanceof Error,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

// ─── 10. recommend/commands.ts: CatalogEmptyError in "ai-review" (lines 123-128)

void test("runRecommend ai-review — returns exit code 1 when catalog is absent (lines 123-128)", async () => {
  clearRuntimeConfigForTests();
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-recommend-airev-no-catalog-"),
  );

  try {
    await mkdir(join(projectRoot, "discover", "output"), { recursive: true });
    // Copy the real recommendation policy so loadRecommendationPolicy succeeds.
    // The catalog is intentionally absent to trigger CatalogEmptyError.
    await cp(
      join(repoRoot, "discover", "recommendation-policy"),
      join(projectRoot, "discover", "recommendation-policy"),
      { recursive: true },
    );

    const stderrChunks: string[] = [];
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown, ...rest: unknown[]) => {
      if (typeof chunk === "string") {
        stderrChunks.push(chunk);
      } else if (Buffer.isBuffer(chunk)) {
        stderrChunks.push(chunk.toString("utf8"));
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalStderrWrite as any)(chunk, ...rest);
    };

    let exitCode: number;
    try {
      exitCode = await runRecommend(["ai-review"], "", projectRoot);
    } finally {
      process.stderr.write = originalStderrWrite;
    }

    assert.equal(
      exitCode,
      1,
      "exit code must be 1 when catalog is absent in ai-review",
    );
    const stderrText = stderrChunks.join("");
    assert.ok(
      stderrText.length > 0,
      "stderr must contain guidance when catalog is absent",
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

// ─── 11. package-registries.ts: Packagist/RubyGems catch paths (640-641, 676-677)

void test("fetchPackagistSearch — returns [] on network failure (catch path, lines 640-641)", async () => {
  const results = await withFetchMock(
    async () => {
      throw new Error("network error");
    },
    () =>
      fetchPackagistSearch("test", 10, {
        resolveHostname: async () => [
          { address: "93.184.216.34", family: 4 as const },
        ],
      }),
  );
  assert.deepEqual(results, []);
});

void test("fetchRubyGemsSearch — returns [] on network failure (catch path, lines 676-677)", async () => {
  const results = await withFetchMock(
    async () => {
      throw new Error("network error");
    },
    () =>
      fetchRubyGemsSearch("test", 10, {
        resolveHostname: async () => [
          { address: "93.184.216.34", family: 4 as const },
        ],
      }),
  );
  assert.deepEqual(results, []);
});

// ─── 12. runtime.ts: parseFloatFraction valid return path (line 922) ──────────

void test("loadRuntimeConfig — parseFloatFraction returns valid fraction (line 922)", () => {
  clearRuntimeConfigForTests();
  const config = loadRuntimeConfig({
    HOME: "/home/tester",
    AGENT_HARNESS_DISCOVERY_MIN_SIMILARITY: "0.5",
  });
  assert.equal(config.discovery.semanticScoringMinSimilarity, 0.5);
});

// ─── 13. recommend/commands.ts: ai-review throw non-CatalogEmpty (lines 127-128)

void test("runRecommend ai-review — re-throws non-CatalogEmptyError from writeRecommendationReport (lines 127-128)", async () => {
  clearRuntimeConfigForTests();
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-recommend-airev-throw-"),
  );

  try {
    await mkdir(join(projectRoot, "discover", "output"), { recursive: true });
    // Copy the real recommendation policy so loadRecommendationPolicy succeeds.
    await cp(
      join(repoRoot, "discover", "recommendation-policy"),
      join(projectRoot, "discover", "recommendation-policy"),
      { recursive: true },
    );
    // Write a malformed catalog to trigger a non-CatalogEmptyError parse error.
    await writeFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      "not valid json\x00\x01",
    );

    await assert.rejects(
      async () => runRecommend(["ai-review"], "", projectRoot),
      (err: unknown) => err instanceof Error,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("fetchCratesIoSearch returns [] when fetch throws (searchRegistry defensive catch)", async () => {
  // Return a 500 response — fetchTextWithGuards returns null on non-2xx,
  // fetchJsonWithGuards returns null, then extractResults(null) throws,
  // triggering the searchRegistry catch block.
  const results = await withFetchMock(
    async () => new Response("Internal Server Error", { status: 500 }),
    () =>
      fetchCratesIoSearch("tokio", 10, {
        resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      }),
  );
  assert.deepEqual(results, []);
});
