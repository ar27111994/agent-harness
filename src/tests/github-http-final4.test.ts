import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { writeJsonFile } from "../files.js";
import {
  clearGitHubState,
  fetchGitHubRepoSnapshot,
  fetchGitHubRepoSnapshotByRepoUrl,
  githubInternals,
} from "../github.js";
import {
  fetchTextWithGuards,
  httpInternals,
  readResponseBytesWithLimit,
} from "../lib/http.js";
import type { GitHubRepoSnapshot } from "../types.js";

void test("github internals cover validation errors, fallback messages, and cache recovery", async (context) => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-final4-"),
  );
  const previousRetries = process.env.AGENT_HARNESS_GITHUB_FETCH_RETRIES;
  const originalFetch = globalThis.fetch;

  context.after(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv("AGENT_HARNESS_GITHUB_FETCH_RETRIES", previousRetries);
    clearRuntimeConfigForTests();
    clearGitHubState();
    await rm(tempRoot, { force: true, recursive: true });
  });

  const validationCases: Array<{ value: unknown; expected: RegExp }> = [
    { value: null, expected: /Expected source health state to be an object/u },
    {
      value: { schemaVersion: 2, updatedAt: "now", entries: {} },
      expected: /Expected schemaVersion/u,
    },
    {
      value: { schemaVersion: 1, updatedAt: 1, entries: {} },
      expected: /Expected updatedAt/u,
    },
    {
      value: { schemaVersion: 1, updatedAt: "now", entries: [] },
      expected: /Expected entries to be a non-null object/u,
    },
    {
      value: { schemaVersion: 1, updatedAt: "now", entries: { bad: [] } },
      expected: /Expected entries.bad to be an object/u,
    },
    {
      value: {
        schemaVersion: 1,
        updatedAt: "now",
        entries: {
          bad: {
            sourceId: 1,
            owner: "octo",
            repo: "repo",
            lastAttemptAt: "now",
            lastSuccessAt: null,
            lastFailureAt: null,
            consecutiveFailures: 0,
            degradedMode: false,
            degradedReason: null,
            usedCacheLastAttempt: false,
            lastError: null,
          },
        },
      },
      expected: /entries.bad.sourceId/u,
    },
    {
      value: {
        schemaVersion: 1,
        updatedAt: "now",
        entries: {
          bad: {
            sourceId: "src",
            owner: 1,
            repo: "repo",
            lastAttemptAt: "now",
            lastSuccessAt: null,
            lastFailureAt: null,
            consecutiveFailures: 0,
            degradedMode: false,
            degradedReason: null,
            usedCacheLastAttempt: false,
            lastError: null,
          },
        },
      },
      expected: /entries.bad.owner/u,
    },
    {
      value: {
        schemaVersion: 1,
        updatedAt: "now",
        entries: {
          bad: {
            sourceId: "src",
            owner: "octo",
            repo: 1,
            lastAttemptAt: "now",
            lastSuccessAt: null,
            lastFailureAt: null,
            consecutiveFailures: 0,
            degradedMode: false,
            degradedReason: null,
            usedCacheLastAttempt: false,
            lastError: null,
          },
        },
      },
      expected: /entries.bad.repo/u,
    },
    {
      value: {
        schemaVersion: 1,
        updatedAt: "now",
        entries: {
          bad: {
            sourceId: "src",
            owner: "octo",
            repo: "repo",
            lastAttemptAt: 1,
            lastSuccessAt: null,
            lastFailureAt: null,
            consecutiveFailures: 0,
            degradedMode: false,
            degradedReason: null,
            usedCacheLastAttempt: false,
            lastError: null,
          },
        },
      },
      expected: /entries.bad.lastAttemptAt/u,
    },
    {
      value: {
        schemaVersion: 1,
        updatedAt: "now",
        entries: {
          bad: {
            sourceId: "src",
            owner: "octo",
            repo: "repo",
            lastAttemptAt: "now",
            lastSuccessAt: 1,
            lastFailureAt: null,
            consecutiveFailures: 0,
            degradedMode: false,
            degradedReason: null,
            usedCacheLastAttempt: false,
            lastError: null,
          },
        },
      },
      expected: /entries.bad.lastSuccessAt/u,
    },
    {
      value: {
        schemaVersion: 1,
        updatedAt: "now",
        entries: {
          bad: {
            sourceId: "src",
            owner: "octo",
            repo: "repo",
            lastAttemptAt: "now",
            lastSuccessAt: null,
            lastFailureAt: 1,
            consecutiveFailures: 0,
            degradedMode: false,
            degradedReason: null,
            usedCacheLastAttempt: false,
            lastError: null,
          },
        },
      },
      expected: /entries.bad.lastFailureAt/u,
    },
    {
      value: {
        schemaVersion: 1,
        updatedAt: "now",
        entries: {
          bad: {
            sourceId: "src",
            owner: "octo",
            repo: "repo",
            lastAttemptAt: "now",
            lastSuccessAt: null,
            lastFailureAt: null,
            consecutiveFailures: "zero",
            degradedMode: false,
            degradedReason: null,
            usedCacheLastAttempt: false,
            lastError: null,
          },
        },
      },
      expected: /entries.bad.consecutiveFailures/u,
    },
    {
      value: {
        schemaVersion: 1,
        updatedAt: "now",
        entries: {
          bad: {
            sourceId: "src",
            owner: "octo",
            repo: "repo",
            lastAttemptAt: "now",
            lastSuccessAt: null,
            lastFailureAt: null,
            consecutiveFailures: 0,
            degradedMode: "no",
            degradedReason: null,
            usedCacheLastAttempt: false,
            lastError: null,
          },
        },
      },
      expected: /entries.bad.degradedMode/u,
    },
    {
      value: {
        schemaVersion: 1,
        updatedAt: "now",
        entries: {
          bad: {
            sourceId: "src",
            owner: "octo",
            repo: "repo",
            lastAttemptAt: "now",
            lastSuccessAt: null,
            lastFailureAt: null,
            consecutiveFailures: 0,
            degradedMode: false,
            degradedReason: 1,
            usedCacheLastAttempt: false,
            lastError: null,
          },
        },
      },
      expected: /entries.bad.degradedReason/u,
    },
    {
      value: {
        schemaVersion: 1,
        updatedAt: "now",
        entries: {
          bad: {
            sourceId: "src",
            owner: "octo",
            repo: "repo",
            lastAttemptAt: "now",
            lastSuccessAt: null,
            lastFailureAt: null,
            consecutiveFailures: 0,
            degradedMode: false,
            degradedReason: null,
            usedCacheLastAttempt: "no",
            lastError: null,
          },
        },
      },
      expected: /entries.bad.usedCacheLastAttempt/u,
    },
    {
      value: {
        schemaVersion: 1,
        updatedAt: "now",
        entries: {
          bad: {
            sourceId: "src",
            owner: "octo",
            repo: "repo",
            lastAttemptAt: "now",
            lastSuccessAt: null,
            lastFailureAt: null,
            consecutiveFailures: 0,
            degradedMode: false,
            degradedReason: null,
            usedCacheLastAttempt: false,
            lastError: 1,
          },
        },
      },
      expected: /entries.bad.lastError/u,
    },
  ];

  for (const { value, expected } of validationCases) {
    assert.throws(
      () => githubInternals.assertGitHubSourceHealthState(value),
      expected,
    );
  }

  assert.equal(
    await fetchGitHubRepoSnapshot(
      { id: "fixture", kind: "repo", endpoints: {} } as never,
      tempRoot,
    ),
    null,
  );
  assert.equal(
    await fetchGitHubRepoSnapshot(
      {
        id: "fixture",
        kind: "repo",
        endpoints: { repo: "https://gitlab.com/example/project" },
      } as never,
      tempRoot,
    ),
    null,
  );

  globalThis.fetch = async () => new Response("broken-json", { status: 200 });
  await assert.rejects(
    githubInternals.parseGitHubJsonResponse(
      new Response("broken-json"),
      "/bad",
    ),
    /could not be parsed/u,
  );

  globalThis.fetch = async () =>
    new Response("nope", { status: 500, statusText: "Server Error" });
  await assert.rejects(
    githubInternals.fetchGitHubJson("/repos/octo/repo"),
    /GitHub API request failed \(500 Server Error\)/u,
  );
  await assert.rejects(
    githubInternals.fetchGitHubJsonOptional("/repos/octo/repo/readme"),
    /GitHub API request failed \(500 Server Error\)/u,
  );

  globalThis.fetch = async () => new Response("missing", { status: 404 });
  assert.equal(
    await githubInternals.fetchGitHubJsonOptional("/repos/octo/repo/readme"),
    null,
  );

  process.env.AGENT_HARNESS_GITHUB_FETCH_RETRIES = "1";
  clearRuntimeConfigForTests();
  globalThis.fetch = async () => {
    const error = new Error("aborted");
    Object.assign(error, { name: "AbortError" });
    throw error;
  };
  await assert.rejects(
    githubInternals.fetchGitHubResponse("/repos/octo/repo"),
    /Request timed out after/u,
  );

  clearGitHubState();
  assert.equal(
    githubInternals.buildRateLimitMessage(),
    "GitHub API rate limit is currently active",
  );
  githubInternals.captureRateLimit(
    new Response("rate limited", {
      headers: {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) - 1),
      },
    }),
  );
  assert.equal(githubInternals.isRateLimited(), false);
  assert.equal(githubInternals.getErrorMessage(404), "404");

  await writeJsonFile(
    join(tempRoot, "state", "remote-cache", "github", "source-health.json"),
    { schemaVersion: 1, updatedAt: "now", entries: { broken: [] } },
  );
  await githubInternals.updateGitHubSourceHealth(
    tempRoot,
    "fixture:octo/repo",
    {
      sourceId: "fixture",
      owner: "octo",
      repo: "repo",
      lastAttemptAt: "2026-05-15T00:00:00.000Z",
      lastFailureAt: "2026-05-15T00:00:01.000Z",
      degradedMode: true,
      degradedReason: "network",
      lastError: "boom",
    },
  );
  await githubInternals.updateGitHubSourceHealth(
    tempRoot,
    "fixture:octo/repo",
    {
      sourceId: "fixture",
      owner: "octo",
      repo: "repo",
      lastAttemptAt: "2026-05-15T00:00:02.000Z",
      lastFailureAt: undefined,
      degradedReason: undefined,
      lastError: undefined,
    } as never,
  );

  const healthState = JSON.parse(
    await readFile(
      join(tempRoot, "state", "remote-cache", "github", "source-health.json"),
      "utf8",
    ),
  ) as {
    entries: Record<
      string,
      {
        consecutiveFailures: number;
        degradedReason: string | null;
        lastError: string | null;
        lastFailureAt: string | null;
      }
    >;
  };
  assert.equal(
    healthState.entries["fixture:octo/repo"]?.consecutiveFailures,
    0,
  );
  assert.equal(healthState.entries["fixture:octo/repo"]?.lastFailureAt, null);
  assert.equal(healthState.entries["fixture:octo/repo"]?.degradedReason, null);
  assert.equal(healthState.entries["fixture:octo/repo"]?.lastError, null);

  const invalidSnapshot: Partial<GitHubRepoSnapshot> = {
    owner: "octo",
    repo: "repo",
    sourceId: "fixture",
  };
  await writeJsonFile(
    join(tempRoot, "state", "remote-cache", "github", "octo__repo.json"),
    invalidSnapshot,
  );
  assert.equal(
    await githubInternals.readGitHubRepoSnapshotCache(
      join(tempRoot, "state", "remote-cache", "github", "octo__repo.json"),
    ),
    null,
  );

  globalThis.fetch = async () => new Response("missing", { status: 404 });
  assert.equal(
    await fetchGitHubRepoSnapshotByRepoUrl({
      repoUrl: "https://github.com/octo/repo",
      projectRoot: tempRoot,
      sourceId: "fixture",
    }),
    null,
  );
});

