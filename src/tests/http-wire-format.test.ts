import assert from "node:assert/strict";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { fetchWithTimeout, readResponseTextWithLimit } from "../lib/http.js";
import { githubInternals } from "../github.js";
import { runtimeConfigInternals } from "../config/runtime.js";

/**
 * HTTP wire-format tests against a REAL localhost server.
 *
 * Every existing HTTP test drives hand-rolled `Response` objects or mocked
 * `globalThis.fetch`; this suite exercises the same production code paths
 * over an actual TCP connection with real framing: content-length vs
 * chunked transfers, error bodies, rate-limit headers, retry-after
 * handling, connection failures, and stall aborts. The GitHub fetch path
 * is pointed at the local server by a forwarding fetch mock so the URL
 * rewriting is the only simulated part — bytes, headers, and statuses all
 * travel the real wire.
 */

interface WireServer {
  origin: string;
  requests: Array<{
    method: string;
    url: string | undefined;
    accept: string | null;
  }>;
  close: () => Promise<void>;
}

/** Starts a real HTTP server on an ephemeral localhost port. */
async function startWireServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<WireServer> {
  const requests: WireServer["requests"] = [];
  const server: Server = createServer((request, response) => {
    requests.push({
      method: request.method ?? "",
      url: request.url,
      accept: request.headers.accept ?? null,
    });
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

/** Installs a fetch mock that forwards every request to the wire server. */
function installServerBoundFetch(origin: string): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const parsed = new URL(rawUrl);
    const nextUrl = `${origin}${parsed.pathname}${parsed.search}`;
    return originalFetch(nextUrl, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

/** Clears the module-level GitHub rate-limit state after tests that set it. */
async function clearGitHubRateLimitState(): Promise<void> {
  await githubInternals.captureRateLimit(
    new Response(null, {
      status: 200,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "0" },
    }),
  );
  githubInternals.isRateLimited();
}

void test("wire: content-length JSON response parses through the real GitHub fetch path", async () => {
  const wire = await startWireServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ name: "wire-test", starCount: 12 }));
  });
  const restoreFetch = installServerBoundFetch(wire.origin);
  try {
    const result = await githubInternals.fetchGitHubJson<{
      name: string;
      starCount: number;
    }>("/repos/owner/wire-test");

    assert.deepEqual(result, { name: "wire-test", starCount: 12 });
    assert.equal(wire.requests.length, 1);
    assert.equal(wire.requests[0]?.method, "GET");
    assert.equal(wire.requests[0]?.url, "/repos/owner/wire-test");
    assert.equal(
      wire.requests[0]?.accept,
      "application/vnd.github+json",
      "the production GitHub Accept header must cross the real wire",
    );
  } finally {
    restoreFetch();
    await wire.close();
  }
});

void test("wire: chunked JSON response without content-length parses", async () => {
  const wire = await startWireServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    // No content-length: split the payload across writes so the reader
    // consumes a streamed transfer-encoding body chunk by chunk.
    response.write('{"name":"');
    response.write("chunked");
    response.end('","ok":true}');
  });
  const restoreFetch = installServerBoundFetch(wire.origin);
  try {
    const result = await githubInternals.fetchGitHubJson<{
      name: string;
      ok: boolean;
    }>("/repos/owner/chunked");

    assert.deepEqual(result, { name: "chunked", ok: true });
  } finally {
    restoreFetch();
    await wire.close();
  }
});

void test("wire: 403 error body surfaces the status and captures the rate limit", async () => {
  const wire = await startWireServer((_request, response) => {
    response.statusCode = 403;
    response.setHeader("content-type", "application/json");
    response.setHeader("x-ratelimit-remaining", "0");
    response.setHeader(
      "x-ratelimit-reset",
      String(Math.floor(Date.now() / 1000) + 3600),
    );
    response.end(JSON.stringify({ message: "API rate limit exceeded" }));
  });
  const restoreFetch = installServerBoundFetch(wire.origin);
  try {
    await assert.rejects(
      githubInternals.fetchGitHubJson("/repos/owner/limited"),
      /403/u,
    );
    assert.equal(githubInternals.isRateLimited(), true);
  } finally {
    await clearGitHubRateLimitState();
    restoreFetch();
    await wire.close();
  }
});

