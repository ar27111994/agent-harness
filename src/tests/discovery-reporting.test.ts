import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readJsonFile, writeJsonFile, writeJsonLinesFile } from "../files.js";
import {
  inspectCatalog,
  printCatalogStats,
} from "../domains/discovery/catalog-inspection.js";
import { buildDiscoverDiffReport } from "../domains/discovery/diff.js";
import {
  CATALOG_OUTPUT_PATH,
  SOURCE_INDEX_OUTPUT_PATH,
  SOURCE_UTILIZATION_OUTPUT_PATH,
} from "../domains/discovery/output-paths.js";
import { generateSourceIndex } from "../domains/discovery/source-index.js";
import { writeSourceUtilizationReport } from "../domains/discovery/source-utilization.js";
import type {
  AssetCatalogEntry,
  SelectionRegistry,
  SourceDefinition,
} from "../types.js";
import type { SourceSyncState } from "../domains/discovery/source-sync.js";

void test("discovery reporting writes source index and source utilization artifacts with defaults and sync state", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-reporting-"));

  try {
    const sources = [
      buildSource("repo-source", "repo", 90, ["copilot-vscode"], ["skill"]),
      buildSource("docs-source", "docs", 70, ["cursor"], ["reference-pack"], {
        docsUrl: "https://example.com/docs",
      }),
      buildSource(
        "marketplace-source",
        "marketplace",
        80,
        ["cursor"],
        ["plugin"],
        { baseUrl: "https://example.com/marketplace" },
      ),
    ];
    await writeRegistry(projectRoot, sources);
    await writeSourcePacks(projectRoot);
    await writeJsonFile(
      join(projectRoot, "discover", "official-skills-indexes.json"),
      {
        schemaVersion: 1,
        indexes: [{ id: "official-alpha" }, { id: 42 }, {}],
      },
    );
    await writeJsonFile(
      join(projectRoot, "discover", "official-upstreams.json"),
      {
        schemaVersion: 1,
        owners: { Anthropic: ["anthropics"] },
      },
    );
    await writeJsonFile(
      join(projectRoot, "state", "discover", "source-sync.json"),
      buildSourceSyncState(),
    );

    const sourceIndex = await generateSourceIndex(projectRoot);
    const persistedIndex = (await readJsonFile(
      join(projectRoot, ...SOURCE_INDEX_OUTPUT_PATH),
    )) as { sourceCount: number };

    assert.equal(sourceIndex.sourceCount, persistedIndex.sourceCount);
    assert.equal(
      sourceIndex.configurationInputs.checkedInRegistryPath,
      "discover/sources.json",
    );
    assert.deepEqual(sourceIndex.configurationInputs.sourcePackFiles, [
      "discover/source-packs/community.json",
      "discover/source-packs/extra.json",
    ]);
    assert.deepEqual(sourceIndex.configurationInputs.officialSkillIndexIds, [
      "official-alpha",
    ]);
    assert.deepEqual(
      sourceIndex.configurationInputs.officialUpstreamNamespaces,
      ["Anthropic"],
    );

    const byId = new Map(
      sourceIndex.enabledSources.map((source) => [source.id, source]),
    );
    assert.equal(byId.get("repo-source")?.coverageMode, "rotating");
    assert.equal(byId.get("docs-source")?.coverageMode, "direct");
    assert.equal(byId.get("marketplace-source")?.coverageMode, "indexed");
    assert.equal(byId.get("marketplace-source")?.syncStatus, "complete");
    assert.equal(byId.get("local-claude-code-config")?.coverageMode, "direct");
    assert.equal(
      byId.get("local-claude-code-config")?.syncStatus,
      "not-applicable",
    );

    await writeSourceUtilizationReport(
      projectRoot,
      sources,
      [
        buildEntry("operational-skill", "repo-source", "skill"),
        buildEntry("reference-only", "docs-source", "reference-pack", {
          manifestFound: false,
          mirrorEligible: false,
          installEligible: false,
          activationEligible: false,
        }),
      ],
      buildSourceSyncState(),
    );

    const utilization = (await readJsonFile(
      join(projectRoot, ...SOURCE_UTILIZATION_OUTPUT_PATH),
    )) as {
      configuredSourceCount: number;
      operationalSourceCount: number;
      dormantSourceCount: number;
      sources: Array<Record<string, unknown>>;
    };
    const sourceUtilizationById = new Map(
      utilization.sources.map((source) => [source.id, source]),
    );

    assert.equal(utilization.configuredSourceCount, 3);
    assert.equal(utilization.operationalSourceCount, 1);
    assert.equal(utilization.dormantSourceCount, 1);
    assert.equal(sourceUtilizationById.get("repo-source")?.status, "active");
    assert.equal(
      sourceUtilizationById.get("docs-source")?.status,
      "reference-only",
    );
    assert.equal(
      sourceUtilizationById.get("marketplace-source")?.status,
      "dormant",
    );
    assert.equal(
      sourceUtilizationById.get("marketplace-source")?.coverageMode,
      "indexed",
    );
    assert.equal(
      sourceUtilizationById.get("marketplace-source")?.syncStatus,
      "complete",
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("discover diff reports source catalog and selection changes", async () => {
  const baselineRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-discover-diff-base-"),
  );
  const currentRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-discover-diff-current-"),
  );

  try {
    await writeDiscoverDiffFixture(baselineRoot, {
      sourceIds: ["source-a"],
      catalogEntries: [buildEntry("asset-a", "source-a", "skill")],
      selectedEntries: [buildEntry("asset-a", "source-a", "skill")],
      rejectedCount: 0,
    });
    await writeDiscoverDiffFixture(currentRoot, {
      sourceIds: ["source-a", "source-b"],
      catalogEntries: [
        buildEntry("asset-a", "source-a", "skill", { hosts: ["cursor"] }),
        buildEntry("asset-b", "source-b", "plugin", { hosts: ["cursor"] }),
      ],
      selectedEntries: [buildEntry("asset-b", "source-b", "plugin")],
      rejectedCount: 1,
      recommendationBundles: [
        {
          bundleId: "cursor-core",
          assetIds: ["asset-b"],
        },
      ],
    });

    const report = await buildDiscoverDiffReport({ baselineRoot, currentRoot });

    assert.deepEqual(report.sources.added, ["source-b"]);
    assert.deepEqual(report.catalog.added, ["asset-b"]);
    assert.deepEqual(report.catalog.changed, ["asset-a"]);
    assert.deepEqual(report.selection.added, ["asset-b"]);
    assert.deepEqual(report.selection.removed, ["asset-a"]);
    assert.deepEqual(report.counts.catalog, { baseline: 1, current: 2 });
    assert.match(report.highImpactChanges.join("\n"), /selected asset added/u);
    assert.match(
      report.highImpactChanges.join("\n"),
      /suggested bundle impacted: cursor-core/u,
    );
  } finally {
    await rm(baselineRoot, { recursive: true, force: true });
    await rm(currentRoot, { recursive: true, force: true });
  }
});

void test("catalog inspection prints aggregate stats and filtered matches with limit parsing", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-inspection-"),
  );

  try {
    const catalogEntries = [
      buildEntry("asset-a", "source-a", "skill"),
      buildEntry("asset-b", "source-a", "plugin", { hosts: ["cursor"] }),
      buildEntry("asset-c", "source-b", "reference-pack", {
        hosts: ["cursor", "opencode"],
      }),
    ];
    await writeJsonLinesFile(
      join(projectRoot, ...CATALOG_OUTPUT_PATH),
      catalogEntries,
    );
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [catalogEntries[0], catalogEntries[2]],
    );
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.rejected.jsonl"),
      [catalogEntries[1]],
    );

    const statsOutput = await captureConsole(() =>
      printCatalogStats(projectRoot),
    );
    const stats = JSON.parse(statsOutput) as Record<string, unknown>;
    assert.equal(stats.catalogCount, 3);
    assert.equal(stats.selectedCount, 2);
    assert.equal(stats.rejectedCount, 1);
    assert.deepEqual(stats.bySource, { "source-a": 2, "source-b": 1 });
    assert.deepEqual(stats.byAssetKind, {
      skill: 1,
      plugin: 1,
      "reference-pack": 1,
    });
    assert.deepEqual(stats.byHost, {
      "copilot-vscode": 1,
      cursor: 2,
      opencode: 1,
    });

    const filteredOutput = await captureConsole(() =>
      inspectCatalog(projectRoot, ["--source", "source-a", "--limit", "bogus"]),
    );
    const filtered = JSON.parse(filteredOutput) as {
      totalMatches: number;
      sourceId: string | null;
      assetId: string | null;
      results: Array<{ id: string }>;
    };
    assert.equal(filtered.totalMatches, 2);
    assert.equal(filtered.sourceId, "source-a");
    assert.equal(filtered.assetId, null);
    assert.deepEqual(
      filtered.results.map((entry) => entry.id),
      ["asset-a", "asset-b"],
    );

    const assetOutput = await captureConsole(() =>
      inspectCatalog(projectRoot, ["--id", "asset-c", "--limit", "0"]),
    );
    const assetOnly = JSON.parse(assetOutput) as {
      totalMatches: number;
      results: Array<{ id: string }>;
    };
    assert.equal(assetOnly.totalMatches, 1);
    assert.deepEqual(assetOnly.results, []);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

