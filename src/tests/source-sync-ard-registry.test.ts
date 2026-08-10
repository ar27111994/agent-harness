import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { restoreEnvVar } from "./env-test-utils.js";
import { readJsonFile, readJsonLinesFile, writeJsonFile } from "../files.js";
import { syncIndexedSources } from "../domains/discovery/source-sync.js";
import { clearRuntimeConfigForTests } from "../config/runtime.js";
import type { DemandProfile } from "../types.js";
import type { SourceSyncSourceState } from "../domains/discovery/source-sync/types.js";

/**
 * Mocked-HTTP contract tests for the ARD registry sync (#451).
 *
 * syncArdRegistrySource (src/domains/discovery/source-sync/registries/
 * ard-registry.ts) was previously excluded from the coverage gate with a
 * `c8 ignore start|stop` block. These tests drive the real implementation
 * end-to-end through the source-sync pipeline with a mocked global fetch
 * (the same pattern as source-sync-vscode-marketplace.test.ts) and cover
 * pagination, cursor resume, entry/max-page caps, trust-signal mapping,
 * referrals persistence, failure handling, and malformed payload shapes.
 */

type SourceSyncReport = {
  schemaVersion: 1;
  generatedAt: string;
  sources: SourceSyncSourceState[];
};

const ARD_URL = "https://agenticresourcediscovery.org/search";

