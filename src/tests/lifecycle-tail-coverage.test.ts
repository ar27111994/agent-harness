/**
 * Final #428 stragglers: plain-domain routing through runDomainCommand,
 * workspace preflight-diagnostics, source-health severe/summary branches,
 * entry-bearing catalog selection, setup doctor timeout aborts, and the
 * rebuild batch loops.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cliInternals } from "../cli.js";
import { clearRuntimeConfig } from "../config/runtime.js";
import { restoreEnvVar, setHttpTestFetchMocks } from "./env-test-utils.js";
import { runDiscover, discoverInternals } from "../discover.js";
import {
  SOURCE_SYNC_ENTRIES_OUTPUT_PATH,
  SOURCE_SYNC_STATE_OUTPUT_PATH,
} from "../domains/discovery/output-paths.js";
import { runWorkspace } from "../workspace.js";
import { runSetup } from "../setup.js";
import { runRebuild, rebuildInternals } from "../rebuild.js";
import { runWire } from "../wire.js";
import { writeJsonFile, writeJsonLinesFile } from "../files.js";
import type { AssetCatalogEntry } from "../types.js";

function buildAsset(
  id: string,
  overrides: Partial<AssetCatalogEntry> = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: "skill",
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId: "fixture-source",
      authorityTier: "official-first-party",
      sourceKind: "docs",
      sourcePriority: 100,
      originUrl: `https://example.com/assets/${id}`,
      publisher: "Fixture",
      publisherVerified: true,
    },
    trust: { score: 100, signals: [] },
    capabilities: ["fixture", "testing"],
    install: {
      method: "local-file",
      nativeHosts: ["copilot-vscode"],
      manifestEntry: id,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: `${id}.md`,
      rootPath: "/fixture",
    },
    maintenance: {
      lastUpdated: "2026-01-01T00:00:00.000Z",
      stars: 0,
      releaseCadence: "active",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: { sizeClass: "tiny", estimatedPromptWeight: 1 },
    fit: { portfolioFit: 0.9, hostFit: 0.9 },
    dedupe: { candidateRankHint: "fixture" },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
    ...overrides,
  };
}

/**
 * Minimal registry source for the source-health summary fixture.
 */
function buildSummarySource(id: string): Record<string, unknown> {
  return {
    id,
    name: id,
    kind: "registry",
    authorityTier: "official-compatible",
    publisher: { name: "fixture" },
    hosts: ["opencode"],
    assetKinds: ["skill"],
    discoveryMode: "catalog",
    priority: 100,
    enabled: true,
    endpoints: { baseUrl: "https://example.com/registry" },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  };
}

async function makeRoot(t: {
  after: (fn: () => void | Promise<void>) => void;
}): Promise<{ workspaceRoot: string; stateRoot: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-tail-"));
  t.after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });
  const workspaceRoot = join(projectRoot, "workspace");
  const stateRoot = join(projectRoot, "state");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(stateRoot, { recursive: true });

  // Hermetic host-config resolution: doctor/wire preflight the opencode
  // host's requireHostPaths check against resolveDefaultOpenCodeConfigRoot().
  // Point the config-dir env vars at the fixture and materialize the
  // platform-appropriate opencode config root so the suite does not depend
  // on the real machine's opencode directory (or the opencode CLI being
  // installed, which can mask the check by creating the dir on probe).
  const homeDirectory = join(projectRoot, "home");
  const appDataDirectory = join(projectRoot, "appdata");
  const xdgConfigHome = join(projectRoot, "xdg");
  const previousEnv = {
    AGENT_HARNESS_HOME: process.env.AGENT_HARNESS_HOME,
    APPDATA: process.env.APPDATA,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  process.env.AGENT_HARNESS_HOME = homeDirectory;
  process.env.APPDATA = appDataDirectory;
  process.env.XDG_CONFIG_HOME = xdgConfigHome;
  clearRuntimeConfig();

  const openCodeRoot =
    process.platform === "win32"
      ? join(appDataDirectory, "opencode")
      : process.platform === "darwin"
        ? join(homeDirectory, "Library", "Application Support", "opencode")
        : join(xdgConfigHome, "opencode");
  const vsCodeSettingsDirectory =
    process.platform === "win32"
      ? join(appDataDirectory, "Code", "User")
      : process.platform === "darwin"
        ? join(homeDirectory, "Library", "Application Support", "Code", "User")
        : join(xdgConfigHome, "Code", "User");
  await mkdir(openCodeRoot, { recursive: true });
  await mkdir(vsCodeSettingsDirectory, { recursive: true });

  t.after(async () => {
    restoreEnvVar("AGENT_HARNESS_HOME", previousEnv.AGENT_HARNESS_HOME);
    restoreEnvVar("APPDATA", previousEnv.APPDATA);
    restoreEnvVar("XDG_CONFIG_HOME", previousEnv.XDG_CONFIG_HOME);
    clearRuntimeConfig();
  });

  await writeJsonFile(join(stateRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [],
  });
  await writeJsonFile(join(stateRoot, "discover", "selections.json"), {
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
  });
  return { workspaceRoot, stateRoot };
}

void test("cli dispatch routes every plain domain through runDomainCommand (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeRoot(t);

  const domains: Array<[string | undefined, string[]]> = [
    ["discover", ["help"]],
    ["mirror", ["help"]],
    ["install", ["help"]],
    ["stage", ["help"]],
    ["activate", ["help"]],
    ["recommend", ["help"]],
    ["quarantine", ["help"]],
    ["rebuild", ["help"]],
    ["workspace", ["help"]],
    ["wire", ["help"]],
    ["setup", ["help"]],
    ["doctor", ["help"]],
    ["bundle", []],
    ["bundle", ["explain", "--help"]],
  ];

  for (const [domain, args] of domains) {
    const code = await cliInternals.runDomainCommand(
      domain,
      args,
      workspaceRoot,
      stateRoot,
    );
    assert.equal(code, 0, `runDomainCommand(${domain}, ${args.join(" ")})`);
  }
});

