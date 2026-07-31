import assert from "node:assert/strict";
import test from "node:test";

import { countBy, countCoverageTagsFromEntries } from "../recommend/counts.js";
import {
  buildHostSummary,
  buildSuggestedBundle,
} from "../recommend/summary.js";
import type {
  RecommendationEntry,
  RecommendationHostPolicy,
  RecommendationPolicy,
} from "../types.js";

void test("recommend summary counts coverage tags and bucket summaries deterministically", () => {
  const entries = [
    createEntry("asset-a", {
      assetKind: "skill",
      sourceFamily: "community",
      coverageTags: ["backend", "testing"],
      taskModes: ["implementation", "validation"],
      estimatedPromptWeight: 2,
    }),
    createEntry("asset-b", {
      assetKind: "instruction",
      sourceFamily: "official",
      coverageTags: ["backend", "docs"],
      taskModes: ["research"],
      estimatedPromptWeight: 3,
    }),
    createEntry("asset-a", {
      rank: 3,
      assetKind: "skill",
      sourceFamily: "community",
      coverageTags: ["backend"],
      taskModes: ["implementation"],
      estimatedPromptWeight: 1,
    }),
  ];
  const policy = buildPolicy();

  assert.deepEqual(countCoverageTagsFromEntries(entries), {
    backend: 3,
    testing: 1,
    docs: 1,
  });
  assert.deepEqual(
    countBy(entries, (entry) => entry.sourceFamily),
    {
      community: 2,
      official: 1,
    },
  );

  const summary = buildHostSummary("copilot-vscode", entries, policy);

  assert.equal(summary.selectedCount, 3);
  assert.equal(summary.totalEstimatedPromptWeight, 6);
  assert.deepEqual(summary.selectedAssetIds, ["asset-a", "asset-b", "asset-a"]);
  assert.deepEqual(summary.byAssetKind, {
    skill: 2,
    instruction: 1,
  });
  assert.deepEqual(summary.bySourceFamily, {
    community: 2,
    official: 1,
  });
  assert.deepEqual(summary.byConcern, {
    backend: 3,
    testing: 1,
    docs: 1,
  });
  assert.deepEqual(summary.concernBuckets, {
    backend: ["asset-a", "asset-b"],
    docs: ["asset-b"],
    testing: ["asset-a"],
  });
  assert.deepEqual(summary.taskModeBuckets, {
    broad: ["asset-a", "asset-b"],
    focused: ["asset-a", "asset-b"],
    implementation: ["asset-a"],
    research: ["asset-b"],
    validation: ["asset-a"],
  });
});

void test("recommend suggested bundles skip over-budget entries and preserve broad buckets", () => {
  const policy = buildPolicy({ activationBudget: 5 });
  const entries = [
    createEntry("oversized", {
      estimatedPromptWeight: 8,
      coverageTags: ["backend"],
      taskModes: ["implementation"],
    }),
    createEntry("fits", {
      rank: 2,
      estimatedPromptWeight: 3,
      coverageTags: ["docs"],
      taskModes: ["research"],
    }),
    createEntry("also-fits", {
      rank: 3,
      estimatedPromptWeight: 2,
      coverageTags: ["testing"],
      taskModes: ["validation"],
    }),
  ];

  const bundle = buildSuggestedBundle("copilot-vscode", entries, policy);

  assert.deepEqual(bundle.assetIds, ["fits", "also-fits"]);
  assert.equal(bundle.estimatedPromptWeight, 5);
  assert.equal(bundle.activationBudget, 5);
  assert.deepEqual(bundle.budgetPrunedAssetIds, ["oversized"]);
  assert.deepEqual(bundle.budgetPrunedAssets, [
    {
      assetId: "oversized",
      estimatedPromptWeight: 8,
      remainingBudget: 5,
      reason: "estimated prompt weight 8 exceeds remaining activation budget 5",
    },
  ]);
  assert.deepEqual(bundle.concernBuckets, {
    docs: ["fits"],
    testing: ["also-fits"],
  });
  assert.deepEqual(bundle.taskModeBuckets, {
    broad: ["also-fits", "fits"],
    focused: ["also-fits", "fits"],
    research: ["fits"],
    validation: ["also-fits"],
  });
});

