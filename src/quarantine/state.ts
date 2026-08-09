/**
 * quarantine/state — quarantine state model, review decisions, and report
 * construction (#435).
 *
 * Extracted from quarantine.ts: the pure report-building surface
 * (state entries, lifecycle transitions, suggested actions), the persisted
 * review-decision log, and the mirror-index review-target resolution. The
 * CLI dispatcher and command flows (list, inspect, review, report) stay in
 * quarantine.ts.
 */

import { join } from "node:path";

import { CliUsageError } from "../cli-help-format.js";
import { readJsonLinesFile } from "../files.js";
import { getOptionValue } from "../lib/cli-options.js";
import { assertMirrorIndexEntry } from "../manifest-validation.js";
import type {
  MirrorIndexEntry,
  QuarantineReviewAction,
  QuarantineReviewDecision,
  QuarantineStateEntry,
  QuarantineStateReport,
  QuarantineTransition,
} from "../types.js";

/**
 * Relative path of the mirror index file under a project root.
 */
export const MIRROR_INDEX_PATH = ["mirror", "index.jsonl"] as const;
/**
 * Relative path of the quarantine review-decision log under a project root.
 */
export const REVIEW_LOG_PATH = [
  "state",
  "quarantine",
  "reviews.jsonl",
] as const;
/**
 * Relative path of the quarantine state report under a project root.
 */
export const QUARANTINE_REPORT_PATH = [
  "state",
  "quarantine",
  "quarantine-state.json",
] as const;

/**
 * Mirror statuses that are safe from a quarantine standpoint: assets in
 * these states are not pending review.
 */
export const SAFE_MIRROR_STATUSES: ReadonlySet<MirrorIndexEntry["status"]> =
  new Set(["approved", "reference-only", "metadata-only"]);

/**
 * Reads and validates the mirror index entries for a project root.
 */
export async function readMirrorIndex(
  projectRoot: string,
): Promise<MirrorIndexEntry[]> {
  return readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, ...MIRROR_INDEX_PATH),
    assertMirrorIndexEntry,
  );
}

/**
 * Reads the persisted quarantine review decisions for a project root.
 */
export async function readQuarantineReviewDecisions(
  projectRoot: string,
): Promise<QuarantineReviewDecision[]> {
  return readJsonLinesFile<QuarantineReviewDecision>(
    join(projectRoot, ...REVIEW_LOG_PATH),
  );
}

/**
 * Resolves the mirror-index entry targeted by a quarantine review command,
 * from `--asset <assetId>` or `--mirror <mirrorId>` (or the first positional
 * argument as the asset id).
 *
 * @throws {Error} When neither selector is given or no entry matches.
 */
export async function findReviewTarget(
  projectRoot: string,
  args: string[],
): Promise<MirrorIndexEntry> {
  const requestedAssetId = getOptionValue(args, "--asset") ?? args[0];
  const requestedMirrorId = getOptionValue(args, "--mirror");
  if (!requestedAssetId && !requestedMirrorId) {
    throw new CliUsageError(
      "quarantine review commands require --asset or --mirror",
      "agent-harness quarantine review --help",
    );
  }

  const entries = await readMirrorIndex(projectRoot);
  const entry = entries.find(
    (candidate) =>
      candidate.assetId === requestedAssetId ||
      candidate.mirrorId === requestedMirrorId,
  );
  if (!entry) {
    throw new CliUsageError(
      "No matching mirror artifact found for quarantine review.",
      "agent-harness quarantine --help",
    );
  }

  return entry;
}

/**
 * Builds the quarantine state report from mirror entries and review
 * decisions: filtered state entries sorted by asset id plus aggregate
 * summary counts.
 */
