import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSelectionReason,
  compareSelectionCandidates,
  filterCatalogEntriesByDemandRelevance,
  groupCatalogEntriesForSelection,
} from "../domains/discovery/catalog-selection.js";
import type {
  AssetCatalogEntry,
  DemandProfile,
  SelectionRegistry,
} from "../types.js";

void test("catalog selection groups duplicate groups and falls back to entry ids", () => {
  const grouped = groupCatalogEntriesForSelection([
    buildEntry("alpha", { duplicateGroup: "group-a" }),
    buildEntry("beta", { duplicateGroup: "group-a" }),
    buildEntry("solo"),
  ]);

  assert.deepEqual(
    grouped.get("group-a")?.map((entry) => entry.id),
    ["alpha", "beta"],
  );
  assert.deepEqual(
    grouped.get("solo")?.map((entry) => entry.id),
    ["solo"],
  );
});

void test("catalog selection ranking prefers stronger canonical and authority sources before stars", () => {
  const selectionRegistry = buildSelectionRegistry();
  const canonicalWinner = buildEntry("canonical", {
    installMethod: "local-file",
    stars: 0,
    authorityTier: "trusted-community",
  });
  const canonicalLoser = buildEntry("metadata", {
    installMethod: "manifest-entry",
    stars: 10_000,
    authorityTier: "official-compatible",
  });

  assert.ok(
    compareSelectionCandidates(
      canonicalWinner,
      canonicalLoser,
      selectionRegistry,
    ) < 0,
  );

  const authorityWinner = buildEntry("official", {
    authorityTier: "official-first-party",
    stars: 1,
  });
  const authorityLoser = buildEntry("community", {
    authorityTier: "trusted-community",
    stars: 10_000,
  });

  assert.ok(
    compareSelectionCandidates(
      authorityWinner,
      authorityLoser,
      selectionRegistry,
    ) < 0,
  );
});

void test("catalog selection demand relevance keeps all entries without demand profile", () => {
  const entries = [buildEntry("alpha"), buildEntry("bravo")];

  const result = filterCatalogEntriesByDemandRelevance(entries, null);

  assert.deepEqual(result.selectedEntries, entries);
  assert.deepEqual(result.rejectedEntries, []);
});

void test("catalog selection demand relevance keeps executable MCP sources", () => {
  const entries = [
    buildEntry("mcp-js", {
      assetKind: "mcp-server",
      sourceKind: "repo",
      installMethod: "github-tree-metadata",
      relativePath: "servers/index.js",
      capabilities: ["unrelated"],
    }),
    buildEntry("generic", { capabilities: ["unrelated"] }),
  ];

  const result = filterCatalogEntriesByDemandRelevance(
    entries,
    buildDemandProfile({ frameworks: ["next.js"] }),
  );

  assert.deepEqual(
    result.selectedEntries.map((entry) => entry.id),
    ["mcp-js"],
  );
  assert.deepEqual(
    result.rejectedEntries.map((entry) => entry.id),
    ["generic"],
  );
});

void test("catalog selection ranking compares compatibility fit risk context and maintenance", () => {
  const selectionRegistry = buildSelectionRegistry();

  assert.ok(
    compareSelectionCandidates(
      buildEntry("native", { compatibilityMode: "native" }),
      buildEntry("adaptable", { compatibilityMode: "adaptable" }),
      selectionRegistry,
    ) < 0,
  );
  assert.ok(
    compareSelectionCandidates(
      buildEntry("better-fit", { portfolioFit: 0.9 }),
      buildEntry("weaker-fit", { portfolioFit: 0.2 }),
      selectionRegistry,
    ) < 0,
  );
  assert.ok(
    compareSelectionCandidates(
      buildEntry("low-risk", { riskLevel: "low" }),
      buildEntry("high-risk", { riskLevel: "high" }),
      selectionRegistry,
    ) < 0,
  );
  assert.ok(
    compareSelectionCandidates(
      buildEntry("tiny", { contextSize: "tiny" }),
      buildEntry("large", { contextSize: "large" }),
      selectionRegistry,
    ) < 0,
  );
  assert.ok(
    compareSelectionCandidates(
      buildEntry("fresh", { lastUpdated: "2026-05-10T00:00:00.000Z" }),
      buildEntry("stale", { lastUpdated: "2026-05-01T00:00:00.000Z" }),
      selectionRegistry,
    ) < 0,
  );
});

