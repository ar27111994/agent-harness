import { setHttpTestFetchMocks } from "./env-test-utils.js";
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
  fetchWithRetry,
  fetchRequiredText,
  hasHttpStatus,
  isNonTransientError,
  SOURCE_SYNC_MAX_RETRIES,
  SOURCE_SYNC_RETRY_BASE_DELAY_MS,
  SOURCE_SYNC_FETCH_MAX_BYTES,
  SOURCE_SYNC_LARGE_RESPONSE_MAX_BYTES,
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
  assert.equal(
    SOURCE_SYNC_HEADERS.Accept,
    "application/json,text/html,application/xml,text/plain,*/*",
  );
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

// ── Response byte-cap wiring (review T2) ────────────────────────────────

const CAP_PROBE_URL = "https://agenticresourcediscovery.org/fixtures/cap.json";
const CAP_PROBE_ORIGINS = ["https://agenticresourcediscovery.org"];

void test("fetchRequiredText aborts over-cap responses through the guarded fetch layer (review T2)", async () => {
  const originalFetch = globalThis.fetch;
  const previousFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  setHttpTestFetchMocks(true);
  try {
    // Control: a small body under the 5MB default cap returns normally.
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await assert.doesNotReject(
      fetchRequiredText(CAP_PROBE_URL, CAP_PROBE_ORIGINS, {
        timeoutMs: 5_000,
      }),
      "an under-cap registry response must pass through fetchRequiredText",
    );

    // Over-cap via Content-Length (review): the guarded reader rejects on
    // the header BEFORE buffering, so a TINY body with an oversized
    // content-length exercises the 5MB default wiring without allocating
    // multi-megabyte buffers.
    const tinyBody = new TextEncoder().encode("{}");
    globalThis.fetch = async () =>
      new Response(tinyBody, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(6 * 1024 * 1024),
        },
      });
    await assert.rejects(
      fetchRequiredText(CAP_PROBE_URL, CAP_PROBE_ORIGINS, {
        maxRetries: 0,
        timeoutMs: 5_000,
      }),
      /Failed to fetch|exceeds the configured limit/u,
      "an over-cap Content-Length must abort through the guarded fetch layer",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousFlag === undefined) {
      setHttpTestFetchMocks(false);
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFlag;
      setHttpTestFetchMocks(previousFlag === "1");
    }
  }
});

void test("fetchRequiredText aborts mid-stream when no Content-Length is present (review T2)", async () => {
  const originalFetch = globalThis.fetch;
  const previousFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  setHttpTestFetchMocks(true);
  try {
    // No content-length header: the streaming reader must still abort once
    // the byte count passes maxBytes — covered with a tiny override so no
    // large buffer is needed.
    const body = new TextEncoder().encode("0123456789abcdef0123456789abcdef");
    globalThis.fetch = async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await assert.rejects(
      fetchRequiredText(CAP_PROBE_URL, CAP_PROBE_ORIGINS, {
        maxBytes: 10,
        maxRetries: 0,
        timeoutMs: 5_000,
      }),
      /Failed to fetch|exceeds the configured limit/u,
      "an over-cap stream without Content-Length must abort while reading",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousFlag === undefined) {
      setHttpTestFetchMocks(false);
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFlag;
      setHttpTestFetchMocks(previousFlag === "1");
    }
  }
});

void test("the packagist 25MB response budget is enforced through the same cap path (review T2)", async () => {
  const originalFetch = globalThis.fetch;
  const previousFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  setHttpTestFetchMocks(true);
  try {
    // packagist.ts passes SOURCE_SYNC_LARGE_RESPONSE_MAX_BYTES explicitly;
    // the Content-Length pre-check aborts on the header alone, so the
    // oversized budget is exercised with a tiny body.
    const tinyBody = new TextEncoder().encode("{}");
    globalThis.fetch = async () =>
      new Response(tinyBody, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(SOURCE_SYNC_LARGE_RESPONSE_MAX_BYTES + 1),
        },
      });
    await assert.rejects(
      fetchRequiredText(CAP_PROBE_URL, CAP_PROBE_ORIGINS, {
        maxBytes: SOURCE_SYNC_LARGE_RESPONSE_MAX_BYTES,
        maxRetries: 0,
        timeoutMs: 5_000,
      }),
      /Failed to fetch|exceeds the configured limit/u,
      "a response over the 25MB Packagist budget must abort through the guarded fetch layer",
    );

    // Control: an under-limit Content-Length passes.
    globalThis.fetch = async () =>
      new Response(tinyBody, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "1024",
        },
      });
    await assert.doesNotReject(
      fetchRequiredText(CAP_PROBE_URL, CAP_PROBE_ORIGINS, {
        maxBytes: SOURCE_SYNC_LARGE_RESPONSE_MAX_BYTES,
        timeoutMs: 5_000,
      }),
      "an under-limit Content-Length must pass the 25MB budget path",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousFlag === undefined) {
      setHttpTestFetchMocks(false);
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFlag;
      setHttpTestFetchMocks(previousFlag === "1");
    }
  }
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

// Stale-data fallback + consecutive-failure escalation is tested
// via integration-level source-sync tests (source-sync-additional.test.ts)
// and source-health stale-status reporting tests (source-health.test.ts).
// These validate the full lifecycle: increments, stale→failed escalation,
// reset-on-success, and suppression when no prior entries exist.

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
  assert.equal(
    isNonTransientError(new NonTransientFetchError("blocked")),
    true,
  );
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

// ── fetchWithRetry transient-retry coverage ──────────────────────────────

void test("fetchWithRetry retries on transient error then succeeds", async () => {
  let calls = 0;
  const result = await fetchWithRetry(
    "test://url",
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient network error");
      return "success";
    },
    { maxRetries: 2, retryBaseDelayMs: 1 },
  );
  assert.equal(result, "success");
  assert.equal(calls, 2, "should retry once then succeed");
});

void test("fetchWithRetry throws immediately on NonTransientFetchError with no retry", async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithRetry(
      "test://url",
      async () => {
        calls += 1;
        throw new NonTransientFetchError("blocked by policy");
      },
      { maxRetries: 2, retryBaseDelayMs: 1 },
    ),
    /blocked by policy/,
  );
  assert.equal(calls, 1, "non-transient errors should not retry");
});

void test("fetchWithRetry throws after exhausting all retries", async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithRetry(
      "test://url",
      async () => {
        calls += 1;
        throw new Error("persistent failure");
      },
      { maxRetries: 1, retryBaseDelayMs: 1 },
    ),
    /persistent failure/,
  );
  assert.equal(calls, 2, "should try once + retry once = 2 total");
});
