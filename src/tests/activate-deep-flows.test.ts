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

import { runActivate, activateInternals } from "../activate.js";
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
    host: string;
  }>,
): Record<string, unknown> {
  const assetId = overrides.assetId ?? "asset-default";
  const host = overrides.host ?? "opencode";
  return {
    schemaVersion: 1,
    assetId,
    mirrorId: overrides.mirrorId ?? `mirror-${assetId}`,
    host,
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
      join(projectRoot, "install", host, "packages", assetId),
    bundleMembership: ["opencode-global"],
    activationEligible: true,
    activeByDefault: false,
  };
}

const ACTIVATION_FIXTURE_HOSTS = [
  "opencode",
  "copilot-vscode",
  "shared",
] as const;

const BUNDLE_ID_BY_FIXTURE_HOST: Record<string, string> = {
  opencode: "opencode-global",
  "copilot-vscode": "copilot-core",
  shared: "shared-mcp",
};

/** Installed-package asset ids shared by every fixture host. */
const FIXTURE_PACKAGE_IDS = [
  "recommended-a",
  "staged-breadth",
  "negative-score",
  "heavy-asset",
] as const;

/**
 * Writes the install-state family (generation, bundle manifest, package
 * manifests) for one activation host so activateHost's bundle scan finds
 * real candidates.
 */
async function writeActivationHostState(
  projectRoot: string,
  host: string,
): Promise<void> {
  const bundleId = BUNDLE_ID_BY_FIXTURE_HOST[host] ?? "opencode-global";
  const packageManifestPaths = FIXTURE_PACKAGE_IDS.map((assetId) =>
    join(projectRoot, "install", host, "packages", assetId, "manifest.json"),
  );

  await writeJsonFile(
    join(projectRoot, "install", "generations", host, "current.json"),
    {
      schemaVersion: 1,
      generationId: "gen-current",
      host,
      generatedAt: new Date().toISOString(),
      bundleIds: [bundleId],
      packageManifestPaths,
    },
  );

  await writeJsonFile(
    join(projectRoot, "install", host, "bundles", `${bundleId}.install.json`),
    {
      schemaVersion: 1,
      bundleId,
      host,
      installedAt: new Date().toISOString(),
      packages: FIXTURE_PACKAGE_IDS.map((assetId, index) => ({
        assetId,
        mirrorId: `mirror-${["a", "b", "c", "d"][index]}`,
        manifestPath: join(
          projectRoot,
          "install",
          host,
          "packages",
          assetId,
          "manifest.json",
        ),
      })),
    },
  );

  // Package manifests: one recommended (weight 1), one staged-breadth
  // (no recommendation, weight 1, instruction kind), one negatively scored
  // (#426 boundary), one heavy (weight 50 — exceeds the activation budget).
  const manifests: Array<Record<string, unknown>> = [
    installedPackageManifest(projectRoot, {
      assetId: "recommended-a",
      estimatedPromptWeight: 1,
      host,
    }),
    installedPackageManifest(projectRoot, {
      assetId: "staged-breadth",
      assetKind: "instruction",
      estimatedPromptWeight: 1,
      host,
    }),
    installedPackageManifest(projectRoot, {
      assetId: "negative-score",
      estimatedPromptWeight: 1,
      host,
    }),
    installedPackageManifest(projectRoot, {
      assetId: "heavy-asset",
      estimatedPromptWeight: 50,
      host,
    }),
  ];

  for (let index = 0; index < FIXTURE_PACKAGE_IDS.length; index += 1) {
    const assetId = FIXTURE_PACKAGE_IDS[index] as string;
    await writeJsonFile(
      join(projectRoot, "install", host, "packages", assetId, "manifest.json"),
      manifests[index] as Record<string, unknown>,
    );
  }
}

