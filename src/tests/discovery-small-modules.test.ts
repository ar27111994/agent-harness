import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { readJsonFile, writeJsonFile, writeJsonLinesFile } from "../files.js";
import {
  inspectCatalog,
  printCatalogStats,
} from "../domains/discovery/catalog-inspection.js";
import { buildDemandProfile } from "../domains/discovery/demand-profile.js";
import {
  extractMarkdownMetadata,
  getFirstStringField,
} from "../domains/discovery/markdown-metadata.js";
import {
  collectNpmMcpSearchQueriesFromDemandProfile,
  collectPackageCandidatesFromDemandProfile,
} from "../domains/discovery/package-candidates.js";
import {
  fetchVsCodeMarketplaceItemsForQuery,
  selectDemandQueries,
} from "../domains/discovery/reference-harvesters.js";
import {
  loadRemoteHarvestState,
  writeRemoteHarvestState,
} from "../domains/discovery/remote-state.js";
import { loadSourceRegistry } from "../domains/discovery/source-registry.js";
import { generateSourceIndex } from "../domains/discovery/source-index.js";
import { writeSourceUtilizationReport } from "../domains/discovery/source-utilization.js";
import type {
  AssetCatalogEntry,
  DemandProfile,
  SourceDefinition,
} from "../types.js";

void test("remote harvest state validates malformed payloads and preserves valid writes", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-remote-state-"),
  );
  const statePath = join(
    projectRoot,
    "state",
    "discover",
    "remote-harvest.json",
  );

  try {
    assert.deepEqual(await loadRemoteHarvestState(projectRoot), {
      schemaVersion: 1,
      generatedAt: new Date(0).toISOString(),
      nextRepoOffset: 0,
      completedSourceIds: [],
    });

    for (const invalidState of [
      [],
      {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        nextRepoOffset: 0,
        completedSourceIds: [],
      },
      {
        schemaVersion: 1,
        generatedAt: 42,
        nextRepoOffset: 0,
        completedSourceIds: [],
      },
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        nextRepoOffset: "1",
        completedSourceIds: [],
      },
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        nextRepoOffset: 1,
        completedSourceIds: "source-a",
      },
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        nextRepoOffset: 1,
        completedSourceIds: ["source-a", 2],
      },
    ]) {
      await writeJsonFile(statePath, invalidState);
      assert.deepEqual(await loadRemoteHarvestState(projectRoot), {
        schemaVersion: 1,
        generatedAt: new Date(0).toISOString(),
        nextRepoOffset: 0,
        completedSourceIds: [],
      });
    }

    const validState = {
      schemaVersion: 1 as const,
      generatedAt: "2026-05-15T12:00:00.000Z",
      nextRepoOffset: 17,
      completedSourceIds: ["source-a", "source-b"],
    };
    await writeRemoteHarvestState(projectRoot, validState);

    assert.deepEqual(await loadRemoteHarvestState(projectRoot), validState);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("demand profile skips inspectable files without signals and sorts evidence paths", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-demand-small-"),
  );

  try {
    await writeFixtureFiles(projectRoot, [
      {
        path: "z-package/package.json",
        content: JSON.stringify({ dependencies: { react: "latest" } }),
      },
      {
        path: "a-api/requirements.txt",
        content: "fastapi\npytest\n",
      },
      {
        path: "config/settings.json",
        content: "{}",
      },
    ]);

    const profile = await buildDemandProfile(projectRoot);

    assert.equal(profile.summary.scannedFiles, 3);
    assert.equal(profile.summary.matchedFiles, 2);
    assert.ok(profile.signals.frameworks.includes("react"));
    assert.ok(profile.signals.frameworks.includes("fastapi"));
    assert.deepEqual(
      profile.evidence.map((entry) => entry.path),
      ["a-api/requirements.txt", "z-package/package.json"],
    );
    assert.ok(
      !profile.evidence.some((entry) => entry.path === "config/settings.json"),
      "generic structured files without matched signals should be skipped",
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("markdown metadata parses supported frontmatter and falls back cleanly when delimiters are malformed", () => {
  const metadata = extractMarkdownMetadata(
    [
      "---",
      "name: Example Skill",
      "unknownKey: should be ignored",
      "tags:",
      "  - 'alpha'",
      "  - beta",
      'dependencies: ["dep-a", "dep-b"]',
      "auth: github",
      "requiresEnv:",
      "  - API_KEY",
      "requiresHostLogin:",
      "  - cursor",
      "requiresOAuth:",
      "  - google",
      "setupUrl: https://example.com/setup",
      "description:",
      "This line should terminate the description array context",
      "---",
      "",
      "# Example Skill",
      "<!-- hidden note -->",
      "**skip this lead-in**",
      "Actual summary line.",
    ].join("\n"),
  );

  assert.deepEqual(metadata.fields.tags, ["alpha", "beta"]);
  assert.deepEqual(metadata.dependencies, ["dep-a", "dep-b"]);
  assert.deepEqual(metadata.authProviders, ["github"]);
  assert.deepEqual(metadata.requiredEnvVars, ["API_KEY"]);
  assert.deepEqual(metadata.setupUrls, ["https://example.com/setup"]);
  assert.equal(metadata.heading, "Example Skill");
  assert.equal(metadata.description, "Actual summary line.");
  assert.ok(metadata.prerequisites.length >= 4);
  assert.equal(getFirstStringField(metadata.fields.description), null);

  const malformedFrontmatter = extractMarkdownMetadata(
    "--- not really\n# Heading\nBody text\n",
  );
  assert.deepEqual(malformedFrontmatter.fields, {});
  assert.equal(malformedFrontmatter.heading, "Heading");
  assert.equal(malformedFrontmatter.description, "--- not really");
});

void test("package candidate helpers sanitize prefixes, add MCP seed queries, and handle null demand", () => {
  const demandProfile = createDemandProfile({
    concerns: ["mcp", "cloud", "backend"],
    tooling: [
      "npm:@modelcontextprotocol/sdk",
      "pub:firebase_core",
      "go:github.com/acme/agent",
    ],
    evidence: [
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: [],
          packageManagers: [],
          frameworks: [],
          concerns: [],
          tooling: [
            "npm:@modelcontextprotocol/sdk",
            "go:github.com/acme/agent",
          ],
        },
      },
    ],
  });

  assert.deepEqual(collectNpmMcpSearchQueriesFromDemandProfile(null), []);
  assert.deepEqual(
    collectPackageCandidatesFromDemandProfile(demandProfile, "npm"),
    ["@modelcontextprotocol/sdk"],
  );
  assert.deepEqual(
    collectPackageCandidatesFromDemandProfile(demandProfile, "go"),
    ["github.com/acme/agent"],
  );
  const queries = collectNpmMcpSearchQueriesFromDemandProfile(demandProfile);
  assert.ok(queries.includes("keywords:mcp-server"));
  assert.ok(queries.includes("model context protocol server"));
  assert.ok(queries.includes("modelcontextprotocol mcp server"));
  assert.ok(queries.includes("sdk mcp server"));
  assert.ok(queries.includes("firebase mcp server"));
  assert.ok(queries.includes("core mcp server"));
  assert.ok(queries.includes("github mcp server"));
  assert.ok(queries.includes("com mcp server"));
  assert.ok(!queries.includes("cloud mcp server"));
  assert.ok(!queries.includes("backend mcp server"));
});

