import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { writeJsonFile, writeJsonLinesFile } from "../files.js";
import {
  CATALOG_OUTPUT_PATH,
  SOURCE_SYNC_ENTRIES_OUTPUT_PATH,
  SOURCE_SYNC_STATE_OUTPUT_PATH,
} from "../domains/discovery/output-paths.js";
import { runDiscover } from "../discover.js";

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

    process.env.AGENT_HARNESS_HOME = homeRoot;
    process.env.APPDATA = appDataRoot;
    process.env.HOME = homeRoot;
    process.env.USERPROFILE = homeRoot;
    process.env.XDG_CONFIG_HOME = xdgConfigRoot;
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
    process.env.AGENT_HARNESS_HOME = previousEnv.AGENT_HARNESS_HOME;
    process.env.APPDATA = previousEnv.APPDATA;
    process.env.HOME = previousEnv.HOME;
    process.env.USERPROFILE = previousEnv.USERPROFILE;
    process.env.XDG_CONFIG_HOME = previousEnv.XDG_CONFIG_HOME;
    await rm(tempRoot, { force: true, recursive: true });
  }
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
    process.env.AGENT_HARNESS_HOME = previousEnv.AGENT_HARNESS_HOME;
    process.env.APPDATA = previousEnv.APPDATA;
    process.env.HOME = previousEnv.HOME;
    process.env.USERPROFILE = previousEnv.USERPROFILE;
    process.env.XDG_CONFIG_HOME = previousEnv.XDG_CONFIG_HOME;
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
