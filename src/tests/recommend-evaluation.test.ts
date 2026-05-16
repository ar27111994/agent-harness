import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecommendationEvaluationResult,
  buildRecommendationEvaluationSummary,
  classifyTopRecommendationConfidence,
} from "../recommend/evaluation.js";
import type {
  AssetCatalogEntry,
  DemandProfile,
  RecommendationEntry,
  RecommendationEvaluationFixtureResult,
  RecommendationPolicy,
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
      id: "ecosystem-fixture",
      passed: true,
      hostSummaries: [
        {
          host: "opencode",
          topAssetId: "ecosystem-asset",
          topReasons: ["fit:ecosystem"],
          topRecommendationBasis: "workspace-fit",
          topAvailableLocally: false,
          topConfidence: "medium-or-strong",
          topCoverageTags: ["backend"],
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
    fixtureCount: 4,
    passedFixtureCount: 3,
    failedFixtureCount: 1,
    evaluatedHostCount: 4,
    topReasonCounts: {
      exactStack: 1,
      ecosystem: 1,
      genericConcern: 1,
      none: 1,
    },
    broadFallbackTopCount: 1,
    localAvailabilityTopCount: 1,
    topConfidenceCounts: {
      mediumOrStrong: 2,
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
        matchedSignals: [],
      }),
    ),
    "none",
  );

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
            signalType: "frameworks",
            term: "fastapi",
            weight: 4,
            evidenceCount: 1,
            weightedEvidenceCount: 2,
            evidenceStrengthCounts: {
              strong: 0,
              medium: 1,
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

void test("recommend evaluation builds checks and host summaries from fixtures", () => {
  const evaluation = buildRecommendationEvaluationResult(
    [
      {
        schemaVersion: 1,
        id: "apify-ranking",
        description: "exact matches should outrank generic concern overlap",
        catalogEntries: [
          buildCatalogEntry("apify-exact", {
            capabilities: ["skill", "apify", "npm:apify", "backend"],
            sourceId: "apify-source",
          }),
          buildCatalogEntry("generic-backend", {
            capabilities: ["skill", "backend", "testing"],
            sourceId: "generic-source",
          }),
        ],
        demandProfile: createDemandProfile(),
        expectations: [
          {
            host: "copilot-vscode",
            requiredAssetIds: ["apify-exact"],
            forbiddenAssetIds: ["does-not-exist"],
            forbiddenTopAssetIds: ["missing-top-entry"],
            requiredAssetKinds: [{ assetKind: "skill", minimum: 2 }],
            maxPerSourceFamily: 1,
            requiredConcerns: ["backend"],
            rankedAbove: [
              {
                higherAssetId: "apify-exact",
                lowerAssetId: "generic-backend",
              },
            ],
          },
        ],
      },
    ],
    buildPolicy(),
  );

  assert.equal(evaluation.fixtures[0]?.passed, true);
  assert.equal(evaluation.summary.fixtureCount, 1);
  assert.equal(evaluation.summary.evaluatedHostCount, 1);

  const checks = evaluation.fixtures[0]?.checks ?? [];
  assert.ok(checks.every((check) => check.passed));
  assert.ok(
    checks.some(
      (check) =>
        check.name ===
          "copilot-vscode-rank-apify-exact-above-generic-backend" &&
        check.details === "higher rank 1, lower rank 2",
    ),
  );
  assert.ok(
    checks.some(
      (check) =>
        check.name === "copilot-vscode-bundle-budget" &&
        /bundle weight 2\/20/u.test(check.details),
    ),
  );

  assert.equal(
    evaluation.fixtures[0]?.hostSummaries[0]?.host,
    "copilot-vscode",
  );
  assert.equal(
    evaluation.fixtures[0]?.hostSummaries[0]?.topAssetId,
    "apify-exact",
  );
  assert.equal(
    evaluation.fixtures[0]?.hostSummaries[0]?.topRecommendationBasis,
    "workspace-fit",
  );
  assert.equal(
    evaluation.fixtures[0]?.hostSummaries[0]?.topConfidence,
    "medium-or-strong",
  );
  assert.deepEqual(evaluation.fixtures[0]?.hostSummaries[0]?.topCoverageTags, [
    "backend",
  ]);
  assert.ok(
    evaluation.fixtures[0]?.hostSummaries[0]?.topReasons.includes(
      "fit:exact-stack",
    ),
  );
  assert.ok(
    evaluation.fixtures[0]?.hostSummaries[0]?.topReasons.includes(
      "signal:frameworks:apify",
    ),
  );
});

void test("recommend evaluation records present and missing expectation details for ranked fixtures", () => {
  const policy = buildPolicy();
  policy.hosts["copilot-vscode"].maxPerSourceFamily = 10;

  const evaluation = buildRecommendationEvaluationResult(
    [
      {
        schemaVersion: 1,
        id: "detail-coverage",
        description: "covers expectation detail branches",
        catalogEntries: [
          buildCatalogEntry("apify-exact", {
            capabilities: ["skill", "apify", "npm:apify", "backend"],
            sourceId: "shared-source",
          }),
          buildCatalogEntry("blocked-top", {
            capabilities: ["skill", "backend"],
            sourceId: "shared-source",
          }),
        ],
        demandProfile: createDemandProfile(),
        expectations: [
          {
            host: "copilot-vscode",
            requiredAssetIds: ["apify-exact"],
            forbiddenAssetIds: ["blocked-top"],
            forbiddenTopAssetIds: ["blocked-top"],
            requiredConcerns: ["backend"],
            maxPerSourceFamily: 0,
          },
        ],
      },
    ],
    policy,
  );

  const checks = evaluation.fixtures[0]?.checks ?? [];
  assert.ok(
    checks.some(
      (check) =>
        check.name === "copilot-vscode-requires-apify-exact" &&
        check.details === "present" &&
        check.passed,
    ),
  );
  assert.ok(
    checks.some(
      (check) =>
        check.name === "copilot-vscode-forbids-blocked-top" &&
        /unexpectedly present/u.test(check.details) &&
        !check.passed,
    ),
  );
  assert.ok(
    checks.some(
      (check) =>
        check.name === "copilot-vscode-forbids-top-blocked-top" &&
        /unexpectedly present in top 10/u.test(check.details) &&
        !check.passed,
    ),
  );
  assert.ok(
    checks.some(
      (check) =>
        check.name === "copilot-vscode-source-diversity" &&
        /largest source family count/u.test(check.details) &&
        !check.passed,
    ),
  );
  assert.ok(
    checks.some(
      (check) =>
        check.name === "copilot-vscode-concern-backend" &&
        /present \d+ times/u.test(check.details) &&
        check.passed,
    ),
  );
});

void test("recommend evaluation reports missing bundles and absent ranks for unknown hosts", () => {
  const evaluation = buildRecommendationEvaluationResult(
    [
      {
        schemaVersion: 1,
        id: "missing-host",
        description: "unknown hosts should fail gracefully",
        catalogEntries: [buildCatalogEntry("apify-exact")],
        demandProfile: createDemandProfile(),
        expectations: [
          {
            host: "custom-host" as never,
            requiredAssetIds: ["apify-exact"],
            forbiddenAssetIds: ["apify-exact"],
            rankedAbove: [
              {
                higherAssetId: "apify-exact",
                lowerAssetId: "missing-entry",
              },
            ],
          },
        ],
      },
    ],
    buildPolicy(),
  );

  const fixture = evaluation.fixtures[0];
  assert.equal(fixture?.passed, false);
  assert.deepEqual(fixture?.hostSummaries, [
    {
      host: "custom-host",
      topAssetId: null,
      topReasons: [],
      topRecommendationBasis: null,
      topAvailableLocally: false,
      topConfidence: "none",
      topCoverageTags: [],
    },
  ]);
  assert.ok(
    fixture?.checks.some(
      (check) =>
        check.name === "custom-host-bundle-budget" &&
        check.details === "missing bundle" &&
        !check.passed,
    ),
  );
  assert.ok(
    fixture?.checks.some(
      (check) =>
        check.name === "custom-host-rank-apify-exact-above-missing-entry" &&
        /missing ranks higher=absent lower=absent/u.test(check.details),
    ),
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

function buildPolicy(): RecommendationPolicy {
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
        frameworks: 6,
        concerns: 1,
        tooling: 5,
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
      sourceDiversityBonus: 0,
      overlapPenalty: 0,
      demandTermMultipliers: {},
    },
    hosts: {
      shared: {
        recommendationLimit: 10,
        activationBudget: 20,
        suggestedBundleId: "shared-bundle",
        maxPerSourceFamily: 10,
        maxPerDuplicateGroup: 10,
        maxPerAssetKind: {},
        targetAssetKinds: [],
        targetConcerns: [],
        suppressedAssetIdPatterns: [],
        suppressedCapabilityTerms: [],
      },
      "copilot-vscode": {
        recommendationLimit: 10,
        activationBudget: 20,
        suggestedBundleId: "vscode-bundle",
        maxPerSourceFamily: 1,
        maxPerDuplicateGroup: 10,
        maxPerAssetKind: {},
        targetAssetKinds: [],
        targetConcerns: [],
        suppressedAssetIdPatterns: [],
        suppressedCapabilityTerms: [],
      },
      opencode: {
        recommendationLimit: 10,
        activationBudget: 20,
        suggestedBundleId: "opencode-bundle",
        maxPerSourceFamily: 10,
        maxPerDuplicateGroup: 10,
        maxPerAssetKind: {},
        targetAssetKinds: [],
        targetConcerns: [],
        suppressedAssetIdPatterns: [],
        suppressedCapabilityTerms: [],
      },
      cursor: {
        recommendationLimit: 10,
        activationBudget: 20,
        suggestedBundleId: "cursor-bundle",
        maxPerSourceFamily: 10,
        maxPerDuplicateGroup: 10,
        maxPerAssetKind: {},
        targetAssetKinds: [],
        targetConcerns: [],
        suppressedAssetIdPatterns: [],
        suppressedCapabilityTerms: [],
      },
      zed: {
        recommendationLimit: 10,
        activationBudget: 20,
        suggestedBundleId: "zed-bundle",
        maxPerSourceFamily: 10,
        maxPerDuplicateGroup: 10,
        maxPerAssetKind: {},
        targetAssetKinds: [],
        targetConcerns: [],
        suppressedAssetIdPatterns: [],
        suppressedCapabilityTerms: [],
      },
      "claude-code": {
        recommendationLimit: 10,
        activationBudget: 20,
        suggestedBundleId: "claude-code-bundle",
        maxPerSourceFamily: 10,
        maxPerDuplicateGroup: 10,
        maxPerAssetKind: {},
        targetAssetKinds: [],
        targetConcerns: [],
        suppressedAssetIdPatterns: [],
        suppressedCapabilityTerms: [],
      },
      pi: {
        recommendationLimit: 10,
        activationBudget: 20,
        suggestedBundleId: "pi-bundle",
        maxPerSourceFamily: 10,
        maxPerDuplicateGroup: 10,
        maxPerAssetKind: {},
        targetAssetKinds: [],
        targetConcerns: [],
        suppressedAssetIdPatterns: [],
        suppressedCapabilityTerms: [],
      },
    },
    concernKeywordMap: {
      backend: ["backend"],
    },
    taskModeKeywordMap: {},
    domainKeywordGroups: {},
    synonyms: {},
  };
}

function buildCatalogEntry(
  id: string,
  overrides: {
    capabilities?: string[];
    sourceId?: string;
  } = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: "skill",
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId: overrides.sourceId ?? id,
      authorityTier: "trusted-community",
      sourceKind: "repo",
      sourcePriority: 50,
      originUrl: `https://example.com/${id}`,
      publisher: overrides.sourceId ?? id,
      publisherVerified: false,
    },
    trust: {
      score: 40,
      signals: ["community"],
    },
    capabilities: overrides.capabilities ?? ["skill", id],
    install: {
      method: "local-file",
      relativePath: `${id}.md`,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: `${id}.md`,
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
      sizeClass: "tiny",
      estimatedPromptWeight: 1,
    },
    fit: {
      portfolioFit: 0.8,
      hostFit: 1,
    },
    dedupe: {
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
      languages: [],
      packageManagers: ["npm"],
      frameworks: ["apify"],
      concerns: ["backend"],
      tooling: ["npm:apify"],
    },
    evidence: [
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: [],
          packageManagers: ["npm"],
          frameworks: ["apify"],
          concerns: ["backend"],
          tooling: ["npm:apify"],
        },
      },
    ],
  };
}
