import { setHttpTestFetchMocks } from "./env-test-utils.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readJsonFile, writeJsonFile } from "../files.js";
import { buildSourceHealthReport } from "../domains/discovery/source-health.js";
import { syncIndexedSources } from "../domains/discovery/source-sync.js";
import type { SourceSyncState } from "../domains/discovery/source-sync.js";
import type { SourceDefinition } from "../types.js";

const PUB_DEV: SourceDefinition = {
  id: "pub-dev-registry",
  name: "pub.dev",
  kind: "package-registry",
  authorityTier: "official-marketplace",
  publisher: { name: "pub.dev", verified: true },
  hosts: ["codex"],
  assetKinds: ["plugin", "reference-pack"],
  discoveryMode: "catalog",
  priority: 70,
  enabled: true,
  endpoints: {
    baseUrl: "https://pub.dev",
    listApi: "https://pub.dev/api/package-names",
  },
  rules: { officialPreferred: true, allowMirror: true, allowInstall: true },
};

const CURSOR: SourceDefinition = {
  id: "cursor-marketplace",
  name: "Cursor Marketplace",
  kind: "marketplace",
  authorityTier: "official-marketplace",
  publisher: { name: "Cursor", verified: true, owner: "cursor" },
  hosts: ["cursor", "codex"],
  assetKinds: ["plugin", "extension", "mcp-server", "reference-pack"],
  discoveryMode: "catalog",
  priority: 94,
  enabled: true,
  endpoints: {
    baseUrl: "https://cursor.com/marketplace",
    sitemapUrl: "https://cursor.com/sitemap-marketplace.xml",
  },
  rules: { officialPreferred: true, allowMirror: true, allowInstall: true },
};

void test("pub.dev sync advertises gzip and indexes packages", async () => {
  const projectRoot = await createProject([PUB_DEV]);
  let observedAcceptEncoding: string | null = null;
  const restoreFetch = installFetchMock(async (url, init) => {
    assert.equal(url, "https://pub.dev/api/package-names");
    observedAcceptEncoding = new Headers(init?.headers).get("accept-encoding");
    if (
      !observedAcceptEncoding
        ?.split(",")
        .map((v) => v.trim())
        .includes("gzip")
    ) {
      return new Response("Not Acceptable", { status: 406 });
    }
    return Response.json({ packages: ["riverpod", "flutter_hooks"] });
  });

  try {
    await syncIndexedSources(projectRoot);
    const state = await readSyncState(projectRoot);
    const pubState = state.sources.find(
      (source) => source.sourceId === PUB_DEV.id,
    );

    assert.equal(observedAcceptEncoding, "gzip");
    assert.equal(pubState?.status, "complete");
    assert.equal(pubState?.indexedEntryCount, 2);
  } finally {
    restoreFetch();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("one registry failure is recorded and later sources still synchronize", async () => {
  const projectRoot = await createProject([PUB_DEV, CURSOR]);
  const requestedUrls: string[] = [];
  const restoreFetch = installFetchMock(async (url) => {
    requestedUrls.push(url);
    if (url === "https://pub.dev/api/package-names") {
      return new Response("Not Acceptable", { status: 406 });
    }
    if (url === "https://cursor.com/sitemap-marketplace.xml") {
      return new Response(
        "<urlset><url><loc>https://cursor.com/marketplace/acme/tool</loc></url></urlset>",
        { status: 200, headers: { "content-type": "application/xml" } },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  try {
    await syncIndexedSources(projectRoot);
    const state = await readSyncState(projectRoot);
    const pubState = state.sources.find(
      (source) => source.sourceId === PUB_DEV.id,
    );
    const cursorState = state.sources.find(
      (source) => source.sourceId === CURSOR.id,
    );

    assert.equal(pubState?.status, "failed");
    assert.match(pubState?.reason ?? "", /406|Not Acceptable/u);
    assert.equal(cursorState?.status, "complete");
    assert.ok(
      requestedUrls.includes("https://cursor.com/sitemap-marketplace.xml"),
      "sync must continue to later sources after pub.dev fails",
    );

    const health = buildSourceHealthReport(
      [PUB_DEV, CURSOR],
      [],
      [],
      [],
      state,
    );
    const pubHealth = health.sources.find(
      (source) => source.sourceId === PUB_DEV.id,
    );
    assert.equal(pubHealth?.severity, "error");
    assert.equal(pubHealth?.status, "broken");
    assert.equal(pubHealth?.syncStatus, "failed");
  } finally {
    restoreFetch();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

async function createProject(sources: SourceDefinition[]): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-pub-dev-"));
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
    rankingOrder: [
      "authorityTier",
      "compatibilityMode",
      "portfolioFit",
      "risk",
      "contextCost",
      "maintenance",
      "popularity",
    ],
    duplicateGroups: [],
  });
  return projectRoot;
}

async function readSyncState(projectRoot: string): Promise<SourceSyncState> {
  return readJsonFile<SourceSyncState>(
    join(projectRoot, "discover", "output", "source-sync.json"),
  );
}

function installFetchMock(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
): () => void {
  const originalFetch = globalThis.fetch;
  const previousMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  setHttpTestFetchMocks(true);

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return handler(url, init);
  };

  return () => {
    globalThis.fetch = originalFetch;
    if (previousMockFlag === undefined) {
      setHttpTestFetchMocks(false);
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousMockFlag;
      setHttpTestFetchMocks(previousMockFlag === "1");
    }
  };
}
