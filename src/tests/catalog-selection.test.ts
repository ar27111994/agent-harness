import assert from "node:assert/strict";
import test from "node:test";

import { filterCatalogEntriesByDemandRelevance } from "../domains/discovery/catalog-selection.js";
import type { AssetCatalogEntry, DemandProfile } from "../types.js";

void test("selection relevance rejects specialized domains on broad generic signals", () => {
  const demandProfile = createDemandProfile({
    concerns: ["security", "integration", "platform-engineering"],
    tooling: ["node", "typescript", "eslint", "npm"],
  });
  const relevantEntry = createEntry("workspace-security-skill", [
    "security",
    "integration",
    "typescript",
    "node",
  ]);
  const falseFirebase = createEntry("firebase-skill", [
    "firebase",
    "security",
    "integration",
    "rules",
  ]);
  const falseAzure = createEntry("azure-skill", [
    "azure",
    "security",
    "integration",
    "platform",
  ]);
  const falsePowerPlatform = createEntry("power-platform-skill", [
    "power",
    "platform",
    "security",
    "integration",
  ]);
  const { selectedEntries, rejectedEntries } =
    filterCatalogEntriesByDemandRelevance(
      [relevantEntry, falseFirebase, falseAzure, falsePowerPlatform],
      demandProfile,
    );

  assert.deepEqual(
    selectedEntries.map((entry) => entry.id),
    ["workspace-security-skill"],
  );
  assert.deepEqual(rejectedEntries.map((entry) => entry.id).sort(), [
    "azure-skill",
    "firebase-skill",
    "power-platform-skill",
  ]);
});

void test("selection relevance bridges design-system demand into penpot recall", () => {
  const demandProfile = createDemandProfile({
    frameworks: ["flutter"],
    concerns: ["design-assets", "design-systems", "frontend", "mobile"],
    tooling: ["flutter", "pub", "detector:design-system"],
  });
  const penpotEntry = createEntry("penpot-skill", [
    "penpot",
    "design",
    "frontend",
    "design-systems",
  ]);
  const genericMobile = createEntry("mobile-skill", [
    "mobile",
    "frontend",
    "android",
    "ios",
  ]);

  const { selectedEntries } = filterCatalogEntriesByDemandRelevance(
    [penpotEntry, genericMobile],
    demandProfile,
  );

  assert.ok(selectedEntries.some((entry) => entry.id === "penpot-skill"));
});

void test("selection relevance rejects unrelated trusted-local guidance when meaningful stack anchors exist", () => {
  const demandProfile = createDemandProfile({
    languages: ["dart", "swift"],
    packageManagers: ["pub"],
    frameworks: ["flutter"],
    concerns: ["frontend", "mobile", "testing", "integration"],
    tooling: ["flutter", "xcode", "pub"],
  });
  const unrelatedLocalSkill = createEntry(
    "api-endpoint-builder",
    ["api", "backend", "integration", "testing", "automation"],
    {
      authorityTier: "trusted-local",
      sourceKind: "local-directory",
    },
  );
  const flutterLocalSkill = createEntry(
    "flutter-architecting-apps",
    ["flutter", "dart", "mobile", "frontend", "testing"],
    {
      authorityTier: "trusted-local",
      sourceKind: "local-directory",
    },
  );

  const { selectedEntries, rejectedEntries } =
    filterCatalogEntriesByDemandRelevance(
      [unrelatedLocalSkill, flutterLocalSkill],
      demandProfile,
    );

  assert.deepEqual(
    selectedEntries.map((entry) => entry.id),
    ["flutter-architecting-apps"],
  );
  assert.deepEqual(
    rejectedEntries.map((entry) => entry.id),
    ["api-endpoint-builder"],
  );
});

function createDemandProfile(
  overrides: Partial<DemandProfile["signals"]>,
): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "fixtures/workspace",
    summary: {
      scannedFiles: 4,
      matchedFiles: 2,
    },
    signals: {
      languages: overrides.languages ?? ["typescript"],
      packageManagers: overrides.packageManagers ?? ["npm"],
      frameworks: overrides.frameworks ?? [],
      concerns: overrides.concerns ?? [],
      tooling: overrides.tooling ?? [],
    },
    evidence: [
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: overrides.languages ?? ["typescript"],
          packageManagers: overrides.packageManagers ?? ["npm"],
          frameworks: overrides.frameworks ?? [],
          concerns: overrides.concerns ?? [],
          tooling: overrides.tooling ?? [],
        },
      },
    ],
  };
}

function createEntry(
  id: string,
  capabilities: string[],
  overrides: Partial<AssetCatalogEntry["source"]> = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: "skill",
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId: "fixture-source",
      authorityTier: "trusted-community",
      sourceKind: "repo",
      sourcePriority: 80,
      originUrl: `https://example.com/${id}`,
      publisher: "fixture-source",
      publisherVerified: false,
      ...overrides,
    },
    trust: {
      score: 80,
      signals: ["fixture"],
    },
    capabilities,
    install: {
      method: "fixture",
      nativeHosts: ["copilot-vscode"],
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