async function writeActivationFixtureState(projectRoot: string): Promise<void> {
  for (const host of ACTIVATION_FIXTURE_HOSTS) {
    await writeActivationHostState(projectRoot, host);
  }

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

void test("activate host without --host drives every activation host including the Copilot profile (#428)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("allhosts");
  t.after(cleanup);
  await writeActivationFixtureState(projectRoot);

  // Default host set: opencode, copilot-vscode, shared. The Copilot host
  // takes the workspace-profile + fallback-skill-pool path; shared uses the
  // shared-mcp default bundle id.
  const code = await runActivate(["host"], projectRoot, projectRoot);
  assert.equal(code, 0);

  for (const host of ["opencode", "copilot-vscode", "shared"]) {
    const manifest = await readJson<{
      activeAssets: string[];
      activeBundles: string[];
    }>(join(projectRoot, "activate", host, "activation-manifest.json"));
    assert.ok(Array.isArray(manifest.activeAssets));
    assert.ok(
      !manifest.activeAssets.includes("negative-score"),
      `negative-score must never activate for ${host}`,
    );
  }

  // Copilot profile manifest exists and merged skill ids include the
  // recommended skill. (The negative-score veto is per recommendation-host:
  // copilot-vscode never scored the asset, so staged-breadth semantics apply
  // there — the opencode assertion above proves the veto itself.)
  const profile = await readJson<{ selectedSkillIds: string[] }>(
    join(
      projectRoot,
      "activate",
      "copilot-vscode",
      "workspace-profile-manifest.json",
    ),
  );
  assert.ok(profile.selectedSkillIds.includes("recommended-a"));
  // shared host activation writes shared-mcp bundle selection.
  const sharedManifest = await readJson<{ activeBundles: string[] }>(
    join(projectRoot, "activate", "shared", "activation-manifest.json"),
  );
  assert.deepEqual(sharedManifest.activeBundles, ["shared-mcp"]);
});

void test("activate per-subcommand help renders every subcommand surface (#428)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("helps");
  t.after(cleanup);

  for (const sub of ["host", "diff", "explain", "rollback", "reset"]) {
    const code = await runActivate([sub, "--help"], projectRoot, projectRoot);
    assert.equal(code, 0, `activate ${sub} --help should exit 0`);
  }
});

void test("cli main() executes the version and startup paths in-process (#428)", async (t) => {
  const { cliInternals } = await import("../cli.js");
  const { parseGlobalOptions, runHelpCommand, main, readPackageVersion } =
    cliInternals;

  // readPackageVersion reads the committed package.json.
  const version = await readPackageVersion();
  assert.match(version, /^\d+\.\d+\.\d+$/u);

  // main() with --version prints the version and returns 0.
  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });
  const previousArgv = process.argv;
  process.argv = ["node", "cli.js", "--version"];
  try {
    const code = await main();
    assert.equal(code, 0);
    assert.ok(output.some((line) => /^\d+\.\d+\.\d+$/u.test(line)));
  } finally {
    process.argv = previousArgv;
  }

  // parseGlobalOptions validates --timeout-seconds.
  assert.throws(
    () => parseGlobalOptions(["--timeout-seconds"]),
    /--timeout-seconds requires a number value/u,
  );
  assert.throws(
    () => parseGlobalOptions(["--timeout-seconds=abc"]),
    /requires a positive number/u,
  );
  assert.throws(
    () => parseGlobalOptions(["--timeout-seconds", "abc"]),
    /requires a positive number/u,
  );

  // runHelpCommand deep routes for every domain mirror help.
  for (const domain of [
    ["discover", "full", "--help"],
    ["workspace", "--help"],
    ["wire", "--help"],
    ["setup", "--help"],
    ["doctor", "--help"],
    ["bundle", "--help"],
    ["stage", "--help"],
  ]) {
    const code = await runHelpCommand(domain, "");
    assert.equal(code, 0, `help for ${domain.join(" ")}`);
  }

  // Unknown help domain prints parent help and exits 1.
  const code = await runHelpCommand(["nosuch-domain"], "");
  assert.equal(code, 1);
});

void test("activate explain covers absent assets and missing-argument errors (#428)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("explain-edge");
  t.after(cleanup);

  // explain without --asset rejects with guidance.
  await assert.rejects(
    runActivate(["explain"], projectRoot, projectRoot),
    /explain requires --asset/u,
  );

  // Fresh fixture (no activation manifests yet): every host is skipped and
  // the asset reports as never activated.
  await writeActivationFixtureState(projectRoot);
  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });
  const code = await runActivate(
    ["explain", "--asset", "does-not-exist"],
    projectRoot,
    projectRoot,
  );
  assert.equal(code, 0);
  assert.ok(
    output.some((line) => line.includes("has not been activated for any host")),
    "explain reports the asset was never activated",
  );

  // Rollback to a missing generation rejects.
  await assert.rejects(
    runActivate(
      ["rollback", "--host", "opencode", "--generation", "missing-gen"],
      projectRoot,
      projectRoot,
    ),
    /generation not found/u,
  );

  // Now activate, and craft suggestions that name an un-activated asset
  // (heavy-asset is budget-pruned) plus a ghost: the explain reason chains
  // for budget-pruned, suggested-bundle, and plain-absent all execute.
  await runActivate(["host", "--host", "opencode"], projectRoot, projectRoot);
  const recsPath = join(projectRoot, "state", "recommendations.json");
  const recs = await readJson<{
    suggestedBundles: Array<{
      budgetPrunedAssets?: Array<{
        assetId: string;
        reason: string;
        estimatedPromptWeight?: number;
        remainingBudget?: number;
      }>;
      assetIds: string[];
    }>;
  }>(recsPath);
  for (const bundle of recs.suggestedBundles) {
    if (bundle.assetIds.includes("recommended-a")) {
      bundle.assetIds.push("heavy-asset");
      bundle.budgetPrunedAssets = [
        {
          assetId: "heavy-asset",
          reason: "budget",
          estimatedPromptWeight: 50,
          remainingBudget: 2,
        },
      ];
    }
  }
  await writeJsonFile(recsPath, recs);

  output.length = 0;
  await runActivate(
    ["explain", "--asset", "heavy-asset"],
    projectRoot,
    projectRoot,
  );
  assert.ok(
    output.some((line) => line.includes("reason")),
    "explain still resolves a reason path for a non-active suggested asset",
  );

  await runActivate(
    ["explain", "--asset", "ghost-asset"],
    projectRoot,
    projectRoot,
  );
  assert.ok(
    output.some((line) =>
      line.includes("absent from the current activation manifest"),
    ),
    "plain-absent reason surfaced for unknown assets",
  );
});

