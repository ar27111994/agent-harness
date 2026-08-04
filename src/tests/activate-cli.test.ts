import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runActivate, activateInternals } from "../activate.js";
import type {
  InstalledPackageManifest,
  RecommendationEntry,
  RecommendationHostSummary,
  SessionIntent,
} from "../types.js";

void test("activate explain reports active and budget-pruned reasons", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-activate-explain-"),
  );
  await mkdir(join(projectRoot, "activate", "copilot-vscode"), {
    recursive: true,
  });
  await mkdir(join(projectRoot, "state"), { recursive: true });
  await writeFile(
    join(projectRoot, "activate", "copilot-vscode", "activation-manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        generationId: "gen-1",
        recommendationHost: "codex",
        activationBudget: 7,
        activeBundles: ["copilot-core"],
        activeAssets: ["asset-a"],
        runtimeRoot: join(projectRoot, "activate", "copilot-vscode"),
        notes: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(projectRoot, "state", "recommendations.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        policyVersion: 1,
        sessionIntent: "general",
        topByHost: {
          shared: [],
          "copilot-vscode": [],
          opencode: [],
          cursor: [],
          zed: [],
          "claude-code": [],
          pi: [],
          codex: [createRecommendationEntry("asset-a", 1, 2)],
        },
        hostSummaries: {
          shared: createSummary("shared"),
          "copilot-vscode": createSummary("copilot-vscode"),
          opencode: createSummary("opencode"),
          cursor: createSummary("cursor"),
          zed: createSummary("zed"),
          "claude-code": createSummary("claude-code"),
          pi: createSummary("pi"),
          codex: createSummary("codex"),
        },
        suggestedBundles: [
          {
            host: "codex",
            bundleId: "copilot-core",
            assetIds: ["asset-a"],
            estimatedPromptWeight: 2,
            activationBudget: 2,
            budgetPrunedAssetIds: ["asset-b"],
            budgetPrunedAssets: [
              {
                assetId: "asset-b",
                estimatedPromptWeight: 4,
                remainingBudget: 0,
                reason:
                  "estimated prompt weight 4 exceeds remaining activation budget 0",
              },
            ],
            concernBuckets: {},
            taskModeBuckets: {},
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  t.after(async () => {
    await rm(projectRoot, { force: true, recursive: true });
  });

  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });

  await runActivate(
    ["explain", "--asset", "asset-a", "--host", "copilot-vscode"],
    projectRoot,
    projectRoot,
  );
  await runActivate(
    ["explain", "--asset", "asset-b", "--host", "copilot-vscode"],
    projectRoot,
    projectRoot,
  );

  const rendered = output.join("\n");
  assert.match(rendered, /Host copilot-vscode: active/u);
  assert.match(rendered, /recommendation: rank 1, score 10, prompt weight 2/u);
  assert.match(rendered, /activation budget: 7/u);
  assert.match(rendered, /selected from staged bundle outputs/u);
  assert.match(rendered, /Host copilot-vscode: not active/u);
  assert.match(rendered, /remaining activation budget 0/u);
});

function createRecommendationEntry(
  assetId: string,
  rank: number,
  estimatedPromptWeight: number,
  score = 10,
): RecommendationEntry {
  return {
    assetId,
    host: "codex",
    rank,
    score,
    reasons: ["fixture"],
    assetKind: "skill",
    sourceId: "fixture-source",
    sourceFamily: "fixture-family",
    availableLocally: false,
    recommendationBasis: "workspace-fit",
    contextSizeClass: "small",
    estimatedPromptWeight,
    selectionStage: "top-by-host",
    coverageTags: [],
    taskModes: [],
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
      assetKindDiversityPenalty: 0,
      freshness: 0,
      costPenalty: 0,
      riskPenalty: 0,
      negativePenalty: score < 0 ? -score : 0,
      ecosystemMismatchPenalty: 0,
      redundancyPenalty: 0,
      budgetPenalty: 0,
      total: score,
    },
  };
}

