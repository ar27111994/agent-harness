import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clearRuntimeConfigForTests } from "../config/runtime.js";
import {
  applyAiReviewToReport,
  buildRecommendationAiReviewInput,
  readRecommendationAiReviewArtifact,
  readRecommendationAiReviewInput,
  recommendationAiReviewInternals,
  runRecommendationAiReview,
} from "../recommend/ai-review.js";
import type {
  AssetCatalogEntry,
  DemandProfile,
  RecommendationAiReviewArtifact,
  RecommendationEntry,
  RecommendationHostSummary,
  RecommendationReport,
} from "../types.js";
import { loadRecommendationPolicy } from "../recommend/policy.js";

void test("ai review error formatter preserves structured and fallback errors", () => {
  assert.equal(
    recommendationAiReviewInternals.toAiReviewErrorMessage({
      code: "bad_response",
      retryable: false,
    }),
    '{\n  "code": "bad_response",\n  "retryable": false\n}',
  );
  assert.equal(
    recommendationAiReviewInternals.toAiReviewErrorMessage({}),
    "[object Object]",
  );
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(
    recommendationAiReviewInternals.toAiReviewErrorMessage(circular),
    "[object Object]",
  );
});

void test("ai review input stays bounded to the requested shortlist size", async () => {
  const report = createRecommendationReport();
  const input = buildRecommendationAiReviewInput(report, null, {
    host: "copilot-vscode",
    reviewLimit: 1,
  });

  assert.deepEqual(input.reviewedHosts, ["copilot-vscode"]);
  assert.equal(input.hosts[0]?.candidates.length, 1);
  assert.equal(input.hosts[0]?.candidates[0]?.assetId, "asset-a");
});

void test("ai review apply leaves reports unchanged when artifacts are not completed", async () => {
  const policy = await loadRecommendationPolicy(process.cwd());
  const report = createRecommendationReport();
  const artifact: RecommendationAiReviewArtifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    enabled: true,
    status: "failed",
    reviewedHosts: ["copilot-vscode"],
    hostReviews: [],
    error: "bad payload",
  };

  assert.equal(applyAiReviewToReport(report, artifact, policy), report);
});

void test("ai review apply suppresses and reranks deterministically", async () => {
  const policy = await loadRecommendationPolicy(process.cwd());
  const report = createRecommendationReport();
  const artifact: RecommendationAiReviewArtifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    enabled: true,
    status: "completed",
    reviewedHosts: ["copilot-vscode"],
    hostReviews: [
      {
        host: "copilot-vscode",
        acceptedAssetIds: [],
        questionable: [
          {
            assetId: "asset-a",
            reason: "too generic",
            confidence: "medium",
          },
        ],
        suppressedAssetIds: ["asset-a"],
        rerank: [
          {
            assetId: "asset-b",
            delta: 12,
            reason: "stronger fit",
            confidence: "high",
          },
        ],
      },
    ],
  };

  const nextReport = applyAiReviewToReport(report, artifact, policy);
  const entries = nextReport.topByHost["copilot-vscode"];

  assert.deepEqual(
    entries.map((entry) => entry.assetId),
    ["asset-b"],
  );
  assert.equal(entries[0]?.score, 112);
  assert.ok(entries[0]?.reasons.includes("ai-review:rerank:+12"));
});

void test("ai review apply supports negative reranks and deterministic tie breaks", async () => {
  const policy = await loadRecommendationPolicy(process.cwd());
  const report = createRecommendationReport();
  report.topByHost["copilot-vscode"] = [
    createEntry("asset-b", 100),
    createEntry("asset-a", 90),
    createEntry("asset-c", 101),
  ];
  const artifact: RecommendationAiReviewArtifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    enabled: true,
    status: "completed",
    reviewedHosts: ["copilot-vscode"],
    hostReviews: [
      {
        host: "copilot-vscode",
        acceptedAssetIds: [],
        questionable: [],
        suppressedAssetIds: [],
        rerank: [
          {
            assetId: "asset-a",
            delta: 10,
            reason: "same score as asset b",
            confidence: "medium",
          },
          {
            assetId: "asset-c",
            delta: -1,
            reason: "slightly weaker",
            confidence: "low",
          },
        ],
      },
    ],
  };

  const nextReport = applyAiReviewToReport(report, artifact, policy);
  const entries = nextReport.topByHost["copilot-vscode"];

  assert.deepEqual(
    entries.map((entry) => entry.assetId),
    ["asset-a", "asset-b", "asset-c"],
  );
  assert.ok(entries[0]?.reasons.includes("ai-review:rerank:+10"));
  assert.ok(entries[2]?.reasons.includes("ai-review:rerank:-1"));
});

