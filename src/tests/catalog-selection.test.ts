import assert from "node:assert/strict";
import test from "node:test";

import {
  filterCatalogEntriesByDemandRelevance,
  buildRejectionSummary,
  catalogSelectionInternals,
} from "../domains/discovery/catalog-selection.js";
import { interactnoteFullDemandProfile } from "./fixtures/interactnote-full-demand-profile.js";
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

void test("selection relevance ignores concern-only phrases when trusted-local stack anchors are absent", () => {
  const demandProfile = createDemandProfile({
    languages: [],
    packageManagers: [],
    frameworks: [],
    concerns: ["docs", "research", "testing"],
    tooling: [],
  });
  const localSkill = createEntry(
    "docs-research-skill",
    ["docs", "research", "testing", "analysis"],
    {
      authorityTier: "trusted-local",
      sourceKind: "local-directory",
    },
  );

  const { selectedEntries, rejectedEntries } =
    filterCatalogEntriesByDemandRelevance([localSkill], demandProfile);

  assert.deepEqual(
    selectedEntries.map((entry) => entry.id),
    ["docs-research-skill"],
  );
  assert.deepEqual(
    rejectedEntries.map((entry) => entry.id),
    [],
  );
});

void test("selection relevance ignores windows path noise for trusted-local stack alignment", () => {
  const demandProfile = interactnoteFullDemandProfile;
  const localSkill = createEntry(
    "codebase-audit-pre-push",
    ["audit", "security", "documentation", "testing", "research"],
    {
      authorityTier: "trusted-local",
      sourceKind: "local-directory",
    },
    {
      filePath:
        "C:/Users/ar271/.agents/skills/codebase-audit-pre-push/SKILL.md",
    },
  );

  const { selectedEntries, rejectedEntries } =
    filterCatalogEntriesByDemandRelevance([localSkill], demandProfile);

  assert.deepEqual(
    selectedEntries.map((entry) => entry.id),
    [],
  );
  assert.deepEqual(
    rejectedEntries.map((entry) => entry.id),
    ["codebase-audit-pre-push"],
  );
});

void test("selection relevance rejects generic trusted-local skills for a real Flutter workspace demand profile", () => {
  const entries = [
    createEntry(
      "api-endpoint-builder",
      ["api", "backend", "integration", "testing", "automation"],
      {
        authorityTier: "trusted-local",
        sourceKind: "local-directory",
      },
    ),
    createEntry(
      "bug-hunter",
      ["debugging", "testing", "research", "logging", "security"],
      {
        authorityTier: "trusted-local",
        sourceKind: "local-directory",
      },
    ),
    createEntry(
      "codebase-audit-pre-push",
      ["audit", "security", "documentation", "testing", "research"],
      {
        authorityTier: "trusted-local",
        sourceKind: "local-directory",
      },
    ),
    createEntry(
      "audit-skills",
      ["security", "audit", "static", "analysis", "mobile", "android", "ios"],
      {
        authorityTier: "trusted-local",
        sourceKind: "local-directory",
      },
    ),
    createEntry(
      "ui-component",
      ["ui", "frontend", "components", "design-systems", "accessibility"],
      {
        authorityTier: "trusted-local",
        sourceKind: "local-directory",
      },
    ),
    createEntry(
      "ux-feedback",
      ["ux", "frontend", "research", "design-assets", "writing"],
      {
        authorityTier: "trusted-local",
        sourceKind: "local-directory",
      },
    ),
    createEntry(
      "flutter-architecting-apps",
      ["flutter", "dart", "mobile", "frontend", "ios"],
      {
        authorityTier: "trusted-local",
        sourceKind: "local-directory",
      },
    ),
    createEntry(
      "flutter-building-layouts",
      ["flutter", "dart", "layouts", "ui", "mobile"],
      {
        authorityTier: "trusted-local",
        sourceKind: "local-directory",
      },
    ),
    createEntry(
      "flutter-testing-apps",
      ["flutter", "dart", "testing", "mobile", "ios"],
      {
        authorityTier: "trusted-local",
        sourceKind: "local-directory",
      },
    ),
  ];

  const { selectedEntries, rejectedEntries } =
    filterCatalogEntriesByDemandRelevance(
      entries,
      interactnoteFullDemandProfile,
    );

  assert.deepEqual(selectedEntries.map((entry) => entry.id).sort(), [
    "flutter-architecting-apps",
    "flutter-building-layouts",
    "flutter-testing-apps",
  ]);
  assert.deepEqual(rejectedEntries.map((entry) => entry.id).sort(), [
    "api-endpoint-builder",
    "audit-skills",
    "bug-hunter",
    "codebase-audit-pre-push",
    "ui-component",
    "ux-feedback",
  ]);
});