async function captureConsole(callback: () => Promise<void>): Promise<string> {
  const originalLog = globalThis.console.log;
  const calls: string[] = [];
  globalThis.console.log = (...args: unknown[]) => {
    calls.push(args.join(" "));
  };

  try {
    await callback();
  } finally {
    globalThis.console.log = originalLog;
  }

  return calls.join("\n");
}

async function writeRegistry(
  projectRoot: string,
  sources: SourceDefinition[],
): Promise<void> {
  await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources,
  });
  await writeJsonFile(
    join(projectRoot, "discover", "selections.json"),
    buildSelectionRegistry(),
  );
}

async function writeDiscoverDiffFixture(
  projectRoot: string,
  input: {
    sourceIds: string[];
    catalogEntries: AssetCatalogEntry[];
    selectedEntries: AssetCatalogEntry[];
    rejectedCount: number;
    recommendationBundles?: Array<{
      bundleId: string;
      assetIds: string[];
    }>;
  },
): Promise<void> {
  await writeJsonFile(join(projectRoot, ...SOURCE_INDEX_OUTPUT_PATH), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceCount: input.sourceIds.length,
    byAuthorityTier: {},
    byKind: {},
    hostCoverage: {},
    communityDefaultPolicy: "catalog-only-unless-promoted",
    configurationInputs: {
      checkedInRegistryPath: "discover/sources.json",
      sourcePackFiles: [],
      officialSkillIndexIds: [],
      officialUpstreamNamespaces: [],
    },
    enabledSources: input.sourceIds.map((sourceId, index) => ({
      id: sourceId,
      kind: "repo",
      authorityTier: "official-marketplace",
      priority: 100 - index,
      hosts: ["copilot-vscode"],
      coverageMode: "direct",
      syncStatus: "not-applicable",
    })),
  });
  await writeJsonLinesFile(
    join(projectRoot, ...CATALOG_OUTPUT_PATH),
    input.catalogEntries,
  );
  await writeJsonLinesFile(
    join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
    input.selectedEntries,
  );
  await writeJsonFile(
    join(projectRoot, "discover", "output", "selection-report.json"),
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      inputCount: input.catalogEntries.length,
      selectedCount: input.selectedEntries.length,
      rejectedCount: input.rejectedCount,
      duplicateDecisions: [],
    },
  );
  if (input.recommendationBundles) {
    await writeJsonFile(join(projectRoot, "state", "recommendations.json"), {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      policyVersion: 1,
      sessionIntent: "general",
      topByHost: {},
      hostSummaries: {},
      suggestedBundles: input.recommendationBundles,
    });
  }
}

