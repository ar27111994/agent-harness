import { join } from "node:path";

import {
  readJsonFileOrNull,
  readJsonLinesFile,
  readTextFileOrNull,
  toPosixPath,
  writeJsonFile,
  writeJsonLinesFile,
} from "./files.js";
import { printCommandHelp } from "./lib/cli-output.js";
import { getOptionValue } from "./lib/cli-options.js";
import { sanitizeMirrorId } from "./lib/safe-paths.js";
import {
  assertAssetCatalogEntry,
  assertMirrorIndexEntry,
} from "./manifest-validation.js";
import type {
  AssetCatalogEntry,
  MirrorIndexEntry,
  QuarantineReviewAction,
  QuarantineReviewDecision,
  QuarantineStateEntry,
  QuarantineStateReport,
  QuarantineTransition,
} from "./types.js";

const MIRROR_INDEX_PATH = ["mirror", "index.jsonl"] as const;
const REVIEW_LOG_PATH = ["state", "quarantine", "reviews.jsonl"] as const;
const QUARANTINE_REPORT_PATH = [
  "state",
  "quarantine",
  "quarantine-state.json",
] as const;

/**
 * Dispatches the quarantine CLI command group.
 */
export async function runQuarantine(
  args: string[],
  projectRoot: string,
): Promise<number> {
  const [command = "help", ...rest] = args;

  switch (command) {
    case "list":
      await listQuarantinedAssets(projectRoot);
      return 0;
    case "inspect":
      await inspectQuarantinedAsset(projectRoot, rest);
      return 0;
    case "report":
      await writeQuarantineReport(projectRoot);
      return 0;
    case "approve":
      await reviewQuarantinedAsset(projectRoot, rest, "approved");
      return 0;
    case "reject":
      await reviewQuarantinedAsset(projectRoot, rest, "rejected");
      return 0;
    case "pin":
      await reviewQuarantinedAsset(projectRoot, rest, "pinned");
      return 0;
    case "help":
      printQuarantineHelp();
      return 0;
    default:
      printQuarantineHelp();
      return 1;
  }
}

async function listQuarantinedAssets(projectRoot: string): Promise<void> {
  const entries = await readMirrorIndex(projectRoot);
  const quarantinedEntries = entries.filter(
    (entry) => entry.status === "quarantined",
  );

  if (quarantinedEntries.length === 0) {
    console.log("No quarantined mirror artifacts found.");
    return;
  }

  for (const entry of quarantinedEntries) {
    console.log(
      `${entry.assetId}\t${entry.mirrorId}\t${entry.source.authorityTier}\t${entry.upstream.url}`,
    );
  }
}

async function inspectQuarantinedAsset(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const entry = await findReviewTarget(projectRoot, args);
  const quarantineRoot = join(
    projectRoot,
    "mirror",
    "quarantine",
    sanitizeMirrorId(entry.mirrorId),
  );
  const asset = await readJsonFileOrNull<AssetCatalogEntry>(
    join(quarantineRoot, "asset.json"),
    assertAssetCatalogEntry,
  );
  const content = await readTextFileOrNull(join(quarantineRoot, "content.txt"));

  console.log(
    JSON.stringify(
      {
        mirrorIndex: entry,
        asset,
        contentPreview: content?.slice(0, 4000) ?? null,
      },
      null,
      2,
    ),
  );
}

async function reviewQuarantinedAsset(
  projectRoot: string,
  args: string[],
  action: QuarantineReviewAction,
): Promise<void> {
  const entry = await findReviewTarget(projectRoot, args);
  const reason = getOptionValue(args, "--reason") ?? "manual review";
  const reviewer = getOptionValue(args, "--reviewer");
  const entries = await readMirrorIndex(projectRoot);
  const nextStatus = getReviewedStatus(action);
  const nextEntries = entries.map((candidate) =>
    candidate.mirrorId === entry.mirrorId
      ? {
          ...candidate,
          status: nextStatus,
        }
      : candidate,
  );
  const decision: QuarantineReviewDecision = {
    schemaVersion: 1,
    reviewedAt: new Date().toISOString(),
    action,
    assetId: entry.assetId,
    mirrorId: entry.mirrorId,
    reason,
    reviewer,
    evidence: {
      previousStatus: entry.status,
      nextStatus,
      upstreamUrl: entry.upstream.url,
      authorityTier: entry.source.authorityTier,
      publisher: entry.source.publisher,
      publisherVerified: entry.source.publisherVerified,
      contentHash: entry.contentHash,
    },
  };
  const previousDecisions = await readQuarantineReviewDecisions(projectRoot);

  await writeJsonLinesFile(
    join(projectRoot, ...MIRROR_INDEX_PATH),
    nextEntries,
  );
  await writeJsonLinesFile(join(projectRoot, ...REVIEW_LOG_PATH), [
    ...previousDecisions,
    decision,
  ]);
  await writeQuarantineReport(projectRoot, nextEntries, [
    ...previousDecisions,
    decision,
  ]);

  console.log(
    `${formatReviewAction(action)} ${entry.assetId} (${entry.mirrorId}). Review log written to ${toPosixPath(join(projectRoot, ...REVIEW_LOG_PATH))}`,
  );
}

async function writeQuarantineReport(
  projectRoot: string,
  entries: MirrorIndexEntry[] | undefined = undefined,
  decisions: QuarantineReviewDecision[] | undefined = undefined,
): Promise<void> {
  const report = buildQuarantineStateReport(
    entries ?? (await readMirrorIndex(projectRoot)),
    decisions ?? (await readQuarantineReviewDecisions(projectRoot)),
  );

  await writeJsonFile(join(projectRoot, ...QUARANTINE_REPORT_PATH), report);
  console.log(
    `Wrote quarantine state report to ${toPosixPath(join(projectRoot, ...QUARANTINE_REPORT_PATH))}`,
  );
}