void test("selection relevance ignores detector-only demand noise", () => {
  const entries = [
    createEntry("general-docs", ["documentation", "workflow"]),
    createEntry("general-testing", ["testing", "workflow"]),
  ];
  const demandProfile = createDemandProfile({
    languages: [],
    packageManagers: [],
    frameworks: [],
    concerns: ["detector:base"],
    tooling: [],
  });

  const { selectedEntries, rejectedEntries } =
    filterCatalogEntriesByDemandRelevance(entries, demandProfile);

  assert.deepEqual(
    selectedEntries.map((entry) => entry.id),
    ["general-docs", "general-testing"],
  );
  assert.deepEqual(rejectedEntries, []);
});

void test("selection relevance treats mixed generic and uncommon stack names as phrases", () => {
  const demandProfile = createDemandProfile({
    languages: [],
    packageManagers: [],
    frameworks: ["react native"],
    concerns: [],
    tooling: [],
  });
  const reactNativeEntry = createEntry("react-native-mobile", [
    "react",
    "native",
    "mobile",
  ]);
  const reactOnlyEntry = createEntry("react-web", ["react", "frontend"]);

  const { selectedEntries, rejectedEntries } =
    filterCatalogEntriesByDemandRelevance(
      [reactNativeEntry, reactOnlyEntry],
      demandProfile,
    );

  assert.deepEqual(
    selectedEntries.map((entry) => entry.id),
    ["react-native-mobile"],
  );
  assert.deepEqual(
    rejectedEntries.map((entry) => entry.id),
    ["react-web"],
  );
});

void test("selection relevance treats catalog-wide terms as low signal", () => {
  const entries = Array.from({ length: 210 }, (_, index) =>
    createEntry(`popular-sveltekit-${index}`, ["sveltekit", "generic"]),
  );
  const demandProfile = createDemandProfile({
    languages: [],
    packageManagers: [],
    frameworks: ["sveltekit"],
    concerns: [],
    tooling: [],
  });

  const { selectedEntries, rejectedEntries } =
    filterCatalogEntriesByDemandRelevance(entries, demandProfile);

  assert.deepEqual(selectedEntries, []);
  assert.equal(rejectedEntries.length, entries.length);
});

void test("selection relevance rejects trusted-local generic overlap without stack alignment", () => {
  const demandProfile = createDemandProfile({
    languages: ["dart"],
    packageManagers: ["pub"],
    frameworks: ["flutter"],
    concerns: ["frontend", "mobile", "testing", "integration"],
    tooling: [],
  });
  const genericLocalSkill = createEntry(
    "generic-mobile-testing",
    ["frontend", "mobile", "testing", "integration"],
    {
      authorityTier: "trusted-local",
      sourceKind: "local-directory",
    },
  );

  const { selectedEntries, rejectedEntries } =
    filterCatalogEntriesByDemandRelevance([genericLocalSkill], demandProfile);

  assert.deepEqual(selectedEntries, []);
  assert.deepEqual(
    rejectedEntries.map((entry) => entry.id),
    ["generic-mobile-testing"],
  );
});

void test("selection relevance uses low-signal overlap without treating concern phrases as stack anchors", () => {
  const demandProfile = createDemandProfile({
    languages: [],
    packageManagers: [],
    frameworks: [],
    concerns: ["api testing", "backend", "integration"],
    tooling: [],
  });
  const matchingEntry = createEntry("platform-testing-workflow", [
    "api",
    "testing",
    "backend",
    "integration",
  ]);
  const weakEntry = createEntry("api-only-note", ["api", "documentation"]);

  const { selectedEntries, rejectedEntries } =
    filterCatalogEntriesByDemandRelevance(
      [matchingEntry, weakEntry],
      demandProfile,
    );

  assert.deepEqual(
    selectedEntries.map((entry) => entry.id),
    ["platform-testing-workflow"],
  );
  assert.deepEqual(
    rejectedEntries.map((entry) => entry.id),
    ["api-only-note"],
  );
});