void test("ai review writes disabled artifacts when enrichment is not configured", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-ai-review-disabled-"),
  );
  const previousUrl = process.env.AGENT_HARNESS_AI_ENRICHMENT_URL;
  const previousKey = process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY;
  delete process.env.AGENT_HARNESS_AI_ENRICHMENT_URL;
  delete process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY;
  clearRuntimeConfigForTests();

  context.after(async () => {
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_URL", previousUrl);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_API_KEY", previousKey);
    clearRuntimeConfigForTests();
    await rm(projectRoot, { force: true, recursive: true });
  });

  await seedAiReviewProject(projectRoot, {
    report: createRecommendationReport(),
    demandProfile: createDemandProfile(),
    catalogEntries: createCatalogEntries(),
  });

  const policy = await loadRecommendationPolicy(process.cwd());
  const result = await runRecommendationAiReview({
    projectRoot,
    policy,
    report: createRecommendationReport(),
    host: "copilot-vscode",
    reviewLimit: 999,
    apply: false,
  });

  assert.equal(result.input.reviewLimit, 80);
  assert.deepEqual(result.input.reviewedHosts, ["copilot-vscode"]);
  assert.equal(result.artifact.status, "disabled");
  assert.match(result.artifact.warnings?.[0] ?? "", /AI review is disabled/u);

  const persistedInput = await readRecommendationAiReviewInput(projectRoot);
  const persistedArtifact =
    await readRecommendationAiReviewArtifact(projectRoot);
  assert.equal(persistedInput?.reviewLimit, 80);
  assert.equal(persistedArtifact?.status, "disabled");
});

void test("ai review sanitizes model responses and applies bounded reranks", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-ai-review-completed-"),
  );
  const previousUrl = process.env.AGENT_HARNESS_AI_ENRICHMENT_URL;
  const previousKey = process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY;
  const previousOrigins =
    process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const originalFetch = globalThis.fetch;

  process.env.AGENT_HARNESS_AI_ENRICHMENT_URL = "https://example.com/ai-review";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY = "secret";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS =
    "https://example.com";
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  clearRuntimeConfigForTests();

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [
                {
                  type: "output_text",
                  output_text: JSON.stringify({
                    hostReviews: [
                      {
                        host: "copilot-vscode",
                        acceptedAssetIds: ["asset-b", "asset-b", "unknown"],
                        questionable: [
                          {
                            assetId: "asset-a",
                            reason: "  too generic for this workspace  ",
                            confidence: "high",
                          },
                          {
                            assetId: "asset-a",
                            reason: "duplicate",
                            confidence: "low",
                          },
                        ],
                        suppressedAssetIds: ["asset-a", "asset-a", "missing"],
                        rerank: [
                          {
                            assetId: "asset-b",
                            delta: 90,
                            reason: " promote exact match ",
                            confidence: "invalid",
                          },
                          {
                            assetId: "asset-b",
                            delta: -1,
                            reason: "duplicate",
                            confidence: "low",
                          },
                        ],
                      },
                    ],
                    warnings: ["  first warning  ", "first warning", 42],
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );

  context.after(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_URL", previousUrl);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_API_KEY", previousKey);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS", previousOrigins);
    restoreEnv("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    clearRuntimeConfigForTests();
    await rm(projectRoot, { force: true, recursive: true });
  });

  const report = createRecommendationReport();
  await seedAiReviewProject(projectRoot, {
    report,
    demandProfile: createDemandProfile(),
    catalogEntries: createCatalogEntries(),
  });

  const policy = await loadRecommendationPolicy(process.cwd());
  const result = await runRecommendationAiReview({
    projectRoot,
    policy,
    report,
    host: "copilot-vscode",
    reviewLimit: 2,
    apply: true,
  });

  assert.equal(result.artifact.status, "completed");
  assert.deepEqual(result.artifact.warnings, ["first warning"]);
  assert.deepEqual(result.artifact.hostReviews[0]?.acceptedAssetIds, [
    "asset-b",
  ]);
  assert.deepEqual(result.artifact.hostReviews[0]?.suppressedAssetIds, [
    "asset-a",
  ]);
  assert.deepEqual(result.artifact.hostReviews[0]?.questionable, [
    {
      assetId: "asset-a",
      reason: "too generic for this workspace",
      confidence: "high",
    },
  ]);
  assert.deepEqual(result.artifact.hostReviews[0]?.rerank, [
    {
      assetId: "asset-b",
      delta: 30,
      reason: "promote exact match",
      confidence: "medium",
    },
  ]);
  assert.equal(
    result.report.topByHost["copilot-vscode"][0]?.assetId,
    "asset-b",
  );
  assert.ok(
    result.report.topByHost["copilot-vscode"][0]?.reasons.includes(
      "ai-review:rerank:+30",
    ),
  );
  assert.deepEqual(
    result.report.topByHost["copilot-vscode"].map((entry) => entry.assetId),
    ["asset-b"],
  );
});

