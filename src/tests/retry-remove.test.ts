import assert from "node:assert/strict";
import test from "node:test";

import {
  removeTreeWithRetries,
  retryRemoveInternals,
} from "../lib/retry-remove.js";

void test("removeTreeWithRetries retries transient Windows lock errors", async () => {
  let attempts = 0;
  const delays: number[] = [];

  await removeTreeWithRetries(
    "C:/tmp/locked-tree",
    { maxRetries: 4, retryDelayMs: 5 },
    async (_path, options) => {
      assert.deepEqual(options, { force: true, recursive: true });
      attempts += 1;
      if (attempts <= 3) {
        const error = new Error("locked") as NodeJS.ErrnoException;
        error.code =
          attempts === 1 ? "EBUSY" : attempts === 2 ? "EPERM" : "EACCES";
        throw error;
      }
    },
    async (delayMs) => {
      delays.push(delayMs);
    },
  );

  assert.equal(attempts, 4);
  assert.deepEqual(delays, [5, 10, 15]);
});

void test("removeTreeWithRetries fails immediately for non-transient errors", async () => {
  let attempts = 0;
  const error = new Error("not found") as NodeJS.ErrnoException;
  error.code = "ENOENT";

  await assert.rejects(
    removeTreeWithRetries(
      "/tmp/missing",
      { maxRetries: 10, retryDelayMs: 1 },
      async () => {
        attempts += 1;
        throw error;
      },
      async () => {
        throw new Error("sleep must not run");
      },
    ),
    error,
  );
  assert.equal(attempts, 1);
  assert.equal(retryRemoveInternals.isRetryableRemoveError(error), false);
});

void test("removeTreeWithRetries stops after the bounded retry budget", async () => {
  let attempts = 0;
  const error = new Error("busy") as NodeJS.ErrnoException;
  error.code = "EBUSY";

  await assert.rejects(
    removeTreeWithRetries(
      "/tmp/busy",
      { maxRetries: 2, retryDelayMs: 1 },
      async () => {
        attempts += 1;
        throw error;
      },
      async () => undefined,
    ),
    error,
  );

  assert.equal(attempts, 3);
  assert.equal(retryRemoveInternals.isRetryableRemoveError(error), true);
});

void test("removeTreeWithRetries covers default options, sleep, and error shapes", async () => {
  let attempts = 0;
  await removeTreeWithRetries("/tmp/default-retry", undefined, async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("busy") as NodeJS.ErrnoException;
      error.code = "EBUSY";
      throw error;
    }
  });

  assert.equal(attempts, 2);
  assert.equal(retryRemoveInternals.isRetryableRemoveError(null), false);
  assert.equal(
    retryRemoveInternals.isRetryableRemoveError({ code: 123 }),
    false,
  );
});