function createSummary(host: string): RecommendationHostSummary {
  return {
    host,
    recommendationLimit: 10,
    recommendationLimitSource: "policy",
    recommendationLimitOverrideMode: "preserve",
    recommendationLimitOverrideModeSource: "policy",
    activationBudget: 2,
    selectedCount: 1,
    totalEstimatedPromptWeight: 2,
    selectedAssetIds: ["asset-a"],
    byAssetKind: {},
    bySourceFamily: {},
    byConcern: {},
    concernBuckets: {},
    taskModeBuckets: {},
  };
}

void test("activate validates every repeated intent value", async () => {
  await assert.rejects(
    () =>
      runActivate(
        ["host", "--intent", "backend", "--intent", "docss"],
        process.cwd(),
        process.cwd(),
      ),
    /Invalid --intent value 'docss'/u,
  );
});

// ---------------------------------------------------------------------------
// #426 — recommendation eligibility: negative scores are a hard activation
// boundary; no-recommendation assets remain staged-bundle eligible.
// ---------------------------------------------------------------------------

function createInstalledPackageManifest(
  assetId: string,
  overrides: Partial<InstalledPackageManifest> = {},
): InstalledPackageManifest {
  return {
    schemaVersion: 1,
    assetId,
    mirrorId: `mirror-${assetId}`,
    host: "copilot-vscode",
    installedAt: new Date().toISOString(),
    projectionType: "overlay",
    assetKind: "skill",
    sourceAuthorityTier: "official-marketplace",
    contextCost: {
      sizeClass: "small",
      estimatedPromptWeight: 1,
    },
    portfolioFit: 0.5,
    filesRoot: `/packages/${assetId}`,
    bundleMembership: ["copilot-core"],
    activationEligible: true,
    activeByDefault: false,
    ...overrides,
  };
}

void test("activation never selects an asset with a negative recommendation score (#426)", () => {
  const negativeAsset = createInstalledPackageManifest("bad-asset");
  const candidates = [negativeAsset];
  const preferredAssetOrder = new Map([["bad-asset", 1]]);
  const recommendationEntryByAssetId = new Map([
    ["bad-asset", createRecommendationEntry("bad-asset", 1, 2, -14)],
  ]);

  const selected = activateInternals
    .selectActivationCandidates(
      candidates.map((packageManifest) => ({
        packageManifest,
        destinationRoot: `/dest/${packageManifest.assetId}`,
      })),
      preferredAssetOrder,
      recommendationEntryByAssetId,
      100,
      "general" as SessionIntent,
    )
    .map((candidate) => candidate.packageManifest.assetId);

  assert.deepEqual(
    selected,
    [],
    "negatively-scored asset must never activate even with a large budget",
  );
});

void test("assets with no recommendation remain selectable but rank below recommended ones (#426)", () => {
  const recommended = [
    createInstalledPackageManifest("recommended-a", {
      sourceAuthorityTier: "official-marketplace",
    }),
  ];
  const notRecommended = [
    createInstalledPackageManifest("staged-breadth-b", {
      sourceAuthorityTier: "official-marketplace",
    }),
  ];
  const preferredAssetOrder = new Map([["recommended-a", 1]]);
  const recommendationEntryByAssetId = new Map([
    ["recommended-a", createRecommendationEntry("recommended-a", 1, 1)],
  ]);

  const selected = activateInternals
    .selectActivationCandidates(
      [...recommended, ...notRecommended].map((packageManifest) => ({
        packageManifest,
        destinationRoot: `/dest/${packageManifest.assetId}`,
      })),
      preferredAssetOrder,
      recommendationEntryByAssetId,
      100,
      "general" as SessionIntent,
    )
    .map((candidate) => candidate.packageManifest.assetId);

  assert.deepEqual(
    selected,
    ["recommended-a", "staged-breadth-b"],
    "recommended asset first, staged-breadth asset second, both selectable",
  );
});