void test("ai review records failed artifacts when the transport returns JSON null", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-ai-review-null-"),
  );
  const previousUrl = process.env.AGENT_HARNESS_AI_ENRICHMENT_URL;
  const previousKey = process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY;
  const previousOrigins =
    process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const originalFetch = globalThis.fetch;

  process.env.AGENT_HARNESS_AI_ENRICHMENT_URL = "https://example.com/ai-review";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY = "secret";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS =
    "https://example.com";
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  clearRuntimeConfigForTests();

  globalThis.fetch = async () => new Response("null", { status: 200 });

  context.after(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_URL", previousUrl);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_API_KEY", previousKey);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS", previousOrigins);
    restoreEnv("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    clearRuntimeConfigForTests();
    await rm(projectRoot, { force: true, recursive: true });
  });

  const report = createRecommendationReport();
  await seedAiReviewProject(projectRoot, {
    report,
    demandProfile: createDemandProfile(),
    catalogEntries: createCatalogEntries(),
  });

  const policy = await loadRecommendationPolicy(process.cwd());
  const result = await runRecommendationAiReview({
    projectRoot,
    policy,
    report,
    apply: true,
  });

  assert.equal(result.artifact.status, "failed");
  assert.match(result.artifact.error ?? "", /empty or invalid JSON response/u);
  assert.deepEqual(result.report, report);
});

void test("ai review sanitizes direct host review payloads with blank reasons and non-string ids", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-ai-review-sanitize-"),
  );
  const previousUrl = process.env.AGENT_HARNESS_AI_ENRICHMENT_URL;
  const previousKey = process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY;
  const previousOrigins =
    process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const originalFetch = globalThis.fetch;

  process.env.AGENT_HARNESS_AI_ENRICHMENT_URL = "https://example.com/ai-review";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY = "secret";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS =
    "https://example.com";
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  clearRuntimeConfigForTests();

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        hostReviews: [
          {
            host: "copilot-vscode",
            acceptedAssetIds: [42, "asset-a", "asset-a"],
            questionable: [
              { assetId: 42 },
              { assetId: "asset-b", reason: "   ", confidence: "high" },
            ],
            rerank: [
              { assetId: 42, delta: 4, reason: "ignored", confidence: "low" },
              {
                assetId: "asset-b",
                delta: 4,
                reason: "   ",
                confidence: "high",
              },
            ],
            warnings: ["   ", "kept warning"],
          },
        ],
      }),
      { status: 200 },
    );

  context.after(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_URL", previousUrl);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_API_KEY", previousKey);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS", previousOrigins);
    restoreEnv("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    clearRuntimeConfigForTests();
    await rm(projectRoot, { force: true, recursive: true });
  });

  const report = createRecommendationReport();
  await seedAiReviewProject(projectRoot, {
    report,
    demandProfile: createDemandProfile(),
    catalogEntries: createCatalogEntries(),
  });

  const policy = await loadRecommendationPolicy(process.cwd());
  const result = await runRecommendationAiReview({
    projectRoot,
    policy,
    report,
    host: "copilot-vscode",
    reviewLimit: 2,
    apply: true,
  });

  assert.equal(result.artifact.status, "completed");
  assert.deepEqual(result.artifact.hostReviews[0]?.acceptedAssetIds, [
    "asset-a",
  ]);
  assert.deepEqual(result.artifact.hostReviews[0]?.questionable, [
    {
      assetId: "asset-b",
      reason: "AI review flagged this asset as questionable.",
      confidence: "high",
    },
  ]);
  assert.deepEqual(result.artifact.hostReviews[0]?.rerank, [
    {
      assetId: "asset-b",
      delta: 4,
      reason: "AI review reranked this asset.",
      confidence: "high",
    },
  ]);
  assert.deepEqual(result.artifact.warnings, []);
  assert.equal(
    result.report.topByHost["copilot-vscode"][0]?.assetId,
    "asset-b",
  );
});

