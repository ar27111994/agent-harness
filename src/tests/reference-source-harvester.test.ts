import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReferenceSourceCatalogEntry,
  harvestReferenceSource,
} from "../domains/discovery/reference-source-harvester.js";
import type {
  DemandProfile,
  SelectionRegistry,
  SourceDefinition,
} from "../types.js";

void test("reference source catalog entries derive compatibility and installability from harvested items", () => {
  const selectionRegistry = buildSelectionRegistry();
  const source = buildSource(
    "marketplace-reference",
    "marketplace",
    {
      baseUrl: "https://example.com/marketplace",
    },
    {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  );

  const nativeEntry = buildReferenceSourceCatalogEntry(
    source,
    buildDemandProfile(),
    selectionRegistry,
    {
      harvestedItem: {
        displayName: "Acme Extension",
        originUrl: "https://example.com/marketplace/acme-extension",
        assetKind: "extension",
        compatibilityMode: "native",
        installMethod: "vscode-extension",
        manifestEntry: "acme.extension",
        capabilities: ["typescript", "testing"],
        summary: "Native installable extension",
        installs: 42,
        lastUpdated: "2026-05-15T00:00:00.000Z",
      },
    },
  );

  assert.equal(nativeEntry.assetKind, "extension");
  assert.equal(nativeEntry.compatibilityMode, "native");
  assert.deepEqual(nativeEntry.install.nativeHosts, ["copilot-vscode"]);
  assert.equal(nativeEntry.status.installEligible, true);
  assert.equal(nativeEntry.status.activationEligible, true);
  assert.equal(nativeEntry.status.mirrorEligible, true);
  assert.equal(
    nativeEntry.source.originUrl,
    "https://example.com/marketplace/acme-extension",
  );
  assert.equal(nativeEntry.evidence.lineCount, 1);

  const fallbackEntry = buildReferenceSourceCatalogEntry(
    buildSource("docs-reference", "docs", {
      docsUrl: "https://example.com/docs",
    }),
    null,
    selectionRegistry,
    {
      originUrl: "https://example.com/docs",
    },
  );

  assert.equal(fallbackEntry.assetKind, "reference-pack");
  assert.equal(fallbackEntry.compatibilityMode, "reference-only");
  assert.equal(fallbackEntry.install.method, "docs-reference");
  assert.equal(fallbackEntry.status.installEligible, false);
  assert.equal(fallbackEntry.status.activationEligible, false);
  assert.equal(fallbackEntry.status.mirrorEligible, false);
});

void test("reference source catalog entries fall back through repo and source id origins", () => {
  const selectionRegistry = buildSelectionRegistry();
  const repoSource = buildSource("repo-reference", "repo", {
    repo: "https://github.com/acme/reference-pack",
  });
  delete repoSource.publisher;
  const repoEntry = buildReferenceSourceCatalogEntry(
    repoSource,
    null,
    selectionRegistry,
  );

  assert.equal(
    repoEntry.source.originUrl,
    "https://github.com/acme/reference-pack",
  );
  assert.equal(repoEntry.install.manifestEntry, repoEntry.source.originUrl);
  assert.equal(repoEntry.source.publisher, "repo-reference");
  assert.equal(repoEntry.source.publisherVerified, false);

  const idOnlySource = buildSource("id-only-reference", "marketplace", {});
  const idOnlyEntry = buildReferenceSourceCatalogEntry(
    idOnlySource,
    null,
    selectionRegistry,
  );

  assert.equal(idOnlyEntry.source.originUrl, "id-only-reference");
  assert.equal(idOnlyEntry.compatibilityMode, "partial");
  assert.equal(idOnlyEntry.install.method, "marketplace-reference");
  assert.equal(idOnlyEntry.status.mirrorEligible, false);
  assert.equal(idOnlyEntry.status.installEligible, false);
});

void test("reference source harvester returns harvested docs items and falls back to raw content when needed", async (context) => {
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

    if (url === "https://example.com/docs") {
      return new Response(
        `<html><head><title>Docs Home</title></head><body>
          <a href="/guide">Guide</a>
        </body></html>`,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }

    if (url === "https://www.npmjs.com/package/acme-reference") {
      return new Response(
        `<!doctype html><html><head><title>Acme Reference</title>
          <meta name="description" content="Collected patterns for testing.">
        </head><body><h2>What This Skill Does</h2><p>Shares testing guidance.</p></body></html>`,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFetchMockFlag;
    }
  });

  const selectionRegistry = buildSelectionRegistry();
  const docsEntries = await harvestReferenceSource(
    buildSource("docs-reference", "docs", {
      docsUrl: "https://example.com/docs",
    }),
    buildDemandProfile(),
    selectionRegistry,
  );
  const repoEntries = await harvestReferenceSource(
    buildSource(
      "marketplace-fallback",
      "marketplace",
      {
        baseUrl: "https://www.npmjs.com/package/acme-reference",
      },
      {
        officialPreferred: true,
        allowMirror: true,
        allowInstall: false,
      },
    ),
    null,
    selectionRegistry,
  );

  assert.equal(docsEntries.length, 2);
  assert.ok(
    docsEntries.some(
      (entry) => entry.source.originUrl === "https://example.com/guide",
    ),
  );
  assert.ok(docsEntries.every((entry) => entry.evidence.manifestFound));

  assert.equal(repoEntries.length, 1);
  assert.equal(repoEntries[0]?.displayName, "marketplace-fallback");
  assert.equal(repoEntries[0]?.compatibilityMode, "adaptable");
  assert.equal(repoEntries[0]?.install.method, "marketplace-summary");
  assert.equal(repoEntries[0]?.status.mirrorEligible, true);
  assert.equal(repoEntries[0]?.status.installEligible, false);
  assert.match(repoEntries[0]?.capabilities.join(" ") ?? "", /testing/u);
});

function buildSelectionRegistry(): SelectionRegistry {
  return {
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
  };
}

function buildDemandProfile(): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "fixtures/workspace",
    summary: {
      scannedFiles: 1,
      matchedFiles: 1,
    },
    signals: {
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: [],
      concerns: ["testing"],
      tooling: [],
    },
    evidence: [],
  };
}

function buildSource(
  id: string,
  kind: SourceDefinition["kind"],
  endpoints: SourceDefinition["endpoints"],
  rules: SourceDefinition["rules"] = {
    officialPreferred: true,
    allowMirror: false,
    allowInstall: false,
  },
): SourceDefinition {
  return {
    id,
    name: id,
    kind,
    authorityTier:
      kind === "repo" ? "trusted-community" : "official-first-party",
    publisher: { name: "fixture", verified: kind !== "repo" },
    hosts: ["copilot-vscode"],
    assetKinds: ["reference-pack", "extension"],
    discoveryMode: "catalog",
    priority: 80,
    enabled: true,
    endpoints,
    rules,
  };
}
