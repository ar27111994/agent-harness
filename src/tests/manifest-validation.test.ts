import assert from "node:assert/strict";
import test from "node:test";

import {
  assertActivationManifest,
  assertCopilotWorkspaceProfileManifest,
  assertInstallGenerationManifest,
  assertInstallProgressState,
  assertInstallRefreshReport,
  assertInstallRefreshState,
  assertInstalledBundleManifest,
  assertInstalledPackageManifest,
  assertRecommendationAiReviewArtifact,
  assertRecommendationAiReviewInput,
  assertWirePlanManifest,
} from "../manifest-validation.js";

void test("manifest validators accept valid recommendation ai review artifacts", () => {
  const input = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policyVersion: 1,
    reviewLimit: 2,
    demandSignals: {
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: ["apify"],
      concerns: ["backend"],
      tooling: ["playwright"],
    },
    reviewedHosts: ["copilot-vscode"],
    hosts: [
      {
        host: "copilot-vscode",
        candidates: [
          {
            assetId: "asset-a",
            host: "copilot-vscode",
            rank: 1,
            score: 42,
            sourceFamily: "fixture",
            availableLocally: false,
            recommendationBasis: "workspace-fit",
            coverageTags: ["backend"],
            taskModes: ["implementation"],
            reasons: ["fit:exact-stack"],
            matchedSignals: [],
            scoreBreakdown: {
              authority: 1,
              compatibility: 1,
              portfolioFit: 1,
              trust: 1,
              sourcePriority: 1,
              demand: 1,
              hostPreference: 1,
              coverage: 1,
              diversity: 1,
              freshness: 1,
              costPenalty: 0,
              riskPenalty: 0,
              negativePenalty: 0,
              redundancyPenalty: 0,
              budgetPenalty: 0,
              total: 8,
            },
          },
        ],
      },
    ],
  };

  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    enabled: true,
    status: "completed",
    provider: "https://example.test",
    model: "fixture-model",
    reviewedHosts: ["copilot-vscode"],
    hostReviews: [
      {
        host: "copilot-vscode",
        acceptedAssetIds: ["asset-a"],
        questionable: [
          {
            assetId: "asset-a",
            reason: "looks generic",
            confidence: "medium",
          },
        ],
        suppressedAssetIds: [],
        rerank: [
          {
            assetId: "asset-a",
            delta: 12,
            reason: "exact fit",
            confidence: "high",
          },
        ],
      },
    ],
    warnings: ["be careful"],
  };

  assert.doesNotThrow(() => assertRecommendationAiReviewInput(input, "input"));
  assert.doesNotThrow(() =>
    assertRecommendationAiReviewArtifact(artifact, "artifact"),
  );
});

void test("manifest validators reject malformed recommendation ai review artifacts", () => {
  assert.throws(
    () =>
      assertRecommendationAiReviewInput(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          policyVersion: 1,
          reviewLimit: 1,
          demandSignals: null,
          reviewedHosts: ["copilot-vscode"],
          hosts: [
            {
              host: "copilot-vscode",
              candidates: [
                {
                  assetId: "asset-a",
                  host: "copilot-vscode",
                  rank: 1,
                  score: 1,
                  sourceFamily: "fixture",
                  availableLocally: false,
                  recommendationBasis: "invalid",
                  coverageTags: [],
                  taskModes: [],
                  reasons: [],
                  matchedSignals: [],
                  scoreBreakdown: {
                    authority: 0,
                    compatibility: 0,
                    portfolioFit: 0,
                    trust: 0,
                    sourcePriority: 0,
                    demand: 0,
                    hostPreference: 0,
                    coverage: 0,
                    diversity: 0,
                    freshness: 0,
                    costPenalty: 0,
                    riskPenalty: 0,
                    negativePenalty: 0,
                    redundancyPenalty: 0,
                    budgetPenalty: 0,
                    total: 0,
                  },
                },
              ],
            },
          ],
        },
        "input",
      ),
    /expected one of workspace-fit, local-availability/u,
  );

  assert.throws(
    () =>
      assertRecommendationAiReviewArtifact(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          enabled: true,
          status: "completed",
          reviewedHosts: ["copilot-vscode"],
          hostReviews: [
            {
              host: "copilot-vscode",
              acceptedAssetIds: [],
              questionable: [
                {
                  assetId: "asset-a",
                  reason: "bad confidence",
                  confidence: "certain",
                },
              ],
              suppressedAssetIds: [],
              rerank: [],
            },
          ],
        },
        "artifact",
      ),
    /confidence: expected one of low, medium, high/u,
  );
});

