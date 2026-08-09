import { join } from "node:path";

import { getRuntimeConfig } from "../config/runtime.js";
import { readJsonFile, readJsonFileOrNull, writeJsonFile } from "../files.js";
import { printCommandHelp } from "../lib/cli-output.js";
import { getOptionValue, getOptionValues } from "../lib/cli-options.js";
import {
  CliUsageError,
  hasHelpFlag,
  hasUnknownFlagsForSubcommands,
  isFlagLike,
  printSubcommandHelp,
  printUnknownArgumentError,
  type SubcommandHelpEntry,
} from "../cli-help-format.js";
import { RECOMMEND_SUBCOMMAND_FLAG_SPECS } from "../cli-flag-specs.js";
import {
  parseSessionIntent,
  SESSION_INTENT_CHOICES,
} from "../lib/session-intent.js";
import {
  assertQuarantineStateReport,
  assertRecommendationReport,
  assertSelectionReport,
} from "../manifest-validation.js";
import { buildRecommendationFixtures } from "../recommend-fixtures.js";
import { EVALUATION_FILE_PATH, REPORT_FILE_PATH } from "./constants.js";
import { buildRecommendationEvaluationResult } from "./evaluation.js";
import {
  formatRecommendationHostForDisplay,
  getRecommendationHostChoices,
  getRecommendationHosts,
  resolveRecommendationHost,
} from "./hosts.js";
import { loadRecommendationPolicy } from "./policy.js";
import { CatalogEmptyError, writeRecommendationReport } from "./report.js";
import { runRecommendationAiReview } from "./ai-review.js";
import type { RecommendationHost } from "./hosts.js";
import type {
  QuarantineStateReport,
  RecommendationEntry,
  RecommendationEvaluationResult,
  RecommendationReport,
  RecommendationScoreBreakdown,
  RecommendationSignalMatch,
  SelectionReport,
  SessionIntent,
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

  // Subcommand-specific help is routed through
  // printRecommendSubcommandHelp which falls back to printRecommendHelp
  // for unknown subcommands — no separate hasSpecificHelp set needed.
  // (#416 — recommend report/evaluate/ai-review/policy:print --help)
  if (hasHelpFlag(rest)) {
    printRecommendSubcommandHelp(command);
    return 0;
  }

  // Strict flag validation before any recommendation work (#445). Unknown
  // subcommands have no spec entry and fall through to the default handler.
  if (
    hasUnknownFlagsForSubcommands(
      RECOMMEND_SUBCOMMAND_FLAG_SPECS,
      command,
      rest,
    )
  ) {
    return 1;
  }

  switch (command) {
    case "report": {
      const shouldRunAiReview = rest.includes("--ai-review");
      const sessionIntents = parseSessionIntents(rest);
      const policy = shouldRunAiReview
        ? await loadRecommendationPolicy(projectRoot)
        : undefined;
      console.log(
        `Building recommendation report for intents: ${sessionIntents.join(", ")}`,
      );
      let deterministicReport;
      try {
        deterministicReport = await writeRecommendationReport(projectRoot, {
          policy,
          sessionIntents,
        });
      } catch (err) {
        if (err instanceof CatalogEmptyError) {
          process.stderr.write(`error: ${err.message}\n`);
          return 1;
        }
        throw err;
      }
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
      const sessionIntents = parseSessionIntents(rest);
      console.log(
        `Building recommendation report for intents: ${sessionIntents.join(", ")}`,
      );
      let deterministicReport;
      try {
        deterministicReport = await writeRecommendationReport(projectRoot, {
          policy,
          sessionIntents,
        });
      } catch (err) {
        if (err instanceof CatalogEmptyError) {
          process.stderr.write(`error: ${err.message}\n`);
          return 1;
        }
        throw err;
      }
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
      if (isFlagLike(command)) {
        printUnknownArgumentError(command);
        return 1;
      }
      printRecommendHelp();
      return 1;
  }
}

async function explainRecommendation(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const assetId = getOptionValue(args, "--asset");
  const json = args.includes("--json");
  const requestedHostRaw = getOptionValue(args, "--host");

  // Resolve assetId: prefer --asset flag, then fall back to the first
  // positional arg that is not consumed by a value-taking flag (--host).
  const valueFlagIndices = new Set<number>();
  for (const flag of ["--host", "--asset"]) {
    const idx = args.indexOf(flag);
    if (idx >= 0 && idx + 1 < args.length) valueFlagIndices.add(idx + 1);
  }
  const resolvedAssetId =
    assetId ??
    args.find((arg, i) => !arg.startsWith("--") && !valueFlagIndices.has(i));

  if (!resolvedAssetId) {
    const note = json
      ? " (note: --json is a format flag, not an asset ID)"
      : "";
    throw new CliUsageError(
      `recommend explain requires --asset <assetId>${note}`,
      "agent-harness recommend explain --help",
    );
  }

  const report = await readJsonFile<RecommendationReport>(
    join(projectRoot, ...REPORT_FILE_PATH),
    assertRecommendationReport,
  );

  let requestedHost: RecommendationHost | undefined;
  if (requestedHostRaw !== undefined) {
    requestedHost = resolveRecommendationHost(requestedHostRaw);
    if (!requestedHost) {
      throw new CliUsageError(
        `Invalid --host value: ${requestedHostRaw}. Must be one of: ${getRecommendationHostChoices().join(", ")}`,
        "agent-harness recommend explain --help",
      );
    }
  }

  const selectionReport = await readJsonFileOrNull<SelectionReport>(
    join(projectRoot, "discover", "output", "selection-report.json"),
    assertSelectionReport,
  );
  const quarantineReport = await readJsonFileOrNull<QuarantineStateReport>(
    join(projectRoot, "state", "quarantine", "quarantine-state.json"),
    assertQuarantineStateReport,
  );
  const explanations = buildRecommendationExplanations({
    report,
    assetId: resolvedAssetId,
    hosts: requestedHost ? [requestedHost] : getRecommendationHosts(),
    selectionReport,
    quarantineReport,
  });

  if (json) {
    console.log(
      JSON.stringify({ assetId: resolvedAssetId, explanations }, null, 2),
    );
    return;
  }

  const lines: string[] = [];

  for (const explanation of explanations) {
    if (explanation.state !== "selected") {
      lines.push(
        `Host: ${formatRecommendationHostForDisplay(explanation.host)} (${explanation.state})`,
      );
      lines.push(`  reason: ${explanation.reason}`);
      continue;
    }

    const { entry } = explanation;

    lines.push(`Host: ${formatRecommendationHostForDisplay(explanation.host)}`);
    lines.push(`  rank: ${entry.rank}`);
    lines.push(`  score: ${entry.score}`);
    lines.push(`  asset kind: ${entry.assetKind ?? "unknown"}`);
    if (entry.classificationConfidence !== undefined) {
      lines.push(
        `  classification confidence: ${entry.classificationConfidenceLevel ?? "unknown"} (${entry.classificationConfidence})`,
      );
    }
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
      `Asset ${resolvedAssetId} is not present in the current recommendation report or explainability sidecars.`,
    );
    return;
  }

  console.log(lines.join("\n"));
}

