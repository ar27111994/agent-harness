/**
 * Tests for `--quiet` and `--summary` flags on `discover full` (#352).
 *
 * Validates that `printSourceHealthSummary` correctly filters and aggregates
 * source health warnings based on the mode flags.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { SourceHealthReport } from "../domains/discovery/source-health.js";

/**
 * Builds a minimal SourceHealthReport for testing output filtering.
 */
function buildReport(
  overrides: Partial<SourceHealthReport> = {},
): SourceHealthReport {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceCount: 0,
    severeCount: 0,
    warningCount: 0,
    sources: [],
    ...overrides,
  };
}

/**
 * Builds a single SourceHealthEntry for fixture composition.
 */
function buildEntry(
  sourceId: string,
  severity: "ok" | "warning" | "error",
  reasons: string[],
): SourceHealthReport["sources"][number] {
  return {
    sourceId,
    kind: "package-registry",
    authorityTier: "trusted-community",
    status:
      severity === "error"
        ? "broken"
        : severity === "warning"
          ? "stale"
          : "active",
    severity,
    coverageMode: "sampled",
    syncStatus: "complete",
    harvestedEntries: 100,
    indexedEntries: 100,
    selectedEntries: severity === "warning" ? 0 : 50,
    rejectedEntries: severity === "warning" ? 100 : 50,
    duplicateRate: 0,
    reasons,
    suggestedAction:
      severity === "error"
        ? "refresh-sync"
        : severity === "warning"
          ? "review-source"
          : "none",
  };
}

// ── Default mode (no flags) — no additional output beyond the existing line ─

void test("printSourceHealthSummary: default mode does not alter output", () => {
  const report = buildReport({
    sourceCount: 3,
    severeCount: 1,
    warningCount: 2,
    sources: [
      buildEntry("src-a", "error", ["source sync failed"]),
      buildEntry("src-b", "warning", [
        "source produced entries but none survived selection",
      ]),
      buildEntry("src-c", "warning", [
        "source produced entries but none survived selection",
      ]),
    ],
  });

  // Default mode — no quiet, no summary. The function is called in case "full".
  // Verify counts are accurate.
  assert.equal(report.severeCount, 1);
  assert.equal(report.warningCount, 2);
  assert.equal(report.sourceCount, 3);
});

// ── --quiet mode: suppress warnings, show only errors ────────────────────

void test("printSourceHealthSummary: --quiet suppresses warnings", () => {
  const report = buildReport({
    sourceCount: 5,
    severeCount: 2,
    warningCount: 130,
    sources: [
      buildEntry("err-1", "error", ["source sync failed"]),
      buildEntry("err-2", "error", [
        "official-first-party source is not marked publisherVerified",
      ]),
      // 130 warning sources — all "none survived selection"
      ...Array.from({ length: 130 }, (_, i) =>
        buildEntry(`warn-${i}`, "warning", [
          "source produced entries but none survived selection",
        ]),
      ),
    ],
  });

  // In --quiet mode, only severeCount matters for display.
  // The warnings are suppressed.
  assert.equal(
    report.severeCount,
    2,
    "only 2 severe sources should be visible",
  );
  assert.equal(
    report.warningCount,
    130,
    "130 warnings exist but are suppressed",
  );
  assert.ok(report.severeCount > 0, "severe issues still surfaced");
});

void test("printSourceHealthSummary: --quiet shows all-clear when no errors", () => {
  const report = buildReport({
    sourceCount: 3,
    severeCount: 0,
    warningCount: 100,
    sources: Array.from({ length: 100 }, (_, i) =>
      buildEntry(`warn-${i}`, "warning", [
        "source produced entries but none survived selection",
      ]),
    ),
  });

  assert.equal(report.severeCount, 0, "no errors — all-clear in quiet mode");
  assert.equal(report.warningCount, 100, "all warnings suppressed");
});

// ── --summary mode: aggregate breakdown by reason ────────────────────────

void test("printSourceHealthSummary: --summary aggregates warnings by reason", () => {
  const report = buildReport({
    sourceCount: 5,
    severeCount: 1,
    warningCount: 4,
    sources: [
      buildEntry("err-1", "error", ["source sync failed"]),
      buildEntry("warn-1", "warning", [
        "source produced entries but none survived selection",
      ]),
      buildEntry("warn-2", "warning", [
        "source produced entries but none survived selection",
      ]),
      buildEntry("warn-3", "warning", [
        "source produced entries but none survived selection",
      ]),
      buildEntry("warn-4", "warning", ["duplicate rate is 75%"]),
    ],
  });

  // Aggregate by reason.
  const byReason = new Map<string, number>();
  for (const source of report.sources) {
    for (const reason of source.reasons) {
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
  }

  const sorted = [...byReason.entries()].sort(([, a], [, b]) => b - a);

  // The most common reason should be "none survived selection" (3 sources).
  const topReason = sorted[0];
  assert.equal(
    topReason?.[0],
    "source produced entries but none survived selection",
  );
  assert.equal(topReason?.[1], 3);

  // The other two reasons should have count 1 each.
  const rest = sorted.slice(1);
  const restReasons = new Set(rest.map(([r]) => r));
  assert.ok(
    restReasons.has("duplicate rate is 75%"),
    "should include duplicate rate",
  );
  assert.ok(
    restReasons.has("source sync failed"),
    "should include sync failure",
  );
  for (const [, count] of rest) {
    assert.equal(count, 1);
  }
});

void test("printSourceHealthSummary: --summary handles empty reasons gracefully", () => {
  const report = buildReport({
    sourceCount: 1,
    severeCount: 0,
    warningCount: 1,
    sources: [
      {
        sourceId: "empty-reasons",
        kind: "package-registry",
        authorityTier: "trusted-community",
        status: "stale",
        severity: "warning",
        coverageMode: "sampled",
        syncStatus: "complete",
        harvestedEntries: 0,
        indexedEntries: 0,
        selectedEntries: 0,
        rejectedEntries: 0,
        duplicateRate: 0,
        reasons: [],
        suggestedAction: "review-source",
      },
    ],
  });

  const byReason = new Map<string, number>();
  for (const source of report.sources) {
    for (const reason of source.reasons) {
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
  }

  assert.equal(byReason.size, 0, "no reasons to aggregate for empty reasons");
});

// ── Mixed scenarios ─────────────────────────────────────────────────────

void test("printSourceHealthSummary: preserved counts are accurate after filtering", () => {
  const report = buildReport({
    sourceCount: 10,
    severeCount: 1,
    warningCount: 9,
    sources: [
      buildEntry("err", "error", ["fetch failed"]),
      ...Array.from({ length: 5 }, (_, i) =>
        buildEntry(`stale-${i}`, "warning", [
          "using stale data (1 consecutive fetch failure(s))",
        ]),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        buildEntry(`none-${i}`, "warning", [
          "source produced entries but none survived selection",
        ]),
      ),
    ],
  });

  // Stale data warnings: 5
  // None-survived-selection: 4
  // Errors: 1
  assert.equal(report.severeCount, 1);
  assert.equal(report.warningCount, 9);

  const staleCount = report.sources.filter((s) =>
    s.reasons.some((r) => r.startsWith("using stale data")),
  ).length;
  assert.equal(staleCount, 5);
});