void test("activation ranking considers session-intent match rank before recommendation order (#428)", () => {
  const { activateInternals: internals } = { activateInternals };
  // Contradictory order: order alone would rank other-asset first, but the
  // frontend intent match must pull intent-match-asset ahead anyway.
  const order = new Map<string, number>([
    ["intent-match-asset", 2],
    ["other-asset", 1],
  ]);
  const recs = new Map<string, RecommendationEntry>([
    [
      "intent-match-asset",
      {
        ...recommendationEntry("intent-match-asset", 1, 1),
        taskModes: ["implementation"],
      },
    ],
    [
      "other-asset",
      {
        ...recommendationEntry("other-asset", 2, 1),
        taskModes: ["automation"],
        coverageTags: ["data"],
      },
    ],
  ]);

  const intentMatch = installedPackageManifest("root", {
    assetId: "intent-match-asset",
  });
  const other = installedPackageManifest("root", { assetId: "other-asset" });

  const comparison = internals.compareActivationCandidates(
    intentMatch as never,
    other as never,
    order,
    recs,
    "frontend" as never,
  );
  assert.ok(comparison !== 0, "intent ranks differ");
  assert.ok(
    comparison < 0,
    "session-intent match ranks before plain recommendation order",
  );
});

void test("activate host skips candidates that are not activation-eligible (#428)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("ineligible");
  t.after(cleanup);
  await writeActivationFixtureState(projectRoot);

  // Mark one installed package ineligible; it must not activate anywhere.
  const manifestPath = join(
    projectRoot,
    "install",
    "opencode",
    "packages",
    "staged-breadth",
    "manifest.json",
  );
  const manifest = await readJson<{ activationEligible: boolean }>(
    manifestPath,
  );
  manifest.activationEligible = false;
  await writeJsonFile(manifestPath, manifest);

  const code = await runActivate(["host"], projectRoot, projectRoot);
  assert.equal(code, 0);

  const activationManifest = await readJson<{ activeAssets: string[] }>(
    join(projectRoot, "activate", "opencode", "activation-manifest.json"),
  );
  assert.ok(
    !activationManifest.activeAssets.includes("staged-breadth"),
    "ineligible candidate never activates",
  );
});

// ─── Ranking/budget helper coverage (#428) ──────────────────────────────────

const SESSION_INTENT_VALUE = "general" as const;

function compareManifests(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  preferredAssetOrder: Map<string, number>,
  recommendationEntryByAssetId: Map<string, RecommendationEntry>,
): number {
  return activateInternals.compareActivationCandidates(
    left as unknown as Parameters<
      typeof activateInternals.compareActivationCandidates
    >[0],
    right as unknown as Parameters<
      typeof activateInternals.compareActivationCandidates
    >[0],
    preferredAssetOrder,
    recommendationEntryByAssetId,
    SESSION_INTENT_VALUE as never,
  );
}

