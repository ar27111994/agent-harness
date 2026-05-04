import assert from "node:assert/strict";
import test from "node:test";

import { buildTopRecommendationsForHost } from "../recommend/selection.js";
import { buildSuggestedBundle } from "../recommend/summary.js";
import type {
  AssetCatalogEntry,
  RecommendationEntry,
  RecommendationPolicy,
} from "../types.js";

void test("recommendation preselection preserves minimum counts above one", () => {
  const policy = buildPolicy({
    recommendationLimit: 3,
    targetAssetKinds: [{ assetKind: "skill", minimum: 2, weight: 500 }],
  });
  const entries = [
    buildCatalogEntry("skill-a", "skill", 100),
    buildCatalogEntry("skill-b", "skill", 90),
    ...Array.from({ length: 260 }, (_, index) =>
      buildCatalogEntry(`instruction-${index}`, "instruction", 1_000 - index),
    ),
  ];

  const recommendations = buildTopRecommendationsForHost(
    "copilot-vscode",
    entries,
    createEmptyDemandContext(),
    policy,
  );

  assert.ok(
    recommendations.filter((entry) => entry.assetKind === "skill").length >= 2,
  );
});

void test("recommendation fallback keeps source-family and duplicate caps", () => {
  const policy = buildPolicy({
    recommendationLimit: 4,
    maxPerSourceFamily: 1,
    maxPerDuplicateGroup: 1,
  });
  const entries = [
    buildCatalogEntry("same-a", "skill", 100, {
      sourceId: "same",
      duplicateGroup: "same-group",
    }),
    buildCatalogEntry("same-b", "skill", 95, {
      sourceId: "same",
      duplicateGroup: "same-group",
    }),
    buildCatalogEntry("other-a", "skill", 80, { sourceId: "other-a" }),
  ];

  const recommendations = buildTopRecommendationsForHost(
    "copilot-vscode",
    entries,
    createEmptyDemandContext(),
    policy,
  );

  assert.equal(
    recommendations.filter((entry) => entry.sourceFamily === "same").length,
    1,
  );
  assert.equal(
    recommendations.filter((entry) => entry.duplicateGroup === "same-group")
      .length,
    1,
  );
});

void test("suggested bundle skips over-budget first recommendation", () => {
  const policy = buildPolicy({ recommendationLimit: 2, activationBudget: 5 });
  const bundle = buildSuggestedBundle(
    "copilot-vscode",
    [
      buildRecommendationEntry("oversized", 8),
      buildRecommendationEntry("small", 3),
    ],
    policy,
  );

  assert.deepEqual(bundle.assetIds, ["small"]);
  assert.equal(bundle.estimatedPromptWeight, 3);
});

function buildPolicy(
  overrides: Partial<RecommendationPolicy["hosts"]["copilot-vscode"]> = {},
): RecommendationPolicy {
  return {
    schemaVersion: 1,
    scoring: {
      demandMatchCap: 20,
      portfolioFitMultiplier: 10,
      trustDivisor: 10,
      sourcePriorityDivisor: 10,
      authorityWeights: {
        "official-first-party": 100,
        "official-marketplace": 80,
        "official-compatible": 70,
        "trusted-local": 60,
        "trusted-community": 40,
        "unverified-community": 10,
      },
      compatibilityWeights: {
        native: 30,
        adaptable: 20,
        partial: 10,
        "reference-only": 5,
        incompatible: -100,
      },
      costPenalties: { tiny: 0, small: 1, medium: 2, large: 4 },
      demandSignalWeights: {
        languages: 1,
        packageManagers: 1,
        frameworks: 1,
        concerns: 1,
        tooling: 1,
      },
      riskLevelPenalties: { low: 0, medium: 2, high: 5 },
      riskFlagPenalties: { hasHooks: 1, hasExecScripts: 1, requiresNetwork: 1 },
      freshness: {
        recentDays: 30,
        recentBoost: 2,
        staleDays: 365,
        stalePenalty: 2,
        unknownPenalty: 0,
      },
      genericCapabilityPenalty: 0,
      lowFitPenaltyThreshold: 0,
      lowFitPenalty: 0,
      weakDemandPenalty: 0,
      outOfDomainGroupPenalty: 0,
      coverageGainWeight: 1,
      sourceDiversityBonus: 1,
      overlapPenalty: 1,
      demandTermMultipliers: {},
    },
    hosts: {
      "copilot-vscode": {
        recommendationLimit: 10,
        activationBudget: 100,
        suggestedBundleId: "test-bundle",
        maxPerSourceFamily: 100,
        maxPerDuplicateGroup: 100,
        maxPerAssetKind: {},
        targetAssetKinds: [],
        targetConcerns: [],
        suppressedAssetIdPatterns: [],
        suppressedCapabilityTerms: [],
        ...overrides,
      },
    } as RecommendationPolicy["hosts"],
    concernKeywordMap: {},
    taskModeKeywordMap: {},
    domainKeywordGroups: {},
    synonyms: {},
  };
}

function buildCatalogEntry(
  id: string,
  assetKind: AssetCatalogEntry["assetKind"],
  sourcePriority: number,
  options: { duplicateGroup?: string; sourceId?: string } = {},
): AssetCatalogEntry {
  const sourceId = options.sourceId ?? id;
  return {
    id,
    displayName: id,
    assetKind,
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId,
      authorityTier: "trusted-community",
      sourceKind: "repo",
      sourcePriority,
      originUrl: `https://example.com/${id}`,
      publisher: sourceId,
      publisherVerified: false,
    },
    trust: { score: sourcePriority, signals: [] },
    capabilities: [assetKind, id],
    install: { method: "local-file" },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
    },
    maintenance: {
      lastUpdated: new Date().toISOString(),
      stars: 0,
      releaseCadence: "test",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: { sizeClass: "tiny", estimatedPromptWeight: 1 },
    fit: { portfolioFit: 1, hostFit: 1 },
    dedupe: {
      duplicateGroup: options.duplicateGroup,
      candidateRankHint: "test",
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}

function buildRecommendationEntry(
  assetId: string,
  estimatedPromptWeight: number,
): RecommendationEntry {
  return {
    assetId,
    host: "copilot-vscode",
    rank: 1,
    score: 1,
    reasons: [],
    assetKind: "skill",
    sourceId: "test",
    sourceFamily: "test",
    contextSizeClass: "tiny",
    estimatedPromptWeight,
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
      freshness: 0,
      costPenalty: 0,
      riskPenalty: 0,
      negativePenalty: 0,
      redundancyPenalty: 0,
      budgetPenalty: 0,
      total: 1,
    },
  };
}

function createEmptyDemandContext() {
  return {
    terms: [],
    hasSignals: false,
    activeDomainGroups: new Set<string>(),
  };
}
