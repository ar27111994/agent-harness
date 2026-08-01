import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { aiEnrichmentInternals } from "../domains/discovery/ai-enrichment.js";
import { catalogSelectionInternals } from "../domains/discovery/catalog-selection.js";
import { harvestGitHubRepoSource } from "../domains/discovery/github-harvester.js";
import {
  harvestLocalDirectorySource,
  localHarvesterInternals,
} from "../domains/discovery/local-harvesters.js";
import { harvestOfficialSkillIndexes } from "../domains/discovery/official-index-harvester.js";
import { sourceSyncInternals } from "../domains/discovery/source-sync.js";
import { filesInternals } from "../files.js";
import { githubInternals } from "../github.js";
import { nativeWireInternals } from "../host-adapters/native-wire.js";
import { openCodeWireInternals } from "../host-adapters/opencode.js";
import { installRefreshInternals } from "../install/refresh.js";
import { preflightInternals } from "../lib/preflight.js";
import { mirrorAcquireInternals } from "../mirror/acquire.js";
import { recommendationAiReviewInternals } from "../recommend/ai-review.js";
import { recommendCommandInternals } from "../recommend/commands.js";
import type {
  AssetCatalogEntry,
  InstallProgressState,
  MirrorAcquireState,
  SelectionRegistry,
  SourceDefinition,
} from "../types.js";

