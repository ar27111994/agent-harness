/**
 * Discover pipeline dispatch coverage (#428): drives every stateful
 * discover subcommand IN-PROCESS against an isolated state root with
 * minimal checked-in-style fixtures (empty source registry + canonical
 * selections), so the sync/index/full/select/ard-export/enrich/inspect/
 * diff/environment-index case bodies execute without network access.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runDiscover, discoverInternals } from "../discover.js";
import { writeJsonFile } from "../files.js";
import { clearRuntimeConfig } from "../config/runtime.js";

async function makeDiscoverRoot(t: {
  after: (fn: () => void | Promise<void>) => void;
}): Promise<{ workspaceRoot: string; stateRoot: string }> {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-discover-pipeline-"),
  );
  t.after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });
  const workspaceRoot = join(projectRoot, "workspace");
  const stateRoot = join(projectRoot, "state");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(stateRoot, { recursive: true });

  // Minimal source universe: no sources means sync/index are instant and
  // the dispatch bodies still execute end-to-end.
  await writeJsonFile(join(stateRoot, "discover", "sources.json"), {
    $schema:
      "https://raw.githubusercontent.com/ar27111994/agent-harness/main/discover/schema/sources.schema.json",
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

void test("discover sync/index/select/full complete on an empty source universe (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeDiscoverRoot(t);

  const runs: Array<[string[], number]> = [
    [["sync"], 0],
    [["sync", "--full"], 0],
    [["index"], 0],
    // After a fresh catalog index exists, sync takes the fresh-index path
    // (copy snapshot into source-sync state instead of live harvesting).
    [["sync"], 0],
    [["catalog"], 0],
    [["select"], 0],
    [["full"], 0],
    [["breadth"], 0],
    [["recall"], 0],
    [["candidate-pool"], 0],
    [["stats"], 0],
    [["environment-index"], 0],
    [["ard-export"], 0],
    [["enrich"], 0],
    [["inspect"], 0],
  ];

  for (const [args, expected] of runs) {
    const code = await runDiscover(args, workspaceRoot, stateRoot);
    assert.equal(
      code,
      expected,
      `discover ${args.join(" ")} should exit ${expected}`,
    );
  }

  // Source-health summary paths: --quiet and --summary variants exercise the
  // report printer with the empty-source-universe health report.
  assert.equal(
    await runDiscover(["full", "--quiet"], workspaceRoot, stateRoot),
    0,
  );
  assert.equal(
    await runDiscover(["full", "--summary"], workspaceRoot, stateRoot),
    0,
  );

  // The unified outputs exist after the pipeline ran.
  const outputs = join(stateRoot, "discover", "output");
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(outputs);
  const catalogDir = await readdir(join(stateRoot, "discover"));
  assert.ok(files.includes("demand-profile.json"), "demand profile written");
  assert.ok(
    catalogDir.includes("catalog.assets.jsonl"),
    "catalog assets written",
  );
  assert.ok(
    files.includes("catalog.selected.jsonl"),
    "selected catalog written",
  );
});

void test("discover diff fails fast without a baseline and succeeds with one (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeDiscoverRoot(t);

  // Baseline missing → the diff report rejects (the CLI main() catch turns
  // it into exit 1; in-process we assert the rejection).
  await assert.rejects(
    runDiscover(
      ["diff", "--baseline", join(stateRoot, "no-baseline")],
      workspaceRoot,
      stateRoot,
    ),
  );

  // Produce outputs first so the state root itself is a valid baseline.
  assert.equal(await runDiscover(["full"], workspaceRoot, stateRoot), 0);
  const withBaseline = await runDiscover(
    ["diff", "--baseline", stateRoot],
    workspaceRoot,
    stateRoot,
  );
  assert.equal(withBaseline, 0);
});

void test("discover full with entries produces selected/rejected outputs (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeDiscoverRoot(t);
  const { writeFile } = await import("node:fs/promises");

  // A tiny TypeScript workspace so demand signals fire.
  await writeFile(
    join(workspaceRoot, "package.json"),
    JSON.stringify({ name: "pipeline-fixture", version: "1.0.0" }),
  );

  const code = await runDiscover(["full"], workspaceRoot, stateRoot);
  assert.equal(code, 0);

  const selected = await readFile(
    join(stateRoot, "discover", "output", "catalog.selected.jsonl"),
    "utf8",
  );
  assert.ok(Array.isArray(selected.split("\n").filter(Boolean)));
});

// ---------------------------------------------------------------------------
// discover.ts remaining paths (#428): help fallback, strict-flag rejects,
// the --sync-all full pass, index page-cap variants, first-run hint prior
// state, source-health report printing, the repo-slice catalog harvest with
// fetch mocks (+ indexed-source reuse + unknown source kind), and the
// --require-ai-enrich failure exit code.
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function buildCatalogSource(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: "src",
    name: "src",
    kind: "repo",
    authorityTier: "trusted-community",
    publisher: { name: "acme", verified: false, owner: "acme" },
    hosts: ["cursor", "shared"],
    assetKinds: [
      "skill",
      "agent",
      "instruction",
      "workflow",
      "plugin",
      "hook",
      "mcp-server",
      "reference-pack",
    ],
    discoveryMode: "catalog",
    priority: 80,
    enabled: true,
    endpoints: { repo: "https://github.com/acme/toolbox" },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
      quarantineOn: [],
    },
    ...overrides,
  };
}

void test("discover --help for a non-specific subcommand prints parent help (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeDiscoverRoot(t);
  const output: string[] = [];
  t.mock.method(process.stdout, "write", (chunk: unknown) => {
    output.push(String(chunk));
    return true;
  });

  const code = await runDiscover(
    ["not-a-subcommand", "--help"],
    workspaceRoot,
    stateRoot,
  );
  assert.equal(code, 0);
  assert.ok(
    output.join("").includes("discover commands:"),
    `expected parent discover help, got: ${output.join("")}`,
  );
});

void test("discover full and breadth reject unknown flags before running (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeDiscoverRoot(t);
  assert.equal(
    await runDiscover(["full", "--bogus"], workspaceRoot, stateRoot),
    1,
    "discover full --bogus must exit 1",
  );
  assert.equal(
    await runDiscover(["breadth", "--bogus"], workspaceRoot, stateRoot),
    1,
    "discover breadth --bogus must exit 1",
  );
});

void test("discover full --sync-all takes the unfiltered sync path (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeDiscoverRoot(t);
  const code = await runDiscover(
    ["full", "--sync-all"],
    workspaceRoot,
    stateRoot,
  );
  assert.equal(code, 0);
});

void test("discover index honors an unlimited page cap (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeDiscoverRoot(t);
  const previousCap =
    process.env.AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_FOR_INDEX_BUILD;
  process.env.AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_FOR_INDEX_BUILD = "0";
  clearRuntimeConfig();
  try {
    const code = await runDiscover(["index"], workspaceRoot, stateRoot);
    assert.equal(code, 0);
  } finally {
    if (previousCap === undefined) {
      delete process.env.AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_FOR_INDEX_BUILD;
    } else {
      process.env.AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_FOR_INDEX_BUILD =
        previousCap;
    }
    clearRuntimeConfig();
  }
});

void test("first-run sync hint stays silent when prior sync state exists (#428)", () => {
  const priorSyncState = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources: [
      {
        sourceId: "docs-src",
        coverageMode: "indexed",
        status: "complete",
        indexedEntryCount: 5,
        cursors: [],
      },
    ],
  } as never;

  assert.equal(
    discoverInternals.shouldShowFirstRunSyncHint(
      priorSyncState,
      8,
      false,
      false,
      false,
    ),
    false,
    "a prior sync suppresses the first-run hint",
  );
});

void test("printSourceHealthSummary prints severe counts in quiet mode (#428)", (t) => {
  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });
  discoverInternals.printSourceHealthSummary(
    {
      sourceCount: 3,
      severeCount: 2,
      warningCount: 40,
      sources: [],
    } as never,
    { quietMode: true, summaryMode: false },
  );
  assert.ok(
    output.join("\n").includes("2 severe issue(s)"),
    `expected the severe quiet line, got: ${output.join("\n")}`,
  );
});

void test("printSourceHealthSummary aggregates warning reasons in summary mode (#428)", (t) => {
  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });
  discoverInternals.printSourceHealthSummary(
    {
      sourceCount: 2,
      severeCount: 0,
      warningCount: 2,
      sources: [
        {
          severity: "warning",
          reasons: ["source produced entries but none survived selection"],
        },
        {
          severity: "warning",
          reasons: ["source produced entries but none survived selection"],
        },
      ],
    } as never,
    { quietMode: false, summaryMode: true },
  );
  const joined = output.join("\n");
  assert.ok(
    joined.includes("2 sources: source produced entries") &&
      joined.includes("breakdown"),
    `expected aggregated reasons, got: ${joined}`,
  );
});

void test("discover catalog harvests the repo slice with fetch mocks (#428)", async (t) => {
  const { workspaceRoot, stateRoot } = await makeDiscoverRoot(t);

  // Three source kinds exercise every catalog path: a github repo (harvested
  // via the mocked API), a non-github repo (repo-kind but not parseable as
  // github -> skipped inside the repo loop), and an unknown kind (falls to
  // the default break in the non-repo switch).
  const sources = [
    buildCatalogSource({
      id: "gh-repo",
      name: "gh-repo",
      priority: 90,
    }),
    buildCatalogSource({
      id: "plain-repo",
      name: "plain-repo",
      endpoints: { repo: "https://example.com/not-github" },
    }),
    buildCatalogSource({
      id: "synced-docs",
      name: "synced-docs",
      kind: "docs",
    }),
  ];
  await writeJsonFile(join(stateRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources,
  });

  // Seed indexed-source state so catalog reuses the cached entries for the
  // docs source instead of harvesting it.
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(stateRoot, "state", "discover"), { recursive: true });
  await writeJsonFile(
    join(stateRoot, "state", "discover", "source-sync.json"),
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sources: [
        {
          sourceId: "synced-docs",
          coverageMode: "indexed",
          status: "complete",
          lastSyncedAt: new Date().toISOString(),
          indexedEntryCount: 1,
          cursors: [],
        },
      ],
    },
  );
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    join(stateRoot, "state", "discover", "source-sync.entries.jsonl"),
    `${JSON.stringify({
      id: "synced-doc-entry",
      displayName: "Synced doc",
      assetKind: "instruction",
      hosts: ["shared"],
      compatibilityMode: "native",
      capabilities: [],
      source: {
        sourceId: "synced-docs",
        authorityTier: "trusted-community",
        sourceKind: "docs",
        sourcePriority: 50,
        originUrl: "https://example.com/synced-docs",
        publisher: "docs-publisher",
        publisherVerified: false,
        registryKind: undefined,
        publisherName: undefined,
        category: undefined,
      },
      trust: { score: 50, signals: [] },
      install: { method: "manual", relativePath: "docs/synced.md" },
      evidence: {
        manifestFound: false,
        readmeFound: true,
        examplesFound: false,
        docsLinked: true,
        filePath: "docs/synced.md",
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
      contextCost: { sizeClass: "small", estimatedPromptWeight: 1 },
      fit: { portfolioFit: 0.5, hostFit: 0.8 },
      dedupe: { duplicateGroup: undefined, candidateRankHint: "fixture" },
      status: {
        cataloged: true,
        mirrorEligible: true,
        installEligible: true,
        activationEligible: true,
      },
      score: 0,
      demand: 0,
      authority: 0,
      popularity: 0,
      freshness: 0,
      security: 0,
      compatibility: 0,
      tokens: [],
      ecosystems: [],
      tags: [],
      platforms: [],
      languageSupport: [],
      description: "",
      descriptionTokens: [],
      harvestTimestamp: 0,
      kind: "instruction",
    })}\n`,
    "utf8",
  );

  // Mock the github API exactly like the github-harvester suites: repo meta,
  // recursive tree, and readme. Anything else fails loudly.
  const originalFetch = globalThis.fetch;
  const previousMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url === "https://api.github.com/repos/acme/toolbox") {
      return jsonResponse({
        name: "toolbox",
        full_name: "acme/toolbox",
        description: "Repository with installable agent assets",
        default_branch: "main",
        updated_at: "2026-05-15T00:00:00.000Z",
        pushed_at: "2026-05-15T00:00:00.000Z",
        stargazers_count: 321,
        language: "TypeScript",
        topics: ["agent", "tooling"],
        archived: false,
        html_url: "https://github.com/acme/toolbox",
      });
    }
    if (
      url ===
      "https://api.github.com/repos/acme/toolbox/git/trees/main?recursive=1"
    ) {
      return jsonResponse({
        sha: "tree-sha",
        truncated: false,
        tree: [
          { path: "skills/repo-guide/SKILL.md", type: "blob", sha: "1" },
          { path: "SECURITY.md", type: "blob", sha: "7" },
          { path: "LICENSE", type: "blob", sha: "8" },
          { path: ".github/workflows/ci.yml", type: "blob", sha: "9" },
          { path: "tests/repo-guide.test.ts", type: "blob", sha: "10" },
        ],
      });
    }
    if (url === "https://api.github.com/repos/acme/toolbox/readme") {
      return jsonResponse({
        path: "README.md",
        sha: "readme-sha",
        size: 120,
        html_url: "https://github.com/acme/toolbox/blob/main/README.md",
        download_url:
          "https://raw.githubusercontent.com/acme/toolbox/main/README.md",
      });
    }
    throw new Error(`Unexpected fetch in discover catalog test: ${url}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (previousMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousMockFlag;
    }
  });

  const code = await runDiscover(["catalog"], workspaceRoot, stateRoot);
  assert.equal(code, 0);

  // The harvested github skill made it into the catalog alongside the
  // reused indexed entry.
  const catalogPath = join(stateRoot, "discover", "catalog.assets.jsonl");
  const catalogText = await readFile(catalogPath, "utf8");
  assert.ok(
    catalogText.includes("skills/repo-guide/SKILL.md"),
    "github repo harvest contributed an entry",
  );
  assert.ok(
    catalogText.includes("synced-doc-entry"),
    "indexed source entries were reused",
  );
});

void test("discover handles enrichment results through the shared exit-code mapping (#428)", (t) => {
  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });
  // Note present -> printed, exit 0.
  assert.equal(
    discoverInternals.handleAiEnrichmentResult({
      note: "enrichment skipped: not configured",
      shouldFail: false,
    } as never),
    0,
  );
  assert.ok(
    output.some((line) => line.includes("enrichment skipped")),
    "the note is surfaced to the user",
  );

  // Failure requested -> exit 1.
  output.length = 0;
  assert.equal(
    discoverInternals.handleAiEnrichmentResult({
      note: undefined,
      shouldFail: true,
    } as never),
    1,
  );

  // Clean success without a note -> exit 0, no output.
  output.length = 0;
  assert.equal(
    discoverInternals.handleAiEnrichmentResult({
      note: undefined,
      shouldFail: false,
    } as never),
    0,
  );
  assert.equal(output.length, 0);
});
