import assert from "node:assert/strict";
import test from "node:test";

import { loadRuntimeConfig } from "../config/runtime.js";

void test("runtime config preserves existing defaults when new env vars are unset", () => {
  const config = loadRuntimeConfig({
    HOME: "/home/tester",
  });

  assert.equal(config.aiEnrichment.model, "gpt-4o-mini");
  assert.ok(
    config.aiEnrichment.allowedOrigins.includes("https://api.openai.com"),
  );
  assert.equal(config.aiEnrichment.requestTimeoutMs, 20_000);
  assert.equal(config.aiEnrichment.responseMaxBytes, 1_000_000);
  assert.equal(config.http.timeoutMs, 10_000);
  assert.equal(config.http.maxResponseBytes, 1_000_000);
  assert.equal(config.github.fetchTimeoutMs, 10_000);
  assert.equal(config.github.jsonMaxBytes, 2_000_000);
  assert.equal(config.registries.fetchTimeoutMs, 5_000);
  assert.equal(config.discovery.referenceSourceMaxBytes, 600_000);
  assert.equal(config.discovery.genericReferenceMaxItems, 8);
  assert.equal(config.discovery.npmMcpSearchQueryLimit, 8);
  assert.equal(config.officialIndex.pageMaxBytes, 1_000_000);
  assert.equal(config.officialIndex.contentMaxBytes, 1_000_000);
  assert.equal(config.hostCommands.nativeTimeoutMs, 30_000);
  assert.equal(config.hostCommands.preflightTimeoutMs, 10_000);
  assert.equal(config.mirrorLimits.maxOfficialIndexPackageFiles, 1_000);
  assert.equal(config.mirrorLimits.maxGitHubMirrorFileSizeBytes, 1_000_000);
  assert.equal(config.diagnostics.debugEnabled, false);
});

void test("runtime config accepts custom runtime knobs and enrichment origins", () => {
  const newEndpointOrigin = "https://gateway.example.com";
  const config = loadRuntimeConfig({
    HOME: "/home/tester",
    AGENT_HARNESS_AI_ENRICHMENT_URL: `${newEndpointOrigin}/v1/chat/completions`,
    AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS: "https://proxy.example.com",
    AGENT_HARNESS_AI_ENRICHMENT_TIMEOUT_MS: "45000",
    AGENT_HARNESS_AI_ENRICHMENT_MAX_RESPONSE_BYTES: "250000",
    AGENT_HARNESS_HTTP_TIMEOUT_MS: "11000",
    AGENT_HARNESS_HTTP_MAX_RESPONSE_BYTES: "1500000",
    AGENT_HARNESS_GITHUB_FETCH_TIMEOUT_MS: "12000",
    AGENT_HARNESS_GITHUB_JSON_MAX_BYTES: "3000000",
    AGENT_HARNESS_REGISTRY_FETCH_TIMEOUT_MS: "7000",
    AGENT_HARNESS_REGISTRY_METADATA_MAX_BYTES: "3100000",
    AGENT_HARNESS_REGISTRY_SEARCH_MAX_BYTES: "410000",
    AGENT_HARNESS_REFERENCE_SOURCE_MAX_BYTES: "610000",
    AGENT_HARNESS_GENERIC_REFERENCE_MAX_ITEMS: "4",
    AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_QUERIES: "2",
    AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_ITEMS_PER_QUERY: "3",
    AGENT_HARNESS_NPM_SEARCH_RESULT_LIMIT: "5",
    AGENT_HARNESS_NPM_MCP_SEARCH_QUERY_LIMIT: "2",
    AGENT_HARNESS_OFFICIAL_INDEX_PAGE_MAX_BYTES: "710000",
    AGENT_HARNESS_OFFICIAL_INDEX_CONTENT_MAX_BYTES: "810000",
    AGENT_HARNESS_NATIVE_COMMAND_TIMEOUT_MS: "33000",
    AGENT_HARNESS_NATIVE_COMMAND_MAX_BUFFER_BYTES: "2200000",
    AGENT_HARNESS_PREFLIGHT_COMMAND_TIMEOUT_MS: "13000",
    AGENT_HARNESS_MAX_OFFICIAL_INDEX_PACKAGE_FILES: "1200",
    AGENT_HARNESS_MAX_OFFICIAL_INDEX_FILE_SIZE_BYTES: "1300000",
    AGENT_HARNESS_MAX_OFFICIAL_INDEX_PACKAGE_TOTAL_BYTES: "23000000",
    AGENT_HARNESS_MAX_GITHUB_MIRROR_FILE_SIZE_BYTES: "1400000",
    AGENT_HARNESS_DEBUG: "true",
  });

  assert.equal(config.aiEnrichment.requestTimeoutMs, 45_000);
  assert.equal(config.aiEnrichment.responseMaxBytes, 250_000);
  assert.ok(
    config.aiEnrichment.allowedOrigins.includes("https://proxy.example.com"),
  );
  assert.ok(config.aiEnrichment.allowedOrigins.includes(newEndpointOrigin));
  assert.equal(config.http.timeoutMs, 11_000);
  assert.equal(config.http.maxResponseBytes, 1_500_000);
  assert.equal(config.github.fetchTimeoutMs, 12_000);
  assert.equal(config.github.jsonMaxBytes, 3_000_000);
  assert.equal(config.registries.fetchTimeoutMs, 7_000);
  assert.equal(config.registries.metadataMaxBytes, 3_100_000);
  assert.equal(config.registries.searchMaxBytes, 410_000);
  assert.equal(config.registries.npmSearchResultLimit, 5);
  assert.equal(config.discovery.referenceSourceMaxBytes, 610_000);
  assert.equal(config.discovery.genericReferenceMaxItems, 4);
  assert.equal(config.discovery.vscodeMarketplaceMaxQueries, 2);
  assert.equal(config.discovery.vscodeMarketplaceMaxItemsPerQuery, 3);
  assert.equal(config.discovery.npmMcpSearchQueryLimit, 2);
  assert.equal(config.officialIndex.pageMaxBytes, 710_000);
  assert.equal(config.officialIndex.contentMaxBytes, 810_000);
  assert.equal(config.hostCommands.nativeTimeoutMs, 33_000);
  assert.equal(config.hostCommands.nativeMaxBufferBytes, 2_200_000);
  assert.equal(config.hostCommands.preflightTimeoutMs, 13_000);
  assert.equal(config.mirrorLimits.maxOfficialIndexPackageFiles, 1_200);
  assert.equal(config.mirrorLimits.maxOfficialIndexFileSizeBytes, 1_300_000);
  assert.equal(
    config.mirrorLimits.maxOfficialIndexPackageTotalBytes,
    23_000_000,
  );
  assert.equal(config.mirrorLimits.maxGitHubMirrorFileSizeBytes, 1_400_000);
  assert.equal(config.diagnostics.debugEnabled, true);
});

void test("runtime config rejects invalid numeric and boolean env vars", () => {
  assert.throws(
    () =>
      loadRuntimeConfig({
        HOME: "/home/tester",
        AGENT_HARNESS_HTTP_TIMEOUT_MS: "0",
      }),
    /AGENT_HARNESS_HTTP_TIMEOUT_MS must be a positive integer/u,
  );

  assert.throws(
    () =>
      loadRuntimeConfig({
        HOME: "/home/tester",
        AGENT_HARNESS_DEBUG: "maybe",
      }),
    /AGENT_HARNESS_DEBUG must be a boolean/u,
  );

  assert.throws(
    () =>
      loadRuntimeConfig({
        HOME: "/home/tester",
        AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS:
          "http://insecure.example.com",
      }),
    /AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS/u,
  );
});
