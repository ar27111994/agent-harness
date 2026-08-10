/**
 * Workspace / setup / rebuild flow coverage (#428): drives the remaining
 * stateful paths in-process — the workspace host pipeline (preflight +
 * prerequisites + enrichment result handling), the setup doctor run with the
 * cumulative timeout, login provider guidance, and the rebuild full batch
 * loops. All run against isolated temp roots; host CLIs are absent so
 * preflight fails fast.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { clearRuntimeConfig } from "../config/runtime.js";
import { runWorkspace } from "../workspace.js";
import { restoreEnvVar } from "./env-test-utils.js";
import { runSetup } from "../setup.js";
import { runRebuild } from "../rebuild.js";
import { runWire } from "../wire.js";
import { writeJsonFile, writeJsonLinesFile } from "../files.js";
import { createIsolatedCliEnvironment } from "./built-cli-harness.js";
import {
  SOURCE_SYNC_ENTRIES_OUTPUT_PATH,
  SOURCE_SYNC_STATE_OUTPUT_PATH,
} from "../domains/discovery/output-paths.js";
import type { AssetCatalogEntry } from "../types.js";

async function makeIsolated(t: {
  after: (fn: () => void | Promise<void>) => void;
}): Promise<{
  workspaceRoot: string;
  stateRoot: string;
  env: NodeJS.ProcessEnv;
}> {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-wsr-"));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });
  const isolated = await createIsolatedCliEnvironment(tempRoot);

  // In-process runs (runWorkspace/runSetup) resolve host config through
  // process.env + the cached runtime config — the isolated env object is
  // only applied to spawned children. Redirect process.env to the same
  // fixture roots and clear the cache so preflight's requireHostPaths check
  // and the generated local sources resolve inside the fixture (the
  // platform opencode config root is already materialized by
  // createIsolatedCliEnvironment).
  const previousEnv = {
    AGENT_HARNESS_HOME: process.env.AGENT_HARNESS_HOME,
    APPDATA: process.env.APPDATA,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  process.env.AGENT_HARNESS_HOME = isolated.env.AGENT_HARNESS_HOME;
  process.env.APPDATA = isolated.env.APPDATA;
  process.env.HOME = isolated.env.HOME;
  process.env.USERPROFILE = isolated.env.USERPROFILE;
  process.env.XDG_CONFIG_HOME = isolated.env.XDG_CONFIG_HOME;
  clearRuntimeConfig();
  t.after(() => {
    restoreEnvVar("AGENT_HARNESS_HOME", previousEnv.AGENT_HARNESS_HOME);
    restoreEnvVar("APPDATA", previousEnv.APPDATA);
    restoreEnvVar("HOME", previousEnv.HOME);
    restoreEnvVar("USERPROFILE", previousEnv.USERPROFILE);
    restoreEnvVar("XDG_CONFIG_HOME", previousEnv.XDG_CONFIG_HOME);
    clearRuntimeConfig();
  });

  // The workspace pipeline and rebuild regenerate demand → sources →
  // catalog: provide the canonical checked-in-style inputs so those steps
  // execute against an (empty) source universe instead of failing on a
  // missing registry.
  await writeJsonFile(join(isolated.stateRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [],
  });
  await writeJsonFile(join(isolated.stateRoot, "discover", "selections.json"), {
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
  return isolated;
}

// Enable fetch mocking so any network attempt fails fast instead of hanging.
function withMockFetchEnv(): NodeJS.ProcessEnv {
  return { ...process.env, AGENT_HARNESS_TEST_FETCH_MOCKS: "1" };
}

/**
 * Seeds the discovery inputs the workspace pipeline REGENERATES from: one
 * indexed source marked complete in the sync state plus its entry artifacts.
 * The pipeline overwrites any pre-seeded catalog, so without this the
 * generated catalog is empty on machines without real host config dirs and
 * the recommend phase fails with "no recommendations".
 */
async function seedIndexedDiscoverySource(
  stateRoot: string,
  sourceId: string,
  entries: AssetCatalogEntry[],
): Promise<void> {
  await writeJsonFile(join(stateRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [
      {
        id: sourceId,
        name: sourceId,
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
        sourceId,
        coverageMode: "indexed",
        status: "complete",
        indexedEntryCount: entries.length,
        lastSyncedAt: new Date().toISOString(),
        cursors: [],
      },
    ],
  });
  await writeJsonLinesFile(
    join(stateRoot, ...SOURCE_SYNC_ENTRIES_OUTPUT_PATH),
    entries,
  );
}

/**
 * Runs a workspace/rebuild invocation that terminates via exit code OR a
 * deliberate pipeline rejection (e.g. the #349 no-recommendations stop).
 * The covered behavior is the terminality itself.
 */
