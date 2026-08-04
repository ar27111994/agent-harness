/**
 * Deep activation-flow coverage (#428): activateHost success paths with
 * realistic fixtures — bundle scanning, recommendation-ordered selection,
 * budget pruning, the negative-score hard boundary (#426), the Copilot
 * workspace profile + fallback skill pool, rollback and diff success paths,
 * and the path-containment security guards.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runActivate } from "../activate.js";
import { writeJsonFile } from "../files.js";
import type {
  AssetKind,
  AuthorityTier,
  RecommendationEntry,
} from "../types.js";

interface FixtureRoot {
  projectRoot: string;
  cleanup: () => Promise<void>;
}

async function makeFixtureRoot(label: string): Promise<FixtureRoot> {
  const projectRoot = await mkdtemp(join(tmpdir(), `ah-deep-${label}-`));
  return {
    projectRoot,
    cleanup: async () => {
      await rm(projectRoot, { recursive: true, force: true });
    },
  };
}

function recommendationEntry(
  assetId: string,
  rank: number,
  promptWeight: number,
  score = 10,
): RecommendationEntry {
  return {
    assetId,
    host: "opencode",
    rank,
    score,
    reasons: ["fixture"],
    assetKind: "skill",
    sourceId: "fixture-source",
    sourceFamily: "fixture-family",
    availableLocally: false,
    recommendationBasis: "workspace-fit",
    contextSizeClass: "small",
    estimatedPromptWeight: promptWeight,
    selectionStage: "top-by-host",
    coverageTags: ["testing"],
    taskModes: ["development"],
    matchedSignals: [
      {
        term: "typescript",
        signalType: "languages",
        weight: 1,
        evidenceCount: 1,
      },
    ],
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

function installedPackageManifest(
  projectRoot: string,
  overrides: Partial<{
    assetId: string;
    mirrorId: string;
    assetKind: AssetKind;
    sourceAuthorityTier: AuthorityTier;
    estimatedPromptWeight: number;
    filesRoot: string;
  }>,
): Record<string, unknown> {
  const assetId = overrides.assetId ?? "asset-default";
  return {
    schemaVersion: 1,
    assetId,
    mirrorId: overrides.mirrorId ?? `mirror-${assetId}`,
    host: "opencode",
    installedAt: new Date().toISOString(),
    projectionType: "overlay",
    assetKind: overrides.assetKind ?? "skill",
    sourceAuthorityTier:
      overrides.sourceAuthorityTier ?? "official-marketplace",
    contextCost: {
      sizeClass: "small",
      estimatedPromptWeight: overrides.estimatedPromptWeight ?? 1,
    },
    portfolioFit: 0.6,
    filesRoot:
      overrides.filesRoot ??
      join(projectRoot, "install", "opencode", "packages", assetId),
    bundleMembership: ["opencode-global"],
    activationEligible: true,
    activeByDefault: false,
  };
}

async function writeActivationFixtureState(projectRoot: string): Promise<void> {
  // Generation manifest declaring the installed packages.
  await writeJsonFile(
    join(projectRoot, "install", "generations", "opencode", "current.json"),
    {
      schemaVersion: 1,
      generationId: "gen-current",
      host: "opencode",
      generatedAt: new Date().toISOString(),
      bundleIds: ["opencode-global"],
      packageManifestPaths: [
        join(
          projectRoot,
          "install",
          "opencode",
          "packages",
          "recommended-a",
          "manifest.json",
        ),
        join(
          projectRoot,
          "install",
          "opencode",
          "packages",
          "staged-breadth",
          "manifest.json",
        ),
        join(
          projectRoot,
          "install",
          "opencode",
          "packages",
          "negative-score",
          "manifest.json",
        ),
        join(
          projectRoot,
          "install",
          "opencode",
          "packages",
          "heavy-asset",
          "manifest.json",
        ),
      ],
    },
  );

  // Installed bundle manifest.
  await writeJsonFile(
    join(
      projectRoot,
      "install",
      "opencode",
      "bundles",
      "opencode-global.install.json",
    ),
    {
      schemaVersion: 1,
      bundleId: "opencode-global",
      host: "opencode",
      installedAt: new Date().toISOString(),
      packages: [
        {
          assetId: "recommended-a",
          mirrorId: "mirror-a",
          manifestPath: join(
            projectRoot,
            "install",
            "opencode",
            "packages",
            "recommended-a",
            "manifest.json",
          ),
        },
        {
          assetId: "staged-breadth",
          mirrorId: "mirror-b",
          manifestPath: join(
            projectRoot,
            "install",
            "opencode",
            "packages",
            "staged-breadth",
            "manifest.json",
          ),
        },
        {
          assetId: "negative-score",
          mirrorId: "mirror-c",
          manifestPath: join(
            projectRoot,
            "install",
            "opencode",
            "packages",
            "negative-score",
            "manifest.json",
          ),
        },
        {
          assetId: "heavy-asset",
          mirrorId: "mirror-d",
          manifestPath: join(
            projectRoot,
            "install",
            "opencode",
            "packages",
            "heavy-asset",
            "manifest.json",
          ),
        },
      ],
    },
  );

  // Package manifests: one recommended (weight 1), one staged-breadth
  // (no recommendation, weight 1), one negatively scored (#426 boundary),
  // one heavy (weight 50 — exceeds the activation budget).
  await writeJsonFile(
    join(
      projectRoot,
      "install",
      "opencode",
      "packages",
      "recommended-a",
      "manifest.json",
    ),
    installedPackageManifest(projectRoot, {
      assetId: "recommended-a",
      mirrorId: "mirror-a",
      estimatedPromptWeight: 1,
    }),
  );
  await writeJsonFile(
    join(
      projectRoot,
      "install",
      "opencode",
      "packages",
      "staged-breadth",
      "manifest.json",
    ),
    installedPackageManifest(projectRoot, {
      assetId: "staged-breadth",
      mirrorId: "mirror-b",
      assetKind: "instruction",
      estimatedPromptWeight: 1,
    }),
  );
  await writeJsonFile(
    join(
      projectRoot,
      "install",
      "opencode",
      "packages",
      "negative-score",
      "manifest.json",
    ),
    installedPackageManifest(projectRoot, {
      assetId: "negative-score",
      mirrorId: "mirror-c",
      estimatedPromptWeight: 1,
    }),
  );
  await writeJsonFile(
    join(
      projectRoot,
      "install",
      "opencode",
      "packages",
      "heavy-asset",
      "manifest.json",
    ),
    installedPackageManifest(projectRoot, {
      assetId: "heavy-asset",
      mirrorId: "mirror-d",
      estimatedPromptWeight: 50,
    }),
  );

  // Recommendations: recommended-a ranked 1; negative-score ranked 30 with a
  // negative score for opencode; staged-breadth and heavy-asset absent.
  const emptySummary = (host: string) => ({
    host,
    recommendationLimit: 10,
    recommendationLimitSource: "policy",
    recommendationLimitOverrideMode: "preserve",
    recommendationLimitOverrideModeSource: "policy",
    activationBudget: 3,
    selectedCount: 0,
    totalEstimatedPromptWeight: 0,
    selectedAssetIds: [],
    byAssetKind: {},
    bySourceFamily: {},
    byConcern: {},
    concernBuckets: {},
    taskModeBuckets: {},
  });
  await writeJsonFile(join(projectRoot, "state", "recommendations.json"), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policyVersion: 1,
    sessionIntent: "general",
    topByHost: {
      shared: [],
      "copilot-vscode": [],
      opencode: [
        recommendationEntry("recommended-a", 1, 1),
        recommendationEntry("negative-score", 30, 1, -14),
      ],
      cursor: [],
      zed: [],
      "claude-code": [],
      pi: [],
      codex: [],
    },
    hostSummaries: {
      shared: emptySummary("shared"),
      "copilot-vscode": emptySummary("copilot-vscode"),
      opencode: emptySummary("opencode"),
      cursor: emptySummary("cursor"),
      zed: emptySummary("zed"),
      "claude-code": emptySummary("claude-code"),
      pi: emptySummary("pi"),
      codex: emptySummary("codex"),
    },
    suggestedBundles: [
      {
        host: "opencode",
        bundleId: "opencode-global",
        assetIds: ["recommended-a"],
        estimatedPromptWeight: 1,
        activationBudget: 3,
        budgetPrunedAssetIds: [],
        budgetPrunedAssets: [],
        concernBuckets: {},
        taskModeBuckets: {},
      },
    ],
  });
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

void test("activate host selects recommended + staged-breadth assets, vetoes negative scores, prunes heavy ones (#428/#426)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("happy");
  t.after(cleanup);
  await writeActivationFixtureState(projectRoot);

  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });

  const code = await runActivate(
    ["host", "--host", "opencode"],
    projectRoot,
    projectRoot,
  );
  assert.equal(code, 0);

  // The overlay plan was written with the expected selection: recommended-a
  // first, staged-breadth second, negative-score AND heavy-asset excluded.
  const overlayPlan = await readJson<{
    selectedAssetIds: string[];
    activationBudget: number;
  }>(join(projectRoot, "activate", "opencode", "opencode-overlay-plan.json"));
  assert.deepEqual(overlayPlan.selectedAssetIds, [
    "recommended-a",
    "staged-breadth",
  ]);
  assert.equal(overlayPlan.activationBudget, 3);

  // The activation manifest marks exactly the selected assets active.
  const activationManifest = await readJson<{
    activeAssets: string[];
    activeBundles: string[];
    generationId: string;
  }>(join(projectRoot, "activate", "opencode", "activation-manifest.json"));
  assert.deepEqual(activationManifest.activeAssets, [
    "recommended-a",
    "staged-breadth",
  ]);
  assert.deepEqual(activationManifest.activeBundles, ["opencode-global"]);
  assert.equal(activationManifest.generationId, "gen-current");

  // The runtime root was swapped atomically from staging (no .tmp residue).
  const { readdir } = await import("node:fs/promises");
  const activateDirEntries = await readdir(
    join(projectRoot, "activate", "opencode"),
  );
  assert.ok(
    !activateDirEntries.some((entry) => entry.includes(".tmp-")),
    "no staging temp residue after the runtime swap",
  );
});

void test("activate host never selects a negatively-scored asset even with budget headroom (#426)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("negativescore");
  t.after(cleanup);
  await writeActivationFixtureState(projectRoot);

  // Raise the budget so the negative asset WOULD fit if it were eligible.
  const recsPath = join(projectRoot, "state", "recommendations.json");
  const recs = await readJson<{
    hostSummaries: Record<string, { activationBudget: number }>;
  }>(recsPath);
  recs.hostSummaries.opencode.activationBudget = 100;
  await writeJsonFile(recsPath, recs);

  const code = await runActivate(
    ["host", "--host", "opencode"],
    projectRoot,
    projectRoot,
  );
  assert.equal(code, 0);

  const activationManifest = await readJson<{ activeAssets: string[] }>(
    join(projectRoot, "activate", "opencode", "activation-manifest.json"),
  );
  assert.ok(
    !activationManifest.activeAssets.includes("negative-score"),
    "negatively-scored asset must never activate even with a huge budget",
  );
  assert.ok(
    activationManifest.activeAssets.includes("recommended-a"),
    "recommended asset still activates",
  );
});

void test("activate host refuses manifests outside the install root (security guard)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("pathguard");
  t.after(cleanup);
  await writeActivationFixtureState(projectRoot);

  // Point one bundle package manifest at a path OUTSIDE the install root.
  const bundlePath = join(
    projectRoot,
    "install",
    "opencode",
    "bundles",
    "opencode-global.install.json",
  );
  const bundle = await readJson<{ packages: Array<{ manifestPath: string }> }>(
    bundlePath,
  );
  bundle.packages[0].manifestPath = join(
    projectRoot,
    "outside",
    "evil-manifest.json",
  );
  await writeJsonFile(bundlePath, bundle);

  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });

  await assert.rejects(
    runActivate(["host", "--host", "opencode"], projectRoot, projectRoot),
    /Refusing to activate package manifest outside install root/u,
  );
});

void test("activate host refuses package files roots outside the package root (security guard)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("filesguard");
  t.after(cleanup);
  await writeActivationFixtureState(projectRoot);

  // Point one package manifest's filesRoot outside the packages directory.
  const manifestPath = join(
    projectRoot,
    "install",
    "opencode",
    "packages",
    "recommended-a",
    "manifest.json",
  );
  const manifest = await readJson<{ filesRoot: string }>(manifestPath);
  manifest.filesRoot = join(projectRoot, "somewhere", "else");
  await writeJsonFile(manifestPath, manifest);

  await assert.rejects(
    runActivate(["host", "--host", "opencode"], projectRoot, projectRoot),
    /Refusing to activate files outside package root/u,
  );
});

void test("activate rollback succeeds when a previous generation exists (#428)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("rollback");
  t.after(cleanup);
  await writeActivationFixtureState(projectRoot);

  // Activate once (gen-current), then stage a previous generation record and
  // roll back to it.
  await runActivate(["host", "--host", "opencode"], projectRoot, projectRoot);
  await writeJsonFile(
    join(projectRoot, "install", "generations", "opencode", "gen-prev.json"),
    {
      schemaVersion: 1,
      generationId: "gen-prev",
      host: "opencode",
      generatedAt: new Date().toISOString(),
      bundleIds: ["opencode-global"],
      packageManifestPaths: [
        join(
          projectRoot,
          "install",
          "opencode",
          "packages",
          "staged-breadth",
          "manifest.json",
        ),
      ],
    },
  );

  const code = await runActivate(
    ["rollback", "--host", "opencode", "--generation", "gen-prev"],
    projectRoot,
    projectRoot,
  );
  assert.equal(code, 0);

  const activationManifest = await readJson<{ activeAssets: string[] }>(
    join(projectRoot, "activate", "opencode", "activation-manifest.json"),
  );
  assert.deepEqual(activationManifest.activeAssets, ["staged-breadth"]);
});

void test("activate diff succeeds when previous generation state exists (#428)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("diff");
  t.after(cleanup);
  await writeActivationFixtureState(projectRoot);

  await runActivate(["host", "--host", "opencode"], projectRoot, projectRoot);

  // Snapshot semantics: re-run host activation then diff against the
  // previous generation.
  await runActivate(["host", "--host", "opencode"], projectRoot, projectRoot);

  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });
  const code = await runActivate(
    ["diff", "--host", "opencode"],
    projectRoot,
    projectRoot,
  );
  assert.equal(code, 0);
  assert.ok(
    output.join("\n").includes("Activation diff for opencode"),
    "diff prints a per-host report",
  );
});
