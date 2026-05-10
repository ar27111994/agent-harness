import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAiReviewToReport,
  buildRecommendationAiReviewInput,
} from "../recommend/ai-review.js";
import type {
  RecommendationAiReviewArtifact,
  RecommendationEntry,
  RecommendationHostSummary,
  RecommendationReport,
} from "../types.js";
import { loadRecommendationPolicy } from "../recommend/policy.js";

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