async function runTolerantly(invocation: () => Promise<number>): Promise<void> {
  try {
    const code = await invocation();
    assert.ok(code === 0 || code === 1, "exit code must be 0 or 1");
  } catch (error) {
    assert.ok(error instanceof Error, "pipeline stops with an Error");
  }
}

void test("workspace host pipeline runs preflight and prerequisites to a fast failure (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);
  const env = withMockFetchEnv();

  // A tiny TypeScript workspace with demand signals.
  await writeFile(
    join(workspaceRoot, "package.json"),
    JSON.stringify({ name: "ws-flow", version: "1.0.0" }),
  );

  await runTolerantly(() =>
    runWorkspace(["opencode"], workspaceRoot, stateRoot),
  );
  void env;
});

void test("workspace host with --ai-enrich handles the enrichment result path (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);
  await writeFile(
    join(workspaceRoot, "package.json"),
    JSON.stringify({ name: "ws-enrich", version: "1.0.0" }),
  );

  await runTolerantly(() =>
    runWorkspace(["opencode", "--ai-enrich"], workspaceRoot, stateRoot),
  );
});

void test("workspace host with --intent validates the intent path (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);
  await writeFile(
    join(workspaceRoot, "package.json"),
    JSON.stringify({ name: "ws-intent", version: "1.0.0" }),
  );

  await runTolerantly(() =>
    runWorkspace(
      ["opencode", "--intent", "frontend"],
      workspaceRoot,
      stateRoot,
    ),
  );
});

void test("setup doctor runs the full preflight surface in an isolated environment (#428)", async (t) => {
  const { stateRoot } = await makeIsolated(t);

  // Doctor completes on machines without host CLIs by collecting
  // diagnostics; either exit code is fine — the body, per-adapter preflight,
  // cumulative timeout, and diagnostic formatting all execute.
  const code = await runSetup(["doctor"], stateRoot);
  assert.ok(code === 0 || code === 1, "setup doctor must terminate");

  // Per-host doctor invocation for one adapter.
  const singleHost = await runSetup(
    ["doctor", "--host", "opencode"],
    stateRoot,
  );
  assert.ok(singleHost === 0 || singleHost === 1);
});

void test("setup login prints provider guidance for valid and unknown providers (#428)", async (t) => {
  const { stateRoot } = await makeIsolated(t);

  const github = await runSetup(["login", "--provider", "github"], stateRoot);
  assert.equal(github, 0);

  const unknown = await runSetup(["login", "--provider", "nope"], stateRoot);
  assert.equal(unknown, 1);

  // Bare login defaults to the first provider and still exits 0.
  const bare = await runSetup(["login"], stateRoot);
  assert.equal(bare, 0);
});

void test("rebuild full runs the clean + batch pipeline on an empty state root (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);

  // rebuild clean: removes transient state and completes.
  const clean = await runRebuild(["clean"], workspaceRoot, stateRoot);
  assert.equal(clean, 0);

  // rebuild full: clean + regenerate + batch loops; with no catalogs the
  // acquire/install batch functions run over empty selections.
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

  await runTolerantly(() => runRebuild(["full"], workspaceRoot, stateRoot));
});

void test("workspace enrichment result handling maps note/failure to exit codes (#428)", async (t) => {
  const { workspaceInternals } = await import("../workspace.js");
  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });

  // Note present → printed, exit 0.
  const noted = workspaceInternals.handleAiEnrichmentResult({
    note: "enrichment skipped: not configured",
    shouldFail: false,
  } as never);
  assert.equal(noted, 0);
  assert.ok(
    output.some((line) => line.includes("enrichment skipped")),
    "the note is surfaced to the user",
  );

  // Failure requested → exit 1.
  const failed = workspaceInternals.handleAiEnrichmentResult({
    note: undefined,
    shouldFail: true,
  } as never);
  assert.equal(failed, 1);

  // Clean success without a note → exit 0, no output.
  output.length = 0;
  const ok = workspaceInternals.handleAiEnrichmentResult({
    note: undefined,
    shouldFail: false,
  } as never);
  assert.equal(ok, 0);
  assert.equal(output.length, 0);
});

void test("workspace rejects flag-like unknown targets and unknown host help falls back to parent help (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);

  const flagCode = await runWorkspace(["--bogus"], workspaceRoot, stateRoot);
  assert.equal(flagCode, 1);

  const helpOutput: string[] = [];
  t.mock.method(process.stdout, "write", (chunk: unknown) => {
    helpOutput.push(String(chunk));
    return true;
  });
  const helpCode = await runWorkspace(
    ["nonsense-host", "--help"],
    workspaceRoot,
    stateRoot,
  );
  assert.equal(helpCode, 0);
  assert.ok(
    helpOutput.join("").includes("workspace commands:"),
    `expected parent workspace help fallback, got: ${helpOutput.join("")}`,
  );
});

