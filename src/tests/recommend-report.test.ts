import assert from "node:assert/strict";
import test from "node:test";

import {
  clearRuntimeConfigForTests,
  loadRuntimeConfig,
} from "../config/runtime.js";
import { loadRecommendationPolicy } from "../recommend/policy.js";
import { buildRecommendationReport } from "../recommend/report.js";
import type { AssetCatalogEntry, DemandProfile } from "../types.js";

void test("recommendation reports apply validated session intent to ranking", async () => {
  clearRuntimeConfigForTests();
  const policy = await loadRecommendationPolicy(process.cwd());
  const demandProfile = createDemandProfile();
  const entries = [
    createEntry("frontend-skill", ["frontend", "ui", "react"]),
    createEntry("backend-skill", ["backend", "api", "service"]),
  ];

  const frontendReport = buildRecommendationReport(
    entries,
    demandProfile,
    policy,
    "frontend",
  );
  const backendReport = buildRecommendationReport(
    entries,
    demandProfile,
    policy,
    "backend",
  );

  assert.equal(frontendReport.sessionIntent, "frontend");
  assert.equal(backendReport.sessionIntent, "backend");
  assert.equal(
    frontendReport.topByHost["copilot-vscode"][0]?.assetId,
    "frontend-skill",
  );
  assert.equal(
    backendReport.topByHost["copilot-vscode"][0]?.assetId,
    "backend-skill",
  );
});

void test("recommendation reports expose env-sourced recommendation limits", async () => {
  clearRuntimeConfigForTests();
  const previousEnvValue =
    process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT;
  process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT = "7";

  try {
    loadRuntimeConfig(process.env);
    const policy = await loadRecommendationPolicy(process.cwd());
    const report = buildRecommendationReport(
      [createEntry("frontend-skill", ["frontend", "ui", "react"])],
      createDemandProfile(),
      policy,
      "frontend",
    );

    assert.equal(policy.hosts["copilot-vscode"].recommendationLimit, 7);
    assert.equal(report.hostSummaries["copilot-vscode"].recommendationLimit, 7);
    assert.equal(
      report.hostSummaries["copilot-vscode"].recommendationLimitSource,
      "env",
    );
    assert.equal(
      report.hostSummaries["copilot-vscode"].recommendationLimitEnvVar,
      "AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT",
    );
  } finally {
    if (previousEnvValue === undefined) {
      delete process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT;
    } else {
      process.env.AGENT_HARNESS_COPILOT_VSCODE_RECOMMENDATION_LIMIT =
        previousEnvValue;
    }
    clearRuntimeConfigForTests();
  }
});

function createDemandProfile(): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "fixtures/workspace",
    summary: {
      scannedFiles: 8,
      matchedFiles: 3,
    },
    signals: {
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: [],
      concerns: [],
      tooling: ["eslint"],
    },
    evidence: [
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: ["typescript"],
          packageManagers: ["npm"],
          frameworks: [],
          concerns: [],
          tooling: ["eslint"],
        },
      },
    ],
  };
}

function createEntry(id: string, capabilities: string[]): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: "skill",
    hosts: ["copilot-vscode", "opencode", "shared"],
    compatibilityMode: "native",
    source: {
      sourceId: "fixture-source",
      authorityTier: "trusted-community",
      sourceKind: "repo",
      sourcePriority: 80,
      originUrl: `https://example.com/${id}`,
      publisher: "fixture-source",
      publisherVerified: false,
    },
    trust: {
      score: 80,
      signals: ["fixture"],
    },
    capabilities,
    install: {
      method: "fixture",
      nativeHosts: ["copilot-vscode", "opencode", "shared"],
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
      stars: 0,
      releaseCadence: "active",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: {
      sizeClass: "small",
      estimatedPromptWeight: 2,
    },
    fit: {
      portfolioFit: 0.9,
      hostFit: 0.9,
    },
    dedupe: {
      candidateRankHint: "fixture",
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}