void test("catalog selection ranking uses stars only as a late tie-breaker", () => {
  const selectionRegistry = buildSelectionRegistry();
  const lowStarEntry = buildEntry("alpha", {
    stars: 1,
    lastUpdated: "2026-05-01T00:00:00.000Z",
  });
  const highStarEntry = buildEntry("beta", {
    stars: 999,
    lastUpdated: "2026-05-01T00:00:00.000Z",
  });

  assert.ok(
    compareSelectionCandidates(highStarEntry, lowStarEntry, selectionRegistry) <
      0,
  );

  const lexicalWinner = buildEntry("aardvark", {
    stars: 5,
    lastUpdated: "2026-05-01T00:00:00.000Z",
  });
  const lexicalLoser = buildEntry("zebra", {
    stars: 5,
    lastUpdated: "2026-05-01T00:00:00.000Z",
  });

  assert.ok(
    compareSelectionCandidates(lexicalWinner, lexicalLoser, selectionRegistry) <
      0,
  );
});

void test("catalog selection builds duplicate-group, official, trusted-local, and fallback reasons", () => {
  const selectionRegistry = buildSelectionRegistry({
    duplicateGroups: [
      {
        id: "dup-a",
        capability: "workflow",
        preferredAuthorityTier: "official-first-party",
        selectionReason: "Use the canonical workflow pack.",
      },
    ],
  });

  assert.equal(
    buildSelectionReason(
      buildEntry("dup", { duplicateGroup: "dup-a" }),
      selectionRegistry,
    ),
    "Use the canonical workflow pack.",
  );
  assert.match(
    buildSelectionReason(
      buildEntry("official", { authorityTier: "official-marketplace" }),
      buildSelectionRegistry(),
    ),
    /official sources outrank/u,
  );
  assert.match(
    buildSelectionReason(
      buildEntry("local", { authorityTier: "trusted-local" }),
      buildSelectionRegistry(),
    ),
    /local curated source/u,
  );
  assert.match(
    buildSelectionReason(buildEntry("fallback"), buildSelectionRegistry()),
    /compatibility, portfolio fit, risk, and context-cost ordering/u,
  );
});

function buildDemandProfile(
  overrides: Partial<DemandProfile["signals"]> = {},
): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "fixtures/workspace",
    summary: { scannedFiles: 1, matchedFiles: 1 },
    signals: {
      languages: overrides.languages ?? [],
      packageManagers: overrides.packageManagers ?? [],
      frameworks: overrides.frameworks ?? [],
      concerns: overrides.concerns ?? [],
      tooling: overrides.tooling ?? [],
    },
    evidence: [],
  };
}

function buildSelectionRegistry(
  overrides: Partial<SelectionRegistry> = {},
): SelectionRegistry {
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
    ...overrides,
  };
}

function buildEntry(
  id: string,
  overrides: {
    authorityTier?: AssetCatalogEntry["source"]["authorityTier"];
    sourceKind?: AssetCatalogEntry["source"]["sourceKind"];
    assetKind?: AssetCatalogEntry["assetKind"];
    compatibilityMode?: AssetCatalogEntry["compatibilityMode"];
    installMethod?: AssetCatalogEntry["install"]["method"];
    relativePath?: string;
    capabilities?: string[];
    portfolioFit?: number;
    riskLevel?: AssetCatalogEntry["risk"]["level"];
    contextSize?: AssetCatalogEntry["contextCost"]["sizeClass"];
    stars?: number;
    lastUpdated?: string;
    duplicateGroup?: string;
  } = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: overrides.assetKind ?? "skill",
    hosts:
      overrides.assetKind === "mcp-server" ? ["shared"] : ["copilot-vscode"],
    compatibilityMode: overrides.compatibilityMode ?? "native",
    source: {
      sourceId: "fixture-source",
      authorityTier: overrides.authorityTier ?? "trusted-community",
      sourceKind: overrides.sourceKind ?? "repo",
      sourcePriority: 80,
      originUrl: `https://example.com/${id}`,
      publisher: "fixture-source",
      publisherVerified: false,
    },
    trust: { score: 80, signals: ["fixture"] },
    capabilities: overrides.capabilities ?? ["testing", id],
    install: {
      method: overrides.installMethod ?? "manifest-entry",
      nativeHosts: ["copilot-vscode"],
      relativePath: overrides.relativePath,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: `${id}.md`,
    },
    maintenance: {
      lastUpdated: overrides.lastUpdated ?? "2026-05-15T00:00:00.000Z",
      stars: overrides.stars ?? 0,
      releaseCadence: "active",
    },
    risk: {
      level: overrides.riskLevel ?? "low",
      hasHooks: overrides.riskLevel === "high",
      hasExecScripts: overrides.riskLevel === "high",
      requiresNetwork: false,
    },
    contextCost: {
      sizeClass: overrides.contextSize ?? "small",
      estimatedPromptWeight: 2,
    },
    fit: {
      portfolioFit: overrides.portfolioFit ?? 0.9,
      hostFit: 0.9,
    },
    dedupe: {
      duplicateGroup: overrides.duplicateGroup,
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