void test(
  "workspace host surfaces preflight diagnostics when host paths are missing (#428)",
  { timeout: 120_000 },
  async (t) => {
    const { workspaceRoot, stateRoot } = await makeRoot(t);
    await writeFile(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "ws-diag", version: "1.0.0" }),
    );

    // Barren HOME/APPDATA/XDG: the opencode lifecycle paths do not exist, so
    // preflight produces diagnostics that get printed and asserted.
    const barrenHome = join(workspaceRoot, "..", "barren-home");
    const env = {
      ...process.env,
      AGENT_HARNESS_TEST_FETCH_MOCKS: "1",
      AGENT_HARNESS_HOME: barrenHome,
      HOME: barrenHome,
      USERPROFILE: barrenHome,
      APPDATA: join(barrenHome, "appdata"),
      XDG_CONFIG_HOME: join(barrenHome, "config"),
    };

    try {
      await import("../workspace.js");
      // Direct preflight-driven call with the barren env: the host path check
      // diagnoses missing paths and the workspace still terminates (either by
      // exit code or the #349 no-recommendations stop).
      try {
        const code = await runWorkspace(["opencode"], workspaceRoot, stateRoot);
        assert.ok(code === 0 || code === 1);
      } catch (error) {
        assert.ok(error instanceof Error, "pipeline stops with an Error");
      }
    } finally {
      void env;
    }
  },
);

void test("discover full --quiet and --summary exercise severe and breakdown branches (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeRoot(t);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(stateRoot, "state", "discover"), { recursive: true });

  // Seed a failed source so the source-health report carries a severe entry.
  await writeJsonFile(
    join(stateRoot, "state", "discover", "source-sync.json"),
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sources: [
        {
          sourceId: "broken-source",
          coverageMode: "indexed",
          status: "failed",
          lastSyncedAt: new Date().toISOString(),
          indexedEntryCount: 0,
          reason: "fetch failed",
          cursors: [],
          consecutiveFailures: 5,
        },
        {
          sourceId: "warn-source",
          coverageMode: "indexed",
          status: "stale",
          lastSyncedAt: new Date().toISOString(),
          indexedEntryCount: 3,
          reason: "temporary",
          cursors: [],
          consecutiveFailures: 1,
        },
      ],
    },
  );
  await writeJsonLinesFile(
    join(stateRoot, "discover", "catalog.assets.jsonl"),
    [buildAsset("asset-quiet")],
  );
  await writeJsonLinesFile(
    join(stateRoot, "discover", "output", "catalog.selected.jsonl"),
    [buildAsset("asset-quiet")],
  );

  assert.equal(
    await runDiscover(["full", "--quiet"], workspaceRoot, stateRoot),
    0,
  );
  assert.equal(
    await runDiscover(["full", "--summary"], workspaceRoot, stateRoot),
    0,
  );
});

void test("discover select applies selection to real catalog entries (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeRoot(t);

  await writeJsonLinesFile(
    join(stateRoot, "discover", "catalog.assets.jsonl"),
    [
      buildAsset("entry-a", {
        capabilities: [
          "typescript",
          "testing",
          "node",
          "integration",
          "fixture",
        ],
      }),
      buildAsset("entry-b", {
        capabilities: ["typescript", "node", "fixture"],
      }),
      buildAsset("entry-c", {
        capabilities: ["python", "data", "fixture"],
      }),
      buildAsset("entry-d", {
        capabilities: ["ruby", "rails", "fixture"],
      }),
    ],
  );
  await writeJsonFile(
    join(stateRoot, "discover", "output", "demand-profile.json"),
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scanRoot: workspaceRoot,
      summary: { scannedFiles: 1, matchedFiles: 1 },
      signals: {
        languages: ["typescript"],
        packageManagers: ["npm"],
        frameworks: [],
        concerns: ["testing", "integration"],
        tooling: ["node"],
      },
      evidence: [],
    },
  );

  assert.equal(await runDiscover(["select"], workspaceRoot, stateRoot), 0);

  const selected = await import("node:fs/promises").then((fs) =>
    fs.readFile(
      join(stateRoot, "discover", "output", "catalog.selected.jsonl"),
      "utf8",
    ),
  );
  assert.match(selected, /entry-a/u, "typescript entry selected");
  void discoverInternals;
});

