import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCandidateRecommendation,
  buildCandidateRecommendationBase,
  buildPolicySearchContext,
  computeEntryPreselectionScore,
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

void test("specialized gates suppress non-mcp assets without matching demand", () => {
  const policy = buildPolicy();
  const demandContext = createEmptyDemandContext();
  const policyContext = buildPolicySearchContext(policy);

  const firebaseSkill = buildCandidateRecommendationBase(
    buildCatalogEntry("firebase-helper", "skill", 80, {
      capabilities: ["skill", "firebase"],
    }),
    demandContext,
    policy,
    policyContext,
  );
  const firebaseServer = buildCandidateRecommendationBase(
    buildCatalogEntry("firebase-mcp", "mcp-server", 80, {
      capabilities: ["mcp-server", "firebase"],
    }),
    demandContext,
    policy,
    policyContext,
  );

  assert.equal(firebaseSkill, null);
  assert.notEqual(firebaseServer, null);
});

void test("design-system demand suppresses generic mobile-only assets", () => {
  const policy = buildPolicy();
  const demandContext = {
    ...createEmptyDemandContext(),
    demandKeywords: new Set(["penpot"]),
    packageManagers: new Set<string>(),
  };

  const base = buildCandidateRecommendationBase(
    buildCatalogEntry("mobile-only", "skill", 50, {
      capabilities: ["skill", "mobile", "android"],
    }),
    demandContext,
    policy,
    buildPolicySearchContext(policy),
  );

  assert.equal(base, null);
});

void test("dependency self-echo and host suppression remove low-value candidates", () => {
  const policy = buildPolicy({
    suppressedAssetIdPatterns: ["suppressed"],
    suppressedCapabilityTerms: ["forbidden-term"],
  });
  const demandContext = {
    ...createEmptyDemandContext(),
    packageManifestEntries: new Set(["npm-echo-package"]),
  };
  const policyContext = buildPolicySearchContext(policy);

  const selfEchoBase = buildCandidateRecommendationBase(
    buildCatalogEntry("echo-package", "skill", 50, {
      capabilities: ["skill", "backend"],
      sourceKind: "package-registry",
      manifestEntry: "npm:echo-package",
    }),
    demandContext,
    policy,
    policyContext,
  );
  const suppressedBase = buildCandidateRecommendationBase(
    buildCatalogEntry("suppressed-skill", "skill", 50, {
      capabilities: ["skill", "forbidden-term"],
    }),
    createEmptyDemandContext(),
    policy,
    policyContext,
  );

  assert.equal(selfEchoBase, null);
  assert.notEqual(suppressedBase, null);
  assert.equal(
    buildCandidateRecommendation(
      suppressedBase as CandidateRecommendationBase,
      "copilot-vscode",
      createEmptyDemandContext(),
      policy,
    ),
    null,
  );
});

void test("host deprioritization penalties and stale metadata affect recommendation totals", () => {
  const policy = buildPolicy({
    deprioritizedPenalty: 9,
    deprioritizedAssetIdPatterns: ["slow"],
  });
  const demandContext = createEmptyDemandContext();
  const policyContext = buildPolicySearchContext(policy);
  const base = buildCandidateRecommendationBase(
    buildCatalogEntry("slow-legacy-tool", "skill", 60, {
      capabilities: ["skill", "typescript", "backend"],
      publisher: "",
      sourceId: "slow-legacy-tool",
      sourceKind: "local-directory",
      authorityTier: "trusted-local",
      lastUpdated: "2000-01-01T00:00:00.000Z",
    }),
    demandContext,
    policy,
    policyContext,
  );

  assert.notEqual(base, null);
  assert.equal(base?.sourceFamily, "slow-legacy-tool");
  assert.equal(base?.recommendationBasis, "local-availability");
  assert.ok((base?.breakdown.freshness ?? 0) < 0);

  const candidate = buildCandidateRecommendation(
    base as CandidateRecommendationBase,
    "copilot-vscode",
    demandContext,
    policy,
  );

  assert.notEqual(candidate, null);
  assert.equal(
    candidate?.breakdown.negativePenalty,
    (base?.breakdown.negativePenalty ?? 0) + 9,
  );
  assert.ok((candidate?.breakdown.total ?? 0) < (base?.breakdown.total ?? 0));
});

