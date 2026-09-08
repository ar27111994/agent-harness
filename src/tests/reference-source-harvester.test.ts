import { restoreEnvVar, setHttpTestFetchMocks } from "./env-test-utils.js";
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
  setHttpTestFetchMocks(true);

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
      setHttpTestFetchMocks(false);
    } else {
      restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
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

void test("reference source harvester falls back to metadata when raw content is unavailable", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  setHttpTestFetchMocks(true);

  globalThis.fetch = async () => new Response(null, { status: 404 });

  context.after(() => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      setHttpTestFetchMocks(false);
    } else {
      restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    }
  });

  const entries = await harvestReferenceSource(
    buildSource("unavailable-docs", "docs", {
      docsUrl: "https://example.com/unavailable",
    }),
    null,
    buildSelectionRegistry(),
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.source.originUrl, "https://example.com/unavailable");
  assert.equal(entries[0]?.compatibilityMode, "reference-only");
  assert.equal(entries[0]?.install.method, "docs-reference");
});

void test("buildReferenceSourceCatalogEntry uses per-extension publisherName over source-level publisher (#300)", () => {
  const selectionRegistry = buildSelectionRegistry();

  // Non-Microsoft extension: harvestedItem.publisherName should win
  const gitLensSource = buildSource("marketplace-reference", "marketplace", {
    baseUrl: "https://marketplace.visualstudio.com",
  });
  const gitLensEntry = buildReferenceSourceCatalogEntry(
    gitLensSource,
    buildDemandProfile(),
    selectionRegistry,
    {
      harvestedItem: {
        displayName: "GitLens",
        originUrl:
          "https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens",
        assetKind: "extension",
        compatibilityMode: "native",
        installMethod: "vscode-extension",
        manifestEntry: "eamodio.gitlens",
        capabilities: ["git"],
        summary: "Supercharge Git in VS Code",
        publisherName: "eamodio",
      },
    },
  );

  // publisherName from harvestedItem must override source.publisher.name ("fixture")
  assert.equal(
    gitLensEntry.source.publisher,
    "eamodio",
    "non-Microsoft extension should show its own publisher",
  );

  // Microsoft-owned extension: publisherName is "ms-python", not the marketplace owner
  const pylanceSource = buildSource("marketplace-reference", "marketplace", {
    baseUrl: "https://marketplace.visualstudio.com",
  });
  const pylanceEntry = buildReferenceSourceCatalogEntry(
    pylanceSource,
    buildDemandProfile(),
    selectionRegistry,
    {
      harvestedItem: {
        displayName: "Pylance",
        originUrl:
          "https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance",
        assetKind: "extension",
        compatibilityMode: "native",
        installMethod: "vscode-extension",
        manifestEntry: "ms-python.vscode-pylance",
        capabilities: ["python"],
        summary: "Fast, feature-rich language support for Python",
        publisherName: "ms-python",
      },
    },
  );

  assert.equal(
    pylanceEntry.source.publisher,
    "ms-python",
    "Microsoft extension should show the extension publisher, not the marketplace owner",
  );

  // No publisherName: falls back to source.publisher.name
  const noPublisherNameEntry = buildReferenceSourceCatalogEntry(
    buildSource("marketplace-reference", "marketplace", {
      baseUrl: "https://marketplace.visualstudio.com",
    }),
    buildDemandProfile(),
    selectionRegistry,
    {
      harvestedItem: {
        displayName: "Some Extension",
        originUrl: "https://marketplace.visualstudio.com/items?itemName=x.y",
        assetKind: "extension",
        compatibilityMode: "native",
        installMethod: "vscode-extension",
        manifestEntry: "x.y",
        capabilities: [],
        summary: "An extension",
        // publisherName intentionally omitted
      },
    },
  );

  // Falls back to source.publisher.name from buildSource helper ("fixture")
  assert.equal(
    noPublisherNameEntry.source.publisher,
    "fixture",
    "absent publisherName should fall back to source.publisher.name",
  );

  // No harvestedItem at all: falls back to source.publisher.name
  const noHarvestEntry = buildReferenceSourceCatalogEntry(
    buildSource("marketplace-reference", "marketplace", {
      baseUrl: "https://marketplace.visualstudio.com",
    }),
    buildDemandProfile(),
    selectionRegistry,
    { originUrl: "https://marketplace.visualstudio.com" },
  );

  assert.equal(
    noHarvestEntry.source.publisher,
    "fixture",
    "absent harvestedItem should fall back to source.publisher.name",
  );
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

void test("reference source catalog entries include evidence.classification for every entry", () => {
  const repoSource = buildSource("test-repo-source", "repo", {
    baseUrl: "https://github.com/example/repo",
  });
  const docsSource = buildSource("test-docs-source", "docs", {
    baseUrl: "https://docs.example.com",
  });

  // Entry built without harvested item (reference-only)
  const bareEntry = buildReferenceSourceCatalogEntry(
    repoSource,
    null,
    buildSelectionRegistry(),
  );
  assert.ok(
    bareEntry.evidence.classification != null,
    "bare reference entry must have classification",
  );
  assert.equal(bareEntry.evidence.classification.assetKind, "reference-pack");
  assert.ok(
    bareEntry.evidence.classification.confidence > 0,
    "confidence must be positive",
  );

  // Entry with harvested item that declares a specific assetKind
  const harvestedEntry = buildReferenceSourceCatalogEntry(
    docsSource,
    null,
    buildSelectionRegistry(),
    {
      harvestedItem: {
        displayName: "Example Skill",
        originUrl: "https://github.com/example/repo/skill.md",
        summary: "A harvested skill",
        capabilities: ["typescript", "skill"],
        assetKind: "skill",
        compatibilityMode: "adaptable",
        installMethod: "docs-summary",
        manifestEntry: "skill.md",
        lastUpdated: new Date().toISOString(),
      },
    },
  );
  assert.ok(
    harvestedEntry.evidence.classification != null,
    "harvested entry must have classification",
  );
  assert.equal(harvestedEntry.evidence.classification.assetKind, "skill");
  assert.ok(
    (harvestedEntry.evidence.classification.evidence[0]?.detail ?? "").includes(
      "docs",
    ),
    "detail should mention the source kind",
  );
});

void test("buildReferenceSourceCatalogEntry preserves item-level trustSignals (issue #3 — OMS signals)", () => {
  // Verifies that trust signals populated on the HarvestedReferenceItem
  // (e.g. "oms-signed", "oms-trust-anchor" from NVIDIA-style source packs)
  // survive the reference harvester path and appear on the catalog entry's
  // trust.signals array alongside the base authority-tier signals.
  const docsSource = buildSource("test-docs-source", "docs", {
    baseUrl: "https://docs.example.com",
  });
  const entry = buildReferenceSourceCatalogEntry(
    docsSource,
    null,
    buildSelectionRegistry(),
    {
      harvestedItem: {
        displayName: "Signed Skill",
        originUrl: "https://example.com/signed-skill.md",
        summary: "A skill with OMS signatures",
        capabilities: ["signed"],
        assetKind: "skill",
        compatibilityMode: "adaptable",
        installMethod: "docs-summary",
        trustSignals: ["oms-signed", "oms-trust-anchor"],
      },
    },
  );

  assert.ok(
    entry.trust.signals.includes("oms-signed"),
    "oms-signed must be present on trust.signals",
  );
  assert.ok(
    entry.trust.signals.includes("oms-trust-anchor"),
    "oms-trust-anchor must be present on trust.signals",
  );
});
