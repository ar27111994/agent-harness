import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { readJsonFile, writeJsonFile } from "../files.js";
import { SOURCE_SYNC_STATE_OUTPUT_PATH } from "../domains/discovery/output-paths.js";
import { syncIndexedSources } from "../domains/discovery/source-sync.js";

type SourceSyncReport = {
  schemaVersion: 1;
  generatedAt: string;
  sources: Array<{
    sourceId: string;
    coverageMode: string;
    status: string;
    indexedEntryCount: number;
    reason?: string;
    cursors: Array<{
      cursorId: string;
      nextToken?: string;
      completed: boolean;
    }>;
  }>;
};

void test("source sync marks indexed sources as failed when the first html fetch aborts", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-additional-"),
  );
  const cleanupFetch = installFetchMock({
    "https://pi.dev/packages": () => {
      throw new Error("hard fail before any page sync");
    },
  });

  try {
    await writeTestSourceRegistry(projectRoot, [
      buildSource("pi-packages", "registry", {
        baseUrl: "https://pi.dev/packages",
      }),
    ]);

    await syncIndexedSources(projectRoot);

    const report = await readJsonFile<SourceSyncReport>(
      join(projectRoot, "discover", "output", "source-sync.json"),
    );
    const source = report.sources.find(
      (entry) => entry.sourceId === "pi-packages",
    );

    assert.equal(source?.coverageMode, "indexed");
    assert.equal(source?.status, "failed");
    assert.equal(source?.indexedEntryCount, 0);
    assert.deepEqual(source?.cursors, []);
    assert.match(
      source?.reason ?? "",
      /Failed to fetch https:\/\/pi.dev\/packages/u,
    );
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("source sync preserves prior sitemap cursors and classifies unsupported known ids", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-sync-additional-"),
  );
  const leafUrls = Array.from({ length: 51 }, (_, index) => {
    const itemNumber = index + 1;
    return `<url><loc>https://skills.sh/vercel/skill-${itemNumber}</loc></url>`;
  });
  const cleanupFetch = installFetchMock({
    "https://skills.sh/sitemap.xml": xmlResponse([
      "<sitemapindex>",
      "<sitemap><loc>https://skills.sh/sitemap-skills-1.xml</loc></sitemap>",
      "</sitemapindex>",
    ]),
    "https://skills.sh/sitemap-skills-1.xml": xmlResponse([
      "<urlset>",
      ...leafUrls,
      "</urlset>",
    ]),
  });

  try {
    await writeTestSourceRegistry(projectRoot, [
      buildSource("vscode-marketplace", "registry", {
        baseUrl: "https://marketplace.visualstudio.com",
      }),
      buildSource("skills-sh", "registry", {
        baseUrl: "https://skills.sh",
        sitemapUrl: "https://skills.sh/sitemap.xml",
      }),
    ]);
    await writeJsonFile(join(projectRoot, ...SOURCE_SYNC_STATE_OUTPUT_PATH), {
      schemaVersion: 1,
      generatedAt: "2026-05-15T00:00:00.000Z",
      sources: [
        {
          sourceId: "skills-sh",
          coverageMode: "indexed",
          status: "partial",
          indexedEntryCount: 0,
          cursors: [
            {
              cursorId: "https://skills.sh/sitemap-skills-1.xml",
              nextToken: "0",
              completed: false,
            },
          ],
        },
      ],
    });

    await withEnv(
      {
        AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_PER_RUN: "1",
      },
      async () => {
        await syncIndexedSources(projectRoot);
      },
    );

    const report = await readJsonFile<SourceSyncReport>(
      join(projectRoot, "discover", "output", "source-sync.json"),
    );
    const byId = new Map(
      report.sources.map((entry) => [entry.sourceId, entry]),
    );

    assert.equal(byId.get("vscode-marketplace")?.coverageMode, "sampled");
    assert.equal(byId.get("vscode-marketplace")?.status, "unsupported");

    const skills = byId.get("skills-sh");
    assert.equal(skills?.coverageMode, "indexed");
    assert.equal(skills?.status, "partial");
    assert.equal(
      skills?.cursors[0]?.cursorId,
      "https://skills.sh/sitemap-skills-1.xml",
    );
    assert.equal(skills?.cursors[0]?.nextToken, "50");
    assert.equal(skills?.cursors[0]?.completed, false);
  } finally {
    cleanupFetch();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

async function writeTestSourceRegistry(
  projectRoot: string,
  sources: unknown[],
): Promise<void> {
  await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources,
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
}

function buildSource(
  id: string,
  kind: string,
  endpoints: Record<string, string>,
): Record<string, unknown> {
  return {
    id,
    name: id,
    kind,
    authorityTier: "official-marketplace",
    publisher: {
      name: "Acme",
      verified: true,
    },
    hosts: ["copilot-vscode"],
    assetKinds: ["plugin"],
    discoveryMode: "catalog",
    priority: 80,
    enabled: true,
    endpoints,
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  };
}

function installFetchMock(
  responses: Record<string, Response | (() => Response)>,
): () => void {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const responder = responses[url];
    if (!responder) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return typeof responder === "function" ? responder() : responder.clone();
  };

  return () => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
      return;
    }
    process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFetchMockFlag;
  };
}

function xmlResponse(lines: string[]): Response {
  return new Response(lines.join(""), {
    status: 200,
    headers: { "content-type": "application/xml; charset=utf-8" },
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
    for (const [key, value] of previousValues) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearRuntimeConfigForTests();
  }
}
