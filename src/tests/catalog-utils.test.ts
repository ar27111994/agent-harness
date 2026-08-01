import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAssetStatus,
  buildCandidateRankHint,
  buildCatalogId,
  buildRisk,
  buildTrustSignals,
  classifyContextCost,
  compareSourcesByPriority,
  computeHostFit,
  computePortfolioFit,
  computeTrustScore,
  deriveDisplayNameFromPath,
  enhanceTrustForEntry,
  findDuplicateGroup,
  humanizeSlug,
  mergeRemoteCatalogEntries,
  splitIntoKeywords,
  uniqueStrings,
} from "../domains/discovery/catalog-utils.js";
import type {
  AssetCatalogEntry,
  DemandProfile,
  SelectionRegistry,
  SourceDefinition,
} from "../types.js";

void test("catalog utilities classify risk, context, host fit, and rank hints across thresholds", () => {
  assert.deepEqual(buildRisk(false, false, false), {
    level: "low",
    hasHooks: false,
    hasExecScripts: false,
    requiresNetwork: false,
  });
  assert.deepEqual(buildRisk(true, false, false), {
    level: "medium",
    hasHooks: true,
    hasExecScripts: false,
    requiresNetwork: false,
  });
  assert.deepEqual(buildRisk(true, true, false), {
    level: "high",
    hasHooks: true,
    hasExecScripts: true,
    requiresNetwork: false,
  });

  assert.deepEqual(classifyContextCost(40), {
    sizeClass: "tiny",
    estimatedPromptWeight: 1,
  });
  assert.deepEqual(classifyContextCost(41), {
    sizeClass: "small",
    estimatedPromptWeight: 2,
  });
  assert.deepEqual(classifyContextCost(161), {
    sizeClass: "medium",
    estimatedPromptWeight: 4,
  });
  assert.deepEqual(classifyContextCost(401), {
    sizeClass: "large",
    estimatedPromptWeight: 8,
  });

  assert.equal(computeHostFit(["cursor"], "native"), 0.95);
  assert.equal(computeHostFit(["cursor", "copilot-vscode"], "native"), 1);
  assert.equal(computeHostFit(["cursor"], "adaptable"), 0.7);
  assert.equal(computeHostFit(["cursor"], "partial"), 0.45);
  assert.equal(computeHostFit(["cursor"], "reference-only"), 0.2);
  assert.equal(computeHostFit(["cursor"], "incompatible"), 0);

  assert.equal(
    buildCandidateRankHint("official-first-party"),
    "preferred-official",
  );
  assert.equal(
    buildCandidateRankHint("official-marketplace"),
    "preferred-official",
  );
  assert.equal(buildCandidateRankHint("trusted-local"), "preferred-local");
  assert.equal(
    buildCandidateRankHint("trusted-community"),
    "candidate-community",
  );
  assert.equal(
    buildCandidateRankHint("unverified-community"),
    "candidate-catalog",
  );
});

void test("catalog utilities compute demand fit, duplicate groups, ids, and display names", () => {
  const demandProfile = buildDemandProfile({
    languages: ["typescript"],
    packageManagers: ["npm"],
    frameworks: ["next.js"],
    concerns: ["testing"],
    tooling: ["playwright"],
  });
  assert.equal(
    computePortfolioFit(
      ["TypeScript", "next js", "playwright runner", "frontend"],
      demandProfile,
    ),
    0.6,
  );
  assert.equal(computePortfolioFit(["rust"], demandProfile), 0);
  assert.equal(computePortfolioFit([], null), 0);
  assert.equal(computePortfolioFit(["typescript"], buildDemandProfile()), 0);

  const selectionRegistry = buildSelectionRegistry();
  selectionRegistry.duplicateGroups.push({
    id: "dup-react-testing",
    capability: "react testing",
    preferredAuthorityTier: "official-first-party",
    selectionReason: "Prefer the strongest React testing asset.",
  });
  assert.equal(
    findDuplicateGroup(["React", "Testing utilities"], selectionRegistry),
    "dup-react-testing",
  );
  assert.equal(findDuplicateGroup(["Go"], selectionRegistry), undefined);

  assert.equal(
    buildCatalogId("source", "nested/path/skill.md"),
    "source:nested%2Fpath%2Fskill.md",
  );
  assert.equal(buildCatalogId("source", ""), "source:root");
  // --- splitIntoKeywords — basic and stopword filtering ---
  assert.deepEqual(splitIntoKeywords("agent.plugin.ts"), ["agent", "plugin"]);
  assert.deepEqual(splitIntoKeywords("the quick brown fox"), [
    "quick",
    "brown",
    "fox",
  ]);
  assert.deepEqual(splitIntoKeywords("a in the and of to for is"), []);
  assert.deepEqual(splitIntoKeywords("agent for the TypeScript"), [
    "agent",
    "typescript",
  ]);
  // --- single-char language IDs preserved ---
  assert.deepEqual(splitIntoKeywords("C programming"), ["c", "programming"]);
  assert.deepEqual(splitIntoKeywords("R language"), ["r", "language"]);
  assert.deepEqual(splitIntoKeywords("C and R"), ["c", "r"]);
  // --- single-char non-language tokens filtered ---
  assert.deepEqual(splitIntoKeywords("a b c x y z"), ["c"]);
  // --- C++ / F# normalisation ---
  assert.deepEqual(splitIntoKeywords("C++ project"), ["cpp", "project"]);
  assert.deepEqual(splitIntoKeywords("F# functional"), [
    "fsharp",
    "functional",
  ]);
  assert.deepEqual(splitIntoKeywords("c++ and F#"), ["cpp", "fsharp"]);
  // --- numeric-only filtered ---
  assert.deepEqual(splitIntoKeywords("version 2 0"), ["version"]);
  assert.deepEqual(splitIntoKeywords("123 4567"), []);
  // --- edge cases ---
  assert.deepEqual(splitIntoKeywords(""), []);
  assert.deepEqual(splitIntoKeywords("the a an"), []);
  assert.deepEqual(splitIntoKeywords("..."), []);
  assert.deepEqual(uniqueStrings(["b", "a", "b"]), ["b", "a"]);
  assert.equal(
    deriveDisplayNameFromPath("skills/repo-guide/SKILL.md"),
    "Repo Guide",
  );
  assert.equal(
    deriveDisplayNameFromPath("guides/copilot-instructions.md"),
    "Guides",
  );
  assert.equal(deriveDisplayNameFromPath("README.md"), "README");
  assert.equal(deriveDisplayNameFromPath("skills//SKILL.md"), "SKILL");
  assert.equal(deriveDisplayNameFromPath("/"), "");
  assert.equal(humanizeSlug("my_plugin/config.yaml"), "My Plugin Config");
});