void test("selection preserves recommendations without classification metadata", () => {
  const policy = buildPolicy({ recommendationLimit: 1 });
  const recommendations = buildRecommendationsForTest(
    "copilot-vscode",
    [buildCatalogEntry("plain-skill", "skill", 100)],
    createEmptyDemandContext(),
    policy,
  );

  assert.equal(recommendations[0]?.assetId, "plain-skill");
  const classifiedRecommendations = buildRecommendationsForTest(
    "copilot-vscode",
    [
      buildCatalogEntry("classified-skill", "skill", 100, {
        classification: {
          assetKind: "skill",
          confidence: 0.9,
          level: "strong",
          evidence: [],
        },
      }),
    ],
    createEmptyDemandContext(),
    policy,
  );
  assert.equal(classifiedRecommendations[0]?.classificationConfidence, 0.9);
  assert.equal(
    classifiedRecommendations[0]?.classificationConfidenceLevel,
    "strong",
  );
  assert.equal(recommendations[0]?.classificationConfidence, undefined);
  assert.equal(recommendations[0]?.classificationConfidenceLevel, undefined);
});

void test("selection enforces duplicate-group caps across different source families", () => {
  const policy = buildPolicy({
    recommendationLimit: 2,
    maxPerSourceFamily: 5,
    maxPerDuplicateGroup: 1,
  });

  const recommendations = buildRecommendationsForTest(
    "copilot-vscode",
    [
      buildCatalogEntry("duplicate-a", "skill", 100, {
        sourceId: "family-a",
        duplicateGroup: "backend-group",
      }),
      buildCatalogEntry("duplicate-b", "skill", 99, {
        sourceId: "family-b",
        duplicateGroup: "backend-group",
      }),
      buildCatalogEntry("unique-c", "skill", 80, {
        sourceId: "family-c",
      }),
    ],
    createEmptyDemandContext(),
    policy,
  );

  assert.equal(
    recommendations.filter((entry) => entry.duplicateGroup === "backend-group")
      .length,
    1,
  );
});

void test("selection prefers lower prompt weight and then stable ids on score ties", () => {
  const policy = buildPolicy({ recommendationLimit: 2, activationBudget: 6 });
  const recommendations = buildRecommendationsForTest(
    "copilot-vscode",
    [
      buildCatalogEntry("z-heavy", "skill", 90, {
        capabilities: ["skill", "backend", "apify"],
        fit: { portfolioFit: 0.55, hostFit: 1 },
        installRelativePath: "heavy.md",
      }),
      buildCatalogEntry("a-light", "skill", 90, {
        capabilities: ["skill", "backend", "apify"],
        fit: { portfolioFit: 0.55, hostFit: 1 },
      }),
      buildCatalogEntry("m-light", "skill", 90, {
        capabilities: ["skill", "backend", "apify"],
        fit: { portfolioFit: 0.55, hostFit: 1 },
      }),
    ].map((entry) =>
      entry.id === "z-heavy"
        ? {
            ...entry,
            contextCost: { sizeClass: "large", estimatedPromptWeight: 9 },
          }
        : {
            ...entry,
            contextCost: { sizeClass: "tiny", estimatedPromptWeight: 1 },
          },
    ),
    buildDemandContext(
      createDemandProfile([
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
      ]),
      policy,
    ),
    policy,
  );

  assert.deepEqual(
    recommendations.map((entry) => entry.assetId),
    ["a-light", "m-light"],
  );
});

void test("candidate base creation can build its own policy context and preserves signal evidence snapshots", () => {
  const policy = buildPolicy();
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
          concerns: ["backend"],
          tooling: ["npm:apify"],
        },
      },
    ]),
    policy,
  );

  const base = buildCandidateRecommendationBase(
    buildCatalogEntry("apify-helper", "skill", 80, {
      capabilities: ["skill", "apify", "backend", "npm:apify"],
      fit: { portfolioFit: 0.55, hostFit: 1 },
    }),
    demandContext,
    policy,
  );

  assert.notEqual(base, null);
  assert.ok((base?.matchedSignals.length ?? 0) > 0);
  const evidenceCounts = base?.matchedSignals[0]?.evidenceStrengthCounts;
  assert.ok(evidenceCounts);
  if (!evidenceCounts) {
    throw new Error("expected evidence counts");
  }
  const originalStrongCount = evidenceCounts.strong;
  const candidate = buildCandidateRecommendation(
    base as CandidateRecommendationBase,
    "copilot-vscode",
    demandContext,
    policy,
  );
  const candidateEvidenceCounts =
    candidate?.matchedSignals[0]?.evidenceStrengthCounts;
  assert.ok(candidateEvidenceCounts);
  if (!candidateEvidenceCounts) {
    throw new Error("expected candidate evidence counts");
  }
  candidateEvidenceCounts.strong = 999;
  assert.equal(
    base?.matchedSignals[0]?.evidenceStrengthCounts?.strong,
    originalStrongCount,
  );
});

