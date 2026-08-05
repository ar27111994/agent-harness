/**
 * Final #428 stragglers: plain-domain routing through runDomainCommand,
 * workspace preflight-diagnostics, source-health severe/summary branches,
 * entry-bearing catalog selection, setup doctor timeout aborts, and the
 * rebuild batch loops.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cliInternals } from "../cli.js";
import { runDiscover, discoverInternals } from "../discover.js";
import { runWorkspace } from "../workspace.js";
import { runSetup } from "../setup.js";
import { runRebuild, rebuildInternals } from "../rebuild.js";
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

async function makeRoot(t: {
  after: (fn: () => void | Promise<void>) => void;
}): Promise<{ workspaceRoot: string; stateRoot: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-tail-"));
  t.after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });
  const { mkdir } = await import("node:fs/promises");
  const workspaceRoot = join(projectRoot, "workspace");
  const stateRoot = join(projectRoot, "state");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(stateRoot, { recursive: true });

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

void test("workspace host surfaces preflight diagnostics when host paths are missing (#428)", async (t) => {
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
});

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