void test("ai review treats non-object payloads and missing choices as empty reviews", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-ai-review-invalid-shape-"),
  );
  const previousUrl = process.env.AGENT_HARNESS_AI_ENRICHMENT_URL;
  const previousKey = process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY;
  const previousOrigins =
    process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const originalFetch = globalThis.fetch;

  process.env.AGENT_HARNESS_AI_ENRICHMENT_URL = "https://example.com/ai-review";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY = "secret";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS =
    "https://example.com";
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  clearRuntimeConfigForTests();

  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    return new Response(callCount === 1 ? "[]" : JSON.stringify({}), {
      status: 200,
    });
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_URL", previousUrl);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_API_KEY", previousKey);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS", previousOrigins);
    restoreEnv("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    clearRuntimeConfigForTests();
    await rm(projectRoot, { force: true, recursive: true });
  });

  const report = createRecommendationReport();
  await seedAiReviewProject(projectRoot, {
    report,
    demandProfile: createDemandProfile(),
    catalogEntries: createCatalogEntries(),
  });

  const policy = await loadRecommendationPolicy(process.cwd());
  const firstResult = await runRecommendationAiReview({
    projectRoot,
    policy,
    report,
    apply: false,
  });
  const secondResult = await runRecommendationAiReview({
    projectRoot,
    policy,
    report,
    apply: false,
  });

  assert.equal(firstResult.artifact.status, "completed");
  assert.deepEqual(firstResult.artifact.hostReviews, [
    {
      host: "shared",
      acceptedAssetIds: [],
      questionable: [],
      suppressedAssetIds: [],
      rerank: [],
    },
    {
      host: "copilot-vscode",
      acceptedAssetIds: [],
      questionable: [],
      suppressedAssetIds: [],
      rerank: [],
    },
    {
      host: "opencode",
      acceptedAssetIds: [],
      questionable: [],
      suppressedAssetIds: [],
      rerank: [],
    },
    {
      host: "cursor",
      acceptedAssetIds: [],
      questionable: [],
      suppressedAssetIds: [],
      rerank: [],
    },
    {
      host: "zed",
      acceptedAssetIds: [],
      questionable: [],
      suppressedAssetIds: [],
      rerank: [],
    },
    {
      host: "claude-code",
      acceptedAssetIds: [],
      questionable: [],
      suppressedAssetIds: [],
      rerank: [],
    },
    {
      host: "pi",
      acceptedAssetIds: [],
      questionable: [],
      suppressedAssetIds: [],
      rerank: [],
    },
  ]);
  assert.equal(secondResult.artifact.status, "completed");
  assert.deepEqual(
    secondResult.artifact.hostReviews,
    firstResult.artifact.hostReviews,
  );
});

void test("ai review records failed artifacts when the response payload is invalid", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-ai-review-failed-"),
  );
  const previousUrl = process.env.AGENT_HARNESS_AI_ENRICHMENT_URL;
  const previousKey = process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY;
  const previousOrigins =
    process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const originalFetch = globalThis.fetch;

  process.env.AGENT_HARNESS_AI_ENRICHMENT_URL = "https://example.com/ai-review";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY = "secret";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS =
    "https://example.com";
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  clearRuntimeConfigForTests();

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "not-json" } }],
      }),
      { status: 200 },
    );

  context.after(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_URL", previousUrl);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_API_KEY", previousKey);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS", previousOrigins);
    restoreEnv("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    clearRuntimeConfigForTests();
    await rm(projectRoot, { force: true, recursive: true });
  });

  const report = createRecommendationReport();
  await seedAiReviewProject(projectRoot, {
    report,
    demandProfile: createDemandProfile(),
    catalogEntries: createCatalogEntries(),
  });

  const policy = await loadRecommendationPolicy(process.cwd());
  const result = await runRecommendationAiReview({
    projectRoot,
    policy,
    report,
    apply: true,
  });

  assert.equal(result.artifact.status, "failed");
  assert.match(result.artifact.error ?? "", /invalid JSON content/u);
  assert.deepEqual(result.report, report);
});

