import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { restoreEnvVar } from "./env-test-utils.js";
import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { writeJsonFile, writeJsonLinesFile } from "../files.js";
import {
  CATALOG_OUTPUT_PATH,
  SOURCE_SYNC_ENTRIES_OUTPUT_PATH,
  SOURCE_SYNC_STATE_OUTPUT_PATH,
} from "../domains/discovery/output-paths.js";
import { runDiscover, discoverInternals } from "../discover.js";
import { discoverPipelineInternals } from "../discover-pipeline.js";

void test("discover breadth runs the full breadth workflow and prints guidance", async () => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-discover-breadth-"),
  );
  const workspaceRoot = join(tempRoot, "workspace");
  const stateRoot = join(tempRoot, "state");
  const localSourceRoot = join(tempRoot, "local-source");
  const homeRoot = join(tempRoot, "home");
  const appDataRoot = join(tempRoot, "appdata");
  const xdgConfigRoot = join(tempRoot, "xdg");
  const stdoutChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const previousEnv = {
    AGENT_HARNESS_HOME: process.env.AGENT_HARNESS_HOME,
    APPDATA: process.env.APPDATA,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };

  try {
    await prepareDiscoveryFixture({
      workspaceRoot,
      stateRoot,
      localSourceRoot,
      homeRoot,
      appDataRoot,
      xdgConfigRoot,
    });

    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutChunks.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
      );
      return true;
    }) as typeof process.stdout.write;

    assert.equal(await runDiscover(["breadth"], workspaceRoot, stateRoot), 0);

    const stdout = stdoutChunks.join("");
    assert.match(
      stdout,
      /\[discover breadth\] 1\/5 Scanning workspace demand\.\.\./u,
    );
    assert.match(
      stdout,
      /\[discover breadth\] 4\/5 Building discovery catalog\.\.\./u,
    );
    assert.match(stdout, /Discovery breadth complete\./u);
    assert.match(stdout, /Assessment: /u);
    assert.match(stdout, /Next steps:/u);
  } finally {
    process.stdout.write = originalStdoutWrite;
    for (const [name, value] of Object.entries(previousEnv))
      restoreEnvVar(name, value);
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("discover breadth warns about invalidated lifecycle state and reports prior catalog size (#452)", async () => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-discover-breadth-stale-"),
  );
  const workspaceRoot = join(tempRoot, "workspace");
  const stateRoot = join(tempRoot, "state");
  const localSourceRoot = join(tempRoot, "local-source");
  const homeRoot = join(tempRoot, "home");
  const appDataRoot = join(tempRoot, "appdata");
  const xdgConfigRoot = join(tempRoot, "xdg");
  const stdoutChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const previousEnv = {
    AGENT_HARNESS_HOME: process.env.AGENT_HARNESS_HOME,
    APPDATA: process.env.APPDATA,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };

  try {
    await prepareDiscoveryFixture({
      workspaceRoot,
      stateRoot,
      localSourceRoot,
      homeRoot,
      appDataRoot,
      xdgConfigRoot,
    });
    // The redirected env must take effect: without clearing the cached
    // runtime config, host-config resolution from an earlier test in this
    // single-process suite would poison this fixture (review finding).
    clearRuntimeConfigForTests();

    // Simulate a prior discovery pass + lifecycle state built from it.
    await writeJsonLinesFile(join(stateRoot, ...CATALOG_OUTPUT_PATH), [
      { id: "prior/one" },
      { id: "prior/two" },
    ]);
    await mkdir(join(stateRoot, "state"), { recursive: true });
    await writeJsonFile(join(stateRoot, "state", "recommendations.json"), {
      entries: [],
    });
    await mkdir(join(stateRoot, "mirror", "bundles"), { recursive: true });
    await writeFile(
      join(stateRoot, "mirror", "bundles", "copilot-core.lock.json"),
      "{}",
    );
    await mkdir(join(stateRoot, "install", "generations", "gen-1"), {
      recursive: true,
    });
    await mkdir(join(stateRoot, "activate", "codex"), { recursive: true });

    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutChunks.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
      );
      return true;
    }) as typeof process.stdout.write;

    assert.equal(await runDiscover(["breadth"], workspaceRoot, stateRoot), 0);

    const stdout = stdoutChunks.join("");
    assert.match(
      stdout,
      /\[discover breadth\] Warning: this pass REPLACES the discovery outputs/u,
    );
    assert.match(stdout, /state\/recommendations\.json/u);
    assert.match(stdout, /mirror\/bundles\/copilot-core\.lock\.json/u);
    assert.match(stdout, /install\/generations/u);
    assert.match(stdout, /activate\/codex/u);
    assert.match(stdout, /\(previous pass: 2, [+-]?\d+\)/u);
  } finally {
    process.stdout.write = originalStdoutWrite;
    clearRuntimeConfigForTests();
    for (const [name, value] of Object.entries(previousEnv))
      restoreEnvVar(name, value);
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("breadth state invalidation report enumerates lifecycle artifacts and caps mirror locks (#452)", async () => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-breadth-report-"),
  );
  try {
    // Empty state root: no prior catalog, no invalidated artifacts.
    assert.deepEqual(
      await discoverInternals.buildBreadthStateInvalidationReport(tempRoot),
      { priorCatalogEntryCount: null, invalidatedArtifacts: [] },
    );

    await writeJsonLinesFile(
      join(tempRoot, "discover", "catalog.assets.jsonl"),
      [{ id: "a" }, { id: "b" }, { id: "c" }],
    );
    await writeJsonFile(join(tempRoot, "state", "recommendations.json"), {});
    await mkdir(join(tempRoot, "mirror", "bundles"), { recursive: true });
    for (const name of [
      "a.lock.json",
      "b.lock.json",
      "c.lock.json",
      "d.lock.json",
      "not-a-lock.txt",
    ]) {
      await writeFile(join(tempRoot, "mirror", "bundles", name), "{}");
    }
    await mkdir(join(tempRoot, "install", "generations", "g1"), {
      recursive: true,
    });
    await mkdir(join(tempRoot, "activate", "opencode"), { recursive: true });

    const report =
      await discoverInternals.buildBreadthStateInvalidationReport(tempRoot);
    assert.equal(report.priorCatalogEntryCount, 3);
    assert.deepEqual(report.invalidatedArtifacts, [
      "state/recommendations.json",
      "mirror/bundles/a.lock.json",
      "mirror/bundles/b.lock.json",
      "mirror/bundles/c.lock.json",
      "mirror/bundles (+1 more lock files)",
      "install/generations",
      "activate/opencode",
    ]);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("breadth invalidation report counts ALL mirror locks beyond the three shown (review)", async () => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-breadth-locks-"),
  );
  try {
    // Six locks: the report names three and must count the REAL remainder
    // (3 more), not a display-cap artifact (the old 4-entry cap made the
    // "+N more" math wrong for directories with more than four locks).
    await mkdir(join(tempRoot, "mirror", "bundles"), { recursive: true });
    for (const name of ["a", "b", "c", "d", "e", "f"]) {
      await writeFile(
        join(tempRoot, "mirror", "bundles", `${name}.lock.json`),
        "{}",
      );
    }

    const report =
      await discoverInternals.buildBreadthStateInvalidationReport(tempRoot);
    assert.deepEqual(
      report.invalidatedArtifacts.filter((artifact) =>
        artifact.startsWith("mirror/bundles"),
      ),
      [
        "mirror/bundles/a.lock.json",
        "mirror/bundles/b.lock.json",
        "mirror/bundles/c.lock.json",
        "mirror/bundles (+3 more lock files)",
      ],
    );
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("breadth summary delta formatting carries the sign for growth and shrinkage (review)", () => {
  // The signed delta arm (delta > 0) needs an explicit unit pin: the
  // end-to-end breadth fixture only ever shrinks its catalog (previous > 0,
  // new == 0), so the growth suffix would otherwise stay uncovered.
  assert.equal(
    discoverPipelineInternals.formatCatalogEntryDelta(3, 1),
    " (previous pass: 1, +2)",
    "growth must be reported with an explicit plus sign",
  );
  assert.equal(
    discoverPipelineInternals.formatCatalogEntryDelta(1, 3),
    " (previous pass: 3, -2)",
    "shrinkage carries the natural minus sign",
  );
  assert.equal(
    discoverPipelineInternals.formatCatalogEntryDelta(3, 3),
    " (previous pass: 3, 0)",
    "an unchanged pool reports zero without a sign",
  );
});

void test("discover full prints visible phase progress before finishing", async () => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-discover-full-"),
  );
  const workspaceRoot = join(tempRoot, "workspace");
  const stateRoot = join(tempRoot, "state");
  const localSourceRoot = join(tempRoot, "local-source");
  const homeRoot = join(tempRoot, "home");
  const appDataRoot = join(tempRoot, "appdata");
  const xdgConfigRoot = join(tempRoot, "xdg");
  const stdoutChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const previousEnv = {
    AGENT_HARNESS_HOME: process.env.AGENT_HARNESS_HOME,
    APPDATA: process.env.APPDATA,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };

  try {
    await prepareDiscoveryFixture({
      workspaceRoot,
      stateRoot,
      localSourceRoot,
      homeRoot,
      appDataRoot,
      xdgConfigRoot,
    });

    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutChunks.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
      );
      return true;
    }) as typeof process.stdout.write;

    assert.equal(await runDiscover(["full"], workspaceRoot, stateRoot), 0);

    const stdout = stdoutChunks.join("");
    assert.match(
      stdout,
      /\[discover full\] 1\/5 Scanning workspace demand\.\.\./u,
    );
    assert.match(
      stdout,
      /\[discover full\] 3\/5 Syncing indexed sources\.\.\./u,
    );
    assert.match(
      stdout,
      /\[discover full\] 5\/5 Applying selection rules\.\.\./u,
    );
    assert.match(stdout, /Selection outputs written to /u);
  } finally {
    process.stdout.write = originalStdoutWrite;
    for (const [name, value] of Object.entries(previousEnv))
      restoreEnvVar(name, value);
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("discover catalog handles large indexed source populations without overflowing the stack", async () => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-discover-catalog-"),
  );
  const workspaceRoot = join(tempRoot, "workspace");
  const stateRoot = join(tempRoot, "state");
  const indexedEntryCount = 120_000;

  // Hermetic host-config resolution: without redirecting the config-dir env
  // vars, the generated LOCAL sources scan the real user config dirs
  // (~/.agents/skills etc.), whose content varies per machine and inflates
  // the catalog count — the serial single-process suite makes that state
  // timing-dependent. Point the locals at empty fixture roots and restore
  // afterwards.
  const homeDirectory = join(tempRoot, "home");
  const appDataDirectory = join(tempRoot, "appdata");
  const xdgConfigHome = join(tempRoot, "xdg");
  const previousEnv = {
    AGENT_HARNESS_HOME: process.env.AGENT_HARNESS_HOME,
    APPDATA: process.env.APPDATA,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  process.env.AGENT_HARNESS_HOME = homeDirectory;
  process.env.APPDATA = appDataDirectory;
  process.env.HOME = homeDirectory;
  process.env.USERPROFILE = homeDirectory;
  process.env.XDG_CONFIG_HOME = xdgConfigHome;
  clearRuntimeConfigForTests();
  await mkdir(join(xdgConfigHome, "opencode"), { recursive: true });
  await mkdir(join(homeDirectory, ".agents", "skills"), { recursive: true });

  try {
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(stateRoot, { recursive: true });
    await writeJsonFile(join(stateRoot, "discover", "sources.json"), {
      schemaVersion: 1,
      sources: [
        {
          id: "huge-indexed-source",
          name: "huge-indexed-source",
          kind: "registry",
          authorityTier: "official-compatible",
          publisher: { name: "fixture", verified: true },
          hosts: ["copilot-vscode"],
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
    await writeJsonFile(join(stateRoot, ...SOURCE_SYNC_STATE_OUTPUT_PATH), {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sources: [
        {
          sourceId: "huge-indexed-source",
          coverageMode: "indexed",
          status: "complete",
          indexedEntryCount,
          lastSyncedAt: new Date().toISOString(),
          cursors: [],
        },
      ],
    });
    await writeJsonLinesFile(
      join(stateRoot, ...SOURCE_SYNC_ENTRIES_OUTPUT_PATH),
      Array.from({ length: indexedEntryCount }, (_, index) =>
        createIndexedCatalogEntry(index),
      ),
    );

    assert.equal(await runDiscover(["catalog"], workspaceRoot, stateRoot), 0);

    const catalogEntries = await readCatalogEntryIds(
      join(stateRoot, ...CATALOG_OUTPUT_PATH),
    );
    assert.equal(catalogEntries.length, indexedEntryCount);
    assert.equal(catalogEntries[0], "huge-indexed-source/asset-0");
    assert.ok(
      catalogEntries.includes(
        `huge-indexed-source/asset-${indexedEntryCount - 1}`,
      ),
    );
  } finally {
    restoreEnvVar("AGENT_HARNESS_HOME", previousEnv.AGENT_HARNESS_HOME);
    restoreEnvVar("APPDATA", previousEnv.APPDATA);
    restoreEnvVar("HOME", previousEnv.HOME);
    restoreEnvVar("USERPROFILE", previousEnv.USERPROFILE);
    restoreEnvVar("XDG_CONFIG_HOME", previousEnv.XDG_CONFIG_HOME);
    clearRuntimeConfigForTests();
    await rm(tempRoot, { force: true, recursive: true });
  }
});

async function prepareDiscoveryFixture(input: {
  workspaceRoot: string;
  stateRoot: string;
  localSourceRoot: string;
  homeRoot: string;
  appDataRoot: string;
  xdgConfigRoot: string;
}): Promise<void> {
  await mkdir(input.workspaceRoot, { recursive: true });
  await mkdir(input.stateRoot, { recursive: true });
  await mkdir(input.homeRoot, { recursive: true });
  await mkdir(input.appDataRoot, { recursive: true });
  await mkdir(input.xdgConfigRoot, { recursive: true });
  await writeText(
    join(input.workspaceRoot, "package.json"),
    JSON.stringify(
      {
        name: "workspace",
        private: true,
        dependencies: {
          react: "^19.0.0",
          typescript: "^5.0.0",
        },
      },
      null,
      2,
    ),
  );
  await writeText(
    join(input.workspaceRoot, "README.md"),
    "React frontend workspace with testing and UI concerns.\n",
  );
  await writeText(
    join(input.localSourceRoot, "AGENTS.md"),
    "Project guidance\n",
  );
  await writeText(
    join(input.localSourceRoot, "skills", "react-helper", "SKILL.md"),
    "---\nname: react-helper\ndescription: React helper\n---\n# React helper\n",
  );

  await writeJsonFile(join(input.stateRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [
      {
        id: "local-workspace-guidance",
        name: "local-workspace-guidance",
        kind: "local-directory",
        authorityTier: "trusted-local",
        publisher: { name: "local", verified: true },
        hosts: ["copilot-vscode"],
        assetKinds: ["skill", "instruction", "prompt-pack", "agent"],
        discoveryMode: "catalog",
        priority: 100,
        enabled: true,
        endpoints: { path: input.localSourceRoot },
        rules: {
          officialPreferred: true,
          allowMirror: true,
          allowInstall: true,
        },
      },
    ],
  });
  await writeJsonFile(join(input.stateRoot, "discover", "selections.json"), {
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

  process.env.AGENT_HARNESS_HOME = input.homeRoot;
  process.env.APPDATA = input.appDataRoot;
  process.env.HOME = input.homeRoot;
  process.env.USERPROFILE = input.homeRoot;
  process.env.XDG_CONFIG_HOME = input.xdgConfigRoot;
}

async function readCatalogEntryIds(filePath: string): Promise<string[]> {
  const content = await readFile(filePath, "utf8");
  return content
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { id: string })
    .map((entry) => entry.id);
}

function createIndexedCatalogEntry(index: number): Record<string, unknown> {
  return {
    id: `huge-indexed-source/asset-${index}`,
    displayName: `asset-${index}`,
    assetKind: "skill",
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId: "huge-indexed-source",
      sourceKind: "registry",
      authorityTier: "official-compatible",
      sourcePriority: 100,
      originUrl: `https://example.com/registry/asset-${index}`,
      publisher: "fixture",
      publisherVerified: true,
    },
    trust: {
      score: 100,
      signals: ["fixture"],
    },
    capabilities: ["typescript", "testing", `asset-${index}`],
    install: {
      method: "registry",
      nativeHosts: ["copilot-vscode"],
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
    },
    maintenance: {
      lastUpdated: "2026-05-11T00:00:00.000Z",
      stars: 0,
      releaseCadence: "active",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: {
      sizeClass: "small",
      estimatedPromptWeight: 1,
    },
    fit: {
      portfolioFit: 0.9,
      hostFit: 0.9,
    },
    dedupe: {
      candidateRankHint: "fixture",
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}

async function writeText(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}