void test("activate explain labels active assets without a host recommendation truthfully (#426)", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-activate-explain-breadth-"),
  );
  await mkdir(join(projectRoot, "activate", "opencode"), {
    recursive: true,
  });
  await mkdir(join(projectRoot, "state"), { recursive: true });
  await writeFile(
    join(projectRoot, "activate", "opencode", "activation-manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        host: "opencode",
        generatedAt: new Date().toISOString(),
        generationId: "gen-1",
        recommendationHost: "opencode",
        activationBudget: 50,
        activeBundles: ["opencode-global"],
        activeAssets: ["catalog-curated-asset"],
        runtimeRoot: join(projectRoot, "activate", "opencode"),
        notes: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(projectRoot, "state", "recommendations.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        policyVersion: 1,
        sessionIntent: "general",
        topByHost: {
          shared: [],
          "copilot-vscode": [],
          opencode: [],
          cursor: [],
          zed: [],
          "claude-code": [],
          pi: [],
          codex: [],
        },
        hostSummaries: {
          shared: createSummary("shared"),
          "copilot-vscode": createSummary("copilot-vscode"),
          opencode: createSummary("opencode"),
          cursor: createSummary("cursor"),
          zed: createSummary("zed"),
          "claude-code": createSummary("claude-code"),
          pi: createSummary("pi"),
          codex: createSummary("codex"),
        },
        suggestedBundles: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  t.after(async () => {
    await rm(projectRoot, { force: true, recursive: true });
  });

  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });

  await runActivate(
    ["explain", "--asset", "catalog-curated-asset", "--host", "opencode"],
    projectRoot,
    projectRoot,
  );

  const rendered = output.join("\n");
  assert.match(rendered, /Host opencode: active/u);
  assert.match(
    rendered,
    /activated from staged bundle \(not recommended for this host — catalog-selection breadth\)/u,
  );
  assert.doesNotMatch(
    rendered,
    /selected from staged bundle outputs by recommendation order/u,
    "must not claim recommendation-order selection for an unrecommended asset",
  );
});

void test("activate explain calls out legacy activations with negative scores (#426)", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-activate-explain-negative-"),
  );
  await mkdir(join(projectRoot, "activate", "opencode"), {
    recursive: true,
  });
  await mkdir(join(projectRoot, "state"), { recursive: true });
  await writeFile(
    join(projectRoot, "activate", "opencode", "activation-manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        host: "opencode",
        generatedAt: new Date().toISOString(),
        generationId: "gen-1",
        recommendationHost: "opencode",
        activationBudget: 50,
        activeBundles: ["opencode-global"],
        activeAssets: ["legacy-negative-asset"],
        runtimeRoot: join(projectRoot, "activate", "opencode"),
        notes: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(projectRoot, "state", "recommendations.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        policyVersion: 1,
        sessionIntent: "general",
        topByHost: {
          shared: [],
          "copilot-vscode": [],
          opencode: [
            createRecommendationEntry("legacy-negative-asset", 30, 2, -14),
          ],
          cursor: [],
          zed: [],
          "claude-code": [],
          pi: [],
          codex: [],
        },
        hostSummaries: {
          shared: createSummary("shared"),
          "copilot-vscode": createSummary("copilot-vscode"),
          opencode: createSummary("opencode"),
          cursor: createSummary("cursor"),
          zed: createSummary("zed"),
          "claude-code": createSummary("claude-code"),
          pi: createSummary("pi"),
          codex: createSummary("codex"),
        },
        suggestedBundles: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  t.after(async () => {
    await rm(projectRoot, { force: true, recursive: true });
  });

  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });

  await runActivate(
    ["explain", "--asset", "legacy-negative-asset", "--host", "opencode"],
    projectRoot,
    projectRoot,
  );

  const rendered = output.join("\n");
  assert.match(rendered, /Host opencode: active/u);
  assert.match(rendered, /score -14/u);
  assert.match(
    rendered,
    /legacy activation despite a negative recommendation score/u,
  );
});