void test("ai review accepts direct hostReviews payloads and fills missing hosts with empty reviews", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-ai-review-direct-"),
  );
  const previousUrl = process.env.AGENT_HARNESS_AI_ENRICHMENT_URL;
  const previousKey = process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY;
  const previousOrigins =
    process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const originalFetch = globalThis.fetch;

  process.env.AGENT_HARNESS_AI_ENRICHMENT_URL = "https://example.com/ai-review";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY = "secret";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS =
    "https://example.com";
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  clearRuntimeConfigForTests();

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        hostReviews: [
          {
            host: "copilot-vscode",
            acceptedAssetIds: ["asset-a"],
            rerank: [
              {
                assetId: "asset-b",
                delta: -4,
                reason: "slightly weaker",
                confidence: "low",
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );

  context.after(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_URL", previousUrl);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_API_KEY", previousKey);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS", previousOrigins);
    restoreEnv("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    clearRuntimeConfigForTests();
    await rm(projectRoot, { force: true, recursive: true });
  });

  const report = createRecommendationReport();
  await seedAiReviewProject(projectRoot, {
    report,
    demandProfile: null,
    catalogEntries: createCatalogEntries(),
  });

  const policy = await loadRecommendationPolicy(process.cwd());
  const result = await runRecommendationAiReview({
    projectRoot,
    policy,
    report,
    apply: false,
  });

  assert.equal(result.artifact.status, "completed");
  assert.deepEqual(result.input.reviewedHosts, [
    "shared",
    "copilot-vscode",
    "opencode",
    "cursor",
    "zed",
    "claude-code",
    "pi",
  ]);
  assert.deepEqual(
    result.artifact.hostReviews.find(
      (entry) => entry.host === "copilot-vscode",
    ),
    {
      host: "copilot-vscode",
      acceptedAssetIds: ["asset-a"],
      questionable: [],
      suppressedAssetIds: [],
      rerank: [
        {
          assetId: "asset-b",
          delta: -4,
          reason: "slightly weaker",
          confidence: "low",
        },
      ],
    },
  );
  assert.deepEqual(
    result.artifact.hostReviews.find((entry) => entry.host === "shared"),
    {
      host: "shared",
      acceptedAssetIds: [],
      questionable: [],
      suppressedAssetIds: [],
      rerank: [],
    },
  );
});

void test("ai review sanitizes invalid rerank deltas to zero and ignores empty output text blocks", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-ai-review-zero-delta-"),
  );
  const previousUrl = process.env.AGENT_HARNESS_AI_ENRICHMENT_URL;
  const previousKey = process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY;
  const previousOrigins =
    process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const originalFetch = globalThis.fetch;

  process.env.AGENT_HARNESS_AI_ENRICHMENT_URL = "https://example.com/ai-review";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY = "secret";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS =
    "https://example.com";
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  clearRuntimeConfigForTests();

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [
                {
                  type: "output_text",
                },
                {
                  type: "output_text",
                  output_text: JSON.stringify({
                    hostReviews: [
                      {
                        host: "copilot-vscode",
                        rerank: [
                          {
                            assetId: "asset-a",
                            delta: "oops",
                            reason: "keep in place",
                            confidence: "low",
                          },
                        ],
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );

  context.after(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_URL", previousUrl);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_API_KEY", previousKey);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS", previousOrigins);
    restoreEnv("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    clearRuntimeConfigForTests();
    await rm(projectRoot, { force: true, recursive: true });
  });

  const report = createRecommendationReport();
  await seedAiReviewProject(projectRoot, {
    report,
    demandProfile: createDemandProfile(),
    catalogEntries: createCatalogEntries(),
  });

  const policy = await loadRecommendationPolicy(process.cwd());
  const result = await runRecommendationAiReview({
    projectRoot,
    policy,
    report,
    apply: true,
  });

  assert.equal(result.artifact.status, "completed");
  assert.equal(
    result.artifact.hostReviews.find((entry) => entry.host === "copilot-vscode")
      ?.rerank[0]?.delta,
    0,
  );
  assert.ok(
    !result.report.topByHost["copilot-vscode"][0]?.reasons.includes(
      "ai-review:rerank:+0",
    ),
  );
});

void test("ai review parses message output_text fallback blocks", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-ai-review-output-text-"),
  );
  const previousUrl = process.env.AGENT_HARNESS_AI_ENRICHMENT_URL;
  const previousKey = process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY;
  const previousOrigins =
    process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const originalFetch = globalThis.fetch;

  process.env.AGENT_HARNESS_AI_ENRICHMENT_URL = "https://example.com/ai-review";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY = "secret";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS =
    "https://example.com";
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  clearRuntimeConfigForTests();

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [{ type: "ignored" }],
              output_text: JSON.stringify({
                hostReviews: [
                  {
                    host: "copilot-vscode",
                    questionable: [
                      {
                        assetId: "asset-a",
                        reason: "fallback path",
                        confidence: "medium",
                      },
                    ],
                  },
                ],
                warnings: Array.from(
                  { length: 25 },
                  (_, index) => `warning ${index}`,
                ),
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );

  context.after(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_URL", previousUrl);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_API_KEY", previousKey);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS", previousOrigins);
    restoreEnv("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    clearRuntimeConfigForTests();
    await rm(projectRoot, { force: true, recursive: true });
  });

  const report = createRecommendationReport();
  await seedAiReviewProject(projectRoot, {
    report,
    demandProfile: createDemandProfile(),
    catalogEntries: createCatalogEntries(),
  });

  const policy = await loadRecommendationPolicy(process.cwd());
  const result = await runRecommendationAiReview({
    projectRoot,
    policy,
    report,
    host: "copilot-vscode",
    apply: false,
  });

  assert.equal(result.artifact.status, "completed");
  assert.deepEqual(result.artifact.hostReviews[0], {
    host: "copilot-vscode",
    acceptedAssetIds: [],
    questionable: [
      {
        assetId: "asset-a",
        reason: "fallback path",
        confidence: "medium",
      },
    ],
    suppressedAssetIds: [],
    rerank: [],
  });
  assert.equal(result.artifact.warnings?.length, 20);
  assert.equal(result.artifact.warnings?.[0], "warning 0");
  assert.equal(result.artifact.warnings?.[19], "warning 19");
});

