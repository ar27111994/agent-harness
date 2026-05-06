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
        `Review state/mirror/acquire-state.json (last batch: ${state.lastBatchAssetIds.length} asset(s)) or adjust mirror policy.`,
    );
  }

  if (state.mirroredCount < state.totalEligibleCount) {
    throw new Error(
      `${context} mirror acquire ended incomplete: ${state.mirroredCount}/${state.totalEligibleCount} mirrored, ${state.skippedCount} skipped (unmirrorable). ` +
        `Review state/mirror/acquire-state.json (last batch: ${state.lastBatchAssetIds.length} asset(s)) or adjust mirror policy.`,
    );
  }

  return true;
}
