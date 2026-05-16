import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDemandContext,
  collectMatchedSignals,
} from "../recommend/signals.js";
import type {
  DemandProfile,
  RecommendationHostPolicy,
  RecommendationPolicy,
} from "../types.js";

void test("recommend signal weighting prefers strong evidence over repeated weak docs", () => {
  const profile: DemandProfile = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "C:/fixture",
    summary: {
      scannedFiles: 3,
      matchedFiles: 3,
    },
    signals: {
      languages: [],
      packageManagers: ["npm"],
      frameworks: ["apify"],
      concerns: ["integration"],
      tooling: [],
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
          concerns: [],
          tooling: [],
        },
      },
      {
        path: "README.md",
        fileName: "README.md",
        evidenceStrength: "weak",
        matchedSignals: {
          languages: [],
          packageManagers: [],
          frameworks: [],
          concerns: ["integration"],
          tooling: [],
        },
      },
      {
        path: "docs/setup.md",
        fileName: "setup.md",
        evidenceStrength: "weak",
        matchedSignals: {
          languages: [],
          packageManagers: [],
          frameworks: [],
          concerns: ["integration"],
          tooling: [],
        },
      },
    ],
  };

  const policy = buildPolicy();
  const demandContext = buildDemandContext(profile, policy);
  const matches = collectMatchedSignals(
    new Set(["apify", "integration"]),
    demandContext,
    policy,
  );

  const apifyMatch = matches.find((match) => match.term === "apify");
  const integrationMatch = matches.find(
    (match) => match.term === "integration",
  );

  assert.ok(apifyMatch);
  assert.ok(integrationMatch);
  assert.equal(apifyMatch.weightedEvidenceCount, 3);
  assert.deepEqual(apifyMatch.evidenceStrengthCounts, {
    strong: 1,
    medium: 0,
    weak: 0,
  });
  assert.equal(integrationMatch.evidenceCount, 2);
  assert.equal(integrationMatch.weightedEvidenceCount, 1);
  assert.deepEqual(integrationMatch.evidenceStrengthCounts, {
    strong: 0,
    medium: 0,
    weak: 2,
  });
  assert.ok(apifyMatch.weight > integrationMatch.weight);
});

void test("recommend demand context normalizes broader manifest prefixes", () => {
  const profile: DemandProfile = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "C:/fixture",
    summary: {
      scannedFiles: 1,
      matchedFiles: 1,
    },
    signals: {
      languages: [],
      packageManagers: [],
      frameworks: [],
      concerns: [],
      tooling: ["gradle:com.example.android", "cocoapods:AFNetworking"],
    },
    evidence: [],
  };

  const demandContext = buildDemandContext(profile, buildPolicy());

  assert.ok(demandContext.packageManifestEntries.has("com-example-android"));
  assert.ok(demandContext.packageManifestEntries.has("afnetworking"));
});

void test("recommend demand context keeps session intent signals without a demand profile", () => {
  const demandContext = buildDemandContext(null, buildPolicy(), "devops");

  assert.equal(demandContext.hasSignals, true);
  assert.ok(
    demandContext.terms.some((term) => term.canonicalTerm === "devops"),
  );
  assert.ok(demandContext.demandKeywords.has("kubernetes"));
});

