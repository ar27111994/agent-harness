import { join } from "node:path";

import { readJsonFileOrNull } from "../files.js";
import { getOptionValues } from "../lib/cli-options.js";
import { assertInstallProgressState } from "../manifest-validation.js";
import type { InstallProgressState } from "../types.js";
import { getRegisteredBundleIds } from "./bundle.js";
import { INSTALL_PROGRESS_STATE_OUTPUT_PATH } from "./paths.js";

/**
 * Machine-readable summary of the most recent staging state for the bundles
 * targeted by an `install bundle` invocation.
 *
 * `staged` reflects assets successfully written by the latest batch recorded
 * for each target bundle. `skipped` reflects unresolved skipped assets for the
 * target bundle(s), including integrity/malformed/missing-artifact skips. This
 * intentionally keeps subsequent automation non-zero until the partial state
 * is repaired instead of allowing an earlier integrity failure to disappear.
 * Fatal failures still throw through the command dispatcher and therefore do
 * not reach this completed-run summary (`failed` remains zero here).
 */
export interface InstallBundleOutcomeSummary {
  staged: number;
  skipped: number;
  failed: number;
}

/** Summarizes the staged/skipped assets for the requested install scope. */
export async function summarizeInstallBundleOutcome(
  projectRoot: string,
  args: readonly string[],
): Promise<InstallBundleOutcomeSummary> {
  const progressState = await readJsonFileOrNull<InstallProgressState>(
    join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH),
    assertInstallProgressState,
  );
  if (!progressState) {
    return { staged: 0, skipped: 0, failed: 0 };
  }

  const explicitBundleIds = getOptionValues(args, "--bundle");
  const targetBundleIds =
    explicitBundleIds.length > 0 ? explicitBundleIds : getRegisteredBundleIds();
  const explicitAssetIds = getOptionValues(args, "--asset");
  const allowedAssetIds =
    explicitAssetIds.length > 0 ? new Set(explicitAssetIds) : null;

  let staged = 0;
  let skipped = 0;
  for (const bundleId of targetBundleIds) {
    const bundle = progressState.bundles[bundleId];
    if (!bundle) {
      continue;
    }

    staged += countRelevantAssets(bundle.lastBatchAssetIds, allowedAssetIds);
    skipped += countRelevantAssets(bundle.skippedAssetIds, allowedAssetIds);
  }

  return { staged, skipped, failed: 0 };
}

/** Formats an install outcome for human-readable CLI output. */
export function formatInstallBundleOutcomeSummary(
  summary: InstallBundleOutcomeSummary,
): string {
  return `Install bundle summary (latest batch): staged=${summary.staged} skipped=${summary.skipped} failed=${summary.failed}`;
}

/** Returns whether an install outcome contains unresolved work. */
export function installBundleOutcomeHasProblems(
  summary: InstallBundleOutcomeSummary,
): boolean {
  return summary.skipped > 0 || summary.failed > 0;
}

function countRelevantAssets(
  assetIds: readonly string[],
  allowedAssetIds: ReadonlySet<string> | null,
): number {
  if (!allowedAssetIds) {
    return new Set(assetIds).size;
  }
  return new Set(assetIds.filter((assetId) => allowedAssetIds.has(assetId))).size;
}