export function buildQuarantineStateReport(
  entries: readonly MirrorIndexEntry[],
  decisions: readonly QuarantineReviewDecision[],
): QuarantineStateReport {
  const decisionsByMirrorId = groupReviewDecisions(decisions);
  const officialAssetIds = collectOfficialAssetIds(entries);
  const reportEntries = entries
    .filter((entry) => shouldReportQuarantineEntry(entry, decisionsByMirrorId))
    .map((entry) =>
      buildQuarantineStateEntry(
        entry,
        decisionsByMirrorId.get(entry.mirrorId) ?? [],
        officialAssetIds,
      ),
    )
    .sort((left, right) => left.assetId.localeCompare(right.assetId));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    entries: reportEntries,
    summary: {
      quarantinedCount: reportEntries.filter(
        (entry) => entry.currentState === "quarantined",
      ).length,
      approvedWithWarningCount: reportEntries.filter(
        (entry) => entry.currentState === "approved-with-warning",
      ).length,
      rejectedCount: reportEntries.filter((entry) =>
        entry.transitions.includes("review-rejected"),
      ).length,
      pinnedCount: reportEntries.filter((entry) =>
        entry.transitions.includes("review-pinned"),
      ).length,
      reviewRequiredCount: reportEntries.filter((entry) =>
        ["review", "keep-quarantined"].includes(entry.suggestedAction),
      ).length,
    },
  };
}

/**
 * Builds a single quarantine state report entry from a mirror-index entry,
 * its review decisions, and the official-asset id set.
 */
export function buildQuarantineStateEntry(
  entry: MirrorIndexEntry,
  decisions: readonly QuarantineReviewDecision[],
  officialAssetIds: ReadonlySet<string>,
): QuarantineStateEntry {
  const latestDecision = decisions.at(-1);
  const transitions = collectQuarantineTransitions(
    entry,
    decisions,
    officialAssetIds,
  );
  return {
    assetId: entry.assetId,
    mirrorId: entry.mirrorId,
    currentState: entry.status,
    reason: describeQuarantineReason(entry, latestDecision),
    firstSeenAt: entry.mirroredAt,
    lastReviewedAt: latestDecision?.reviewedAt,
    suggestedAction: suggestQuarantineAction(entry, latestDecision),
    transitions,
    upstreamUrl: entry.upstream.url,
    authorityTier: entry.source.authorityTier,
    publisher: entry.source.publisher,
    publisherVerified: entry.source.publisherVerified,
    contentHash: entry.contentHash,
  };
}

/**
 * Collects asset ids that have at least one official-first-party mirror
 * entry, used to detect when an official asset supersedes a community
 * duplicate.
 */
export function collectOfficialAssetIds(
  entries: readonly MirrorIndexEntry[],
): ReadonlySet<string> {
  const officialAssetIds = new Set<string>();
  for (const entry of entries) {
    if (entry.source.authorityTier === "official-first-party") {
      officialAssetIds.add(entry.assetId);
    }
  }
  return officialAssetIds;
}

/**
 * Derives the full quarantine lifecycle transition set for an entry from
 * real signals: the acquisition-time quarantine signals recorded on the
 * entry, the persisted review-decision evidence (prior/next status deltas),
 * and cross-entry official-duplicate detection. Every declared transition
 * kind maps to an observable cause; nothing is inferred without a concrete
 * signal.
 */
export function collectQuarantineTransitions(
  entry: MirrorIndexEntry,
  decisions: readonly QuarantineReviewDecision[],
  officialAssetIds: ReadonlySet<string>,
): QuarantineTransition[] {
  const transitions = new Set<QuarantineTransition>();
  const signals = entry.quarantineSignals;

  if (entry.status === "quarantined") {
    transitions.add("new-risky-asset");
  }
  if (
    (signals?.communityRisk ?? false) ||
    entry.source.authorityTier === "unverified-community"
  ) {
    transitions.add("ownership-changed");
  }
  if (entry.status === "approved-with-warning") {
    transitions.add("safer-update-available");
  }
  if (signals?.promptInjection) {
    transitions.add("prompt-injection-detected");
  }

  // Status deltas recorded in review evidence reveal lifecycle movement that
  // a single current-state snapshot cannot: an asset going safe -> risky, an
  // installed/projected asset newly quarantined on refresh, or a previously
  // prompt-injected asset that has since been cleared.
  const isProjected = entry.projectionCandidates.length > 0;
  for (const decision of decisions) {
    const wasSafe = SAFE_MIRROR_STATUSES.has(decision.evidence.previousStatus);
    const becameRisky =
      decision.evidence.nextStatus === "quarantined" ||
      decision.evidence.nextStatus === "approved-with-warning";
    if (wasSafe && becameRisky) {
      transitions.add("safe-to-risky");
      if (isProjected) {
        transitions.add("installed-asset-became-risky");
      }
    }
    if (
      !signals?.promptInjection &&
      SAFE_MIRROR_STATUSES.has(entry.status) &&
      decision.evidence.previousStatus === "quarantined" &&
      decision.evidence.promptInjection === true
    ) {
      transitions.add("prompt-injection-cleared");
    }

    if (decision.action === "approved") {
      transitions.add("review-approved");
    } else if (decision.action === "rejected") {
      transitions.add("review-rejected");
    } else {
      transitions.add("review-pinned");
    }
  }

  // A community asset that is shadowed by an official entry for the same
  // asset id is superseded by the official source.
  if (
    entry.source.authorityTier !== "official-first-party" &&
    officialAssetIds.has(entry.assetId)
  ) {
    transitions.add("official-duplicate-supersedes-community");
  }

  return [...transitions];
}