void test("activation ranking tie-breakers: authority, portfolio fit, context cost, asset id (#428)", () => {
  const emptyOrder = new Map<string, number>();
  const emptyRecs = new Map<string, RecommendationEntry>();

  // Authority beats lower authority when recommendation order is equal.
  const official = installedPackageManifest("root", {
    assetId: "official-x",
    sourceAuthorityTier: "official-marketplace",
  });
  const community = installedPackageManifest("root", {
    assetId: "community-y",
    sourceAuthorityTier: "trusted-community",
  });
  assert.ok(
    compareManifests(official, community, emptyOrder, emptyRecs) < 0,
    "official-marketplace ranks before trusted-community",
  );

  // Portfolio fit beats lower fit at equal authority.
  const higherFit = installedPackageManifest("root", {
    assetId: "fit-high",
  }) as Record<string, unknown> & { portfolioFit: number };
  const lowerFit = installedPackageManifest("root", {
    assetId: "fit-low",
  }) as Record<string, unknown> & { portfolioFit: number };
  higherFit.portfolioFit = 0.9;
  lowerFit.portfolioFit = 0.1;
  assert.ok(
    compareManifests(higherFit, lowerFit, emptyOrder, emptyRecs) < 0,
    "higher portfolio fit ranks first",
  );

  // Context cost ranks smaller classes first at equal fit.
  const small = installedPackageManifest("root", {
    assetId: "cost-small",
  }) as Record<string, unknown> & {
    contextCost: { sizeClass: string };
  };
  const large = installedPackageManifest("root", {
    assetId: "cost-large",
  }) as Record<string, unknown> & {
    contextCost: { sizeClass: string };
  };
  small.contextCost.sizeClass = "small";
  large.contextCost.sizeClass = "large";
  assert.ok(
    compareManifests(small, large, emptyOrder, emptyRecs) < 0,
    "smaller context cost ranks first",
  );

  // Fully equal candidates fall back to asset id order (stability).
  const alpha = installedPackageManifest("root", { assetId: "aaa" });
  const beta = installedPackageManifest("root", { assetId: "zzz" });
  assert.ok(
    compareManifests(alpha, beta, emptyOrder, emptyRecs) < 0,
    "asset id breaks the final tie",
  );
  assert.equal(
    compareManifests(alpha, alpha, emptyOrder, emptyRecs),
    0,
    "identical candidates compare equal",
  );
});

void test("activation budget resolution: configured host budgets and the default fallback (#428)", () => {
  assert.equal(
    activateInternals.getActivationBudget("opencode"),
    120,
    "opencode uses its configured budget",
  );
  assert.equal(
    activateInternals.getActivationBudget("copilot-vscode"),
    60,
    "copilot-vscode uses its configured budget",
  );
  assert.equal(
    activateInternals.getActivationBudget("shared"),
    40,
    "hosts without a configured budget fall back to the default",
  );
});

// ---------------------------------------------------------------------------
// Plan: activate.ts remaining paths — comparator tie-break chain, focused
// bucket ordering, explain budget/reason/profile chains, host-option
// validation, legacy diff reports, rank-0 ordering, bundle-id fallback, and
// the copilot fallback-pool negative-score filter (#428).
// ---------------------------------------------------------------------------

const EXPLAIN_REPORT_HOSTS = [
  "opencode",
  "copilot-vscode",
  "shared",
  "cursor",
  "zed",
  "claude-code",
  "pi",
  "codex",
] as const;