void test("manifest validators accept install state manifests with optional metadata", () => {
  assert.doesNotThrow(() =>
    assertInstalledPackageManifest(
      {
        schemaVersion: 1,
        assetId: "asset-a",
        mirrorId: "mirror-a",
        host: "copilot-vscode",
        installedAt: new Date().toISOString(),
        projectionType: "copy",
        assetKind: "skill",
        sourceAuthorityTier: "trusted-community",
        contextCost: {
          sizeClass: "small",
          estimatedPromptWeight: 2,
        },
        portfolioFit: 0.75,
        filesRoot: "C:/fixtures/asset-a",
        bundleMembership: ["bundle-a"],
        activationEligible: true,
        activeByDefault: false,
        upstream: {
          mirrorId: "mirror-a",
          mirroredAt: new Date().toISOString(),
          sourceId: "fixture-source",
          sourceOriginUrl: "https://example.test/asset-a",
          sourceLastUpdated: new Date().toISOString(),
          upstream: {
            type: "repo",
            url: "https://github.com/example/asset-a",
            ref: "main",
            commit: "abc123",
            version: "1.0.0",
          },
        },
        nativeInstall: {
          extensionId: "publisher.asset-a",
        },
      },
      "package",
    ),
  );

  assert.doesNotThrow(() =>
    assertInstalledBundleManifest(
      {
        schemaVersion: 1,
        bundleId: "bundle-a",
        host: "copilot-vscode",
        installedAt: new Date().toISOString(),
        packages: [
          {
            assetId: "asset-a",
            mirrorId: "mirror-a",
            manifestPath: "state/install/asset-a.json",
          },
        ],
      },
      "bundle",
    ),
  );

  assert.doesNotThrow(() =>
    assertInstallGenerationManifest(
      {
        schemaVersion: 1,
        generationId: "gen-1",
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        bundleIds: ["bundle-a"],
        packageManifestPaths: ["state/install/asset-a.json"],
        pinned: true,
        pinReason: "manual",
      },
      "generation",
    ),
  );

  assert.doesNotThrow(() =>
    assertInstallProgressState(
      {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        bundles: {
          "bundle-a": {
            host: "copilot-vscode",
            batchSize: 10,
            totalAssets: 5,
            installedAssets: 3,
            remainingAssets: 2,
            lastBatchAssetIds: ["asset-a", "asset-b"],
          },
        },
      },
      "progress",
    ),
  );
});

void test("manifest validators enforce refresh schema versions and nested operations", () => {
  assert.doesNotThrow(() =>
    assertInstallRefreshReport(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        policy: "apply-safe",
        refreshedMirrorState: true,
        hosts: [
          {
            host: "copilot-vscode",
            pinnedGeneration: false,
            assetCount: 1,
            staleCount: 0,
            pinnedCount: 0,
            blockedCount: 0,
            currentCount: 1,
            assets: [
              {
                assetId: "asset-a",
                host: "copilot-vscode",
                bundleIds: ["bundle-a"],
                assetKind: "skill",
                status: "current",
                policyDecision: "apply",
                pinned: false,
                reason: "current",
                installedMirrorId: "mirror-a",
                latestMirrorId: "mirror-b",
                installedFingerprint: {
                  mirrorId: "mirror-a",
                  mirroredAt: new Date().toISOString(),
                  sourceId: "fixture-source",
                  sourceOriginUrl: "https://example.test/asset-a",
                  sourceLastUpdated: new Date().toISOString(),
                  upstream: {
                    type: "repo",
                    url: "https://github.com/example/asset-a",
                  },
                },
                latestFingerprint: {
                  mirrorId: "mirror-b",
                  mirroredAt: new Date().toISOString(),
                  sourceId: "fixture-source",
                  sourceOriginUrl: "https://example.test/asset-a",
                  sourceLastUpdated: new Date().toISOString(),
                  upstream: {
                    type: "repo",
                    url: "https://github.com/example/asset-a",
                  },
                },
                nativeInstall: {
                  extensionId: "publisher.asset-a",
                  operation: "install",
                },
              },
            ],
          },
        ],
      },
      "refreshReport",
    ),
  );

  assert.doesNotThrow(() =>
    assertInstallRefreshState(
      {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        policy: "report-only",
        intervalMs: 60_000,
        nextCheckAt: new Date().toISOString(),
        lastAppliedAt: new Date().toISOString(),
        refreshedMirrorState: true,
        staleCount: 1,
        applyEligibleCount: 1,
      },
      "refreshState",
    ),
  );

  assert.throws(
    () =>
      assertInstallRefreshReport(
        {
          schemaVersion: 2,
          generatedAt: new Date().toISOString(),
          policy: "manual",
          refreshedMirrorState: false,
          hosts: [],
        },
        "refreshReport",
      ),
    /refreshReport.schemaVersion must be 1/u,
  );
  assert.throws(
    () =>
      assertInstallRefreshState(
        {
          schemaVersion: 2,
          updatedAt: new Date().toISOString(),
          policy: "manual",
          intervalMs: 1,
          nextCheckAt: new Date().toISOString(),
          refreshedMirrorState: false,
          staleCount: 0,
          applyEligibleCount: 0,
        },
        "refreshState",
      ),
    /refreshState.schemaVersion must be 1/u,
  );
});

