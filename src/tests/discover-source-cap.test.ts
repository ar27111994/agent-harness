/**
 * Tests for `applyPerSourceCap` and `computeSourceDiversityWarning` (#304).
 *
 * Validates that:
 * 1. A dominant source (5000 entries) is capped to the max; excess are
 *    returned in `capped` so callers can log them as "source-cap" rejections.
 * 2. A well-diversified set under the cap passes through unchanged with no
 *    diversity warning.
 * 3. The env-var override (`AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE`) is parsed
 *    correctly and respected by `parseSelectionPositiveIntegerEnv`.
 * 4. `sourceDiversityWarning` is returned when any source > 20% of the kept
 *    set, and is absent when all sources ≤ 20%.
 * 5. Both helpers handle edge cases: empty input, single-entry input, and
 *    cap = 1.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { discoverInternals } from "../discover.js";
import type { AssetCatalogEntry } from "../types.js";

const {
  applyPerSourceCap,
  computeSourceDiversityWarning,
  parseSelectionPositiveIntegerEnv,
} = discoverInternals;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeEntry(sourceId: string, index: number): AssetCatalogEntry {
  const id = `${sourceId}-entry-${index}`;
  return {
    id,
    displayName: `${sourceId} entry ${index}`,
    assetKind: "tool",
    hosts: ["shared"],
    compatibilityMode: "native",
    source: {
      sourceId,
      sourceKind: "repo",
      registryKind: undefined,
      publisherName: undefined,
      category: undefined,
    },
    score: 1,
    demand: 0,
    authority: 0,
    popularity: 0,
    freshness: 0,
    security: 0,
    compatibility: 0,
    tokens: [],
    ecosystems: [],
    tags: [],
    platforms: [],
    languageSupport: [],
    description: "",
    descriptionTokens: [],
    harvestTimestamp: 0,
    kind: "tool",
  } as unknown as AssetCatalogEntry;
}

function makeEntries(sourceId: string, count: number): AssetCatalogEntry[] {
  return Array.from({ length: count }, (_, i) => makeEntry(sourceId, i));
}

// ---------------------------------------------------------------------------
// applyPerSourceCap — core cap behaviour
// ---------------------------------------------------------------------------

void test("applyPerSourceCap: dominant source capped, excess in capped list", () => {
  const bigSource = makeEntries("source-A", 5000);
  const smallSource = makeEntries("source-B", 100);
  const entries = [...bigSource, ...smallSource];

  const { kept, capped } = applyPerSourceCap(entries, 200);

  // source-A must contribute at most 200
  const keptFromA = kept.filter((e) => e.source.sourceId === "source-A");
  const keptFromB = kept.filter((e) => e.source.sourceId === "source-B");
  assert.equal(
    keptFromA.length,
    200,
    "source-A kept count should equal the cap",
  );
  assert.equal(
    keptFromB.length,
    100,
    "source-B should be entirely kept (under cap)",
  );
  assert.equal(
    kept.length,
    300,
    "total kept = 200 (source-A) + 100 (source-B)",
  );
  assert.equal(capped.length, 4800, "4800 source-A entries should be capped");
  // capped entries must all be from source-A
  for (const { assetId } of capped) {
    assert.ok(
      assetId.startsWith("source-A-"),
      "all capped entries belong to source-A",
    );
  }
});

void test("applyPerSourceCap: well-diversified set passes through unchanged", () => {
  // 3 sources × 50 entries each — all well under a cap of 200
  const entries = [
    ...makeEntries("source-A", 50),
    ...makeEntries("source-B", 50),
    ...makeEntries("source-C", 50),
  ];

  const { kept, capped } = applyPerSourceCap(entries, 200);

  assert.equal(kept.length, 150, "all 150 entries kept");
  assert.equal(capped.length, 0, "no entries capped");
});

void test("applyPerSourceCap: cap = 1 keeps exactly one entry per source", () => {
  const entries = [
    ...makeEntries("source-A", 10),
    ...makeEntries("source-B", 10),
  ];

  const { kept, capped } = applyPerSourceCap(entries, 1);

  assert.equal(kept.length, 2, "one per source = 2 total kept");
  assert.equal(capped.length, 18, "18 entries capped");
});

void test("applyPerSourceCap: empty input returns empty kept and capped", () => {
  const { kept, capped } = applyPerSourceCap([], 200);
  assert.equal(kept.length, 0);
  assert.equal(capped.length, 0);
});

// ---------------------------------------------------------------------------
// applyPerSourceCap — insertion-order preserved
// ---------------------------------------------------------------------------

void test("applyPerSourceCap: kept entries preserve insertion order", () => {
  const entries = [
    makeEntry("A", 0),
    makeEntry("B", 0),
    makeEntry("A", 1),
    makeEntry("B", 1),
    makeEntry("A", 2), // capped at maxPerSource=2
  ];

  const { kept, capped } = applyPerSourceCap(entries, 2);

  assert.deepEqual(
    kept.map((e) => e.id),
    ["A-entry-0", "B-entry-0", "A-entry-1", "B-entry-1"],
  );
  assert.deepEqual(
    capped.map((e) => e.assetId),
    ["A-entry-2"],
  );
});

// ---------------------------------------------------------------------------
// computeSourceDiversityWarning
// ---------------------------------------------------------------------------

void test("computeSourceDiversityWarning: returns warning when source > 20%", () => {
  // 300 total: 201 from A (67%), 99 from B — A exceeds 20% threshold
  const entries = [
    ...makeEntries("source-A", 201),
    ...makeEntries("source-B", 99),
  ];

  const warning = computeSourceDiversityWarning(entries, 200);

  assert.ok(warning !== undefined, "warning should be returned");
  assert.ok(
    warning.includes("source-A"),
    "warning references the dominant source ID",
  );
  assert.ok(warning.includes("67%"), "warning includes the percentage");
  assert.ok(warning.includes("201/300"), "warning includes count/total");
  assert.ok(
    warning.includes("200"),
    "warning references the current cap value",
  );
});

void test("computeSourceDiversityWarning: absent when all sources ≤ 20%", () => {
  // 5 sources × 20 entries = 100 total, each at exactly 20% — not > 20%
  const entries = [
    ...makeEntries("src-A", 20),
    ...makeEntries("src-B", 20),
    ...makeEntries("src-C", 20),
    ...makeEntries("src-D", 20),
    ...makeEntries("src-E", 20),
  ];

  const warning = computeSourceDiversityWarning(entries, 200);

  assert.equal(
    warning,
    undefined,
    "no warning when every source is exactly at the 20% boundary",
  );
});

void test("computeSourceDiversityWarning: absent for well-diversified set", () => {
  // 3 sources × 10 entries: each is 33% — below the 20% threshold per
  // source is impossible here. Actually with 3 sources at equal weight, each
  // is 33% which IS > 20%. Use 6 equal sources so each is 16.6% ≤ 20%.
  const entries = [
    ...makeEntries("s-A", 10),
    ...makeEntries("s-B", 10),
    ...makeEntries("s-C", 10),
    ...makeEntries("s-D", 10),
    ...makeEntries("s-E", 10),
    ...makeEntries("s-F", 10),
  ];
  // Each source = 10/60 ≈ 16.7%, which is ≤ 20%
  const warning = computeSourceDiversityWarning(entries, 200);
  assert.equal(warning, undefined, "no warning when no source exceeds 20%");
});

void test("computeSourceDiversityWarning: returns undefined for empty input", () => {
  assert.equal(computeSourceDiversityWarning([], 200), undefined);
});

// ---------------------------------------------------------------------------
// parseSelectionPositiveIntegerEnv — env-var parsing
// ---------------------------------------------------------------------------

void test("parseSelectionPositiveIntegerEnv: valid value parsed correctly", () => {
  assert.equal(parseSelectionPositiveIntegerEnv("10", 200), 10);
  assert.equal(parseSelectionPositiveIntegerEnv("1", 200), 1);
  assert.equal(parseSelectionPositiveIntegerEnv("500", 200), 500);
});

void test("parseSelectionPositiveIntegerEnv: falls back for missing / empty / invalid", () => {
  assert.equal(parseSelectionPositiveIntegerEnv(undefined, 200), 200);
  assert.equal(parseSelectionPositiveIntegerEnv("", 200), 200);
  assert.equal(parseSelectionPositiveIntegerEnv("   ", 200), 200);
  assert.equal(parseSelectionPositiveIntegerEnv("0", 200), 200);
  assert.equal(parseSelectionPositiveIntegerEnv("-5", 200), 200);
  assert.equal(parseSelectionPositiveIntegerEnv("abc", 200), 200);
  assert.equal(parseSelectionPositiveIntegerEnv("1.5", 200), 200);
});
