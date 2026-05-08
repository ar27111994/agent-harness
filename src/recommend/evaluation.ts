import { buildRecommendationReport } from "./report.js";
import type {
  RecommendationEntry,
  RecommendationEvaluationCheck,
  RecommendationEvaluationExpectation,
  RecommendationEvaluationFixture,
  RecommendationEvaluationFixtureResult,
  RecommendationEvaluationHostSummary,
  RecommendationEvaluationResult,
  RecommendationEvaluationSummary,
  RecommendationEvaluationTopConfidence,
  RecommendationPolicy,
  RecommendationReport,
} from "../types.js";

/**
 * Builds a persisted recommendation evaluation result for the provided fixtures.
 */
export function buildRecommendationEvaluationResult(
  fixtures: RecommendationEvaluationFixture[],
  policy: RecommendationPolicy,
): RecommendationEvaluationResult {
  const fixtureResults = fixtures.map((fixture) =>
    evaluateFixture(fixture, policy),
  );

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    summary: buildRecommendationEvaluationSummary(fixtureResults),
    fixtures: fixtureResults,
  };
}

/**
 * Builds aggregate quality metrics for evaluated fixtures.
 */
export function buildRecommendationEvaluationSummary(
  fixtureResults: RecommendationEvaluationFixtureResult[],
): RecommendationEvaluationSummary {
  const hostSummaries = fixtureResults.flatMap(
    (fixture) => fixture.hostSummaries,
  );
  const topReasonCounts: RecommendationEvaluationSummary["topReasonCounts"] = {
    exactStack: 0,
    ecosystem: 0,
    genericConcern: 0,
    none: 0,
  };
  const topConfidenceCounts: RecommendationEvaluationSummary["topConfidenceCounts"] =
    {
      mediumOrStrong: 0,
      weakOnly: 0,
      none: 0,
    };

  for (const hostSummary of hostSummaries) {
    const topReasonBucket = getTopReasonBucket(hostSummary);
    topReasonCounts[topReasonBucket] += 1;

    if (hostSummary.topConfidence === "medium-or-strong") {
      topConfidenceCounts.mediumOrStrong += 1;
    } else if (hostSummary.topConfidence === "weak-only") {
      topConfidenceCounts.weakOnly += 1;
    } else {
      topConfidenceCounts.none += 1;
    }
  }

  return {
    fixtureCount: fixtureResults.length,
    passedFixtureCount: fixtureResults.filter((fixture) => fixture.passed)
      .length,
    failedFixtureCount: fixtureResults.filter((fixture) => !fixture.passed)
      .length,
    evaluatedHostCount: hostSummaries.length,
    topReasonCounts,
    broadFallbackTopCount: hostSummaries.filter((hostSummary) =>
      isBroadFallbackTopRecommendation(hostSummary),
    ).length,
    localAvailabilityTopCount: hostSummaries.filter(
      (hostSummary) =>
        hostSummary.topRecommendationBasis === "local-availability",
    ).length,
    topConfidenceCounts,
  };
}

function evaluateFixture(
  fixture: RecommendationEvaluationFixture,
  policy: RecommendationPolicy,
): RecommendationEvaluationFixtureResult {
  const report = buildRecommendationReport(
    fixture.catalogEntries,
    fixture.demandProfile,
    policy,
  );
  const checks = fixture.expectations.flatMap((expectation) =>
    evaluateExpectation(expectation, report),
  );

  return {
    id: fixture.id,
    description: fixture.description,
    passed: checks.every((check) => check.passed),
    checks,
    hostSummaries: buildFixtureHostSummaries(fixture.expectations, report),
  };
}

function buildFixtureHostSummaries(
  expectations: RecommendationEvaluationExpectation[],
  report: RecommendationReport,
): RecommendationEvaluationHostSummary[] {
  const hosts = [
    ...new Set(expectations.map((expectation) => expectation.host)),
  ];

  return hosts.map((host) =>
    buildHostSummary(host, report.topByHost[host] ?? []),
  );
}

function buildHostSummary(
  host: RecommendationEvaluationHostSummary["host"],
  entries: RecommendationEntry[],
): RecommendationEvaluationHostSummary {
  const topEntry = entries[0];

  return {
    host,
    topAssetId: topEntry?.assetId ?? null,
    topReasons: topEntry?.reasons ?? [],
    topRecommendationBasis: topEntry?.recommendationBasis ?? null,
    topAvailableLocally: topEntry?.availableLocally ?? false,
    topConfidence: classifyTopRecommendationConfidence(topEntry),
    topCoverageTags: topEntry?.coverageTags ?? [],
  };
}

/**
 * Classifies how strong the top recommendation's matched evidence appears.
 */
