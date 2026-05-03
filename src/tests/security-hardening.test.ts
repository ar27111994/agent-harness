import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  assertAllowedPublicHttpUrl,
  fetchTextWithGuards,
} from "../lib/http.js";
import {
  resolveAllowedMirrorEvidenceFilePath,
  resolveSafeMirrorFilePath,
} from "../mirror.js";
import {
  extractRepositoryUrlFromPypiMetadata,
  fetchPypiPackageMetadata,
} from "../package-registries.js";

void test("mirror file path resolution rejects path traversal", () => {
  const rawRoot = resolve(join(tmpdir(), "agent-harness-mirror-root"));

  assert.equal(
    resolveSafeMirrorFilePath(rawRoot, "nested/SKILL.md"),
    resolve(rawRoot, "nested", "SKILL.md"),
  );
  assert.equal(
    resolveSafeMirrorFilePath(rawRoot, "..foo/SKILL.md"),
    resolve(rawRoot, "..foo", "SKILL.md"),
  );
  assert.throws(
    () => resolveSafeMirrorFilePath(rawRoot, "../outside.txt"),
    /outside raw root/u,
  );
  assert.throws(
    () => resolveSafeMirrorFilePath(rawRoot, ""),
    /outside raw root/u,
  );
});

void test("guarded fetches preserve caller abort signals", async (context) => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;

  globalThis.fetch = async (_url, init) => {
    observedSignal = init?.signal ?? undefined;
    controller.abort("caller-cancelled");
    return new Response("ok", { status: 200 });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  await fetchTextWithGuards("https://example.com/index.txt", {
    allowedOrigins: ["https://example.com"],
    timeoutMs: 10_000,
    headers: {},
    signal: controller.signal,
  } as Parameters<typeof fetchTextWithGuards>[1] & { signal: AbortSignal });

  assert.equal(observedSignal?.aborted, true);
  assert.equal(observedSignal?.reason, "caller-cancelled");
});

void test("mirror evidence file paths must stay inside allowed roots", () => {
  const allowedRoot = resolve(join(tmpdir(), "agent-harness-evidence-root"));

  assert.equal(
    resolveAllowedMirrorEvidenceFilePath(
      resolve(allowedRoot, "nested", "SKILL.md"),
      [allowedRoot],
    ),
    resolve(allowedRoot, "nested", "SKILL.md"),
  );
  assert.equal(
    resolveAllowedMirrorEvidenceFilePath(
      resolve(allowedRoot, "..foo", "SKILL.md"),
      [allowedRoot],
    ),
    resolve(allowedRoot, "..foo", "SKILL.md"),
  );
  assert.equal(
    resolveAllowedMirrorEvidenceFilePath(resolve(tmpdir(), "outside.txt"), [
      allowedRoot,
    ]),
    null,
  );
  assert.equal(
    resolveAllowedMirrorEvidenceFilePath("relative/SKILL.md", [allowedRoot]),
    null,
  );
});

void test("guarded public URL validation rejects circular SSRF origins", () => {
  assert.throws(
    () =>
      assertAllowedPublicHttpUrl("https://169.254.169.254/latest", [
        "https://169.254.169.254",
      ]),
    /not public/u,
  );
  assert.throws(
    () =>
      assertAllowedPublicHttpUrl("https://localhost./v1/chat/completions", [
        "https://localhost.",
      ]),
    /not public/u,
  );
  assert.throws(
    () =>
      assertAllowedPublicHttpUrl("https://[fec0::1]/metadata", [
        "https://[fec0::1]",
      ]),
    /not public/u,
  );
  assert.throws(
    () =>
      assertAllowedPublicHttpUrl("https://[2002:7f00:0001::1]/metadata", [
        "https://[2002:7f00:1::1]",
      ]),
    /not public/u,
  );
  assert.throws(
    () =>
      assertAllowedPublicHttpUrl("https://[::ffff:0:7f00:1]/metadata", [
        "https://[::ffff:0:7f00:1]",
      ]),
    /not public/u,
  );
  assert.throws(
    () =>
      assertAllowedPublicHttpUrl("https://example.com/v1/chat/completions", [
        "https://api.openai.com",
      ]),
    /not allowed/u,
  );
});

void test("guarded fetches disable automatic cross-origin redirects", async (context) => {
  const originalFetch = globalThis.fetch;
  let observedRedirectMode: RequestRedirect | undefined;

  globalThis.fetch = async (_url, init) => {
    observedRedirectMode = init?.redirect;
    return new Response("ok", { status: 200 });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const content = await fetchTextWithGuards("https://example.com/index.txt", {
    allowedOrigins: ["https://example.com"],
  });

  assert.equal(content, "ok");
  assert.equal(observedRedirectMode, "error");
});

void test("PyPI metadata fetch validates response shape before use", async (context) => {
  const originalFetch = globalThis.fetch;
  const responsePayload = JSON.stringify({
    info: {
      name: 42,
      summary: "Example package",
      home_page: "https://example.com",
      project_urls: {
        Source: "https://github.com/example/project",
        Trap: "https://evil.example/?next=https://github.com/bad/repo",
        Invalid: 42,
      },
    },
  });

  globalThis.fetch = async () =>
    new Response(responsePayload, {
      headers: { "content-length": String(Buffer.byteLength(responsePayload)) },
      status: 200,
    });
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const metadata = await fetchPypiPackageMetadata("fallback-name");

  assert.equal(metadata?.info.name, "fallback-name");
  assert.equal(metadata?.info.summary, "Example package");
  assert.deepEqual(metadata?.info.project_urls, {
    Source: "https://github.com/example/project",
    Trap: "https://evil.example/?next=https://github.com/bad/repo",
  });
  assert.equal(
    metadata ? extractRepositoryUrlFromPypiMetadata(metadata) : undefined,
    "https://github.com/example/project",
  );
  assert.equal(
    extractRepositoryUrlFromPypiMetadata({
      info: {
        name: "trap-only",
        project_urls: {
          Source: "https://evil.example/?next=https://github.com/bad/repo",
        },
      },
    }),
    undefined,
  );
});
