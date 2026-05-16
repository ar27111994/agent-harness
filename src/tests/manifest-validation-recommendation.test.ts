import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRecommendationHostPolicyOverride,
  assertRecommendationPolicy,
  assertRecommendationPolicyBaseOverride,
  assertRecommendationReport,
} from "../manifest-validation/recommendation.js";
import type { RecommendationPolicy, RecommendationReport } from "../types.js";

void test("recommendation manifest validation applies report defaults for optional fields", () => {
  const report = createRecommendationReport();
  delete (
    report.topByHost["copilot-vscode"][0] as { availableLocally?: boolean }
  ).availableLocally;
  delete (
    report.topByHost["copilot-vscode"][0] as {
      recommendationBasis?: string;
    }
  ).recommendationBasis;
  delete (
    report.hostSummaries["copilot-vscode"] as {
      recommendationLimitOverrideMode?: string;
    }
  ).recommendationLimitOverrideMode;
  delete (
    report.hostSummaries["copilot-vscode"] as {
      recommendationLimitOverrideModeSource?: string;
    }
  ).recommendationLimitOverrideModeSource;
  delete (report as { sessionIntent?: string }).sessionIntent;

  assert.doesNotThrow(() => assertRecommendationReport(report, "report"));
  assert.equal(report.sessionIntent, "general");
  assert.equal(report.topByHost["copilot-vscode"][0]?.availableLocally, false);
  assert.equal(
    report.topByHost["copilot-vscode"][0]?.recommendationBasis,
    "workspace-fit",
  );
  assert.equal(
    report.hostSummaries["copilot-vscode"].recommendationLimitOverrideMode,
    "preserve",
  );
  assert.equal(
    report.hostSummaries["copilot-vscode"]
      .recommendationLimitOverrideModeSource,
    "policy",
  );
});

void test("recommendation manifest validation rejects malformed session intent arrays", () => {
  const singletonIntents = createRecommendationReport();
  singletonIntents.sessionIntents = ["general"];

  assert.throws(
    () => assertRecommendationReport(singletonIntents, "report"),
    /sessionIntents.*at least two intents/u,
  );

  const mismatchedIntents = createRecommendationReport();
  mismatchedIntents.sessionIntent = "general";
  mismatchedIntents.sessionIntents = ["frontend", "general"];

  assert.throws(
    () => assertRecommendationReport(mismatchedIntents, "report"),
    /sessionIntents\[0\].*must match sessionIntent/u,
  );
});

void test("recommendation report validation rejects missing required host buckets", () => {
  const missingTopByHost = createRecommendationReport() as unknown as {
    topByHost: Record<string, unknown>;
  };
  delete missingTopByHost.topByHost.shared;

  assert.throws(
    () => assertRecommendationReport(missingTopByHost, "report"),
    /topByHost.*missing expected host: shared/u,
  );

  const missingHostSummary = createRecommendationReport() as unknown as {
    hostSummaries: Record<string, unknown>;
  };
  delete missingHostSummary.hostSummaries.shared;

  assert.throws(
    () => assertRecommendationReport(missingHostSummary, "report"),
    /hostSummaries.*missing expected host: shared/u,
  );
});

void test("recommendation policy validators reject missing host policies and tolerate sparse base overrides", () => {
  const invalidPolicy = createRecommendationPolicy() as unknown as {
    hosts: Record<string, unknown>;
  };
  delete invalidPolicy.hosts.shared;

  assert.throws(
    () => assertRecommendationPolicy(invalidPolicy, "policy"),
    /hosts.*missing expected host: shared/u,
  );

  assert.doesNotThrow(() =>
    assertRecommendationPolicyBaseOverride(
      {
        schemaVersion: 1,
        synonyms: {
          backend: ["service"],
        },
      },
      "baseOverride",
    ),
  );

  assert.throws(
    () =>
      assertRecommendationPolicyBaseOverride(
        {
          schemaVersion: 1,
          scoring: {
            demandMatchCap: "not-a-number",
          },
        },
        "baseOverride",
      ),
    /baseOverride\.scoring/u,
  );
});

