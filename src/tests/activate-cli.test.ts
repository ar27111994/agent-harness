import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runActivate } from "../activate.js";
import type {
  RecommendationEntry,
  RecommendationHostSummary,
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
): RecommendationEntry {
  return {
    assetId,
    host: "codex",
    rank,
    score: 10,
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
      freshness: 0,
      costPenalty: 0,
      riskPenalty: 0,
      negativePenalty: 0,
      redundancyPenalty: 0,
      budgetPenalty: 0,
      total: 10,
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