export function classifyTopRecommendationConfidence(
  entry: RecommendationEntry | undefined,
): RecommendationEvaluationTopConfidence {
  if (!entry || entry.matchedSignals.length === 0) {
    return "none";
  }

  const hasMediumOrStrongEvidence = entry.matchedSignals.some((match) => {
    const evidenceCounts = match.evidenceStrengthCounts;
    return Boolean(
      (evidenceCounts?.strong ?? 0) > 0 || (evidenceCounts?.medium ?? 0) > 0,
    );
  });

  return hasMediumOrStrongEvidence ? "medium-or-strong" : "weak-only";
}

function getTopReasonBucket(
  hostSummary: RecommendationEvaluationHostSummary,
): keyof RecommendationEvaluationSummary["topReasonCounts"] {
  if (hostSummary.topReasons.includes("fit:exact-stack")) {
    return "exactStack";
  }

  if (hostSummary.topReasons.includes("fit:ecosystem")) {
    return "ecosystem";
  }

  if (hostSummary.topReasons.includes("fit:generic-concern")) {
    return "genericConcern";
  }

  return "none";
}

function isBroadFallbackTopRecommendation(
  hostSummary: RecommendationEvaluationHostSummary,
): boolean {
  if (!hostSummary.topReasons.includes("coverage-gap-fill")) {
    return false;
  }

  return (
    !hostSummary.topReasons.includes("fit:exact-stack") &&
    !hostSummary.topReasons.includes("fit:ecosystem")
  );
}

function evaluateExpectation(
  expectation: RecommendationEvaluationExpectation,
  report: RecommendationReport,
): RecommendationEvaluationCheck[] {
  const entries = report.topByHost[expectation.host] ?? [];
  const hostSummary = report.hostSummaries[expectation.host];
  const activationBudget = hostSummary?.activationBudget ?? 0;
  const bundle = report.suggestedBundles.find(
    (entry) => entry.host === expectation.host,
  );
  const checks: RecommendationEvaluationCheck[] = [];

  checks.push({
    name: `${expectation.host}-bundle-budget`,
    passed: Boolean(bundle && bundle.estimatedPromptWeight <= activationBudget),
    details: bundle
      ? `bundle weight ${bundle.estimatedPromptWeight}/${activationBudget}`
      : "missing bundle",
  });

  for (const requiredAssetId of expectation.requiredAssetIds ?? []) {
    const present = entries.some((entry) => entry.assetId === requiredAssetId);
    checks.push({
      name: `${expectation.host}-requires-${requiredAssetId}`,
      passed: present,
      details: present ? "present" : `missing from ${expectation.host}`,
    });
  }

  for (const requiredKind of expectation.requiredAssetKinds ?? []) {
    const actualCount = entries.filter(
      (entry) => entry.assetKind === requiredKind.assetKind,
    ).length;
    checks.push({
      name: `${expectation.host}-kind-${requiredKind.assetKind}`,
      passed: actualCount >= requiredKind.minimum,
      details: `found ${actualCount}, required ${requiredKind.minimum}`,
    });
  }

  if (expectation.maxPerSourceFamily !== undefined) {
    const topSourceFamilyCount = Math.max(
      0,
      ...Object.values(hostSummary?.bySourceFamily ?? {}),
    );
    checks.push({
      name: `${expectation.host}-source-diversity`,
      passed: topSourceFamilyCount <= expectation.maxPerSourceFamily,
      details: `largest source family count ${topSourceFamilyCount}, expected <= ${expectation.maxPerSourceFamily}`,
    });
  }

  for (const concern of expectation.requiredConcerns ?? []) {
    const actualCount = hostSummary?.byConcern?.[concern] ?? 0;
    checks.push({
      name: `${expectation.host}-concern-${concern}`,
      passed: actualCount > 0,
      details: actualCount > 0 ? `present ${actualCount} times` : "missing",
    });
  }

  for (const pair of expectation.rankedAbove ?? []) {
    const higherRank =
      entries.find((entry) => entry.assetId === pair.higherAssetId)?.rank ??
      null;
    const lowerRank =
      entries.find((entry) => entry.assetId === pair.lowerAssetId)?.rank ??
      null;
    const passed =
      higherRank !== null && lowerRank !== null && higherRank < lowerRank;
    checks.push({
      name: `${expectation.host}-rank-${pair.higherAssetId}-above-${pair.lowerAssetId}`,
      passed,
      details:
        higherRank === null || lowerRank === null
          ? `missing ranks higher=${higherRank ?? "absent"} lower=${lowerRank ?? "absent"}`
          : `higher rank ${higherRank}, lower rank ${lowerRank}`,
    });
  }

  return checks;
}
