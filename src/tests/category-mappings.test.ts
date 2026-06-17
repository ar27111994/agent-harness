/**
 * Tests for category-mappings.ts (#291) and the popularity/category-sweep
 * tiers in the VS Code Marketplace adapter (#290).
 *
 * Validates:
 * 1. resolveVsCodeCategories maps demand tokens to VS Code categories.
 * 2. resolveVsCodeCategories deduplicates across multiple signals.
 * 3. resolveVsCodeCategories handles unknown signals gracefully (empty result).
 * 4. resolveVsCodeCategories strips well-known signal prefixes before lookup.
 * 5. VSCODE_SORT_BY and VSCODE_SORT_ORDER constants have the correct values.
 * 6. DEMAND_TO_VSCODE_CATEGORIES has broad coverage and non-empty mappings.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveVsCodeCategories,
  VSCODE_SORT_BY,
  VSCODE_SORT_ORDER,
  DEMAND_TO_VSCODE_CATEGORIES,
} from "../domains/discovery/category-mappings.js";

// ─── resolveVsCodeCategories ─────────────────────────────────────────────────

void test("resolveVsCodeCategories — maps typescript signal to correct categories", () => {
  const cats = resolveVsCodeCategories(["typescript"]);
  assert.ok(
    cats.includes("Programming Languages"),
    "should include Programming Languages",
  );
  assert.ok(cats.includes("Linters"), "should include Linters");
  assert.ok(cats.includes("Formatters"), "should include Formatters");
});

void test("resolveVsCodeCategories — deduplicates across overlapping signals", () => {
  // typescript and javascript both map to 'Programming Languages'
  const cats = resolveVsCodeCategories(["typescript", "javascript"]);
  const plCount = cats.filter((c) => c === "Programming Languages").length;
  assert.equal(plCount, 1, "Programming Languages should appear exactly once");
});

void test("resolveVsCodeCategories — returns empty for unknown signals", () => {
  const cats = resolveVsCodeCategories(["unknownsignal123"]);
  assert.equal(cats.length, 0);
});

void test("resolveVsCodeCategories — strips npm: prefix before lookup", () => {
  const cats = resolveVsCodeCategories(["npm:typescript"]);
  assert.ok(cats.length > 0, "should resolve after stripping prefix");
});

void test("resolveVsCodeCategories — strips pypi: prefix before lookup", () => {
  const cats = resolveVsCodeCategories(["pypi:python"]);
  assert.ok(cats.includes("Programming Languages"));
});

void test("resolveVsCodeCategories — handles empty input", () => {
  const cats = resolveVsCodeCategories([]);
  assert.equal(cats.length, 0);
});

void test("resolveVsCodeCategories — ai signal maps to AI and Chat", () => {
  const cats = resolveVsCodeCategories(["ai"]);
  assert.ok(cats.includes("AI"), "should include AI");
  assert.ok(cats.includes("Chat"), "should include Chat");
});

void test("resolveVsCodeCategories — testing signal maps to Testing", () => {
  const cats = resolveVsCodeCategories(["testing"]);
  assert.ok(cats.includes("Testing"));
});

// ─── Constants ───────────────────────────────────────────────────────────────

void test("VSCODE_SORT_BY.InstallCount === 4", () => {
  assert.equal(VSCODE_SORT_BY.InstallCount, 4);
});

void test("VSCODE_SORT_BY.WeeklyDownloads === 12", () => {
  assert.equal(VSCODE_SORT_BY.WeeklyDownloads, 12);
});

void test("VSCODE_SORT_ORDER.Descending === 2", () => {
  assert.equal(VSCODE_SORT_ORDER.Descending, 2);
});

void test("VSCODE_SORT_ORDER.Ascending === 1", () => {
  assert.equal(VSCODE_SORT_ORDER.Ascending, 1);
});

// ─── Map completeness ────────────────────────────────────────────────────────

void test("DEMAND_TO_VSCODE_CATEGORIES — all values are non-empty arrays", () => {
  for (const [signal, cats] of Object.entries(DEMAND_TO_VSCODE_CATEGORIES)) {
    assert.ok(
      Array.isArray(cats) && cats.length > 0,
      `${signal} should map to at least one category`,
    );
  }
});

void test("DEMAND_TO_VSCODE_CATEGORIES — has at least 10 entries", () => {
  assert.ok(
    Object.keys(DEMAND_TO_VSCODE_CATEGORIES).length >= 10,
    "category map should have broad coverage",
  );
});