void test("candidate scoring applies individual risk flag penalties", () => {
  const policy = buildPolicy();
  policy.scoring.riskFlagPenalties = {
    hasHooks: 3,
    hasExecScripts: 5,
    requiresNetwork: 7,
  };
  const policyContext = buildPolicySearchContext(policy);
  const riskyEntry = buildCatalogEntry("risky-entry", "skill", 50);
  riskyEntry.risk.hasHooks = true;
  riskyEntry.risk.hasExecScripts = true;
  riskyEntry.risk.requiresNetwork = true;

  const base = buildCandidateRecommendationBase(
    riskyEntry,
    createEmptyDemandContext(),
    policy,
    policyContext,
  );

  assert.equal(base?.breakdown.riskPenalty, 15);
});

void test("host deprioritization defaults to empty pattern lists and applies configured penalties", () => {
  const policy = buildPolicy({
    deprioritizedPenalty: 11,
  });
  const entry = buildCatalogEntry("neutral-entry", "skill", 50, {
    capabilities: ["skill", "neutral"],
  });
  const policyContext = buildPolicySearchContext(policy);
  const base = buildCandidateRecommendationBase(
    entry,
    createEmptyDemandContext(),
    policy,
    policyContext,
  );
  assert.ok(base);

  const neutralCandidate = buildCandidateRecommendation(
    base,
    "copilot-vscode",
    createEmptyDemandContext(),
    policy,
  );
  assert.equal(neutralCandidate?.breakdown.negativePenalty, 0);

  policy.hosts["copilot-vscode"].deprioritizedAssetIdPatterns = ["neutral"];
  const deprioritizedCandidate = buildCandidateRecommendation(
    base,
    "copilot-vscode",
    createEmptyDemandContext(),
    policy,
  );
  assert.equal(deprioritizedCandidate?.breakdown.negativePenalty, 11);
});

void test("candidate recommendations clone signal strength counts only when present", () => {
  const policy = buildPolicy();
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
          concerns: [],
          tooling: [],
        },
      },
    ]),
    policy,
  );
  const policyContext = buildPolicySearchContext(policy);
  const base = buildCandidateRecommendationBase(
    buildCatalogEntry("apify-entry", "skill", 50, {
      capabilities: ["skill", "apify"],
    }),
    demandContext,
    policy,
    policyContext,
  );
  assert.ok(base);
  delete base.matchedSignals[0]?.evidenceStrengthCounts;

  const candidate = buildCandidateRecommendation(
    base,
    "copilot-vscode",
    demandContext,
    policy,
  );

  assert.equal(candidate?.matchedSignals[0]?.term, "apify");
  assert.equal(candidate?.matchedSignals[0]?.evidenceStrengthCounts, undefined);
});

void test("preselection scoring penalizes medium and high risk entries differently", () => {
  const mediumRisk = buildCatalogEntry("medium-risk", "skill", 60, {
    fit: { portfolioFit: 0.5, hostFit: 0.5 },
  });
  mediumRisk.risk.level = "medium";

  const highRisk = buildCatalogEntry("high-risk", "skill", 60, {
    fit: { portfolioFit: 0.5, hostFit: 0.5 },
  });
  highRisk.risk.level = "high";

  assert.ok(
    computeEntryPreselectionScore(mediumRisk) >
      computeEntryPreselectionScore(highRisk),
  );
});

void test("host-suppressed candidates are excluded before selection", () => {
  const policy = buildPolicy({
    suppressedAssetIdPatterns: ["blocked"],
  });

  const recommendations = buildRecommendationsForTest(
    "copilot-vscode",
    [buildCatalogEntry("blocked-entry", "skill", 10)],
    createEmptyDemandContext(),
    policy,
  );

  assert.deepEqual(recommendations, []);
});

void test("zero minimum coverage targets still allow recommendation ranking to proceed", () => {
  const zeroMinimumPolicy = buildPolicy({
    recommendationLimit: 1,
    targetAssetKinds: [{ assetKind: "skill", minimum: 0, weight: 500 }],
  });

  const recommendations = buildRecommendationsForTest(
    "copilot-vscode",
    [buildCatalogEntry("skill-entry", "skill", 10)],
    createEmptyDemandContext(),
    zeroMinimumPolicy,
  );

  assert.equal(recommendations[0]?.assetId, "skill-entry");
});