void test("recommendation policy validators accept preset refs and reject invalid override modes", () => {
  assert.doesNotThrow(() =>
    assertRecommendationPolicyBaseOverride(
      {
        schemaVersion: 1,
        hostDefaults: {
          recommendationLimit: 12,
          activationBudget: 100,
          suggestedBundleId: "default-bundle",
          recommendationLimitOverrideMode: "scale",
          recommendationLimitScaleFactor: 0.5,
          recommendationLimitScaledFields: ["maxPerAssetKind.skill"],
          maxPerSourceFamily: 4,
          maxPerDuplicateGroup: 2,
          maxPerAssetKind: {},
          targetAssetKinds: [
            {
              assetKind: "skill",
              minimum: 1,
              weight: 10,
            },
          ],
          targetConcerns: [
            {
              concern: "backend",
              minimum: 1,
              weight: 8,
            },
          ],
          suppressedAssetIdPatterns: ["legacy"],
          suppressedCapabilityTerms: ["forbidden"],
          deprioritizedPenalty: 3,
          deprioritizedAssetIdPatterns: ["slow"],
          deprioritizedCapabilityTerms: ["deprecated"],
          sourceSaturationFreeCount: 1,
          sourceSaturationPenaltyStep: 2,
        },
        presets: {
          targetAssetKinds: {
            frontend: [
              {
                assetKind: "skill",
                minimum: 1,
                weight: 9,
              },
            ],
          },
          targetConcerns: {
            backend: [
              {
                concern: "backend",
                minimum: 1,
                weight: 7,
              },
            ],
          },
        },
        concernKeywordMap: {
          backend: ["backend"],
        },
        taskModeKeywordMap: {
          automation: ["workflow"],
        },
        domainKeywordGroups: {
          backend: ["api"],
        },
        synonyms: {
          backend: ["service"],
        },
      },
      "baseOverride",
    ),
  );

  assert.doesNotThrow(() =>
    assertRecommendationHostPolicyOverride(
      {
        schemaVersion: 1,
        host: "copilot-vscode",
        presetRefs: {
          targetAssetKinds: ["frontend"],
          targetConcerns: ["backend"],
        },
        policy: {
          recommendationLimit: 12,
        },
      },
      "hostOverride",
    ),
  );

  const invalidPolicy = createRecommendationPolicy();
  invalidPolicy.hosts["copilot-vscode"].recommendationLimitOverrideMode =
    "invalid" as never;

  assert.throws(
    () => assertRecommendationPolicy(invalidPolicy, "policy"),
    /recommendationLimitOverrideMode must be one of: preserve, scale/u,
  );
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
        {
          assetId: "asset-a",
          host: "copilot-vscode",
          rank: 1,
          score: 10,
          reasons: ["fit:exact-stack"],
          assetKind: "skill",
          sourceId: "fixture-source",
          sourceFamily: "fixture-source",
          availableLocally: false,
          recommendationBasis: "workspace-fit",
          contextSizeClass: "small",
          estimatedPromptWeight: 2,
          selectionStage: "top-by-host",
          coverageTags: ["backend"],
          taskModes: ["implementation"],
          matchedSignals: [
            {
              term: "apify",
              signalType: "frameworks",
              weight: 6,
              evidenceCount: 2,
            },
          ],
          scoreBreakdown: {
            authority: 1,
            compatibility: 1,
            portfolioFit: 1,
            trust: 1,
            sourcePriority: 1,
            demand: 1,
            hostPreference: 1,
            coverage: 1,
            diversity: 1,
            freshness: 1,
            costPenalty: 0,
            riskPenalty: 0,
            negativePenalty: 0,
            redundancyPenalty: 0,
            budgetPenalty: 0,
            total: 8,
          },
        },
      ],
      opencode: [],
      cursor: [],
      zed: [],
      "claude-code": [],
      pi: [],
    },
    hostSummaries: Object.fromEntries(
      [
        "shared",
        "copilot-vscode",
        "opencode",
        "cursor",
        "zed",
        "claude-code",
        "pi",
      ].map((host) => [
        host,
        {
          host,
          recommendationLimit: 10,
          recommendationLimitSource: "policy",
          activationBudget: 20,
          selectedCount: host === "copilot-vscode" ? 1 : 0,
          totalEstimatedPromptWeight: host === "copilot-vscode" ? 2 : 0,
          selectedAssetIds: host === "copilot-vscode" ? ["asset-a"] : [],
          byAssetKind: {},
          bySourceFamily: {},
          byConcern: {},
          concernBuckets: {},
          taskModeBuckets: {},
        },
      ]),
    ) as RecommendationReport["hostSummaries"],
    suggestedBundles: [
      {
        host: "copilot-vscode",
        bundleId: "bundle-a",
        assetIds: ["asset-a"],
        estimatedPromptWeight: 2,
        concernBuckets: {
          backend: ["asset-a"],
        },
        taskModeBuckets: {
          implementation: ["asset-a"],
        },
      },
    ],
  };
}

function createRecommendationPolicy(): RecommendationPolicy {
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
      shared: createHostPolicy("shared"),
      "copilot-vscode": createHostPolicy("copilot-vscode"),
      opencode: createHostPolicy("opencode"),
      cursor: createHostPolicy("cursor"),
      zed: createHostPolicy("zed"),
      "claude-code": createHostPolicy("claude-code"),
      pi: createHostPolicy("pi"),
    },
    concernKeywordMap: {},
    taskModeKeywordMap: {},
    domainKeywordGroups: {},
    synonyms: {},
  };
}

function createHostPolicy(host: string) {
  return {
    recommendationLimit: 10,
    activationBudget: 20,
    suggestedBundleId: `${host}-bundle`,
    recommendationLimitOverrideMode: "preserve" as const,
    maxPerSourceFamily: 4,
    maxPerDuplicateGroup: 2,
    maxPerAssetKind: {},
    targetAssetKinds: [],
    targetConcerns: [],
    suppressedAssetIdPatterns: [],
    suppressedCapabilityTerms: [],
  };
}