void test("ard registry sync paginates, persists referrals, and resumes cursors to completion", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-ard-"),
  );
  const calls: Array<{ pageToken?: string }> = [];
  const cleanupFetch = installFetchMock(async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      pageToken?: string;
    };
    calls.push({ pageToken: body.pageToken });

    if (body.pageToken === undefined) {
      return jsonResponse({
        results: [
          {
            displayName: "DuckDB Query Skill",
            type: "application/ai-skill",
            description: "Run DuckDB queries",
            url: "https://example.com/duckdb-skill",
            capabilities: ["duckdb", "sql"],
            tags: ["database"],
            data: { assetKind: "skill" },
            trustManifest: {
              identity: true,
              attestations: [{ type: "SOC2-Type2" }],
              signature: "sig",
            },
            score: 80,
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
          {
            displayName: "MCP Server",
            type: "application/mcp-server",
            url: "https://example.com/mcp-server",
            data: { assetKind: "mcp-server" },
          },
        ],
        pageToken: "page-2",
        referrals: [{ id: "referral-1", claim: "federated" }],
      });
    }

    return jsonResponse({
      results: [
        {
          displayName: "Third Asset",
          type: "application/ai-agent",
          url: "https://example.com/third-asset",
        },
      ],
    });
  });

  try {
    await writeArdDiscoveryScaffold(projectRoot);

    // The referrals artifact is written relative to the process CWD (the
    // CLI runs from the workspace root); mirror that in the test and
    // restore the runner's CWD afterwards.
    const originalCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      await syncIndexedSources(projectRoot);
    } finally {
      process.chdir(originalCwd);
    }

    const report = await readJsonFile<SourceSyncReport>(
      join(projectRoot, "discover", "output", "source-sync.json"),
    );
    const source = report.sources.find(
      (entry) => entry.sourceId === "ard-test-registry",
    );

    assert.equal(source?.coverageMode, "indexed");
    assert.equal(source?.status, "complete");
    assert.equal(source?.indexedEntryCount, 3);
    assert.deepEqual(source?.cursors, [
      // nextToken is absent from the persisted JSON for completed cursors.
      { cursorId: "pageToken", completed: true },
    ]);

    const entries = await readJsonLinesFile<Record<string, unknown>>(
      join(projectRoot, "state", "discover", "source-sync.entries.jsonl"),
    );
    assert.equal(entries.length, 3);

    const duckdbEntry = entries.find((entry) =>
      String(entry.displayName).includes("DuckDB"),
    );
    assert.ok(duckdbEntry, "duckdb entry must be indexed");
    assert.equal(duckdbEntry?.assetKind, "skill");
    assert.ok(
      (duckdbEntry?.trust as { signals?: string[] })?.signals?.includes(
        "ard-signed",
      ),
      "official-first-party trust signals must be extracted",
    );
    assert.equal(
      (duckdbEntry?.fit as { portfolioFit?: number })?.portfolioFit,
      0.8,
      "ard score must normalize to portfolio fit",
    );
    assert.ok(
      Array.isArray(duckdbEntry?.representativeQueries) &&
        (duckdbEntry?.representativeQueries as string[]).length > 0,
      "synthetic representative queries must be built",
    );

    // Referrals are persisted in one write after pagination completes.
    const referrals = await readJsonFile<{ referrals: unknown[] }>(
      join(
        projectRoot,
        ".agent-harness",
        "discover",
        "output",
        "ard-referrals.json",
      ),
    );
    assert.deepEqual(referrals.referrals, [
      { id: "referral-1", claim: "federated" },
    ]);

    // A completed ARD cursor restarts fresh on the next run (refresh
    // semantics, matching the other finite registries): entries are
    // re-observed, so the pipeline's prune-missing pass keeps them.
    calls.length = 0;
    await syncIndexedSources(projectRoot);
    const second = await readJsonFile<SourceSyncReport>(
      join(projectRoot, "discover", "output", "source-sync.json"),
    );
    const secondSource = second.sources.find(
      (entry) => entry.sourceId === "ard-test-registry",
    );
    assert.equal(secondSource?.status, "complete");
    assert.equal(secondSource?.indexedEntryCount, 3);
    assert.equal(calls.length, 2, "completed cursor restarts the sweep fresh");
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("ard registry sync honors the per-run page cap and resumes the cursor", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-ard-pages-"),
  );
  const calls: Array<{ pageToken?: string }> = [];
  const cleanupFetch = installFetchMock(async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      pageToken?: string;
    };
    calls.push({ pageToken: body.pageToken });
    if (body.pageToken === undefined) {
      return jsonResponse({
        results: [
          { displayName: "Page One Asset", type: "application/ai-skill" },
        ],
        pageToken: "page-2",
      });
    }
    return jsonResponse({
      results: [
        { displayName: "Page Two Asset", type: "application/ai-skill" },
      ],
    });
  });

  try {
    await writeArdDiscoveryScaffold(projectRoot);

    await withEnv(
      { AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_PER_RUN: "1" },
      async () => {
        // The sync reads the page cap from the cached runtime config.
        clearRuntimeConfigForTests();
        await syncIndexedSources(projectRoot);

        const report = await readJsonFile<SourceSyncReport>(
          join(projectRoot, "discover", "output", "source-sync.json"),
        );
        const source = report.sources.find(
          (entry) => entry.sourceId === "ard-test-registry",
        );
        assert.equal(source?.status, "partial");
        assert.equal(source?.indexedEntryCount, 1);
        assert.deepEqual(source?.cursors, [
          { cursorId: "pageToken", nextToken: "page-2", completed: false },
        ]);

        clearRuntimeConfigForTests();
        await syncIndexedSources(projectRoot);

        const resumed = await readJsonFile<SourceSyncReport>(
          join(projectRoot, "discover", "output", "source-sync.json"),
        );
        const resumedSource = resumed.sources.find(
          (entry) => entry.sourceId === "ard-test-registry",
        );
        assert.equal(resumedSource?.status, "complete");
        assert.equal(resumedSource?.indexedEntryCount, 1);
        assert.deepEqual(resumedSource?.cursors, [
          // nextToken is absent from the persisted JSON for completed cursors.
          { cursorId: "pageToken", completed: true },
        ]);
      },
    );

    assert.deepEqual(
      calls.map((call) => call.pageToken),
      [undefined, "page-2"],
      "resume must send the stored pageToken",
    );
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("ard registry sync stops at the indexed entry cap", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-ard-cap-"),
  );
  const cleanupFetch = installFetchMock(async () =>
    jsonResponse({
      results: Array.from({ length: 501 }, (_, index) => ({
        displayName: `Bulk Asset ${index}`,
        type: "application/ai-skill",
      })),
      pageToken: "more-pages",
    }),
  );

  try {
    await writeArdDiscoveryScaffold(projectRoot);

    await syncIndexedSources(projectRoot);

    const report = await readJsonFile<SourceSyncReport>(
      join(projectRoot, "discover", "output", "source-sync.json"),
    );
    const source = report.sources.find(
      (entry) => entry.sourceId === "ard-test-registry",
    );
    assert.equal(source?.status, "partial");
    assert.equal(source?.indexedEntryCount, 500);
    assert.deepEqual(source?.cursors, [
      { cursorId: "pageToken", nextToken: "more-pages", completed: false },
    ]);
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("ard registry sync handles failures, malformed shapes, and missing endpoints", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-ard-fail-"),
  );
  const calls: Array<{ ok: boolean }> = [];
  const cleanupFetch = installFetchMock(async () => {
    calls.push({ ok: true });
    return jsonResponse({ results: "not-an-array", pageToken: "never" });
  });

  try {
    // Malformed payload: results is not an array → page completes with 0.
    await writeArdDiscoveryScaffold(projectRoot);
    await syncIndexedSources(projectRoot);
    const report = await readJsonFile<SourceSyncReport>(
      join(projectRoot, "discover", "output", "source-sync.json"),
    );
    const malformedSource = report.sources.find(
      (entry) => entry.sourceId === "ard-test-registry",
    );
    assert.equal(malformedSource?.status, "complete");
    assert.equal(malformedSource?.indexedEntryCount, 0);
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }

  // HTTP failure: non-OK responses trigger retries (bounded) and then a
  // per-source failure record — the retry/guard layer is exercised.
  const failureRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-ard-http-"),
  );
  const failureCleanup = installFetchMock(async () => {
    return new Response("<html>retry later</html>", { status: 503 });
  });
  try {
    await writeArdDiscoveryScaffold(failureRoot);
    await syncIndexedSources(failureRoot);
    const report = await readJsonFile<SourceSyncReport>(
      join(failureRoot, "discover", "output", "source-sync.json"),
    );
    const source = report.sources.find(
      (entry) => entry.sourceId === "ard-test-registry",
    );
    assert.equal(source?.status, "failed");
    assert.equal(source?.indexedEntryCount, 0);
    assert.equal(source?.consecutiveFailures, 1);
  } finally {
    failureCleanup();
    await rm(failureRoot, { force: true, recursive: true });
  }

  // Source without an endpoint: completes with zero without any network call.
  const noEndpointRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-ard-noendpoint-"),
  );
  const noEndpointCleanup = installFetchMock(async () => {
    throw new Error("must not fetch");
  });
  try {
    await writeArdDiscoveryScaffold(noEndpointRoot, {
      withEndpoint: false,
    });
    await syncIndexedSources(noEndpointRoot);
    const report = await readJsonFile<SourceSyncReport>(
      join(noEndpointRoot, "discover", "output", "source-sync.json"),
    );
    const source = report.sources.find(
      (entry) => entry.sourceId === "ard-test-registry",
    );
    assert.equal(source?.status, "complete");
    assert.equal(source?.indexedEntryCount, 0);
  } finally {
    noEndpointCleanup();
    await rm(noEndpointRoot, { force: true, recursive: true });
  }
});

