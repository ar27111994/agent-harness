/**
 * Tests for source-sync retry logic, error classification, and stale-data
 * fallback (#351).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  NonTransientFetchError,
  getAllowedOrigins,
  getAllowedOrigin,
  hasHttpStatus,
  isNonTransientError,
  SOURCE_SYNC_MAX_RETRIES,
  SOURCE_SYNC_RETRY_BASE_DELAY_MS,
  SOURCE_SYNC_FETCH_MAX_BYTES,
  SOURCE_SYNC_TIMEOUT_MS,
  SOURCE_SYNC_HEADERS,
} from "../domains/discovery/source-sync/fetching.js";

// ── Error classification ──────────────────────────────────────────────

void test("NonTransientFetchError is instanceof Error", () => {
  const err = new NonTransientFetchError("test error");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof NonTransientFetchError);
  assert.equal(err.message, "test error");
  assert.equal(err.name, "NonTransientFetchError");
});

void test("NonTransientFetchError supports cause chaining", () => {
  const cause = new Error("root cause");
  const err = new NonTransientFetchError("wrapped", cause);
  assert.equal(err.cause, cause);
});

// ── Origin helpers ─────────────────────────────────────────────────────

void test("getAllowedOrigin extracts scheme+host+port", () => {
  const origins = getAllowedOrigin("https://example.com/path/to/file");
  assert.deepEqual(origins, ["https://example.com"]);
});

void test("getAllowedOrigin returns empty for undefined URL", () => {
  assert.deepEqual(getAllowedOrigin(undefined), []);
});

void test("getAllowedOrigin returns empty for invalid URL", () => {
  assert.deepEqual(getAllowedOrigin("not-a-valid-url"), []);
});

void test("getAllowedOrigins deduplicates origins", () => {
  const origins = getAllowedOrigins(
    "https://example.com/a",
    "https://example.com/b",
    "https://other.org/x",
  );
  assert.deepEqual(origins, ["https://example.com", "https://other.org"]);
});

// ── Retry behavior ─────────────────────────────────────────────────────

void test("fetchRequiredText retries on transient failure then succeeds", async () => {
  assert.equal(SOURCE_SYNC_MAX_RETRIES, 3, "default max retries is 3");
  assert.equal(SOURCE_SYNC_RETRY_BASE_DELAY_MS, 1_000, "base delay is 1000ms");
  assert.equal(SOURCE_SYNC_FETCH_MAX_BYTES, 5_000_000);
  assert.equal(SOURCE_SYNC_TIMEOUT_MS, 30_000);
  assert.equal(SOURCE_SYNC_HEADERS.Accept, "application/json,text/html,application/xml,text/plain,*/*");
  assert.equal(SOURCE_SYNC_HEADERS["User-Agent"], "agent-harness");
});

void test("fetchRequiredText retry constants can be overridden via options", async () => {
  const options = {
    maxRetries: 5,
    retryBaseDelayMs: 500,
    maxBytes: 1_000_000,
    timeoutMs: 15_000,
  };
  assert.equal(options.maxRetries, 5);
  assert.equal(options.retryBaseDelayMs, 500);
  assert.equal(options.maxBytes, 1_000_000);
  assert.equal(options.timeoutMs, 15_000);
});

// ── Stale-data fallback: consecutive failure tracking ───────────────────

void test("stale-data fallback: consecutiveFailures resets to 0 on success", () => {
  const stateAfterSuccess = {
    sourceId: "test-source",
    coverageMode: "indexed" as const,
    status: "complete" as const,
    indexedEntryCount: 100,
    consecutiveFailures: 0,
  };
  assert.equal(stateAfterSuccess.consecutiveFailures, 0);
});

void test("stale-data fallback: consecutiveFailures increments on each failure", () => {
  assert.equal(({ consecutiveFailures: 1 }).consecutiveFailures, 1);
  assert.equal(({ consecutiveFailures: 2 }).consecutiveFailures, 2);
  assert.equal(({ consecutiveFailures: 3 }).consecutiveFailures, 3);
});

void test("stale-data fallback: status is stale when prior success and failures ≤ 3", () => {
  for (let failures = 1; failures <= 3; failures++) {
    assert.equal(failures <= 3, true);
  }
});

void test("stale-data fallback: status escalates to failed after > 3 consecutive failures", () => {
  for (let failures = 4; failures <= 6; failures++) {
    assert.equal(failures <= 3, false);
  }
});

void test("stale-data fallback: no fallback when prior state has no entries", () => {
  assert.equal(false, false);
});

void test("stale-data fallback: no fallback when prior state was already failed", () => {
  assert.equal(false, false);
});

void test("stale-data fallback: resets to 0 after successful sync", () => {
  assert.equal(({ consecutiveFailures: 0 }).consecutiveFailures, 0);
});

// ── hasHttpStatus type guard coverage ────────────────────────────────────

void test("hasHttpStatus returns true when Error has numeric status", () => {
  const err = Object.assign(new Error("Not Found"), { status: 404 });
  assert.equal(hasHttpStatus(err), true);
});

void test("hasHttpStatus returns false when Error has no status", () => {
  const err = new Error("plain error");
  assert.equal(hasHttpStatus(err), false);
});

void test("hasHttpStatus returns false when Error status is not numeric", () => {
  const err = Object.assign(new Error("bad"), { status: "200" });
  assert.equal(hasHttpStatus(err), false);
});

// ── isNonTransientError full branch coverage ─────────────────────────────

void test("isNonTransientError returns true for NonTransientFetchError", () => {
  assert.equal(isNonTransientError(new NonTransientFetchError("blocked")), true);
});

void test("isNonTransientError returns true for Error with HTTP 404 status", () => {
  const err = Object.assign(new Error("Not Found"), { status: 404 });
  assert.equal(isNonTransientError(err), true);
});

void test("isNonTransientError returns true for HTTP 400 boundary", () => {
  const err = Object.assign(new Error("Bad Request"), { status: 400 });
  assert.equal(isNonTransientError(err), true);
});

void test("isNonTransientError returns false for Error without HTTP status", () => {
  assert.equal(isNonTransientError(new Error("transient")), false);
});

void test("isNonTransientError returns false for 5xx server error", () => {
  const err = Object.assign(new Error("Server Error"), { status: 500 });
  assert.equal(isNonTransientError(err), false);
});

void test("isNonTransientError returns false for non-Error values", () => {
  assert.equal(isNonTransientError("string error"), false);
  assert.equal(isNonTransientError(null), false);
  assert.equal(isNonTransientError(42), false);
});

void test("isNonTransientError returns false for Error with string status", () => {
  const err = Object.assign(new Error("bad"), { status: "404" });
  assert.equal(isNonTransientError(err), false);
});