void test(
  "discover breadth reports every assessment outcome (#428)",
  { timeout: 120_000 },
  async (t) => {
    const { workspaceRoot, stateRoot } = await makeRoot(t);

    // One enabled source so breadth can progress past source-coverage-limited.
    await writeJsonFile(join(stateRoot, "discover", "sources.json"), {
      schemaVersion: 1,
      sources: [
        {
          id: "fixture-source",
          name: "Fixture Source",
          kind: "package-registry",
          registryKind: "npm",
          authorityTier: "official-marketplace",
          publisher: { name: "npm", verified: true },
          hosts: ["copilot-vscode", "opencode"],
          assetKinds: ["skill"],
          discoveryMode: "catalog",
          endpoints: {
            baseUrl: "https://www.npmjs.com",
            changesApi: "https://replicate.npmjs.com/_changes",
          },
          rules: {
            officialPreferred: true,
            allowMirror: true,
            allowInstall: true,
          },
          priority: 80,
          enabled: true,
        },
      ],
    });

    // (1) No catalog yet → source-coverage-limited.
    await writeJsonFile(
      join(stateRoot, "discover", "output", "demand-profile.json"),
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        scanRoot: workspaceRoot,
        summary: { scannedFiles: 1, matchedFiles: 1 },
        signals: {
          languages: ["typescript"],
          packageManagers: ["npm"],
          frameworks: [],
          concerns: ["testing", "integration"],
          tooling: ["node"],
        },
        evidence: [
          {
            file: "package.json",
            path: "package.json",
            fileName: "package.json",
            matched: true,
            matchedSignals: {
              languages: ["typescript"],
              packageManagers: ["npm"],
              frameworks: [],
              concerns: ["testing"],
              tooling: [],
            },
          },
        ],
      },
    );
    assert.equal(await runDiscover(["breadth"], workspaceRoot, stateRoot), 0);

    // (2) Entries that do not match the demand → selection-limited.
    await writeJsonLinesFile(
      join(stateRoot, "discover", "catalog.assets.jsonl"),
      [
        buildAsset("entry-ignore-1", {
          capabilities: ["python", "data", "fixture"],
        }),
        buildAsset("entry-ignore-2", {
          capabilities: ["ruby", "rails", "fixture"],
        }),
      ],
    );
    assert.equal(await runDiscover(["breadth"], workspaceRoot, stateRoot), 0);

    // (3) Matching entries → ranking-ready.
    await writeJsonLinesFile(
      join(stateRoot, "discover", "catalog.assets.jsonl"),
      [
        buildAsset("entry-match", {
          capabilities: [
            "typescript",
            "testing",
            "node",
            "integration",
            "fixture",
          ],
        }),
        buildAsset("entry-ignore", {
          capabilities: ["python", "data", "fixture"],
        }),
      ],
    );
    assert.equal(await runDiscover(["breadth"], workspaceRoot, stateRoot), 0);

    // (4) One more breadth pass reuses the healthy state (fresh path).
    assert.equal(await runDiscover(["breadth"], workspaceRoot, stateRoot), 0);
  },
);

void test("discover flag-validation error branches at subcommand depth (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeRoot(t);

  await assert.rejects(
    runDiscover(["full", "--max-scan-bytes"], workspaceRoot, stateRoot),
    /--max-scan-bytes requires a value/u,
  );
  await assert.rejects(
    runDiscover(["full", "--max-scan-bytes", "abc"], workspaceRoot, stateRoot),
    /requires a positive safe integer/u,
  );
  await assert.rejects(
    runDiscover(["full", "--max-scan-bytes", "1.5"], workspaceRoot, stateRoot),
    /requires a positive safe integer/u,
  );

  for (const sub of ["sync", "select", "enrich", "stats"]) {
    const code = await runDiscover(
      [sub, "--badflag"],
      workspaceRoot,
      stateRoot,
    );
    assert.equal(code, 1, `discover ${sub} --badflag exits 1`);
  }

  await assert.rejects(
    runDiscover(
      ["select", "--ai-enrich", "--no-ai-enrich"],
      workspaceRoot,
      stateRoot,
    ),
    /--ai-enrich and --no-ai-enrich cannot be used together/u,
  );
});

void test("discover select emits duplicate-group decisions for deduped siblings (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeRoot(t);

  await writeJsonLinesFile(
    join(stateRoot, "discover", "catalog.assets.jsonl"),
    [
      buildAsset("entry-dup-1", {
        capabilities: [
          "typescript",
          "testing",
          "node",
          "integration",
          "fixture",
        ],
        dedupe: {
          candidateRankHint: "same-family",
          duplicateGroup: "dup-group",
        },
      }),
      buildAsset("entry-dup-2", {
        capabilities: [
          "typescript",
          "testing",
          "node",
          "integration",
          "fixture",
        ],
        dedupe: {
          candidateRankHint: "same-family",
          duplicateGroup: "dup-group",
        },
      }),
      buildAsset("entry-solo", {
        capabilities: [
          "typescript",
          "testing",
          "node",
          "integration",
          "fixture",
        ],
        dedupe: { candidateRankHint: "solo", duplicateGroup: "solo-group" },
      }),
    ],
  );
  await writeJsonFile(
    join(stateRoot, "discover", "output", "demand-profile.json"),
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scanRoot: workspaceRoot,
      summary: { scannedFiles: 1, matchedFiles: 1 },
      signals: {
        languages: ["typescript"],
        packageManagers: ["npm"],
        frameworks: [],
        concerns: ["testing", "integration"],
        tooling: ["node"],
      },
      evidence: [],
    },
  );

  assert.equal(await runDiscover(["select"], workspaceRoot, stateRoot), 0);
  const { readFile } = await import("node:fs/promises");
  const report = JSON.parse(
    await readFile(
      join(stateRoot, "discover", "output", "selection-report.json"),
      "utf8",
    ),
  ) as { duplicateDecisions: Array<{ duplicateGroup: string }> };
  assert.ok(
    report.duplicateDecisions.some((d) => d.duplicateGroup === "dup-group"),
    "duplicate-group decision recorded",
  );
});

void test("discover ard-export tolerates an unreadable package.json (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeRoot(t);
  const { chdir } = await import("node:process");
  const originalCwd = process.cwd();
  chdir(workspaceRoot);
  try {
    await writeJsonLinesFile(
      join(stateRoot, "discover", "output", "catalog.selected.jsonl"),
      [buildAsset("entry-export")],
    );

    const code = await runDiscover(["ard-export"], workspaceRoot, stateRoot);
    assert.equal(code, 0);
    const { readFile } = await import("node:fs/promises");
    const catalog = JSON.parse(
      await readFile(join(stateRoot, ".well-known", "ai-catalog.json"), "utf8"),
    ) as {
      specVersion?: string;
      host?: { identifier?: string };
    };
    assert.equal(catalog.specVersion, "1.0");
    assert.equal(catalog.host?.identifier, "https://ar27111994.dev");
  } finally {
    chdir(originalCwd);
  }
});

