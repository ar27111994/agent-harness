/**
 * Tests for `applyPerSourceCap` and `computeSourceDiversityWarning` (#304).
 *
 * Validates that:
 * 1. A dominant source (5000 entries) is capped to the max; excess are
 *    returned in `capped` so callers can log them as "source-cap" rejections.
 * 2. A well-diversified set under the cap passes through unchanged with no
 *    diversity warning.
 * 3. The env-var override (`AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE`) is parsed
 *    and surfaced via `getRuntimeConfig().discovery.maxEntriesPerSource`.
 * 4. `sourceDiversityWarning` is returned when any source > 20% of the kept
 *    set, and is absent when all sources ≤ 20%.
 * 5. Both helpers handle edge cases: empty input, single-entry input, and
 *    cap = 1.
 * 6. `computeAcceptanceRate` (#353) returns correct fractions.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { computeAcceptanceRate } from "../discover-pipeline.js";
import { restoreEnvVar } from "./env-test-utils.js";
import {
  applyRelevanceFilter,
  printDiscoveryBreadthSummary,
  type RelevanceScorer,
} from "../discover-pipeline.js";
import { discoverInternals } from "../discover.js";
import { getRuntimeConfig, clearRuntimeConfig } from "../config/runtime.js";
import type {
  AssetCatalogEntry,
  DemandProfile,
  SelectionReport,
  SourceDefinition,
  SourceIndex,
} from "../types.js";
import type { SourceSyncState } from "../domains/discovery/source-sync.js";

const {
  applyPerSourceCap,
  computeSourceDiversityWarning,
  computeDemandRelevantSourceIds,
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
    capabilities: [],
    install: { relativePath: `packages/${id}/install` },
    evidence: {
      manifestFound: false,
      readmeFound: false,
      examplesFound: false,
      docsLinked: false,
      filePath: `packages/${id}/manifest.json`,
    },
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
  // 6 equal sources so each is 16.7% ≤ 20%.
  const entries = [
    ...makeEntries("s-A", 10),
    ...makeEntries("s-B", 10),
    ...makeEntries("s-C", 10),
    ...makeEntries("s-D", 10),
    ...makeEntries("s-E", 10),
    ...makeEntries("s-F", 10),
  ];
  const warning = computeSourceDiversityWarning(entries, 200);
  assert.equal(warning, undefined, "no warning when no source exceeds 20%");
});

void test("computeSourceDiversityWarning: returns undefined for empty input", () => {
  assert.equal(computeSourceDiversityWarning([], 200), undefined);
});

// ---------------------------------------------------------------------------
// AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE — runtime config env-var parsing
// ---------------------------------------------------------------------------

void test("AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE: valid value surfaced by getRuntimeConfig", () => {
  process.env.AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE = "50";
  clearRuntimeConfig();
  try {
    assert.equal(getRuntimeConfig().discovery.maxEntriesPerSource, 50);
  } finally {
    delete process.env.AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE;
    clearRuntimeConfig();
  }
});

void test("AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE: falls back to default 200 when unset", () => {
  delete process.env.AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE;
  clearRuntimeConfig();
  try {
    assert.equal(getRuntimeConfig().discovery.maxEntriesPerSource, 200);
  } finally {
    clearRuntimeConfig();
  }
});

void test("AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE: 0 means unlimited (non-negative integer)", () => {
  process.env.AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE = "0";
  clearRuntimeConfig();
  try {
    assert.equal(getRuntimeConfig().discovery.maxEntriesPerSource, 0);
  } finally {
    delete process.env.AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE;
    clearRuntimeConfig();
  }
});

// ── computeAcceptanceRate (#353) ─────────────────────────────────────────

void test("computeAcceptanceRate: returns 0 when inputCount is 0", () => {
  assert.equal(computeAcceptanceRate(0, 0), 0);
});

void test("computeAcceptanceRate: returns 0 when nothing selected", () => {
  assert.equal(computeAcceptanceRate(100, 0), 0);
});

void test("computeAcceptanceRate: returns 1 when everything selected", () => {
  assert.equal(computeAcceptanceRate(100, 100), 1);
});

void test("computeAcceptanceRate: computes fraction rounded to 4 decimal places", () => {
  assert.equal(computeAcceptanceRate(100, 37), 0.37);
  assert.equal(computeAcceptanceRate(100, 3), 0.03);
  // 800 / 20438 ≈ 0.039143 → rounded to 0.0391
  assert.equal(computeAcceptanceRate(20438, 800), 0.0391);
  // 1 / 3 ≈ 0.3333... → rounded to 0.3333
  assert.equal(computeAcceptanceRate(3, 1), 0.3333);
});

// ---------------------------------------------------------------------------
// computeDemandRelevantSourceIds tests (#419)
// ---------------------------------------------------------------------------

function createDemandProfile(
  overrides: Partial<DemandProfile["signals"]>,
): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "/test/workspace",
    summary: { scannedFiles: 10, matchedFiles: 5 },
    signals: {
      languages: [],
      packageManagers: [],
      frameworks: [],
      concerns: [],
      tooling: [],
      ...overrides,
    },
    evidence: [],
  };
}

void test("computeDemandRelevantSourceIds: returns universal sources for empty demand", () => {
  const dp = createDemandProfile({});
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("mcp-registry"), true);
  assert.equal(ids.has("skills-sh"), true);
  assert.equal(ids.has("ui-skills"), true);
  assert.equal(ids.has("clawhub"), true);
  assert.equal(ids.has("local-antigravity-manifest"), true);
});

void test("computeDemandRelevantSourceIds: adds npm for TypeScript projects", () => {
  const dp = createDemandProfile({ languages: ["TypeScript", "JavaScript"] });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("npm-registry"), true);
  assert.equal(ids.has("cargo-registry"), false);
});

void test("computeDemandRelevantSourceIds: adds cargo for Rust projects", () => {
  const dp = createDemandProfile({ languages: ["Rust"] });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("cargo-registry"), true);
  assert.equal(ids.has("npm-registry"), false);
});

void test("computeDemandRelevantSourceIds: adds pypi for Python projects", () => {
  const dp = createDemandProfile({ languages: ["Python"] });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("pypi-registry"), true);
});

void test("computeDemandRelevantSourceIds: detects ecosystem from frameworks and package managers", () => {
  const dp = createDemandProfile({
    languages: [],
    frameworks: ["react"],
    packageManagers: ["npm"],
    tooling: ["vscode"],
  });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("npm-registry"), true);
  assert.equal(ids.has("vscode-marketplace"), true);
});

void test("computeDemandRelevantSourceIds: adds vscode-marketplace for VS Code detectors", () => {
  const dp = createDemandProfile({ tooling: ["detector:codepilot"] });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("vscode-marketplace"), true);
});

void test("computeDemandRelevantSourceIds: adds cursor-marketplace for Cursor detectors", () => {
  const dp = createDemandProfile({ tooling: ["detector:cursor"] });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("cursor-marketplace"), true);
});

void test("computeDemandRelevantSourceIds: adds pi-packages for Pi detectors", () => {
  const dp = createDemandProfile({ tooling: ["detector:pi"] });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("pi-packages"), true);
});

void test("computeDemandRelevantSourceIds: adds zed-extension-registry for Zed detectors", () => {
  const dp = createDemandProfile({ tooling: ["detector:zed"] });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("zed-extension-registry"), true);
});

void test("computeDemandRelevantSourceIds: adds npm for pnpm package manager", () => {
  const dp = createDemandProfile({ packageManagers: ["pnpm"] });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("npm-registry"), true);
});

void test("computeDemandRelevantSourceIds: adds npm for bun runtime", () => {
  const dp = createDemandProfile({ packageManagers: ["bun"] });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("npm-registry"), true);
});

void test("computeDemandRelevantSourceIds: adds npm for yarn package manager", () => {
  const dp = createDemandProfile({ packageManagers: ["yarn"] });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("npm-registry"), true);
});

void test("computeDemandRelevantSourceIds: adds pub-dev for Dart/Flutter projects", () => {
  const dp = createDemandProfile({
    languages: ["Dart"],
    frameworks: ["flutter"],
  });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("pub-dev-registry"), true);
});

void test("computeDemandRelevantSourceIds: adds pypi for uv package manager", () => {
  const dp = createDemandProfile({ packageManagers: ["uv"] });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("pypi-registry"), true);
});

void test("computeDemandRelevantSourceIds: adds maven for Scala sbt projects", () => {
  const dp = createDemandProfile({
    languages: ["scala"],
    frameworks: [],
    packageManagers: ["sbt"],
  });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("maven-registry"), true);
});

// ---------------------------------------------------------------------------
// computeDemandRelevantSourceIds — edge cases & security (#419)
// ---------------------------------------------------------------------------

void test("computeDemandRelevantSourceIds: all ecosystems simultaneously returns all registries", () => {
  const dp = createDemandProfile({
    languages: [
      "TypeScript",
      "Python",
      "Rust",
      "Java",
      "C#",
      "Go",
      "PHP",
      "Ruby",
      "Swift",
      "Dart",
    ],
    frameworks: ["flutter"],
    packageManagers: [
      "npm",
      "pip",
      "cargo",
      "maven",
      "nuget",
      "composer",
      "bundler",
    ],
    tooling: ["vscode", "cursor", "detector:pi", "detector:zed"],
  });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("npm-registry"), true);
  assert.equal(ids.has("pypi-registry"), true);
  assert.equal(ids.has("cargo-registry"), true);
  assert.equal(ids.has("maven-registry"), true);
  assert.equal(ids.has("nuget-registry"), true);
  assert.equal(ids.has("go-registry"), true);
  assert.equal(ids.has("packagist-registry"), true);
  assert.equal(ids.has("rubygems-registry"), true);
  assert.equal(ids.has("swift-package-index"), true);
  assert.equal(ids.has("vscode-marketplace"), true);
  assert.equal(ids.has("cursor-marketplace"), true);
  assert.equal(ids.has("pi-packages"), true);
  assert.equal(ids.has("zed-extension-registry"), true);
  // Also expect universal sources
  assert.equal(ids.has("mcp-registry"), true);
  assert.equal(ids.has("skills-sh"), true);
  assert.equal(ids.has("local-antigravity-manifest"), true);
});

void test("computeDemandRelevantSourceIds: handles very long framework/tooling names without crash", () => {
  const longName = "a".repeat(10_000);
  const dp = createDemandProfile({
    languages: [longName],
    frameworks: [longName],
    packageManagers: [longName],
    tooling: [longName],
  });
  // Should not throw — just return universal sources since no term matches
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("mcp-registry"), true);
  assert.equal(ids.has("local-antigravity-manifest"), true);
});

void test("computeDemandRelevantSourceIds: handles special characters in signal names safely", () => {
  const dp = createDemandProfile({
    languages: ["<script>alert(1)</script>"],
    frameworks: ["'; DROP TABLE sources;--"],
    packageManagers: ["${PATH}"],
    tooling: ["detector:$(whoami)"],
  });
  // Should not throw — signal strings are opaque lookup keys, never evaluated
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("mcp-registry"), true);
  // Injection strings shouldn't accidentally match any source ID
  assert.equal(ids.has("npm-registry"), false);
  assert.equal(ids.has("pypi-registry"), false);
});

void test("computeDemandRelevantSourceIds: handles unicode/surrogate pairs in language names", () => {
  const dp = createDemandProfile({
    languages: ["Rust🚀", "TypeScript\u0000test"],
    frameworks: ["react\0embedded"],
  });
  // Should not throw — Set lookups will just not match
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("mcp-registry"), true);
});

void test("computeDemandRelevantSourceIds: handles concerns with pi-agent matching", () => {
  const dp = createDemandProfile({
    concerns: ["PI-agent", "pi-SKILL"],
  });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("pi-packages"), true);
});

void test("computeDemandRelevantSourceIds: handles empty string signals gracefully", () => {
  const dp = createDemandProfile({
    languages: [""],
    frameworks: [""],
    packageManagers: [""],
  });
  const ids = computeDemandRelevantSourceIds(dp);
  // Empty strings shouldn't match any ecosystem
  assert.equal(ids.has("npm-registry"), false);
  assert.equal(ids.has("mcp-registry"), true); // universal
});

void test("computeDemandRelevantSourceIds: handles whitespace-only signals", () => {
  const dp = createDemandProfile({
    languages: ["  "],
    frameworks: ["\t"],
    packageManagers: ["\n"],
  });
  const ids = computeDemandRelevantSourceIds(dp);
  // Whitespace shouldn't match any ecosystem
  assert.equal(ids.has("npm-registry"), false);
});

void test("computeDemandRelevantSourceIds: handles F# language", () => {
  const dp = createDemandProfile({ languages: ["F#"] });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("nuget-registry"), true);
});

void test("computeDemandRelevantSourceIds: handles Elixir language", () => {
  const dp = createDemandProfile({ languages: ["Elixir"] });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("hex-registry"), true);
  assert.equal(ids.has("mcp-registry"), true);
  assert.equal(ids.has("npm-registry"), false);
});

void test("computeDemandRelevantSourceIds: handles C++ language", () => {
  const dp = createDemandProfile({ languages: ["C++"] });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("conan-registry"), true);
  assert.equal(ids.has("mcp-registry"), true);
});

void test("computeDemandRelevantSourceIds: conan and meson ecosystem terms gate conan-registry", () => {
  // conanfile.txt / conanfile.py / meson.build detection emits the conan and
  // meson tooling/package-manager signals; the source gate must surface
  // conan-registry from those terms alone (previously dead code paths).
  const conanDp = createDemandProfile({ packageManagers: ["conan"] });
  const conanIds = computeDemandRelevantSourceIds(conanDp);
  assert.equal(conanIds.has("conan-registry"), true);

  const conanToolingDp = createDemandProfile({ tooling: ["conan"] });
  const conanToolingIds = computeDemandRelevantSourceIds(conanToolingDp);
  assert.equal(conanToolingIds.has("conan-registry"), true);

  const mesonDp = createDemandProfile({ tooling: ["meson"] });
  const mesonIds = computeDemandRelevantSourceIds(mesonDp);
  assert.equal(mesonIds.has("conan-registry"), true);

  const cmakeDp = createDemandProfile({ tooling: ["cmake"] });
  const cmakeIds = computeDemandRelevantSourceIds(cmakeDp);
  assert.equal(cmakeIds.has("conan-registry"), true);
});

void test("computeDemandRelevantSourceIds: handles Erlang language", () => {
  const dp = createDemandProfile({ languages: ["Erlang"] });
  const ids = computeDemandRelevantSourceIds(dp);
  assert.equal(ids.has("hex-registry"), true);
  assert.equal(ids.has("mcp-registry"), true);
});

// ---------------------------------------------------------------------------
// shouldShowFirstRunSyncHint (#439)
// ---------------------------------------------------------------------------

function emptySyncState(): SourceSyncState {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources: [],
  };
}

void test("shouldShowFirstRunSyncHint: shows on first run with many sources regardless of skipped-source conditions", () => {
  assert.equal(
    discoverInternals.shouldShowFirstRunSyncHint(
      emptySyncState(),
      12,
      false,
      false,
      false,
    ),
    true,
    "hint appears without any skipped-source condition",
  );
});

void test("shouldShowFirstRunSyncHint: null prior state is a live first-run path", () => {
  // loadSourceSyncState never returns null (zeroed fallback), but the
  // function's contract accepts null and the first-run hint must appear
  // for it — the null arm is exercised directly (#428 follow-up).
  assert.equal(
    discoverInternals.shouldShowFirstRunSyncHint(null, 12, false, false, false),
    true,
    "null prior state shows the first-run hint",
  );
});

void test("shouldShowFirstRunSyncHint: suppressed when the user already opted out", () => {
  const noPrior = emptySyncState();
  assert.equal(
    discoverInternals.shouldShowFirstRunSyncHint(
      noPrior,
      12,
      false,
      true,
      false,
    ),
    false,
    "--no-sync suppresses the hint",
  );
  assert.equal(
    discoverInternals.shouldShowFirstRunSyncHint(
      noPrior,
      12,
      false,
      false,
      true,
    ),
    false,
    "--sync-all suppresses the hint",
  );
});

void test("shouldShowFirstRunSyncHint: suppressed in quiet mode and for small syncs", () => {
  assert.equal(
    discoverInternals.shouldShowFirstRunSyncHint(
      emptySyncState(),
      12,
      true,
      false,
      false,
    ),
    false,
    "quiet mode suppresses the hint",
  );
  assert.equal(
    discoverInternals.shouldShowFirstRunSyncHint(
      emptySyncState(),
      5,
      false,
      false,
      false,
    ),
    false,
    "small syncs do not need the hint",
  );
});

void test("shouldShowFirstRunSyncHint: suppressed when prior sync state exists", () => {
  const prior: SourceSyncState = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources: [
      {
        sourceId: "npm-registry",
        coverageMode: "indexed",
        status: "complete",
        indexedEntryCount: 100,
        cursors: [],
      },
    ],
  };
  assert.equal(
    discoverInternals.shouldShowFirstRunSyncHint(
      prior,
      12,
      false,
      false,
      false,
    ),
    false,
    "subsequent runs do not need the first-run hint",
  );
});

// ---------------------------------------------------------------------------
// getEnabledSourceIds — edge cases (#419)
// ---------------------------------------------------------------------------

void test("getEnabledSourceIds: returns count from valid source registry", async () => {
  const { mkdtemp, rm, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "agent-harness-src-count-"));

  try {
    const discoverDir = join(dir, "discover");
    await mkdir(discoverDir, { recursive: true });
    await writeFile(
      join(discoverDir, "sources.json"),
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        sources: [
          {
            id: "src-1",
            name: "Source 1",
            kind: "repo",
            authorityTier: "trusted-community",
            hosts: ["shared"],
            assetKinds: ["skill"],
            discoveryMode: "catalog",
            priority: 1,
            enabled: true,
            endpoints: {},
            rules: { selection: "default" },
          },
          {
            id: "src-2",
            name: "Source 2",
            kind: "package-registry",
            authorityTier: "official-first-party",
            hosts: ["shared"],
            assetKinds: ["mcp-server"],
            discoveryMode: "catalog",
            priority: 2,
            enabled: true,
            endpoints: { baseUrl: "https://example.com" },
            rules: { selection: "default" },
          },
          {
            id: "src-3",
            name: "Source 3",
            kind: "local-manifest",
            authorityTier: "trusted-community",
            hosts: ["shared"],
            assetKinds: ["skill"],
            discoveryMode: "catalog",
            priority: 3,
            enabled: false,
            endpoints: {},
            rules: { selection: "default" },
          },
          {
            id: "src-4",
            name: "Source 4",
            kind: "marketplace",
            authorityTier: "official-first-party",
            hosts: ["copilot-vscode"],
            assetKinds: ["extension"],
            discoveryMode: "catalog",
            priority: 4,
            enabled: true,
            endpoints: { baseUrl: "https://marketplace.example.com" },
            rules: { selection: "default" },
          },
          {
            id: "src-5",
            name: "Source 5",
            kind: "repo",
            authorityTier: "unverified-community",
            hosts: ["shared"],
            assetKinds: ["skill"],
            discoveryMode: "catalog",
            priority: 5,
            enabled: false,
            endpoints: {},
            rules: { selection: "default" },
          },
        ],
      }),
      "utf8",
    );

    const { discoverInternals } = await import("../discover.js");
    const ids = await discoverInternals.getEnabledSourceIds(dir);
    // Must include the enabled fixture sources
    assert.ok(ids.includes("src-1"), "src-1 (enabled) should be in list");
    assert.ok(ids.includes("src-2"), "src-2 (enabled) should be in list");
    assert.ok(ids.includes("src-4"), "src-4 (enabled) should be in list");
    // Must NOT include the disabled fixture sources
    assert.ok(!ids.includes("src-3"), "src-3 (disabled) should NOT be in list");
    assert.ok(!ids.includes("src-5"), "src-5 (disabled) should NOT be in list");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("getEnabledSourceIds: returns 0 when all sources disabled", async () => {
  const { mkdtemp, rm, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "agent-harness-src-count-"));

  try {
    const discoverDir = join(dir, "discover");
    await mkdir(discoverDir, { recursive: true });
    await writeFile(
      join(discoverDir, "sources.json"),
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        sources: [
          {
            id: "src-1",
            name: "Source 1",
            kind: "repo",
            authorityTier: "trusted-community",
            hosts: ["shared"],
            assetKinds: ["skill"],
            discoveryMode: "catalog",
            priority: 1,
            enabled: false,
            endpoints: {},
            rules: { selection: "default" },
          },
          {
            id: "src-2",
            name: "Source 2",
            kind: "package-registry",
            authorityTier: "official-first-party",
            hosts: ["shared"],
            assetKinds: ["mcp-server"],
            discoveryMode: "catalog",
            priority: 2,
            enabled: false,
            endpoints: { baseUrl: "https://example.com" },
            rules: { selection: "default" },
          },
        ],
      }),
      "utf8",
    );

    const { discoverInternals } = await import("../discover.js");
    const ids = await discoverInternals.getEnabledSourceIds(dir);
    // Disabled fixture sources must NOT appear in the enabled list
    assert.ok(!ids.includes("src-1"), "src-1 (disabled) should NOT be in list");
    assert.ok(!ids.includes("src-2"), "src-2 (disabled) should NOT be in list");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("getEnabledSourceIds: throws when source registry file is missing", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "agent-harness-src-count-"));

  try {
    const { discoverInternals } = await import("../discover.js");
    await assert.rejects(
      () => discoverInternals.getEnabledSourceIds(dir),
      (err: unknown) =>
        err instanceof Error &&
        (err as NodeJS.ErrnoException).code === "ENOENT",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Breadth assessment outcomes + semantic relevance scorer paths (#428)
// ---------------------------------------------------------------------------

function makeSummaryInput(overrides: {
  catalogEntries?: AssetCatalogEntry[];
  enabledSourcesCount?: number;
  selectedCount?: number;
  rejectedCount?: number;
}): Parameters<typeof printDiscoveryBreadthSummary>[0] {
  return {
    demandProfile: {
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
      workspaceRoot: "/tmp",
      signals: {
        languages: ["typescript"],
        packageManagers: [],
        frameworks: [],
        concerns: [],
        tooling: ["eslint"],
      },
      evidence: [{ path: "package.json", kind: "manifest" }],
    } as unknown as DemandProfile,
    sourceIndex: {
      enabledSources: [],
      sourceCount: 1,
    } as unknown as SourceIndex,
    enabledSources: [
      { id: "src-a", name: "Source A", kind: "repo" },
    ] as unknown as SourceDefinition[],
    catalogEntries: overrides.catalogEntries ?? [],
    selectionReport: {
      selectedCount: overrides.selectedCount ?? 0,
      rejectedCount: overrides.rejectedCount ?? 0,
    } as unknown as SelectionReport,
  };
}

function captureBreadthSummary(
  input: Parameters<typeof printDiscoveryBreadthSummary>[0],
  t: {
    mock: {
      method: (
        target: object,
        name: string,
        fn: (...args: unknown[]) => void,
      ) => void;
    };
  },
): string {
  const output: string[] = [];
  t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });
  printDiscoveryBreadthSummary(input);
  return output.join("\n");
}

void test("breadth counts every operational-source flag variant (#428)", (t) => {
  const fullEvidence = (manifestFound: boolean) => ({
    manifestFound,
    readmeFound: false,
    examplesFound: false,
    docsLinked: false,
    filePath: "packages/flag-source/manifest.json",
  });
  const fullStatus = (flags: {
    mirrorEligible: boolean;
    installEligible: boolean;
    activationEligible: boolean;
  }) => ({
    cataloged: true,
    mirrorEligible: flags.mirrorEligible,
    installEligible: flags.installEligible,
    activationEligible: flags.activationEligible,
  });
  const flagVariants: AssetCatalogEntry[] = [
    {
      ...makeEntry("flag-src-0", 0),
      evidence: fullEvidence(true),
      status: fullStatus({
        mirrorEligible: false,
        installEligible: false,
        activationEligible: false,
      }),
    },
    {
      ...makeEntry("flag-src-1", 1),
      evidence: fullEvidence(false),
      status: fullStatus({
        mirrorEligible: true,
        installEligible: false,
        activationEligible: false,
      }),
    },
    {
      ...makeEntry("flag-src-2", 2),
      evidence: fullEvidence(false),
      status: fullStatus({
        mirrorEligible: false,
        installEligible: true,
        activationEligible: false,
      }),
    },
    {
      ...makeEntry("flag-src-3", 3),
      evidence: fullEvidence(false),
      status: fullStatus({
        mirrorEligible: false,
        installEligible: false,
        activationEligible: true,
      }),
    },
  ];
  const output = captureBreadthSummary(
    makeSummaryInput({ catalogEntries: flagVariants }),
    t,
  );
  assert.ok(
    output.includes("4 operational"),
    `every flag variant must count as operational: ${output}`,
  );
});

void test("breadth flags source-coverage-limited when no source is operational (#428)", (t) => {
  const entries = makeEntries("cold-src", 3).map((entry) => ({
    ...entry,
    evidence: {
      manifestFound: false,
      readmeFound: false,
      examplesFound: false,
      docsLinked: false,
      filePath: `packages/${entry.id}/manifest.json`,
    },
    status: {
      cataloged: true,
      mirrorEligible: false,
      installEligible: false,
      activationEligible: false,
    },
  }));
  const output = captureBreadthSummary(
    makeSummaryInput({ catalogEntries: entries }),
    t,
  );
  assert.ok(
    output.includes("Assessment: source-coverage-limited"),
    `expected source-coverage-limited, got: ${output}`,
  );
});

void test("breadth flags selection-limited when nothing is selected (#428)", (t) => {
  const entries = makeEntries("sel-src", 5).map((entry) => ({
    ...entry,
    evidence: {
      manifestFound: true,
      readmeFound: false,
      examplesFound: false,
      docsLinked: false,
      filePath: `packages/${entry.id}/manifest.json`,
    },
  }));
  const output = captureBreadthSummary(
    makeSummaryInput({ catalogEntries: entries, selectedCount: 0 }),
    t,
  );
  assert.ok(
    output.includes("Assessment: selection-limited"),
    `expected selection-limited, got: ${output}`,
  );
});

void test("breadth flags selection-limited for a large catalog with a tiny selection (#428)", (t) => {
  const entries = makeEntries("big-src", 30).map((entry) => ({
    ...entry,
    evidence: {
      manifestFound: true,
      readmeFound: false,
      examplesFound: false,
      docsLinked: false,
      filePath: `packages/${entry.id}/manifest.json`,
    },
  }));
  // 1 selected of 30: far below the max(3, 5%) floor.
  const output = captureBreadthSummary(
    makeSummaryInput({ catalogEntries: entries, selectedCount: 1 }),
    t,
  );
  assert.ok(
    output.includes("Assessment: selection-limited"),
    `expected selection-limited for 1/30, got: ${output}`,
  );
});

void test("breadth reports ranking-ready when selection clears the ratio floor (#428)", (t) => {
  const bigEntries = makeEntries("ready-src", 30).map((entry) => ({
    ...entry,
    evidence: {
      manifestFound: true,
      readmeFound: false,
      examplesFound: false,
      docsLinked: false,
      filePath: `packages/${entry.id}/manifest.json`,
    },
  }));
  const bigOutput = captureBreadthSummary(
    makeSummaryInput({ catalogEntries: bigEntries, selectedCount: 10 }),
    t,
  );
  assert.ok(
    bigOutput.includes("Assessment: ranking-ready"),
    `expected ranking-ready for 10/30, got: ${bigOutput}`,
  );

  const smallEntries = makeEntries("small-src", 10).map((entry) => ({
    ...entry,
    evidence: {
      manifestFound: true,
      readmeFound: false,
      examplesFound: false,
      docsLinked: false,
      filePath: `packages/${entry.id}/manifest.json`,
    },
  }));
  const smallOutput = captureBreadthSummary(
    makeSummaryInput({ catalogEntries: smallEntries, selectedCount: 8 }),
    t,
  );
  assert.ok(
    smallOutput.includes("Assessment: ranking-ready"),
    `expected ranking-ready for 8/10, got: ${smallOutput}`,
  );
});

// ---------------------------------------------------------------------------
// applyRelevanceFilter — semantic scorer branches (#428)
// ---------------------------------------------------------------------------

function makeScorer(overrides: {
  available?: boolean;
  result?: {
    selected: AssetCatalogEntry[];
    rejected: AssetCatalogEntry[];
  } | null;
}): RelevanceScorer {
  return {
    available: overrides.available ?? false,
    tryInit: async () => {},
    filterAndRank: async () => overrides.result ?? null,
  };
}

async function captureWarnings(
  t: {
    mock: {
      method: (
        target: object,
        name: string,
        fn: (...args: unknown[]) => void,
      ) => void;
    };
  },
  invocation: () => Promise<void>,
): Promise<string[]> {
  const warnings: string[] = [];
  t.mock.method(globalThis.console, "warn", (...args: unknown[]) => {
    warnings.push(args.map((value) => String(value)).join(" "));
  });
  try {
    await invocation();
  } catch (error: unknown) {
    warnings.push(`THREW: ${String(error)}`);
  }
  return warnings;
}

async function withSemanticScoringEnv(
  enabled: string,
  invocation: () => Promise<void>,
): Promise<void> {
  const previousEnabled = process.env.AGENT_HARNESS_DISCOVERY_SEMANTIC_SCORING;
  const previousSimilarity = process.env.AGENT_HARNESS_DISCOVERY_MIN_SIMILARITY;
  process.env.AGENT_HARNESS_DISCOVERY_SEMANTIC_SCORING = enabled;
  process.env.AGENT_HARNESS_DISCOVERY_MIN_SIMILARITY = "0.5";
  clearRuntimeConfig();
  try {
    await invocation();
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.AGENT_HARNESS_DISCOVERY_SEMANTIC_SCORING;
    } else {
      restoreEnvVar(
        "AGENT_HARNESS_DISCOVERY_SEMANTIC_SCORING",
        previousEnabled,
      );
    }
    if (previousSimilarity === undefined) {
      delete process.env.AGENT_HARNESS_DISCOVERY_MIN_SIMILARITY;
    } else {
      restoreEnvVar(
        "AGENT_HARNESS_DISCOVERY_MIN_SIMILARITY",
        previousSimilarity,
      );
    }
    clearRuntimeConfig();
  }
}

void test("semantic scoring default factory falls back when transformers are unavailable (#428)", async (t) => {
  const entries = makeEntries("sem-src", 2);
  const warnings = await captureWarnings(t, async () => {
    await withSemanticScoringEnv("1", async () => {
      // No factory argument: the default SemanticScorer is constructed; on a
      // machine without @xenova/transformers it reports unavailable and the
      // keyword gate takes over.
      const result = await applyRelevanceFilter(
        entries,
        null,
        getRuntimeConfig(),
      );
      assert.ok(
        Array.isArray(result.selectedEntries) &&
          Array.isArray(result.rejectedEntries),
        "the keyword fallback still returns split lists",
      );
    });
  });
  assert.ok(
    warnings.some((line) => line.includes("not installed")),
    `expected unavailable-scorer warning, got: ${warnings.join("\n")}`,
  );
});

void test("semantic scoring uses the scorer result when available (#428)", async (t) => {
  const entries = makeEntries("sem-ok", 3);
  const kept = entries.slice(0, 1);
  const dropped = entries.slice(1);
  const warnings = await captureWarnings(t, async () => {
    await withSemanticScoringEnv("1", async () => {
      const result = await applyRelevanceFilter(
        entries,
        null,
        getRuntimeConfig(),
        () =>
          makeScorer({
            available: true,
            result: { selected: kept, rejected: dropped },
          }),
      );
      assert.deepEqual(result.selectedEntries, kept);
      assert.deepEqual(result.rejectedEntries, dropped);
    });
  });
  assert.equal(warnings.length, 0, "no warnings on the successful scorer path");
});

void test("semantic scoring falls back when the scorer returns null (#428)", async (t) => {
  const entries = makeEntries("sem-null", 2);
  const warnings = await captureWarnings(t, async () => {
    await withSemanticScoringEnv("1", async () => {
      const result = await applyRelevanceFilter(
        entries,
        null,
        getRuntimeConfig(),
        () => makeScorer({ available: true, result: null }),
      );
      assert.ok(Array.isArray(result.selectedEntries));
    });
  });
  assert.ok(
    warnings.some((line) => line.includes("unavailable after init")),
    `expected re-init failure warning, got: ${warnings.join("\n")}`,
  );
});

void test("semantic scoring warns when the scorer is unavailable after init (#428)", async (t) => {
  const entries = makeEntries("sem-unavail", 2);
  const warnings = await captureWarnings(t, async () => {
    await withSemanticScoringEnv("1", async () => {
      const result = await applyRelevanceFilter(
        entries,
        null,
        getRuntimeConfig(),
        () => makeScorer({ available: false }),
      );
      assert.ok(Array.isArray(result.selectedEntries));
    });
  });
  assert.ok(
    warnings.some((line) => line.includes("not installed")),
    `expected unavailable warning, got: ${warnings.join("\n")}`,
  );
});

void test("semantic scoring is skipped entirely when disabled (#428)", async (t) => {
  const entries = makeEntries("sem-off", 2);
  let factoryCalled = false;
  const warnings = await captureWarnings(t, async () => {
    await withSemanticScoringEnv("0", async () => {
      const result = await applyRelevanceFilter(
        entries,
        null,
        getRuntimeConfig(),
        () => {
          factoryCalled = true;
          return makeScorer({ available: true });
        },
      );
      assert.ok(Array.isArray(result.selectedEntries));
    });
  });
  assert.equal(
    factoryCalled,
    false,
    "the scorer factory must not run when disabled",
  );
  assert.equal(
    warnings.length,
    0,
    `expected no warnings when disabled, got: ${warnings.join("\n")}`,
  );
});
