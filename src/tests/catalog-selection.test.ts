import assert from "node:assert/strict";
import test from "node:test";

import { deriveDisplayNameFromPath } from "../domains/discovery/catalog-utils.js";
import { filterCatalogEntriesByDemandRelevance } from "../domains/discovery/catalog-selection.js";
import type { AssetCatalogEntry, DemandProfile } from "../types.js";

void test("catalog selection rejects entries without demand overlap", () => {
  const result = filterCatalogEntriesByDemandRelevance(
    [
      buildCatalogEntry("apify-skill", ["apify", "actor", "webhook"]),
      buildCatalogEntry("flutter-skill", ["flutter", "dart", "mobile"]),
      buildCatalogEntry("postgres-mcp", ["postgres", "mcp"], {
        assetKind: "mcp-server",
        installMethod: "npm-metadata",
        sourceKind: "package-registry",
      }),
      buildCatalogEntry("metadata-only-mcp", ["mcp"], {
        assetKind: "mcp-server",
        installMethod: "github-tree-metadata",
        installEligible: true,
      }),
      buildCatalogEntry("tree-mcp", ["mcp"], {
        assetKind: "mcp-server",
        installMethod: "github-tree-metadata",
        installEligible: true,
        relativePath: "servers/mcp-server.ts",
      }),
      buildCatalogEntry("generic-npm-helper", ["npm"]),
    ],
    buildDemandProfile(),
  );

  assert.deepEqual(result.selectedEntries.map((entry) => entry.id).sort(), [
    "apify-skill",
    "postgres-mcp",
    "tree-mcp",
  ]);
  assert.deepEqual(
    result.rejectedEntries.map((entry) => entry.id),
    ["flutter-skill", "metadata-only-mcp", "generic-npm-helper"],
  );
});

void test("catalog selection rejects low-signal concern overlap without stronger evidence", () => {
  const result = filterCatalogEntriesByDemandRelevance(
    [
      buildCatalogEntry("generic-docs", [
        "documentation",
        "knowledge-base",
        "testing",
      ]),
      buildCatalogEntry("generic-stack", [
        "backend",
        "frontend",
        "testing",
        "documentation",
      ]),
      buildCatalogEntry("specific-webhook", ["webhook", "integration"]),
      buildCatalogEntry("high-fit-entry", ["misc"], {
        portfolioFit: 0.12,
      }),
    ],
    buildLowSignalDemandProfile(),
  );

  assert.deepEqual(result.selectedEntries.map((entry) => entry.id).sort(), [
    "generic-stack",
    "high-fit-entry",
    "specific-webhook",
  ]);
  assert.deepEqual(
    result.rejectedEntries.map((entry) => entry.id),
    ["generic-docs"],
  );
});

void test("catalog selection requires compound signal specificity", () => {
  const result = filterCatalogEntriesByDemandRelevance(
    [
      buildCatalogEntry("analytics-engineering-pack", [
        "analytics",
        "engineering",
      ]),
      buildCatalogEntry("analytics-only-pack", ["analytics"]),
      buildCatalogEntry("engineering-only-pack", ["engineering"]),
      buildCatalogEntry("ai-sdk-pack", ["ai", "sdk"]),
      buildCatalogEntry("ai-only-pack", ["ai"]),
      buildCatalogEntry("sdk-only-pack", ["sdk"]),
    ],
    buildCompoundSignalDemandProfile(),
  );

  assert.deepEqual(result.selectedEntries.map((entry) => entry.id).sort(), [
    "ai-sdk-pack",
    "analytics-engineering-pack",
  ]);
  assert.deepEqual(result.rejectedEntries.map((entry) => entry.id).sort(), [
    "ai-only-pack",
    "analytics-only-pack",
    "engineering-only-pack",
    "sdk-only-pack",
  ]);
});

void test("catalog selection demotes catalog-common exact terms", () => {
  const catalogEntries = [
    ...Array.from({ length: 205 }, (_, index) =>
      buildCatalogEntry(`ai-pack-${index + 1}`, ["ai"]),
    ),
    buildCatalogEntry("webhook-pack", ["webhook"]),
  ];
  const result = filterCatalogEntriesByDemandRelevance(
    catalogEntries,
    buildCommonTermDemandProfile(),
  );

  assert.deepEqual(
    result.selectedEntries.map((entry) => entry.id),
    ["webhook-pack"],
  );
  assert.equal(result.rejectedEntries.length, 205);
});

void test("catalog display names use parent folders for generic filenames", () => {
  assert.equal(
    deriveDisplayNameFromPath("skills/flutter-add-integration-test/SKILL.md"),
    "Flutter Add Integration Test",
  );
  assert.equal(
    deriveDisplayNameFromPath("docs/firebase-auth/README.md"),
    "Firebase Auth",
  );
  assert.equal(deriveDisplayNameFromPath("rules/frontend.mdc"), "Frontend");
});

function buildDemandProfile(): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "/tmp/project",
    summary: {
      scannedFiles: 1,
      matchedFiles: 1,
    },
    signals: {
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: ["apify", "express"],
      concerns: ["backend", "webhook", "automation"],
      tooling: ["actor", "npm:@apify/client"],
    },
    evidence: [],
  };
}

function buildLowSignalDemandProfile(): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "/tmp/project",
    summary: {
      scannedFiles: 1,
      matchedFiles: 1,
    },
    signals: {
      languages: [],
      packageManagers: [],
      frameworks: [],
      concerns: [
        "documentation",
        "knowledge-base",
        "testing",
        "frontend",
        "backend",
        "webhook",
      ],
      tooling: [],
    },
    evidence: [],
  };
}

function buildCompoundSignalDemandProfile(): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "/tmp/project",
    summary: {
      scannedFiles: 1,
      matchedFiles: 1,
    },
    signals: {
      languages: [],
      packageManagers: [],
      frameworks: [],
      concerns: ["analytics-engineering"],
      tooling: ["ai-sdk"],
    },
    evidence: [],
  };
}

function buildCommonTermDemandProfile(): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "/tmp/project",
    summary: {
      scannedFiles: 1,
      matchedFiles: 1,
    },
    signals: {
      languages: [],
      packageManagers: [],
      frameworks: [],
      concerns: ["ai", "webhook"],
      tooling: [],
    },
    evidence: [],
  };
}

function buildCatalogEntry(
  id: string,
  capabilities: string[],
  options: Partial<{
    assetKind: AssetCatalogEntry["assetKind"];
    installMethod: string;
    installEligible: boolean;
    relativePath: string;
    sourceKind: AssetCatalogEntry["source"]["sourceKind"];
    portfolioFit: number;
  }> = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: options.assetKind ?? "skill",
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId: id,
      authorityTier: "trusted-community",
      sourceKind: options.sourceKind ?? "repo",
      sourcePriority: 60,
      originUrl: `https://example.com/${id}`,
      publisher: id,
      publisherVerified: false,
    },
    trust: { score: 60, signals: [] },
    capabilities,
    install: {
      method: options.installMethod ?? "github-tree-metadata",
      relativePath: options.relativePath,
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
    contextCost: { sizeClass: "tiny", estimatedPromptWeight: 1 },
    fit: {
      portfolioFit: options.portfolioFit ?? (id === "apify-skill" ? 0.2 : 0),
      hostFit: 1,
    },
    dedupe: { candidateRankHint: "test" },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible:
        options.installEligible ?? options.assetKind === "mcp-server",
      activationEligible:
        options.installEligible ?? options.assetKind === "mcp-server",
    },
  };
}