void test("ai review parses string and text message content blocks", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-ai-review-message-content-"),
  );
  const previousUrl = process.env.AGENT_HARNESS_AI_ENRICHMENT_URL;
  const previousKey = process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY;
  const previousOrigins =
    process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;

  process.env.AGENT_HARNESS_AI_ENRICHMENT_URL = "https://example.com/ai-review";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY = "secret";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS =
    "https://example.com";
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  clearRuntimeConfigForTests();

  globalThis.fetch = async () => {
    fetchCallCount += 1;
    return new Response(
      JSON.stringify(
        fetchCallCount === 1
          ? {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      hostReviews: [
                        {
                          host: "copilot-vscode",
                          acceptedAssetIds: ["asset-a"],
                        },
                      ],
                    }),
                  },
                },
              ],
            }
          : {
              choices: [
                {
                  message: {
                    content: [
                      {
                        text: JSON.stringify({
                          hostReviews: [
                            {
                              host: "copilot-vscode",
                              suppressedAssetIds: ["asset-b"],
                            },
                          ],
                        }),
                      },
                    ],
                  },
                },
              ],
            },
      ),
      { status: 200 },
    );
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_URL", previousUrl);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_API_KEY", previousKey);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS", previousOrigins);
    restoreEnv("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    clearRuntimeConfigForTests();
    await rm(projectRoot, { force: true, recursive: true });
  });

  const report = createRecommendationReport();
  await seedAiReviewProject(projectRoot, {
    report,
    demandProfile: createDemandProfile(),
    catalogEntries: createCatalogEntries(),
  });

  const policy = await loadRecommendationPolicy(process.cwd());
  const stringContentResult = await runRecommendationAiReview({
    projectRoot,
    policy,
    report,
    host: "copilot-vscode",
    apply: false,
  });
  const textBlockResult = await runRecommendationAiReview({
    projectRoot,
    policy,
    report,
    host: "copilot-vscode",
    apply: false,
  });

  assert.equal(
    stringContentResult.artifact.hostReviews[0]?.acceptedAssetIds[0],
    "asset-a",
  );
  assert.deepEqual(
    textBlockResult.artifact.hostReviews[0]?.suppressedAssetIds,
    ["asset-b"],
  );
});

void test("ai review treats missing message payloads as empty reviews", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-ai-review-empty-message-"),
  );
  const previousUrl = process.env.AGENT_HARNESS_AI_ENRICHMENT_URL;
  const previousKey = process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY;
  const previousOrigins =
    process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const originalFetch = globalThis.fetch;

  process.env.AGENT_HARNESS_AI_ENRICHMENT_URL = "https://example.com/ai-review";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY = "secret";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS =
    "https://example.com";
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  clearRuntimeConfigForTests();

  let fetchCallCount = 0;
  globalThis.fetch = async () => {
    fetchCallCount += 1;
    return new Response(
      JSON.stringify(
        fetchCallCount === 1
          ? { choices: [{}] }
          : { choices: [{ message: {} }] },
      ),
      { status: 200 },
    );
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_URL", previousUrl);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_API_KEY", previousKey);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS", previousOrigins);
    restoreEnv("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    clearRuntimeConfigForTests();
    await rm(projectRoot, { force: true, recursive: true });
  });

  const report = createRecommendationReport();
  await seedAiReviewProject(projectRoot, {
    report,
    demandProfile: createDemandProfile(),
    catalogEntries: createCatalogEntries(),
  });

  const policy = await loadRecommendationPolicy(process.cwd());
  const firstResult = await runRecommendationAiReview({
    projectRoot,
    policy,
    report,
    host: "copilot-vscode",
    apply: false,
  });
  const secondResult = await runRecommendationAiReview({
    projectRoot,
    policy,
    report,
    host: "copilot-vscode",
    apply: false,
  });

  assert.equal(firstResult.artifact.status, "completed");
  assert.deepEqual(firstResult.artifact.hostReviews[0], {
    host: "copilot-vscode",
    acceptedAssetIds: [],
    questionable: [],
    suppressedAssetIds: [],
    rerank: [],
  });
  assert.deepEqual(
    secondResult.artifact.hostReviews[0],
    firstResult.artifact.hostReviews[0],
  );
});