function buildExplainReport(
  overrides: {
    topByHost?: Record<string, RecommendationEntry[]>;
    hostSummaries?: Record<string, Record<string, unknown>>;
    suggestedBundles?: Array<Record<string, unknown>>;
  } = {},
): Record<string, unknown> {
  const emptySummary = (host: string): Record<string, unknown> => ({
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
  const topByHost: Record<string, RecommendationEntry[]> = {};
  const hostSummaries: Record<string, Record<string, unknown>> = {};
  for (const host of EXPLAIN_REPORT_HOSTS) {
    topByHost[host] = [];
    hostSummaries[host] = emptySummary(host);
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policyVersion: 1,
    sessionIntent: "general",
    topByHost: { ...topByHost, ...(overrides.topByHost ?? {}) },
    hostSummaries: { ...hostSummaries, ...(overrides.hostSummaries ?? {}) },
    suggestedBundles: overrides.suggestedBundles ?? [],
  };
}

void test("compareActivationCandidates breaks later ties in order (#428)", () => {
  const recs = new Map<string, RecommendationEntry>([
    [
      "alpha",
      { ...recommendationEntry("alpha", 1, 1), taskModes: ["implementation"] },
    ],
    [
      "beta",
      { ...recommendationEntry("beta", 1, 1), taskModes: ["implementation"] },
    ],
  ]);
  const intent = "frontend" as never;

  // Intent difference decides FIRST: alpha matches the frontend intent while
  // beta does not, so alpha sorts ahead even when beta has the better order.
  const differRecs = new Map<string, RecommendationEntry>([
    [
      "alpha",
      { ...recommendationEntry("alpha", 1, 1), taskModes: ["implementation"] },
    ],
    [
      "beta",
      { ...recommendationEntry("beta", 1, 1), taskModes: ["automation"] },
    ],
  ]);
  const orderAgainstIntent = new Map<string, number>([
    ["alpha", 2],
    ["beta", 1],
  ]);
  const byIntent = activateInternals.compareActivationCandidates(
    installedPackageManifest("root", { assetId: "alpha" }) as never,
    installedPackageManifest("root", { assetId: "beta" }) as never,
    orderAgainstIntent,
    differRecs,
    intent,
  );
  assert.ok(byIntent < 0, "session-intent match wins against order");

  // Tie on intent -> recommendation order decides.
  const orderByRank = new Map<string, number>([
    ["alpha", 1],
    ["beta", 2],
  ]);
  const byOrder = activateInternals.compareActivationCandidates(
    installedPackageManifest("root", { assetId: "alpha" }) as never,
    installedPackageManifest("root", { assetId: "beta" }) as never,
    orderByRank,
    recs,
    "development" as never,
  );
  assert.equal(byOrder, -1, "recommendation order breaks the intent tie");

  // Tie on intent + order -> source authority decides (higher tier wins).
  const sameOrder = new Map<string, number>([
    ["alpha", 1],
    ["beta", 1],
  ]);
  const byAuthority = activateInternals.compareActivationCandidates(
    installedPackageManifest("root", {
      assetId: "alpha",
      sourceAuthorityTier: "official-first-party",
    }) as never,
    installedPackageManifest("root", {
      assetId: "beta",
      sourceAuthorityTier: "trusted-community",
    }) as never,
    sameOrder,
    recs,
    intent,
  );
  assert.equal(
    byAuthority,
    -4,
    "higher source authority sorts first after order ties",
  );

  // Tie on intent + order + authority -> portfolio fit decides.
  const alphaLowFit = {
    ...installedPackageManifest("root", {
      assetId: "alpha",
      sourceAuthorityTier: "official-first-party",
    }),
    portfolioFit: 0.4,
  };
  const betaHighFit = {
    ...installedPackageManifest("root", {
      assetId: "beta",
      sourceAuthorityTier: "official-first-party",
    }),
    portfolioFit: 0.9,
  };
  const byFit = activateInternals.compareActivationCandidates(
    alphaLowFit as never,
    betaHighFit as never,
    sameOrder,
    recs,
    intent,
  );
  assert.ok(byFit > 0, "higher portfolio fit sorts first after authority ties");

  // Tie through fit -> context cost decides (smaller costs rank first).
  const betaSmallContext = {
    ...installedPackageManifest("root", {
      assetId: "beta",
      sourceAuthorityTier: "official-first-party",
    }),
    portfolioFit: 0.9,
    contextCost: { sizeClass: "tiny", estimatedPromptWeight: 0.2 },
  };
  const byCost = activateInternals.compareActivationCandidates(
    alphaLowFit as never,
    betaSmallContext as never,
    sameOrder,
    recs,
    intent,
  );
  assert.ok(
    byCost > 0,
    "lower context cost sorts first after portfolio-fit ties",
  );

  // Full tie -> deterministic asset-id comparison.
  const alphaTied = { ...alphaLowFit, assetId: "alpha" };
  const betaTied = { ...alphaLowFit, assetId: "beta" };
  const identical = activateInternals.compareActivationCandidates(
    alphaTied as never,
    betaTied as never,
    sameOrder,
    recs,
    intent,
  );
  assert.equal(
    identical,
    "alpha".localeCompare("beta"),
    "asset-id comparison is the final deterministic tie breaker",
  );
  const reversed = activateInternals.compareActivationCandidates(
    betaTied as never,
    alphaTied as never,
    sameOrder,
    recs,
    intent,
  );
  assert.equal(reversed, "beta".localeCompare("alpha"));
});

void test("buildTaskModeBuckets ranks intent-matching assets into the focused bucket (#428)", () => {
  const recs = new Map<string, RecommendationEntry>([
    [
      "matching",
      {
        ...recommendationEntry("matching", 1, 1),
        taskModes: ["implementation"],
      },
    ],
    [
      "other",
      { ...recommendationEntry("other", 2, 1), taskModes: ["automation"] },
    ],
  ]);

  const buckets = activateInternals.buildTaskModeBuckets(
    ["matching", "other"],
    recs,
    "frontend" as never,
  ) as {
    focused: string[];
    broad: string[];
    implementation?: string[];
  };

  assert.deepEqual(buckets.focused, ["matching", "other"]);
  assert.deepEqual(buckets.broad, ["matching", "other"]);
  // The task-mode bucket itself is populated for the matching asset.
  assert.deepEqual(buckets.implementation, ["matching"]);
});

void test("activate explain falls back through the activation-budget chain (#428)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("explain-budget");
  t.after(cleanup);

  // Hand-written legacy manifest: no activationBudget, no recommendationHost.
  await writeJsonFile(
    join(projectRoot, "activate", "shared", "activation-manifest.json"),
    {
      schemaVersion: 1,
      host: "shared",
      generatedAt: new Date().toISOString(),
      activeBundles: ["shared-mcp"],
      activeAssets: ["recommended-a"],
      runtimeRoot: join(projectRoot, "activate", "shared"),
      notes: [],
    },
  );
  const reportWithSummaries = () =>
    buildExplainReport({
      hostSummaries: {
        shared: {
          host: "shared",
          recommendationLimit: 10,
          recommendationLimitSource: "policy",
          recommendationLimitOverrideMode: "preserve",
          recommendationLimitOverrideModeSource: "policy",
          activationBudget: 7,
          selectedCount: 0,
          totalEstimatedPromptWeight: 0,
          selectedAssetIds: [],
          byAssetKind: {},
          bySourceFamily: {},
          byConcern: {},
          concernBuckets: {},
          taskModeBuckets: {},
        },
      },
    });

  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });

  // Host summary carries the budget — the manifest fallback chain stops there.
  await writeJsonFile(
    join(projectRoot, "state", "recommendations.json"),
    reportWithSummaries(),
  );
  output.length = 0;
  let code = await runActivate(
    ["explain", "--asset", "recommended-a"],
    projectRoot,
    projectRoot,
  );
  assert.equal(code, 0);
  assert.ok(
    output.some((line) => line.includes("activation budget: 7")),
    `expected host-summary budget 7, got: ${output.join("\n")}`,
  );

  // No recommendations report at all — the manifest's absence cascades to
  // the per-host default budget.
  await rm(join(projectRoot, "state", "recommendations.json"), {
    force: true,
  });
  output.length = 0;
  code = await runActivate(
    ["explain", "--asset", "recommended-a"],
    projectRoot,
    projectRoot,
  );
  assert.equal(code, 0);
  assert.ok(
    output.some((line) => /activation budget: \d+/u.test(line)),
    `expected a resolved default budget line, got: ${output.join("\n")}`,
  );
});

