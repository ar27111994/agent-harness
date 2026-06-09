/**
 * Targeted tests for manifest-validation/discovery.ts coverage gaps:
 * - assertSelectionReport
 * - assertGitHubRepoSnapshot
 * - assertAiEnrichmentReport (various branches)
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAssetCatalogEntry,
  assertDiscoverDiffReport,
  assertEnvironmentIndexReport,
  assertGitHubRepoSnapshot,
  assertSelectionReport,
  assertSourceIndex,
  assertSourceRegistry,
} from "../manifest-validation/discovery.js";
import { assertAiEnrichmentReport } from "../manifest-validation.js";

void test("assertSelectionReport accepts valid selection report", () => {
  assert.doesNotThrow(() =>
    assertSelectionReport(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        inputCount: 100,
        selectedCount: 30,
        rejectedCount: 70,
      },
      "report",
    ),
  );
});

void test("assertSelectionReport accepts report with rejectionSummary and sampleRejected", () => {
  assert.doesNotThrow(() =>
    assertSelectionReport(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        inputCount: 100,
        selectedCount: 30,
        rejectedCount: 70,
        duplicateDecisions: [],
        rejectionSummary: { "demand-relevance": 60, duplicate: 10 },
        sampleRejected: [
          { assetId: "asset-a", reason: "demand-relevance" },
          { assetId: "asset-b", reason: "duplicate" },
        ],
      },
      "report",
    ),
  );
});

void test("assertSelectionReport rejects non-number values in rejectionSummary", () => {
  assert.throws(
    () =>
      assertSelectionReport(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          inputCount: 10,
          selectedCount: 5,
          rejectedCount: 5,
          rejectionSummary: { "demand-relevance": "many" },
        },
        "report",
      ),
    /rejectionSummary/u,
  );
});

void test("assertSelectionReport rejects sampleRejected entries missing assetId", () => {
  assert.throws(
    () =>
      assertSelectionReport(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          inputCount: 10,
          selectedCount: 5,
          rejectedCount: 5,
          sampleRejected: [{ reason: "duplicate" }],
        },
        "report",
      ),
    /assetId/u,
  );
});

void test("assertSelectionReport rejects missing required fields", () => {
  assert.throws(
    () =>
      assertSelectionReport(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          inputCount: 100,
          // missing selectedCount & rejectedCount
        },
        "report",
      ),
    /selectedCount/u,
  );
});

void test("assertSourceRegistry rejects blank source path filters", () => {
  const buildRegistry = (pathField: string) => ({
    schemaVersion: 1,
    sources: [
      {
        id: "source-a",
        name: "Source A",
        kind: "repo",
        authorityTier: "trusted-community",
        hosts: ["opencode"],
        assetKinds: ["mcp-server"],
        discoveryMode: "catalog",
        priority: 60,
        enabled: true,
        endpoints: { repo: "https://github.com/acme/source-a" },
        [pathField]: ["   "],
        rules: {
          officialPreferred: true,
          allowMirror: false,
          allowInstall: false,
        },
      },
    ],
  });

  for (const pathField of ["includePaths", "excludePaths", "mcpServerPaths"]) {
    assert.throws(
      () => assertSourceRegistry(buildRegistry(pathField), "registry"),
      new RegExp(
        `registry\\.sources\\[0\\]\\.${pathField}\\[0\\] must not be empty`,
        "u",
      ),
    );
  }
});

void test("assertGitHubRepoSnapshot accepts a complete snapshot with readme", () => {
  assert.doesNotThrow(() =>
    assertGitHubRepoSnapshot(
      {
        owner: "acme",
        repo: "toolbox",
        sourceId: "acme-toolbox",
        fetchedAt: new Date().toISOString(),
        repoSummary: {
          name: "toolbox",
          description: "A toolbox",
          fullName: "acme/toolbox",
          defaultBranch: "main",
          updatedAt: new Date().toISOString(),
          pushedAt: new Date().toISOString(),
          stars: 42,
          language: "TypeScript",
          topics: ["agent", "mcp"],
          archived: false,
          htmlUrl: "https://github.com/acme/toolbox",
        },
        readme: {
          path: "README.md",
          sha: "abc123",
          size: 1024,
          htmlUrl: "https://github.com/acme/toolbox/blob/main/README.md",
          downloadUrl:
            "https://raw.githubusercontent.com/acme/toolbox/main/README.md",
        },
        tree: {
          sha: "treeSha",
          truncated: false,
          entries: [
            {
              path: "skills/my-skill/SKILL.md",
              type: "blob",
              size: 200,
              sha: "s1",
            },
            { path: "agents", type: "tree", sha: "t1" },
          ],
        },
      },
      "snapshot",
    ),
  );
});

void test("assertGitHubRepoSnapshot accepts a minimal snapshot with no readme and no optional fields", () => {
  assert.doesNotThrow(() =>
    assertGitHubRepoSnapshot(
      {
        owner: "acme",
        repo: "minimal",
        sourceId: "acme-minimal",
        fetchedAt: new Date().toISOString(),
        repoSummary: {
          name: "minimal",
          description: null,
          fullName: "acme/minimal",
          defaultBranch: "main",
          updatedAt: null,
          pushedAt: null,
          stars: 0,
          language: null,
          topics: [],
          archived: false,
          htmlUrl: "https://github.com/acme/minimal",
        },
        readme: null,
        tree: {
          sha: "treeSha",
          truncated: true,
          entries: [],
        },
      },
      "snapshot",
    ),
  );
});

void test("assertGitHubRepoSnapshot rejects missing required tree fields", () => {
  assert.throws(
    () =>
      assertGitHubRepoSnapshot(
        {
          owner: "acme",
          repo: "bad",
          sourceId: "acme-bad",
          fetchedAt: new Date().toISOString(),
          repoSummary: {
            name: "bad",
            fullName: "acme/bad",
            defaultBranch: "main",
            stars: 0,
            topics: [],
            archived: false,
            htmlUrl: "https://github.com/acme/bad",
          },
          readme: null,
          // missing tree
        },
        "snapshot",
      ),
    /tree/u,
  );
});

void test("assertAiEnrichmentReport rejects invalid trigger value", () => {
  assert.throws(
    () =>
      assertAiEnrichmentReport(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          enabled: false,
          mode: "manual",
          trigger: "on-demand",
          explicit: false,
          interactive: false,
          ci: false,
          providerOrigin: null,
          model: "gpt-4o",
          status: "skipped",
          inputSha256: "abc",
          fingerprints: {
            demandProfileSha256: null,
            selectedCatalogSha256: null,
            configSha256: "sha",
          },
        },
        "report",
      ),
    /trigger/u,
  );
});

void test("assertAiEnrichmentReport rejects invalid status value", () => {
  assert.throws(
    () =>
      assertAiEnrichmentReport(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          enabled: true,
          mode: "after-select",
          trigger: "after-select",
          explicit: false,
          interactive: false,
          ci: false,
          model: "gpt-4o",
          status: "running",
          inputSha256: "abc",
          fingerprints: {
            demandProfileSha256: null,
            selectedCatalogSha256: null,
            configSha256: "sha",
          },
        },
        "report",
      ),
    /status/u,
  );
});

void test("assertAiEnrichmentReport accepts completed report with summary and recommendations", () => {
  assert.doesNotThrow(() =>
    assertAiEnrichmentReport(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        enabled: true,
        mode: "after-select",
        trigger: "after-select",
        explicit: true,
        interactive: false,
        ci: true,
        providerOrigin: "https://api.openai.com",
        model: "gpt-4o",
        status: "completed",
        inputSha256: "abc123",
        fingerprints: {
          demandProfileSha256: "demand-sha",
          selectedCatalogSha256: "catalog-sha",
          configSha256: "config-sha",
        },
        summary: "Summary of enrichment",
        recommendations: ["Use react skill", "Add testing"],
        warnings: ["Low confidence on agent detection"],
      },
      "report",
    ),
  );
});

void test("assertDiscoverDiffReport and assertEnvironmentIndexReport accept valid reports", () => {
  assert.doesNotThrow(() =>
    assertDiscoverDiffReport(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        baselineLabel: "baseline",
        currentLabel: "current",
        sources: { added: ["source-a"], removed: [], changed: [] },
        catalog: { added: [], removed: ["asset-old"], changed: ["asset-a"] },
        selection: { added: ["asset-a"], removed: [], changed: [] },
        counts: {
          sources: { baseline: 1, current: 2 },
          catalog: { baseline: 2, current: 1 },
          selected: { baseline: 0, current: 1 },
          rejected: { baseline: 1, current: 0 },
        },
        highImpactChanges: ["selected asset added: asset-a"],
      },
      "diff",
    ),
  );

  assert.doesNotThrow(() =>
    assertEnvironmentIndexReport(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        experimental: true,
        selectedAssetCount: 1,
        assets: [
          {
            assetId: "asset-a",
            displayName: "Asset A",
            assetKind: "skill",
            hosts: ["copilot-vscode"],
            symbolicHandle: "source:skill:asset-a",
            retrievalFacets: ["skill"],
            chunkingHints: {
              preferredStrategy: "document",
              maxPromptWeight: 1,
            },
            citation: {
              provenance: "official-marketplace:repo",
              sourceUrl: "https://example.com/asset-a",
              sourceId: "source-a",
            },
            safetyFlags: [],
          },
        ],
        notes: ["experimental"],
      },
      "environmentIndex",
    ),
  );
});

void test("assertEnvironmentIndexReport rejects non-experimental reports", () => {
  assert.throws(
    () =>
      assertEnvironmentIndexReport(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          experimental: false,
          selectedAssetCount: 0,
          assets: [],
          notes: [],
        },
        "environmentIndex",
      ),
    /environmentIndex\.experimental must be true/u,
  );
});

void test("assertSourceIndex accepts complete indexed source metadata", () => {
  assert.doesNotThrow(() =>
    assertSourceIndex(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        sourceCount: 1,
        byAuthorityTier: { "trusted-community": 1 },
        byKind: { repo: 1 },
        hostCoverage: { "copilot-vscode": 1 },
        communityDefaultPolicy: "allow",
        configurationInputs: {
          checkedInRegistryPath: "discover/source-registry.json",
          sourcePackFiles: ["packs/community.json"],
          officialSkillIndexIds: ["official-skill"],
          officialUpstreamNamespaces: ["openclaw"],
        },
        enabledSources: [
          {
            id: "community-pack",
            kind: "repo",
            authorityTier: "trusted-community",
            priority: 80,
            hosts: ["copilot-vscode", "shared"],
            coverageMode: "indexed",
            syncStatus: "complete",
            indexedEntryCount: 12,
            lastSyncedAt: new Date().toISOString(),
            syncReason: "manual refresh",
          },
        ],
      },
      "sourceIndex",
    ),
  );
});

void test("assertAssetCatalogEntry accepts prerequisites and host-native config payloads", () => {
  assert.doesNotThrow(() =>
    assertAssetCatalogEntry(
      {
        id: "cursor-testing-pack",
        displayName: "Cursor Testing Pack",
        assetKind: "skill",
        hosts: ["cursor", "copilot-vscode"],
        compatibilityMode: "native",
        source: {
          sourceId: "fixture-source",
          authorityTier: "trusted-community",
          sourceKind: "repo",
          sourcePriority: 70,
          originUrl: "https://example.com/fixture-source",
          publisher: "fixture-source",
          publisherVerified: false,
        },
        trust: {
          score: 80,
          signals: ["fixture"],
        },
        capabilities: ["testing", "playwright"],
        install: {
          method: "manual",
          prerequisites: [
            {
              id: "node",
              kind: "manual",
              required: true,
              description: "Install Node.js",
              provider: "nodejs",
              envVars: ["PATH"],
              setupUrl: "https://nodejs.org",
              host: "cursor",
            },
          ],
          nativeHosts: ["cursor"],
        },
        evidence: {
          manifestFound: true,
          readmeFound: true,
          examplesFound: false,
          docsLinked: true,
          filePath: "README.md",
          classification: {
            assetKind: "skill",
            confidence: 0.92,
            level: "strong",
            evidence: [
              {
                source: "schema",
                strength: "strong",
                detail: "matched known schema",
              },
            ],
          },
        },
        maintenance: {
          lastUpdated: new Date().toISOString(),
          stars: 42,
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
        hostNativeConfig: {
          cursor: {
            files: [
              {
                path: ".cursor/mcp.json",
                format: "json",
                content: { servers: {} },
                merge: true,
              },
              {
                path: ".cursor/agents/testing.md",
                format: "text",
                content: "# Testing guide",
              },
            ],
          },
          pi: {
            files: [
              {
                path: ".pi/extensions/testing.json",
                format: "json",
                content: { enabled: true },
                merge: false,
              },
            ],
          },
        },
      },
      "entry",
    ),
  );
});

void test("assertAssetCatalogEntry rejects text payload merges outside json-only paths", () => {
  const baseEntry = {
    id: "cursor-testing-pack",
    displayName: "Cursor Testing Pack",
    assetKind: "skill",
    hosts: ["cursor"],
    compatibilityMode: "native",
    source: {
      sourceId: "fixture-source",
      authorityTier: "trusted-community",
      sourceKind: "repo",
      sourcePriority: 70,
      originUrl: "https://example.com/fixture-source",
      publisher: "fixture-source",
      publisherVerified: false,
    },
    trust: {
      score: 80,
      signals: ["fixture"],
    },
    capabilities: ["testing"],
    install: {
      method: "manual",
      nativeHosts: ["cursor"],
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
    },
    maintenance: {
      lastUpdated: new Date().toISOString(),
      stars: 1,
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

  assert.throws(
    () =>
      assertAssetCatalogEntry(
        {
          ...baseEntry,
          hostNativeConfig: {
            cursor: {
              files: [
                {
                  path: ".cursor/agents/testing.md",
                  format: "text",
                  content: "# guide",
                  merge: true,
                },
              ],
            },
          },
        },
        "entry",
      ),
    /merge is only valid for json payloads/u,
  );
});

void test("assertAssetCatalogEntry rejects invalid host-native config merge combinations", () => {
  const baseEntry = {
    id: "cursor-testing-pack",
    displayName: "Cursor Testing Pack",
    assetKind: "skill",
    hosts: ["cursor"],
    compatibilityMode: "native",
    source: {
      sourceId: "fixture-source",
      authorityTier: "trusted-community",
      sourceKind: "repo",
      sourcePriority: 70,
      originUrl: "https://example.com/fixture-source",
      publisher: "fixture-source",
      publisherVerified: false,
    },
    trust: {
      score: 80,
      signals: ["fixture"],
    },
    capabilities: ["testing"],
    install: {
      method: "manual",
      nativeHosts: ["cursor"],
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
    },
    maintenance: {
      lastUpdated: new Date().toISOString(),
      stars: 1,
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

  assert.throws(
    () =>
      assertAssetCatalogEntry(
        {
          ...baseEntry,
          hostNativeConfig: {
            cursor: {
              files: [
                {
                  path: ".cursor/mcp.json",
                  format: "text",
                  content: "{}",
                },
              ],
            },
          },
        },
        "entry",
      ),
    /must be "json" for \.cursor\/mcp\.json/u,
  );

  assert.throws(
    () =>
      assertAssetCatalogEntry(
        {
          ...baseEntry,
          hostNativeConfig: {
            cursor: {
              files: [
                {
                  path: ".cursor/mcp.json",
                  format: "json",
                  content: {},
                  merge: false,
                },
              ],
            },
          },
        },
        "entry",
      ),
    /merge must be true for \.cursor\/mcp\.json/u,
  );

  assert.throws(
    () =>
      assertAssetCatalogEntry(
        {
          ...baseEntry,
          hostNativeConfig: {
            cursor: {
              files: [
                {
                  path: ".cursor/hooks/test.sh",
                  format: "json",
                  content: { run: true },
                  merge: true,
                },
              ],
            },
          },
        },
        "entry",
      ),
    /merge must not be true for \.cursor\/hooks\/test\.sh/u,
  );
});