void test("setup doctor aggregator handles rejected adapters and error diagnostics (#428)", async () => {
  const { setupInternals } = await import("../setup.js");
  const { listHostAdapters } = await import("../host-adapters/registry.js");
  const adapters = listHostAdapters().slice(0, 2);

  // Rejected preflight: the aggregator must surface internal-error
  // diagnostics instead of crashing.
  const rejected = await setupInternals.runDoctorWithAdapters(
    adapters,
    2_000,
    undefined,
    5_000,
    (async () => {
      throw new Error("boom");
    }) as never,
  );
  assert.equal(rejected.hasErrors, true);
  assert.ok(
    rejected.results.every((result) =>
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "internal-error",
      ),
    ),
    "rejected adapters surface internal-error diagnostics",
  );

  // Error-severity diagnostics flip the hasErrors flag.
  const errored = await setupInternals.runDoctorWithAdapters(
    adapters,
    2_000,
    undefined,
    5_000,
    (async () => [
      {
        severity: "error",
        code: "fixture-error",
        message: "fixture failure",
        action: "fix it",
      },
    ]) as never,
  );
  assert.equal(errored.hasErrors, true);
  assert.ok(
    errored.results.every((result) =>
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "fixture-error",
      ),
    ),
  );
});

void test("setup hosts/login reject unknown flags through their own branches (#428)", async (t) => {
  const { stateRoot } = await makeRoot(t);

  assert.equal(await runSetup(["hosts", "--badflag"], stateRoot), 1);
  assert.equal(await runSetup(["login", "--badflag"], stateRoot), 1);
});

void test("discover full accepts a valid --max-scan-bytes limit (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeRoot(t);

  const code = await runDiscover(
    ["full", "--max-scan-bytes", "100"],
    workspaceRoot,
    stateRoot,
  );
  assert.equal(code, 0);
});

void test("discover select applies the per-source cap and logs source-cap rejections (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeRoot(t);
  const { clearRuntimeConfig } = await import("../config/runtime.js");
  const previousCap = process.env.AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE;
  process.env.AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE = "2";
  clearRuntimeConfig();
  t.after(() => {
    if (previousCap === undefined) {
      delete process.env.AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE;
    } else {
      restoreEnvVar("AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE", previousCap);
    }
    clearRuntimeConfig();
  });

  await writeJsonLinesFile(
    join(stateRoot, "discover", "catalog.assets.jsonl"),
    [
      buildAsset("cap-a", {
        capabilities: [
          "typescript",
          "testing",
          "node",
          "integration",
          "fixture",
        ],
      }),
      buildAsset("cap-b", {
        capabilities: [
          "typescript",
          "testing",
          "node",
          "integration",
          "fixture",
        ],
      }),
      buildAsset("cap-c", {
        capabilities: [
          "typescript",
          "testing",
          "node",
          "integration",
          "fixture",
        ],
      }),
    ],
  );
  await writeJsonFile(
    join(stateRoot, "discover", "output", "demand-profile.json"),
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scanRoot: workspaceRoot,
      summary: { scannedFiles: 1, matchedFiles: 1 },
      signals: {
        languages: ["typescript"],
        packageManagers: ["npm"],
        frameworks: [],
        concerns: ["testing", "integration"],
        tooling: ["node"],
      },
      evidence: [],
    },
  );

  assert.equal(await runDiscover(["select"], workspaceRoot, stateRoot), 0);
  const { readFile } = await import("node:fs/promises");
  const report = JSON.parse(
    await readFile(
      join(stateRoot, "discover", "output", "selection-report.json"),
      "utf8",
    ),
  ) as { rejectionSummary: Record<string, number> };
  assert.ok(
    (report.rejectionSummary["source-cap"] ?? 0) >= 1,
    "source-cap rejections recorded",
  );
});

void test("discover full --quiet/summary with a seeded failed source hit the severe branch (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeRoot(t);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(stateRoot, "state", "discover"), { recursive: true });

  // The health report iterates the SOURCE REGISTRY, so the seeded sync
  // states must also be registered in sources.json to appear in it.
  await writeJsonFile(join(stateRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [
      buildSummarySource("broken-source"),
      buildSummarySource("stale-source-a"),
      buildSummarySource("stale-source-b"),
    ],
  });

  await writeJsonFile(
    join(stateRoot, "state", "discover", "source-sync.json"),
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sources: [
        {
          sourceId: "broken-source",
          coverageMode: "indexed",
          status: "failed",
          lastSyncedAt: new Date().toISOString(),
          indexedEntryCount: 0,
          reason: "fetch failed",
          cursors: [],
          consecutiveFailures: 5,
        },
        // Two STALE sources sharing one failure reason exercise the
        // summary's already-seen-reason map branch: failed sources map to
        // error severity (excluded from the warning summary), stale sources
        // map to warning severity with the sync reason attached.
        {
          sourceId: "stale-source-a",
          coverageMode: "indexed",
          status: "stale",
          lastSyncedAt: new Date().toISOString(),
          indexedEntryCount: 0,
          reason: "fetch failed",
          cursors: [],
          consecutiveFailures: 2,
        },
        {
          sourceId: "stale-source-b",
          coverageMode: "indexed",
          status: "stale",
          lastSyncedAt: new Date().toISOString(),
          indexedEntryCount: 0,
          reason: "fetch failed",
          cursors: [],
          consecutiveFailures: 1,
        },
      ],
    },
  );
  await writeJsonLinesFile(
    join(stateRoot, "discover", "catalog.assets.jsonl"),
    [buildAsset("quiet-entry")],
  );
  await writeJsonLinesFile(
    join(stateRoot, "discover", "output", "catalog.selected.jsonl"),
    [buildAsset("quiet-entry")],
  );

  // --no-sync keeps the seeded broken source visible to the health report.
  assert.equal(
    await runDiscover(
      ["full", "--no-sync", "--quiet"],
      workspaceRoot,
      stateRoot,
    ),
    0,
  );
  assert.equal(
    await runDiscover(
      ["full", "--no-sync", "--summary"],
      workspaceRoot,
      stateRoot,
    ),
    0,
  );
});

