import assert from "node:assert/strict";
import test from "node:test";

import {
  DeadlineExceededError,
  createDeadline,
  resolveTimeoutSeconds,
  setActiveDeadline,
  getActiveDeadline,
  isDeadlineExceeded,
  assertNotDeadlineExceeded,
} from "../lib/deadline.js";

// ---------------------------------------------------------------------------
// DeadlineExceededError
// ---------------------------------------------------------------------------

void test("DeadlineExceededError has correct name and message", () => {
  const error = new DeadlineExceededError("test message");
  assert.equal(error.name, "DeadlineExceededError");
  assert.equal(error.message, "test message");
  assert.ok(error instanceof Error);
});

// ---------------------------------------------------------------------------
// resolveTimeoutSeconds
// ---------------------------------------------------------------------------

void test("resolveTimeoutSeconds returns parsed number from flag value", () => {
  assert.equal(resolveTimeoutSeconds("120"), 120);
  assert.equal(resolveTimeoutSeconds("60"), 60);
});

void test("resolveTimeoutSeconds falls back to env var", () => {
  assert.equal(
    resolveTimeoutSeconds(undefined, { AGENT_HARNESS_TIMEOUT_SECONDS: "90" }),
    90,
  );
});

void test("resolveTimeoutSeconds prefers flag over env var", () => {
  assert.equal(
    resolveTimeoutSeconds("30", { AGENT_HARNESS_TIMEOUT_SECONDS: "90" }),
    30,
  );
});

void test("resolveTimeoutSeconds returns undefined for empty flag and no env", () => {
  assert.equal(resolveTimeoutSeconds(undefined), undefined);
  assert.equal(resolveTimeoutSeconds(undefined, {}), undefined);
});

void test("resolveTimeoutSeconds returns undefined for non-numeric values", () => {
  assert.equal(resolveTimeoutSeconds("abc"), undefined);
  assert.equal(resolveTimeoutSeconds(""), undefined);
});

void test("resolveTimeoutSeconds returns undefined for zero and negative", () => {
  assert.equal(resolveTimeoutSeconds("0"), undefined);
  assert.equal(resolveTimeoutSeconds("-5"), undefined);
});

// ---------------------------------------------------------------------------
// createDeadline
// ---------------------------------------------------------------------------

void test("createDeadline returns undefined for falsy input", () => {
  assert.equal(createDeadline(undefined), undefined);
  assert.equal(createDeadline(0), undefined);
  assert.equal(createDeadline(-1), undefined);
});

void test("createDeadline creates a deadline with future timestamp", () => {
  const deadline = createDeadline(30);
  assert.ok(deadline);
  assert.ok(deadline.at > Date.now() - 1000); // within the last second
  assert.equal(deadline.timeoutSeconds, 30);
});

void test("createDeadline clamps below minimum", () => {
  const deadline = createDeadline(5);
  assert.ok(deadline);
  assert.equal(deadline.timeoutSeconds, 10); // clamped to MIN_TIMEOUT_SECONDS
});

void test("createDeadline clamps above maximum", () => {
  const deadline = createDeadline(10000);
  assert.ok(deadline);
  assert.equal(deadline.timeoutSeconds, 3600); // clamped to MAX_TIMEOUT_SECONDS
});

// ---------------------------------------------------------------------------
// isDeadlineExceeded
// ---------------------------------------------------------------------------

void test("isDeadlineExceeded returns false when deadline is undefined", () => {
  assert.equal(isDeadlineExceeded(undefined), false);
});

void test("isDeadlineExceeded returns false for future deadline", () => {
  const deadline = createDeadline(3600); // 1 hour from now
  assert.equal(isDeadlineExceeded(deadline), false);
});

void test("isDeadlineExceeded returns true for past deadline", async () => {
  // Create a deadline that is already in the past.
  const deadline = { at: Date.now() - 1000, timeoutSeconds: 10 };
  assert.equal(isDeadlineExceeded(deadline), true);
});

// ---------------------------------------------------------------------------
// assertNotDeadlineExceeded
// ---------------------------------------------------------------------------

void test("assertNotDeadlineExceeded does not throw when deadline is undefined", () => {
  assert.doesNotThrow(() => {
    assertNotDeadlineExceeded(undefined, "test context");
  });
});

void test("assertNotDeadlineExceeded does not throw for future deadline", () => {
  const deadline = createDeadline(3600);
  assert.doesNotThrow(() => {
    assertNotDeadlineExceeded(deadline, "test context");
  });
});

void test("assertNotDeadlineExceeded throws DeadlineExceededError for past deadline", () => {
  const deadline = { at: Date.now() - 1000, timeoutSeconds: 10 };
  assert.throws(
    () => assertNotDeadlineExceeded(deadline, "discover catalog"),
    (error: unknown) =>
      error instanceof DeadlineExceededError &&
      error.message.includes(
        "Deadline of 10s exceeded during: discover catalog",
      ),
  );
});

