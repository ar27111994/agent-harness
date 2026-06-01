import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeJsonLinesFile } from "../files.js";
import {
  buildSourceHealthReport,
  writeSourceHealthReports,
} from "../domains/discovery/source-health.js";
import type { AssetCatalogEntry, SourceDefinition } from "../types.js";
import type { SourceSyncState } from "../domains/discovery/source-sync.js";

void test("source health report distinguishes active, dormant, stale, failed, and trust drift", () => {
  const sources = [
    buildSource("active-source"),
    buildSource("dormant-source"),
    buildSource("stale-source"),
    buildSource("failed-source", { kind: "marketplace" }),
    buildSource("docs-source", { kind: "docs" }),
    buildSource("registry-source", { kind: "registry" }),
    buildSource("local-directory-source", { kind: "local-directory" }),
    buildSource("local-manifest-source", { kind: "local-manifest" }),
    buildSource("official-unverified", {
      authorityTier: "official-first-party",
      publisherVerified: false,
    }),
    buildSource("official-unverified-duplicates", {
      authorityTier: "official-first-party",
      publisherVerified: false,
    }),
  ];
  const selected = [
    buildEntry("selected", "active-source"),
    buildEntry("docs-selected", "docs-source"),
    buildEntry("registry-selected", "registry-source"),
    buildEntry("local-directory-selected", "local-directory-source"),
    buildEntry("local-manifest-selected", "local-manifest-source"),
  ];
  const rejected = [buildEntry("rejected", "stale-source")];
  const catalog = [
    ...selected,
    ...rejected,
    buildEntry("active-duplicate-a", "active-source", {
      duplicateGroup: "active-duplicates",
    }),
    buildEntry("active-duplicate-b", "active-source", {
      duplicateGroup: "active-duplicates",
    }),
    buildEntry("active-duplicate-c", "active-source", {
      duplicateGroup: "active-duplicates",
    }),
    buildEntry("official-entry", "official-unverified"),
    buildEntry(
      "official-unverified-duplicate-a",
      "official-unverified-duplicates",
      {
        duplicateGroup: "official-unverified-duplicates",
      },
    ),
    buildEntry(
      "official-unverified-duplicate-b",
      "official-unverified-duplicates",
      {
        duplicateGroup: "official-unverified-duplicates",
      },
    ),
  ];
  const syncState: SourceSyncState = {
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    sources: [
      {
        sourceId: "failed-source",
        coverageMode: "indexed",
        status: "failed",
        indexedEntryCount: 0,
        cursors: [],
      },
    ],
  };

  const report = buildSourceHealthReport(
    sources,
    catalog,
    selected,
    rejected,
    syncState,
  );

  assert.equal(report.severeCount, 3);
  assert.equal(report.warningCount, 3);
  assert.equal(sourceStatus(report, "active-source"), "active");
  assert.equal(sourceStatus(report, "dormant-source"), "dormant");
  assert.equal(sourceStatus(report, "stale-source"), "stale");
  assert.equal(sourceStatus(report, "failed-source"), "broken");
  assert.equal(sourceStatus(report, "docs-source"), "active");
  assert.equal(sourceStatus(report, "registry-source"), "active");
  assert.equal(sourceEntry(report, "registry-source")?.coverageMode, "sampled");
  assert.equal(
    sourceEntry(report, "registry-source")?.syncStatus,
    "unsupported",
  );
  assert.equal(sourceEntry(report, "docs-source")?.coverageMode, "direct");
  assert.equal(
    sourceEntry(report, "local-directory-source")?.coverageMode,
    "direct",
  );
  assert.equal(
    sourceEntry(report, "local-manifest-source")?.coverageMode,
    "direct",
  );
  assert.equal(
    sourceEntry(report, "local-manifest-source")?.syncStatus,
    "not-applicable",
  );
  assert.equal(sourceStatus(report, "official-unverified"), "ambiguous-trust");
  assert.equal(
    sourceEntry(report, "official-unverified-duplicates")?.severity,
    "error",
  );
  assert.equal(
    sourceEntry(report, "official-unverified-duplicates")?.suggestedAction,
    "verify-official-owner",
  );
  assert.equal(sourceEntry(report, "active-source")?.severity, "warning");
  assert.match(
    sourceEntry(report, "active-source")?.reasons.join("\n") ?? "",
    /duplicate rate is/u,
  );

  const uniqueDuplicateGroupReport = buildSourceHealthReport(
    [buildSource("unique-groups")],
    [
      buildEntry("unique-a", "unique-groups", { duplicateGroup: "unique-a" }),
      buildEntry("unique-b", "unique-groups", { duplicateGroup: "unique-b" }),
    ],
    [],
    [],
    { schemaVersion: 1, generatedAt: "2026-01-01T00:00:00.000Z", sources: [] },
  );
  assert.equal(
    sourceEntry(uniqueDuplicateGroupReport, "unique-groups")?.duplicateRate,
    0,
  );

  const noEntryReport = buildSourceHealthReport(
    [buildSource("empty-source")],
    [],
    [],
    [],
    { schemaVersion: 1, generatedAt: "2026-01-01T00:00:00.000Z", sources: [] },
  );
  assert.equal(sourceEntry(noEntryReport, "empty-source")?.duplicateRate, 0);
});

