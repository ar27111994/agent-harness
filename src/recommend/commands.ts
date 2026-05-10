import { join } from "node:path";

import { readJsonFile, writeJsonFile } from "../files.js";
import { getOptionValue } from "../lib/cli-options.js";
import {
  parseSessionIntent,
  SESSION_INTENT_CHOICES,
} from "../lib/session-intent.js";
import { assertRecommendationReport } from "../manifest-validation.js";
import { buildRecommendationFixtures } from "../recommend-fixtures.js";
import { EVALUATION_FILE_PATH, REPORT_FILE_PATH } from "./constants.js";
import { buildRecommendationEvaluationResult } from "./evaluation.js";
import { getRecommendationHosts, isRecommendationHost } from "./hosts.js";
import { loadRecommendationPolicy } from "./policy.js";
import { writeRecommendationReport } from "./report.js";
import { runRecommendationAiReview } from "./ai-review.js";
import type { RecommendationHost } from "./hosts.js";
import type {
  RecommendationEvaluationResult,
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
      const shouldRunAiReview = rest.includes("--ai-review");
      const sessionIntent = parseSessionIntent(
        getOptionValue(rest, "--intent"),
      );
      const policy = shouldRunAiReview
        ? await loadRecommendationPolicy(projectRoot)
        : undefined;
      const deterministicReport = await writeRecommendationReport(projectRoot, {
        policy,
        sessionIntent,
      });
      const report =
        shouldRunAiReview && policy
          ? (
              await runRecommendationAiReview({
                projectRoot,
                policy,
                report: deterministicReport,
                host: getRequestedReviewHost(rest),
                reviewLimit: getReviewLimit(rest),
                apply: true,
              })
            ).report
          : deterministicReport;
      if (report !== deterministicReport) {
        await writeJsonFile(join(projectRoot, ...REPORT_FILE_PATH), report);
      }
      const totalEntries = Object.values(report.topByHost).reduce(
        (total, entries) => total + entries.length,
        0,
      );
      console.log(
        `Recommendation report written to ${join(projectRoot, ...REPORT_FILE_PATH)} (${totalEntries} ranked entries)`,
      );
      if (rest.includes("--ai-review")) {
        console.log(
          `AI review artifacts written under ${join(projectRoot, "recommend", "output")}`,
        );
      }
      return 0;
    }
    case "explain":
      await explainRecommendation(projectRoot, rest);
      return 0;
    case "evaluate": {
      const exitCode = await evaluateRecommendationFixtures(projectRoot, rest);
      return exitCode;
    }
    case "ai-review": {
      const policy = await loadRecommendationPolicy(projectRoot);
      const sessionIntent = parseSessionIntent(
        getOptionValue(rest, "--intent"),
      );
      const deterministicReport = await writeRecommendationReport(projectRoot, {
        policy,
        sessionIntent,
      });
      const result = await runRecommendationAiReview({
        projectRoot,
        policy,
        report: deterministicReport,
        host: getRequestedReviewHost(rest),
        reviewLimit: getReviewLimit(rest),
        apply: rest.includes("--apply"),
      });
      if (rest.includes("--apply")) {
        await writeJsonFile(
          join(projectRoot, ...REPORT_FILE_PATH),
          result.report,
        );
      }
      console.log(
        `AI review artifact written to ${join(projectRoot, "recommend", "output", "ai-review.json")}`,
      );
      if (rest.includes("--apply")) {
        console.log(
          `Applied AI review adjustments to ${join(projectRoot, ...REPORT_FILE_PATH)}`,
        );
      }
      return 0;
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
  const evaluationResult: RecommendationEvaluationResult =
    buildRecommendationEvaluationResult(fixtures, policy);

  if (shouldWrite) {
    await writeJsonFile(
      join(projectRoot, ...EVALUATION_FILE_PATH),
      evaluationResult,
    );
  }

  let hasFailures = false;
  for (const result of evaluationResult.fixtures) {
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

  const { summary } = evaluationResult;
  console.log("Summary:");
  console.log(
    `  fixtures: ${summary.passedFixtureCount}/${summary.fixtureCount} passed (${summary.failedFixtureCount} failed)`,
  );
  console.log(`  evaluated hosts: ${summary.evaluatedHostCount}`);
  console.log(
    `  top reason mix: exact=${summary.topReasonCounts.exactStack}, ecosystem=${summary.topReasonCounts.ecosystem}, generic=${summary.topReasonCounts.genericConcern}, none=${summary.topReasonCounts.none}`,
  );
  console.log(
    `  top confidence: medium-or-strong=${summary.topConfidenceCounts.mediumOrStrong}, weak-only=${summary.topConfidenceCounts.weakOnly}, none=${summary.topConfidenceCounts.none}`,
  );
  console.log(
    `  broad fallback tops: ${summary.broadFallbackTopCount}, local-availability tops: ${summary.localAvailabilityTopCount}`,
  );

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

function getRequestedReviewHost(
  args: string[],
): RecommendationHost | undefined {
  const requestedHostRaw = getOptionValue(args, "--host");
  if (!requestedHostRaw) {
    return undefined;
  }

  if (!isRecommendationHost(requestedHostRaw)) {
    throw new Error(
      `Invalid --host value: ${requestedHostRaw}. Must be one of: ${getRecommendationHosts().join(", ")}`,
    );
  }

  return requestedHostRaw;
}

function getReviewLimit(args: string[]): number | undefined {
  const reviewLimitRaw = getOptionValue(args, "--review-limit");
  if (!reviewLimitRaw) {
    return undefined;
  }

  const reviewLimit = Number.parseInt(reviewLimitRaw, 10);
  if (!Number.isFinite(reviewLimit) || reviewLimit <= 0) {
    throw new Error(`Invalid --review-limit value: ${reviewLimitRaw}`);
  }

  return reviewLimit;
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
  ai-review Run bounded recommendation-native AI review (--apply to rewrite report)
  explain   Explain why an asset ranked for a host
  evaluate  Run golden recommendation fixtures and print quality summary metrics (use --write to persist results)
  policy:print  Print the merged effective policy (--host <host> to scope)

Recommendation options:
  --intent <${SESSION_INTENT_CHOICES}>

AI review options:
  --host <host>
  --review-limit <n>
  --apply
  --ai-review (for recommend report)`);
}