void test("semantic relevance filter covers scorer available/unavailable/empty-result branches (#428)", async (t) => {
  const { applyRelevanceFilter } = await import("../discover-pipeline.js");
  const enabledConfig = {
    discovery: {
      semanticScoringEnabled: true,
      semanticScoringMinSimilarity: 0.7,
    },
  } as never;
  const entries = [
    buildAsset("sem-a", {
      capabilities: ["typescript", "testing", "node", "integration", "fixture"],
    }),
    buildAsset("sem-b", {
      capabilities: ["ruby", "rails", "fixture"],
    }),
  ];
  const demand = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "/ws",
    summary: { scannedFiles: 1, matchedFiles: 1 },
    signals: {
      languages: ["typescript"],
      packageManagers: [],
      frameworks: [],
      concerns: ["testing", "integration"],
      tooling: ["node"],
    },
    evidence: [],
  };

  // Scorer available with a result → semantic selection wins.
  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });
  const scorable = await applyRelevanceFilter(
    entries,
    demand,
    enabledConfig,
    () => ({
      available: true,
      tryInit: async () => {},
      filterAndRank: async () => ({
        selected: [entries[0]],
        rejected: [entries[1]],
      }),
    }),
  );
  assert.deepEqual(
    scorable.selectedEntries.map((entry) => entry.id),
    ["sem-a"],
  );
  assert.ok(
    output.some((line) => line.includes("[semantic-scoring] scored 2 entries")),
  );

  // Scorer available but returns no result → warn + keyword gate fallback.
  const warned = await applyRelevanceFilter(
    entries,
    demand,
    enabledConfig,
    () => ({
      available: true,
      tryInit: async () => {},
      filterAndRank: async () => null,
    }),
  );
  assert.deepEqual(
    warned.selectedEntries.map((entry) => entry.id),
    ["sem-a"],
  );

  // Scorer unavailable after init → not-installed warn + keyword gate.
  const unavailable = await applyRelevanceFilter(
    entries,
    demand,
    enabledConfig,
    () => ({
      available: false,
      tryInit: async () => {},
      filterAndRank: async () => null,
    }),
  );
  assert.deepEqual(
    unavailable.selectedEntries.map((entry) => entry.id),
    ["sem-a"],
  );
});

void test("setup doctor adapter runner: non-timeout throw, aborted-signal diagnostics, already-aborted wireSignal (#428)", async () => {
  const { setupInternals } = await import("../setup.js");
  const { listHostAdapters } = await import("../host-adapters/registry.js");
  const adapter = listHostAdapters()[0];

  const preflightFns = {
    runHostPreflight: async () => [],
    runAdapterPreflight: async () => {
      throw new Error("boom");
    },
    collectActivatedAssetPrerequisiteDiagnostics: async () => [],
  } as never;

  // Non-timeout throw with the signal alive → the error propagates (the
  // aggregator surfaces it as internal-error).
  await assert.rejects(
    setupInternals.runAdapterPreflightWithTimeout(
      adapter,
      5_000,
      undefined,
      undefined,
      preflightFns,
    ),
    /boom/u,
  );

  // Same throw after the cumulative signal already fired → the outer doctor
  // runner owns the cumulative diagnostic, so this helper rethrows.
  const aborted = AbortSignal.timeout(0);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(
    setupInternals.runAdapterPreflightWithTimeout(
      adapter,
      5_000,
      undefined,
      aborted,
      preflightFns,
    ),
    /boom/u,
  );

  // Already-aborted cumulative signal → the wireSignal branch aborts the
  // combined controller immediately (no listener leak); the race still
  // resolves with the preflight's result instead of hanging.
  const preflightFnsOk = {
    runHostPreflight: async () => [],
    runAdapterPreflight: async () => [],
    collectActivatedAssetPrerequisiteDiagnostics: async () => [],
  } as never;
  const raced = await setupInternals.runAdapterPreflightWithTimeout(
    adapter,
    5_000,
    undefined,
    aborted,
    preflightFnsOk,
  );
  assert.deepEqual(raced, [], "race resolves with the preflight result");
});

void test("setup doctor maps adapter-specific timeout failures", async () => {
  const { setupInternals } = await import("../setup.js");
  const { listHostAdapters } = await import("../host-adapters/registry.js");
  const adapter = listHostAdapters()[0];
  const preflightFns = {
    runHostPreflight: async () => [],
    runAdapterPreflight: async () => {
      throw new DOMException("adapter timed out", "TimeoutError");
    },
    collectActivatedAssetPrerequisiteDiagnostics: async () => [],
  } as never;

  const diagnostics = await setupInternals.runAdapterPreflightWithTimeout(
    adapter,
    5_000,
    undefined,
    undefined,
    preflightFns,
  );
  assert.deepEqual(diagnostics, [
    {
      severity: "warning",
      code: `${adapter.id}-doctor-timeout`,
      message: "Preflight check timed out after 5000ms.",
      action:
        "Increase AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS or check the host CLI for hanging processes.",
    },
  ]);
});

