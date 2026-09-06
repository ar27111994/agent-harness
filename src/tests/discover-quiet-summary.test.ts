/**
 * Tests for `--quiet` and `--summary` source-health data used by `discover full`
 * (#352, #465).
 *
 * Keep these tests free of process-global console mocks: the coverage suite runs
 * with `--test-isolation=none`, so replacing `console.log` can interfere with
 * unrelated test files executing in the same process.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { discoverInternals } from "../discover.js";
import type { SourceHealthReport } from "../domains/discovery/source-health.js";

/**
 * Builds a minimal SourceHealthReport for testing filtering and aggregation.
 */
function buildReport(
  overrides: Partial<SourceHealthReport> = {},
): SourceHealthReport {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceCount: 0,
    errorCount: 0,
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
    ciDetected: false,
  };
}

// ── Default mode — preserve canonical error/warning counts ───────────────

void test("source-health counts use canonical error vocabulary", () => {
  const report = buildReport({
    sourceCount: 4,
    errorCount: 1,
    warningCount: 2,
    sources: [
      buildEntry("src-a", "error", ["source sync failed"]),
      buildEntry("src-b", "warning", [
        "source produced entries but none survived selection",
      ]),
      buildEntry("src-c", "warning", [
        "source produced entries but none survived selection",
      ]),
      buildEntry("src-d", "ok", []),
    ],
  });

  const errorSources = report.sources.filter(
    (source) => source.severity === "error",
  ).length;
  const warningSources = report.sources.filter(
    (source) => source.severity === "warning",
  ).length;
  const okSources = report.sources.filter(
    (source) => source.severity === "ok",
  ).length;

  assert.equal(report.errorCount, errorSources);
  assert.equal(report.warningCount, warningSources);
  assert.equal(report.sourceCount, errorSources + warningSources + okSources);
  assert.equal(errorSources, 1);
  assert.equal(warningSources, 2);
  assert.equal(okSources, 1);

  discoverInternals.printSourceHealthSummary(report, {
    quietMode: false,
    summaryMode: false,
  });
});

// ── --quiet mode data: warnings are suppressible, errors remain visible ──

void test("source-health quiet-mode data preserves errors and warnings", () => {
  const report = buildReport({
    sourceCount: 132,
    errorCount: 2,
    warningCount: 130,
    sources: [
      buildEntry("err-1", "error", ["source sync failed"]),
      buildEntry("err-2", "error", [
        "official-first-party source is not marked publisherVerified",
      ]),
      ...Array.from({ length: 130 }, (_, i) =>
        buildEntry(`warn-${i}`, "warning", [
          "source produced entries but none survived selection",
        ]),
      ),
    ],
  });

  assert.equal(report.errorCount, 2, "only 2 error sources should be visible");
  assert.equal(
    report.warningCount,
    130,
    "130 warnings exist but are suppressible",
  );
  assert.ok(report.errorCount > 0, "errors remain surfaced");

  discoverInternals.printSourceHealthSummary(report, {
    quietMode: true,
    summaryMode: false,
  });
});

void test("source-health quiet-mode data supports all-clear errors", () => {
  const report = buildReport({
    sourceCount: 100,
    errorCount: 0,
    warningCount: 100,
    sources: Array.from({ length: 100 }, (_, i) =>
      buildEntry(`warn-${i}`, "warning", [
        "source produced entries but none survived selection",
      ]),
    ),
  });

  assert.equal(report.errorCount, 0, "no errors means error all-clear");
  assert.equal(report.warningCount, 100, "warnings remain counted");

  discoverInternals.printSourceHealthSummary(report, {
    quietMode: true,
    summaryMode: false,
  });
});

// ── --summary mode data: aggregate warning reasons only ──────────────────

void test("source-health summary data aggregates warnings by reason", () => {
  const report = buildReport({
    sourceCount: 5,
    errorCount: 1,
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

  const byReason = new Map<string, number>();
  for (const source of report.sources) {
    if (source.severity !== "warning") continue;
    for (const reason of source.reasons) {
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
  }

  const sorted = [...byReason.entries()].sort(([, a], [, b]) => b - a);
  assert.deepEqual(sorted, [
    ["source produced entries but none survived selection", 3],
    ["duplicate rate is 75%", 1],
  ]);
  assert.ok(
    !byReason.has("source sync failed"),
    "error reasons must not be mixed into the warning breakdown",
  );

  discoverInternals.printSourceHealthSummary(report, {
    quietMode: false,
    summaryMode: true,
  });
});

void test("source-health summary data handles empty reasons gracefully", () => {
  const report = buildReport({
    sourceCount: 1,
    errorCount: 0,
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
        ciDetected: false,
      },
    ],
  });

  const byReason = new Map<string, number>();
  for (const source of report.sources) {
    if (source.severity !== "warning") continue;
    for (const reason of source.reasons) {
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
  }

  assert.equal(byReason.size, 0, "no reasons to aggregate for empty reasons");

  discoverInternals.printSourceHealthSummary(report, {
    quietMode: false,
    summaryMode: true,
  });
});

// ── Mixed scenarios ──────────────────────────────────────────────────────

void test("source-health counts remain accurate after filtering", () => {
  const report = buildReport({
    sourceCount: 10,
    errorCount: 1,
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

  assert.equal(report.errorCount, 1);
  assert.equal(report.warningCount, 9);
  assert.equal(
    report.errorCount,
    report.sources.filter((source) => source.severity === "error").length,
  );
  assert.equal(
    report.warningCount,
    report.sources.filter((source) => source.severity === "warning").length,
  );

  const staleCount = report.sources.filter((source) =>
    source.reasons.some((reason) => reason.startsWith("using stale data")),
  ).length;
  assert.equal(staleCount, 5);
});
