import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { selectActivationCandidates } from "../activate/selection.js";
import { readJsonFile } from "../files.js";
import { generateMirrorPlan } from "../mirror/plan.js";
import { loadRecommendationPolicy } from "../recommend/policy.js";
import { buildRecommendationReport } from "../recommend/report.js";
import type {
  AssetCatalogEntry,
  DemandProfile,
  InstalledPackageManifest,
  MirrorPolicy,
  RecommendationReport,
} from "../types.js";

/**
 * Per-path performance gates for the lifecycle hot paths (recommend,
 * activate, mirror) — the review flagged the perf axis as one file deep.
 *
 * Each gate builds a synthetic 1,000-entry catalog and asserts a generous
 * wall-clock budget on the production function, plus a correctness sanity
 * assertion so a gate can never pass on an empty/no-op path. Budgets are
 * deliberately loose (10s): they catch complexity regressions (O(n²)
 * rescoring, accidental per-entry IO) without being flaky on loaded CI
 * runners.
 */

const BENCHMARK_CATALOG_SIZE = 1_000;
const PATH_BUDGET_MS = 10_000;

/** Builds a catalog entry that passes assertAssetCatalogEntry. */
function buildCatalogEntry(index: number): AssetCatalogEntry {
  const assetId = `benchmark-asset-${index}`;
  return {
    id: assetId,
    displayName: assetId,
    assetKind: "skill",
    hosts: ["copilot-vscode", "opencode", "shared"],
    compatibilityMode: "native",
    source: {
      sourceId: "benchmark-source",
      authorityTier: "trusted-community",
      sourceKind: "repo",
      sourcePriority: 80,
      originUrl: `https://github.com/example/${assetId}`,
      publisher: "benchmark-source",
      publisherVerified: false,
    },
    trust: {
      score: 80,
      signals: ["fixture"],
    },
    capabilities: ["automation", "typescript", "ui", "react"],
    install: {
      method: "fixture",
      nativeHosts: ["copilot-vscode", "opencode", "shared"],
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: `${assetId}.md`,
    },
    maintenance: {
      lastUpdated: new Date().toISOString(),
      stars: 0,
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
      estimatedPromptWeight: 2,
    },
    fit: {
      portfolioFit: 0.9,
      hostFit: 0.9,
    },
    dedupe: {
      candidateRankHint: `benchmark-${index % 3}`,
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}

/** Builds an installed-package manifest from a catalog entry. */
function buildInstalledManifest(
  entry: AssetCatalogEntry,
): InstalledPackageManifest {
  return {
    schemaVersion: 1,
    assetId: entry.id,
    mirrorId: `mirror-${entry.id}`,
    host: "copilot-vscode",
    installedAt: new Date(0).toISOString(),
    projectionType: "native-skill",
    assetKind: entry.assetKind,
    sourceAuthorityTier: entry.source.authorityTier,
    contextCost: entry.contextCost,
    portfolioFit: entry.fit.portfolioFit,
    filesRoot: `/fixture/${entry.id}/files`,
    bundleMembership: ["benchmark-bundle"],
    activationEligible: true,
    activeByDefault: false,
    upstream: {
      mirrorId: `mirror-${entry.id}`,
      mirroredAt: new Date(0).toISOString(),
      sourceId: entry.source.sourceId,
      sourceOriginUrl: entry.source.originUrl,
      sourceLastUpdated: entry.maintenance.lastUpdated,
      upstream: {
        type: "repo",
        url: entry.source.originUrl,
      },
    },
  };
}

function buildMirrorPolicy(): MirrorPolicy {
  return {
    schemaVersion: 1,
    selection: {
      officialBeatsPopularity: true,
      requirePinnedProvenance: false,
      communityDefaultPolicy: "allow",
    },
    audit: {
      alwaysAudit: false,
      quarantineOn: [],
    },
    store: {
      root: "mirror",
      rawDirectories: ["raw"],
      normalizedDirectories: [],
      bundlesDirectory: "bundles",
      quarantineDirectory: "quarantine",
      auditDirectory: "audit",
    },
    bundleTemplates: [],
  };
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-perf-path-"));
  const report: Record<string, unknown> = {};
  try {
    const entries = Array.from({ length: BENCHMARK_CATALOG_SIZE }, (_, index) =>
      buildCatalogEntry(index),
    );

    // ------------------------------------------------------------------
    // recommend: full candidate pool + ranking over 1,000 entries
    // ------------------------------------------------------------------
    const policy = await loadRecommendationPolicy(process.cwd());
    const demandProfile: DemandProfile = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scanRoot: "benchmark/workspace",
      summary: { scannedFiles: 8, matchedFiles: 3 },
      signals: {
        languages: ["typescript"],
        packageManagers: ["npm"],
        frameworks: ["automation"],
        concerns: [],
        tooling: ["eslint"],
      },
      evidence: [
        {
          path: "package.json",
          fileName: "package.json",
          evidenceStrength: "strong",
          matchedSignals: {
            languages: ["typescript"],
            packageManagers: ["npm"],
            frameworks: ["automation"],
            concerns: [],
            tooling: ["eslint"],
          },
        },
      ],
    };
    const recommendStartedAt = performance.now();
    const recommendationReport: RecommendationReport =
      buildRecommendationReport(entries, demandProfile, policy, "general");
    const recommendElapsedMs = performance.now() - recommendStartedAt;
    assert.ok(
      recommendationReport.recommendations.length > 0,
      "recommend report must rank at least one entry",
    );
    assert.ok(
      recommendElapsedMs < PATH_BUDGET_MS,
      `recommend exceeded budget: ${recommendElapsedMs}ms`,
    );
    report.recommendations = recommendationReport.recommendations.length;
    report.recommendElapsedMs = Math.round(recommendElapsedMs);

    // ------------------------------------------------------------------
    // activate: candidate selection under budget over 1,000 manifests
    // ------------------------------------------------------------------
    const firstHostEntries =
      Object.values(recommendationReport.topByHost)[0] ?? [];
    const recommendationEntryByAssetId = new Map(
      firstHostEntries.map((entry) => [entry.assetId, entry]),
    );
    const preferredAssetOrder = new Map(
      firstHostEntries.map((entry, index) => [entry.assetId, index]),
    );
    const candidates = entries.map((entry) => ({
      packageManifest: buildInstalledManifest(entry),
      destinationRoot: "/fixture",
    }));

    const activateStartedAt = performance.now();
    const selectedCandidates = selectActivationCandidates(
      candidates,
      preferredAssetOrder,
      recommendationEntryByAssetId,
      60,
      "general",
    );
    const activateElapsedMs = performance.now() - activateStartedAt;
    assert.ok(
      selectedCandidates.length > 0 && selectedCandidates.length <= 60,
      `activation must select a bounded non-empty set, got ${selectedCandidates.length}`,
    );
    assert.ok(
      activateElapsedMs < PATH_BUDGET_MS,
      `activate selection exceeded budget: ${activateElapsedMs}ms`,
    );
    report.activatedCandidates = selectedCandidates.length;
    report.activateElapsedMs = Math.round(activateElapsedMs);

    // ------------------------------------------------------------------
    // mirror: plan generation over a real 1,000-entry catalog on disk
    // ------------------------------------------------------------------
    const mirrorRoot = join(root, "mirror-workspace");
    await mkdir(join(mirrorRoot, "discover", "output"), { recursive: true });
    await mkdir(join(mirrorRoot, "mirror"), { recursive: true });
    await writeFile(
      join(mirrorRoot, "mirror", "policy.json"),
      `${JSON.stringify(buildMirrorPolicy())}\n`,
      "utf8",
    );
    await writeFile(
      join(mirrorRoot, "discover", "catalog.assets.jsonl"),
      entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      "utf8",
    );
    await writeFile(
      join(mirrorRoot, "discover", "output", "catalog.selected.jsonl"),
      entries
        .slice(0, 100)
        .map((entry) => JSON.stringify(entry))
        .join("\n") + "\n",
      "utf8",
    );

    const mirrorStartedAt = performance.now();
    await generateMirrorPlan(mirrorRoot);
    const mirrorElapsedMs = performance.now() - mirrorStartedAt;
    const plan = await readJsonFile<{ inputs?: { catalogEntries?: number } }>(
      join(mirrorRoot, "mirror", "audit", "mirror-plan.json"),
    );
    assert.equal(
      plan.inputs?.catalogEntries,
      BENCHMARK_CATALOG_SIZE,
      "mirror plan must read the full catalog",
    );
    assert.ok(
      mirrorElapsedMs < PATH_BUDGET_MS,
      `mirror plan exceeded budget: ${mirrorElapsedMs}ms`,
    );
    report.mirrorCatalogEntries = plan.inputs?.catalogEntries;
    report.mirrorElapsedMs = Math.round(mirrorElapsedMs);

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

await main();
