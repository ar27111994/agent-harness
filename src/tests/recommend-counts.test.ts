import assert from "node:assert/strict";
import test from "node:test";

import {
  countBy,
  countCoverageTags,
  countCoverageTagsFromEntries,
} from "../recommend/counts.js";
import type { CandidateRecommendation } from "../recommend/model.js";
import type { RecommendationEntry } from "../types.js";

void test("recommend counts aggregates coverage tags across candidates and entries", () => {
  const candidates = [
    createCandidateRecommendation(["backend", "testing"]),
    createCandidateRecommendation(["backend"]),
  ];
  const entries = [
    createRecommendationEntry(["frontend"]),
    createRecommendationEntry(["frontend", "testing"]),
  ];

  assert.deepEqual(countCoverageTags(candidates), {
    backend: 2,
    testing: 1,
  });
  assert.deepEqual(countCoverageTagsFromEntries(entries), {
    frontend: 2,
    testing: 1,
  });
});

void test("recommend counts can group arbitrary values by selector", () => {
  const counts = countBy(
    [
      { id: "a", kind: "skill" },
      { id: "b", kind: "skill" },
      { id: "c", kind: "plugin" },
    ],
    (entry) => entry.kind,
  );

  assert.deepEqual(counts, {
    skill: 2,
    plugin: 1,
  });
});

function createCandidateRecommendation(
  coverageTags: string[],
): CandidateRecommendation {
  return {
    entry: {
      id: "candidate",
      displayName: "Candidate",
      assetKind: "skill",
      hosts: ["copilot-vscode"],
      compatibilityMode: "native",
      source: {
        sourceId: "fixture-source",
        sourceKind: "repo",
        authorityTier: "trusted-community",
        sourcePriority: 1,
        originUrl: "https://example.com/candidate",
        publisher: "fixture-source",
        publisherVerified: false,
      },
      trust: {
        score: 1,
        signals: [],
      },
      capabilities: ["skill"],
      install: {
        method: "local-file",
      },
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
      contextCost: {
        sizeClass: "tiny",
        estimatedPromptWeight: 1,
      },
      fit: {
        portfolioFit: 1,
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
    },
    host: "copilot-vscode",
    sourceFamily: "fixture-source",
    availableLocally: false,
    recommendationBasis: "workspace-fit",
    coverageTags,
    taskModes: [],
    matchedSignals: [],
    reasons: [],
    breakdown: {
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
      total: 0,
    },
  };
}

function createRecommendationEntry(
  coverageTags: string[],
): RecommendationEntry {
  return {
    assetId: "entry",
    host: "copilot-vscode",
    rank: 1,
    score: 1,
    reasons: [],
    assetKind: "skill",
    sourceId: "fixture-source",
    sourceFamily: "fixture-source",
    availableLocally: false,
    recommendationBasis: "workspace-fit",
    contextSizeClass: "tiny",
    estimatedPromptWeight: 1,
    selectionStage: "top-by-host",
    coverageTags,
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