void test("activate explain reports suggested-bundle presence without pruned metadata (#428)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("explain-suggested");
  t.after(cleanup);

  // Legacy manifest with active assets, plus a suggestion naming a NOT-active
  // asset and omitting budgetPrunedAssetIds entirely (covers the optional
  // chained lookup fallback).
  await writeJsonFile(
    join(projectRoot, "activate", "opencode", "activation-manifest.json"),
    {
      schemaVersion: 1,
      host: "opencode",
      generatedAt: new Date().toISOString(),
      generationId: "gen-current",
      recommendationHost: "opencode",
      activationBudget: 3,
      activeBundles: ["opencode-global"],
      activeAssets: ["recommended-a"],
      runtimeRoot: join(projectRoot, "activate", "opencode"),
      notes: [],
    },
  );
  await writeJsonFile(
    join(projectRoot, "state", "recommendations.json"),
    buildExplainReport({
      suggestedBundles: [
        {
          host: "opencode",
          bundleId: "opencode-global",
          assetIds: ["recommended-a", "extra-asset"],
          estimatedPromptWeight: 2,
          activationBudget: 3,
          concernBuckets: {},
          taskModeBuckets: {},
        },
      ],
    }),
  );

  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });

  let code = await runActivate(
    ["explain", "--asset", "extra-asset"],
    projectRoot,
    projectRoot,
  );
  assert.equal(code, 0);
  assert.ok(
    output.some((line) => line.includes("present in suggested bundle")),
    `expected suggested-bundle reason, got: ${output.join("\n")}`,
  );

  // A suggestion that DOES carry budgetPrunedAssetIds exercises the optional
  // chained lookup with a present array (returns false for a third asset).
  await writeJsonFile(
    join(projectRoot, "state", "recommendations.json"),
    buildExplainReport({
      suggestedBundles: [
        {
          host: "opencode",
          bundleId: "opencode-global",
          assetIds: ["recommended-a"],
          estimatedPromptWeight: 2,
          activationBudget: 3,
          budgetPrunedAssetIds: ["pruned-x"],
          budgetPrunedAssets: [],
          concernBuckets: {},
          taskModeBuckets: {},
        },
      ],
    }),
  );
  output.length = 0;
  code = await runActivate(
    ["explain", "--asset", "third-asset"],
    projectRoot,
    projectRoot,
  );
  assert.equal(code, 0);
  assert.ok(
    output.some((line) =>
      line.includes("absent from the current activation manifest"),
    ),
    `third asset with present pruned metadata reports absent, got: ${output.join("\n")}`,
  );

  // The pruned list itself can match the asset while the details list is
  // empty: the finder matches via the pruned ids, the budget-pruned detail
  // lookup comes up empty, and the suggested-bundle reason still explains.
  output.length = 0;
  code = await runActivate(
    ["explain", "--asset", "pruned-x"],
    projectRoot,
    projectRoot,
  );
  assert.equal(code, 0);
  assert.ok(
    output.some((line) => line.includes("present in suggested bundle")),
    `pruned-id match without details reports the suggested-bundle reason, got: ${output.join("\n")}`,
  );

  // Back to the metadata-less suggestion: an asset that matches neither the
  // assetIds nor (absent) pruned ids skips the optional pruned lookup
  // entirely and falls through to the plain-absent reason.
  await writeJsonFile(
    join(projectRoot, "state", "recommendations.json"),
    buildExplainReport({
      suggestedBundles: [
        {
          host: "opencode",
          bundleId: "opencode-global",
          assetIds: ["recommended-a"],
          estimatedPromptWeight: 2,
          activationBudget: 3,
          concernBuckets: {},
          taskModeBuckets: {},
        },
      ],
    }),
  );
  output.length = 0;
  code = await runActivate(
    ["explain", "--asset", "fourth-asset"],
    projectRoot,
    projectRoot,
  );
  assert.equal(code, 0);
  assert.ok(
    output.some((line) =>
      line.includes("absent from the current activation manifest"),
    ),
    `unmatched asset without pruned metadata reports absent, got: ${output.join("\n")}`,
  );
});

