import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  assertAllowedPublicHttpUrl,
  assertAllowedPublicHttpUrlWithDns,
  fetchTextWithGuards,
  type HostnameResolver,
} from "../lib/http.js";
import {
  resolveAllowedMirrorEvidenceFilePath,
  resolveAllowedMirrorEvidenceFilePathForRead,
  resolveSafeMirrorFilePath,
} from "../mirror.js";
import {
  extractRepositoryUrlFromNpmMetadata,
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
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;

  globalThis.fetch = async (_url, init) => {
    observedSignal = init?.signal ?? undefined;
    controller.abort("caller-cancelled");
    return new Response("ok", { status: 200 });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  await fetchTextWithGuards("https://example.com/index.txt", {
    allowedOrigins: ["https://example.com"],
    timeoutMs: 10_000,
    headers: {},
    resolveHostname: publicHostnameResolver,
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

void test("mirror evidence file reads reject symlink escapes", async () => {
  const allowedRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-evidence-root-"),
  );
  const outsideRoot = await mkdtemp(join(tmpdir(), "agent-harness-outside-"));
  const outsideFile = join(outsideRoot, "agent-harness-outside-secret.txt");
  const linkedFile = join(allowedRoot, "linked-secret.txt");

  try {
    await writeFile(outsideFile, "secret", "utf8");
    await symlink(outsideFile, linkedFile);

    assert.equal(
      await resolveAllowedMirrorEvidenceFilePathForRead(linkedFile, [
        allowedRoot,
      ]),
      null,
    );
  } finally {
    await rm(allowedRoot, { force: true, recursive: true });
    await rm(outsideRoot, { force: true, recursive: true });
  }
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

void test("guarded public URL validation rejects private DNS answers", async () => {
  await assert.rejects(
    assertAllowedPublicHttpUrlWithDns(
      "https://api.openai.com/v1/chat/completions",
      ["https://api.openai.com"],
      async () => [{ address: "10.0.0.5", family: 4 }],
    ),
    /non-public/u,
  );
});

void test("guarded fetches disable automatic cross-origin redirects", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  let observedRedirectMode: RequestRedirect | undefined;

  globalThis.fetch = async (_url, init) => {
    observedRedirectMode = init?.redirect;
    return new Response("ok", { status: 200 });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  const content = await fetchTextWithGuards("https://example.com/index.txt", {
    allowedOrigins: ["https://example.com"],
    resolveHostname: publicHostnameResolver,
  });

  assert.equal(content, "ok");
  assert.equal(observedRedirectMode, "error");
});

void test("PyPI metadata fetch validates response shape before use", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
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
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  const metadata = await fetchPypiPackageMetadata("fallback-name", {
    resolveHostname: publicHostnameResolver,
  });

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

void test("npm repository extraction normalizes common GitHub syntaxes", () => {
  for (const repository of [
    "github:owner/repo",
    "git@github.com:owner/repo.git",
    "git+ssh://git@github.com/owner/repo.git",
    "https://github.com/owner/repo.git",
    "git+https://github.com/owner/repo.git",
    "https://github.com/owner/repo/tree/main#readme",
    "https://github.com/owner/repo/blob/main/README.md?plain=1",
  ]) {
    assert.equal(
      extractRepositoryUrlFromNpmMetadata({ name: "fixture", repository }),
      "https://github.com/owner/repo",
    );
  }
});

const publicHostnameResolver: HostnameResolver = async () => [
  { address: "93.184.216.34", family: 4 },
];

function restoreFetchMockFlag(previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    return;
  }

  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousValue;
}
