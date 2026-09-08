import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { restoreEnvVar, setHttpTestFetchMocks } from "./env-test-utils.js";
import {
  readJsonFile,
  readJsonLinesFile,
  writeJsonFile,
  writeJsonLinesFile,
} from "../files.js";
import { syncIndexedSources } from "../domains/discovery/source-sync.js";
import type { DemandProfile } from "../types.js";

type SourceSyncReport = {
  schemaVersion: 1;
  generatedAt: string;
  sources: Array<{
    sourceId: string;
    coverageMode: string;
    status: string;
    indexedEntryCount: number;
    cursors: Array<{
      cursorId: string;
      nextToken?: string;
      completed: boolean;
    }>;
  }>;
};

void test("source sync resumes vscode marketplace cursors across paginated runs", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-vscode-"),
  );
  const calls: Array<{ query: string; pageNumber: number }> = [];
  const cleanupFetch = installFetchMock(async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      filters?: Array<{
        criteria?: Array<{ filterType?: number; value?: string }>;
        pageNumber?: number;
      }>;
    };
    const filter = body.filters?.[0];
    const query =
      filter?.criteria?.find((entry) => entry.filterType === 10)?.value ??
      "unknown";
    const pageNumber = filter?.pageNumber ?? 1;
    calls.push({ query, pageNumber });

    if (pageNumber === 1) {
      return jsonResponse({
        results: [
          {
            extensions: [
              {
                publisher: { publisherName: "Acme" },
                extensionName: "react-tools",
                displayName: "React Tools",
                shortDescription: "React helpers",
                url: "https://marketplace.visualstudio.com/items?itemName=Acme.react-tools",
                statistics: [{ statisticName: "install", value: 321 }],
                lastUpdated: "2026-05-10T00:00:00.000Z",
              },
            ],
          },
        ],
      });
    }

    return jsonResponse({ results: [{ extensions: [] }] });
  });

  try {
    await writeDiscoveryScaffold(projectRoot, {
      frameworks: ["react"],
    });

    await withEnv(
      {
        AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_QUERIES: "1",
        AGENT_HARNESS_VSCODE_MARKETPLACE_SYNC_PAGE_SIZE: "1",
        AGENT_HARNESS_VSCODE_MARKETPLACE_POPULARITY_SWEEP_PAGES: "0",
        AGENT_HARNESS_VSCODE_MARKETPLACE_CATEGORY_SWEEP_ENABLED: "false",
        AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_PER_RUN: "1",
      },
      async () => {
        await syncIndexedSources(projectRoot);

        const firstReport = await readJsonFile<SourceSyncReport>(
          join(projectRoot, "discover", "output", "source-sync.json"),
        );
        const firstSource = firstReport.sources.find(
          (source) => source.sourceId === "vscode-marketplace",
        );

        assert.equal(firstSource?.coverageMode, "indexed");
        assert.equal(firstSource?.status, "partial");
        assert.equal(firstSource?.cursors.length, 1);
        assert.equal(firstSource?.cursors[0]?.nextToken, "2");
        assert.equal(firstSource?.cursors[0]?.completed, false);

        await syncIndexedSources(projectRoot);

        const secondReport = await readJsonFile<SourceSyncReport>(
          join(projectRoot, "discover", "output", "source-sync.json"),
        );
        const secondSource = secondReport.sources.find(
          (source) => source.sourceId === "vscode-marketplace",
        );
        const entries = await readJsonLinesFile<{ id: string }>(
          join(projectRoot, "state", "discover", "source-sync.entries.jsonl"),
        );

        assert.equal(secondSource?.status, "complete");
        assert.equal(secondSource?.cursors.length, 1);
        assert.equal(secondSource?.cursors[0]?.nextToken, "2");
        assert.equal(secondSource?.cursors[0]?.completed, true);
        assert.equal(
          secondSource?.cursors[0]?.cursorId,
          firstSource?.cursors[0]?.cursorId,
        );
        assert.equal(entries.length, 1);
        assert.match(entries[0]?.id ?? "", /react-tools/u);
      },
    );

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.pageNumber, 1);
    assert.equal(calls[1]?.pageNumber, 2);
    assert.equal(calls[0]?.query, calls[1]?.query);
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("source sync keeps entry files unchanged when vscode marketplace entries are structurally identical", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-vscode-"),
  );
  const cleanupFetch = installFetchMock(async () =>
    jsonResponse({
      results: [
        {
          extensions: [
            {
              publisher: { publisherName: "Acme" },
              extensionName: "react-tools",
              displayName: "React Tools",
              shortDescription: "React helpers",
              url: "https://marketplace.visualstudio.com/items?itemName=Acme.react-tools",
              statistics: [{ statisticName: "install", value: 321 }],
              lastUpdated: "2026-05-10T00:00:00.000Z",
            },
          ],
        },
      ],
    }),
  );

  try {
    await writeDiscoveryScaffold(projectRoot, {
      frameworks: ["react"],
    });

    await withEnv(
      {
        AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_QUERIES: "1",
        AGENT_HARNESS_VSCODE_MARKETPLACE_SYNC_PAGE_SIZE: "2",
        AGENT_HARNESS_VSCODE_MARKETPLACE_POPULARITY_SWEEP_PAGES: "0",
        AGENT_HARNESS_VSCODE_MARKETPLACE_CATEGORY_SWEEP_ENABLED: "false",
        AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_PER_RUN: "1",
      },
      async () => {
        await syncIndexedSources(projectRoot);

        const entriesPath = join(
          projectRoot,
          "state",
          "discover",
          "source-sync.entries.jsonl",
        );
        const generatedEntries =
          await readJsonLinesFile<Record<string, unknown>>(entriesPath);
        const reorderedEntries = generatedEntries.map((entry) =>
          reorderJsonValue(entry),
        );
        await writeJsonLinesFile(entriesPath, reorderedEntries);
        const before = await readFile(entriesPath, "utf8");

        await syncIndexedSources(projectRoot);

        const after = await readFile(entriesPath, "utf8");
        assert.equal(after, before);
      },
    );
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("marketplace sync tracks popularity sweep cursors and resumes partial sweeps", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-vscode-pop-"),
  );
  const calls: number[] = [];
  const cleanupFetch = installFetchMock(async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      filters?: Array<{ pageNumber?: number }>;
    };
    const pageNumber = body.filters?.[0]?.pageNumber ?? 1;
    calls.push(pageNumber);
    if (pageNumber === 1) {
      return jsonResponse({
        results: [
          {
            extensions: Array.from({ length: 100 }, (_, index) => ({
              publisher: { publisherName: "Acme" },
              extensionName: `pop-${index}`,
              displayName: `Popular ${index}`,
              shortDescription: "popular",
              url: `https://marketplace.visualstudio.com/items?itemName=Acme.pop-${index}`,
              lastUpdated: "2026-05-10T00:00:00.000Z",
            })),
          },
        ],
      });
    }
    return jsonResponse({ results: [{ extensions: [] }] });
  });

  try {
    await writeDiscoveryScaffold(projectRoot, {
      frameworks: ["react"],
    });

    await withEnv(
      {
        AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_QUERIES: "1",
        AGENT_HARNESS_VSCODE_MARKETPLACE_SYNC_PAGE_SIZE: "1",
        AGENT_HARNESS_VSCODE_MARKETPLACE_POPULARITY_SWEEP_PAGES: "1",
        AGENT_HARNESS_VSCODE_MARKETPLACE_CATEGORY_SWEEP_ENABLED: "false",
        AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_PER_RUN: "2",
      },
      async () => {
        clearRuntimeConfigForTests();
        await syncIndexedSources(projectRoot);

        const report = await readJsonFile<SourceSyncReport>(
          join(projectRoot, "discover", "output", "source-sync.json"),
        );
        const source = report.sources.find(
          (entry) => entry.sourceId === "vscode-marketplace",
        );
        assert.equal(source?.status, "partial");
        assert.ok(
          source?.cursors.some(
            (cursor) =>
              cursor.cursorId === "__popularity__install-count" &&
              cursor.nextToken === "2" &&
              cursor.completed === false,
          ),
          "popularity sweep cursor must record the in-flight page",
        );

        clearRuntimeConfigForTests();
        await syncIndexedSources(projectRoot);

        const resumed = await readJsonFile<SourceSyncReport>(
          join(projectRoot, "discover", "output", "source-sync.json"),
        );
        const resumedSource = resumed.sources.find(
          (entry) => entry.sourceId === "vscode-marketplace",
        );
        assert.equal(resumedSource?.status, "complete");
        assert.ok(
          resumedSource?.cursors.some(
            (cursor) =>
              cursor.cursorId === "__popularity__install-count" &&
              cursor.completed === true,
          ),
          "resumed popularity sweep must complete and close its cursor",
        );
      },
    );
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("marketplace sync fetches demand-derived category sweeps, tracks partial pages, and closes cursors on resume", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-vscode-cat-"),
  );
  const calls: number[] = [];
  const cleanupFetch = installFetchMock(async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      filters?: Array<{ pageNumber?: number }>;
    };
    const pageNumber = body.filters?.[0]?.pageNumber ?? 1;
    calls.push(pageNumber);
    // Full first page for every sweep (category + tier-3 query), empty
    // afterwards: each sweep pauses one page in and resumes to completion.
    if (pageNumber === 1) {
      return jsonResponse({
        results: [
          {
            extensions: Array.from({ length: 100 }, (_, index) => ({
              publisher: { publisherName: "Acme" },
              extensionName: `cat-${index}`,
              displayName: `Category ${index}`,
              shortDescription: "category",
              url: `https://marketplace.visualstudio.com/items?itemName=Acme.cat-${index}`,
              lastUpdated: "2026-05-10T00:00:00.000Z",
            })),
          },
        ],
      });
    }
    return jsonResponse({ results: [{ extensions: [] }] });
  });

  try {
    await writeDiscoveryScaffold(projectRoot, {
      frameworks: ["react"],
    });

    await withEnv(
      {
        AGENT_HARNESS_VSCODE_MARKETPLACE_MAX_QUERIES: "1",
        AGENT_HARNESS_VSCODE_MARKETPLACE_SYNC_PAGE_SIZE: "1",
        AGENT_HARNESS_VSCODE_MARKETPLACE_POPULARITY_SWEEP_PAGES: "0",
        AGENT_HARNESS_VSCODE_MARKETPLACE_CATEGORY_SWEEP_ENABLED: "true",
        AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_PER_RUN: "1",
      },
      async () => {
        clearRuntimeConfigForTests();
        await syncIndexedSources(projectRoot);

        const report = await readJsonFile<SourceSyncReport>(
          join(projectRoot, "discover", "output", "source-sync.json"),
        );
        const source = report.sources.find(
          (entry) => entry.sourceId === "vscode-marketplace",
        );
        assert.equal(source?.status, "partial");
        const categoryCursors = source?.cursors.filter((cursor) =>
          cursor.cursorId.startsWith("__cat__"),
        );
        assert.deepEqual(
          categoryCursors?.map((cursor) => cursor.cursorId).sort(),
          [
            "__cat__Formatters",
            "__cat__Linters",
            "__cat__Programming Languages",
          ],
          "demand signals (typescript) must map to the known category sweep cursors",
        );
        assert.ok(
          categoryCursors?.every(
            (cursor) => cursor.nextToken === "2" && cursor.completed === false,
          ),
          "full category pages must leave in-flight cursors for the next run",
        );

        clearRuntimeConfigForTests();
        await syncIndexedSources(projectRoot);

        const resumed = await readJsonFile<SourceSyncReport>(
          join(projectRoot, "discover", "output", "source-sync.json"),
        );
        const resumedSource = resumed.sources.find(
          (entry) => entry.sourceId === "vscode-marketplace",
        );
        assert.equal(resumedSource?.status, "complete");
        const resumedCursors = resumedSource?.cursors.filter((cursor) =>
          cursor.cursorId.startsWith("__cat__"),
        );
        assert.ok(
          resumedCursors?.every((cursor) => cursor.completed === true),
          "empty category pages must close every category cursor on resume",
        );
      },
    );
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

async function writeDiscoveryScaffold(
  projectRoot: string,
  options: { frameworks: string[] },
): Promise<void> {
  await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [
      {
        id: "vscode-marketplace",
        name: "vscode-marketplace",
        kind: "marketplace",
        authorityTier: "official-marketplace",
        publisher: { name: "Microsoft", verified: true },
        hosts: ["copilot-vscode"],
        assetKinds: ["extension"],
        discoveryMode: "catalog",
        priority: 80,
        enabled: true,
        endpoints: {
          baseUrl: "https://marketplace.visualstudio.com",
          marketplaceApi:
            "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery",
        },
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
      frameworks: options.frameworks,
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

function reorderJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => reorderJsonValue(entry));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, entryValue]) => [key, reorderJsonValue(entryValue)]),
  );
}

const VSCODE_MARKETPLACE_API_PREFIX =
  "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";

function installFetchMock(
  responder: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response> | Response,
  expectedUrlPrefix: string = VSCODE_MARKETPLACE_API_PREFIX,
): () => void {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  setHttpTestFetchMocks(true);

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (!url.startsWith(expectedUrlPrefix)) {
      // Endpoint-shape drift must fail the mock loudly (G1) instead of
      // passing while silently fetching a different URL.
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return responder(input, init);
  };

  return () => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      setHttpTestFetchMocks(false);
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

  clearRuntimeConfigForTests();

  try {
    await callback();
  } finally {
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearRuntimeConfigForTests();
  }
}