void test("activate explain reports the copilot profile selection per asset (#428)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("explain-copilot");
  t.after(cleanup);

  await writeJsonFile(
    join(projectRoot, "activate", "copilot-vscode", "activation-manifest.json"),
    {
      schemaVersion: 1,
      host: "copilot-vscode",
      generatedAt: new Date().toISOString(),
      generationId: "gen-current",
      recommendationHost: "copilot-vscode",
      activationBudget: 5,
      activeBundles: ["copilot-core"],
      activeAssets: ["recommended-a", "active-not-in-profile"],
      runtimeRoot: join(projectRoot, "activate", "copilot-vscode"),
      notes: [],
    },
  );
  await writeJsonFile(
    join(
      projectRoot,
      "activate",
      "copilot-vscode",
      "workspace-profile-manifest.json",
    ),
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      profileId: "recommended-a",
      workspaceRoot: join(projectRoot, "activate", "copilot-vscode"),
      bundleIds: ["copilot-core"],
      selectedAssetIds: ["recommended-a"],
      selectedInstructionIds: [],
      selectedAgentIds: [],
      selectedWorkflowIds: [],
      activationBudget: 5,
    },
  );
  await writeJsonFile(
    join(projectRoot, "state", "recommendations.json"),
    buildExplainReport(),
  );

  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });

  let code = await runActivate(
    ["explain", "--asset", "recommended-a", "--host", "copilot-vscode"],
    projectRoot,
    projectRoot,
  );
  assert.equal(code, 0);
  assert.ok(
    output.some((line) => line.includes("profile selected: yes")),
    `expected profile yes, got: ${output.join("\n")}`,
  );

  output.length = 0;
  code = await runActivate(
    ["explain", "--asset", "active-not-in-profile", "--host", "copilot-vscode"],
    projectRoot,
    projectRoot,
  );
  assert.equal(code, 0);
  assert.ok(
    output.some((line) => line.includes("profile selected: no")),
    `expected profile no, got: ${output.join("\n")}`,
  );
});

void test("activate explain validates --host values before any state reads (#428)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("explain-badhost");
  t.after(cleanup);

  // A host target that is not an activation host (cursor is wireable but not
  // materializable by activation) is rejected with the activation-host list.
  await assert.rejects(
    runActivate(
      ["explain", "--asset", "x", "--host", "cursor"],
      projectRoot,
      projectRoot,
    ),
    /Invalid --host value: cursor/u,
  );

  // A completely unknown host target is rejected by the shared target parser.
  await assert.rejects(
    runActivate(
      ["explain", "--asset", "x", "--host", "totally-bogus"],
      projectRoot,
      projectRoot,
    ),
    /Invalid --host value: totally-bogus/u,
  );
});

