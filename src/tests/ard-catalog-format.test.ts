import assert from "node:assert/strict";
import test from "node:test";

import { mapEntryToArd, type ArdCatalog } from "../ard-catalog.js";
import type { AssetCatalogEntry } from "../types.js";

function makeFakeEntry(
  overrides: Partial<AssetCatalogEntry> = {},
): AssetCatalogEntry {
  return {
    id: "test-source-fake-entry-001",
    displayName: "Test Skill",
    assetKind: "skill",
    hosts: ["copilot-vscode", "cursor"],
    compatibilityMode: "adaptable",
    source: {
      sourceId: "test-source",
      authorityTier: "trusted-community",
      sourceKind: "repo",
      sourcePriority: 90,
      originUrl: "https://github.com/test/test-skill",
      publisher: "Test Author",
      publisherVerified: true,
    },
    trust: { score: 85, signals: ["publisher-verified"] },
    capabilities: ["TypeScript", "testing", "linting"],
    install: {
      method: "github-tree-metadata",
      manifestEntry: "skills/test/SKILL.md",
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
    },
    maintenance: {
      lastUpdated: "2026-01-01T00:00:00Z",
      stars: 1,
      releaseCadence: "active",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: { sizeClass: "tiny", estimatedPromptWeight: 1 },
    fit: { portfolioFit: 0.8, hostFit: 0.8 },
    dedupe: { candidateRankHint: "fixture" },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
    ...overrides,
  };
}

function buildCatalog(entries: AssetCatalogEntry[]): ArdCatalog {
  return {
    specVersion: "1.0",
    host: {
      displayName: "Agent Harness",
      identifier: "https://ar27111994.dev",
    },
    entries: entries.map((entry) =>
      mapEntryToArd(entry, "ar27111994.dev", "2.1.0"),
    ),
  };
}

void test("ARD 1.0 catalog JSON passes project Prettier formatting", async () => {
  const catalog = buildCatalog([makeFakeEntry()]);
  const rawJson = `${JSON.stringify(catalog, null, 2)}\n`;
  const prettier = await import("prettier");
  const formatted = await prettier.format(rawJson, {
    parser: "json",
    endOfLine: "lf",
    trailingComma: "all",
  });

  const parsed = JSON.parse(formatted) as ArdCatalog;
  assert.equal(parsed.specVersion, "1.0");
  assert.equal(parsed.host?.displayName, "Agent Harness");
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0]?.version, "2.1.0");
  assert.deepEqual(JSON.parse(rawJson), JSON.parse(formatted));
});

void test("ARD 1.0 output remains valid JSON without Prettier", () => {
  const rawJson = `${JSON.stringify(buildCatalog([makeFakeEntry()]), null, 2)}\n`;
  const parsed = JSON.parse(rawJson) as ArdCatalog;
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.specVersion, "1.0");
});

void test("ARD catalog formatting is idempotent", async () => {
  const catalog = buildCatalog([
    makeFakeEntry({ id: "entry-001", displayName: "Alpha" }),
    makeFakeEntry({ id: "entry-002", displayName: "Beta" }),
  ]);
  const prettier = await import("prettier");
  const options = {
    parser: "json" as const,
    endOfLine: "lf" as const,
    trailingComma: "all" as const,
  };
  const formatted = await prettier.format(
    `${JSON.stringify(catalog, null, 2)}\n`,
    options,
  );
  assert.equal(formatted, await prettier.format(formatted, options));
});