void test("http internals cover pinned request, abort, and byte-reader edge branches", async (t) => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  t.after(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  let writtenBody = "";
  const restoreRequest = httpInternals.setHttpsRequestForTests(((
    _url: URL,
    options: { signal?: AbortSignal },
    callback: (
      response: Readable & {
        headers: IncomingHttpHeaders;
        statusCode?: number;
        statusMessage?: string;
      },
    ) => void,
  ) => {
    const requestMessage = new EventEmitter() as EventEmitter & {
      write(chunk: string | Buffer): boolean;
      end(): void;
    };
    let requestWroteBody = false;
    requestMessage.write = (chunk) => {
      requestWroteBody = true;
      writtenBody += Buffer.from(chunk).toString("utf8");
      return true;
    };
    requestMessage.end = () => {
      if (options.signal?.aborted) {
        const error = new Error("aborted");
        Object.assign(error, { name: "AbortError" });
        queueMicrotask(() => requestMessage.emit("error", error));
        return;
      }

      options.signal?.addEventListener(
        "abort",
        () => {
          const error = new Error("aborted");
          Object.assign(error, { name: "AbortError" });
          requestMessage.emit("error", error);
        },
        { once: true },
      );

      if (options.signal && !requestWroteBody) {
        return;
      }

      const response = Readable.from([Buffer.from("hello")]) as Readable & {
        headers: IncomingHttpHeaders;
        statusCode?: number;
        statusMessage?: string;
      };
      response.headers = {
        "set-cookie": ["a=1", "b=2"],
        "x-test": "ok",
      };
      response.statusCode = 201;
      response.statusMessage = "Created";
      callback(response);
    };
    return requestMessage as never;
  }) as never);
  t.after(restoreRequest);

  const response = await httpInternals.requestWithPinnedAddress(
    new URL("https://example.com/path"),
    { address: "93.184.216.34", family: 4 },
    {
      body: new Uint8Array(Buffer.from("payload")),
      headers: { "x-custom": "yes" },
      method: "PUT",
    },
    new AbortController().signal,
  );
  assert.equal(response.status, 201);
  assert.equal(await response.text(), "hello");
  assert.equal(writtenBody, "payload");
  assert.equal(
    httpInternals
      .buildResponseHeaders({ "set-cookie": ["a=1", "b=2"] })
      .get("set-cookie"),
    "a=1, b=2",
  );
  assert.equal(httpInternals.isPrivateIpv4Address("999.0.0.1"), true);
  assert.equal(httpInternals.isPrivateIpv6Address("::ffff:10.0.0.1"), true);

  const alreadyAborted = new AbortController();
  alreadyAborted.abort("done");
  await assert.rejects(
    httpInternals.fetchWithPinnedResolution(
      new URL("https://example.com/path"),
      [{ address: "93.184.216.34", family: 4 }],
      { signal: alreadyAborted.signal },
      10,
    ),
    /aborted/u,
  );

  const callerController = new AbortController();
  const pendingFetch = httpInternals.fetchWithPinnedResolution(
    new URL("https://example.com/path"),
    [{ address: "93.184.216.34", family: 4 }],
    { signal: callerController.signal },
    50,
  );
  callerController.abort("caller");
  await assert.rejects(pendingFetch, /aborted/u);

  await assert.rejects(
    httpInternals.fetchWithPinnedResolution(
      new URL("https://example.com/path"),
      [],
      {},
      10,
    ),
    /did not resolve/u,
  );

  assert.equal(
    await fetchTextWithGuards("https://example.com/path", {
      allowedOrigins: ["https://example.com"],
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      body: new Uint8Array(Buffer.from("payload")),
    }),
    "hello",
  );

  restoreRequest();
  const restoreOfflineRequest = httpInternals.setHttpsRequestForTests((() => {
    const requestMessage = new EventEmitter() as EventEmitter & {
      write(): boolean;
      end(): void;
    };
    requestMessage.write = () => true;
    requestMessage.end = () => {
      queueMicrotask(() => requestMessage.emit("error", new Error("offline")));
    };
    return requestMessage as never;
  }) as never);
  t.after(restoreOfflineRequest);

  assert.equal(
    await fetchTextWithGuards("https://example.com/path", {
      allowedOrigins: ["https://example.com"],
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    }),
    null,
  );

  const emptyChunkResponse = {
    headers: new Headers(),
    body: {
      getReader() {
        let index = 0;
        return {
          read: async () =>
            index++ === 0
              ? { done: false, value: undefined }
              : { done: true, value: undefined },
          cancel: async () => undefined,
        };
      },
    },
  };
  assert.deepEqual(
    await readResponseBytesWithLimit(emptyChunkResponse as never, 8, 10),
    Buffer.alloc(0),
  );

  assert.equal(
    await httpInternals.withBodyReadTimeout(Promise.resolve("ok"), 50),
    "ok",
  );
  await assert.rejects(
    httpInternals.withBodyReadTimeout(Promise.reject(new Error("boom")), 50),
    /boom/u,
  );

  const preservedTimers = new Set<unknown>();
  globalThis.setTimeout = ((handler: (...args: unknown[]) => void) => {
    const token = { cancelled: false };
    preservedTimers.add(token);
    queueMicrotask(() => {
      handler();
    });
    return token as never;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((token: { cancelled?: boolean }) => {
    token.cancelled = true;
  }) as typeof clearTimeout;

  let cleanedUp = false;
  await assert.rejects(
    httpInternals.withBodyReadTimeout(new Promise(() => undefined), 5, () => {
      cleanedUp = true;
    }),
    /Timed out while reading response body/u,
  );
  assert.equal(cleanedUp, true);
});

void test("body read timeout ignores late timer and rejection after settlement", async (t) => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timerHandlers: Array<() => void> = [];

  t.after(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  globalThis.setTimeout = ((handler: (...args: unknown[]) => void) => {
    timerHandlers.push(() => handler());
    return { timerHandlers } as never;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;

  assert.equal(
    await httpInternals.withBodyReadTimeout(Promise.resolve("fast"), 5),
    "fast",
  );
  timerHandlers.shift()?.();

  let rejectLate!: (error: Error) => void;
  const lateRejectingOperation = new Promise<never>((_resolve, reject) => {
    rejectLate = reject;
  });
  const timedOut = httpInternals.withBodyReadTimeout(lateRejectingOperation, 5);
  timerHandlers.shift()?.();
  await assert.rejects(timedOut, /Timed out while reading response body/u);
  rejectLate(new Error("late failure"));
  await Promise.resolve();
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