void test("activate diff renders legacy unknown generations and empty diff lists (#428)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("diff-legacy");
  t.after(cleanup);

  // Two manifests WITHOUT generation ids where the previous view differs:
  // both sides of the "unknown" fallback, the non-empty diff list join, and
  // the removed-asset rendering all execute.
  const currentManifest = {
    schemaVersion: 1,
    host: "opencode",
    generatedAt: new Date().toISOString(),
    activeBundles: ["opencode-global"],
    activeAssets: ["recommended-a"],
    runtimeRoot: join(projectRoot, "activate", "opencode"),
    notes: [],
  };
  const previousManifest = {
    ...currentManifest,
    generatedAt: new Date(Date.now() - 60_000).toISOString(),
    activeBundles: ["old-bundle"],
    activeAssets: ["old-asset"],
  };
  await writeJsonFile(
    join(projectRoot, "activate", "opencode", "activation-manifest.json"),
    currentManifest,
  );
  await writeJsonFile(
    join(
      projectRoot,
      "activate",
      "opencode",
      "activation-manifest.previous.json",
    ),
    previousManifest,
  );

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
  const joined = output.join("\n");
  assert.ok(joined.includes("unknown -> unknown"), `got: ${joined}`);
  assert.ok(
    joined.includes("Added assets: recommended-a") &&
      joined.includes("Removed assets: old-asset") &&
      joined.includes("Added bundles: opencode-global") &&
      joined.includes("Removed bundles: old-bundle"),
    `non-empty diff lists render by joining ids: ${joined}`,
  );
});

void test("activate host honors a rank-0 recommendation via the index fallback (#428)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("rank-zero");
  t.after(cleanup);
  await writeActivationFixtureState(projectRoot);

  // Rank 0 is falsy: the preferred-order map must fall back to the entry
  // index so ordering stays deterministic.
  const recsPath = join(projectRoot, "state", "recommendations.json");
  const recs = await readJson<{
    topByHost: Record<string, RecommendationEntry[]>;
  }>(recsPath);
  recs.topByHost.opencode = [recommendationEntry("recommended-a", 0, 1)];
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
    activationManifest.activeAssets.includes("recommended-a"),
    "rank-0 recommended asset still activates",
  );
});

void test("activate host falls back to generation bundle ids when suggestions name none (#428)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("bundle-fallback");
  t.after(cleanup);
  await writeActivationFixtureState(projectRoot);

  // Suggested bundles for opencode name a bundle the generation does not
  // install; the host filter must fall back to the generation's bundle ids.
  const recsPath = join(projectRoot, "state", "recommendations.json");
  const recs = await readJson<{
    suggestedBundles: Array<Record<string, unknown>>;
    topByHost: Record<string, RecommendationEntry[]>;
  }>(recsPath);
  recs.suggestedBundles = [
    {
      host: "opencode",
      bundleId: "different-bundle",
      assetIds: ["recommended-a"],
      estimatedPromptWeight: 1,
      activationBudget: 3,
      budgetPrunedAssetIds: [],
      budgetPrunedAssets: [],
      concernBuckets: {},
      taskModeBuckets: {},
    },
  ];
  recs.topByHost.opencode = [recommendationEntry("recommended-a", 1, 1)];
  await writeJsonFile(recsPath, recs);

  const code = await runActivate(
    ["host", "--host", "opencode"],
    projectRoot,
    projectRoot,
  );
  assert.equal(code, 0);

  const activationManifest = await readJson<{ activeBundles: string[] }>(
    join(projectRoot, "activate", "opencode", "activation-manifest.json"),
  );
  // The default bundle-id set for opencode survives the suggestion filter:
  // the suggestion named a bundle the host does not install, so the filter
  // falls back to the full default set instead of dropping everything.
  assert.deepEqual(
    activationManifest.activeBundles,
    ["opencode-global", "community-stable"],
    "default bundle ids are used when suggestions do not match",
  );
});

void test("activate copilot-vscode excludes negatively-scored skills from the fallback pool (#428/#426)", async (t) => {
  const { projectRoot, cleanup } = await makeFixtureRoot("copilot-negpool");
  t.after(cleanup);
  await writeActivationFixtureState(projectRoot);

  // Give copilot-vscode its own recommendation set: recommended-a positive,
  // negative-score negative for THIS host — the fallback skill pool must
  // filter the negative entry out of the profile.
  const recsPath = join(projectRoot, "state", "recommendations.json");
  const recs = await readJson<{
    topByHost: Record<string, RecommendationEntry[]>;
  }>(recsPath);
  recs.topByHost["copilot-vscode"] = [
    recommendationEntry("recommended-a", 1, 1),
    recommendationEntry("negative-score", 2, 1, -14),
  ];
  await writeJsonFile(recsPath, recs);

  const code = await runActivate(
    ["host", "--host", "copilot-vscode"],
    projectRoot,
    projectRoot,
  );
  assert.equal(code, 0);

  const profile = await readJson<{ selectedSkillIds: string[] }>(
    join(
      projectRoot,
      "activate",
      "copilot-vscode",
      "workspace-profile-manifest.json",
    ),
  );
  assert.ok(
    profile.selectedSkillIds.includes("recommended-a"),
    "positive skill stays in the profile",
  );
  assert.ok(
    !profile.selectedSkillIds.includes("negative-score"),
    "negatively-scored skill is filtered from the fallback pool",
  );
});
