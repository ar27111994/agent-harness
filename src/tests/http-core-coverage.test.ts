import { setHttpTestFetchMocks } from "./env-test-utils.js";
import assert from "node:assert/strict";
import type { ClientRequest, IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";

import {
  assertAllowedHttpUrl,
  assertPublicInternetResolution,
  createPinnedLookup,
  fetchBytesWithGuards,
  fetchJsonWithGuards,
  fetchWithTimeout,
  httpInternals,
  readResponseBytesWithLimit,
} from "../lib/http.js";

void test("test fetch mock injection restores its previous state", () => {
  const restoreEnabled = httpInternals.setTestFetchMocksForTests(true);
  restoreEnabled();
  const restoreDisabled = httpInternals.setTestFetchMocksForTests(false);
  restoreDisabled();
});

void test("fetchWithTimeout propagates an already-aborted caller signal", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  controller.abort("already-aborted");
  let observedSignal: AbortSignal | undefined;

  globalThis.fetch = async (_url, init) => {
    observedSignal = init?.signal ?? undefined;
    return new Response("ok", { status: 200 });
  };

  try {
    const response = await fetchWithTimeout(
      "https://example.com",
      { signal: controller.signal },
      50,
    );

    assert.equal(response.status, 200);
    assert.equal(observedSignal?.aborted, true);
    assert.equal(observedSignal?.reason, "already-aborted");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("guarded fetch test mocks serialize request bodies and parse json responses", async () => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  setHttpTestFetchMocks(true);

  const observed: Array<{
    method: string | undefined;
    contentLength: string | null;
    bodyText: string;
  }> = [];
  let callCount = 0;

  globalThis.fetch = async (_url, init) => {
    const rawBody = init?.body;
    let bodyText = "";
    if (typeof rawBody === "string") {
      bodyText = rawBody;
    } else if (rawBody instanceof ArrayBuffer) {
      bodyText = Buffer.from(rawBody).toString("utf8");
    }

    observed.push({
      method: init?.method,
      contentLength: new Headers(init?.headers).get("content-length"),
      bodyText,
    });
    callCount += 1;

    if (callCount === 1) {
      return new Response(JSON.stringify({ ok: true, bodyText }), {
        status: 200,
        headers: { "content-length": "26" },
      });
    }

    if (callCount === 2) {
      return new Response("not-json", { status: 200 });
    }

    if (callCount === 4) {
      return new Response("server-error", { status: 500, statusText: "" });
    }

    return new Response("server-error", { status: 500 });
  };

  try {
    const jsonResult = await fetchJsonWithGuards("https://example.com/api", {
      allowedOrigins: ["https://example.com"],
      body: new URLSearchParams({ alpha: "1", beta: "2" }),
      resolveHostname: async () => [{ address: "8.8.8.8", family: 4 }],
      timeoutMs: 250,
    });
    const invalidJsonResult = await fetchJsonWithGuards(
      "https://example.com/api",
      {
        allowedOrigins: ["https://example.com"],
        body: new Uint8Array(Buffer.from("bytes")),
        resolveHostname: async () => [{ address: "8.8.8.8", family: 4 }],
      },
    );
    const nonOkResult = await fetchBytesWithGuards("https://example.com/api", {
      allowedOrigins: ["https://example.com"],
      body: Buffer.from("body"),
      resolveHostname: async () => [{ address: "8.8.8.8", family: 4 }],
    });
    await assert.rejects(
      fetchBytesWithGuards("https://example.com/api", {
        allowedOrigins: ["https://example.com"],
        body: "empty-status",
        resolveHostname: async () => [{ address: "8.8.8.8", family: 4 }],
        throwOnHttpError: true,
      }),
      /HTTP 500/u,
    );
    const emptyStatusError = httpInternals.buildHttpStatusError(
      new Response("failure", { status: 418, statusText: "" }),
    );
    assert.equal(emptyStatusError.message, "HTTP 418");
    assert.equal(emptyStatusError.status, 418);
    const namedStatusError = httpInternals.buildHttpStatusError(
      new Response("failure", { status: 418, statusText: "I'm a teapot" }),
    );
    assert.equal(namedStatusError.message, "HTTP 418 I'm a teapot");

    assert.deepEqual(jsonResult, { ok: true, bodyText: "alpha=1&beta=2" });
    assert.equal(invalidJsonResult, null);
    assert.equal(nonOkResult, null);
    assert.deepEqual(observed, [
      {
        method: "POST",
        contentLength: String(Buffer.byteLength("alpha=1&beta=2")),
        bodyText: "alpha=1&beta=2",
      },
      {
        method: "POST",
        contentLength: String(Buffer.byteLength("bytes")),
        bodyText: "bytes",
      },
      {
        method: "POST",
        contentLength: String(Buffer.byteLength("body")),
        bodyText: "body",
      },
      {
        method: "POST",
        contentLength: String(Buffer.byteLength("empty-status")),
        bodyText: "empty-status",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
  }
});

void test("guarded fetch mocks respect explicit methods and array-buffer request bodies", async () => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  setHttpTestFetchMocks(true);
  const bodyBuffer = new TextEncoder().encode("array-buffer-body");
  let observedMethod: string | undefined;
  let observedBody: string | undefined;
  let observedContentLength: string | null = null;

  globalThis.fetch = async (_url, init) => {
    observedMethod = init?.method;
    observedContentLength = new Headers(init?.headers).get("content-length");
    observedBody = Buffer.from(init?.body as ArrayBuffer).toString("utf8");
    return new Response("done", { status: 200 });
  };

  try {
    const bytes = await fetchBytesWithGuards("https://example.com/upload", {
      allowedOrigins: ["https://example.com"],
      body: bodyBuffer.buffer,
      method: "PUT",
      resolveHostname: async () => [{ address: "8.8.8.8", family: 4 }],
      timeoutMs: 250,
    });

    assert.deepEqual(bytes, Buffer.from("done"));
    assert.equal(observedMethod, "PUT");
    assert.equal(observedBody, "array-buffer-body");
    assert.equal(
      observedContentLength,
      String(Buffer.byteLength("array-buffer-body")),
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
  }
});

void test("http guards reject invalid origins resolution failures and missing callbacks", async () => {
  assert.equal(
    assertAllowedHttpUrl("https://Example.com/path", ["https://example.com"])
      .origin,
    "https://example.com",
  );
  assert.throws(
    () =>
      assertAllowedHttpUrl("http://example.com/path", ["https://example.com"]),
    /Only https URLs can be fetched/u,
  );

  await assert.rejects(
    assertPublicInternetResolution(
      new URL("https://example.com/path"),
      async () => [],
    ),
    /did not resolve/u,
  );
  await assert.rejects(
    assertPublicInternetResolution(
      new URL("https://example.com/path"),
      async () => [{ address: "10.0.0.5", family: 4 }],
    ),
    /non-public/u,
  );
  await assert.doesNotReject(
    assertPublicInternetResolution(
      new URL("https://example.com/path"),
      async () => [{ address: "1.1.1.1", family: 4 }],
    ),
  );

  const pinnedLookup = createPinnedLookup({ address: "1.1.1.1", family: 4 });
  assert.throws(
    () =>
      (pinnedLookup as (...args: unknown[]) => void)("example.com", {
        all: false,
        hints: 0,
      }),
    /DNS lookup callback is required/u,
  );
});

void test("response readers enforce content-length and streamed byte limits", async () => {
  await assert.rejects(
    readResponseBytesWithLimit(
      new Response("abc", { headers: { "content-length": "10" } }),
      3,
      100,
    ),
    /Response body exceeds the configured limit \(10 > 3 bytes\)/u,
  );

  const nullBodyResponse = new Response(null, { status: 204 });
  assert.deepEqual(
    await readResponseBytesWithLimit(nullBodyResponse, 3, 100),
    Buffer.alloc(0),
  );

  const streamingResponse = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
      },
    }),
  );
  await assert.rejects(
    readResponseBytesWithLimit(streamingResponse, 3, 100),
    /Response body exceeds the configured limit \(4 > 3 bytes\)/u,
  );
});

void test("guarded byte fetch returns null for validation failures", async () => {
  assert.equal(
    await fetchBytesWithGuards("https://example.com/private", {
      allowedOrigins: ["https://example.com"],
      resolveHostname: async () => [{ address: "127.0.0.1", family: 4 }],
    }),
    null,
  );
});

void test("http internals keep only IPv4 and IPv6 DNS lookup families", () => {
  assert.deepEqual(
    httpInternals.normalizeResolvedHostnameAddresses([
      { address: "1.1.1.1", family: 4 },
      { address: "::1", family: 6 },
      { address: "ignored", family: 0 },
    ]),
    [
      { address: "1.1.1.1", family: 4 },
      { address: "::1", family: 6 },
    ],
  );
});

void test("http internals classify mapped ipv6 private ranges", () => {
  assert.equal(
    httpInternals.isPrivateIpv6Address("::ffff:0:203.0.113.10"),
    true,
  );
  assert.equal(httpInternals.isPrivateIpv6Address("::ffff:10.0.0.1"), true);
  assert.equal(httpInternals.isPrivateIpv6Address("2001:db8::1"), true);
  assert.equal(
    httpInternals.isPrivateIpv6Address("2001:4860:4860::8888"),
    false,
  );
});

void test("http guards cover branch-only address and lookup variants", async () => {
  assert.equal(
    await fetchBytesWithGuards("https://example.com/no-origin"),
    null,
  );

  await assert.doesNotReject(
    assertPublicInternetResolution(new URL("https://8.8.8.8/path")),
  );
  await assert.doesNotReject(
    assertPublicInternetResolution(
      new URL("https://[2001:4860:4860::8888]/path"),
    ),
  );

  const pinnedLookup = createPinnedLookup({ address: "1.1.1.1", family: 4 });
  const singleResult = await new Promise<{ address: string; family: number }>(
    (resolve, reject) => {
      (pinnedLookup as (...args: unknown[]) => void)(
        "example.com",
        (error: Error | null, address: string, family: number) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ address, family });
        },
      );
    },
  );
  assert.deepEqual(singleResult, { address: "1.1.1.1", family: 4 });

  for (const address of [
    "172.16.0.1",
    "100.64.0.1",
    "192.0.0.8",
    "192.88.99.1",
    "198.18.0.1",
    "198.51.100.10",
    "203.0.113.10",
  ]) {
    assert.equal(httpInternals.isPrivateIpv4Address(address), true, address);
  }
  assert.equal(httpInternals.isPrivateIpv4Address("172.32.0.1"), false);
});