void test("ai review input tolerates reports missing a requested host bucket", () => {
  const report = createRecommendationReport();
  delete (
    report.topByHost as Record<string, RecommendationEntry[] | undefined>
  )["copilot-vscode"];

  const input = buildRecommendationAiReviewInput(
    report,
    createDemandProfile(),
    {
      host: "copilot-vscode",
      reviewLimit: 2,
    },
  );

  assert.deepEqual(input.demandSignals?.frameworks, ["apify"]);
  assert.deepEqual(input.hosts, [
    {
      host: "copilot-vscode",
      candidates: [],
    },
  ]);
});

function createRecommendationReport(): RecommendationReport {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policyVersion: 1,
    sessionIntent: "general",
    topByHost: {
      shared: [],
      "copilot-vscode": [
        createEntry("asset-a", 90),
        createEntry("asset-b", 100),
      ],
      opencode: [],
      cursor: [],
      zed: [],
      "claude-code": [],
      pi: [],
    },
    hostSummaries: {
      shared: createSummary("shared"),
      "copilot-vscode": createSummary("copilot-vscode"),
      opencode: createSummary("opencode"),
      cursor: createSummary("cursor"),
      zed: createSummary("zed"),
      "claude-code": createSummary("claude-code"),
      pi: createSummary("pi"),
    },
    suggestedBundles: [],
  };
}

function createEntry(assetId: string, score: number): RecommendationEntry {
  return {
    assetId,
    host: "copilot-vscode",
    rank: assetId === "asset-a" ? 1 : 2,
    score,
    reasons: ["fit:ecosystem"],
    assetKind: "skill" as const,
    sourceId: "fixture-source",
    sourceFamily: "fixture-source",
    availableLocally: false,
    recommendationBasis: "workspace-fit" as const,
    contextSizeClass: "small" as const,
    estimatedPromptWeight: 2,
    selectionStage: "top-by-host" as const,
    coverageTags: ["backend"],
    taskModes: ["implementation"],
    matchedSignals: [],
    scoreBreakdown: {
      authority: 10,
      compatibility: 10,
      portfolioFit: 10,
      trust: 10,
      sourcePriority: 10,
      demand: 10,
      hostPreference: 10,
      coverage: 0,
      diversity: 0,
      freshness: 0,
      costPenalty: 0,
      riskPenalty: 0,
      negativePenalty: 0,
      redundancyPenalty: 0,
      budgetPenalty: 0,
      total: score,
    },
  };
}

function createSummary(host: string): RecommendationHostSummary {
  return {
    host,
    recommendationLimit: 10,
    recommendationLimitSource: "policy",
    recommendationLimitOverrideMode: "preserve",
    recommendationLimitOverrideModeSource: "policy",
    activationBudget: 20,
    selectedCount: 0,
    totalEstimatedPromptWeight: 0,
    selectedAssetIds: [],
    byAssetKind: {},
    bySourceFamily: {},
    byConcern: {},
    concernBuckets: {},
    taskModeBuckets: {},
  };
}

function createDemandProfile(): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "C:/fixture",
    summary: {
      scannedFiles: 1,
      matchedFiles: 1,
    },
    signals: {
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: ["apify"],
      concerns: ["backend"],
      tooling: ["playwright"],
    },
    evidence: [
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: ["typescript"],
          packageManagers: ["npm"],
          frameworks: ["apify"],
          concerns: ["backend"],
          tooling: ["playwright"],
        },
      },
    ],
  };
}