void test("candidate freshness handles invalid and mid-age timestamps", () => {
  const policy = buildPolicy();
  policy.scoring.freshness.unknownPenalty = 7;
  policy.scoring.freshness.recentBoost = 2;
  policy.scoring.freshness.stalePenalty = 3;
  policy.scoring.freshness.recentDays = 30;
  policy.scoring.freshness.staleDays = 365;
  const policyContext = buildPolicySearchContext(policy);

  const invalidDateBase = buildCandidateRecommendationBase(
    buildCatalogEntry("invalid-date", "skill", 50, {
      lastUpdated: "not-a-date",
    }),
    createEmptyDemandContext(),
    policy,
    policyContext,
  );
  const midAgeBase = buildCandidateRecommendationBase(
    buildCatalogEntry("mid-age", "skill", 50, {
      lastUpdated: "2025-12-31T00:00:00.000Z",
    }),
    createEmptyDemandContext(),
    policy,
    policyContext,
  );

  assert.equal(invalidDateBase?.breakdown.freshness, -7);
  assert.equal(midAgeBase?.breakdown.freshness, 0);
});

void test("selection uses lower prompt weight as a dynamic-score tiebreaker", () => {
  const policy = buildPolicy({
    recommendationLimit: 1,
    activationBudget: 1_000,
  });
  const heavier = buildCatalogEntry("a-heavier", "skill", 90);
  heavier.contextCost = { sizeClass: "tiny", estimatedPromptWeight: 3 };
  const lighter = buildCatalogEntry("z-lighter", "skill", 90);
  lighter.contextCost = { sizeClass: "tiny", estimatedPromptWeight: 2 };

  const recommendations = buildRecommendationsForTest(
    "copilot-vscode",
    [heavier, lighter],
    createEmptyDemandContext(),
    policy,
  );

  assert.equal(recommendations[0]?.assetId, "z-lighter");
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

// ─── Ecosystem-affinity mismatch penalty tests ───────────────────────────────

/** Policy variant with a nonzero ecosystemMismatchPenalty for penalty tests. */
function buildEcosystemPolicy(): RecommendationPolicy {
  const base = buildPolicy();
  return {
    ...base,
    scoring: { ...base.scoring, ecosystemMismatchPenalty: 40 },
  };
}

void test("packagist entry receives ecosystem mismatch penalty in npm-only workspace", () => {
  const policy = buildEcosystemPolicy();
  const demandContext = buildDemandContext(
    createDemandProfile([
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: ["javascript", "typescript"],
          packageManagers: ["npm"],
          frameworks: [],
          concerns: [],
          tooling: ["npm:eslint"],
        },
      },
    ]),
    policy,
  );
  // packagist entry with eslint-like capability (would rank high on token match)
  const packagistEntry = buildCatalogEntry(
    "packagist-registry:packagist:vendor%2Feslint-wrapper",
    "plugin",
    80,
    {
      sourceId: "packagist-registry",
      sourceKind: "package-registry",
      capabilities: ["eslint", "lint", "php"],
    },
  );
  const npmEntry = buildCatalogEntry("npm-eslint-plugin", "plugin", 80, {
    sourceId: "npm-registry",
    sourceKind: "package-registry",
    capabilities: ["eslint", "lint", "javascript"],
  });

  const packagistBase = buildCandidateRecommendationBase(
    packagistEntry,
    demandContext,
    policy,
  );
  const npmBase = buildCandidateRecommendationBase(
    npmEntry,
    demandContext,
    policy,
  );

  assert.ok(
    packagistBase !== null,
    "packagist entry should pass gate (not suppressed)",
  );
  assert.ok(npmBase !== null, "npm entry should pass gate");

  assert.ok(
    packagistBase!.breakdown.ecosystemMismatchPenalty > 0,
    "packagist entry must have a positive ecosystemMismatchPenalty in an npm workspace",
  );
  assert.equal(
    npmBase!.breakdown.ecosystemMismatchPenalty,
    0,
    "npm entry must have zero ecosystemMismatchPenalty in an npm workspace",
  );
  assert.ok(
    packagistBase!.breakdown.total < npmBase!.breakdown.total,
    "packagist entry score must be lower than npm entry score after ecosystem penalty",
  );
});