void test("recommend summary buckets missing asset kinds under unknown", () => {
  const summary = buildHostSummary(
    "copilot-vscode",
    [
      {
        assetId: "unknown-kind",
        host: "copilot-vscode",
        rank: 1,
        score: 10,
        reasons: [],
        assetKind: undefined as RecommendationEntry["assetKind"],
        sourceId: "unknown-kind-source",
        sourceFamily: "community",
        availableLocally: false,
        recommendationBasis: "workspace-fit",
        contextSizeClass: "small",
        estimatedPromptWeight: 1,
        duplicateGroup: undefined,
        selectionStage: "top-by-host",
        coverageTags: [],
        taskModes: [],
        matchedSignals: [],
        scoreBreakdown: {
          authority: 0,
          compatibility: 0,
          portfolioFit: 0,
          trust: 0,
          sourcePriority: 0,
          demand: 0,
          hostPreference: 0,
          coverage: 0,
          diversity: 0,
          assetKindDiversityPenalty: 0,
          freshness: 0,
          costPenalty: 0,
          riskPenalty: 0,
          negativePenalty: 0,
          ecosystemMismatchPenalty: 0,
          redundancyPenalty: 0,
          budgetPenalty: 0,
          total: 10,
        },
      },
    ],
    buildPolicy(),
  );

  assert.deepEqual(summary.byAssetKind, { unknown: 1 });
});

function buildPolicy(
  overrides: Partial<RecommendationHostPolicy> = {},
): RecommendationPolicy {
  const hostPolicy: RecommendationHostPolicy = {
    recommendationLimit: 10,
    activationBudget: overrides.activationBudget ?? 20,
    suggestedBundleId: "test-bundle",
    fallbackSkillCount: 3,
    maxPerSourceFamily: 10,
    maxPerDuplicateGroup: 10,
    maxPerAssetKind: {},
    targetAssetKinds: [],
    targetConcerns: [],
    suppressedAssetIdPatterns: [],
    suppressedCapabilityTerms: [],
    deprioritizedAssetIdPatterns: [],
    deprioritizedCapabilityTerms: [],
    sourceSaturationFreeCount: 10,
    sourceSaturationPenaltyStep: 1,
    ...overrides,
  };

  return {
    schemaVersion: 1,
    scoring: {
      demandMatchCap: 10,
      portfolioFitMultiplier: 10,
      trustDivisor: 10,
      sourcePriorityDivisor: 10,
      authorityWeights: {
        "official-first-party": 10,
        "official-marketplace": 9,
        "official-compatible": 8,
        "trusted-local": 7,
        "trusted-community": 6,
        "unverified-community": 5,
      },
      compatibilityWeights: {
        native: 5,
        adaptable: 4,
        partial: 3,
        "reference-only": 2,
        incompatible: -100,
      },
      costPenalties: { tiny: 0, small: 1, medium: 2, large: 3 },
      demandSignalWeights: {
        languages: 1,
        packageManagers: 1,
        frameworks: 1,
        concerns: 1,
        tooling: 1,
      },
      riskLevelPenalties: { low: 0, medium: 1, high: 2 },
      riskFlagPenalties: {
        hasHooks: 1,
        hasExecScripts: 1,
        requiresNetwork: 1,
      },
      freshness: {
        recentDays: 30,
        recentBoost: 1,
        staleDays: 365,
        stalePenalty: 1,
        unknownPenalty: 1,
      },
      genericCapabilityPenalty: 1,
      lowFitPenaltyThreshold: 0.2,
      lowFitPenalty: 1,
      weakDemandPenalty: 1,
      outOfDomainGroupPenalty: 1,
      ecosystemMismatchPenalty: 0,
      coverageGainWeight: 1,
      sourceDiversityBonus: 1,
      assetKindDiversityPenalty: 5,
      overlapPenalty: 1,
      demandTermMultipliers: {},
    },
    hosts: {
      shared: hostPolicy,
      "copilot-vscode": hostPolicy,
      opencode: hostPolicy,
      cursor: hostPolicy,
      zed: hostPolicy,
      "claude-code": hostPolicy,
      pi: hostPolicy,
      codex: hostPolicy,
    },
    concernKeywordMap: {},
    taskModeKeywordMap: {},
    domainKeywordGroups: {},
    synonyms: {},
  };
}

function createEntry(
  assetId: string,
  overrides: Partial<RecommendationEntry> = {},
): RecommendationEntry {
  return {
    assetId,
    host: overrides.host ?? "copilot-vscode",
    rank: overrides.rank ?? 1,
    score: overrides.score ?? 10,
    reasons: overrides.reasons ?? [],
    assetKind: overrides.assetKind ?? "skill",
    sourceId: overrides.sourceId ?? `${assetId}-source`,
    sourceFamily: overrides.sourceFamily ?? "community",
    availableLocally: overrides.availableLocally ?? false,
    recommendationBasis: overrides.recommendationBasis ?? "workspace-fit",
    contextSizeClass: overrides.contextSizeClass ?? "small",
    estimatedPromptWeight: overrides.estimatedPromptWeight ?? 1,
    duplicateGroup: overrides.duplicateGroup,
    selectionStage: overrides.selectionStage ?? "top-by-host",
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
      assetKindDiversityPenalty: 0,
      freshness: 0,
      costPenalty: 0,
      riskPenalty: 0,
      negativePenalty: 0,
      ecosystemMismatchPenalty: 0,
      redundancyPenalty: 0,
      budgetPenalty: 0,
      total: overrides.score ?? 10,
    },
  };
}