async function writeSourcePacks(projectRoot: string): Promise<void> {
  await writeJsonFile(
    join(projectRoot, "discover", "source-packs", "community.json"),
    {
      schemaVersion: 1,
      entries: [],
    },
  );
  await writeJsonFile(
    join(projectRoot, "discover", "source-packs", "extra.json"),
    {
      schemaVersion: 1,
      entries: [],
    },
  );
}

function buildSourceSyncState(): SourceSyncState {
  return {
    schemaVersion: 1,
    generatedAt: "2026-05-15T00:00:00.000Z",
    sources: [
      {
        sourceId: "marketplace-source",
        coverageMode: "indexed",
        status: "complete",
        lastSyncedAt: "2026-05-15T00:00:00.000Z",
        indexedEntryCount: 5,
        cursors: [],
      },
    ],
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

function buildSource(
  id: string,
  kind: SourceDefinition["kind"],
  priority: number,
  hosts: SourceDefinition["hosts"],
  assetKinds: SourceDefinition["assetKinds"],
  endpoints?: SourceDefinition["endpoints"],
): SourceDefinition {
  return {
    id,
    name: id,
    kind,
    authorityTier:
      kind === "docs" ? "official-first-party" : "official-marketplace",
    publisher: { name: "fixture", verified: true },
    hosts,
    assetKinds,
    discoveryMode: "catalog",
    priority,
    enabled: true,
    endpoints: endpoints ?? { repo: `https://github.com/example/${id}` },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  };
}

function buildEntry(
  id: string,
  sourceId: string,
  assetKind: AssetCatalogEntry["assetKind"],
  overrides: {
    hosts?: AssetCatalogEntry["hosts"];
    manifestFound?: boolean;
    mirrorEligible?: boolean;
    installEligible?: boolean;
    activationEligible?: boolean;
  } = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind,
    hosts: overrides.hosts ?? ["copilot-vscode"],
    compatibilityMode:
      assetKind === "reference-pack" ? "reference-only" : "native",
    source: {
      sourceId,
      authorityTier: "official-marketplace",
      sourceKind: assetKind === "reference-pack" ? "docs" : "repo",
      sourcePriority: 80,
      originUrl: `https://example.com/${id}`,
      publisher: "fixture",
      publisherVerified: true,
    },
    trust: {
      score: 90,
      signals: ["fixture"],
    },
    capabilities: [assetKind],
    install: {
      method: assetKind === "reference-pack" ? "docs-reference" : "local-file",
      nativeHosts:
        assetKind === "reference-pack"
          ? undefined
          : (overrides.hosts ?? ["copilot-vscode"]),
      manifestEntry: id,
    },
    evidence: {
      manifestFound: overrides.manifestFound ?? true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
    },
    maintenance: {
      lastUpdated: "2026-05-15T00:00:00.000Z",
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
      sizeClass: "tiny",
      estimatedPromptWeight: 1,
    },
    fit: {
      portfolioFit: 0.8,
      hostFit: 0.95,
    },
    dedupe: {
      candidateRankHint: "fixture",
    },
    status: {
      cataloged: true,
      mirrorEligible: overrides.mirrorEligible ?? true,
      installEligible: overrides.installEligible ?? true,
      activationEligible: overrides.activationEligible ?? true,
    },
  };
}
