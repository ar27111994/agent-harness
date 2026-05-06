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

  if (!state.terminal) {
    return false;
  }

  if (state.mirroredCount < state.totalEligibleCount) {
    throw new Error(
      `mirror acquire ended incomplete: ${state.mirroredCount}/${state.totalEligibleCount} mirrored, ${state.skippedCount} skipped (unmirrorable). ` +
        `Review skipped assets or adjust mirror policy.`,
    );
  }

  return true;
}
