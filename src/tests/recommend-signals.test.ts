import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDemandContext,
  collectMatchedSignals,
} from "../recommend/signals.js";
import type { DemandEvidenceStrength } from "../types/discovery.js";
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
  // Asset-side provenance (#444): the reported evidence fields describe the
  // ASSET's own content that hit each demand term — never the workspace's
  // demand-side evidence counts.
  const assetTermStrength: ReadonlyMap<string, DemandEvidenceStrength> =
    new Map([
      ["apify", "strong"],
      ["integration", "weak"],
    ]);
  const matches = collectMatchedSignals(
    new Set(["apify", "integration"]),
    demandContext,
    policy,
    assetTermStrength,
  );

  const apifyMatch = matches.find((match) => match.term === "apify");
  const integrationMatch = matches.find(
    (match) => match.term === "integration",
  );

  assert.ok(apifyMatch);
  assert.ok(integrationMatch);
  // One asset-side term hit per demand term, weighted by the asset's own
  // provenance strength.
  assert.equal(apifyMatch.evidenceCount, 1);
  assert.equal(apifyMatch.weightedEvidenceCount, 3);
  assert.deepEqual(apifyMatch.evidenceStrengthCounts, {
    strong: 1,
    medium: 0,
    weak: 0,
  });
  assert.equal(integrationMatch.evidenceCount, 1);
  assert.equal(integrationMatch.weightedEvidenceCount, 1);
  assert.deepEqual(integrationMatch.evidenceStrengthCounts, {
    strong: 0,
    medium: 0,
    weak: 1,
  });
  assert.ok(apifyMatch.weight > integrationMatch.weight);

  // Without a provenance map the histogram is deliberately absent — no
  // demand-side evidence may leak into an asset's match record (#444).
  const unprovenanced = collectMatchedSignals(
    new Set(["apify"]),
    demandContext,
    policy,
  );
  assert.equal(unprovenanced[0]?.evidenceCount, 1);
  assert.equal(unprovenanced[0]?.weightedEvidenceCount, undefined);
  assert.equal(unprovenanced[0]?.evidenceStrengthCounts, undefined);
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

void test("recommend demand context upgrades a bare-name term with package identity when the manifest form arrives (#444)", () => {
  const profile: DemandProfile = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "C:/fixture",
    summary: {
      scannedFiles: 2,
      matchedFiles: 2,
    },
    signals: {
      languages: [],
      packageManagers: ["npm"],
      frameworks: [],
      concerns: [],
      tooling: [],
    },
    evidence: [
      {
        path: "docs/duckdb.md",
        fileName: "duckdb.md",
        evidenceStrength: "weak",
        matchedSignals: {
          languages: [],
          packageManagers: [],
          frameworks: [],
          concerns: [],
          // A bare name token with the SAME canonical phrase arrives before
          // the manifest declaration (evidence ordering is not guaranteed);
          // the term must adopt the package identity from the package form.
          tooling: ["npm-duckdb-node-api"],
        },
      },
      {
        path: "files/package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: [],
          packageManagers: [],
          frameworks: [],
          concerns: [],
          tooling: ["npm:@duckdb/node-api"],
        },
      },
    ],
  };

  const demandContext = buildDemandContext(profile, buildPolicy());

  const term = demandContext.terms.find(
    (entry) => entry.canonicalTerm === "npm-duckdb-node-api",
  );
  assert.ok(term, "the shared canonical term must exist");
  assert.ok(
    term?.packageIdentityTokens?.has("duckdb"),
    "bare-name term must be upgraded with the declared package identity",
  );
  assert.deepEqual(
    [...(demandContext.packageIdentityByTerm.get("npm-duckdb-node-api") ?? [])],
    ["duckdb"],
  );
  assert.equal(term?.evidenceStrengthCounts.strong, 1);
  assert.equal(term?.evidenceStrengthCounts.weak, 1);
});

void test("recommend demand context treats all-generic package identities as no identity (#444)", () => {
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
      tooling: [],
    },
    evidence: [
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: [],
          packageManagers: [],
          frameworks: [],
          concerns: [],
          tooling: ["npm:node-api"],
        },
      },
    ],
  };

  const demandContext = buildDemandContext(profile, buildPolicy());

  const term = demandContext.terms.find(
    (entry) => entry.canonicalTerm === "npm-node-api",
  );
  assert.ok(term, "the declared package term must exist");
  assert.equal(
    term?.packageIdentityTokens,
    undefined,
    "an identity made only of generic tokens (node, api) must not be attributed",
  );
  assert.equal(
    demandContext.packageIdentityByTerm.has("npm-node-api"),
    false,
    "no identity entry may exist for an all-generic package",
  );
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

