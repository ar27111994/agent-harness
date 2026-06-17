/**
 * Tests for semantic-scoring.ts (#294).
 *
 * Validates:
 * 1. cosineSimilarity returns 1.0 for identical vectors.
 * 2. cosineSimilarity returns ~0 for orthogonal vectors.
 * 3. cosineSimilarity returns 0 for zero-magnitude input.
 * 4. cosineSimilarity returns 0 for mismatched lengths.
 * 5. scoreToFitLevel maps scores to the correct fit levels.
 * 6. buildEntryEmbeddingText concatenates displayName + capabilities.
 * 7. buildDemandQueryText deduplicates and strips signal prefixes.
 * 8. SemanticScorer with embedder override filters and ranks entries.
 * 9. SemanticScorer returns null results when unavailable (no override).
 * 10. fitLevel is populated on entries that pass the similarity gate.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  cosineSimilarity,
  scoreToFitLevel,
  buildEntryEmbeddingText,
  buildDemandQueryText,
  SemanticScorer,
  FIT_LEVEL_THRESHOLDS,
  semanticScoringInternals,
} from "../domains/discovery/semantic-scoring.js";
import type { AssetCatalogEntry, DemandProfile } from "../types.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeEntry(
  overrides: Partial<AssetCatalogEntry> = {},
): AssetCatalogEntry {
  return {
    id: "test-asset",
    displayName: "Test Asset",
    assetKind: "skill",
    hosts: ["shared"],
    compatibilityMode: "native",
    source: {
      sourceId: "test-source",
      authorityTier: "unverified-community",
      sourceKind: "repo",
      sourcePriority: 60,
      originUrl: "https://github.com/test/test",
      publisher: "test",
      publisherVerified: false,
    },
    trust: { score: 50, signals: [] },
    capabilities: [],
    install: { method: "copy" },
    evidence: {
      classification: null,
      scanStats: {
        scannedFiles: 0,
        skippedFiles: 0,
        truncated: false,
        totalFiles: 0,
      },
    },
    maintenance: { status: "active" },
    risk: { level: "low", flags: [] },
    contextCost: { sizeClass: "tiny", estimatedPromptWeight: 1 },
    fit: { portfolioFit: 0.5, hostFit: 0.5 },
    dedupe: { duplicateGroup: null },
    status: { active: true, reasons: [] },
    ...overrides,
  } as AssetCatalogEntry;
}

function makeDemandProfile(signals: {
  languages?: string[];
  frameworks?: string[];
  concerns?: string[];
  tooling?: string[];
}): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "/workspace",
    signals: {
      languages: signals.languages ?? [],
      frameworks: signals.frameworks ?? [],
      concerns: signals.concerns ?? [],
      tooling: signals.tooling ?? [],
      packageManagers: [],
    },
  } as unknown as DemandProfile;
}

// ─── cosineSimilarity ────────────────────────────────────────────────────────

void test("cosineSimilarity — identical vectors return 1.0", () => {
  const v = new Float32Array([1, 2, 3, 4]);
  const result = cosineSimilarity(v, v);
  assert.ok(Math.abs(result - 1.0) < 1e-6, `expected ~1.0, got ${result}`);
});

void test("cosineSimilarity — orthogonal vectors return 0", () => {
  const a = new Float32Array([1, 0]);
  const b = new Float32Array([0, 1]);
  const result = cosineSimilarity(a, b);
  assert.ok(Math.abs(result) < 1e-6, `expected ~0, got ${result}`);
});

void test("cosineSimilarity — zero-magnitude vector returns 0", () => {
  const zero = new Float32Array([0, 0, 0]);
  const v = new Float32Array([1, 2, 3]);
  assert.equal(cosineSimilarity(zero, v), 0);
});

void test("cosineSimilarity — mismatched lengths return 0", () => {
  const a = new Float32Array([1, 2, 3]);
  const b = new Float32Array([1, 2]);
  assert.equal(cosineSimilarity(a, b), 0);
});

void test("cosineSimilarity — empty arrays return 0", () => {
  assert.equal(cosineSimilarity(new Float32Array([]), new Float32Array([])), 0);
});

void test("cosineSimilarity — antiparallel vectors return -1.0", () => {
  const a = new Float32Array([1, 0]);
  const b = new Float32Array([-1, 0]);
  const result = cosineSimilarity(a, b);
  assert.ok(Math.abs(result - -1.0) < 1e-6, `expected ~-1.0, got ${result}`);
});

// ─── scoreToFitLevel ─────────────────────────────────────────────────────────

void test("scoreToFitLevel — >= 0.75 returns strong", () => {
  assert.equal(scoreToFitLevel(0.75), "strong");
  assert.equal(scoreToFitLevel(0.9), "strong");
  assert.equal(scoreToFitLevel(1.0), "strong");
});

void test("scoreToFitLevel — >= 0.55 and < 0.75 returns moderate", () => {
  assert.equal(scoreToFitLevel(0.55), "moderate");
  assert.equal(scoreToFitLevel(0.65), "moderate");
  assert.equal(scoreToFitLevel(0.74), "moderate");
});

void test("scoreToFitLevel — >= 0.35 and < 0.55 returns weak", () => {
  assert.equal(scoreToFitLevel(0.35), "weak");
  assert.equal(scoreToFitLevel(0.45), "weak");
  assert.equal(scoreToFitLevel(0.54), "weak");
});

void test("scoreToFitLevel — < 0.35 returns none", () => {
  assert.equal(scoreToFitLevel(0.34), "none");
  assert.equal(scoreToFitLevel(0), "none");
  assert.equal(scoreToFitLevel(-0.5), "none");
});

void test("scoreToFitLevel — FIT_LEVEL_THRESHOLDS are consistent with implementation", () => {
  // The thresholds exported from the module match what scoreToFitLevel uses.
  assert.equal(scoreToFitLevel(FIT_LEVEL_THRESHOLDS.strong), "strong");
  assert.equal(scoreToFitLevel(FIT_LEVEL_THRESHOLDS.moderate), "moderate");
  assert.equal(scoreToFitLevel(FIT_LEVEL_THRESHOLDS.weak), "weak");
  assert.equal(scoreToFitLevel(FIT_LEVEL_THRESHOLDS.weak - 0.001), "none");
});

// ─── buildEntryEmbeddingText ─────────────────────────────────────────────────

void test("buildEntryEmbeddingText — includes displayName", () => {
  const entry = makeEntry({ displayName: "ESLint" });
  const text = buildEntryEmbeddingText(entry);
  assert.ok(text.includes("ESLint"));
});

void test("buildEntryEmbeddingText — includes capabilities", () => {
  const entry = makeEntry({
    displayName: "Lint Tool",
    capabilities: ["code linting", "style checking"],
  });
  const text = buildEntryEmbeddingText(entry);
  assert.ok(text.includes("code linting"));
  assert.ok(text.includes("style checking"));
});

void test("buildEntryEmbeddingText — empty entry returns empty string", () => {
  // Publisher is 'test' in the default fixture — use a fully empty override.
  const entry = makeEntry({
    displayName: "",
    capabilities: [],
    source: { ...makeEntry().source, publisher: "" },
  });
  const text = buildEntryEmbeddingText(entry);
  assert.equal(text, "");
});

// ─── buildDemandQueryText ────────────────────────────────────────────────────

void test("buildDemandQueryText — null profile returns empty string", () => {
  assert.equal(buildDemandQueryText(null), "");
});

void test("buildDemandQueryText — deduplicates signals", () => {
  const profile = makeDemandProfile({
    languages: ["typescript", "typescript"],
    frameworks: ["typescript"],
  });
  const text = buildDemandQueryText(profile);
  const count = text.split(" ").filter((t) => t === "typescript").length;
  assert.equal(count, 1, "typescript should appear exactly once after dedup");
});

void test("buildDemandQueryText — strips npm: prefix", () => {
  const profile = makeDemandProfile({ tooling: ["npm:eslint"] });
  const text = buildDemandQueryText(profile);
  assert.ok(text.includes("eslint"), "should strip npm: prefix");
  assert.ok(!text.includes("npm:"), "prefix should be removed");
});

void test("buildDemandQueryText — strips pypi: prefix", () => {
  const profile = makeDemandProfile({ languages: ["pypi:python"] });
  const text = buildDemandQueryText(profile);
  assert.ok(text.includes("python"));
  assert.ok(!text.includes("pypi:"));
});

// ─── SemanticScorer ──────────────────────────────────────────────────────────

void test("SemanticScorer — unavailable when no override and no init", () => {
  const scorer = new SemanticScorer({});
  assert.equal(scorer.available, false);
});

void test("SemanticScorer — available when embedder override provided", () => {
  const scorer = new SemanticScorer({
    embedderOverride: async () => new Float32Array([1, 0]),
  });
  assert.equal(scorer.available, true);
});

void test("SemanticScorer — filterAndRank returns null when unavailable", async () => {
  const scorer = new SemanticScorer({});
  const result = await scorer.filterAndRank([], null);
  assert.equal(result, null);
});

void test("SemanticScorer — filters entries below similarity threshold", async () => {
  // Two entries. The embedder assigns:
  //   query vec → [1, 0]
  //   entry A (webhook) → [1, 0]   cosine = 1.0 (strong, keep)
  //   entry B (unrelated) → [0, 1] cosine = 0.0 (none, reject)
  let callCount = 0;
  const scorer = new SemanticScorer({
    minSimilarity: FIT_LEVEL_THRESHOLDS.weak,
    embedderOverride: async (text: string) => {
      callCount += 1;
      if (text.startsWith("webhook") || text.startsWith("TypeScript")) {
        return new Float32Array([1, 0]);
      }
      return new Float32Array([0, 1]);
    },
  });

  const entries = [
    makeEntry({
      id: "a",
      displayName: "webhook",
      capabilities: ["webhook handler"],
    }),
    makeEntry({
      id: "b",
      displayName: "unrelated",
      capabilities: ["something else"],
    }),
  ];
  const profile = makeDemandProfile({ languages: ["TypeScript"] });

  const result = await scorer.filterAndRank(entries, profile);
  assert.ok(result !== null);
  assert.equal(result.selected.length, 1, "only webhook entry should pass");
  assert.equal(result.rejected.length, 1, "unrelated entry should be rejected");
  assert.equal(result.selected[0]?.id, "a");
  assert.equal(result.selected[0]?.fit.fitLevel, "strong");
  assert.equal(result.rejected[0]?.fit.fitLevel, "none");
  assert.ok(callCount > 0, "embedder should have been called");
});

void test("SemanticScorer — returns all entries when no demand signals", async () => {
  const scorer = new SemanticScorer({
    embedderOverride: async () => new Float32Array([1, 0]),
  });

  const entries = [makeEntry({ id: "x" }), makeEntry({ id: "y" })];
  const result = await scorer.filterAndRank(entries, null);
  assert.ok(result !== null);
  assert.equal(result.selected.length, 2, "all entries pass when no demand");
  assert.equal(result.rejected.length, 0);
});

void test("SemanticScorer — threshold is accessible via .threshold", () => {
  const scorer = new SemanticScorer({ minSimilarity: 0.5 });
  assert.equal(scorer.threshold, 0.5);
});

// ─── Internal exports round-trip ─────────────────────────────────────────────

void test("semanticScoringInternals — exports the same references as named exports", () => {
  assert.equal(semanticScoringInternals.cosineSimilarity, cosineSimilarity);
  assert.equal(semanticScoringInternals.scoreToFitLevel, scoreToFitLevel);
  assert.equal(
    semanticScoringInternals.buildEntryEmbeddingText,
    buildEntryEmbeddingText,
  );
  assert.equal(
    semanticScoringInternals.buildDemandQueryText,
    buildDemandQueryText,
  );
});