void test("catalog inspection prints stats and falls back to bounded default limits", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-catalog-inspect-"),
  );
  const entries = [
    createCatalogEntry("skill-a", "source-a", { hosts: ["cursor", "zed"] }),
    createCatalogEntry("skill-b", "source-b", { assetKind: "plugin" }),
  ];

  try {
    await writeJsonLinesFile(
      join(projectRoot, "discover", "catalog.assets.jsonl"),
      entries,
    );
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [entries[0]],
    );
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.rejected.jsonl"),
      [entries[1]],
    );

    const stats = JSON.parse(
      await captureConsole(async () => {
        await printCatalogStats(projectRoot);
      }),
    ) as Record<string, unknown>;
    assert.equal(stats.catalogCount, 2);
    assert.deepEqual(stats.byHost, { cursor: 1, zed: 1, "copilot-vscode": 1 });

    const inspection = JSON.parse(
      await captureConsole(async () => {
        await inspectCatalog(projectRoot, ["--limit", "invalid"]);
      }),
    ) as { totalMatches: number; results: Array<{ id: string }> };
    assert.equal(inspection.totalMatches, 2);
    assert.deepEqual(
      inspection.results.map((entry) => entry.id),
      ["skill-a", "skill-b"],
    );

    const defaultInspection = JSON.parse(
      await captureConsole(async () => {
        await inspectCatalog(projectRoot, []);
      }),
    ) as { totalMatches: number; results: Array<{ id: string }> };
    assert.equal(defaultInspection.totalMatches, 2);
    assert.equal(defaultInspection.results.length, 2);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("source index applies default sync coverage and records optional configuration inputs", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-index-"),
  );

  try {
    await copyDiscoveryFixture(projectRoot, "sources.json");
    await copyDiscoveryFixture(projectRoot, "selections.json");
    await writeJsonFile(
      join(projectRoot, "discover", "official-skills-indexes.json"),
      {
        schemaVersion: 1,
        indexes: [
          { id: "beta-index" },
          { id: "alpha-index" },
          { url: "https://example.com/no-id" },
        ],
      },
    );
    await writeJsonFile(
      join(projectRoot, "discover", "official-upstreams.json"),
      {
        schemaVersion: 1,
        owners: { zeta: ["zeta"], alpha: ["alpha"] },
      },
    );
    await writeJsonFile(
      join(projectRoot, "discover", "source-packs", "pack-b.json"),
      {
        schemaVersion: 1,
        entries: [
          {
            id: "acme-agent-pack",
            repo: "https://github.com/acme/agent-pack",
            authorityTier: "unverified-community",
            assetKinds: ["skill"],
          },
        ],
      },
    );

    const sourceIndex = await generateSourceIndex(projectRoot);
    const byId = new Map(
      sourceIndex.enabledSources.map((source) => [source.id, source]),
    );

    assert.equal(byId.get("cursor-docs")?.coverageMode, "direct");
    assert.equal(byId.get("cursor-docs")?.syncStatus, "not-applicable");
    assert.equal(byId.get("mcp-registry")?.coverageMode, "sampled");
    assert.equal(byId.get("mcp-registry")?.syncStatus, "unsupported");
    assert.equal(byId.get("mattpocock-skills")?.coverageMode, "rotating");
    assert.equal(byId.get("mattpocock-skills")?.syncStatus, "not-applicable");
    assert.deepEqual(sourceIndex.configurationInputs.sourcePackFiles, [
      "discover/source-packs/pack-b.json",
    ]);
    assert.deepEqual(sourceIndex.configurationInputs.officialSkillIndexIds, [
      "alpha-index",
      "beta-index",
    ]);
    assert.deepEqual(
      sourceIndex.configurationInputs.officialUpstreamNamespaces,
      ["alpha", "zeta"],
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("source utilization reports active, reference-only, and dormant sources with default sync states", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-utilization-"),
  );
  const enabledSources = [
    createSourceDefinition("docs-source", "docs"),
    createSourceDefinition("registry-source", "registry"),
    createSourceDefinition("repo-source", "repo"),
  ];
  const catalogEntries = [
    createCatalogEntry("docs-entry", "docs-source", { sourceKind: "docs" }),
    createCatalogEntry("registry-entry", "registry-source", {
      sourceKind: "registry",
      evidence: {
        manifestFound: false,
        readmeFound: true,
        examplesFound: false,
        docsLinked: true,
        filePath: "registry-entry.md",
      },
      status: {
        cataloged: true,
        mirrorEligible: false,
        installEligible: false,
        activationEligible: false,
      },
    }),
  ];

  try {
    await writeSourceUtilizationReport(
      projectRoot,
      enabledSources,
      catalogEntries,
    );
    const report = await readJsonFile<{
      sources: Array<{
        id: string;
        status: string;
        coverageMode: string;
        syncStatus: string;
        operational: boolean;
      }>;
      operationalSourceCount: number;
      dormantSourceCount: number;
    }>(join(projectRoot, "discover", "output", "source-utilization.json"));

    const byId = new Map(report.sources.map((source) => [source.id, source]));
    assert.equal(byId.get("docs-source")?.status, "active");
    assert.equal(byId.get("docs-source")?.coverageMode, "direct");
    assert.equal(byId.get("docs-source")?.syncStatus, "not-applicable");
    assert.equal(byId.get("registry-source")?.status, "reference-only");
    assert.equal(byId.get("registry-source")?.coverageMode, "sampled");
    assert.equal(byId.get("registry-source")?.syncStatus, "unsupported");
    assert.equal(byId.get("repo-source")?.status, "dormant");
    assert.equal(byId.get("repo-source")?.coverageMode, "rotating");
    assert.equal(byId.get("repo-source")?.syncStatus, "not-applicable");
    assert.equal(report.operationalSourceCount, 1);
    assert.equal(report.dormantSourceCount, 1);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("source registry adds unique source-pack repos and skips duplicate repo identities", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-registry-"),
  );

  try {
    await copyDiscoveryFixture(projectRoot, "sources.json");
    await writeJsonFile(
      join(projectRoot, "discover", "source-packs", "pack.json"),
      {
        schemaVersion: 1,
        entries: [
          {
            id: "acme-agent-pack",
            repo: "https://github.com/AcmeCorp/agent-pack",
            authorityTier: "unverified-community",
            assetKinds: ["skill"],
          },
          {
            id: "duplicate-matt-pack",
            repo: "git@github.com:mattpocock/skills.git",
            authorityTier: "unverified-community",
            assetKinds: ["skill"],
          },
        ],
      },
    );

    const registry = await loadSourceRegistry(projectRoot);
    const acmeSource = registry.sources.find(
      (source) => source.id === "acme-agent-pack",
    );

    assert.ok(acmeSource);
    assert.equal(acmeSource.name, "Agent Pack");
    assert.equal(acmeSource.publisher?.name, "AcmeCorp");
    assert.equal(acmeSource.publisher?.owner, "AcmeCorp");
    assert.equal(acmeSource.publisher?.verified, false);
    assert.deepEqual(acmeSource.hosts, ["copilot-vscode", "opencode"]);
    assert.deepEqual(acmeSource.assetKinds, ["skill"]);
    assert.equal(acmeSource.priority, 60);
    assert.equal(acmeSource.enabled, true);
    assert.equal(
      registry.sources.some((source) => source.id === "duplicate-matt-pack"),
      false,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("source registry rejects invalid source-pack entry fields", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-pack-invalid-"),
  );

  try {
    await copyDiscoveryFixture(projectRoot, "sources.json");
    await writeJsonFile(
      join(projectRoot, "discover", "source-packs", "invalid.json"),
      {
        schemaVersion: 1,
        entries: [
          {
            id: "broken-pack",
            repo: "https://github.com/acme/broken-pack",
            authorityTier: "unverified-community",
            assetKinds: ["skill"],
            enabled: "yes",
          },
        ],
      },
    );

    await assert.rejects(
      () => loadSourceRegistry(projectRoot),
      /discover[\\/]source-packs[\\/]invalid\.json\.entries\[0\]\.enabled must be a boolean/u,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("reference harvester query helpers sanitize demand signals and normalize marketplace pages", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  const requestBodies: string[] = [];

  globalThis.fetch = async (_input, init) => {
    requestBodies.push(String(init?.body ?? ""));
    return new Response(
      JSON.stringify({
        results: [
          { extensions: [null] },
          {
            extensions: [
              {
                publisher: { displayName: "GitHub" },
                extensionName: "copilot",
                displayName: "GitHub Copilot",
                shortDescription: "AI tooling for tests",
                url: "https://external.invalid/items/GitHub.copilot",
                statistics: [
                  { statisticName: "install", value: "not-a-number" },
                ],
              },
            ],
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  const queries = selectDemandQueries(
    createDemandProfile({
      languages: ["TypeScript"],
      frameworks: ["firebase"],
      concerns: ["mcp"],
      tooling: ["npm:@modelcontextprotocol/sdk", "detector:design-system"],
    }),
  );
  assert.ok(queries.includes("TypeScript"));
  assert.ok(queries.includes("firebase"));
  assert.ok(queries.includes("mcp"));
  assert.ok(queries.includes("modelcontextprotocol sdk"));
  assert.ok(queries.includes("design-system"));
  assert.ok(queries.includes("copilot"));
  assert.ok(queries.includes("ai"));
  assert.ok(queries.includes("testing"));
  assert.ok(!queries.includes("npm:@modelcontextprotocol/sdk"));

  const items = await fetchVsCodeMarketplaceItemsForQuery(
    createSourceDefinition("vscode-marketplace", "marketplace", {
      marketplaceApi:
        "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery",
    }),
    "mcp",
    { pageNumber: 2, pageSize: 3 },
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.manifestEntry, "GitHub.copilot");
  assert.equal(
    items[0]?.originUrl,
    "https://marketplace.visualstudio.com/items?itemName=GitHub.copilot",
  );
  assert.equal(items[0]?.installs, undefined);
  assert.ok(items[0]?.capabilities.includes("marketplace"));
  assert.ok(items[0]?.capabilities.includes("mcp"));
  assert.ok(requestBodies.some((body) => body.includes('"pageNumber":2')));
  assert.ok(requestBodies.some((body) => body.includes('"pageSize":3')));
});

async function writeFixtureFiles(
  root: string,
  files: Array<{ path: string; content: string }>,
): Promise<void> {
  for (const file of files) {
    const filePath = join(root, file.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content, "utf8");
  }
}

async function copyDiscoveryFixture(
  projectRoot: string,
  fileName: string,
): Promise<void> {
  const sourcePath = join(process.cwd(), "discover", fileName);
  const targetPath = join(projectRoot, "discover", fileName);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, await readFile(sourcePath));
}

async function captureConsole(action: () => Promise<void>): Promise<string> {
  const originalConsoleLog = globalThis.console.log;
  const lines: string[] = [];
  globalThis.console.log = (...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(" "));
  };

  try {
    await action();
  } finally {
    globalThis.console.log = originalConsoleLog;
  }

  return lines.join("\n");
}

function restoreFetchMockFlag(previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    return;
  }

  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousValue;
}

function createDemandProfile(
  overrides: Partial<DemandProfile["signals"]> & {
    evidence?: DemandProfile["evidence"];
  },
): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "/tmp/project",
    summary: {
      scannedFiles: 2,
      matchedFiles: overrides.evidence?.length ?? 0,
    },
    signals: {
      languages: overrides.languages ?? [],
      packageManagers: overrides.packageManagers ?? [],
      frameworks: overrides.frameworks ?? [],
      concerns: overrides.concerns ?? [],
      tooling: overrides.tooling ?? [],
    },
    evidence: overrides.evidence ?? [],
  };
}

function createSourceDefinition(
  id: string,
  kind: SourceDefinition["kind"],
  endpoints?: Record<string, string>,
): SourceDefinition {
  return {
    id,
    name: id,
    kind,
    authorityTier:
      kind === "repo" ? "trusted-community" : "official-first-party",
    publisher: { name: id, verified: kind !== "repo" },
    hosts: ["copilot-vscode"],
    assetKinds: ["skill"],
    discoveryMode: "catalog",
    priority: 80,
    enabled: true,
    endpoints: endpoints ?? {
      ...(kind === "docs" ? { docsUrl: `https://example.com/${id}` } : {}),
      ...(kind === "repo" ? { repo: `https://github.com/example/${id}` } : {}),
      ...(kind !== "docs" && kind !== "repo"
        ? { baseUrl: `https://example.com/${id}` }
        : {}),
    },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  };
}

function createCatalogEntry(
  id: string,
  sourceId: string,
  overrides: Partial<AssetCatalogEntry> & {
    sourceKind?: AssetCatalogEntry["source"]["sourceKind"];
  } = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: overrides.assetKind ?? "skill",
    hosts: overrides.hosts ?? ["copilot-vscode"],
    compatibilityMode: overrides.compatibilityMode ?? "native",
    source: {
      sourceId,
      authorityTier: overrides.source?.authorityTier ?? "official-first-party",
      sourceKind:
        overrides.sourceKind ?? overrides.source?.sourceKind ?? "docs",
      sourcePriority: overrides.source?.sourcePriority ?? 80,
      originUrl:
        overrides.source?.originUrl ?? `https://example.com/${sourceId}/${id}`,
      publisher: overrides.source?.publisher ?? sourceId,
      publisherVerified: overrides.source?.publisherVerified ?? true,
    },
    trust: overrides.trust ?? {
      score: 100,
      signals: ["fixture"],
    },
    capabilities: overrides.capabilities ?? ["skill"],
    install: overrides.install ?? {
      method: "fixture",
      nativeHosts: ["copilot-vscode"],
      manifestEntry: id,
    },
    evidence: overrides.evidence ?? {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: `${id}.md`,
    },
    maintenance: overrides.maintenance ?? {
      lastUpdated: "2026-05-15T12:00:00.000Z",
      stars: 0,
      releaseCadence: "active",
    },
    risk: overrides.risk ?? {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: overrides.contextCost ?? {
      sizeClass: "small",
      estimatedPromptWeight: 2,
    },
    fit: overrides.fit ?? {
      portfolioFit: 0.9,
      hostFit: 0.9,
    },
    dedupe: overrides.dedupe ?? {
      duplicateGroup: undefined,
      candidateRankHint: "fixture",
    },
    status: overrides.status ?? {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}
