import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { selectActivationCandidates } from "../activate/selection.js";
import { filterCatalogEntriesByDemandRelevance } from "../domains/discovery/catalog-selection.js";
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
// Review: 10x catalog with a 60s budget — proves no quadratic blowup on the
// selection/ranking hot path; linearity factor absorbs first-run caches.
const SCALE_CATALOG_SIZE = 10_000;
const SCALE_BUDGET_MS = 60_000;
const SCALE_LINEARITY_FACTOR = 15;

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
    // 10,000-entry scale case (review): selection/ranking is the O(n·m)-ish
    // hot path; the 1,000-entry budget above proves the rate, this bounded
    // run proves the full pipeline survives an order-of-magnitude larger
    // pool without quadratic blowup (generous budget, hard non-empty guard).
    // ------------------------------------------------------------------
    const scaleEntries = Array.from(
      { length: SCALE_CATALOG_SIZE },
      (_, index) => buildCatalogEntry(index),
    );
    const scaleStartedAt = performance.now();
    const scaleReport: RecommendationReport = buildRecommendationReport(
      scaleEntries,
      demandProfile,
      policy,
      "general",
    );
    const scaleElapsedMs = performance.now() - scaleStartedAt;
    assert.ok(
      scaleReport.recommendations.length > 0,
      "scale recommend must rank at least one entry",
    );
    assert.ok(
      scaleElapsedMs < SCALE_BUDGET_MS,
      `scale recommend exceeded budget (${scaleElapsedMs}ms for ${SCALE_CATALOG_SIZE} entries)`,
    );
    // The 1K baseline is a rate gate, not a linearity denominator: when the
    // baseline is tiny (fast machine, warm caches), the ratio `10K / 1K`
    // is dominated by fixed overhead and would flag healthy runs as
    // super-linear. The denominator is floored at a minimum baseline
    // duration; the absolute 60s scale budget above remains the hard bound
    // (review).
    const MIN_LINEARITY_BASELINE_MS = 250;
    assert.ok(
      scaleElapsedMs <
        Math.max(recommendElapsedMs, MIN_LINEARITY_BASELINE_MS) *
          SCALE_LINEARITY_FACTOR,
      `scale recommend looks super-linear: 1K=${Math.round(recommendElapsedMs)}ms, 10K=${Math.round(scaleElapsedMs)}ms (allow ${SCALE_LINEARITY_FACTOR}× for cache/GC noise)`,
    );
    report.scaleCatalogSize = SCALE_CATALOG_SIZE;
    report.scaleRecommendElapsedMs = Math.round(scaleElapsedMs);

    // ------------------------------------------------------------------
    // Selection scale case (review T1): demand-relevance filtering is the
    // hottest per-run path (every discover/recommend invocation classifies
    // the whole catalog), but the only "large" test was 210 entries with
    // no budget. A 10K-entry run under a generous budget with a hard
    // non-empty guard gives a super-linear regression a tripwire.
    // ------------------------------------------------------------------
    const SELECTION_CATALOG_SIZE = 10_000;
    const SELECTION_BUDGET_MS = 10_000;
    const selectionEntries = Array.from(
      { length: SELECTION_CATALOG_SIZE },
      (_, index) => {
        const entry = buildCatalogEntry(index);
        // A RARE identity token (2% of the catalog, well under the 20%
        // catalog-common share) so the demand term classifies as an exact
        // high-signal term instead of being demoted to low — with
        // homogeneous fixtures every term is catalog-common.
        entry.capabilities = [
          ...entry.capabilities,
          ...(index % 50 === 0 ? ["duckdb-probe"] : []),
        ];
        return entry;
      },
    );
    const selectionDemandProfile: DemandProfile = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scanRoot: "C:/fixture",
      summary: {
        scannedFiles: 1,
        matchedFiles: 1,
      },
      signals: {
        languages: [],
        packageManagers: [],
        frameworks: [],
        concerns: [],
        tooling: ["duckdb-probe"],
      },
      evidence: [
        {
          path: "package.json",
          fileName: "package.json",
          matchedSignals: {
            languages: [],
            packageManagers: [],
            frameworks: [],
            concerns: [],
            tooling: ["duckdb-probe"],
          },
        },
      ],
    };
    const selectionStartedAt = performance.now();
    const { selectedEntries, rejectedEntries } =
      filterCatalogEntriesByDemandRelevance(
        selectionEntries,
        selectionDemandProfile,
      );
    const selectionElapsedMs = performance.now() - selectionStartedAt;
    assert.ok(
      selectedEntries.length + rejectedEntries.length ===
        SELECTION_CATALOG_SIZE,
      "demand relevance must classify every entry",
    );
    assert.equal(
      selectedEntries.length,
      Math.floor(SELECTION_CATALOG_SIZE / 50),
      "exactly the entries carrying the rare demand token must be selected",
    );
    assert.ok(
      rejectedEntries.length > 0,
      "entries without the demand token must be rejected",
    );
    assert.ok(
      selectionElapsedMs < SELECTION_BUDGET_MS,
      `selection exceeded budget (${selectionElapsedMs}ms for ${SELECTION_CATALOG_SIZE} entries)`,
    );
    report.selectionCatalogSize = SELECTION_CATALOG_SIZE;
    report.selectionRelevantEntries = selectedEntries.length;
    report.selectionElapsedMs = Math.round(selectionElapsedMs);

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
