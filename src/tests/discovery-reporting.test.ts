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
import {
  buildDiscoverDiffReport,
  writeDiscoverDiffReport,
} from "../domains/discovery/diff.js";
import { writeEnvironmentIndex } from "../domains/discovery/environment-index.js";
import {
  CATALOG_OUTPUT_PATH,
  DISCOVER_DIFF_OUTPUT_PATH,
  ENVIRONMENT_INDEX_OUTPUT_PATH,
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
    // Docs sources remain in the registry as provenance, but are metadata-only
    // and therefore excluded from enabled-source lifecycle reports.
    assert.equal(byId.has("docs-source"), false);
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
        {
          bundleId: 42,
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

void test("discover diff reports catalog-only metadata changes without recommendation impact", async () => {
  const baselineRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-discover-diff-metadata-base-"),
  );
  const currentRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-discover-diff-metadata-current-"),
  );

  try {
    await writeDiscoverDiffFixture(baselineRoot, {
      sourceIds: ["source-a"],
      catalogEntries: [buildEntry("asset-a", "source-a", "skill")],
      selectedEntries: [buildEntry("asset-a", "source-a", "skill")],
      rejectedCount: 0,
    });
    await writeDiscoverDiffFixture(currentRoot, {
      sourceIds: ["source-a"],
      catalogEntries: [
        buildEntry("asset-a", "source-a", "skill", { hosts: ["cursor"] }),
      ],
      selectedEntries: [buildEntry("asset-a", "source-a", "skill")],
      rejectedCount: 0,
      recommendationBundles: [
        {
          bundleId: "impact-bundle",
          assetIds: ["asset-a"],
        },
        {
          bundleId: "ignored-bundle",
          assetIds: [42],
        },
        {
          bundleId: 42,
          assetIds: ["asset-a"],
        },
      ],
    });

    const report = await buildDiscoverDiffReport({ baselineRoot, currentRoot });

    assert.deepEqual(report.selection.changed, []);
    assert.deepEqual(report.highImpactChanges, [
      "catalog metadata changed for 1 asset(s)",
    ]);
  } finally {
    await rm(baselineRoot, { recursive: true, force: true });
    await rm(currentRoot, { recursive: true, force: true });
  }
});

void test("discover diff writes human and JSON reports", async () => {
  const baselineRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-discover-diff-write-base-"),
  );
  const currentRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-discover-diff-write-current-"),
  );

  try {
    await writeDiscoverDiffFixture(baselineRoot, {
      sourceIds: ["source-a", "source-removed"],
      catalogEntries: [buildEntry("asset-a", "source-a", "skill")],
      selectedEntries: [buildEntry("asset-a", "source-a", "skill")],
      rejectedCount: 0,
    });
    await writeDiscoverDiffFixture(currentRoot, {
      sourceIds: ["source-a", "source-b"],
      catalogEntries: [
        buildEntry("asset-a", "source-a", "skill", { hosts: ["cursor"] }),
        buildEntry("asset-b", "source-b", "plugin"),
      ],
      selectedEntries: [
        buildEntry("asset-a", "source-a", "skill", { hosts: ["cursor"] }),
        buildEntry("asset-b", "source-b", "plugin"),
      ],
      rejectedCount: 0,
    });

    const humanOutput = await captureConsole(async () => {
      await writeDiscoverDiffReport(currentRoot, ["--baseline", baselineRoot]);
    });
    assert.match(humanOutput, /Discover diff: baseline -> current/u);
    assert.match(humanOutput, /Added: source-b/u);
    assert.match(humanOutput, /Removed: source-removed/u);
    assert.match(humanOutput, /selected asset added: asset-b/u);
    const persistedDiff = (await readJsonFile(
      join(currentRoot, ...DISCOVER_DIFF_OUTPUT_PATH),
    )) as { schemaVersion: number };
    assert.equal(persistedDiff.schemaVersion, 1);

    const jsonOutput = await captureConsole(async () => {
      await writeDiscoverDiffReport(currentRoot, [
        "--baseline",
        baselineRoot,
        "--json",
      ]);
    });
    const jsonReport = JSON.parse(jsonOutput) as {
      catalog: { added: string[] };
    };
    assert.equal(jsonReport.catalog.added[0], "asset-b");

    await assert.rejects(
      () => writeDiscoverDiffReport(currentRoot, []),
      /discover diff requires --baseline <stateRoot>/u,
    );
  } finally {
    await rm(baselineRoot, { recursive: true, force: true });
    await rm(currentRoot, { recursive: true, force: true });
  }
});