// ---------------------------------------------------------------------------
// setActiveDeadline / getActiveDeadline
// ---------------------------------------------------------------------------

void test("getActiveDeadline returns undefined when not set", () => {
  // Reset to undefined first (in case another test set it).
  setActiveDeadline(undefined);
  assert.equal(getActiveDeadline(), undefined);
});

void test("setActiveDeadline and getActiveDeadline round-trip", () => {
  const deadline = createDeadline(120);
  setActiveDeadline(deadline);
  assert.equal(getActiveDeadline(), deadline);
  // Clean up.
  setActiveDeadline(undefined);
});

void test("setActiveDeadline clears with undefined", () => {
  const deadline = createDeadline(60);
  setActiveDeadline(deadline);
  assert.ok(getActiveDeadline());
  setActiveDeadline(undefined);
  assert.equal(getActiveDeadline(), undefined);
});

void test("setActiveDeadline / getActiveDeadline concurrency", async () => {
  // Multiple concurrent sets and gets should not corrupt state.
  const results = await Promise.all(
    Array.from({ length: 50 }, async (_, index) => {
      const deadline = createDeadline(10 + index);
      setActiveDeadline(deadline);
      const retrieved = getActiveDeadline();
      return { set: deadline, got: retrieved };
    }),
  );
  // Every get should return a Deadline (the last-set by any concurrent task).
  for (const result of results) {
    assert.ok(result.got);
    assert.ok(typeof result.got.at === "number");
    assert.ok(typeof result.got.timeoutSeconds === "number");
  }
  // Clean up.
  setActiveDeadline(undefined);
});

// ---------------------------------------------------------------------------
// resolveTimeoutSeconds — sanitization
// ---------------------------------------------------------------------------

void test("resolveTimeoutSeconds handles Infinity string safely", () => {
  assert.equal(resolveTimeoutSeconds("Infinity"), undefined);
  assert.equal(resolveTimeoutSeconds("-Infinity"), undefined);
});

void test("resolveTimeoutSeconds handles NaN string safely", () => {
  assert.equal(resolveTimeoutSeconds("NaN"), undefined);
});

void test("resolveTimeoutSeconds handles very large numeric strings", () => {
  assert.equal(resolveTimeoutSeconds("999999999"), 999999999);
});

void test("resolveTimeoutSeconds handles whitespace-only strings", () => {
  assert.equal(resolveTimeoutSeconds("  "), undefined);
  assert.equal(resolveTimeoutSeconds("\t"), undefined);
});

void test("resolveTimeoutSeconds handles decimal numbers", () => {
  assert.equal(resolveTimeoutSeconds("30.5"), 30.5);
});

void test("resolveTimeoutSeconds handles leading/trailing whitespace", () => {
  // Number(" 120 ") returns 120, so whitespace is tolerated by the parser.
  assert.equal(resolveTimeoutSeconds(" 120 "), 120);
});

// ---------------------------------------------------------------------------
// createDeadline — edge cases
// ---------------------------------------------------------------------------

void test("createDeadline with fractional seconds", () => {
  const deadline = createDeadline(30.5);
  assert.ok(deadline);
  assert.equal(deadline.timeoutSeconds, 30.5);
});

void test("createDeadline stress — rapid creation of many deadlines", () => {
  for (let index = 0; index < 1000; index++) {
    const deadline = createDeadline(60);
    assert.ok(deadline);
    assert.ok(deadline.at > 0);
    assert.equal(deadline.timeoutSeconds, 60);
  }
});

// ---------------------------------------------------------------------------
// isDeadlineExceeded — edge cases
// ---------------------------------------------------------------------------

void test("isDeadlineExceeded returns true exactly at the deadline boundary", () => {
  const deadline = { at: Date.now(), timeoutSeconds: 10 };
  // Date.now() may have advanced, but the deadline is in the very near past.
  assert.equal(isDeadlineExceeded(deadline), true);
});

void test("isDeadlineExceeded handles very large timeout values", () => {
  const deadline = createDeadline(3600);
  assert.equal(isDeadlineExceeded(deadline), false);
});

// ---------------------------------------------------------------------------
// assertNotDeadlineExceeded — edge cases
// ---------------------------------------------------------------------------

void test("assertNotDeadlineExceeded message includes context for empty string context", () => {
  const deadline = { at: Date.now() - 1000, timeoutSeconds: 5 };
  assert.throws(
    () => assertNotDeadlineExceeded(deadline, ""),
    (error: unknown) =>
      error instanceof DeadlineExceededError &&
      error.message.includes("Deadline of 5s exceeded during: "),
  );
});
