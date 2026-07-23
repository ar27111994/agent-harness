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

void test("buildEntryEmbeddingText — uses representativeQueries as primary text when present", () => {
  const entry = makeEntry({
    displayName: "ESLint",
    capabilities: ["code linting"],
    representativeQueries: [
      "What is the best linter for TypeScript?",
      "Find a tool for static analysis in React projects",
    ],
  });
  const text = buildEntryEmbeddingText(entry);
  // representativeQueries take priority over displayName + capabilities
  assert.ok(text.includes("What is the best linter for TypeScript?"));
  assert.ok(text.includes("Find a tool for static analysis"));
  // displayName and capabilities should be excluded when representativeQueries present
  assert.ok(
    !text.includes("code linting"),
    "capabilities excluded when queries present",
  );
});

void test("buildEntryEmbeddingText — falls back to capabilities when representativeQueries is empty array", () => {
  const entry = makeEntry({
    displayName: "ESLint",
    capabilities: ["code linting"],
    representativeQueries: [],
  });
  const text = buildEntryEmbeddingText(entry);
  assert.ok(text.includes("ESLint"));
  assert.ok(text.includes("code linting"));
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

// ─── Additional coverage for uncovered paths ────────────────────────────────

void test("SemanticScorer — embed returns null when embedder throws", async () => {
  const scorer = new SemanticScorer({
    embedderOverride: async () => {
      throw new Error("embed failure");
    },
  });
  assert.equal(scorer.available, true, "scorer is available (has embedder)");
  const result = await scorer.embed("some text");
  assert.equal(result, null, "embed returns null when embedder throws");
});

void test("SemanticScorer — filterAndRank returns null when embed returns null (embedder throws on call)", async () => {
  // Scorer has an override but it throws on every call — embed() returns null,
  // so queryVec is null and filterAndRank returns null.
  const scorer = new SemanticScorer({
    minSimilarity: 0.3,
    embedderOverride: async () => {
      throw new Error("embed unavailable");
    },
  });
  const entries = [makeEntry({ id: "x" })];
  const profile = makeDemandProfile({ languages: ["TypeScript"] });
  const result = await scorer.filterAndRank(entries, profile);
  assert.equal(
    result,
    null,
    "filterAndRank returns null when embed cannot produce a query vector",
  );
});

void test("SemanticScorer — filterAndRank sorts selected entries by fitLevel descending", async () => {
  // Three entries with different similarity to the query:
  //   entry-strong  → cosine ≈ 1.0  (strong)
  //   entry-moderate → cosine ≈ 0.6 (moderate)
  //   entry-weak     → cosine ≈ 0.4 (weak)
  // All three exceed the threshold — sort order should be strong > moderate > weak.
  const scorer = new SemanticScorer({
    minSimilarity: 0.3, // all three should be selected
    embedderOverride: async (text: string) => {
      if (text.includes("query")) return new Float32Array([1, 0, 0, 0]);
      if (text.includes("strong")) return new Float32Array([1, 0, 0, 0]); // cosine 1.0
      if (text.includes("moderate")) {
        // cosine ~0.6 with [1,0,0,0]
        return new Float32Array([0.6, 0.8, 0, 0]);
      }
      // weak: cosine ~0.4 with [1,0,0,0]
      return new Float32Array([0.4, 0.9165, 0, 0]);
    },
  });

  const entries = [
    makeEntry({
      id: "entry-weak",
      displayName: "weak",
      capabilities: [],
    }),
    makeEntry({
      id: "entry-moderate",
      displayName: "moderate",
      capabilities: [],
    }),
    makeEntry({
      id: "entry-strong",
      displayName: "strong",
      capabilities: [],
    }),
  ];
  const profile = makeDemandProfile({ languages: ["query"] });
  const result = await scorer.filterAndRank(entries, profile);
  assert.ok(result !== null, "result must not be null");
  assert.equal(result.rejected.length, 0, "all entries should be selected");
  assert.equal(result.selected.length, 3, "three entries selected");
  // Sort order: strong first
  assert.equal(
    result.selected[0]?.fit.fitLevel,
    "strong",
    "first selected entry should be strong",
  );
});

void test("SemanticScorer — scoreEntry returns null for entry with no embeddable text", async () => {
  // An entry whose embed fails (throws) causes scoreEntry to return null,
  // triggering the conservative pass-through path (lines 274-277).
  // We need: query embed succeeds, entry embed fails.
  const scorer = new SemanticScorer({
    minSimilarity: 0.3,
    embedderOverride: async (text: string) => {
      // query text contains "TypeScript" (from demand signals)
      if (text.includes("TypeScript")) {
        return new Float32Array([1, 0]);
      }
      // entry embed fails
      throw new Error("entry embed failed");
    },
  });
  const entry = makeEntry({ displayName: "some-tool", capabilities: [] });
  const profile = makeDemandProfile({ languages: ["TypeScript"] });
  const result = await scorer.filterAndRank([entry], profile);
  // When scoreEntry returns null, the entry is kept (conservative pass-through)
  assert.ok(result !== null, "result must not be null");
  assert.equal(
    result.selected.length,
    1,
    "entry kept when scoring fails (conservative)",
  );
});

void test("SemanticScorer — tryInit gracefully handles absent @xenova/transformers (sets available=false)", async () => {
  // This test relies on @xenova/transformers not being installed in the test
  // environment. The SemanticScorer uses a dynamic import that must throw a
  // MODULE_NOT_FOUND (or equivalent) error so tryInit() marks the scorer
  // unavailable. If @xenova/transformers were ever added as a dev dependency
  // this test would need to be refactored to inject a failing loader instead.
  const scorer = new SemanticScorer({});
  assert.equal(scorer.available, false, "unavailable before tryInit");
  await scorer.tryInit(); // should not throw
  assert.equal(
    scorer.available,
    false,
    "still unavailable after tryInit when package absent",
  );
});

void test("SemanticScorer — tryInit is a no-op when embedder is already initialised (line 181-182)", async () => {
  // A scorer initialised with an embedderOverride already has this.embedder set.
  // Calling tryInit() again must hit the early-return guard without throwing.
  const scorer = new SemanticScorer({
    embedderOverride: async () => new Float32Array([1, 0]),
  });
  assert.equal(scorer.available, true, "scorer is available (has embedder)");
  // Second call must return without error — the early-return branch is hit.
  await scorer.tryInit();
  assert.equal(
    scorer.available,
    true,
    "still available after redundant tryInit",
  );
});

void test("SemanticScorer — embed returns null when embedder is absent (line 214 true branch)", async () => {
  // A scorer with no override and no tryInit — embedder is null.
  // Calling embed() directly exercises the !this.embedder early-return guard.
  const scorer = new SemanticScorer({});
  assert.equal(scorer.available, false, "scorer is unavailable");
  const result = await scorer.embed("some text");
  assert.equal(result, null, "embed returns null when embedder is absent");
});

void test("SemanticScorer — scoreEntry returns null for entry with empty embedding text (line 232 true branch)", async () => {
  // An entry with no displayName, no capabilities, no publisher produces an
  // empty buildEntryEmbeddingText result, exercising the !text early-return.
  const scorer = new SemanticScorer({
    embedderOverride: async () => new Float32Array([1, 0]),
  });
  const emptyEntry = makeEntry({
    displayName: "",
    capabilities: [],
    source: { ...makeEntry().source, publisher: "" },
  });
  const queryVec = new Float32Array([1, 0]);
  const result = await scorer.scoreEntry(emptyEntry, queryVec);
  assert.equal(
    result,
    null,
    "scoreEntry returns null when entry text is empty",
  );
});

void test("SemanticScorer — scoreEntry applies 1.2× weight for entries with representativeQueries (#327)", async () => {
  const queryVec = new Float32Array([1, 0]);
  const entryVec = new Float32Array([0.6, 0.8]); // cos = 0.6
  const withoutQueries = makeEntry({
    displayName: "normal entry",
    capabilities: ["testing"],
  });
  const withQueries = makeEntry({
    displayName: "ard entry",
    capabilities: ["testing"],
    representativeQueries: [
      "What is the best testing tool?",
      "Find testing frameworks for TypeScript",
    ],
  });

  const scorer = new SemanticScorer({
    embedderOverride: async () => {
      // Entry with representativeQueries gets different embedding text,
      // but same vector — we want to test the weight, not the text diff.
      return entryVec;
    },
  });

  const resultWithout = await scorer.scoreEntry(withoutQueries, queryVec);
  const resultWith = await scorer.scoreEntry(withQueries, queryVec);

  assert.ok(resultWithout !== null);
  assert.ok(resultWith !== null);

  const rawCosine = 0.6;
  assert.ok(
    Math.abs(resultWithout.score - rawCosine) < 0.01,
    "entry without representativeQueries gets unweighted score",
  );
  assert.ok(
    Math.abs(resultWith.score - rawCosine * 1.2) < 0.01,
    "entry with representativeQueries gets 1.2× weighted score (#327)",
  );
});

void test("SemanticScorer — filterAndRank sorts same-bucket entries by score descending (sort tiebreaker)", async () => {
  // Two entries that will both land in the "moderate" fitLevel bucket
  // (cosine score ≥ 0.5 and < 0.75). The entry with the higher score must
  // appear first — this exercises the `b.score - a.score` secondary sort key,
  // which only fires when bucketDiff === 0 (same fitLevel bucket).
  //
  // FIT_LEVEL_THRESHOLDS: strong ≥ 0.75, moderate ≥ 0.5, weak ≥ 0.35.
  // We pin query=[1,0] and use distinct entry vectors:
  //   highEntry: [0.65, 0.76] → cos ≈ 0.65 → "moderate" (0.55–0.75)
  //   lowEntry:  [0.58, 0.81] → cos ≈ 0.58 → "moderate" (0.55–0.75)
  // Both are "moderate" but highEntry has higher cosine score vs. the query.
  //
  // Embedding call order inside filterAndRank:
  //   1. embed(queryText) → queryVec = [1, 0]
  //   2. embed("high score entry …") → highVec
  //   3. embed("low score entry …") → lowVec
  const queryVec = new Float32Array([1, 0]);
  const highVec = new Float32Array([0.65, 0.76]);
  const lowVec = new Float32Array([0.58, 0.81]);

  let callCount = 0;
  const scorer = new SemanticScorer({
    embedderOverride: async () => {
      callCount += 1;
      if (callCount === 1) return queryVec; // query embed
      if (callCount === 2) return highVec; // first entry embed
      return lowVec; // second entry embed
    },
    minSimilarity: 0.35,
  });

  const highEntry = makeEntry({ displayName: "high score entry" });
  const lowEntry = makeEntry({ displayName: "low score entry" });

  const profile = makeDemandProfile({ languages: ["TypeScript"] });
  const result = await scorer.filterAndRank([highEntry, lowEntry], profile);

  assert.ok(result !== null, "filterAndRank must return a result");
  // Both entries must be in the selected set (both above minSimilarity = 0.35).
  assert.equal(
    result.selected.length,
    2,
    "both moderate-bucket entries selected",
  );
  // The higher-scoring entry must come first within the same fitLevel bucket.
  assert.equal(
    result.selected[0]?.displayName,
    "high score entry",
    "higher-score entry ranked first within the same fitLevel bucket",
  );
});
