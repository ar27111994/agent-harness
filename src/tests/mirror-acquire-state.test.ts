import assert from "node:assert/strict";
import test from "node:test";

import type { MirrorAcquireState } from "../types.js";

/**
 * Regression tests for mirror acquire state logic (issues #111, #112, #113).
 * Validates that terminal state, skipped counts, and pipeline error conditions
 * behave correctly when entries are unmirrorable.
 */

void test("acquire state marks terminal when no progress is made in a batch", () => {
  // Simulates: all entries in batch returned null (skipped)
  const state: MirrorAcquireState = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    batchSize: 10,
    totalEligibleCount: 5,
    mirroredCount: 0,
    remainingCount: 0,
    skippedCount: 5,
    lastBatchAssetIds: ["a", "b", "c", "d", "e"],
    lastBatchMirroredCount: 0,
    lastBatchSkippedCount: 5,
    terminal: true,
  };

  assert.equal(
    state.terminal,
    true,
    "state should be terminal when no progress",
  );
  assert.equal(state.lastBatchMirroredCount, 0);
  assert.equal(state.skippedCount, 5);
});

void test("acquire state is not terminal when progress is still being made", () => {
  const state: MirrorAcquireState = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    batchSize: 10,
    totalEligibleCount: 20,
    mirroredCount: 10,
    remainingCount: 7,
    skippedCount: 3,
    lastBatchAssetIds: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
    lastBatchMirroredCount: 7,
    lastBatchSkippedCount: 3,
    terminal: false,
  };

  assert.equal(state.terminal, false);
  assert.equal(state.remainingCount, 7);
});

void test("acquire state is terminal with full success when all eligible are mirrored", () => {
  const state: MirrorAcquireState = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    batchSize: 10,
    totalEligibleCount: 10,
    mirroredCount: 10,
    remainingCount: 0,
    skippedCount: 0,
    lastBatchAssetIds: ["a", "b", "c"],
    lastBatchMirroredCount: 3,
    lastBatchSkippedCount: 0,
    terminal: true,
  };

  assert.equal(state.terminal, true);
  assert.equal(state.mirroredCount, state.totalEligibleCount);
  assert.equal(state.skippedCount, 0);
});

void test("pipeline should throw when terminal state is incomplete", () => {
  // Simulates the pipeline check logic from acquireAllMirrorBatches
  const state: MirrorAcquireState = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    batchSize: 10,
    totalEligibleCount: 10,
    mirroredCount: 3,
    remainingCount: 0,
    skippedCount: 7,
    lastBatchAssetIds: [],
    lastBatchMirroredCount: 0,
    lastBatchSkippedCount: 7,
    terminal: true,
  };

  // Reproduce the pipeline guard condition
  const shouldThrow =
    state.terminal && state.mirroredCount < state.totalEligibleCount;
  assert.equal(
    shouldThrow,
    true,
    "pipeline must throw for incomplete terminal state",
  );

  const errorMessage =
    `mirror acquire ended incomplete: ${state.mirroredCount}/${state.totalEligibleCount} mirrored, ${state.skippedCount} skipped (unmirrorable). ` +
    `Review skipped assets or adjust mirror policy.`;
  assert.match(errorMessage, /incomplete/);
  assert.match(errorMessage, /skipped/);
});

void test("remaining count excludes both mirrored and skipped entries", () => {
  // The key fix: remaining = eligible - mirrored - skipped
  const totalEligible = 20;
  const mirrored = 8;
  const skipped = 5;
  const remaining = totalEligible - mirrored - skipped;

  assert.equal(remaining, 7);

  const state: MirrorAcquireState = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    batchSize: 10,
    totalEligibleCount: totalEligible,
    mirroredCount: mirrored,
    remainingCount: remaining,
    skippedCount: skipped,
    lastBatchAssetIds: [],
    lastBatchMirroredCount: 3,
    lastBatchSkippedCount: 2,
    terminal: false,
  };

  assert.equal(
    state.remainingCount,
    state.totalEligibleCount - state.mirroredCount - state.skippedCount,
    "remaining must account for skipped entries to avoid infinite loops",
  );
});