/**
 * Describes the quarantine reason for a report entry: the latest decision's
 * reason when one exists, a pending-review statement for quarantined assets,
 * and a lifecycle-history fallback otherwise.
 */
export function describeQuarantineReason(
  entry: MirrorIndexEntry,
  latestDecision: QuarantineReviewDecision | undefined,
): string {
  if (latestDecision) {
    return latestDecision.reason;
  }
  if (entry.status === "quarantined") {
    return "Asset is quarantined pending source, risk, and executable-behavior review.";
  }
  // The `review-approved` transition is always accompanied by the approving
  // decision, whose reason the latestDecision branch returns; a transitions
  // list without a decision cannot occur for this caller, so the middle
  // branch is unreachable. History fallback remains for older entries that
  // predate decision log retention.
  return "Asset has quarantine lifecycle history.";
}

/**
 * Suggests the operator action for a report entry from its latest decision
 * and current status.
 */
export function suggestQuarantineAction(
  entry: MirrorIndexEntry,
  latestDecision: QuarantineReviewDecision | undefined,
): QuarantineStateEntry["suggestedAction"] {
  if (latestDecision?.action === "pinned") {
    return "pin";
  }
  if (latestDecision?.action === "rejected") {
    return "keep-quarantined";
  }
  if (entry.status === "approved-with-warning") {
    return "approve";
  }
  if (entry.status === "quarantined") {
    return "review";
  }
  return "keep-quarantined";
}

/**
 * Returns whether a mirror entry belongs in the quarantine state report:
 * quarantined, approved-with-warning, or carrying any review decisions.
 */
export function shouldReportQuarantineEntry(
  entry: MirrorIndexEntry,
  decisionsByMirrorId: Map<string, QuarantineReviewDecision[]>,
): boolean {
  return (
    entry.status === "quarantined" ||
    entry.status === "approved-with-warning" ||
    decisionsByMirrorId.has(entry.mirrorId)
  );
}

/**
 * Groups review decisions by mirror id, preserving log order per id.
 */
export function groupReviewDecisions(
  decisions: readonly QuarantineReviewDecision[],
): Map<string, QuarantineReviewDecision[]> {
  const byMirrorId = new Map<string, QuarantineReviewDecision[]>();
  for (const decision of decisions) {
    const existing = byMirrorId.get(decision.mirrorId) ?? [];
    existing.push(decision);
    byMirrorId.set(decision.mirrorId, existing);
  }
  return byMirrorId;
}

/**
 * Returns the mirror status a review action transitions an entry to:
 * approved entries become approved-with-warning; reject and pin keep the
 * entry quarantined.
 */
export function getReviewedStatus(
  action: QuarantineReviewAction,
): MirrorIndexEntry["status"] {
  if (action === "approved") {
    return "approved-with-warning";
  }
  return "quarantined";
}

/**
 * Formats a review action for console output ("Approved" / "Pinned" /
 * "Rejected").
 */
export function formatReviewAction(action: QuarantineReviewAction): string {
  if (action === "approved") {
    return "Approved";
  }
  if (action === "pinned") {
    return "Pinned";
  }
  return "Rejected";
}