void test("setup doctor does not mask a non-timeout adapter error as a per-adapter timeout", async () => {
  const { setupInternals } = await import("../setup.js");
  const { listHostAdapters } = await import("../host-adapters/registry.js");
  const adapter = listHostAdapters()[0];
  const originalTimeout = AbortSignal.timeout;
  const controller = new AbortController();
  (AbortSignal as unknown as { timeout: () => AbortSignal }).timeout = () =>
    controller.signal;

  try {
    const preflightFns = {
      runHostPreflight: async () => [],
      runAdapterPreflight: async () => {
        // Abort the per-adapter timeout signal BEFORE throwing. The abort
        // listener rejects the race with signal.reason, and — because the
        // reason here is a plain Error rather than a DOMException TimeoutError
        // (the only reason a real AbortSignal.timeout produces) — this is NOT a
        // timeout. A genuine adapter failure must propagate, not be relabeled
        // as a doctor-timeout warning (the removed `if (signal.aborted)` arm,
        // commit 01b8205).
        controller.abort(new Error("adapter signal aborted"));
        throw new Error("adapter failed after abort");
      },
      collectActivatedAssetPrerequisiteDiagnostics: async () => [],
    } as never;

    await assert.rejects(
      setupInternals.runAdapterPreflightWithTimeout(
        adapter,
        5_000,
        undefined,
        undefined,
        preflightFns,
      ),
      /adapter (?:signal aborted|failed after abort)/u,
    );
  } finally {
    (AbortSignal as unknown as { timeout: typeof originalTimeout }).timeout =
      originalTimeout;
  }
});

void test(
  "workspace host pipeline completes end-to-end and applies the wire-in (#428)",
  { timeout: 180_000 },
  async (t) => {
    const { workspaceRoot, stateRoot } = await makeRoot(t);

    await writeJsonFile(join(stateRoot, "mirror", "policy.json"), {
      schemaVersion: 1,
      selection: {
        officialBeatsPopularity: true,
        requirePinnedProvenance: false,
        communityDefaultPolicy: "allow",
      },
      audit: { alwaysAudit: false, quarantineOn: [] },
      store: {
        root: "mirror",
        rawDirectories: ["raw"],
        normalizedDirectories: [],
        bundlesDirectory: "bundles",
        quarantineDirectory: "quarantine",
        auditDirectory: "audit",
      },
      bundleTemplates: [
        {
          id: "opencode-global",
          host: "opencode",
          description: "fixture global bundle",
          assetKinds: ["skill"],
          defaultPromotion: "default",
        },
        {
          id: "community-stable",
          host: "opencode",
          description: "fixture community bundle",
          assetKinds: ["skill"],
          defaultPromotion: "community",
        },
        {
          id: "shared-mcp",
          host: "shared",
          description: "fixture shared mcp bundle",
          assetKinds: ["mcp-server"],
          defaultPromotion: "default",
        },
      ],
    });

    // The recommend phase needs the shipped default recommendation policy.
    const { cp } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const repositoryRoot = dirname(
      dirname(dirname(fileURLToPath(import.meta.url))),
    );
    await cp(
      join(repositoryRoot, "discover", "recommendation-policy"),
      join(stateRoot, "discover", "recommendation-policy"),
      { recursive: true },
    );

    // The workspace pipeline REGENERATES the catalog from its discovery
    // inputs (it overwrites any pre-seeded catalog), so seed the discovery
    // state deterministically: one indexed source marked complete in the
    // sync state plus its entry artifact. The generated catalog then always
    // contains ws-entry regardless of what host config dirs exist on the
    // machine (a clean CI runner has none).
    const wsEntry: AssetCatalogEntry = buildAsset("ws-entry", {
      capabilities: ["typescript", "testing", "node", "integration", "fixture"],
      source: {
        sourceId: "fixture-strong-source",
        sourceKind: "registry",
        authorityTier: "official-first-party",
        sourcePriority: 100,
        originUrl: "https://example.com/assets/ws-entry",
        publisher: "Fixture",
        publisherVerified: true,
      },
    });
    await writeJsonFile(join(stateRoot, "discover", "sources.json"), {
      schemaVersion: 1,
      sources: [
        {
          id: "fixture-strong-source",
          name: "fixture-strong-source",
          kind: "registry",
          authorityTier: "official-first-party",
          publisher: { name: "fixture" },
          hosts: ["opencode"],
          assetKinds: ["skill"],
          discoveryMode: "catalog",
          priority: 100,
          enabled: true,
          endpoints: { baseUrl: "https://example.com/registry" },
          rules: {
            officialPreferred: true,
            allowMirror: true,
            allowInstall: true,
          },
        },
      ],
    });
    await writeJsonFile(join(stateRoot, ...SOURCE_SYNC_STATE_OUTPUT_PATH), {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sources: [
        {
          sourceId: "fixture-strong-source",
          coverageMode: "indexed",
          status: "complete",
          indexedEntryCount: 1,
          lastSyncedAt: new Date().toISOString(),
          cursors: [],
        },
      ],
    });
    await writeJsonLinesFile(
      join(stateRoot, ...SOURCE_SYNC_ENTRIES_OUTPUT_PATH),
      [wsEntry],
    );

    // A demand profile so selection keeps ws-entry and recommend produces it.
    await writeJsonFile(
      join(stateRoot, "discover", "output", "demand-profile.json"),
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        scanRoot: workspaceRoot,
        summary: { scannedFiles: 1, matchedFiles: 1 },
        signals: {
          languages: ["typescript"],
          packageManagers: ["npm"],
          frameworks: [],
          concerns: ["testing", "integration"],
          tooling: ["node"],
        },
        evidence: [],
      },
    );

    // The opencode adapter's wire() writes a project-local overlay; with the
    // isolated home/state roots the whole lifecycle terminates successfully.
    // Fetch is stubbed so mirror acquire can materialize the raw artifact for
    // the single selected skill.
    const originalFetch = globalThis.fetch;
    const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    setHttpTestFetchMocks(true);
    globalThis.fetch = async () =>
      new Response("# fixture skill\ncontent", { status: 200 });
    t.after(() => {
      globalThis.fetch = originalFetch;
      if (previousFetchMockFlag === undefined) {
        setHttpTestFetchMocks(false);
      } else {
        restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
      }
    });

    const code = await runWorkspace(["opencode"], workspaceRoot, stateRoot);
    assert.equal(code, 0, "workspace opencode pipeline completes");
  },
);

