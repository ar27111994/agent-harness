import { join } from "node:path";

import { readJsonFile, writeJsonFile } from "../files.js";
import { getOptionValue } from "../lib/cli-options.js";
import { assertRecommendationReport } from "../manifest-validation.js";
import { buildRecommendationFixtures } from "../recommend-fixtures.js";
import { EVALUATION_FILE_PATH, REPORT_FILE_PATH } from "./constants.js";
import { getRecommendationHosts, isRecommendationHost } from "./hosts.js";
import { loadRecommendationPolicy } from "./policy.js";
import {
  buildRecommendationReport,
  writeRecommendationReport,
} from "./report.js";
import type { RecommendationHost } from "./hosts.js";
import type {
  RecommendationEvaluationCheck,
  RecommendationEvaluationExpectation,
  RecommendationEvaluationFixture,
  RecommendationEvaluationResult,
  RecommendationPolicy,
  RecommendationReport,
  RecommendationScoreBreakdown,
  RecommendationSignalMatch,
} from "../types.js";

/**
 * Dispatches the recommend CLI command group.
 */
export async function runRecommend(
  args: string[],
  _workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [command = "report", ...rest] = args;

  switch (command) {
    case "report": {
      const report = await writeRecommendationReport(projectRoot);
      const totalEntries = Object.values(report.topByHost).reduce(
        (total, entries) => total + entries.length,
        0,
      );
      console.log(
        `Recommendation report written to ${join(projectRoot, ...REPORT_FILE_PATH)} (${totalEntries} ranked entries)`,
      );
      return 0;
    }
    case "explain":
      await explainRecommendation(projectRoot, rest);
      return 0;
    case "evaluate": {
      const exitCode = await evaluateRecommendationFixtures(projectRoot, rest);
      return exitCode;
    }
    case "policy:print":
      await printRecommendationPolicy(projectRoot, rest);
      return 0;
    case "help":
      printRecommendHelp();
      return 0;
    default:
      printRecommendHelp();
      return 1;
  }
}

async function explainRecommendation(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const assetId = getOptionValue(args, "--asset") ?? args[0];
  const requestedHostRaw = getOptionValue(args, "--host");

  if (!assetId) {
    throw new Error("recommend explain requires --asset <assetId>");
  }

  const report = await readJsonFile<RecommendationReport>(
    join(projectRoot, ...REPORT_FILE_PATH),
    assertRecommendationReport,
  );

  let requestedHost: RecommendationHost | undefined;
  if (requestedHostRaw !== undefined) {
    if (!isRecommendationHost(requestedHostRaw)) {
      throw new Error(
        `Invalid --host value: ${requestedHostRaw}. Must be one of: ${getRecommendationHosts().join(", ")}`,
      );
    }
    requestedHost = requestedHostRaw;
  }

  const hosts = requestedHost ? [requestedHost] : getRecommendationHosts();
  const lines: string[] = [];

  for (const host of hosts) {
    const entry = report.topByHost[host].find(
      (candidate) => candidate.assetId === assetId,
    );
    if (!entry) {
      continue;
    }

    lines.push(`Host: ${host}`);
    lines.push(`  rank: ${entry.rank}`);
    lines.push(`  score: ${entry.score}`);
    lines.push(`  asset kind: ${entry.assetKind ?? "unknown"}`);
    lines.push(`  source: ${entry.sourceId} (${entry.sourceFamily})`);
    lines.push(`  recommendation basis: ${entry.recommendationBasis}`);
    lines.push(`  available locally: ${entry.availableLocally ? "yes" : "no"}`);
    lines.push(
      `  prompt weight: ${entry.estimatedPromptWeight} (${entry.contextSizeClass})`,
    );
    lines.push(`  coverage: ${entry.coverageTags.join(", ") || "none"}`);
    lines.push(`  task modes: ${entry.taskModes.join(", ") || "none"}`);
    lines.push(
      `  matched signals: ${formatMatchedSignals(entry.matchedSignals)}`,
    );
    lines.push(`  reasons: ${entry.reasons.join(", ")}`);
    lines.push(`  breakdown: ${formatScoreBreakdown(entry.scoreBreakdown)}`);
  }

  if (lines.length === 0) {
    console.log(
      `Asset ${assetId} is not present in the current recommendation report.`,
    );
    return;
  }

  console.log(lines.join("\n"));
}

async function evaluateRecommendationFixtures(
  projectRoot: string,
  args: string[],
): Promise<number> {
  const shouldWrite = args.includes("--write");
  const policy = await loadRecommendationPolicy(projectRoot);
  const fixtures = buildRecommendationFixtures();
  const results = fixtures.map((fixture) => evaluateFixture(fixture, policy));
  const evaluationResult: RecommendationEvaluationResult = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    fixtures: results,
  };

  if (shouldWrite) {
    await writeJsonFile(
      join(projectRoot, ...EVALUATION_FILE_PATH),
      evaluationResult,
    );
  }

  let hasFailures = false;
  for (const result of results) {
    console.log(
      `${result.passed ? "PASS" : "FAIL"} ${result.id}: ${result.description}`,
    );
    for (const check of result.checks) {
      console.log(
        `  ${check.passed ? "-" : "x"} ${check.name}: ${check.details}`,
      );
    }
    if (!result.passed) {
      hasFailures = true;
    }
  }

  return hasFailures ? 1 : 0;
}