void test("ard registry sync survives a failed referrals persistence write with a warning", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-ard-referrals-fail-"),
  );
  const cleanupFetch = installFetchMock(async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      pageToken?: string;
    };
    if (body.pageToken === undefined) {
      return jsonResponse({
        results: [
          {
            displayName: "Referral Asset",
            type: "application/ai-skill",
            url: "https://example.com/referral-asset",
          },
        ],
        referrals: [{ id: "ref-that-cannot-persist" }],
      });
    }
    return jsonResponse({ results: [] });
  });
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown, ...args: unknown[]) => {
    warnings.push(String(message), ...args.map(String));
  };

  try {
    await writeArdDiscoveryScaffold(projectRoot);
    // Make the CWD-relative referrals target impossible to write: a file
    // named .agent-harness blocks the directory creation.
    await writeFile(join(projectRoot, ".agent-harness"), "blocking file");

    const originalCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      await syncIndexedSources(projectRoot);
    } finally {
      process.chdir(originalCwd);
    }

    assert.ok(
      warnings.some((line) =>
        line.includes("ard-registry: failed to persist federated referrals"),
      ),
      "referrals persistence failure must surface a warning",
    );
    const report = await readJsonFile<SourceSyncReport>(
      join(projectRoot, "discover", "output", "source-sync.json"),
    );
    const source = report.sources.find(
      (entry) => entry.sourceId === "ard-test-registry",
    );
    assert.equal(source?.status, "complete");
    assert.equal(source?.indexedEntryCount, 1);
  } finally {
    console.warn = originalWarn;
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("ard registry sync applies fallback display names and asset kinds for sparse results", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-ard-sparse-"),
  );
  const cleanupFetch = installFetchMock(async () =>
    jsonResponse({
      results: [{ url: "https://example.com/sparse" }],
    }),
  );

  try {
    await writeArdDiscoveryScaffold(projectRoot);

    const originalCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      await syncIndexedSources(projectRoot);
    } finally {
      process.chdir(originalCwd);
    }

    const entries = await readJsonLinesFile<Record<string, unknown>>(
      join(projectRoot, "state", "discover", "source-sync.entries.jsonl"),
    );
    assert.equal(entries.length, 1);
    assert.equal(
      entries[0]?.displayName,
      "ARD asset",
      "missing displayName must fall back to the generic ARD label",
    );
    assert.equal(
      entries[0]?.assetKind,
      "skill",
      "missing/unparseable ARD type must fall back to the default skill kind",
    );
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("ard registry sync does not extract trust signals for community-tier sources", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-ard-community-"),
  );
  const cleanupFetch = installFetchMock(async () =>
    jsonResponse({
      results: [
        {
          displayName: "Community Asset",
          type: "application/ai-skill",
          url: "https://example.com/community",
          trustManifest: { identity: true, signature: "sig" },
        },
      ],
    }),
  );

  try {
    await writeArdDiscoveryScaffold(projectRoot, {
      authorityTier: "unverified-community",
    });

    const originalCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      await syncIndexedSources(projectRoot);
    } finally {
      process.chdir(originalCwd);
    }

    const entries = await readJsonLinesFile<Record<string, unknown>>(
      join(projectRoot, "state", "discover", "source-sync.entries.jsonl"),
    );
    assert.equal(entries.length, 1);
    const trustSignals =
      (entries[0]?.trust as { signals?: string[] })?.signals ?? [];
    assert.ok(
      !trustSignals.some((signal) => signal.startsWith("ard-")),
      `community sources must not self-attest ARD trust signals, got: ${trustSignals.join(", ")}`,
    );
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

async function writeArdDiscoveryScaffold(
  projectRoot: string,
  options: { withEndpoint?: boolean; authorityTier?: string } = {},
): Promise<void> {
  const withEndpoint = options.withEndpoint ?? true;
  const authorityTier = options.authorityTier ?? "official-first-party";
  await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [
      {
        id: "ard-test-registry",
        name: "ard-test-registry",
        kind: "ard-registry",
        authorityTier,
        publisher: { name: "ARD", verified: true },
        hosts: ["copilot-vscode"],
        assetKinds: [
          "skill",
          "mcp-server",
          "agent",
          "reference-pack",
          "payable-api",
        ],
        discoveryMode: "catalog",
        priority: 90,
        enabled: true,
        endpoints: withEndpoint ? { apiUrl: ARD_URL } : {},
        rules: {
          officialPreferred: true,
          allowMirror: true,
          allowInstall: true,
        },
      },
    ],
  });
  await writeJsonFile(join(projectRoot, "discover", "selections.json"), {
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
  const demandProfile: DemandProfile = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "C:/fixture",
    summary: {
      scannedFiles: 1,
      matchedFiles: 1,
    },
    signals: {
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: ["react"],
      concerns: [],
      tooling: [],
    },
    evidence: [],
  };
  await writeJsonFile(
    join(projectRoot, "discover", "output", "demand-profile.json"),
    demandProfile,
  );
}

function installFetchMock(
  responder: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response> | Response,
): () => void {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async (input, init) => responder(input, init);

  return () => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
      return;
    }
    restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function withEnv(
  overrides: Record<string, string | undefined>,
  callback: () => Promise<void>,
): Promise<void> {
  const previousValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previousValues.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await callback();
  } finally {
    for (const [key, previous] of previousValues) {
      restoreEnvVar(key, previous);
    }
  }
}