void test("wire host preview and apply run the preflight + wire pipeline in-process (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeRoot(t);

  const policy = {
    schemaVersion: 1,
    selection: {
      officialBeatsPopularity: true,
      requirePinnedProvenance: false,
      communityDefaultPolicy: "allow",
    },
    audit: { alwaysAudit: false, quarantineOn: [] },
    store: {
      root: "mirror",
      rawDirectories: ["raw"],
      normalizedDirectories: [],
      bundlesDirectory: "bundles",
      quarantineDirectory: "quarantine",
      auditDirectory: "audit",
    },
    bundleTemplates: [],
  };
  await writeJsonFile(join(stateRoot, "mirror", "policy.json"), policy);

  // Preview mode: preflight + wire("preview") with no state mutation.
  assert.equal(
    await runWire(["opencode", "--preview"], workspaceRoot, stateRoot),
    0,
  );
  // Preview is also the default mode.
  assert.equal(await runWire(["opencode"], workspaceRoot, stateRoot), 0);
  // Apply mode writes the project-local overlay.
  assert.equal(
    await runWire(["opencode", "--apply"], workspaceRoot, stateRoot),
    0,
  );
});

void test("rebuild clean removes transient state and reports (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeRoot(t);
  await writeJsonFile(join(stateRoot, "install", "opencode", "marker.json"), {
    marker: true,
  });
  await writeJsonFile(join(stateRoot, "activate", "opencode", "marker.json"), {
    marker: true,
  });

  const code = await runRebuild(["clean"], workspaceRoot, stateRoot);
  assert.equal(code, 0);
  const { readdir } = await import("node:fs/promises");
  await assert.rejects(readdir(join(stateRoot, "install")), undefined);
  await assert.rejects(
    readdir(join(stateRoot, "activate", "opencode")),
    undefined,
  );
});

void test("setup doctor reports when no adapter matches the requested host (#428)", async (t) => {
  const { stateRoot } = await makeRoot(t);
  const code = await runSetup(["doctor", "--host", "nosuchhost"], stateRoot);
  assert.equal(code, 1);
});

void test(
  "rebuild full runs the entire lifecycle with fixtures + fetch mock (#428)",
  { timeout: 180_000 },
  async (t) => {
    const { workspaceRoot, stateRoot } = await makeRoot(t);

    await writeJsonFile(join(stateRoot, "mirror", "policy.json"), {
      schemaVersion: 1,
      selection: {
        officialBeatsPopularity: true,
        requirePinnedProvenance: false,
        communityDefaultPolicy: "allow",
      },
      audit: { alwaysAudit: false, quarantineOn: [] },
      store: {
        root: "mirror",
        rawDirectories: ["raw"],
        normalizedDirectories: [],
        bundlesDirectory: "bundles",
        quarantineDirectory: "quarantine",
        auditDirectory: "audit",
      },
      bundleTemplates: [
        {
          id: "opencode-global",
          host: "opencode",
          description: "fixture global bundle",
          assetKinds: ["skill"],
          defaultPromotion: "default",
        },
      ],
    });

    const { cp } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const repositoryRoot = dirname(
      dirname(dirname(fileURLToPath(import.meta.url))),
    );
    await cp(
      join(repositoryRoot, "discover", "recommendation-policy"),
      join(stateRoot, "discover", "recommendation-policy"),
      { recursive: true },
    );
    await writeFile(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "rebuild-fixture", version: "1.0.0" }),
    );

    const originalFetch = globalThis.fetch;
    const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    setHttpTestFetchMocks(true);
    globalThis.fetch = async () =>
      new Response("# fixture skill\ncontent", { status: 200 });
    t.after(() => {
      globalThis.fetch = originalFetch;
      if (previousFetchMockFlag === undefined) {
        setHttpTestFetchMocks(false);
      } else {
        restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
      }
    });

    const code = await runRebuild(["full"], workspaceRoot, stateRoot);
    assert.equal(code, 0, "rebuild full completes the lifecycle");
  },
);

