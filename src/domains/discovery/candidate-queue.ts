import { createHash } from "node:crypto";
import { join } from "node:path";

import { readJsonFileOrNull, writeJsonFile } from "../../files.js";
import type { AuthorityTier, SourceDefinition } from "../../types.js";
import {
  SOURCE_CANDIDATES_OUTPUT_PATH,
  UNKNOWN_SIGNALS_OUTPUT_PATH,
} from "./output-paths.js";
import type { UnknownSignalReport } from "./unknown-signals.js";

/**
 * Describes one proposed source candidate that still needs explicit review.
 */
export interface SourceCandidate {
  id: string;
  provenance: "unknown-signal" | "source-health" | "manual-seed";
  label: string;
  evidence: string[];
  score: number;
  duplicate: boolean;
  recommendedTrustTier: AuthorityTier;
  reviewRequired: boolean;
  suggestedAction: "approve" | "defer" | "reject" | "research";
  risky: boolean;
}

/**
 * Describes the persisted queue of source candidates awaiting review.
 */
export interface SourceCandidateQueueReport {
  schemaVersion: number;
  generatedAt: string;
  candidateCount: number;
  reviewRequiredCount: number;
  candidates: SourceCandidate[];
}

/**
 * Writes a structured source candidate queue without promoting candidates.
 */
export async function writeSourceCandidateQueue(
  projectRoot: string,
  sources: SourceDefinition[],
): Promise<SourceCandidateQueueReport> {
  const report = await buildSourceCandidateQueue(projectRoot, sources);
  await writeJsonFile(
    join(projectRoot, ...SOURCE_CANDIDATES_OUTPUT_PATH),
    report,
  );
  return report;
}

/**
 * Builds source candidates from unknown-signal evidence and existing source IDs.
 */
export async function buildSourceCandidateQueue(
  projectRoot: string,
  sources: SourceDefinition[],
): Promise<SourceCandidateQueueReport> {
  const unknownSignals = await readJsonFileOrNull<UnknownSignalReport>(
    join(projectRoot, ...UNKNOWN_SIGNALS_OUTPUT_PATH),
  );
  const existingSourceKeys = new Set(
    sources.flatMap((source) =>
      [
        source.id,
        source.endpoints.repo,
        source.endpoints.docsUrl,
        source.endpoints.baseUrl,
      ].filter(Boolean),
    ),
  );
  const candidates = (unknownSignals?.signals ?? [])
    .map((signal) =>
      buildCandidateFromUnknownSignal(signal, existingSourceKeys),
    )
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    reviewRequiredCount: candidates.filter(
      (candidate) => candidate.reviewRequired,
    ).length,
    candidates,
  };
}

function buildCandidateFromUnknownSignal(
  signal: UnknownSignalReport["signals"][number],
  existingSourceKeys: ReadonlySet<string>,
): SourceCandidate {
  const risky =
    signal.category === "mcp-manifest" || signal.category === "plugin-manifest";
  const duplicate = existingSourceKeys.has(signal.path);
  const score = scoreUnknownSignal(signal, risky, duplicate);
  const recommendedTrustTier = risky
    ? "trusted-community"
    : "official-compatible";
  const reviewRequired = risky || signal.confidence !== "high" || duplicate;

  return {
    id: `candidate-${hashCandidateId(signal.category, signal.path)}`,
    provenance: "unknown-signal",
    label: `${signal.category}: ${signal.path}`,
    evidence: [...signal.evidence, ...signal.ambiguityNotes],
    score,
    duplicate,
    recommendedTrustTier,
    reviewRequired,
    suggestedAction: reviewRequired ? "research" : "approve",
    risky,
  };
}

function scoreUnknownSignal(
  signal: UnknownSignalReport["signals"][number],
  risky: boolean,
  duplicate: boolean,
): number {
  let score =
    signal.confidence === "high"
      ? 75
      : signal.confidence === "medium"
        ? 55
        : 35;

  if (risky) {
    score -= 20;
  }
  if (duplicate) {
    score -= 30;
  }

  return Math.max(0, Math.min(100, score));
}

function hashCandidateId(category: string, path: string): string {
  return createHash("sha256")
    .update(`${category}:${path}`)
    .digest("hex")
    .slice(0, 16);
}