void test("final coverage helpers expose platform and null-stat branches", async () => {
  assert.equal(filesInternals.getDirectorySymlinkType("win32"), "junction");
  assert.equal(filesInternals.getDirectorySymlinkType("linux"), "dir");

  assert.deepEqual(
    filesInternals.toCollectedFileStat(
      { entryPath: "/tmp/a.txt", relativeEntryPath: "a.txt" },
      { isFile: () => true, size: 12 },
    ),
    { entryPath: "/tmp/a.txt", relativeEntryPath: "a.txt", size: 12 },
  );
  assert.equal(
    filesInternals.toCollectedFileStat(
      { entryPath: "/tmp/dir", relativeEntryPath: "dir" },
      { isFile: () => false, size: 0 },
    ),
    null,
  );
  assert.equal(
    filesInternals.toCollectedFileStat(
      { entryPath: "/tmp/missing", relativeEntryPath: "missing" },
      null,
    ),
    null,
  );
  assert.deepEqual(
    filesInternals.compactCollectedFileStats([
      null,
      { entryPath: "/tmp/a.txt", relativeEntryPath: "a.txt", size: 1 },
    ]),
    [{ entryPath: "/tmp/a.txt", relativeEntryPath: "a.txt", size: 1 }],
  );

  const root = await mkdtemp(join(tmpdir(), "agent-harness-files-einval-"));
  try {
    assert.equal(
      await filesInternals.shouldIgnoreEnsureDirectoryError(root, {
        code: "EINVAL",
      }),
      true,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("GitHub-backed fetchers attach configured authorization headers", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-auth-headers-"),
  );
  const originalFetch = globalThis.fetch;
  const previousGitHubToken = process.env.GITHUB_TOKEN;
  const previousGitHubPersonalAccessToken =
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  const previousFetchRetries = process.env.AGENT_HARNESS_GITHUB_FETCH_RETRIES;
  const previousFetchMocks = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const observedAuthorizations: string[] = [];

  context.after(async () => {
    globalThis.fetch = originalFetch;
    restoreProcessEnv("GITHUB_TOKEN", previousGitHubToken);
    restoreProcessEnv(
      "GITHUB_PERSONAL_ACCESS_TOKEN",
      previousGitHubPersonalAccessToken,
    );
    restoreProcessEnv(
      "AGENT_HARNESS_GITHUB_FETCH_RETRIES",
      previousFetchRetries,
    );
    restoreProcessEnv("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMocks);
    clearRuntimeConfigForTests();
    await rm(projectRoot, { force: true, recursive: true });
  });

  process.env.GITHUB_TOKEN = "fixture-token";
  delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  process.env.AGENT_HARNESS_GITHUB_FETCH_RETRIES = "1";
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  clearRuntimeConfigForTests();

  globalThis.fetch = async (_input, init) => {
    observedAuthorizations.push(
      new Headers(init?.headers).get("authorization") ?? "",
    );
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  await githubInternals.fetchGitHubResponse("/rate_limit");

  await mkdir(join(projectRoot, "discover"), { recursive: true });
  await writeFile(
    join(projectRoot, "discover", "sources.json"),
    JSON.stringify({ schemaVersion: 1, sources: [] }),
  );
  await writeFile(
    join(projectRoot, "discover", "official-skills-indexes.json"),
    JSON.stringify({
      schemaVersion: 1,
      indexes: [
        {
          id: "official-index",
          kind: "markdown",
          url: "https://raw.githubusercontent.com/acme/index/main/skills.md",
        },
      ],
    }),
  );

  globalThis.fetch = async (_input, init) => {
    observedAuthorizations.push(
      new Headers(init?.headers).get("authorization") ?? "",
    );
    return new Response("# Empty official index\n", {
      status: 200,
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  };

  assert.deepEqual(await harvestOfficialSkillIndexes(projectRoot, null), []);
  assert.deepEqual(observedAuthorizations, [
    "Bearer fixture-token",
    "Bearer fixture-token",
  ]);
});

void test("catalog selection internals cover optional anchors and common-term fallbacks", () => {
  const exactHighSignalTerms = new Set<string>();
  const highSignalPhrases: string[][] = [];
  const lowSignalTerms = new Set<string>();
  const demandKeywords = new Set<string>();
  const stackAnchorTerms = new Set<string>();

  catalogSelectionInternals.addDemandSignal(
    "ruby rails",
    exactHighSignalTerms,
    highSignalPhrases,
    lowSignalTerms,
    demandKeywords,
    new Map<string, number>(),
    1,
    stackAnchorTerms,
  );

  assert.deepEqual(highSignalPhrases, [["ruby", "rails"]]);
  assert.deepEqual([...stackAnchorTerms].sort(), ["rails", "ruby"]);

  const primaryStackAnchorTerms = new Set<string>();
  catalogSelectionInternals.addDemandSignal(
    "solid start",
    exactHighSignalTerms,
    highSignalPhrases,
    lowSignalTerms,
    demandKeywords,
    new Map<string, number>(),
    1,
    stackAnchorTerms,
    primaryStackAnchorTerms,
  );
  assert.deepEqual([...primaryStackAnchorTerms].sort(), ["solid", "start"]);

  assert.equal(
    catalogSelectionInternals.isCatalogCommonHighSignal(
      "missing",
      new Map<string, number>(),
      200,
    ),
    false,
  );
  assert.equal(
    catalogSelectionInternals.isCatalogCommonHighSignal(
      "react",
      new Map([["react", 80]]),
      200,
    ),
    true,
  );
  assert.equal(
    catalogSelectionInternals.classifyDemandKeyword(
      "react",
      new Map([["react", 80]]),
      200,
    ),
    "low",
  );
  assert.equal(
    catalogSelectionInternals.matchesTermGroupSet(new Set(["a", "b"]), [
      ["a", "b"],
    ]),
    true,
  );
  assert.deepEqual(
    catalogSelectionInternals.normalizeDemandSignalKeywords(
      "detector:base react",
    ),
    ["react"],
  );
});

void test("github harvesting filters unclassified blobs from injected snapshots", async () => {
  const source = {
    ...buildSource("github-fixture", "https://github.com/acme/repo"),
    kind: "repo" as const,
  };

  const entries = await harvestGitHubRepoSource(
    source,
    null,
    buildSelectionRegistry(),
    "/project",
    async () => ({
      sourceId: "github-fixture",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      owner: "acme",
      repo: "repo",
      repoSummary: {
        name: "repo",
        fullName: "acme/repo",
        description: null,
        defaultBranch: "main",
        updatedAt: null,
        pushedAt: null,
        stars: 0,
        language: null,
        topics: [],
        archived: false,
        htmlUrl: "https://github.com/acme/repo",
      },
      readme: null,
      tree: {
        sha: "tree-sha",
        truncated: false,
        entries: [{ path: "src/index.ts", type: "blob", size: 1, sha: "1" }],
      },
    }),
  );

  assert.deepEqual(entries, []);

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };
  try {
    assert.deepEqual(
      await harvestGitHubRepoSource(
        source,
        null,
        buildSelectionRegistry(),
        "/project",
        async () => {
          throw "plain github failure";
        },
      ),
      [],
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.match(warnings[0] ?? "", /plain github failure/u);
});

void test("local directory harvesting covers unreadable and frontmatter classified files", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-local-null-read-"));

  try {
    const skillPath = join(root, "skills", "fixture", "SKILL.md");
    const frontmatterSkillPath = join(
      root,
      "skills",
      "frontmatter",
      "SKILL.md",
    );
    await mkdir(join(root, "skills", "fixture"), { recursive: true });
    await mkdir(join(root, "skills", "frontmatter"), { recursive: true });
    await writeFile(skillPath, "# Fixture\n", "utf8");
    await writeFile(frontmatterSkillPath, "# Frontmatter Fixture\n", "utf8");

    const source = buildSource("local-claude-code-config", root);
    const entries = await harvestLocalDirectorySource(
      source,
      null,
      buildSelectionRegistry(),
      root,
      async (filePath) => {
        if (filePath === skillPath) {
          return null;
        }
        return [
          "---",
          "assetKind: skill",
          "---",
          "# Frontmatter Fixture",
          "",
          "Body",
          "",
        ].join("\n");
      },
    );

    assert.equal(entries.length, 1);
    const classification = entries[0]!.evidence.classification!;
    assert.equal(classification.level, "strong");
    assert.equal(
      classification.evidence[0]?.detail,
      "frontmatter supplied classification metadata",
    );
    assert.equal(
      localHarvesterInternals.classifyLocalDirectoryFile(
        source,
        "skills/fixture/SKILL.md",
      )?.assetKind,
      "skill",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("wire rollback helpers tolerate best-effort removal races", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-wire-race-"));

  try {
    const nested = join(root, "a", "b");
    await mkdir(nested, { recursive: true });
    await nativeWireInternals.removeEmptyParentDirectories(
      nested,
      root,
      async () => {
        const error = new Error("already gone") as NodeJS.ErrnoException;
        error.code = "ENOTEMPTY";
        throw error;
      },
    );
    assert.equal(
      nativeWireInternals.isBenignRemoveDirectoryRace({ code: "EEXIST" }),
      true,
    );
    assert.equal(
      nativeWireInternals.isBenignRemoveDirectoryRace({ code: "EACCES" }),
      false,
    );

    const secondNested = join(root, "c", "d");
    await mkdir(secondNested, { recursive: true });
    await nativeWireInternals.removeEmptyParentDirectories(
      secondNested,
      root,
      async () => {
        const error = new Error("exists race") as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
      },
    );

    const thirdNested = join(root, "e", "f");
    await mkdir(thirdNested, { recursive: true });
    await assert.rejects(
      nativeWireInternals.removeEmptyParentDirectories(
        thirdNested,
        root,
        async () => {
          const error = new Error("permission denied") as NodeJS.ErrnoException;
          error.code = "EACCES";
          throw error;
        },
      ),
      /permission denied/u,
    );

    assert.deepEqual(openCodeWireInternals.getManagedLinkedPaths(null), []);
    assert.deepEqual(
      openCodeWireInternals.getManagedLinkedPaths({
        linkedPaths: ["a"],
      } as never),
      ["a"],
    );

    let warningCount = 0;
    t.mock.method(console, "warn", () => {
      warningCount += 1;
    });
    await openCodeWireInternals.removeManagedLinksBestEffort(
      [join(root, "missing-link")],
      async () => {
        throw "plain rollback failure";
      },
    );
    assert.equal(warningCount, 1);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("install refresh internals cover skipped refresh and bounded batch loops", async () => {
  assert.equal(installRefreshInternals.shouldRefreshMirrorState([]), true);
  assert.equal(
    installRefreshInternals.shouldRefreshMirrorState(["--no-mirror-refresh"]),
    false,
  );

  let refreshCalled = false;
  await installRefreshInternals.refreshMirrorStateIfRequested(
    false,
    "/project",
    "/work",
    async () => {
      refreshCalled = true;
    },
  );
  assert.equal(refreshCalled, false);
  await installRefreshInternals.refreshMirrorStateIfRequested(
    true,
    "/project",
    "/work",
    async () => {
      refreshCalled = true;
    },
  );
  assert.equal(refreshCalled, true);

  let acquireCalls = 0;
  await installRefreshInternals.refreshMirrorState("/project", "/work", {
    acquire: async () => {
      acquireCalls += 1;
    },
    maxBatches: 1,
    readAcquireState: async () => buildMirrorAcquireState({ terminal: true }),
  });
  assert.equal(acquireCalls, 1);

  await assert.rejects(
    installRefreshInternals.refreshMirrorState("/project", "/work", {
      acquire: async () => undefined,
      maxBatches: 1,
      readAcquireState: async () =>
        buildMirrorAcquireState({ terminal: false }),
    }),
    /mirror refresh did not complete/u,
  );

  let installCalls = 0;
  let installArgs: string[] = [];
  await installRefreshInternals.applyBundleRefreshes(
    "/project",
    new Map([["bundle-a", new Set(["asset-a"])]]),
    {
      install: async (_projectRoot, args) => {
        installCalls += 1;
        installArgs = args;
      },
      maxBatches: 1,
      readProgressState: async () =>
        buildInstallProgressState("bundle-a", { remainingAssets: 0 }),
    },
  );
  assert.equal(installCalls, 1);
  assert.deepEqual(installArgs, [
    "--bundle",
    "bundle-a",
    "--batch-size",
    "250",
    "--asset",
    "asset-a",
  ]);

  await assert.rejects(
    installRefreshInternals.applyBundleRefreshes("/project", ["bundle-b"], {
      install: async () => undefined,
      maxBatches: 1,
      readProgressState: async () =>
        buildInstallProgressState("bundle-b", { remainingAssets: 1 }),
    }),
    /install refresh did not complete bundle 'bundle-b'/u,
  );
});

void test("preflight internals resolve platform executable search behavior", async () => {
  assert.deepEqual(
    preflightInternals.getExecutableSearchExtensions("win32", {
      PATHEXT: ".EXE;.CMD;",
    } as NodeJS.ProcessEnv),
    [".EXE", ".CMD"],
  );
  assert.deepEqual(
    preflightInternals.getExecutableSearchExtensions(
      "linux",
      {} as NodeJS.ProcessEnv,
    ),
    [""],
  );
  assert.equal(preflightInternals.getExecutableAccessMode("win32"), 0);
  assert.notEqual(preflightInternals.getExecutableAccessMode("linux"), 0);

  const env = {
    PATH: ["C:\\one", "C:\\two"].join(win32.delimiter),
    PATHEXT: ".EXE",
  } as NodeJS.ProcessEnv;
  const found = await preflightInternals.findExecutableOnPath("tool", {
    env,
    platform: "win32",
    accessPath: async (candidate) => {
      if (String(candidate).includes("two")) {
        return;
      }
      throw new Error("not found");
    },
  });
  assert.ok(found?.includes("two"));

  assert.equal(
    await preflightInternals.findExecutableOnPath("missing", {
      env: { PATH: "" } as NodeJS.ProcessEnv,
      platform: "linux",
      accessPath: async () => undefined,
    }),
    null,
  );
  assert.equal(
    await preflightInternals.resolveRuntimeExecutable(
      "node",
      "linux",
      async () => "/unused/node",
    ),
    "node",
  );
  assert.equal(
    await preflightInternals.resolveRuntimeExecutable(
      "node",
      "win32",
      async () => "C:\\Tools\\node.exe",
    ),
    "C:\\Tools\\node.exe",
  );
  assert.equal(
    await preflightInternals.resolveRuntimeExecutable(
      "node",
      "win32",
      async () => null,
    ),
    "node",
  );
  assert.equal(preflightInternals.resolveFoundExecutable("node", null), "node");
});

void test("source sync indexed references fall back to URL strings for root URLs", () => {
  const source = buildSource("registry-source", "https://registry.example/");
  const context = buildSourceSyncContext();

  const entry = sourceSyncInternals.buildIndexedReferenceItem(
    source,
    context,
    new URL("https://registry.example/"),
    {
      assetKind: "reference-pack",
      compatibilityMode: "reference-only",
      installMethod: "registry-reference",
    },
  );

  assert.equal(entry.install.manifestEntry, "https://registry.example/");
  assert.equal(entry.displayName, "registry.example");

  const explicit = sourceSyncInternals.buildIndexedReferenceItem(
    source,
    context,
    new URL("https://registry.example/packages/demo"),
    {
      assetKind: "reference-pack",
      compatibilityMode: "reference-only",
      installMethod: "registry-reference",
      manifestEntry: "custom-entry",
      displayName: "Custom",
      summary: "Custom summary",
      installs: 7,
    },
  );
  assert.equal(explicit.install.manifestEntry, "custom-entry");
  assert.equal(explicit.displayName, "Custom");
  assert.equal(explicit.maintenance.stars, 7);
});

void test("small error and fallback helpers keep non-Error values deterministic", async () => {
  assert.equal(
    aiEnrichmentInternals.toAiEnrichmentErrorMessage(new Error("ai boom")),
    "ai boom",
  );
  assert.equal(aiEnrichmentInternals.toAiEnrichmentErrorMessage(500), "500");
  assert.equal(
    aiEnrichmentInternals.shouldAllowAiEnrichmentCache(false, false),
    true,
  );
  assert.equal(
    aiEnrichmentInternals.shouldAllowAiEnrichmentCache(false, true),
    false,
  );
  assert.equal(
    aiEnrichmentInternals.shouldAllowAiEnrichmentCache(true, true),
    true,
  );
  assert.equal(
    recommendationAiReviewInternals.toAiReviewErrorMessage(new Error("boom")),
    "boom",
  );
  assert.equal(
    recommendationAiReviewInternals.toAiReviewErrorMessage(404),
    "404",
  );
  assert.equal(
    recommendCommandInternals.resolveRecommendationLimitOverrideMode({}),
    "preserve",
  );
  assert.equal(
    recommendCommandInternals.resolveRecommendationLimitOverrideMode({
      recommendationLimitOverrideMode: "replace",
    }),
    "replace",
  );
  assert.equal(
    await mirrorAcquireInternals.pathLooksReadable(
      join(tmpdir(), "definitely-missing-file"),
    ),
    false,
  );
});

function restoreProcessEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function buildSource(id: string, endpoint: string): SourceDefinition {
  return {
    id,
    name: id,
    kind: id.startsWith("local-") ? "local-directory" : "registry",
    authorityTier: id.startsWith("local-")
      ? "trusted-local"
      : "official-first-party",
    publisher: { name: "Fixture", verified: true },
    hosts: ["copilot-vscode"],
    assetKinds: ["skill", "reference-pack"],
    discoveryMode: "catalog",
    priority: 100,
    enabled: true,
    endpoints: id.startsWith("local-")
      ? { path: endpoint, directory: endpoint }
      : { baseUrl: endpoint },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
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

function buildSourceSyncContext() {
  return {
    demandProfile: null,
    selectionRegistry: buildSelectionRegistry(),
    entriesById: new Map<string, AssetCatalogEntry>(),
    entriesDirty: false,
    previousState: undefined,
    observedEntryIds: new Set<string>(),
  };
}

function buildMirrorAcquireState(
  overrides: Partial<MirrorAcquireState> = {},
): MirrorAcquireState {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    batchSize: 1,
    totalEligibleCount: 1,
    mirroredCount: 0,
    remainingCount: 1,
    skippedCount: 0,
    skippedAssetIds: [],
    skippedAssetReasons: {},
    lastBatchAssetIds: [],
    lastBatchMirroredCount: 0,
    lastBatchSkippedCount: 0,
    lastBatchSkippedReasons: {},
    terminal: false,
    ...overrides,
  };
}

function buildInstallProgressState(
  bundleId: string,
  overrides: Partial<InstallProgressState["bundles"][string]> = {},
): InstallProgressState {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    bundles: {
      [bundleId]: {
        host: "copilot-vscode",
        batchSize: 1,
        totalAssets: 1,
        installedAssets: 0,
        remainingAssets: 1,
        lastBatchAssetIds: [],
        skippedAssetIds: [],
        ...overrides,
      },
    },
  };
}
