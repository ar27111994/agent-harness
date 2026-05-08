import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecommendationEvaluationSummary,
  classifyTopRecommendationConfidence,
} from "../recommend/evaluation.js";
import type {
  RecommendationEntry,
  RecommendationEvaluationFixtureResult,
} from "../types.js";

void test("recommend evaluation summary tracks top-rank quality signals", () => {
  const summary = buildRecommendationEvaluationSummary([
    createFixtureResult({
      id: "exact-fixture",
      passed: true,
      hostSummaries: [
        {
          host: "copilot-vscode",
          topAssetId: "exact-asset",
          topReasons: ["fit:exact-stack"],
          topRecommendationBasis: "workspace-fit",
          topAvailableLocally: false,
          topConfidence: "medium-or-strong",
          topCoverageTags: ["integration"],
        },
      ],
    }),
    createFixtureResult({
      id: "fallback-fixture",
      passed: false,
      hostSummaries: [
        {
          host: "cursor",
          topAssetId: "generic-asset",
          topReasons: ["fit:generic-concern", "coverage-gap-fill"],
          topRecommendationBasis: "local-availability",
          topAvailableLocally: true,
          topConfidence: "weak-only",
          topCoverageTags: ["docs"],
        },
      ],
    }),
    createFixtureResult({
      id: "empty-fixture",
      passed: true,
      hostSummaries: [
        {
          host: "zed",
          topAssetId: null,
          topReasons: [],
          topRecommendationBasis: null,
          topAvailableLocally: false,
          topConfidence: "none",
          topCoverageTags: [],
        },
      ],
    }),
  ]);

  assert.deepEqual(summary, {
    fixtureCount: 3,
    passedFixtureCount: 2,
    failedFixtureCount: 1,
    evaluatedHostCount: 3,
    topReasonCounts: {
      exactStack: 1,
      ecosystem: 0,
      genericConcern: 1,
      none: 1,
    },
    broadFallbackTopCount: 1,
    localAvailabilityTopCount: 1,
    topConfidenceCounts: {
      mediumOrStrong: 1,
      weakOnly: 1,
      none: 1,
    },
  });
});

void test("top recommendation confidence distinguishes medium-or-strong, weak-only, and none", () => {
  assert.equal(classifyTopRecommendationConfidence(undefined), "none");

  assert.equal(
    classifyTopRecommendationConfidence(
      createRecommendationEntry({
        matchedSignals: [
          {
            signalType: "frameworks",
            term: "apify",
            weight: 6,
            evidenceCount: 1,
            weightedEvidenceCount: 3,
            evidenceStrengthCounts: {
              strong: 1,
              medium: 0,
              weak: 0,
            },
          },
        ],
      }),
    ),
    "medium-or-strong",
  );

  assert.equal(
    classifyTopRecommendationConfidence(
      createRecommendationEntry({
        matchedSignals: [
          {
            signalType: "concerns",
            term: "docs",
            weight: 1,
            evidenceCount: 2,
            weightedEvidenceCount: 1,
            evidenceStrengthCounts: {
              strong: 0,
              medium: 0,
              weak: 2,
            },
          },
        ],
      }),
    ),
    "weak-only",
  );
});

function createFixtureResult(
  overrides: Partial<RecommendationEvaluationFixtureResult> &
    Pick<
      RecommendationEvaluationFixtureResult,
      "id" | "passed" | "hostSummaries"
    >,
): RecommendationEvaluationFixtureResult {
  return {
    id: overrides.id,
    description: overrides.description ?? overrides.id,
    passed: overrides.passed,
    checks: overrides.checks ?? [],
    hostSummaries: overrides.hostSummaries,
  };
}

function createRecommendationEntry(
  overrides: Partial<RecommendationEntry>,
): RecommendationEntry {
  return {
    assetId: overrides.assetId ?? "asset",
    host: overrides.host ?? "copilot-vscode",
    rank: overrides.rank ?? 1,
    score: overrides.score ?? 10,
    reasons: overrides.reasons ?? [],
    assetKind: overrides.assetKind,
    sourceId: overrides.sourceId ?? "fixture-source",
    sourceFamily: overrides.sourceFamily ?? "fixture",
    availableLocally: overrides.availableLocally ?? false,
    recommendationBasis: overrides.recommendationBasis ?? "workspace-fit",
    contextSizeClass: overrides.contextSizeClass ?? "tiny",
    estimatedPromptWeight: overrides.estimatedPromptWeight ?? 1,
    duplicateGroup: overrides.duplicateGroup,
    selectionStage: "top-by-host",
    coverageTags: overrides.coverageTags ?? [],
    taskModes: overrides.taskModes ?? [],
    matchedSignals: overrides.matchedSignals ?? [],
    scoreBreakdown: overrides.scoreBreakdown ?? {
      authority: 0,
      compatibility: 0,
      portfolioFit: 0,
      trust: 0,
      sourcePriority: 0,
      demand: 0,
      hostPreference: 0,
      coverage: 0,
      diversity: 0,
      freshness: 0,
      costPenalty: 0,
      riskPenalty: 0,
      negativePenalty: 0,
      redundancyPenalty: 0,
      budgetPenalty: 0,
      total: 10,
    },
  };
}