void test("recommend signal helpers canonicalize search terms and add inferred task modes", async () => {
  const {
    buildCoverageTags,
    buildDuplicateGroup,
    buildSearchTerms,
    buildTaskModes,
    computeOutOfDomainPenalty,
    shouldEnforceConcernTarget,
  } = await import("../recommend/signals.js");

  const policy = buildPolicy();
  policy.concernKeywordMap = {
    backend: ["api", "service"],
    integration: ["workflow"],
    docs: ["guide"],
  };
  policy.taskModeKeywordMap = {
    automation: ["workflow"],
    research: ["guide"],
  };
  policy.domainKeywordGroups = {
    mobile: ["android"],
    backend: ["api"],
  };
  policy.synonyms = {
    backend: ["api-services"],
  };

  const demandContext = buildDemandContext(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scanRoot: "C:/fixture",
      summary: { scannedFiles: 1, matchedFiles: 1 },
      signals: {
        languages: [],
        packageManagers: [],
        frameworks: [],
        concerns: ["backend"],
        tooling: [],
      },
      evidence: [
        {
          path: "README.md",
          fileName: "README.md",
          evidenceStrength: "medium",
          matchedSignals: {
            languages: [],
            packageManagers: [],
            frameworks: [],
            concerns: ["backend"],
            tooling: [],
          },
        },
      ],
    },
    policy,
    ["backend", "docs"],
  );

  const searchTerms = buildSearchTerms(
    ["API services", "Workflow guide", "mobile/android"],
    policy,
  );
  const matchedSignals = collectMatchedSignals(
    searchTerms,
    demandContext,
    policy,
  );
  const concernTermSets = new Map(
    Object.entries(policy.concernKeywordMap).map(([key, values]) => [
      key,
      buildSearchTerms(values, policy),
    ]),
  );
  const taskModeTermSets = new Map(
    Object.entries(policy.taskModeKeywordMap).map(([key, values]) => [
      key,
      buildSearchTerms(values, policy),
    ]),
  );
  const domainGroupTermSets = new Map(
    Object.entries(policy.domainKeywordGroups).map(([key, values]) => [
      key,
      buildSearchTerms(values, policy),
    ]),
  );

  const coverageTags = buildCoverageTags(
    searchTerms,
    matchedSignals,
    concernTermSets,
  );
  const taskModes = buildTaskModes(
    searchTerms,
    coverageTags,
    matchedSignals,
    taskModeTermSets,
    { sizeClass: "small", estimatedPromptWeight: 2 },
  );

  assert.ok(searchTerms.has("backend"));
  assert.ok(searchTerms.has("workflow"));
  assert.deepEqual(coverageTags, ["backend", "docs", "integration"]);
  assert.deepEqual(taskModes, [
    "automation",
    "broad",
    "focused",
    "implementation",
    "research",
  ]);
  assert.equal(
    buildDuplicateGroup("skill", matchedSignals, coverageTags),
    "skill:backend",
  );
  assert.equal(
    buildDuplicateGroup("skill", [], coverageTags, "existing-group"),
    "existing-group",
  );
  assert.equal(
    computeOutOfDomainPenalty(
      searchTerms,
      demandContext,
      domainGroupTermSets,
      7,
    ),
    14,
  );
  assert.equal(
    shouldEnforceConcernTarget("api-services", demandContext, policy),
    true,
  );
});

void test("recommend signal weighting preserves zero-weight evidence buckets", () => {
  const matches = collectMatchedSignals(
    new Set(["placeholder"]),
    {
      terms: [
        {
          key: "concerns:placeholder",
          canonicalTerm: "placeholder",
          signalType: "concerns",
          evidenceCount: 0,
          evidenceStrengthCounts: {
            strong: 0,
            medium: 0,
            weak: 0,
          },
          matchTerms: new Set(["placeholder"]),
        },
      ],
      hasSignals: true,
      activeDomainGroups: new Set<string>(),
      packageManifestEntries: new Set<string>(),
      demandKeywords: new Set(["placeholder"]),
    },
    buildPolicy(),
  );

  assert.equal(matches[0]?.weightedEvidenceCount, 0);
  assert.equal(matches[0]?.weight, 1);
});

function buildPolicy(): RecommendationPolicy {
  const hostPolicy: RecommendationHostPolicy = {
    recommendationLimit: 20,
    activationBudget: 20,
    suggestedBundleId: "test-bundle",
    fallbackSkillCount: 5,
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
  };

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
      riskLevelPenalties: {
        low: 0,
        medium: 1,
        high: 2,
      },
      riskFlagPenalties: {
        hasHooks: 1,
        hasExecScripts: 1,
        requiresNetwork: 1,
      },
      freshness: {
        recentDays: 30,
        recentBoost: 0,
        staleDays: 365,
        stalePenalty: 0,
        unknownPenalty: 0,
      },
      genericCapabilityPenalty: 0,
      lowFitPenaltyThreshold: 0.25,
      lowFitPenalty: 5,
      weakDemandPenalty: 5,
      outOfDomainGroupPenalty: 5,
      coverageGainWeight: 0,
      sourceDiversityBonus: 0,
      overlapPenalty: 0,
      demandTermMultipliers: {},
    },
    hosts: {
      "copilot-vscode": hostPolicy,
      opencode: hostPolicy,
      shared: hostPolicy,
      cursor: hostPolicy,
      zed: hostPolicy,
      "claude-code": hostPolicy,
      pi: hostPolicy,
    },
    concernKeywordMap: {},
    taskModeKeywordMap: {},
    domainKeywordGroups: {},
    synonyms: {},
  };
}