void test("environment index writes experimental query metadata for selected assets", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-environment-index-"),
  );

  try {
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [
        buildEntry("asset-a", "source-a", "skill", {
          queryMetadata: {
            symbolicHandle: "custom:asset-a",
            retrievalFacets: ["custom", "backend"],
            chunkingHints: {
              preferredStrategy: "section",
              maxPromptWeight: 3,
            },
            citation: {
              provenance: "custom-provenance",
              sourceUrl: "https://example.com/custom",
              sourceId: "source-a",
            },
            safetyFlags: ["network"],
          },
        }),
        buildEntry("asset-b", "source-b", "plugin", {
          hasExecScripts: true,
          requiresNetwork: true,
        }),
        buildEntry("asset-c", "source-c", "skill", {
          activationEligible: false,
          authorityTier: "unverified-community",
          filePath: "skills/asset-c.md",
          hasHooks: true,
        }),
        buildEntry("asset-d", "source-d", "reference-pack", {
          sizeClass: "large",
        }),
      ],
    );

    const output = await captureConsole(async () => {
      await writeEnvironmentIndex(projectRoot, ["--json"]);
    });
    const report = JSON.parse(output) as Awaited<
      ReturnType<typeof writeEnvironmentIndex>
    >;
    const persisted = (await readJsonFile(
      join(projectRoot, ...ENVIRONMENT_INDEX_OUTPUT_PATH),
    )) as typeof report;

    assert.equal(report.experimental, true);
    assert.equal(persisted.selectedAssetCount, 4);
    assert.equal(report.assets[0]?.symbolicHandle, "custom:asset-a");
    assert.deepEqual(report.assets[0]?.retrievalFacets, ["backend", "custom"]);
    assert.equal(report.assets[1]?.symbolicHandle, "source-b:plugin:asset-b");
    assert.deepEqual(report.assets[1]?.safetyFlags, [
      "exec-scripts",
      "network",
    ]);
    assert.equal(report.assets[2]?.chunkingHints.preferredStrategy, "file");
    assert.deepEqual(report.assets[2]?.safetyFlags, [
      "hooks",
      "not-activation-eligible",
      "unverified-community",
    ]);
    assert.equal(report.assets[3]?.chunkingHints.preferredStrategy, "section");
    assert.match(report.notes.join("\n"), /does not change mirror/u);

    const humanOutput = await captureConsole(async () => {
      await writeEnvironmentIndex(projectRoot);
    });
    assert.match(humanOutput, /Experimental environment index written/u);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
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
      bundleId: unknown;
      assetIds: unknown;
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
    authorityTier?: AssetCatalogEntry["source"]["authorityTier"];
    filePath?: string;
    hasExecScripts?: boolean;
    hasHooks?: boolean;
    requiresNetwork?: boolean;
    queryMetadata?: AssetCatalogEntry["queryMetadata"];
    sizeClass?: AssetCatalogEntry["contextCost"]["sizeClass"];
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
      authorityTier: overrides.authorityTier ?? "official-marketplace",
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
      filePath: overrides.filePath,
    },
    maintenance: {
      lastUpdated: "2026-05-15T00:00:00.000Z",
      stars: 0,
      releaseCadence: "active",
    },
    risk: {
      level: "low",
      hasHooks: overrides.hasHooks ?? false,
      hasExecScripts: overrides.hasExecScripts ?? false,
      requiresNetwork: overrides.requiresNetwork ?? false,
    },
    contextCost: {
      sizeClass: overrides.sizeClass ?? "tiny",
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
    queryMetadata: overrides.queryMetadata,
  };
}
