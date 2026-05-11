import type { MirrorAcquireState } from "../types.js";

/**
 * Validates a persisted mirror acquire checkpoint for batch orchestration.
 * Returns true when acquisition is terminal and complete.
 */
export function assertMirrorAcquireCheckpoint(
  state: MirrorAcquireState | null,
  context: string,
): boolean {
  if (!state) {
    throw new Error(
      `${context} missing mirror acquire state after mirror acquire batch`,
    );
  }

  if (state.skippedAssetIds.length !== state.skippedCount) {
    throw new Error(
      `${context} mirror acquire state is inconsistent: skippedAssetIds(${state.skippedAssetIds.length}) != skippedCount(${state.skippedCount})`,
    );
  }

  if (state.sessionMode === "refresh") {
    const processedCount = state.processedCount ?? 0;
    if (processedCount + state.remainingCount !== state.totalEligibleCount) {
      throw new Error(
        `${context} mirror refresh state is inconsistent: processed(${processedCount}) + remaining(${state.remainingCount}) != total(${state.totalEligibleCount})`,
      );
    }

    if (!state.terminal) {
      return false;
    }

    if (state.remainingCount > 0) {
      throw new Error(
        `${context} mirror refresh stalled after batch: ${processedCount}/${state.totalEligibleCount} processed, ${state.lastBatchSkippedCount} skipped in last batch, ${state.remainingCount} remaining. ` +
          `Review state/mirror/acquire-state.json (last batch: ${state.lastBatchAssetIds.length} asset(s)) or adjust mirror policy.${buildSkippedReasonSummary(state)}`,
      );
    }

    return true;
  }

  if (
    state.mirroredCount + state.skippedCount + state.remainingCount !==
    state.totalEligibleCount
  ) {
    throw new Error(
      `${context} mirror acquire state is inconsistent: mirrored(${state.mirroredCount}) + skipped(${state.skippedCount}) + remaining(${state.remainingCount}) != total(${state.totalEligibleCount})`,
    );
  }

  if (!state.terminal) {
    return false;
  }

  if (state.remainingCount > 0) {
    throw new Error(
      `${context} mirror acquire stalled after batch: ${state.mirroredCount}/${state.totalEligibleCount} mirrored, ${state.lastBatchSkippedCount} skipped in last batch, ${state.remainingCount} remaining. ` +
        `Review state/mirror/acquire-state.json (last batch: ${state.lastBatchAssetIds.length} asset(s)) or adjust mirror policy.${buildSkippedReasonSummary(state)}`,
    );
  }

  if (state.mirroredCount < state.totalEligibleCount) {
    throw new Error(
      `${context} mirror acquire ended incomplete: ${state.mirroredCount}/${state.totalEligibleCount} mirrored, ${state.skippedCount} skipped (unmirrorable). ` +
        `Review state/mirror/acquire-state.json (last batch: ${state.lastBatchAssetIds.length} asset(s)) or adjust mirror policy.${buildSkippedReasonSummary(state)}`,
    );
  }

  return true;
}

function buildSkippedReasonSummary(state: MirrorAcquireState): string {
  const skippedAssetReasons = state.skippedAssetReasons;
  if (!skippedAssetReasons) {
    return "";
  }

  const summarizedReasons = Object.entries(skippedAssetReasons)
    .reduce<Map<string, number>>((counts, [, reason]) => {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
      return counts;
    }, new Map())
    .entries();
  const topReasons = [...summarizedReasons]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([reason, count]) => `${reason} (${count})`);

  if (topReasons.length === 0) {
    return "";
  }

  return ` Top skip reasons: ${topReasons.join(", ")}.`;
}
