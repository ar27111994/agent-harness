import assert from "node:assert/strict";
import test from "node:test";

import { assertMirrorAcquireCheckpoint } from "../mirror/acquire-state.js";
import type { MirrorAcquireState } from "../types.js";

function createAcquireState(
  overrides: Partial<MirrorAcquireState> = {},
): MirrorAcquireState {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    batchSize: 10,
    totalEligibleCount: 10,
    mirroredCount: 0,
    remainingCount: 0,
    skippedCount: 0,
    lastBatchAssetIds: [],
    lastBatchMirroredCount: 0,
    lastBatchSkippedCount: 0,
    terminal: false,
    ...overrides,
  };
}

void test("mirror acquire checkpoint throws when persisted state is missing", () => {
  assert.throws(
    () => assertMirrorAcquireCheckpoint(null, "workspace pipeline"),
    /workspace pipeline missing mirror acquire state/,
  );
});

void test("mirror acquire checkpoint returns false while more batches are needed", () => {
  const state = createAcquireState({
    totalEligibleCount: 20,
    mirroredCount: 10,
    skippedCount: 3,
    remainingCount: 7,
    lastBatchAssetIds: ["a", "b", "c"],
    lastBatchMirroredCount: 7,
    lastBatchSkippedCount: 3,
    terminal: false,
  });

  assert.equal(
    assertMirrorAcquireCheckpoint(state, "workspace pipeline"),
    false,
  );
});

void test("mirror acquire checkpoint returns true for terminal full success", () => {
  const state = createAcquireState({
    totalEligibleCount: 10,
    mirroredCount: 10,
    remainingCount: 0,
    lastBatchAssetIds: ["a", "b", "c"],
    lastBatchMirroredCount: 3,
    terminal: true,
  });

  assert.equal(
    assertMirrorAcquireCheckpoint(state, "workspace pipeline"),
    true,
  );
});

void test("mirror acquire checkpoint throws for incomplete terminal state", () => {
  const state = createAcquireState({
    totalEligibleCount: 10,
    mirroredCount: 3,
    remainingCount: 0,
    skippedCount: 7,
    lastBatchSkippedCount: 7,
    terminal: true,
  });

  assert.throws(
    () => assertMirrorAcquireCheckpoint(state, "workspace pipeline"),
    /mirror acquire ended incomplete: 3\/10 mirrored, 7 skipped/,
  );
});

void test("terminal state keeps mirrored and skipped counts cumulative", () => {
  const state = createAcquireState({
    totalEligibleCount: 20,
    mirroredCount: 14,
    skippedCount: 6,
    remainingCount: 0,
    lastBatchMirroredCount: 0,
    lastBatchSkippedCount: 3,
    terminal: true,
  });

  assert.equal(
    state.mirroredCount + state.skippedCount,
    state.totalEligibleCount,
    "terminal states should fully account for every eligible asset",
  );
});

void test("remaining count excludes both mirrored and skipped entries", () => {
  const state = createAcquireState({
    totalEligibleCount: 20,
    mirroredCount: 8,
    skippedCount: 5,
    remainingCount: 7,
    lastBatchMirroredCount: 3,
    lastBatchSkippedCount: 2,
  });

  assert.equal(
    state.remainingCount,
    state.totalEligibleCount - state.mirroredCount - state.skippedCount,
    "remaining must account for skipped entries to avoid infinite loops",
  );
});
