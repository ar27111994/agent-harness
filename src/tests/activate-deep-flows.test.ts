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
  const order = new Map<string, number>([
    ["intent-match-asset", 1],
    ["other-asset", 2],
  ]);
  const recs = new Map<string, RecommendationEntry>([
    [
      "intent-match-asset",
      {
        ...recommendationEntry("intent-match-asset", 1, 1),
        taskModes: ["general", "development"],
      },
    ],
    [
      "other-asset",
      {
        ...recommendationEntry("other-asset", 2, 1),
        taskModes: ["backend"],
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
    "development" as never,
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