function buildQuarantineStateReport(
  entries: readonly MirrorIndexEntry[],
  decisions: readonly QuarantineReviewDecision[],
): QuarantineStateReport {
  const decisionsByMirrorId = groupReviewDecisions(decisions);
  const reportEntries = entries
    .filter((entry) => shouldReportQuarantineEntry(entry, decisionsByMirrorId))
    .map((entry) =>
      buildQuarantineStateEntry(
        entry,
        decisionsByMirrorId.get(entry.mirrorId) ?? [],
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

function buildQuarantineStateEntry(
  entry: MirrorIndexEntry,
  decisions: readonly QuarantineReviewDecision[],
): QuarantineStateEntry {
  const latestDecision = decisions.at(-1);
  const transitions = collectQuarantineTransitions(entry, decisions);
  return {
    assetId: entry.assetId,
    mirrorId: entry.mirrorId,
    currentState: entry.status,
    reason: describeQuarantineReason(entry, transitions, latestDecision),
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

function collectQuarantineTransitions(
  entry: MirrorIndexEntry,
  decisions: readonly QuarantineReviewDecision[],
): QuarantineTransition[] {
  const transitions = new Set<QuarantineTransition>();
  if (entry.status === "quarantined") {
    transitions.add("new-risky-asset");
  }
  if (entry.source.authorityTier === "unverified-community") {
    transitions.add("ownership-changed");
  }
  if (entry.status === "approved-with-warning") {
    transitions.add("safer-update-available");
  }
  for (const decision of decisions) {
    if (decision.action === "approved") {
      transitions.add("review-approved");
    } else if (decision.action === "rejected") {
      transitions.add("review-rejected");
    } else {
      transitions.add("review-pinned");
    }
  }
  return [...transitions];
}

function describeQuarantineReason(
  entry: MirrorIndexEntry,
  transitions: readonly QuarantineTransition[],
  latestDecision: QuarantineReviewDecision | undefined,
): string {
  if (latestDecision) {
    return latestDecision.reason;
  }
  if (entry.status === "quarantined") {
    return "Asset is quarantined pending source, risk, and executable-behavior review.";
  }
  if (transitions.includes("review-approved")) {
    return "Asset was approved with warning after quarantine review.";
  }
  return "Asset has quarantine lifecycle history.";
}

function suggestQuarantineAction(
  entry: MirrorIndexEntry,
  latestDecision: QuarantineReviewDecision | undefined,
): QuarantineStateEntry["suggestedAction"] {
  if (latestDecision?.action === "pinned") {
    return "pin";
  }
  if (entry.status === "approved-with-warning") {
    return "approve";
  }
  if (entry.status === "quarantined") {
    return "review";
  }
  return "keep-quarantined";
}

function shouldReportQuarantineEntry(
  entry: MirrorIndexEntry,
  decisionsByMirrorId: Map<string, QuarantineReviewDecision[]>,
): boolean {
  return (
    entry.status === "quarantined" ||
    entry.status === "approved-with-warning" ||
    decisionsByMirrorId.has(entry.mirrorId)
  );
}

function groupReviewDecisions(
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

function getReviewedStatus(
  action: QuarantineReviewAction,
): MirrorIndexEntry["status"] {
  if (action === "approved") {
    return "approved-with-warning";
  }
  return "quarantined";
}

function formatReviewAction(action: QuarantineReviewAction): string {
  if (action === "approved") {
    return "Approved";
  }
  if (action === "pinned") {
    return "Pinned";
  }
  return "Rejected";
}

async function readQuarantineReviewDecisions(
  projectRoot: string,
): Promise<QuarantineReviewDecision[]> {
  return readJsonLinesFile<QuarantineReviewDecision>(
    join(projectRoot, ...REVIEW_LOG_PATH),
  );
}

async function findReviewTarget(
  projectRoot: string,
  args: string[],
): Promise<MirrorIndexEntry> {
  const requestedAssetId = getOptionValue(args, "--asset") ?? args[0];
  const requestedMirrorId = getOptionValue(args, "--mirror");
  if (!requestedAssetId && !requestedMirrorId) {
    throw new Error("quarantine review commands require --asset or --mirror");
  }

  const entries = await readMirrorIndex(projectRoot);
  const entry = entries.find(
    (candidate) =>
      candidate.assetId === requestedAssetId ||
      candidate.mirrorId === requestedMirrorId,
  );
  if (!entry) {
    throw new Error("No matching mirror artifact found for quarantine review.");
  }

  return entry;
}

async function readMirrorIndex(
  projectRoot: string,
): Promise<MirrorIndexEntry[]> {
  return readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, ...MIRROR_INDEX_PATH),
    assertMirrorIndexEntry,
  );
}

function printQuarantineHelp(): void {
  printCommandHelp({
    heading: "quarantine commands:",
    entries: [
      {
        command: "list",
        description: "List quarantined mirror artifacts",
      },
      {
        command: "inspect --asset <assetId>",
        description: "Show quarantined artifact metadata and content preview",
      },
      {
        command: "report",
        description: "Write state/quarantine/quarantine-state.json",
      },
      {
        command: "approve --asset <assetId>",
        description: "Mark a quarantined artifact approved-with-warning",
      },
      {
        command: "reject --asset <assetId>",
        description:
          "Record a rejection decision while keeping quarantine status",
      },
      {
        command: "pin --asset <assetId>",
        description: "Pin a quarantine decision for future refresh reviews",
      },
    ],
    sections: [
      {
        title: "Options:",
        lines: [
          "--asset <assetId>",
          "--mirror <mirrorId>",
          "--reason <review reason>",
          "--reviewer <name or bot id>",
        ],
      },
    ],
  });
}