void test("source health writer emits health, drift, and maintenance reports", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-health-"),
  );

  try {
    const sources = [
      buildSource("active-source"),
      buildSource("dormant-source"),
    ];
    const selected = [buildEntry("selected", "active-source")];
    await writeJsonLinesFile(
      join(projectRoot, "discover", "catalog.assets.jsonl"),
      selected,
    );

    const report = await writeSourceHealthReports(
      projectRoot,
      sources,
      selected,
      [],
    );

    assert.equal(report.sourceCount, 2);
    const drift = JSON.parse(
      await readFile(
        join(projectRoot, "discover", "output", "source-drift.json"),
        "utf8",
      ),
    ) as { sources: Array<{ sourceId: string }> };
    const maintenance = JSON.parse(
      await readFile(
        join(
          projectRoot,
          "discover",
          "output",
          "catalog-maintenance-candidates.json",
        ),
        "utf8",
      ),
    ) as { candidates: Array<{ sourceId: string }> };
    assert.deepEqual(
      drift.sources.map((source) => source.sourceId),
      ["dormant-source"],
    );
    assert.deepEqual(
      maintenance.candidates.map((source) => source.sourceId),
      ["dormant-source"],
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

function sourceStatus(
  report: ReturnType<typeof buildSourceHealthReport>,
  sourceId: string,
): string | undefined {
  return sourceEntry(report, sourceId)?.status;
}

function sourceEntry(
  report: ReturnType<typeof buildSourceHealthReport>,
  sourceId: string,
) {
  return report.sources.find((source) => source.sourceId === sourceId);
}

function buildSource(
  id: string,
  options: Partial<SourceDefinition> & { publisherVerified?: boolean } = {},
): SourceDefinition {
  return {
    id,
    name: id,
    kind: options.kind ?? "repo",
    authorityTier: options.authorityTier ?? "trusted-community",
    publisher: {
      name: id,
      verified: options.publisherVerified ?? true,
      owner: id,
    },
    hosts: ["opencode"],
    assetKinds: ["skill"],
    discoveryMode: "catalog",
    priority: 70,
    enabled: true,
    endpoints: {
      repo: `https://example.com/${id}`,
    },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  };
}

function buildEntry(
  id: string,
  sourceId: string,
  options: { duplicateGroup?: string } = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: "skill",
    hosts: ["opencode"],
    compatibilityMode: "native",
    source: {
      sourceId,
      authorityTier:
        sourceId === "official-unverified"
          ? "official-first-party"
          : "trusted-community",
      sourceKind: "repo",
      sourcePriority: 70,
      originUrl: `https://example.com/${sourceId}`,
      publisher: sourceId,
      publisherVerified: sourceId !== "official-unverified",
    },
    trust: { score: 70, signals: ["fixture"] },
    capabilities: ["testing"],
    install: { method: "manual" },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: false,
    },
    maintenance: {
      lastUpdated: "2026-01-01T00:00:00.000Z",
      stars: 1,
      releaseCadence: "active",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: {
      sizeClass: "small",
      estimatedPromptWeight: 1,
    },
    fit: {
      portfolioFit: 0.5,
      hostFit: 0.8,
    },
    dedupe: {
      duplicateGroup: options.duplicateGroup,
      candidateRankHint: "fixture",
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}
