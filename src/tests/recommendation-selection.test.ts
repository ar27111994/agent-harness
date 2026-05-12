import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCandidateRecommendationBase,
  buildPolicySearchContext,
} from "../recommend/candidates.js";
import { buildTopRecommendationsForHost } from "../recommend/selection.js";
import { buildDemandContext } from "../recommend/signals.js";
import { buildSuggestedBundle } from "../recommend/summary.js";
import { isPublisherVerifiedForAuthorityTier } from "../source-metadata.js";
import type {
  CandidateRecommendationBase,
  DemandContext,
} from "../recommend/model.js";
import type {
  AssetCatalogEntry,
  DemandProfile,
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

  const recommendations = buildRecommendationsForTest(
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

  const recommendations = buildRecommendationsForTest(
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

void test("exact stack matches outrank generic concern overlap", () => {
  const policy = buildPolicy();
  policy.concernKeywordMap = {
    backend: ["backend"],
    integration: ["integration"],
    testing: ["testing"],
  };

  const demandContext = buildDemandContext(
    createDemandProfile([
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: ["javascript"],
          packageManagers: ["npm"],
          frameworks: ["apify"],
          concerns: [],
          tooling: ["npm:apify"],
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
          concerns: ["backend", "integration", "testing"],
          tooling: [],
        },
      },
    ]),
    policy,
  );

  const recommendations = buildRecommendationsForTest(
    "copilot-vscode",
    [
      buildCatalogEntry("generic-backend", "skill", 95, {
        capabilities: ["skill", "backend", "integration", "testing"],
        fit: { portfolioFit: 0.55, hostFit: 1 },
      }),
      buildCatalogEntry("apify-exact", "skill", 55, {
        capabilities: ["skill", "apify", "npm:apify"],
        fit: { portfolioFit: 0.55, hostFit: 1 },
      }),
    ],
    demandContext,
    policy,
  );

  assert.equal(recommendations[0]?.assetId, "apify-exact");
  assert.ok(recommendations[0]?.reasons.includes("fit:exact-stack"));
});

void test("wrapper-like assets do not claim exact-stack fit from generic aliases", () => {
  const policy = buildPolicy();
  policy.synonyms = { apify: ["automation"], documentation: ["docs"] };
  policy.concernKeywordMap = { automation: ["automation"] };

  const demandContext = buildDemandContext(
    createDemandProfile([
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: [],
          packageManagers: [],
          frameworks: ["apify"],
          concerns: ["automation"],
          tooling: [],
        },
      },
    ]),
    policy,
  );

  const recommendations = buildRecommendationsForTest(
    "copilot-vscode",
    [
      buildCatalogEntry("scenario-wrapper", "skill", 80, {
        capabilities: ["skill", "scenario", "automation", "docs"],
        fit: { portfolioFit: 0.55, hostFit: 1 },
      }),
    ],
    demandContext,
    policy,
  );

  assert.ok(!recommendations[0]?.reasons.includes("fit:exact-stack"));
  assert.ok(recommendations[0]?.reasons.includes("fit:generic-concern"));
});

void test("path tokens do not block exact-stack fit", () => {
  const policy = buildPolicy();

  const demandContext = buildDemandContext(
    createDemandProfile([
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: [],
          packageManagers: ["npm"],
          frameworks: ["apify"],
          concerns: [],
          tooling: ["npm:apify"],
        },
      },
    ]),
    policy,
  );

  const recommendations = buildRecommendationsForTest(
    "copilot-vscode",
    [
      buildCatalogEntry("apify-helper", "skill", 80, {
        capabilities: ["skill", "apify", "npm:apify"],
        evidenceFilePath: "docs/reference.yaml",
        fit: { portfolioFit: 0.55, hostFit: 1 },
        installRelativePath: "config/package.json",
      }),
    ],
    demandContext,
    policy,
  );

  assert.ok(recommendations[0]?.reasons.includes("fit:exact-stack"));
});

void test("canonicalized concern targets still enforce coverage goals", () => {
  const policy = buildPolicy({
    recommendationLimit: 1,
    targetConcerns: [{ concern: "backend", minimum: 1, weight: 200 }],
  });
  policy.concernKeywordMap = { backend: ["backend"] };
  policy.synonyms = { "node-backend": ["backend"] };

  const demandContext = buildDemandContext(
    createDemandProfile([
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: [],
          packageManagers: [],
          frameworks: [],
          concerns: ["backend"],
          tooling: [],
        },
      },
    ]),
    policy,
  );

  const recommendations = buildRecommendationsForTest(
    "copilot-vscode",
    [
      buildCatalogEntry("other-skill", "skill", 100, {
        capabilities: ["skill", "testing"],
        fit: { portfolioFit: 0.55, hostFit: 1 },
      }),
      buildCatalogEntry("backend-skill", "skill", 10, {
        capabilities: ["skill", "backend"],
        fit: { portfolioFit: 0.55, hostFit: 1 },
      }),
    ],
    demandContext,
    policy,
  );

  assert.equal(recommendations[0]?.assetId, "backend-skill");
  assert.ok(recommendations[0]?.reasons.includes("coverage-gap-fill"));
});

