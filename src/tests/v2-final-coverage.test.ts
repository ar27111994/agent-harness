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