void test("wire: 404 with a JSON error body yields null via the optional fetch", async () => {
  const wire = await startWireServer((_request, response) => {
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ message: "Not Found" }));
  });
  const restoreFetch = installServerBoundFetch(wire.origin);
  try {
    const result = await githubInternals.fetchGitHubJsonOptional(
      "/repos/owner/missing",
    );
    assert.equal(result, null);
    assert.equal(wire.requests.length, 1);
  } finally {
    restoreFetch();
    await wire.close();
  }
});

void test("wire: 429 with retry-after retries once and succeeds on the second attempt", async () => {
  let attempts = 0;
  const wire = await startWireServer((_request, response) => {
    attempts += 1;
    if (attempts === 1) {
      response.statusCode = 429;
      response.setHeader("retry-after", "0");
      response.end(JSON.stringify({ message: "secondary rate limit" }));
      return;
    }
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ recovered: true }));
  });
  const restoreFetch = installServerBoundFetch(wire.origin);
  try {
    const result = await githubInternals.fetchGitHubJson<{
      recovered: boolean;
    }>("/repos/owner/retried");
    assert.deepEqual(result, { recovered: true });
    assert.equal(attempts, 2, "a real retry must occur over the wire");
    assert.equal(wire.requests.length, 2);
  } finally {
    restoreFetch();
    await wire.close();
  }
});

void test("wire: malformed JSON body throws a parse error naming the path", async () => {
  const wire = await startWireServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end("not-json{{{");
  });
  const restoreFetch = installServerBoundFetch(wire.origin);
  try {
    await assert.rejects(
      githubInternals.fetchGitHubJson("/repos/owner/broken"),
      /could not be parsed for \/repos\/owner\/broken/u,
    );
  } finally {
    restoreFetch();
    await wire.close();
  }
});

void test("wire: connection refused exhausts the configured retry budget", async () => {
  const originalRetries = process.env.AGENT_HARNESS_GITHUB_FETCH_RETRIES;
  const closedWire = await startWireServer((_request, response) => {
    response.statusCode = 200;
    response.end("{}");
  });
  const deadOrigin = closedWire.origin;
  await closedWire.close();
  const restoreFetch = installServerBoundFetch(deadOrigin);
  try {
    process.env.AGENT_HARNESS_GITHUB_FETCH_RETRIES = "1";
    runtimeConfigInternals.resetCacheForTesting();
    await assert.rejects(
      githubInternals.fetchGitHubJson("/repos/owner/unreachable"),
      /failed after 1 attempts/u,
    );
  } finally {
    if (originalRetries === undefined) {
      delete process.env.AGENT_HARNESS_GITHUB_FETCH_RETRIES;
    } else {
      process.env.AGENT_HARNESS_GITHUB_FETCH_RETRIES = originalRetries;
    }
    runtimeConfigInternals.resetCacheForTesting();
    restoreFetch();
  }
});

void test("wire: stalled response is aborted at the fetch timeout budget", async () => {
  const wire = await startWireServer(() => {
    // Intentionally never respond — the client must abort on its own timer.
  });
  try {
    await assert.rejects(
      fetchWithTimeout(`${wire.origin}/stall`, {}, 150),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError",
    );
  } finally {
    await wire.close();
  }
});

void test("wire: streamed body over the byte limit is rejected mid-read", async () => {
  const wire = await startWireServer((_request, response) => {
    response.statusCode = 200;
    response.write(Buffer.alloc(2048, 0x61)); // 2 KiB of "a" with no length
    response.end("tail");
  });
  try {
    const response = await fetchWithTimeout(`${wire.origin}/large`, {});
    await assert.rejects(
      readResponseTextWithLimit(response, 1024),
      /exceeds the configured limit/u,
    );
  } finally {
    await wire.close();
  }
});
