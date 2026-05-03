import { join } from "node:path";

import {
  readJsonFileOrNull,
  readJsonLinesFile,
  readTextFileOrNull,
  toPosixPath,
  writeJsonLinesFile,
} from "./files.js";
import { getOptionValue } from "./lib/cli-options.js";
import { sanitizeMirrorId } from "./lib/safe-paths.js";
import {
  assertAssetCatalogEntry,
  assertMirrorIndexEntry,
} from "./manifest-validation.js";
import type { AssetCatalogEntry, MirrorIndexEntry } from "./types.js";

interface QuarantineReviewDecision {
  schemaVersion: 1;
  reviewedAt: string;
  action: "approved" | "rejected";
  assetId: string;
  mirrorId: string;
  reason: string;
}

const MIRROR_INDEX_PATH = ["mirror", "index.jsonl"] as const;
const REVIEW_LOG_PATH = ["state", "quarantine", "reviews.jsonl"] as const;

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
    case "approve":
      await reviewQuarantinedAsset(projectRoot, rest, "approved");
      return 0;
    case "reject":
      await reviewQuarantinedAsset(projectRoot, rest, "rejected");
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
  action: QuarantineReviewDecision["action"],
): Promise<void> {
  const entry = await findReviewTarget(projectRoot, args);
  const reason = getOptionValue(args, "--reason") ?? "manual review";
  const entries = await readMirrorIndex(projectRoot);
  const nextEntries = entries.map((candidate) =>
    candidate.mirrorId === entry.mirrorId
      ? {
          ...candidate,
          status:
            action === "approved"
              ? ("approved-with-warning" as const)
              : ("quarantined" as const),
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
  };
  const previousDecisions = await readJsonLinesFile<QuarantineReviewDecision>(
    join(projectRoot, ...REVIEW_LOG_PATH),
  );

  await writeJsonLinesFile(
    join(projectRoot, ...MIRROR_INDEX_PATH),
    nextEntries,
  );
  await writeJsonLinesFile(join(projectRoot, ...REVIEW_LOG_PATH), [
    ...previousDecisions,
    decision,
  ]);

  console.log(
    `${action === "approved" ? "Approved" : "Rejected"} ${entry.assetId} (${entry.mirrorId}). Review log written to ${toPosixPath(join(projectRoot, ...REVIEW_LOG_PATH))}`,
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
  console.log(`quarantine commands:
  list                         List quarantined mirror artifacts
  inspect --asset <assetId>     Show quarantined artifact metadata and content preview
  approve --asset <assetId>     Mark a quarantined artifact approved-with-warning
  reject --asset <assetId>      Record a rejection decision while keeping quarantine status

Options:
  --asset <assetId>
  --mirror <mirrorId>
  --reason <review reason>`);
}
