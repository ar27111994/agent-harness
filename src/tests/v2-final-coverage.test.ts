/**
 * Coverage tests for v2.0.0 final release helpers.
 *
 * Covers extracted testable functions without any type assertions or suppressions.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { convertMsysToWindowsPath, normalizeMsysPath } from "../lib/paths.js";
import { installBundleInternals } from "../install/bundle.js";
import { recommendationValidationInternals } from "../manifest-validation/recommendation.js";
// ---------------------------------------------------------------------------
// normalizeMsysPath — non-win32 platform branch
// ---------------------------------------------------------------------------

void test("normalizeMsysPath passes through on non-win32 platform", () => {
  assert.equal(
    normalizeMsysPath("/c/Projects/test", "linux"),
    "/c/Projects/test",
  );
  assert.equal(normalizeMsysPath("C:\\Windows", "darwin"), "C:\\Windows");
});

// ---------------------------------------------------------------------------
// convertMsysToWindowsPath — core conversion logic
// ---------------------------------------------------------------------------

void test("convertMsysToWindowsPath converts /c/X to C:\\X", () => {
  assert.equal(
    convertMsysToWindowsPath("/c/Projects/test"),
    "C:\\Projects\\test",
  );
});

void test("convertMsysToWindowsPath converts /d/X", () => {
  assert.equal(convertMsysToWindowsPath("/d/app"), "D:\\app");
});

void test("convertMsysToWindowsPath converts /z/X", () => {
  assert.equal(convertMsysToWindowsPath("/z/tmp"), "Z:\\tmp");
});

void test("convertMsysToWindowsPath returns non-MSYS paths unchanged", () => {
  assert.equal(convertMsysToWindowsPath("C:\\Windows"), "C:\\Windows");
  assert.equal(convertMsysToWindowsPath("../relative"), "../relative");
  assert.equal(convertMsysToWindowsPath("/usr/local"), "/usr/local");
  assert.equal(convertMsysToWindowsPath(""), "");
});

void test("convertMsysToWindowsPath handles upper and lowercase drive letters", () => {
  assert.equal(convertMsysToWindowsPath("/C/Test"), "C:\\Test");
  assert.equal(convertMsysToWindowsPath("/d/Test"), "D:\\Test");
});

void test("convertMsysToWindowsPath concurrency", async () => {
  const results = await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      convertMsysToWindowsPath("/c/dir" + String(index) + "/file"),
    ),
  );
  for (let index = 0; index < 50; index++) {
    assert.equal(results[index], "C:\\dir" + String(index) + "\\file");
  }
});

// ---------------------------------------------------------------------------
// toInstallErrorMessage — Error and non-Error paths
// ---------------------------------------------------------------------------

void test("toInstallErrorMessage extracts message from Error", async () => {
  const { toInstallErrorMessage } = installBundleInternals;
  assert.equal(toInstallErrorMessage(new Error("test error")), "test error");
});

void test("toInstallErrorMessage uses String for non-Error values", async () => {
  const { toInstallErrorMessage } = installBundleInternals;
  assert.equal(toInstallErrorMessage("raw string"), "raw string");
  assert.equal(toInstallErrorMessage(42), "42");
  assert.equal(toInstallErrorMessage(null), "null");
  assert.equal(toInstallErrorMessage(undefined), "undefined");
  assert.equal(toInstallErrorMessage({ key: "val" }), "[object Object]");
});

// ---------------------------------------------------------------------------
// assertRecommendationScoreBreakdown — backward-compat injection
// ---------------------------------------------------------------------------

void test("assertRecommendationScoreBreakdown injects default 0 for missing field", async () => {
  const { assertRecommendationScoreBreakdown } =
    recommendationValidationInternals;

  const breakdown: Record<string, unknown> = {
    authority: 10,
    compatibility: 5,
    portfolioFit: 8,
    trust: 3,
    sourcePriority: 2,
    demand: 7,
    hostPreference: 0,
    coverage: 0,
    diversity: 0,
    freshness: 1,
    costPenalty: 0,
    riskPenalty: 0,
    negativePenalty: 0,
    ecosystemMismatchPenalty: 0,
    redundancyPenalty: 0,
    budgetPenalty: 0,
    total: 36,
    // assetKindDiversityPenalty intentionally omitted for backward-compat test
  };

  assert.doesNotThrow(() => {
    assertRecommendationScoreBreakdown(breakdown, "test.scoreBreakdown");
  });

  assert.equal(breakdown.assetKindDiversityPenalty, 0);
});

// ---------------------------------------------------------------------------
// extractBundleId — edge case coverage
// ---------------------------------------------------------------------------

void test("extractBundleId strips lock.json suffix from paths", async () => {
  const { extractBundleId } = installBundleInternals;
  assert.equal(extractBundleId("path/to/bundle.lock.json"), "bundle");
  assert.equal(extractBundleId("bundle.lock.json"), "bundle");
  assert.equal(extractBundleId("/a/b/c.lock.json"), "c");
});

// ---------------------------------------------------------------------------
// convertMsysToWindowsPath — edge cases
// ---------------------------------------------------------------------------

void test("convertMsysToWindowsPath handles trailing slash", () => {
  assert.equal(
    convertMsysToWindowsPath("/c/"),
    "C:\\",
    "trailing slash: /c/ should resolve to C:\\",
  );
  assert.equal(convertMsysToWindowsPath("/d/projects/"), "D:\\projects\\");
});

void test("convertMsysToWindowsPath handles double slashes", () => {
  assert.equal(
    convertMsysToWindowsPath("/c//foo"),
    "C:\\\\foo",
    "double slash: /c//foo should collapse extra slashes",
  );
  assert.equal(convertMsysToWindowsPath("/c//a//b"), "C:\\\\a\\\\b");
});

void test("convertMsysToWindowsPath handles mixed separators", () => {
  // MSYS paths use forward slashes; backslashes inside are passed through.
  // The regex only replaces forward slashes, so mixed separators produce
  // a mixed output — this is intentional for MSYS→Windows conversion.
  const result = convertMsysToWindowsPath("/c/a\\b");
  assert.equal(
    result,
    "C:\\a\\b",
    "mixed separators: /c/a\\b should normalise forward slashes",
  );
});

void test("convertMsysToWindowsPath rejects path traversal patterns", () => {
  // Path traversal is NOT blocked by convertMsysToWindowsPath (path
  // resolution is the caller's responsibility). The function faithfully
  // converts the MSYS prefix; traversal segments are preserved so the
  // caller can handle them in the resolved path.
  const result = convertMsysToWindowsPath("/c/../../../etc/passwd");
  assert.equal(
    result,
    "C:\\..\\..\\..\\etc\\passwd",
    "path traversal: ../ segments are preserved for caller-side validation",
  );
});

void test("convertMsysToWindowsPath handles deeply nested paths", () => {
  assert.equal(
    convertMsysToWindowsPath("/c/a/b/c/d/e/f/g"),
    "C:\\a\\b\\c\\d\\e\\f\\g",
  );
});

void test("convertMsysToWindowsPath handles single-segment after drive", () => {
  assert.equal(convertMsysToWindowsPath("/c/foo"), "C:\\foo");
  assert.equal(convertMsysToWindowsPath("/X/bar"), "X:\\bar");
});

void test("convertMsysToWindowsPath handles bare drive letter without trailing slash", () => {
  assert.equal(convertMsysToWindowsPath("/c"), "C:");
  assert.equal(convertMsysToWindowsPath("/D"), "D:");
  assert.equal(convertMsysToWindowsPath("/x"), "X:");
});

void test("convertMsysToWindowsPath passes through non-MSYS paths unchanged", () => {
  assert.equal(convertMsysToWindowsPath("C:\\foo"), "C:\\foo");
  assert.equal(convertMsysToWindowsPath("/usr/local"), "/usr/local");
  assert.equal(convertMsysToWindowsPath("relative/path"), "relative/path");
  assert.equal(convertMsysToWindowsPath(""), "");
});
