/**
 * Tests for `computeEcosystemMismatchPenalty` (#278, review extension).
 *
 * Validates that:
 * 1. A 2× penalty is applied for a total mismatch (workspace has PM/language
 *    signals, none match the registry's ecosystem).
 * 2. No penalty is applied when the workspace has no PM/language signals.
 * 3. No penalty is applied when the registry matches the workspace's PM.
 * 4. No penalty is applied for ecosystem-agnostic non-package-registry source
 *    kinds, and a 2× penalty for non-package-registry sources published under
 *    an unambiguous source-family language the workspace does not use (e.g.
 *    an official-index:WordPress skill in a TypeScript workspace, review).
 * 5. `computeAssetEcosystemCompat` extends the same contract to the
 *    exact-stack eligibility gate.
 * 6. At report level: packagist entries do NOT appear in the top 20 for an
 *    npm/TypeScript workspace even when their names overlap keyword tokens.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { candidatesInternals } from "../recommend/candidates.js";
import { loadRecommendationPolicy } from "../recommend/policy.js";
import { buildRecommendationReport } from "../recommend/report.js";
import type { AssetCatalogEntry, DemandProfile } from "../types.js";

const {
  computeEcosystemMismatchPenalty,
  computeAssetEcosystemCompat,
  KNOWN_SOURCE_FAMILY_LANGUAGES,
} = candidatesInternals;

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

function createDemandContextWithManagers(
  ...packageManagers: string[]
): Parameters<typeof computeEcosystemMismatchPenalty>[1] {
  return {
    terms: [],
    hasSignals: packageManagers.length > 0,
    activeDomainGroups: new Set(),
    packageManifestEntries: new Set(),
    packageIdentityByTerm: new Map(),
    demandKeywords: new Set(),
    packageManagers: new Set(packageManagers),
  };
}

function createDemandLanguages(...languages: string[]): ReadonlySet<string> {
  return new Set(languages);
}

function createPackageRegistryEntry(sourceId: string): AssetCatalogEntry {
  return createEntry(sourceId, "package-registry");
}

function createRepoEntry(sourceId: string): AssetCatalogEntry {
  return createEntry(sourceId, "repo");
}

function createEntry(
  sourceId: string,
  sourceKind: AssetCatalogEntry["source"]["sourceKind"],
): AssetCatalogEntry {
  return {
    id: `${sourceId}-asset`,
    displayName: `${sourceId} asset`,
    assetKind: "skill",
    hosts: ["shared"],
    compatibilityMode: "native",
    source: {
      sourceId,
      authorityTier: "unverified-community",
      sourceKind,
      sourcePriority: 60,
      originUrl: `https://example.com/${sourceId}`,
      publisher: sourceId,
      publisherVerified: false,
    },
    trust: { score: 20, signals: [] },
    capabilities: ["eslint", "jest", "node", "lint", "test"],
    install: { method: "fixture", nativeHosts: ["shared"] },
    evidence: {
      manifestFound: true,
      readmeFound: false,
      examplesFound: false,
      docsLinked: false,
    },
    maintenance: {
      lastUpdated: new Date().toISOString(),
      stars: 10,
      releaseCadence: "active",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: { sizeClass: "small", estimatedPromptWeight: 1 },
    fit: { portfolioFit: 0.3, hostFit: 0.3 },
    dedupe: { candidateRankHint: "fixture" },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Unit tests for computeEcosystemMismatchPenalty
// ---------------------------------------------------------------------------

void test("ecosystem penalty: total mismatch (npm workspace + packagist entry) returns 2× penalty", () => {
  const entry = createPackageRegistryEntry("packagist-registry");
  const context = createDemandContextWithManagers("npm");
  const penalty = computeEcosystemMismatchPenalty(
    entry,
    context,
    createDemandLanguages(),
    40,
  );
  assert.equal(penalty, 80, "total mismatch must return 2× the base penalty");
});

void test("ecosystem penalty: no PM signals → 0 penalty (conservative, new workspace)", () => {
  const entry = createPackageRegistryEntry("packagist-registry");
  const context = createDemandContextWithManagers(); // empty
  const penalty = computeEcosystemMismatchPenalty(
    entry,
    context,
    createDemandLanguages(),
    40,
  );
  assert.equal(
    penalty,
    0,
    "must not penalise when workspace has no PM signals",
  );
});

void test("ecosystem penalty: ecosystem matches → 0 penalty", () => {
  const entry = createPackageRegistryEntry("npm-registry");
  const context = createDemandContextWithManagers("npm");
  const penalty = computeEcosystemMismatchPenalty(
    entry,
    context,
    createDemandLanguages(),
    40,
  );
  assert.equal(
    penalty,
    0,
    "must not penalise when registry ecosystem matches workspace",
  );
});

void test("ecosystem penalty: non-package-registry source kind → 0 penalty", () => {
  const entry = createRepoEntry("packagist-registry");
  const context = createDemandContextWithManagers("npm");
  const penalty = computeEcosystemMismatchPenalty(
    entry,
    context,
    createDemandLanguages(),
    40,
  );
  assert.equal(
    penalty,
    0,
    "must not penalise repo/docs sources regardless of sourceId",
  );
});

void test("ecosystem penalty: unknown sourceId (no map match) → 0 penalty", () => {
  const entry = createPackageRegistryEntry("custom-private-registry");
  const context = createDemandContextWithManagers("npm");
  const penalty = computeEcosystemMismatchPenalty(
    entry,
    context,
    createDemandLanguages(),
    40,
  );
  assert.equal(penalty, 0, "must not penalise unmapped sourceIds");
});

void test("ecosystem penalty: pypi mismatch in npm workspace → 2× penalty", () => {
  const entry = createPackageRegistryEntry("pypi-registry");
  const context = createDemandContextWithManagers("npm");
  const penalty = computeEcosystemMismatchPenalty(
    entry,
    context,
    createDemandLanguages(),
    40,
  );
  assert.equal(penalty, 80, "pypi in npm workspace must return 2× penalty");
});

void test("ecosystem penalty: crates mismatch in npm workspace → 2× penalty", () => {
  const entry = createPackageRegistryEntry("crates-io-registry");
  const context = createDemandContextWithManagers("npm");
  const penalty = computeEcosystemMismatchPenalty(
    entry,
    context,
    createDemandLanguages(),
    40,
  );
  assert.equal(
    penalty,
    80,
    "cargo/crates in npm workspace must return 2× penalty",
  );
});

void test("ecosystem penalty: mixed workspace (npm + composer) → 0 penalty for packagist", () => {
  const entry = createPackageRegistryEntry("packagist-registry");
  const context = createDemandContextWithManagers("npm", "composer");
  const penalty = computeEcosystemMismatchPenalty(
    entry,
    context,
    createDemandLanguages(),
    40,
  );
  assert.equal(
    penalty,
    0,
    "must not penalise packagist when workspace explicitly uses composer",
  );
});

void test("ecosystem penalty: pip workspace → 0 penalty for pypi", () => {
  const entry = createPackageRegistryEntry("pypi-registry");
  const context = createDemandContextWithManagers("pip");
  const penalty = computeEcosystemMismatchPenalty(
    entry,
    context,
    createDemandLanguages(),
    40,
  );
  assert.equal(penalty, 0, "must not penalise pypi when workspace uses pip");
});

// ─── review: source-family language dimension (official-index etc.) ─────────

void test("ecosystem penalty: official-index:WordPress skill in a TypeScript workspace → 2× penalty", () => {
  const entry = createEntry("official-index:WordPress", "docs");
  entry.source.publisher = "WordPress";
  const context = createDemandContextWithManagers("npm");
  const penalty = computeEcosystemMismatchPenalty(
    entry,
    context,
    createDemandLanguages("typescript", "javascript"),
    40,
  );
  assert.equal(
    penalty,
    80,
    "a WordPress-family skill in a TS/JS workspace must be a total ecosystem mismatch",
  );
});

void test("ecosystem penalty: official-index:WordPress skill in a PHP workspace → 0 penalty", () => {
  const entry = createEntry("official-index:WordPress", "docs");
  entry.source.publisher = "WordPress";
  const context = createDemandContextWithManagers("composer");
  const penalty = computeEcosystemMismatchPenalty(
    entry,
    context,
    createDemandLanguages("php"),
    40,
  );
  assert.equal(
    penalty,
    0,
    "a WordPress-family skill in a PHP workspace matches",
  );
});

void test("ecosystem penalty: language-only mismatch (no PM signals, PHP workspace) → 2× penalty", () => {
  const entry = createEntry("official-index:WordPress", "docs");
  entry.source.publisher = "WordPress";
  const context = createDemandContextWithManagers(); // no PM signals
  const penalty = computeEcosystemMismatchPenalty(
    entry,
    context,
    createDemandLanguages("typescript"),
    40,
  );
  assert.equal(
    penalty,
    80,
    "language evidence alone is enough to detect the mismatch (review)",
  );
});

void test("ecosystem compat: WordPress skill is not exact-stack compatible with a TS workspace (review)", () => {
  const entry = createEntry("official-index:WordPress", "docs");
  entry.source.publisher = "WordPress";
  const context = createDemandContextWithManagers("npm");
  assert.equal(
    computeAssetEcosystemCompat(
      entry,
      context,
      createDemandLanguages("typescript"),
    ),
    false,
    "WordPress-family skill must fail the exact-stack ecosystem gate in a TS workspace",
  );
  assert.equal(
    computeAssetEcosystemCompat(entry, context, createDemandLanguages("php")),
    true,
    "WordPress-family skill passes the gate in a PHP workspace",
  );
});

void test("ecosystem compat: ecosystem-agnostic official-index sources stay compatible (review)", () => {
  const entry = createEntry("official-index:duckdb", "docs");
  entry.source.publisher = "duckdb";
  const context = createDemandContextWithManagers("npm");
  assert.equal(
    computeAssetEcosystemCompat(
      entry,
      context,
      createDemandLanguages("typescript"),
    ),
    true,
    "unmapped official-index families remain ecosystem-agnostic",
  );
  assert.equal(KNOWN_SOURCE_FAMILY_LANGUAGES.get("wordpress"), "php");
});

// ─── review: package-manager families ≡ ecosystem languages (composer ↔ php) ─

void test("ecosystem penalty: composer-only workspace (no php language signal) → 0 penalty for php-family skill", () => {
  const entry = createEntry("official-index:WordPress", "docs");
  entry.source.publisher = "WordPress";
  const context = createDemandContextWithManagers("composer");
  const penalty = computeEcosystemMismatchPenalty(
    entry,
    context,
    createDemandLanguages(), // no php language signal — composer implies php
    40,
  );
  assert.equal(
    penalty,
    0,
    "a composer declaration must be equivalent to a php language signal for php-family sources",
  );
});

void test("ecosystem compat: composer-only workspace passes the gate for a php-family skill (review)", () => {
  const entry = createEntry("official-index:WordPress", "docs");
  entry.source.publisher = "WordPress";
  const context = createDemandContextWithManagers("composer");
  assert.equal(
    computeAssetEcosystemCompat(entry, context, createDemandLanguages()),
    true,
    "composer-only demand must not deny exact-stack for php-family assets",
  );
});

void test("ecosystem penalty: php-language-only workspace → 0 penalty for packagist registry (review)", () => {
  const entry = createPackageRegistryEntry("packagist-registry");
  const context = createDemandContextWithManagers(); // no PM signal
  const penalty = computeEcosystemMismatchPenalty(
    entry,
    context,
    createDemandLanguages("php"),
    40,
  );
  assert.equal(
    penalty,
    0,
    "a php language signal must be equivalent to a composer declaration for packagist entries",
  );
});

void test("ecosystem compat: language-only matches the registry of that language's ecosystem (review)", () => {
  const packagist = createPackageRegistryEntry("packagist-registry");
  const npm = createPackageRegistryEntry("npm-registry");
  const context = createDemandContextWithManagers(); // no PM signals
  assert.equal(
    computeAssetEcosystemCompat(
      packagist,
      context,
      createDemandLanguages("php"),
    ),
    true,
    "php-language-only demand must pass the gate for composer-family registries",
  );
  assert.equal(
    computeAssetEcosystemCompat(
      npm,
      context,
      createDemandLanguages("javascript"),
    ),
    true,
    "javascript-language-only demand must pass the gate for the npm registry",
  );
});

void test("ecosystem equivalence never erases a REAL mismatch: composer workspace + npm-registry entry still penalized (review)", () => {
  const entry = createPackageRegistryEntry("npm-registry");
  const context = createDemandContextWithManagers("composer");
  assert.equal(
    computeEcosystemMismatchPenalty(
      entry,
      context,
      createDemandLanguages(),
      40,
    ),
    80,
    "composer ↔ php equivalence must not make npm-registry entries compatible",
  );
  assert.equal(
    computeAssetEcosystemCompat(entry, context, createDemandLanguages()),
    false,
    "composer-only demand must still deny exact-stack for npm-registry assets",
  );
});

// ---------------------------------------------------------------------------
// Integration test: report-level ranking confirms packagist entries are
// suppressed below npm entries for an npm/TypeScript workspace
// ---------------------------------------------------------------------------

void test("ecosystem penalty: packagist entries do not appear in top 20 for npm/TypeScript workspace", async () => {
  clearRuntimeConfigForTests();
  const policy = await loadRecommendationPolicy(process.cwd());

  // Build a demand profile matching a TypeScript/npm workspace with tooling
  // keywords that appear in PHP Packagist package names
  const demandProfile = createNpmDemandProfile();

  // Create 10 packagist entries with strong keyword overlap
  const packagistEntries: AssetCatalogEntry[] = Array.from(
    { length: 10 },
    (_, i) => ({
      ...createPackageRegistryEntry("packagist-registry"),
      id: `packagist-eslint-wrapper-${i}`,
      displayName: `PHP eslint-wrapper-${i}`,
      capabilities: ["eslint", "lint", "node", "jest", "typescript", "test"],
    }),
  );

  // Create 5 npm entries with the same keyword overlap
  const npmEntries: AssetCatalogEntry[] = Array.from({ length: 5 }, (_, i) => ({
    ...createEntry("npm-registry", "package-registry"),
    id: `npm-eslint-plugin-${i}`,
    displayName: `npm eslint-plugin-${i}`,
    capabilities: ["eslint", "lint", "node", "jest", "typescript"],
  }));

  const report = buildRecommendationReport(
    [...packagistEntries, ...npmEntries],
    demandProfile,
    policy,
    undefined,
  );

  // Assert across all per-host top lists
  for (const [host, recs] of Object.entries(report.topByHost)) {
    const top20Ids = recs.slice(0, 20).map((r) => r.assetId);
    const packagistInTop20 = top20Ids.filter((id) =>
      id.startsWith("packagist-eslint-wrapper-"),
    );
    assert.equal(
      packagistInTop20.length,
      0,
      `host ${host}: packagist PHP entries must not appear in top 20 for an npm workspace (got: ${packagistInTop20.join(", ")})`,
    );
  }

  // And verify npm entries rank in the flat recommendations list
  const hasNpmEntries = report.recommendations.some((r) =>
    r.assetId.startsWith("npm-eslint-plugin-"),
  );
  assert.ok(
    hasNpmEntries,
    "npm eslint entries should appear in the global recommendations list",
  );
});

// ---------------------------------------------------------------------------
// Demand profile helper
// ---------------------------------------------------------------------------

function createNpmDemandProfile(): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "fixtures/workspace",
    summary: { scannedFiles: 5, matchedFiles: 3 },
    signals: {
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: [],
      concerns: [],
      tooling: ["eslint", "jest"],
    },
    evidence: [
      {
        path: "package.json",
        fileName: "package.json",
        matchedSignals: {
          languages: ["typescript"],
          packageManagers: ["npm"],
          frameworks: [],
          concerns: [],
          tooling: ["eslint", "jest"],
        },
      },
    ],
  };
}