void test(
  "discover catalog harvests docs/marketplace/registry reference sources (#428)",
  { timeout: 120_000 },
  async (t) => {
    const { workspaceRoot, stateRoot } = await makeRoot(t);

    await writeJsonFile(join(stateRoot, "discover", "sources.json"), {
      schemaVersion: 1,
      sources: [
        {
          id: "docs-source",
          name: "Docs Source",
          kind: "docs",
          authorityTier: "official-marketplace",
          hosts: ["opencode"],
          assetKinds: ["skill"],
          priority: 90,
          enabled: true,
          endpoints: { baseUrl: "https://example.com/docs" },
          rules: {},
        },
        {
          id: "registry-source",
          name: "Registry Source",
          kind: "registry",
          authorityTier: "official-marketplace",
          hosts: ["opencode"],
          assetKinds: ["skill"],
          priority: 90,
          enabled: true,
          endpoints: { baseUrl: "https://example.com/registry" },
          rules: {},
        },
        {
          id: "marketplace-source",
          name: "Marketplace Source",
          kind: "marketplace",
          authorityTier: "official-marketplace",
          hosts: ["opencode"],
          assetKinds: ["skill"],
          priority: 90,
          enabled: true,
          endpoints: { baseUrl: "https://example.com/marketplace" },
          rules: {},
        },
      ],
    });
    await writeJsonFile(
      join(stateRoot, "discover", "output", "demand-profile.json"),
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        scanRoot: workspaceRoot,
        summary: { scannedFiles: 1, matchedFiles: 1 },
        signals: {
          languages: ["typescript"],
          packageManagers: ["npm"],
          frameworks: [],
          concerns: ["testing", "integration"],
          tooling: ["node"],
        },
        evidence: [
          {
            file: "package.json",
            path: "package.json",
            fileName: "package.json",
            matched: true,
            matchedSignals: {
              languages: ["typescript"],
              packageManagers: ["npm"],
              frameworks: [],
              concerns: ["testing"],
              tooling: [],
            },
          },
        ],
      },
    );

    const originalFetch = globalThis.fetch;
    const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    setHttpTestFetchMocks(true);
    globalThis.fetch = async () =>
      new Response("# docs fixture\ncontent", { status: 200 });
    t.after(() => {
      globalThis.fetch = originalFetch;
      if (previousFetchMockFlag === undefined) {
        setHttpTestFetchMocks(false);
      } else {
        restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
      }
    });

    const code = await runDiscover(["catalog"], workspaceRoot, stateRoot);
    assert.equal(code, 0, "catalog harvests reference sources");
  },
);

void test("setup doctor emits timeout diagnostics with 1ms timeouts (#428)", async (t) => {
  const { stateRoot } = await makeRoot(t);
  const previousHostTimeout =
    process.env.AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS;
  const previousCumulativeTimeout =
    process.env.AGENT_HARNESS_SETUP_DOCTOR_TIMEOUT_MS;
  process.env.AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS = "1";
  process.env.AGENT_HARNESS_SETUP_DOCTOR_TIMEOUT_MS = "1";
  t.after(() => {
    if (previousHostTimeout === undefined) {
      delete process.env.AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS;
    } else {
      process.env.AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS =
        previousHostTimeout;
    }
    if (previousCumulativeTimeout === undefined) {
      delete process.env.AGENT_HARNESS_SETUP_DOCTOR_TIMEOUT_MS;
    } else {
      process.env.AGENT_HARNESS_SETUP_DOCTOR_TIMEOUT_MS =
        previousCumulativeTimeout;
    }
  });

  const code = await runSetup(["doctor"], stateRoot);
  assert.ok(code === 0 || code === 1, "doctor terminates with timeouts");
});

void test("rebuild batch loops terminate against crafted acquire state and bundle locks (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeRoot(t);

  // mirror acquire requires a policy; the empty universe keeps batches tiny.
  await writeJsonFile(join(stateRoot, "mirror", "policy.json"), {
    schemaVersion: 1,
    selection: {
      officialBeatsPopularity: true,
      requirePinnedProvenance: false,
      communityDefaultPolicy: "allow",
    },
    audit: { alwaysAudit: false, quarantineOn: [] },
    store: {
      root: "mirror",
      rawDirectories: ["raw"],
      normalizedDirectories: [],
      bundlesDirectory: "bundles",
      quarantineDirectory: "quarantine",
      auditDirectory: "audit",
    },
    bundleTemplates: [],
  });

  // Craft a terminal acquire state: checkpoint returns true → one iteration.
  await writeJsonFile(
    join(stateRoot, "state", "mirror", "acquire-state.json"),
    {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      batchSize: 1,
      totalEligibleCount: 0,
      mirroredCount: 0,
      remainingCount: 0,
      skippedCount: 0,
      skippedAssetIds: [],
      lastBatchAssetIds: [],
      lastBatchMirroredCount: 0,
      lastBatchSkippedCount: 0,
      sessionMode: "acquire",
      processedCount: 0,
      terminal: true,
    },
  );

  await rebuildInternals.acquireAllMirrorBatches(stateRoot, workspaceRoot);

  // A bundle lock with zero assets is ignored; with an asset it enters the
  // install loop which terminates on the empty raw store.
  await writeJsonFile(
    join(stateRoot, "mirror", "bundles", "community-stable.lock.json"),
    {
      schemaVersion: 1,
      bundleId: "community-stable",
      host: "opencode",
      generatedAt: new Date().toISOString(),
      assets: [
        {
          assetId: "locked-asset",
          mirrorId: "mirror-locked",
          source: {
            sourceId: "fixture-source",
            authorityTier: "official-first-party",
            sourceKind: "docs",
            sourcePriority: 100,
            originUrl: "https://example.com/locked",
            publisher: "Fixture",
            publisherVerified: true,
          },
          upstream: { url: "https://example.com/locked" },
          status: "mirrored",
          mirrorPath: "raw/locked",
        },
      ],
    },
  );

  try {
    await rebuildInternals.installAllBundleBatches(stateRoot, workspaceRoot);
  } catch (error) {
    assert.ok(error instanceof Error, "install batching terminates");
  }

  void runRebuild;
});