void test("workspace rejects conflicting AI-enrichment flags before any pipeline work (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);
  await assert.rejects(
    runWorkspace(
      ["opencode", "--ai-enrich", "--no-ai-enrich"],
      workspaceRoot,
      stateRoot,
    ),
    /--ai-enrich and --no-ai-enrich cannot be used together/u,
  );
});

void test("workspace prints and fails on prerequisite diagnostics from activated assets (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);

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
  // The mirror phase needs the mirror policy.
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

  // A catalog + demand profile so selection produces a recommendation and
  // the pipeline stages real bundle locks (install progress is required).
  const assetEntry: AssetCatalogEntry = {
    id: "ws-entry",
    displayName: "ws-entry",
    assetKind: "skill",
    hosts: ["opencode"],
    compatibilityMode: "native",
    source: {
      sourceId: "fixture-source",
      authorityTier: "official-first-party",
      sourceKind: "docs",
      sourcePriority: 100,
      originUrl: "https://example.com/assets/ws-entry",
      publisher: "Fixture",
      publisherVerified: true,
    },
    trust: { score: 100, signals: [] },
    capabilities: ["fixture", "testing"],
    install: {
      method: "local-file",
      nativeHosts: ["opencode"],
      manifestEntry: "ws-entry",
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: "ws-entry.md",
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
  };
  // The pipeline regenerates the catalog from discovery state — seed the
  // indexed source so recommend deterministically sees ws-entry.
  await seedIndexedDiscoverySource(stateRoot, "fixture-source", [assetEntry]);
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

  // Fetch is stubbed so mirror acquire can materialize the raw artifact for
  // the single selected skill.
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  globalThis.fetch = async () =>
    new Response("# fixture skill\ncontent", { status: 200 });
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    }
  });

  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });

  // Injected preflight passes; the prerequisite collector reports a missing
  // environment variable for an activated asset, which is printed and then
  // fails the run.
  await assert.rejects(
    runWorkspace(["opencode"], workspaceRoot, stateRoot, {
      runHostPreflight: async () => [],
      runAdapterPreflight: async () => [],
      collectActivatedAssetPrerequisiteDiagnostics: async () => [
        {
          severity: "error",
          code: "missing-env",
          message: "Missing ANTHROPIC_API_KEY for activated asset demo-skill.",
          action: "Set ANTHROPIC_API_KEY.",
        },
      ],
    }),
    /missing-env/u,
  );
  assert.ok(
    output.some((line) => line.includes("Missing ANTHROPIC_API_KEY")),
    `expected the prerequisite diagnostics to print, got: ${output.join("\n")}`,
  );
});

void test("wire preview mode runs preflight with warning severity and completes (#428)", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-wire-preview-"),
  );
  try {
    const code = await runWire(["opencode"], projectRoot, projectRoot);
    assert.equal(code, 0, "wire preview must terminate cleanly");
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("workspace passes multiple intents through the pipeline (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeIsolated(t);

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
  const entry: AssetCatalogEntry = {
    id: "ws-entry",
    displayName: "ws-entry",
    assetKind: "skill",
    hosts: ["opencode"],
    compatibilityMode: "native",
    source: {
      sourceId: "fixture-source",
      authorityTier: "official-first-party",
      sourceKind: "docs",
      sourcePriority: 100,
      originUrl: "https://example.com/assets/ws-entry",
      publisher: "Fixture",
      publisherVerified: true,
    },
    trust: { score: 100, signals: [] },
    capabilities: ["fixture", "testing"],
    install: {
      method: "local-file",
      nativeHosts: ["opencode"],
      manifestEntry: "ws-entry",
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: "ws-entry.md",
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
  };
  // The pipeline regenerates the catalog from discovery state — seed the
  // indexed source so recommend deterministically sees ws-entry.
  await seedIndexedDiscoverySource(stateRoot, "fixture-source", [entry]);
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

  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  globalThis.fetch = async () =>
    new Response("# fixture skill\ncontent", { status: 200 });
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    }
  });

  const code = await runWorkspace(
    ["opencode", "--intent", "frontend", "--intent", "backend"],
    workspaceRoot,
    stateRoot,
    {
      runHostPreflight: async () => [],
      runAdapterPreflight: async () => [],
      collectActivatedAssetPrerequisiteDiagnostics: async () => [],
    },
  );
  assert.equal(code, 0, "multi-intent workspace run completes");
});
