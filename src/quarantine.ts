/**
 * quarantine — quarantine CLI command group: dispatcher and command flows
 * (#435).
 *
 * The dispatcher (runQuarantine) and the four command flows (list, inspect,
 * review decisions, report) live here; help text was extracted to
 * src/quarantine/help.ts and the state/report/review model to
 * src/quarantine/state.ts so every module stays under the ~600-line
 * decomposition budget.
 */

import { join } from "node:path";

import {
  handleUnknownCommand,
  hasHelpFlag,
  hasUnknownFlagsForSubcommands,
  type SubcommandFlagSpec,
} from "./cli-help-format.js";
import {
  readJsonFileOrNull,
  readTextFileOrNull,
  toPosixPath,
  writeJsonFile,
  writeJsonLinesFile,
} from "./files.js";
import { getOptionValue } from "./lib/cli-options.js";
import { sanitizeMirrorId } from "./lib/safe-paths.js";
import { assertAssetCatalogEntry } from "./manifest-validation.js";
import {
  printQuarantineHelp,
  printQuarantineSubcommandHelp,
} from "./quarantine/help.js";

/**
 * Flag spec table for quarantine subcommands (#445): the shared unknown-flag
 * guard rejects typo'd flags before any review decision or state write.
 */
const QUARANTINE_SUBCOMMAND_FLAG_SPECS: Record<string, SubcommandFlagSpec> = {
  list: {
    knownFlags: new Set(),
    flagsWithValues: new Set(),
    usageHint: "agent-harness quarantine list --help",
  },
  inspect: {
    knownFlags: new Set(["--asset", "--mirror"]),
    flagsWithValues: new Set(["--asset", "--mirror"]),
    usageHint: "agent-harness quarantine inspect --help",
  },
  report: {
    knownFlags: new Set(),
    flagsWithValues: new Set(),
    usageHint: "agent-harness quarantine report --help",
  },
  approve: {
    knownFlags: new Set(["--asset", "--mirror", "--reason", "--reviewer"]),
    flagsWithValues: new Set(["--asset", "--mirror", "--reason", "--reviewer"]),
    usageHint: "agent-harness quarantine approve --help",
  },
  reject: {
    knownFlags: new Set(["--asset", "--mirror", "--reason", "--reviewer"]),
    flagsWithValues: new Set(["--asset", "--mirror", "--reason", "--reviewer"]),
    usageHint: "agent-harness quarantine reject --help",
  },
  pin: {
    knownFlags: new Set(["--asset", "--mirror", "--reason", "--reviewer"]),
    flagsWithValues: new Set(["--asset", "--mirror", "--reason", "--reviewer"]),
    usageHint: "agent-harness quarantine pin --help",
  },
};
import {
  buildQuarantineStateReport,
  findReviewTarget,
  formatReviewAction,
  getReviewedStatus,
  MIRROR_INDEX_PATH,
  QUARANTINE_REPORT_PATH,
  readMirrorIndex,
  readQuarantineReviewDecisions,
  REVIEW_LOG_PATH,
} from "./quarantine/state.js";
import type {
  AssetCatalogEntry,
  MirrorIndexEntry,
  QuarantineReviewAction,
  QuarantineReviewDecision,
} from "./types.js";

/**
 * Dispatches the quarantine CLI command group.
 */
export async function runQuarantine(
  args: string[],
  projectRoot: string,
): Promise<number> {
  const [command = "help", ...rest] = args;

  // Detect --help flag and show subcommand-specific help (#383).
  if (hasHelpFlag(rest)) {
    printQuarantineSubcommandHelp(command);
    return 0;
  }

  // Strict flag validation before any quarantine work (#445).
  if (
    hasUnknownFlagsForSubcommands(
      QUARANTINE_SUBCOMMAND_FLAG_SPECS,
      command,
      rest,
    )
  ) {
    return 1;
  }

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
      return handleUnknownCommand(command, printQuarantineHelp);
  }
}

/**
 * Prints the mirror-index entries currently in quarantine.
 */
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

/**
 * Prints the full risk profile and content preview of a quarantined
 * artifact as JSON.
 */
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

/**
 * Records a quarantine review decision (approve/reject/pin): transitions
 * the mirror-index entry's status, appends the decision to the review log,
 * and regenerates the quarantine state report.
 */
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
      promptInjection: entry.quarantineSignals?.promptInjection,
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

/**
 * Regenerates the quarantine state report from the current mirror index and
 * review log (or caller-provided snapshots during a review command).
 */
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