void test("DNS resolution rejects localhost as a non-public hostname", async () => {
  await assert.rejects(
    assertPublicInternetResolution(new URL("https://localhost/path")),
    /non-public/u,
  );
});

void test("pinned http requests preserve sparse status and multi-value headers", async () => {
  const fakeRequest = ((...args: unknown[]) => {
    const callback = args[args.length - 1] as
      ((response: IncomingMessage) => void) | undefined;
    const responseMessage = Readable.from([Buffer.from("pinned-ok")]);
    Object.assign(responseMessage, {
      headers: {
        "set-cookie": ["a=1", "b=2"],
        "x-fixture": "yes",
        "x-undefined": undefined,
      },
      statusCode: undefined,
      statusMessage: undefined,
    });
    callback?.(responseMessage as IncomingMessage);
    return {
      on: () => undefined,
      write: () => undefined,
      end: () => undefined,
    } as unknown as ClientRequest;
  }) as Parameters<typeof httpInternals.setHttpsRequestForTests>[0];
  const restoreRequest = httpInternals.setHttpsRequestForTests(fakeRequest);

  try {
    const response = await httpInternals.requestWithPinnedAddress(
      new URL("https://example.com/path"),
      { address: "1.1.1.1", family: 4 },
      {},
      new AbortController().signal,
    );

    assert.equal(response.status, 502);
    assert.equal(response.headers.get("x-fixture"), "yes");
    assert.equal(response.headers.get("set-cookie"), "a=1, b=2");
    assert.equal(await response.text(), "pinned-ok");
  } finally {
    restoreRequest();
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (name === "AGENT_HARNESS_TEST_FETCH_MOCKS") {
    setHttpTestFetchMocks(value === "1");
  }
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

// ─── review: JSON-injection semantics on fetched feeds ─────────────────────

async function withFetchMock(
  body: string,
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const previousFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  setHttpTestFetchMocks(true);
  globalThis.fetch = async () => new Response(body, { status: 200 });
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (previousFlag === undefined) {
      setHttpTestFetchMocks(false);
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFlag;
      setHttpTestFetchMocks(previousFlag === "1");
    }
  }
}

void test("fetchJsonWithGuards parses a BOM-prefixed response end-to-end (review)", async () => {
  // The WHATWG decoder behind Response.text() strips the leading BOM, so a
  // BOM'd feed must still parse — pinned end-to-end so the contract stays
  // deliberate (a BOM reaching JSON.parse would fail it and silently sync
  // nothing).
  await withFetchMock(
    `\uFEFF${JSON.stringify({ payload: "bom-survivor" })}`,
    async () => {
      const result = await fetchJsonWithGuards("https://example.com/bom", {
        allowedOrigins: ["https://example.com"],
      });
      assert.deepEqual(result, { payload: "bom-survivor" });
    },
  );
});

void test("fetchJsonWithGuards keeps duplicate-key last-wins semantics pinned (review)", async () => {
  await withFetchMock('{"dupe":1,"dupe":2}', async () => {
    const result = await fetchJsonWithGuards("https://example.com/dupe", {
      allowedOrigins: ["https://example.com"],
    });
    assert.deepEqual(result, { dupe: 2 }, "JSON.parse last-wins is deliberate");
  });
});

void test("fetchJsonWithGuards keeps __proto__-key feeds as safe own data (review)", async () => {
  await withFetchMock('{"__proto__":{"polluted":true},"ok":1}', async () => {
    const result = (await fetchJsonWithGuards("https://example.com/proto", {
      allowedOrigins: ["https://example.com"],
    })) as Record<string, unknown>;
    assert.equal(result.ok, 1);
    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "__proto__"),
      true,
      "the key arrives as a plain own property, never touching the prototype",
    );
    assert.equal(
      ({} as Record<string, unknown>).polluted,
      undefined,
      "no prototype pollution",
    );
  });
});