type RecommendationExplanation =
  | {
      host: RecommendationHost;
      state: "selected";
      reason: string;
      entry: RecommendationEntry;
    }
  | {
      host: RecommendationHost;
      state: "rejected" | "quarantined" | "budget-pruned";
      reason: string;
    };

function buildRecommendationExplanations(input: {
  report: RecommendationReport;
  assetId: string;
  hosts: RecommendationHost[];
  selectionReport: SelectionReport | null;
  quarantineReport: QuarantineStateReport | null;
}): RecommendationExplanation[] {
  const explanations: RecommendationExplanation[] = [];
  const quarantineEntry = input.quarantineReport?.entries.find(
    (entry) => entry.assetId === input.assetId,
  );
  const duplicateDecision = input.selectionReport?.duplicateDecisions.find(
    (decision) => decision.rejectedAssetIds.includes(input.assetId),
  );

  for (const host of input.hosts) {
    const entry = input.report.topByHost[host].find(
      (candidate) => candidate.assetId === input.assetId,
    );
    if (entry) {
      explanations.push({
        host,
        state: "selected",
        reason: buildSelectedRecommendationReason(entry),
        entry,
      });
      continue;
    }

    const suggestedBundle = input.report.suggestedBundles.find(
      (bundle) =>
        bundle.host === host &&
        (bundle.budgetPrunedAssetIds?.includes(input.assetId) ?? false),
    );
    const prunedAsset = suggestedBundle?.budgetPrunedAssets?.find(
      (asset) => asset.assetId === input.assetId,
    );
    if (suggestedBundle) {
      explanations.push({
        host,
        state: "budget-pruned",
        reason:
          prunedAsset?.reason ??
          `Asset was ranked for ${host} but excluded from suggested bundle ${suggestedBundle.bundleId} by activation budget ${suggestedBundle.activationBudget ?? "unknown"}.`,
      });
      continue;
    }

    if (quarantineEntry) {
      explanations.push({
        host,
        state: "quarantined",
        reason: `${quarantineEntry.reason} Suggested action: ${quarantineEntry.suggestedAction}.`,
      });
      continue;
    }

    if (duplicateDecision) {
      explanations.push({
        host,
        state: "rejected",
        reason: `Rejected during discovery selection as duplicate of ${duplicateDecision.selectedAssetId}: ${duplicateDecision.selectionReason}`,
      });
    }
  }

  return explanations;
}

