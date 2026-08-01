/**
 * Tests for source-health module internals.
 *
 * Covers isEphemeralStateRoot (all branches), groupBySource,
 * computeDuplicateRate, defaultCoverageMode, and defaultSyncStatus.
 * Ticket: #412 — CI coverage gap.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { sourceHealthInternals } from "../domains/discovery/source-health.js";
import { buildSourceHealthReport } from "../domains/discovery/source-health.js";
import type { AssetCatalogEntry } from "../types.js";

const {
  isEphemeralStateRoot,
  groupBySource,
  computeDuplicateRate,
  defaultCoverageMode,
  defaultSyncStatus,
} = sourceHealthInternals;

// ---------------------------------------------------------------------------
// isEphemeralStateRoot — true paths
// ---------------------------------------------------------------------------

void test("isEphemeralStateRoot: /tmp/ prefix", () => {
  assert.equal(isEphemeralStateRoot("/tmp/build/state"), true);
});

void test("isEphemeralStateRoot: /tmp as root", () => {
  assert.equal(isEphemeralStateRoot("/tmp"), true);
});

void test("isEphemeralStateRoot: /tmp/subdir", () => {
  assert.equal(isEphemeralStateRoot("/tmp/myproject"), true);
});

void test("isEphemeralStateRoot: /temp/ prefix", () => {
  assert.equal(isEphemeralStateRoot("/temp/runner/state"), true);
});

void test("isEphemeralStateRoot: /private/tmp/ (macOS)", () => {
  assert.equal(isEphemeralStateRoot("/private/tmp/abc123"), true);
});

void test("isEphemeralStateRoot: appdata/local/temp (Windows CI)", () => {
  assert.equal(
    isEphemeralStateRoot("C:\\Users\\runner\\AppData\\Local\\Temp\\state"),
    true,
  );
});

void test("isEphemeralStateRoot: /_temp/ (Windows CI runner)", () => {
  assert.equal(
    isEphemeralStateRoot("D:\\a\\_temp\\agent-harness\\state"),
    true,
  );
});

void test("isEphemeralStateRoot: /github/workspace/ (GitHub Actions)", () => {
  assert.equal(isEphemeralStateRoot("/github/workspace/state"), true);
});

void test("isEphemeralStateRoot: /home/runner/work/ (GitHub Actions Linux)", () => {
  assert.equal(
    isEphemeralStateRoot("/home/runner/work/agent-harness/agent-harness/state"),
    true,
  );
});

void test("isEphemeralStateRoot: Windows temp with forward slashes", () => {
  assert.equal(
    isEphemeralStateRoot("C:/Users/RUNNER/AppData/Local/Temp/state"),
    true,
  );
});

// ---------------------------------------------------------------------------
// isEphemeralStateRoot — false paths (not ephemeral)
// ---------------------------------------------------------------------------

void test("isEphemeralStateRoot: normal project path", () => {
  assert.equal(isEphemeralStateRoot("/home/ahmed/projects/myapp/state"), false);
});

void test("isEphemeralStateRoot: Windows user directory", () => {
  assert.equal(
    isEphemeralStateRoot("C:\\Users\\ahmed\\Projects\\agent-harness\\state"),
    false,
  );
});

void test("isEphemeralStateRoot: /opt path", () => {
  assert.equal(isEphemeralStateRoot("/opt/app/state"), false);
});

void test("isEphemeralStateRoot: /var path", () => {
  assert.equal(isEphemeralStateRoot("/var/lib/state"), false);
});

void test("isEphemeralStateRoot: empty string", () => {
  assert.equal(isEphemeralStateRoot(""), false);
});

void test("isEphemeralStateRoot: root filesystem", () => {
  assert.equal(isEphemeralStateRoot("/"), false);
});

void test("isEphemeralStateRoot: tempfile name (not path)", () => {
  // "temp" must be a directory segment, not just part of a filename.
  assert.equal(isEphemeralStateRoot("/home/user/temperature/state"), false);
});

// ---------------------------------------------------------------------------
// isEphemeralStateRoot — edge cases and sanitization
// ---------------------------------------------------------------------------

void test("isEphemeralStateRoot: mixed case path", () => {
  assert.equal(isEphemeralStateRoot("/TMP/build"), true);
  assert.equal(isEphemeralStateRoot("/Temp/runner"), true);
  assert.equal(isEphemeralStateRoot("/Tmp/ci"), true);
});

void test("isEphemeralStateRoot: backslash normalized", () => {
  assert.equal(isEphemeralStateRoot("C:\\TEMP\\state"), true);
});

void test("isEphemeralStateRoot: very long path", () => {
  const longPath = "/tmp/" + "a/".repeat(200) + "state";
  assert.equal(isEphemeralStateRoot(longPath), true);
});

void test("isEphemeralStateRoot: Unicode characters in path", () => {
  assert.equal(isEphemeralStateRoot("/tmp/プ ロジェクト/state"), true);
});

void test("isEphemeralStateRoot: path traversal in temp", () => {
  assert.equal(isEphemeralStateRoot("/tmp/../../../etc/passwd"), true);
});

void test("isEphemeralStateRoot: concurrency — no mutation", async () => {
  const results = await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      Promise.resolve(
        isEphemeralStateRoot(i % 2 === 0 ? "/tmp/test" : "/home/test"),
      ),
    ),
  );
  for (let i = 0; i < 50; i++) {
    assert.equal(results[i], i % 2 === 0);
  }
});

// ---------------------------------------------------------------------------
// groupBySource
// ---------------------------------------------------------------------------

function makeEntry(sourceId: string, id: string): AssetCatalogEntry {
  return {
    id,
    displayName: `Entry ${id}`,
    source: {
      sourceId,
      sourceFamily: "github",
      authorityTier: "unverified-community",
      discoveryMode: "catalog",
      publisher: undefined,
      publisherVerified: false,
    },
    assetKind: "skill",
    hosts: ["opencode"],
    compatibilityMode: "adaptable",
    capabilities: [],
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: { sizeClass: "tiny", estimatedPromptWeight: 1 },
    dedupe: {},
    evidence: { classification: undefined },
    trust: { signals: [], score: 0, omsSigned: false, omsVerified: false },
    install: { requiresNativeInstall: false, extensionId: undefined },
    maintenance: { lastVerified: undefined },
    fit: { portfolioFit: 0, hostFit: {} },
    status: { selected: true, rejected: false },
  } as unknown as AssetCatalogEntry;
}

void test("groupBySource groups entries by source ID", () => {
  const entries = [
    makeEntry("source-a", "a1"),
    makeEntry("source-a", "a2"),
    makeEntry("source-b", "b1"),
    makeEntry("source-a", "a3"),
    makeEntry("source-c", "c1"),
  ];

  const groups = groupBySource(entries);
  assert.equal(groups.size, 3);
  assert.equal(groups.get("source-a")?.length, 3);
  assert.equal(groups.get("source-b")?.length, 1);
  assert.equal(groups.get("source-c")?.length, 1);
});

void test("groupBySource returns empty map for empty input", () => {
  const groups = groupBySource([]);
  assert.equal(groups.size, 0);
});

void test("groupBySource preserves insertion order within groups", () => {
  const entries = [
    makeEntry("src", "first"),
    makeEntry("src", "second"),
    makeEntry("src", "third"),
  ];
  const groups = groupBySource(entries);
  const srcEntries = groups.get("src") ?? [];
  assert.equal(srcEntries[0].id, "first");
  assert.equal(srcEntries[1].id, "second");
  assert.equal(srcEntries[2].id, "third");
});

// ---------------------------------------------------------------------------
// computeDuplicateRate
// ---------------------------------------------------------------------------

void test("computeDuplicateRate returns 0 for empty entries", () => {
  assert.equal(computeDuplicateRate([]), 0);
});

void test("computeDuplicateRate returns 0 when no duplicates", () => {
  const entries = [
    makeEntry("src", "a"),
    makeEntry("src", "b"),
    makeEntry("src", "c"),
  ];
  assert.equal(computeDuplicateRate(entries), 0);
});

void test("computeDuplicateRate computes correct rate for duplicates", () => {
  const entries = [
    { ...makeEntry("src", "a"), dedupe: { duplicateGroup: 1 } },
    { ...makeEntry("src", "b"), dedupe: { duplicateGroup: 1 } },
    { ...makeEntry("src", "c") },
    { ...makeEntry("src", "d") },
    { ...makeEntry("src", "e"), dedupe: { duplicateGroup: 2 } },
    { ...makeEntry("src", "f"), dedupe: { duplicateGroup: 2 } },
  ] as AssetCatalogEntry[];
  // 4 duplicates out of 6 entries = 0.6667
  assert.equal(computeDuplicateRate(entries), 0.6667);
});

void test("computeDuplicateRate handles singleton duplicate groups", () => {
  // A duplicate group of 1 does not count as a duplicate.
  const entries = [
    { ...makeEntry("src", "a"), dedupe: { duplicateGroup: 1 } },
    { ...makeEntry("src", "b") },
    { ...makeEntry("src", "c") },
  ] as AssetCatalogEntry[];
  assert.equal(computeDuplicateRate(entries), 0);
});

void test("computeDuplicateRate handles undefined duplicate groups", () => {
  const entries = [
    { ...makeEntry("src", "a"), dedupe: {} },
    { ...makeEntry("src", "b"), dedupe: { duplicateGroup: undefined } },
  ] as AssetCatalogEntry[];
  assert.equal(computeDuplicateRate(entries), 0);
});

// ---------------------------------------------------------------------------
// defaultCoverageMode
// ---------------------------------------------------------------------------

void test("defaultCoverageMode: repo → rotating", () => {
  assert.equal(defaultCoverageMode("repo"), "rotating");
});

void test("defaultCoverageMode: docs → direct", () => {
  assert.equal(defaultCoverageMode("docs"), "direct");
});

void test("defaultCoverageMode: local-directory → direct", () => {
  assert.equal(defaultCoverageMode("local-directory"), "direct");
});

void test("defaultCoverageMode: local-manifest → direct", () => {
  assert.equal(defaultCoverageMode("local-manifest"), "direct");
});

void test("defaultCoverageMode: other kinds → sampled", () => {
  assert.equal(defaultCoverageMode("package-registry"), "sampled");
  assert.equal(defaultCoverageMode("ard-registry"), "sampled");
});

// ---------------------------------------------------------------------------
// defaultSyncStatus
// ---------------------------------------------------------------------------

void test("defaultSyncStatus: repo → not-applicable", () => {
  assert.equal(defaultSyncStatus("repo"), "not-applicable");
});

void test("defaultSyncStatus: docs → not-applicable", () => {
  assert.equal(defaultSyncStatus("docs"), "not-applicable");
});

void test("defaultSyncStatus: local-directory → not-applicable", () => {
  assert.equal(defaultSyncStatus("local-directory"), "not-applicable");
});

void test("defaultSyncStatus: local-manifest → not-applicable", () => {
  assert.equal(defaultSyncStatus("local-manifest"), "not-applicable");
});

void test("defaultSyncStatus: other kinds → unsupported", () => {
  assert.equal(defaultSyncStatus("package-registry"), "unsupported");
  assert.equal(defaultSyncStatus("ard-registry"), "unsupported");
});

// ---------------------------------------------------------------------------
// reasonCode emission (#412 follow-up)
// ---------------------------------------------------------------------------

void test("buildSourceHealthReport sets reasonCode when CI+dormant", () => {
  process.env.CI = "true";
  try {
    const report = buildSourceHealthReport(
      [
        {
          id: "ci-dormant-source",
          kind: "repo",
          name: "CI Dormant Source",
          authorityTier: "trusted-community",
          publisher: { name: "Test", verified: false },
          hosts: ["shared"],
          assetKinds: ["skill"],
          discoveryMode: "catalog",
          priority: 50,
          enabled: true,
          endpoints: { baseUrl: "https://example.com" },
          rules: {
            officialPreferred: false,
            allowMirror: true,
            allowInstall: true,
          },
        },
      ],
      [],
      [],
      [],
      {
        sources: [
          {
            sourceId: "ci-dormant-source",
            status: "complete",
            indexedEntryCount: 100,
            coverageMode: "sampled",
          },
        ],
      },
    );
    const ciSource = report.sources.find(
      (s) => s.sourceId === "ci-dormant-source",
    );
    assert.ok(ciSource);
    assert.equal(ciSource.status, "dormant");
    assert.equal(ciSource.reasonCode, "ephemeral-ci-state-root");
    assert.equal(ciSource.ciDetected, true);
  } finally {
    delete process.env.CI;
  }
});

void test("buildSourceHealthReport omits reasonCode for non-dormant CI source", () => {
  process.env.CI = "true";
  try {
    const entry = makeEntry("active-ci-source", "asset-1");
    const report = buildSourceHealthReport(
      [
        {
          id: "active-ci-source",
          kind: "repo",
          name: "Active CI Source",
          authorityTier: "trusted-community",
          publisher: { name: "Test", verified: false },
          hosts: ["shared"],
          assetKinds: ["skill"],
          discoveryMode: "catalog",
          priority: 50,
          enabled: true,
          endpoints: { baseUrl: "https://example.com" },
          rules: {
            officialPreferred: false,
            allowMirror: true,
            allowInstall: true,
          },
        },
      ],
      [entry],
      [entry],
      [],
    );
    const ciSource = report.sources.find(
      (s) => s.sourceId === "active-ci-source",
    );
    assert.ok(ciSource);
    assert.equal(ciSource.status, "active");
    assert.equal(ciSource.reasonCode, undefined);
  } finally {
    delete process.env.CI;
  }
});

void test("buildSourceHealthReport omits reasonCode outside CI", () => {
  const report = buildSourceHealthReport(
    [
      {
        id: "local-dormant",
        kind: "repo",
        name: "Local Dormant",
        authorityTier: "trusted-community",
        publisher: { name: "Test", verified: false },
        hosts: ["shared"],
        assetKinds: ["skill"],
        discoveryMode: "catalog",
        priority: 50,
        enabled: true,
        endpoints: { baseUrl: "https://example.com" },
        rules: {
          officialPreferred: false,
          allowMirror: true,
          allowInstall: true,
        },
      },
    ],
    [],
    [],
    [],
    {
      sources: [
        {
          sourceId: "local-dormant",
          status: "complete",
          indexedEntryCount: 100,
          coverageMode: "sampled",
        },
      ],
    },
  );
  const source = report.sources.find((s) => s.sourceId === "local-dormant");
  assert.ok(source);
  assert.equal(source.status, "dormant");
  assert.equal(source.reasonCode, undefined);
  assert.equal(source.ciDetected, false);
});