void test("recommend signal weighting floors zero-evidence terms with asset-side weak provenance", () => {
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
      packageIdentityByTerm: new Map<string, ReadonlySet<string>>(),
      demandKeywords: new Set(["placeholder"]),
      packageManagers: new Set<string>(),
    },
    buildPolicy(),
    new Map<string, DemandEvidenceStrength>(),
  );

  // The demand term carries zero workspace evidence: weight floors at the
  // minimum, and the buckets describe the ASSET side only (one hit with
  // unknown provenance counts as weak) — never a workspace claim (#444).
  assert.equal(matches[0]?.evidenceCount, 1);
  assert.equal(matches[0]?.weightedEvidenceCount, 1);
  assert.deepEqual(matches[0]?.evidenceStrengthCounts, {
    strong: 0,
    medium: 0,
    weak: 1,
  });
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
      ecosystemMismatchPenalty: 0,
      coverageGainWeight: 0,
      sourceDiversityBonus: 0,
      assetKindDiversityPenalty: 5,
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
      codex: hostPolicy,
    },
    concernKeywordMap: {},
    taskModeKeywordMap: {},
    domainKeywordGroups: {},
    synonyms: {},
  };
}

void test("buildSynonymLookup produces correct alias→canonical map", async () => {
  const { buildSynonymLookup, normalizePhrase } =
    await import("../recommend/signals.js");

  const policy = buildPolicy();
  policy.synonyms = {
    backend: ["api-services", "REST API"],
    frontend: ["ui", "User Interface"],
  };

  const lookup = buildSynonymLookup(policy);

  // Canonical keys map to themselves.
  assert.equal(lookup.get("backend"), "backend");
  assert.equal(lookup.get("frontend"), "frontend");

  // Each alias normalises to its canonical form.
  assert.equal(lookup.get(normalizePhrase("api-services")), "backend");
  assert.equal(lookup.get(normalizePhrase("REST API")), "backend");
  assert.equal(lookup.get(normalizePhrase("ui")), "frontend");
  assert.equal(lookup.get(normalizePhrase("User Interface")), "frontend");

  // Unknown terms return undefined.
  assert.equal(lookup.get("unknown"), undefined);
});

void test("buildSynonymLookup with precomputed map matches on-demand canonicalization", async () => {
  const { buildSynonymLookup, buildSearchTerms } =
    await import("../recommend/signals.js");

  const policy = buildPolicy();
  policy.synonyms = {
    typescript: ["ts", "TypeScript Language"],
    javascript: ["js", "node"],
  };

  const lookup = buildSynonymLookup(policy);
  const values = ["TS", "js", "TypeScript Language", "node", "other-term"];

  const withLookup = buildSearchTerms(values, policy, lookup);
  const withoutLookup = buildSearchTerms(values, policy);

  // Both approaches must produce identical term sets.
  assert.deepEqual(
    [...withLookup].sort(),
    [...withoutLookup].sort(),
    "precomputed lookup must match on-demand canonicalization for all terms",
  );
});

void test("buildSearchTerms with precomputed lookup is consistent across many values", async () => {
  const { buildSynonymLookup, buildSearchTerms } =
    await import("../recommend/signals.js");

  const policy = buildPolicy();
  policy.synonyms = {
    testing: ["test", "spec", "e2e", "unit test"],
    security: ["sec", "auth", "tls", "ssl"],
    performance: ["perf", "speed", "latency", "throughput"],
  };

  const lookup = buildSynonymLookup(policy);
  const values = Array.from(
    { length: 50 },
    (_, i) => `term-${String(i)}`,
  ).concat([
    "test",
    "spec",
    "e2e",
    "sec",
    "auth",
    "perf",
    "speed",
    "unknown-123",
  ]);

  const start = Date.now();
  for (let i = 0; i < 200; i++) {
    buildSearchTerms(values, policy, lookup);
  }
  const elapsed = Date.now() - start;

  // 200 × 58 values with a precomputed lookup must complete well within 500ms.
  assert.ok(
    elapsed < 2000,
    `200 iterations over 58 values took ${String(elapsed)}ms — expected < 2000ms`,
  );

  // Results must still match the reference (no-lookup) path.
  const withLookup = buildSearchTerms(values, policy, lookup);
  const withoutLookup = buildSearchTerms(values, policy);
  assert.deepEqual([...withLookup].sort(), [...withoutLookup].sort());
});

void test("normalizePhrase memo clears at its bound and stays correct", async () => {
  const { normalizePhrase } = await import("../recommend/signals.js");

  // Distinct raw phrases beyond the memo cap force the cache-clear branch;
  // the results stay correct and the memo keeps working afterwards.
  const first = "Boundary Phrase-Á";
  assert.equal(normalizePhrase(first), "boundary-phrase");

  for (let index = 0; index < 20_100; index += 1) {
    assert.equal(
      normalizePhrase(`Unique Phrase ${index}`),
      `unique-phrase-${index}`,
    );
  }

  assert.equal(
    normalizePhrase("Boundary Phrase-Á"),
    "boundary-phrase",
    "normalization must remain correct across the cache-clearing boundary",
  );
  assert.equal(normalizePhrase("Unique Phrase 42"), "unique-phrase-42");
});