void test("local availability is surfaced separately from workspace fit", () => {
  const policy = buildPolicy();
  policy.concernKeywordMap = {
    frontend: ["frontend"],
    testing: ["testing"],
  };

  const demandContext = buildDemandContext(
    createDemandProfile([
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: ["typescript"],
          packageManagers: [],
          frameworks: ["react"],
          concerns: ["frontend", "testing"],
          tooling: ["playwright"],
        },
      },
    ]),
    policy,
  );

  const recommendations = buildRecommendationsForTest(
    "copilot-vscode",
    [
      buildCatalogEntry("local-generic-toolkit", "skill", 100, {
        authorityTier: "trusted-local",
        capabilities: ["skill", "automation", "workflow", "docs"],
        fit: { portfolioFit: 0.55, hostFit: 1 },
        sourceId: "local-cursor-config",
        sourceKind: "local-directory",
      }),
      buildCatalogEntry("community-react-testing", "skill", 45, {
        capabilities: ["skill", "react", "frontend", "playwright"],
        fit: { portfolioFit: 0.55, hostFit: 1 },
      }),
      buildCatalogEntry("local-react-snippets", "skill", 95, {
        authorityTier: "trusted-local",
        capabilities: ["skill", "react", "frontend", "typescript"],
        fit: { portfolioFit: 0.55, hostFit: 1 },
        sourceId: "local-cursor-config",
        sourceKind: "local-directory",
      }),
    ],
    demandContext,
    policy,
  );

  assert.equal(recommendations[0]?.assetId, "local-react-snippets");

  const localGeneric = recommendations.find(
    (entry) => entry.assetId === "local-generic-toolkit",
  );
  assert.equal(localGeneric?.availableLocally, true);
  assert.equal(localGeneric?.recommendationBasis, "local-availability");
  assert.ok(localGeneric?.reasons.includes("availability:local"));
  assert.ok(localGeneric?.reasons.includes("basis:local-availability"));

  const localExact = recommendations.find(
    (entry) => entry.assetId === "local-react-snippets",
  );
  assert.equal(localExact?.availableLocally, true);
  assert.equal(localExact?.recommendationBasis, "workspace-fit");
});

void test("weak-only concern demand does not force coverage-gap fill", () => {
  const policy = buildPolicy({
    recommendationLimit: 1,
    targetConcerns: [{ concern: "backend", minimum: 1, weight: 200 }],
  });
  policy.concernKeywordMap = { backend: ["backend"] };

  const demandContext = buildDemandContext(
    createDemandProfile([
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: [],
          packageManagers: ["npm"],
          frameworks: ["apify"],
          concerns: [],
          tooling: ["npm:apify"],
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
          concerns: ["backend"],
          tooling: [],
        },
      },
    ]),
    policy,
  );

  const recommendations = buildRecommendationsForTest(
    "copilot-vscode",
    [
      buildCatalogEntry("generic-backend", "skill", 95, {
        capabilities: ["skill", "backend"],
        fit: { portfolioFit: 0.55, hostFit: 1 },
      }),
      buildCatalogEntry("apify-exact", "skill", 55, {
        capabilities: ["skill", "apify", "npm:apify"],
        fit: { portfolioFit: 0.55, hostFit: 1 },
      }),
    ],
    demandContext,
    policy,
  );

  assert.equal(recommendations[0]?.assetId, "apify-exact");
  assert.ok(!recommendations[0]?.reasons.includes("coverage-gap-fill"));
});

function buildRecommendationsForTest(
  host: "copilot-vscode",
  entries: AssetCatalogEntry[],
  demandContext: DemandContext,
  policy: RecommendationPolicy,
): RecommendationEntry[] {
  const policyContext = buildPolicySearchContext(policy);
  const candidateBases = entries
    .map((entry) =>
      buildCandidateRecommendationBase(
        entry,
        demandContext,
        policy,
        policyContext,
      ),
    )
    .filter((base): base is CandidateRecommendationBase => base !== null);

  return buildTopRecommendationsForHost(
    host,
    candidateBases,
    demandContext,
    policy,
  );
}

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
  options: {
    authorityTier?: AssetCatalogEntry["source"]["authorityTier"];
    capabilities?: string[];
    duplicateGroup?: string;
    evidenceFilePath?: string;
    fit?: { portfolioFit: number; hostFit: number };
    installRelativePath?: string;
    sourceId?: string;
    sourceKind?: AssetCatalogEntry["source"]["sourceKind"];
  } = {},
): AssetCatalogEntry {
  const sourceId = options.sourceId ?? id;
  const authorityTier = options.authorityTier ?? "trusted-community";

  return {
    id,
    displayName: id,
    assetKind,
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId,
      authorityTier,
      sourceKind: options.sourceKind ?? "repo",
      sourcePriority,
      originUrl: `https://example.com/${id}`,
      publisher: sourceId,
      publisherVerified: isPublisherVerifiedForAuthorityTier(authorityTier),
    },
    trust: {
      score: sourcePriority,
      signals: [`authority:${authorityTier}`],
    },
    capabilities: options.capabilities ?? [assetKind, id],
    install: {
      method: "local-file",
      relativePath: options.installRelativePath,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: options.evidenceFilePath,
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
    fit: options.fit ?? { portfolioFit: 1, hostFit: 1 },
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
    availableLocally: false,
    recommendationBasis: "workspace-fit",
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
    packageManifestEntries: new Set<string>(),
    demandKeywords: new Set<string>(),
  };
}

function createDemandProfile(
  evidence: DemandProfile["evidence"],
): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "C:/fixture",
    summary: {
      scannedFiles: evidence.length,
      matchedFiles: evidence.length,
    },
    signals: {
      languages: [],
      packageManagers: [],
      frameworks: [],
      concerns: [],
      tooling: [],
    },
    evidence,
  };
}
