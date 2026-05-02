import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { fetchTextWithGuards } from "../lib/http.js";
import { resolveSafeMirrorFilePath } from "../mirror.js";
import {
  extractRepositoryUrlFromPypiMetadata,
  fetchPypiPackageMetadata,
} from "../package-registries.js";

test("mirror file path resolution rejects path traversal", () => {
  const rawRoot = resolve(join(tmpdir(), "agent-harness-mirror-root"));

  assert.equal(
    resolveSafeMirrorFilePath(rawRoot, "nested/SKILL.md"),
    resolve(rawRoot, "nested", "SKILL.md"),
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

test("guarded fetches disable automatic cross-origin redirects", async (context) => {
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

test("PyPI metadata fetch validates response shape before use", async (context) => {
  const originalFetch = globalThis.fetch;
  const responsePayload = JSON.stringify({
    info: {
      name: 42,
      summary: "Example package",
      home_page: "https://example.com",
      project_urls: {
        Source: "https://github.com/example/project",
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
  });
  assert.equal(
    metadata ? extractRepositoryUrlFromPypiMetadata(metadata) : undefined,
    "https://github.com/example/project",
  );
});
