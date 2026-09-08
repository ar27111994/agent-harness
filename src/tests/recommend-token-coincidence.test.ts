import assert from "node:assert/strict";
import test from "node:test";

import { buildReferenceSourceCatalogEntry } from "../domains/discovery/reference-source-harvester.js";
import { isTokenCoincidenceWithoutSemanticEvidence } from "../recommend/evidence-quality.js";
import type {
  AssetCatalogEntry,
  RecommendationSignalMatch,
  SelectionRegistry,
  SourceDefinition,
} from "../types.js";

void test("empty marketplace summary is manifest evidence but not semantic README evidence", () => {
  const entry = buildReferenceSourceCatalogEntry(
    marketplaceSource(),
    null,
    selectionRegistry(),
    {
      harvestedItem: {
        displayName: "LabVIEW Benchmark Actor",
        originUrl:
          "https://marketplace.visualstudio.com/items?itemName=acme.labview-benchmark-actor",
        assetKind: "extension",
        summary: "",
        capabilities: ["labview", "benchmark", "actor"],
        installMethod: "vscode-marketplace",
        manifestEntry: "acme.labview-benchmark-actor",
        compatibilityMode: "native",
      },
    },
  );

  assert.equal(entry.evidence.manifestFound, true);
  assert.equal(entry.evidence.readmeFound, false);
  assert.equal(entry.evidence.lineCount, 0);
});

void test("actor-only marketplace identity collision cannot establish Apify semantic evidence", () => {
  const entry = marketplaceEntry({
    id: "labview-benchmark-actor",
    displayName: "LabVIEW Benchmark Actor",
    readmeFound: false,
  });
  const matches: RecommendationSignalMatch[] = [
    {
      term: "apify",
      signalType: "frameworks",
      weight: 6,
      evidenceCount: 1,
    },
    {
      term: "npm-apify-actor-memory-expression",
      signalType: "tooling",
      weight: 4,
      evidenceCount: 1,
    },
  ];

  const result = isTokenCoincidenceWithoutSemanticEvidence(
    entry,
    matches,
    new Set(["labview-benchmark-actor", "labview", "benchmark", "actor"]),
    new Map([
      ["apify", new Set(["apify", "actor"])],
      [
        "npm-apify-actor-memory-expression",
        new Set(["apify", "actor", "memory", "expression"]),
      ],
    ]),
    new Set(["labview", "benchmark", "actor"]),
  );

  assert.equal(result, true);
});

void test("literal distinctive marketplace identity remains eligible without a description", () => {
  const entry = marketplaceEntry({
    id: "apify-toolkit",
    displayName: "Apify Toolkit",
    readmeFound: false,
  });
  const matches: RecommendationSignalMatch[] = [
    { term: "apify", signalType: "frameworks", weight: 6, evidenceCount: 1 },
  ];

  assert.equal(
    isTokenCoincidenceWithoutSemanticEvidence(
      entry,
      matches,
      new Set(["apify-toolkit", "apify", "toolkit"]),
      new Map([["apify", new Set(["apify"])]]),
      new Set(["apify-toolkit", "apify", "toolkit"]),
    ),
    false,
  );
});

function marketplaceSource(): SourceDefinition {
  return {
    id: "vscode-marketplace",
    name: "VS Code Marketplace",
    kind: "marketplace",
    authorityTier: "official-marketplace",
    publisher: { name: "Microsoft", verified: true, owner: "microsoft" },
    hosts: ["copilot-vscode"],
    assetKinds: ["extension"],
    discoveryMode: "catalog",
    priority: 95,
    enabled: true,
    endpoints: { baseUrl: "https://marketplace.visualstudio.com" },
    rules: { officialPreferred: true, allowMirror: true, allowInstall: true },
  };
}

function selectionRegistry(): SelectionRegistry {
  return {
    schemaVersion: 1,
    selectionPolicies: {
      officialBeatsPopularity: true,
      starsAreTieBreakerOnly: true,
      preferNativeOverAdaptable: true,
      preferLowerRiskWhenEquivalent: true,
      preferLowerContextCostWhenEquivalent: true,
      communityDefaultPolicy: "catalog-only-unless-promoted",
    },
    rankingOrder: [],
    duplicateGroups: [],
  };
}

function marketplaceEntry(input: {
  id: string;
  displayName: string;
  readmeFound: boolean;
}): AssetCatalogEntry {
  return {
    id: input.id,
    displayName: input.displayName,
    assetKind: "extension",
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId: "vscode-marketplace",
      authorityTier: "official-marketplace",
      sourceKind: "marketplace",
      sourcePriority: 95,
      originUrl: `https://example.com/${input.id}`,
      publisher: "fixture",
      publisherVerified: true,
    },
    trust: { score: 80, signals: ["fixture"] },
    capabilities: input.displayName.toLowerCase().split(/\s+/u),
    install: { method: "vscode-marketplace", manifestEntry: input.id },
    evidence: {
      manifestFound: true,
      readmeFound: input.readmeFound,
      examplesFound: false,
      docsLinked: true,
    },
    maintenance: {
      lastUpdated: "2026-08-01T00:00:00.000Z",
      stars: 0,
      releaseCadence: "active",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: { sizeClass: "tiny", estimatedPromptWeight: 1 },
    fit: { portfolioFit: 0.5, hostFit: 1 },
    dedupe: { candidateRankHint: "fixture" },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}