function buildSelectedRecommendationReason(entry: RecommendationEntry): string {
  const signalSummary = formatMatchedSignals(entry.matchedSignals);
  return [
    `rank ${entry.rank} with score ${entry.score}`,
    `basis ${entry.recommendationBasis}`,
    `trust/source ${entry.sourceFamily}`,
    `signals ${signalSummary}`,
    `reasons ${entry.reasons.join(", ")}`,
  ].join("; ");
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
  if (summary.broadFallbackHosts.length > 0) {
    console.log(
      `  broad fallback hosts: ${summary.broadFallbackHosts.join(", ")}`,
    );
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

  const resolvedHost = resolveRecommendationHost(requestedHost);
  if (!resolvedHost) {
    throw new CliUsageError(
      `recommend policy:print requires --host to be one of: ${getRecommendationHostChoices().join(", ")}`,
      "agent-harness recommend policy:print --help",
    );
  }

  const recommendationRuntime = getRuntimeConfig().recommendation;
  const limitOverride = recommendationRuntime.limitOverrides[resolvedHost];
  const modeOverride = recommendationRuntime.limitOverrideModes[resolvedHost];
  const hostPolicy = policy.hosts[resolvedHost];

  console.log(
    JSON.stringify(
      {
        schemaVersion: policy.schemaVersion,
        host: formatRecommendationHostForDisplay(resolvedHost),
        scoring: policy.scoring,
        hostPolicy,
        runtimeOverrides: {
          recommendationLimitSource: limitOverride ? "env" : "policy",
          recommendationLimitEnvVar: limitOverride?.envVar,
          recommendationLimitOverrideMode:
            resolveRecommendationLimitOverrideMode(hostPolicy),
          recommendationLimitOverrideModeSource: modeOverride
            ? "env"
            : "policy",
          recommendationLimitOverrideModeEnvVar: modeOverride?.envVar,
          scalingApplied:
            (hostPolicy.recommendationLimitScaledFields?.length ?? 0) > 0,
          recommendationLimitScaleFactor:
            hostPolicy.recommendationLimitScaleFactor,
          recommendationLimitScaledFields:
            hostPolicy.recommendationLimitScaledFields,
        },
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

function resolveRecommendationLimitOverrideMode(hostPolicy: {
  recommendationLimitOverrideMode?: string;
}): string {
  return hostPolicy.recommendationLimitOverrideMode ?? "preserve";
}

/**
 * Exposes narrow recommendation command helpers for focused tests.
 */
export const recommendCommandInternals = {
  buildRecommendationExplanations,
  resolveRecommendationLimitOverrideMode,
};

function getRequestedReviewHost(
  args: string[],
): RecommendationHost | undefined {
  const requestedHostRaw = getOptionValue(args, "--host");
  if (!requestedHostRaw) {
    return undefined;
  }

  const requestedHost = resolveRecommendationHost(requestedHostRaw);
  if (!requestedHost) {
    throw new CliUsageError(
      `Invalid --host value: ${requestedHostRaw}. Must be one of: ${getRecommendationHostChoices().join(", ")}`,
      "agent-harness recommend report --help",
    );
  }

  return requestedHost;
}

function parseSessionIntents(args: string[]): readonly SessionIntent[] {
  const rawValues = getOptionValues(args, "--intent");
  if (rawValues.length === 0) {
    return ["general"];
  }

  return rawValues.map((v) => parseSessionIntent(v));
}

function getReviewLimit(args: string[]): number | undefined {
  const reviewLimitRaw = getOptionValue(args, "--review-limit");
  if (!reviewLimitRaw) {
    return undefined;
  }

  const reviewLimit = Number.parseInt(reviewLimitRaw, 10);
  if (!Number.isFinite(reviewLimit) || reviewLimit <= 0) {
    throw new CliUsageError(
      `Invalid --review-limit value: ${reviewLimitRaw}`,
      "agent-harness recommend report --help",
    );
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
  printCommandHelp({
    heading: "recommend commands:",
    entries: [
      {
        command: "report",
        description:
          "Recompute the recommendation report using the external policy (default)",
      },
      {
        command: "ai-review",
        description:
          "Run bounded recommendation-native AI review (--apply to rewrite report)",
      },
      {
        command: "explain",
        description:
          "Explain why an asset was selected, rejected, quarantined, or budget-pruned (--json for agents)",
      },
      {
        command: "evaluate",
        description:
          "Run golden recommendation fixtures and print quality summary metrics (use --write to persist results)",
      },
      {
        command: "policy:print",
        description:
          "Print the merged effective policy (--host <host> to scope)",
      },
    ],
    sections: [
      {
        title: "Recommendation options:",
        lines: [
          `--intent <${SESSION_INTENT_CHOICES}> Repeatable; multiple intents are merged additively`,
        ],
      },
      {
        title: "Explain options:",
        lines: [
          "--asset <assetId>  Asset ID to explain (required)",
          "--host <host>      Scope explanation to a specific host",
          "--json             Output machine-readable JSON format",
        ],
      },
      {
        title: "AI review options:",
        lines: [
          `--host <${getRecommendationHostChoices().join("|")}>`,
          "--review-limit <n>",
          "--apply",
          "--ai-review (for recommend report)",
        ],
      },
    ],
  });
}

/**
 * Prints subcommand-specific help for recommend subcommands (#416).
 * Routes to printSubcommandHelp with per-subcommand headings and usage.
 */
function printRecommendSubcommandHelp(subcommand: string): void {
  const helpTexts: Record<string, SubcommandHelpEntry> = {
    report: {
      heading: "recommend report — Build a scored recommendation report",
      lines: [
        "Usage: agent-harness recommend report [--ai-review] [--host <host>] [--review-limit <n>] [--intent <intent>]",
        "",
        "Recomputes the recommendation report from the latest selected catalog",
        "and writes it to recommend/output/recommendation-report.json.",
        "",
        "Options:",
        "  --ai-review       Run AI review on the report after generation",
        `  --intent <intent>  Repeatable; intents: ${SESSION_INTENT_CHOICES}`,
        "  --host <host>     Scope AI review to a specific host",
        "  --review-limit <n> Limit AI review count",
      ],
    },
    explain: {
      heading:
        "recommend explain — Explain why an asset was selected, rejected, quarantined, or budget-pruned",
      lines: [
        "Usage: agent-harness recommend explain --asset <assetId> [--host <host>] [--json]",
        "",
        "Shows per-host explanation for the given asset from the latest",
        "recommendation report.",
        "",
        "Options:",
        "  --asset <assetId>  Asset ID to explain (required)",
        "  --host <host>      Scope explanation to a specific host",
        "  --json             Output machine-readable JSON format",
        "",
        "Explanation states:",
        "  selected       Asset appears in the top-N for the host with rank and score breakdown",
        "  rejected       Asset was rejected during discovery selection (e.g., duplicate)",
        "  quarantined    Asset is held in quarantine pending review",
        "  budget-pruned  Asset was ranked but excluded by the activation budget",
      ],
    },
    evaluate: {
      heading: "recommend evaluate — Run golden recommendation fixtures",
      lines: [
        "Usage: agent-harness recommend evaluate [--write]",
        "",
        "Runs golden recommendation fixtures against the policy and prints",
        "quality summary metrics.",
        "",
        "Options:",
        "  --write  Persist evaluation results to recommend/output/evaluation.json",
      ],
    },
    "ai-review": {
      heading: "recommend ai-review — Run recommendation-native AI review",
      lines: [
        "Usage: agent-harness recommend ai-review [--host <host>] [--review-limit <n>] [--apply] [--intent <intent>]",
        "",
        "Runs AI review on the latest recommendation report and writes the",
        "review artifact to recommend/output/ai-review.json.",
        "",
        "Options:",
        "  --host <host>     Target host for review",
        "  --review-limit <n> Max review entries",
        "  --apply           Apply AI review adjustments to the recommendation report",
        `  --intent <intent>  Repeatable; intents: ${SESSION_INTENT_CHOICES}`,
      ],
    },
    "policy:print": {
      heading: "recommend policy:print — Print the merged effective policy",
      lines: [
        "Usage: agent-harness recommend policy:print [--host <host>] [--compact]",
        "",
        "Prints the merged effective recommendation policy as JSON.",
        "",
        "Options:",
        "  --host <host>  Scope to a specific host's policy",
        "  --compact      Output compact (single-line) JSON",
      ],
    },
  };

  printSubcommandHelp(subcommand, helpTexts, printRecommendHelp);
}