void test("selection relevance rejects trusted-local generic overlap when detector stack evidence is weak", () => {
  const demandProfile = createDemandProfile({
    languages: [],
    packageManagers: [],
    frameworks: [],
    concerns: ["frontend", "mobile", "testing", "integration"],
    tooling: ["storybook"],
  });
  const genericLocalSkill = createEntry(
    "generic-frontend-mobile-testing",
    ["frontend", "mobile", "testing", "integration"],
    {
      authorityTier: "trusted-local",
      sourceKind: "local-directory",
    },
  );

  const { selectedEntries, rejectedEntries } =
    filterCatalogEntriesByDemandRelevance([genericLocalSkill], demandProfile);

  assert.deepEqual(selectedEntries, []);
  assert.deepEqual(
    rejectedEntries.map((entry) => entry.id),
    ["generic-frontend-mobile-testing"],
  );
});

void test("selection relevance admits detector phrases without stack anchoring", () => {
  const demandProfile = createDemandProfile({
    languages: [],
    packageManagers: [],
    frameworks: [],
    concerns: [],
    tooling: ["detector:quantum flux"],
  });
  const matchingEntry = createEntry("detector-quantum-flux", [
    "quantum",
    "flux",
    "workflow",
  ]);

  const { selectedEntries } = filterCatalogEntriesByDemandRelevance(
    [matchingEntry],
    demandProfile,
  );

  assert.deepEqual(
    selectedEntries.map((entry) => entry.id),
    ["detector-quantum-flux"],
  );
});

void test("selection relevance supports uncommon concern phrases without stack anchoring", () => {
  const demandProfile = createDemandProfile({
    languages: [],
    packageManagers: [],
    frameworks: [],
    concerns: ["quantum flux"],
    tooling: [],
  });
  const matchingEntry = createEntry("quantum-flux-reference", [
    "quantum",
    "flux",
    "reference",
  ]);

  const { selectedEntries } = filterCatalogEntriesByDemandRelevance(
    [matchingEntry],
    demandProfile,
  );

  assert.deepEqual(
    selectedEntries.map((entry) => entry.id),
    ["quantum-flux-reference"],
  );
});

void test("selection relevance keeps absent catalog-wide terms specific", () => {
  const entries = Array.from({ length: 210 }, (_, index) =>
    createEntry(`popular-sveltekit-without-astro-${index}`, [
      "sveltekit",
      "generic",
    ]),
  );
  const demandProfile = createDemandProfile({
    languages: [],
    packageManagers: [],
    frameworks: ["astro"],
    concerns: [],
    tooling: [],
  });

  const { selectedEntries, rejectedEntries } =
    filterCatalogEntriesByDemandRelevance(entries, demandProfile);

  assert.deepEqual(selectedEntries, []);
  assert.equal(rejectedEntries.length, entries.length);
});

void test("selection relevance demotes catalog-common high-signal terms at large scale", () => {
  const entries = Array.from({ length: 210 }, (_, index) =>
    createEntry(`common-astro-${index}`, [
      "astro",
      index % 2 === 0 ? "frontend" : "documentation",
    ]),
  );
  const demandProfile = createDemandProfile({
    languages: [],
    packageManagers: [],
    frameworks: ["astro"],
    concerns: [],
    tooling: [],
  });

  const { selectedEntries, rejectedEntries } =
    filterCatalogEntriesByDemandRelevance(entries, demandProfile);

  assert.deepEqual(selectedEntries, []);
  assert.equal(rejectedEntries.length, entries.length);
});