void test("catalog utilities merge remote entries and source ordering stay stable", () => {
  const existingEntries = [
    buildEntry("alpha", { sourceId: "source-a" }),
    buildEntry("bravo", { sourceId: "source-b" }),
  ];
  const mergedEntries = mergeRemoteCatalogEntries(
    existingEntries,
    [
      buildEntry("alpha", { sourceId: "source-a", displayName: "Alpha New" }),
      buildEntry("charlie", { sourceId: "source-c" }),
    ],
    new Set(["source-a", "source-c"]),
  );

  assert.deepEqual(
    mergedEntries.map((entry) => [entry.id, entry.displayName]),
    [
      ["alpha", "Alpha New"],
      ["bravo", "bravo"],
      ["charlie", "charlie"],
    ],
  );

  const lowPriority = buildSource("zeta", 40);
  const highPriority = buildSource("alpha", 90);
  const samePriorityEarlierId = buildSource("alpha", 40);
  assert.ok(compareSourcesByPriority(highPriority, lowPriority) < 0);
  assert.ok(compareSourcesByPriority(lowPriority, samePriorityEarlierId) > 0);
});

void test("catalog utilities build asset status, trust scores, and trust signals from policy inputs", () => {
  assert.deepEqual(buildAssetStatus(buildSource("mirror-install", 80)), {
    cataloged: true,
    mirrorEligible: true,
    installEligible: true,
    activationEligible: true,
  });
  assert.deepEqual(
    buildAssetStatus({
      ...buildSource("catalog-only", 80),
      rules: {
        officialPreferred: true,
        allowMirror: true,
        allowInstall: false,
      },
    }),
    {
      cataloged: true,
      mirrorEligible: true,
      installEligible: false,
      activationEligible: false,
    },
  );

  const baseInput = {
    authorityTier: "official-first-party",
    sourceKind: "repo",
    sourcePriority: 95,
    publisherVerified: true,
    compatibilityMode: "native" as const,
  };
  assert.equal(
    computeTrustScore({ ...baseInput, installMethod: "local-file" }),
    119,
  );
  assert.equal(
    computeTrustScore({ ...baseInput, installMethod: "github-tree-metadata" }),
    117,
  );
  assert.equal(
    computeTrustScore({ ...baseInput, installMethod: "official-index-entry" }),
    115,
  );
  assert.equal(
    computeTrustScore({ ...baseInput, installMethod: "registry-summary" }),
    113,
  );
  assert.equal(
    computeTrustScore({
      ...baseInput,
      authorityTier: "experimental-source",
      sourcePriority: 0,
      publisherVerified: false,
      compatibilityMode: "incompatible",
      installMethod: "manual",
    }),
    8,
  );

  assert.deepEqual(
    buildTrustSignals({ ...baseInput, installMethod: "local-file" }),
    [
      "authority:official-first-party",
      "source-kind:repo",
      "source-priority:95",
      "compatibility:native",
      "install-method:local-file",
      "publisher-verified",
    ],
  );
  assert.deepEqual(
    buildTrustSignals({
      ...baseInput,
      publisherVerified: false,
      installMethod: "registry-summary",
    }),
    [
      "authority:official-first-party",
      "source-kind:repo",
      "source-priority:95",
      "compatibility:native",
      "install-method:registry-summary",
    ],
  );
});

