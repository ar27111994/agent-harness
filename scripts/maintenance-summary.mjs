#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const DEFAULT_OUTPUT_PATH = join(
  "discover",
  "output",
  "maintenance-summary.md",
);

const reportPaths = {
  sourceHealth: join("discover", "output", "source-health.json"),
  sourceDrift: join("discover", "output", "source-drift.json"),
  sourceCandidates: join("discover", "output", "source-candidates.json"),
  unknownSignals: join("discover", "output", "unknown-signals.json"),
  assetFingerprints: join("discover", "output", "asset-fingerprints.json"),
  refreshReport: join("state", "install", "refresh-report.json"),
};

const outputPath = process.argv[2] ?? DEFAULT_OUTPUT_PATH;
const reports = Object.fromEntries(
  await Promise.all(
    Object.entries(reportPaths).map(async ([key, path]) => [
      key,
      await readJsonOrNull(path),
    ]),
  ),
);

const lines = [
  "# Agent Harness Maintenance Summary",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "## Signals",
  "",
  `- Source health: ${summarizeSourceHealth(reports.sourceHealth)}`,
  `- Source drift entries: ${reports.sourceDrift?.sources?.length ?? 0}`,
  `- Source candidates: ${reports.sourceCandidates?.candidateCount ?? 0} (${reports.sourceCandidates?.reviewRequiredCount ?? 0} review-required)`,
  `- Unknown signals: ${reports.unknownSignals?.summary?.signalCount ?? 0}`,
  `- Asset fingerprints: ${reports.assetFingerprints?.assetCount ?? 0} assets / ${reports.assetFingerprints?.duplicateGroupCount ?? 0} duplicate groups`,
  `- Refresh report: ${reports.refreshReport ? "present" : "not present"}`,
  "",
  "## Review policy",
  "",
  "- Low-risk report-only metadata drift can be proposed as a PR.",
  "- Official-source owner, publisher, or redirect ambiguity must remain review-gated.",
  "- Community source promotion to official is never automatic.",
  "- Risky executable assets, hooks, MCP servers, plugins, and quarantine decisions require human review.",
  "",
  "## Artifacts to inspect",
  "",
  ...Object.values(reportPaths).map((path) => `- ${path}`),
  "",
];

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Maintenance summary written to ${outputPath}`);

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

function summarizeSourceHealth(report) {
  if (!report) {
    return "not present";
  }

  return `${report.sourceCount ?? 0} sources, ${report.severeCount ?? 0} severe, ${report.warningCount ?? 0} warnings`;
}
