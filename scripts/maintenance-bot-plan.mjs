#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const outputPath =
  process.argv[2] ?? join("discover", "output", "maintenance-bot-plan.json");
const reports = {
  sourceDrift: await readJsonOrNull(
    join("discover", "output", "source-drift.json"),
  ),
  sourceCandidates: await readJsonOrNull(
    join("discover", "output", "source-candidates.json"),
  ),
  sourceVerification: await readJsonOrNull(
    join("discover", "output", "source-verification.json"),
  ),
  sourceHealth: await readJsonOrNull(
    join("discover", "output", "source-health.json"),
  ),
};

const issues = [
  ...buildSourceDriftIssues(reports.sourceDrift),
  ...buildSourceCandidateIssues(reports.sourceCandidates),
  ...buildSourceVerificationIssues(reports.sourceVerification),
];
const pullRequests = buildReportOnlyPullRequests(reports.sourceHealth, issues);
const plan = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  pullRequestCount: pullRequests.length,
  issueCount: issues.length,
  pullRequests,
  issues,
  boundaries: [
    "never auto-promote community sources to official",
    "never auto-install risky executable assets",
    "quarantine review requires a human decision",
    "trust-tier changes create issues instead of silent updates",
  ],
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
console.log(`Maintenance bot plan written to ${outputPath}`);

async function readJsonOrNull(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function buildSourceDriftIssues(report) {
  return (report?.sources ?? [])
    .filter((source) => source.severity !== "ok")
    .map((source) => ({
      title: `Review source drift: ${source.sourceId}`,
      labels: ["maintenance", "source-drift", source.severity],
      evidence: {
        sourceId: source.sourceId,
        status: source.status,
        severity: source.severity,
        reasons: source.reasons,
        suggestedAction: source.suggestedAction,
        harvestedEntries: source.harvestedEntries,
        selectedEntries: source.selectedEntries,
        rejectedEntries: source.rejectedEntries,
        duplicateRate: source.duplicateRate,
      },
    }));
}

function buildSourceCandidateIssues(report) {
  return (report?.candidates ?? [])
    .filter((candidate) => candidate.reviewRequired)
    .map((candidate) => ({
      title: `Review source candidate: ${candidate.label}`,
      labels: ["maintenance", "source-candidate"],
      evidence: candidate,
    }));
}

function buildSourceVerificationIssues(report) {
  return (report?.entries ?? [])
    .filter(
      (entry) => entry.effectiveAuthorityTier !== entry.originalAuthorityTier,
    )
    .map((entry) => ({
      title: `Review official source trust demotion: ${entry.sourceId}`,
      labels: ["maintenance", "trust-review", "official-source"],
      evidence: entry,
    }));
}

function buildReportOnlyPullRequests(sourceHealth, issues) {
  const hasBlockingHealthFindings = (sourceHealth?.severeCount ?? 0) > 0;
  const hasReportOnlyUpdates =
    Boolean(sourceHealth) && issues.length === 0 && !hasBlockingHealthFindings;
  if (!hasReportOnlyUpdates) {
    return [];
  }

  return [
    {
      title: "Refresh maintenance reports",
      labels: ["maintenance", "report-only"],
      evidence: {
        sourceCount: sourceHealth.sourceCount,
        severeCount: sourceHealth.severeCount,
        warningCount: sourceHealth.warningCount,
      },
      allowedChanges: [
        "generated report artifacts",
        "non-sensitive metadata summaries",
      ],
    },
  ];
}