void test("catalog utilities enhance trust for strong and weak evidence profiles", () => {
  const highlyTrusted = enhanceTrustForEntry(
    buildEntry("high-confidence", {
      trustScore: 50,
      stars: 1200,
      releaseCadence: "active",
      readmeFound: true,
      docsLinked: true,
      frontmatterFound: true,
      dependencies: ["dep-a"],
    }),
  );
  assert.equal(highlyTrusted.trust.score, 77);
  assert.deepEqual(highlyTrusted.trust.signals.slice(-6), [
    "stars:1000+",
    "maintenance:active",
    "readme-present",
    "docs-linked",
    "frontmatter-present",
    "dependencies-declared",
  ]);

  const lowEvidenceCommunity = enhanceTrustForEntry(
    buildEntry("low-evidence", {
      trustScore: 40,
      authorityTier: "trusted-community",
      stars: 0,
      readmeFound: false,
      docsLinked: false,
      releaseCadence: "archived",
      riskLevel: "high",
    }),
  );
  assert.equal(lowEvidenceCommunity.trust.score, 5);
  assert.ok(
    lowEvidenceCommunity.trust.signals.includes("maintenance:archived"),
  );
  assert.ok(lowEvidenceCommunity.trust.signals.includes("risk:high"));
  assert.ok(
    lowEvidenceCommunity.trust.signals.includes("community:low-evidence"),
  );

  const mediumRisk = enhanceTrustForEntry(
    buildEntry("medium-risk", {
      trustScore: 30,
      stars: 25,
      releaseCadence: "stale",
      readmeFound: false,
      docsLinked: false,
      riskLevel: "medium",
    }),
  );
  assert.equal(mediumRisk.trust.score, 29);
  assert.ok(mediumRisk.trust.signals.includes("stars:10+"));
  assert.ok(mediumRisk.trust.signals.includes("risk:medium"));

  const establishedEntry = enhanceTrustForEntry(
    buildEntry("established", {
      trustScore: 30,
      stars: 250,
      releaseCadence: "stale",
      readmeFound: false,
      docsLinked: false,
    }),
  );
  assert.equal(establishedEntry.trust.score, 38);
  assert.ok(establishedEntry.trust.signals.includes("stars:100+"));
});

function buildDemandProfile(
  overrides: Partial<DemandProfile["signals"]> = {},
): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "fixtures/workspace",
    summary: {
      scannedFiles: 1,
      matchedFiles: 1,
    },
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

function buildSelectionRegistry(): SelectionRegistry {
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

function buildSource(id: string, priority: number): SourceDefinition {
  return {
    id,
    name: id,
    kind: "repo",
    authorityTier: "official-first-party",
    publisher: { name: "fixture", verified: true },
    hosts: ["copilot-vscode"],
    assetKinds: ["skill"],
    discoveryMode: "catalog",
    priority,
    enabled: true,
    endpoints: { repo: `https://github.com/example/${id}` },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  };
}

function buildEntry(
  id: string,
  overrides: {
    sourceId?: string;
    displayName?: string;
    authorityTier?: AssetCatalogEntry["source"]["authorityTier"];
    trustScore?: number;
    stars?: number;
    releaseCadence?: AssetCatalogEntry["maintenance"]["releaseCadence"];
    readmeFound?: boolean;
    docsLinked?: boolean;
    frontmatterFound?: boolean;
    dependencies?: string[];
    riskLevel?: AssetCatalogEntry["risk"]["level"];
  } = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: overrides.displayName ?? id,
    assetKind: "skill",
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId: overrides.sourceId ?? "fixture-source",
      authorityTier: overrides.authorityTier ?? "official-first-party",
      sourceKind: "repo",
      sourcePriority: 80,
      originUrl: `https://example.com/${id}`,
      publisher: "fixture",
      publisherVerified: true,
    },
    trust: {
      score: overrides.trustScore ?? 60,
      signals: ["fixture"],
    },
    capabilities: ["typescript"],
    install: {
      method: "local-file",
      nativeHosts: ["copilot-vscode"],
    },
    evidence: {
      manifestFound: true,
      readmeFound: overrides.readmeFound ?? true,
      examplesFound: false,
      docsLinked: overrides.docsLinked ?? true,
      frontmatterFound: overrides.frontmatterFound,
      dependencies: overrides.dependencies,
    },
    maintenance: {
      lastUpdated: "2026-05-15T00:00:00.000Z",
      stars: overrides.stars ?? 0,
      releaseCadence: overrides.releaseCadence ?? "active",
    },
    risk: {
      level: overrides.riskLevel ?? "low",
      hasHooks: overrides.riskLevel === "high",
      hasExecScripts: overrides.riskLevel === "high",
      requiresNetwork: false,
    },
    contextCost: {
      sizeClass: "tiny",
      estimatedPromptWeight: 1,
    },
    fit: {
      portfolioFit: 1,
      hostFit: 0.95,
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