function createCatalogEntries(): AssetCatalogEntry[] {
  return [
    {
      id: "asset-a",
      displayName: "Asset A",
      assetKind: "skill",
      hosts: ["copilot-vscode"],
      compatibilityMode: "native",
      source: {
        sourceId: "fixture-source",
        sourceKind: "repo",
        authorityTier: "trusted-community",
        sourcePriority: 10,
        originUrl: "https://github.com/example/asset-a",
        publisher: "fixture-source",
        publisherVerified: false,
      },
      trust: {
        score: 10,
        signals: ["community"],
      },
      capabilities: ["skill", "backend"],
      install: {
        method: "local-file",
        relativePath: "skills/asset-a.md",
      },
      evidence: {
        manifestFound: true,
        readmeFound: true,
        examplesFound: false,
        docsLinked: true,
        filePath: "skills/asset-a.md",
      },
      maintenance: {
        lastUpdated: new Date().toISOString(),
        stars: 1,
        releaseCadence: "test",
      },
      risk: {
        level: "low",
        hasHooks: false,
        hasExecScripts: false,
        requiresNetwork: false,
      },
      contextCost: {
        sizeClass: "small",
        estimatedPromptWeight: 2,
      },
      fit: {
        portfolioFit: 1,
        hostFit: 1,
      },
      dedupe: {
        candidateRankHint: "fixture",
      },
      status: {
        cataloged: true,
        mirrorEligible: true,
        installEligible: true,
        activationEligible: true,
      },
    },
    {
      id: "asset-b",
      displayName: "Asset B",
      assetKind: "skill",
      hosts: ["copilot-vscode"],
      compatibilityMode: "native",
      source: {
        sourceId: "fixture-source",
        sourceKind: "repo",
        authorityTier: "trusted-community",
        sourcePriority: 10,
        originUrl: "https://github.com/example/asset-b",
        publisher: "fixture-source",
        publisherVerified: false,
      },
      trust: {
        score: 10,
        signals: ["community"],
      },
      capabilities: ["skill", "backend", "apify"],
      install: {
        method: "local-file",
        relativePath: "skills/asset-b.md",
      },
      evidence: {
        manifestFound: true,
        readmeFound: true,
        examplesFound: false,
        docsLinked: true,
        filePath: "skills/asset-b.md",
      },
      maintenance: {
        lastUpdated: new Date().toISOString(),
        stars: 2,
        releaseCadence: "test",
      },
      risk: {
        level: "low",
        hasHooks: false,
        hasExecScripts: false,
        requiresNetwork: false,
      },
      contextCost: {
        sizeClass: "small",
        estimatedPromptWeight: 2,
      },
      fit: {
        portfolioFit: 1,
        hostFit: 1,
      },
      dedupe: {
        candidateRankHint: "fixture",
      },
      status: {
        cataloged: true,
        mirrorEligible: true,
        installEligible: true,
        activationEligible: true,
      },
    },
  ];
}

void test("ai review treats null model payloads as empty completed reviews", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-ai-review-string-failure-"),
  );
  const previousUrl = process.env.AGENT_HARNESS_AI_ENRICHMENT_URL;
  const previousKey = process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY;
  const previousOrigins =
    process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const originalFetch = globalThis.fetch;

  process.env.AGENT_HARNESS_AI_ENRICHMENT_URL = "https://example.com/ai-review";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_API_KEY = "secret";
  process.env.AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS =
    "https://example.com";
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  clearRuntimeConfigForTests();

  context.after(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_URL", previousUrl);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_API_KEY", previousKey);
    restoreEnv("AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS", previousOrigins);
    restoreEnv("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    clearRuntimeConfigForTests();
    await rm(projectRoot, { force: true, recursive: true });
  });

  const report = createRecommendationReport();
  await seedAiReviewProject(projectRoot, {
    report,
    demandProfile: createDemandProfile(),
    catalogEntries: createCatalogEntries(),
  });
  const policy = await loadRecommendationPolicy(process.cwd());

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: "null" } }] }),
      { status: 200 },
    );
  const completed = await runRecommendationAiReview({
    projectRoot,
    policy,
    report,
    host: "copilot-vscode",
    apply: false,
  });
  assert.equal(completed.artifact.status, "completed");
  assert.deepEqual(completed.artifact.hostReviews[0]?.acceptedAssetIds, []);
});

async function seedAiReviewProject(
  projectRoot: string,
  options: {
    report: RecommendationReport;
    demandProfile: DemandProfile | null;
    catalogEntries: AssetCatalogEntry[];
  },
): Promise<void> {
  await mkdir(join(projectRoot, "discover", "output"), { recursive: true });
  await mkdir(join(projectRoot, "recommend", "output"), { recursive: true });

  if (options.demandProfile) {
    await writeFile(
      join(projectRoot, "discover", "output", "demand-profile.json"),
      `${JSON.stringify(options.demandProfile, null, 2)}\n`,
      "utf8",
    );
  }

  await writeFile(
    join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
    `${options.catalogEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8",
  );
  await mkdir(join(projectRoot, "state"), { recursive: true });
  await writeFile(
    join(projectRoot, "state", "recommendations.json"),
    `${JSON.stringify(options.report, null, 2)}\n`,
    "utf8",
  );
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