void test("selection relevance admits executable MCP metadata paths only", () => {
  const demandProfile = createDemandProfile({
    concerns: ["unrelated-domain"],
    tooling: [],
  });
  const executableMcp = createEntry("metadata-mcp", ["unrelated"], {
    sourceKind: "repo",
  });
  executableMcp.assetKind = "mcp-server";
  executableMcp.hosts = ["shared"];
  executableMcp.install = {
    method: "github-tree-metadata",
    nativeHosts: ["shared"],
  };
  executableMcp.evidence = {
    ...executableMcp.evidence,
    filePath: "servers/metadata-mcp/server.ts",
  };
  const metadataOnlyMcp = createEntry("metadata-docs", ["unrelated"], {
    sourceKind: "repo",
  });
  metadataOnlyMcp.assetKind = "mcp-server";
  metadataOnlyMcp.hosts = ["shared"];
  metadataOnlyMcp.install = {
    method: "github-tree-metadata",
    nativeHosts: ["shared"],
  };
  metadataOnlyMcp.evidence = {
    ...metadataOnlyMcp.evidence,
    filePath: "servers/metadata-mcp/README.md",
  };

  const { selectedEntries, rejectedEntries } =
    filterCatalogEntriesByDemandRelevance(
      [executableMcp, metadataOnlyMcp],
      demandProfile,
    );

  assert.deepEqual(
    selectedEntries.map((entry) => entry.id),
    ["metadata-mcp"],
  );
  assert.deepEqual(
    rejectedEntries.map((entry) => entry.id),
    ["metadata-docs"],
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
  evidenceOverrides: Partial<AssetCatalogEntry["evidence"]> = {},
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
      ...evidenceOverrides,
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

// ─── buildRejectionSummary tests ─────────────────────────────────────────────

void test("buildRejectionSummary returns empty object for empty log", () => {
  assert.deepEqual(buildRejectionSummary([]), {});
});

void test("buildRejectionSummary counts each reason correctly", () => {
  const log = [
    { assetId: "a", reason: "demand-relevance" },
    { assetId: "b", reason: "demand-relevance" },
    { assetId: "c", reason: "duplicate" },
    { assetId: "d", reason: "demand-relevance" },
  ];
  assert.deepEqual(buildRejectionSummary(log), {
    "demand-relevance": 3,
    duplicate: 1,
  });
});

void test("buildRejectionSummary covers 100% of log entries", () => {
  const log = Array.from({ length: 50 }, (_, i) => ({
    assetId: `asset-${i}`,
    reason: i % 3 === 0 ? "duplicate" : "demand-relevance",
  }));
  const summary = buildRejectionSummary(log);
  const total = Object.values(summary).reduce((a, b) => a + b, 0);
  assert.equal(total, log.length, "total count must equal log length");
});

void test("buildRejectionSummary handles single-reason log", () => {
  const log = [
    { assetId: "x", reason: "demand-relevance" },
    { assetId: "y", reason: "demand-relevance" },
  ];
  const summary = buildRejectionSummary(log);
  assert.equal(Object.keys(summary).length, 1);
  assert.equal(summary["demand-relevance"], 2);
});

void test("buildRejectionSummary preserves arbitrary custom reason strings", () => {
  const log = [{ assetId: "z", reason: "policy-filtered" }];
  assert.deepEqual(buildRejectionSummary(log), { "policy-filtered": 1 });
});

void test("guarded term-index lookup throws when the index is inconsistent with the entries (#433)", () => {
  // Defense-in-depth guard: the public API always builds its own term index
  // from the same entry array, so a mismatch can only happen through an
  // internal wiring change. Exercise the guard via the internals seam and
  // assert the error names the offending entry instead of yielding undefined.
  const indexedEntry = createEntry("indexed-entry", ["security"]);
  const missingEntry = createEntry("missing-entry", ["security"]);
  const demandProfile = createDemandProfile({ concerns: ["security"] });

  const inconsistentTermData = catalogSelectionInternals.buildCatalogTermData([
    indexedEntry,
  ]);
  const demandTerms = catalogSelectionInternals.buildDemandTermSet(
    demandProfile,
    inconsistentTermData.documentFrequency,
    1,
  );

  assert.throws(
    () =>
      catalogSelectionInternals.selectRelevantEntries(
        [indexedEntry, missingEntry],
        inconsistentTermData,
        demandTerms,
      ),
    /catalog term index missing entry during demand relevance filtering: missing-entry/u,
  );

  // Consistent index partitions correctly through the same guarded path.
  const consistentResult = catalogSelectionInternals.selectRelevantEntries(
    [indexedEntry, missingEntry],
    catalogSelectionInternals.buildCatalogTermData([
      indexedEntry,
      missingEntry,
    ]),
    demandTerms,
  );
  assert.equal(consistentResult.selectedEntries.length, 2);
  assert.equal(consistentResult.rejectedEntries.length, 0);
});
