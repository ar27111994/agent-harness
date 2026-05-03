import { join } from "node:path";

import {
  readJsonFileOrNull,
  readJsonLinesFile,
  readTextFileOrNull,
  toPosixPath,
} from "../files.js";
import { getOptionValue } from "../lib/cli-options.js";
import { assertMirrorIndexEntry } from "../manifest-validation.js";
import type { MirrorIndexEntry } from "../types.js";
import {
  MIRROR_INDEX_OUTPUT_PATH,
  MIRROR_INDEX_SNAPSHOT_PATH,
} from "./constants.js";
import { sanitizeMirrorId } from "./paths.js";

export async function diffMirrorIndex(projectRoot: string): Promise<void> {
  const currentEntries = await readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, ...MIRROR_INDEX_OUTPUT_PATH),
    assertMirrorIndexEntry,
  );
  const previousEntries = await readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, ...MIRROR_INDEX_SNAPSHOT_PATH),
    assertMirrorIndexEntry,
  );
  const previousByAssetId = new Map(
    previousEntries.map((entry) => [entry.assetId, entry]),
  );
  const currentByAssetId = new Map(
    currentEntries.map((entry) => [entry.assetId, entry]),
  );
  const added = currentEntries
    .filter((entry) => !previousByAssetId.has(entry.assetId))
    .map((entry) => entry.assetId)
    .sort();
  const removed = previousEntries
    .filter((entry) => !currentByAssetId.has(entry.assetId))
    .map((entry) => entry.assetId)
    .sort();
  const changed = currentEntries
    .filter((entry) => {
      const previous = previousByAssetId.get(entry.assetId);
      return (
        previous &&
        (previous.mirrorId !== entry.mirrorId ||
          previous.status !== entry.status)
      );
    })
    .map((entry) => entry.assetId)
    .sort();

  console.log("Mirror index diff: previous -> current");
  console.log(`  Added assets: ${formatDiffList(added)}`);
  console.log(`  Removed assets: ${formatDiffList(removed)}`);
  console.log(`  Changed assets: ${formatDiffList(changed)}`);
}

export async function explainMirrorArtifact(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const requestedAssetId = getOptionValue(args, "--asset") ?? args[0];
  const requestedMirrorId = getOptionValue(args, "--mirror");
  if (!requestedAssetId && !requestedMirrorId) {
    throw new Error("mirror explain requires --asset or --mirror");
  }

  const entries = await readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, ...MIRROR_INDEX_OUTPUT_PATH),
    assertMirrorIndexEntry,
  );
  const entry = entries.find(
    (candidate) =>
      candidate.assetId === requestedAssetId ||
      candidate.mirrorId === requestedMirrorId,
  );
  if (!entry) {
    throw new Error("No matching mirror artifact found.");
  }

  const rawRoot = join(
    projectRoot,
    "mirror",
    "raw",
    sanitizeMirrorId(entry.mirrorId),
  );
  const manifest = await readJsonFileOrNull<unknown>(
    join(rawRoot, "manifest.json"),
  );
  const contentPreview = (
    await readTextFileOrNull(join(rawRoot, "content.txt"))
  )?.slice(0, 4000);

  console.log(
    JSON.stringify(
      {
        mirrorIndex: entry,
        rawRoot: toPosixPath(rawRoot),
        manifest,
        contentPreview: contentPreview ?? null,
      },
      null,
      2,
    ),
  );
}

function formatDiffList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}