void test("manifest validators accept activation and workspace manifests", () => {
  assert.doesNotThrow(() =>
    assertActivationManifest(
      {
        schemaVersion: 1,
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        activeBundles: ["bundle-a"],
        activeAssets: ["asset-a"],
        runtimeRoot: "C:/runtime",
        notes: ["ok"],
        generationId: "gen-1",
      },
      "activation",
    ),
  );

  assert.doesNotThrow(() =>
    assertCopilotWorkspaceProfileManifest(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        profileId: "profile-a",
        workspaceRoot: "C:/workspace",
        bundleIds: ["bundle-a"],
        selectedAssetIds: ["asset-a"],
        selectedInstructionIds: ["instruction-a"],
        selectedAgentIds: ["agent-a"],
        selectedWorkflowIds: ["workflow-a"],
        selectedPluginIds: ["plugin-a"],
        selectedExtensionIds: ["extension-a"],
        selectedHookIds: ["hook-a"],
        selectedSkillIds: ["skill-a"],
        activationBudget: 10,
        sessionIntent: "backend",
      },
      "workspace",
    ),
  );
});

void test("manifest validators reject invalid wire-plan duplicate paths and merge operations", () => {
  assert.doesNotThrow(() =>
    assertWirePlanManifest(
      {
        schemaVersion: 1,
        host: "vscode-user",
        generatedAt: new Date().toISOString(),
        workspaceRoot: "C:/workspace",
        runtimeRoot: "C:/runtime",
        linkedPaths: ["a"],
        instructionsFiles: ["b"],
        agentFiles: ["c"],
        skillDirs: ["d"],
        pluginDirs: ["e"],
        workflowFiles: ["f"],
        referenceFiles: ["g"],
        extensionIds: ["ext"],
        mcpServers: ["server"],
        nativeInstallActions: ["install ext"],
        hookFiles: ["hook"],
        nativeConfigOperations: [
          {
            path: "config.json",
            format: "json",
            mode: "merge",
            content: { enabled: true },
            previousContent: { enabled: false },
          },
          {
            path: "notes.txt",
            format: "text",
            mode: "write",
            content: "hello",
          },
        ],
        textFileSnapshots: [
          { path: "README.md", content: "hello" },
          { path: "docs/guide.md", content: null },
        ],
        notes: ["ready"],
      },
      "wirePlan",
    ),
  );

  assert.throws(
    () =>
      assertWirePlanManifest(
        {
          schemaVersion: 1,
          host: "vscode-user",
          generatedAt: new Date().toISOString(),
          workspaceRoot: "C:/workspace",
          runtimeRoot: "C:/runtime",
          textFileSnapshots: {},
          notes: [],
        },
        "wirePlan",
      ),
    /wirePlan.textFileSnapshots must be an array/u,
  );

  assert.throws(
    () =>
      assertWirePlanManifest(
        {
          schemaVersion: 1,
          host: "vscode-user",
          generatedAt: new Date().toISOString(),
          workspaceRoot: "C:/workspace",
          runtimeRoot: "C:/runtime",
          textFileSnapshots: [
            { path: "README.md", content: "hello" },
            { path: "README.md", content: "duplicate" },
          ],
          notes: [],
        },
        "wirePlan",
      ),
    /duplicate path 'README.md'/u,
  );

  assert.throws(
    () =>
      assertWirePlanManifest(
        {
          schemaVersion: 1,
          host: "vscode-user",
          generatedAt: new Date().toISOString(),
          workspaceRoot: "C:/workspace",
          runtimeRoot: "C:/runtime",
          nativeConfigOperations: {},
          notes: [],
        },
        "wirePlan",
      ),
    /wirePlan.nativeConfigOperations must be an array/u,
  );

  assert.throws(
    () =>
      assertWirePlanManifest(
        {
          schemaVersion: 1,
          host: "vscode-user",
          generatedAt: new Date().toISOString(),
          workspaceRoot: "C:/workspace",
          runtimeRoot: "C:/runtime",
          nativeConfigOperations: [
            {
              path: "settings.json",
              format: "text",
              mode: "merge",
              content: {},
              previousContent: {},
            },
          ],
          notes: [],
        },
        "wirePlan",
      ),
    /format must be "json" when wirePlan.nativeConfigOperations\[0\].mode is "merge"/u,
  );

  assert.throws(
    () =>
      assertWirePlanManifest(
        {
          schemaVersion: 1,
          host: "vscode-user",
          generatedAt: new Date().toISOString(),
          workspaceRoot: "C:/workspace",
          runtimeRoot: "C:/runtime",
          nativeConfigOperations: [
            {
              path: "settings.json",
              format: "json",
              mode: "merge",
              content: {},
            },
          ],
          notes: [],
        },
        "wirePlan",
      ),
    /previousContent is required/u,
  );
});