void test("ecosystem mismatch penalty is zero when workspace has no package-manager signals", () => {
  const policy = buildEcosystemPolicy();
  const demandContext = buildDemandContext(
    createDemandProfile([
      {
        path: "README.md",
        fileName: "README.md",
        evidenceStrength: "weak",
        matchedSignals: {
          languages: ["markdown"],
          packageManagers: [],
          frameworks: [],
          concerns: [],
          tooling: [],
        },
      },
    ]),
    policy,
  );
  const packagistEntry = buildCatalogEntry("packagist-entry", "plugin", 80, {
    sourceId: "packagist-registry",
    sourceKind: "package-registry",
    capabilities: ["php", "composer"],
  });
  const base = buildCandidateRecommendationBase(
    packagistEntry,
    demandContext,
    policy,
  );
  assert.equal(
    base?.breakdown.ecosystemMismatchPenalty,
    0,
    "must not penalise when workspace has no package-manager signals (brand-new project)",
  );
});

void test("ecosystem mismatch penalty is zero for non-package-registry source kinds", () => {
  const policy = buildEcosystemPolicy();
  const demandContext = buildDemandContext(
    createDemandProfile([
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: ["javascript"],
          packageManagers: ["npm"],
          frameworks: [],
          concerns: [],
          tooling: [],
        },
      },
    ]),
    policy,
  );
  // A repo-kind source whose id happens to contain "packagist" should not be penalised
  const repoEntry = buildCatalogEntry("packagist-docs-repo", "agent", 80, {
    sourceId: "packagist-docs",
    sourceKind: "repo",
    capabilities: ["php", "documentation"],
  });
  const base = buildCandidateRecommendationBase(
    repoEntry,
    demandContext,
    policy,
  );
  assert.equal(
    base?.breakdown.ecosystemMismatchPenalty,
    0,
    "repo-kind sources must never receive an ecosystem mismatch penalty",
  );
});

void test("matching ecosystem incurs zero ecosystem mismatch penalty", () => {
  const policy = buildEcosystemPolicy();
  const demandContext = buildDemandContext(
    createDemandProfile([
      {
        path: "composer.json",
        fileName: "composer.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: ["php"],
          packageManagers: ["composer"],
          frameworks: [],
          concerns: [],
          tooling: [],
        },
      },
    ]),
    policy,
  );
  const packagistEntry = buildCatalogEntry(
    "packagist-registry:packagist:vendor%2Ftool",
    "plugin",
    80,
    {
      sourceId: "packagist-registry",
      sourceKind: "package-registry",
      capabilities: ["php", "composer", "tool"],
    },
  );
  const base = buildCandidateRecommendationBase(
    packagistEntry,
    demandContext,
    policy,
  );
  assert.equal(
    base?.breakdown.ecosystemMismatchPenalty,
    0,
    "packagist entry must have zero penalty when workspace uses composer",
  );
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
      ecosystemMismatchPenalty: 0,
      coverageGainWeight: 1,
      sourceDiversityBonus: 1,
      assetKindDiversityPenalty: 5,
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
    lastUpdated?: string;
    manifestEntry?: string;
    classification?: AssetCatalogEntry["evidence"]["classification"];
    publisher?: string;
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
      publisher: options.publisher ?? sourceId,
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
      manifestEntry: options.manifestEntry,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: options.evidenceFilePath,
      classification: options.classification,
    },
    maintenance: {
      lastUpdated: options.lastUpdated ?? new Date().toISOString(),
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
      assetKindDiversityPenalty: 0,
      freshness: 0,
      costPenalty: 0,
      riskPenalty: 0,
      negativePenalty: 0,
      ecosystemMismatchPenalty: 0,
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
    packageManagers: new Set<string>(),
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

void test("host preference fallback canonicalizes concerns without the precomputed set", () => {
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
  const policyContext = buildPolicySearchContext(policy);
  const base = buildCandidateRecommendationBase(
    buildCatalogEntry("backend-skill", "skill", 10, {
      capabilities: ["skill", "backend"],
    }),
    demandContext,
    policy,
    policyContext,
  );

  assert.notEqual(base, null);
  const candidate = buildCandidateRecommendation(
    base as CandidateRecommendationBase,
    "copilot-vscode",
    demandContext,
    policy,
  );

  assert.notEqual(candidate, null);
  assert.ok(
    (candidate?.breakdown.hostPreference ?? 0) >= 1,
    "the no-set fallback must still enforce canonicalized concern targets",
  );
});