async function printRecommendationPolicy(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const requestedHost = getOptionValue(args, "--host");
  const pretty = !args.includes("--compact");
  const policy = await loadRecommendationPolicy(projectRoot);

  if (!requestedHost) {
    console.log(JSON.stringify(policy, null, pretty ? 2 : undefined));
    return;
  }

  if (!isRecommendationHost(requestedHost)) {
    throw new Error(
      `recommend policy:print requires --host to be one of: ${getRecommendationHosts().join(", ")}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        schemaVersion: policy.schemaVersion,
        host: requestedHost,
        scoring: policy.scoring,
        hostPolicy: policy.hosts[requestedHost],
        concernKeywordMap: policy.concernKeywordMap,
        taskModeKeywordMap: policy.taskModeKeywordMap,
        domainKeywordGroups: policy.domainKeywordGroups,
        synonyms: policy.synonyms,
      },
      null,
      pretty ? 2 : undefined,
    ),
  );
}

function evaluateFixture(
  fixture: RecommendationEvaluationFixture,
  policy: RecommendationPolicy,
): RecommendationEvaluationResult["fixtures"][number] {
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
  };
}

function evaluateExpectation(
  expectation: RecommendationEvaluationExpectation,
  report: RecommendationReport,
): RecommendationEvaluationCheck[] {
  const entries = report.topByHost[expectation.host] ?? [];
  const hostSummary = report.hostSummaries[expectation.host];
  const bundle = report.suggestedBundles.find(
    (entry) => entry.host === expectation.host,
  );
  const checks: RecommendationEvaluationCheck[] = [];

  checks.push({
    name: `${expectation.host}-bundle-budget`,
    passed: Boolean(
      bundle && bundle.estimatedPromptWeight <= hostSummary.activationBudget,
    ),
    details: bundle
      ? `bundle weight ${bundle.estimatedPromptWeight}/${hostSummary.activationBudget}`
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
      ...Object.values(hostSummary.bySourceFamily),
    );
    checks.push({
      name: `${expectation.host}-source-diversity`,
      passed: topSourceFamilyCount <= expectation.maxPerSourceFamily,
      details: `largest source family count ${topSourceFamilyCount}, expected <= ${expectation.maxPerSourceFamily}`,
    });
  }

  for (const concern of expectation.requiredConcerns ?? []) {
    const actualCount = hostSummary.byConcern[concern] ?? 0;
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

function formatMatchedSignals(matches: RecommendationSignalMatch[]): string {
  if (matches.length === 0) {
    return "none";
  }

  return matches
    .map((match) => {
      const evidenceCounts = match.evidenceStrengthCounts;
      const evidenceSummary = evidenceCounts
        ? `,s=${evidenceCounts.strong}/m=${evidenceCounts.medium}/w=${evidenceCounts.weak}`
        : "";
      const weightedEvidenceSummary =
        match.weightedEvidenceCount === undefined
          ? ""
          : `,ew=${match.weightedEvidenceCount}`;

      return `${match.signalType}:${match.term}(w=${match.weight},e=${match.evidenceCount}${weightedEvidenceSummary}${evidenceSummary})`;
    })
    .join(", ");
}

function formatScoreBreakdown(breakdown: RecommendationScoreBreakdown): string {
  return [
    `authority=${breakdown.authority}`,
    `compatibility=${breakdown.compatibility}`,
    `portfolioFit=${breakdown.portfolioFit}`,
    `trust=${breakdown.trust}`,
    `sourcePriority=${breakdown.sourcePriority}`,
    `demand=${breakdown.demand}`,
    `hostPreference=${breakdown.hostPreference}`,
    `coverage=${breakdown.coverage}`,
    `diversity=${breakdown.diversity}`,
    `freshness=${breakdown.freshness}`,
    `costPenalty=${breakdown.costPenalty}`,
    `riskPenalty=${breakdown.riskPenalty}`,
    `negativePenalty=${breakdown.negativePenalty}`,
    `redundancyPenalty=${breakdown.redundancyPenalty}`,
    `budgetPenalty=${breakdown.budgetPenalty}`,
    `total=${breakdown.total}`,
  ].join(", ");
}

function printRecommendHelp(): void {
  console.log(`recommend commands:
  report    Recompute the recommendation report using the external policy (default)
  explain   Explain why an asset ranked for a host
  evaluate  Run golden recommendation fixtures (use --write to persist results)
  policy:print  Print the merged effective policy (--host <host> to scope)`);
}
