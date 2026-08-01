import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadDotEnvFile } from "../config/env-file.js";
import { loadRuntimeConfig } from "../config/runtime.js";
import {
  copyPath,
  ensureDirectory,
  listFilesRecursive,
  readBinaryFileOrNull,
  readTextFileOrNull,
  type JsonValidator,
  writeTextFile,
} from "../files.js";
import {
  clearGitHubState,
  fetchGitHubRepoSnapshotByRepoUrl,
} from "../github.js";
import {
  assertAllowedPublicHttpUrlWithDns,
  fetchTextWithGuards,
  readResponseBytesWithLimit,
} from "../lib/http.js";
import { fetchOfficialIndexPageInfo } from "../official-index.js";
import {
  extractRepositoryUrlFromNpmMetadata,
  extractRepositoryUrlFromPypiMetadata,
  fetchNpmPackageMetadata,
  fetchNpmPackageSearch,
  fetchPypiPackageMetadata,
} from "../package-registries.js";
import {
  acquireAllMirrorBatches,
  installBundleBatches,
  type WorkspacePipelineDependencies,
} from "../pipeline.js";
import type { InstallProgressState } from "../types.js";

void test("runtime config falls back to GITHUB_TOKEN when no personal token is provided", () => {
  const config = loadRuntimeConfig({
    HOME: "/home/tester",
    GITHUB_TOKEN: "fallback-token",
  });

  assert.equal(config.github.token, "fallback-token");
});

void test("dotenv loader rethrows non-ENOENT errors and finalizes dangling continuations at EOF", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-env-hardening-"));
  const envFilePath = join(root, ".env");

  try {
    await mkdir(envFilePath);
    await assert.rejects(loadDotEnvFile(root, {}), /EISDIR|EPERM|EACCES/u);

    await rm(envFilePath, { force: true, recursive: true });
    await writeFile(envFilePath, "TRAILING=value\\\n", "utf8");

    const env: NodeJS.ProcessEnv = {};
    const result = await loadDotEnvFile(root, env);

    assert.equal(result.loaded, true);
    assert.deepEqual(result.appliedKeys, ["TRAILING"]);
    assert.equal(env.TRAILING, "value");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("files helpers copy directory trees, reuse listFilesRecursive, and rethrow directory reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-files-hardening-"));

  try {
    const sourceRoot = join(root, "source");
    const destinationRoot = join(root, "destination");
    await writeTextFile(join(sourceRoot, "nested", "copied.txt"), "copied");
    await writeTextFile(join(root, "keep.txt"), "keep");
    await writeTextFile(join(root, "skip.tmp"), "skip");
    await writeTextFile(join(root, ".gitignore"), "*.tmp\n");

    await copyPath(sourceRoot, destinationRoot);

    assert.equal(
      await readTextFileOrNull(join(destinationRoot, "nested", "copied.txt")),
      "copied",
    );

    await assert.rejects(readTextFileOrNull(root), /EISDIR|EPERM|EACCES/u);
    await assert.rejects(readBinaryFileOrNull(root), /EISDIR|EPERM|EACCES/u);

    const listedFiles = (await listFilesRecursive(root)).map((filePath) =>
      filePath.replaceAll("\\", "/"),
    );
    assert.ok(listedFiles.some((filePath) => filePath.endsWith("keep.txt")));
    assert.ok(
      listedFiles.some((filePath) =>
        filePath.endsWith("destination/nested/copied.txt"),
      ),
    );
    assert.ok(!listedFiles.some((filePath) => filePath.endsWith("skip.tmp")));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("package registry fetch helpers swallow transport failures and repository extraction rejects malformed URLs", async () => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async () => {
    throw new Error("offline");
  };

  try {
    const resolveHostname = async () => [
      { address: "93.184.216.34", family: 4 as const },
    ];

    assert.deepEqual(
      await fetchNpmPackageSearch("agent", { resolveHostname }),
      [],
    );
    assert.equal(
      await fetchNpmPackageMetadata("agent", { resolveHostname }),
      null,
    );
    assert.equal(
      await fetchPypiPackageMetadata("agent", { resolveHostname }),
      null,
    );

    assert.equal(
      extractRepositoryUrlFromNpmMetadata({
        name: "agent",
        keywords: [],
        repository: { url: "not a url" },
      }),
      undefined,
    );
    assert.equal(
      extractRepositoryUrlFromPypiMetadata({
        info: {
          name: "agent",
          project_urls: {
            Source: "not a url",
          },
        },
      }),
      undefined,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
  }
});

void test("official index info falls back cleanly when sections are missing and github links are incomplete", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async () =>
    new Response(
      [
        "<html><head>",
        "<title>Fallback Skill — Agent Skills | officialskills.sh</title>",
        '<meta name="description" content="Utility helpers." />',
        "</head><body>",
        "Raw repository hint: https://github.com/example",
        "</body></html>",
      ].join(""),
      { status: 200 },
    );

  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
  });

  const info = await fetchOfficialIndexPageInfo(
    "https://officialskills.sh/example/skills/fallback-skill",
  );

  assert.equal(info.repositoryUrl, null);
  assert.match(info.content ?? "", /Utility helpers\./u);
  assert.match(
    info.content ?? "",
    /\*\*GitHub\*\*: https:\/\/github\.com\/example/u,
  );
});

void test("http helpers validate DNS-checked urls and tolerate unsupported guarded bodies", async () => {
  const parsed = await assertAllowedPublicHttpUrlWithDns(
    "https://example.com/path",
    ["https://example.com"],
    async () => [{ address: "8.8.8.8", family: 4 }],
  );
  assert.equal(parsed.hostname, "example.com");

  await assert.rejects(
    assertAllowedPublicHttpUrlWithDns(
      "https://example.com/path",
      ["https://example.com"],
      async () => [{ address: "::ffff:0:203.0.113.1", family: 6 }],
    ),
    /non-public/u,
  );

  const unsupportedBodyResult = await fetchTextWithGuards(
    "https://example.com/path",
    {
      allowedOrigins: ["https://example.com"],
      body: { unsupported: true } as never,
      resolveHostname: async () => [{ address: "8.8.8.8", family: 4 }],
    },
  );
  assert.equal(unsupportedBodyResult, null);
});

void test("http response reader times out stalled streams", async () => {
  const stalledResponse = new Response(
    new ReadableStream({
      start() {
        // Intentionally never emits chunks or closes.
      },
    }),
  );

  await assert.rejects(
    readResponseBytesWithLimit(stalledResponse, 1024, 5),
    /Timed out while reading response body/u,
  );
});

void test("pipeline acquire batching validates persisted mirror state", async () => {
  let validatorCalled = false;

  await acquireAllMirrorBatches("/project", "/workspace", "3", {
    getRuntimeConfig: () => loadRuntimeConfig({ HOME: "/home/tester" }),
    readJsonFileOrNull: async <T>(
      _path: string,
      validator?: JsonValidator<T>,
    ): Promise<T | null> => {
      const state = {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        batchSize: 3,
        totalEligibleCount: 1,
        mirroredCount: 1,
        remainingCount: 0,
        skippedCount: 0,
        skippedAssetIds: [],
        skippedAssetReasons: {},
        lastBatchAssetIds: ["asset-1"],
        lastBatchMirroredCount: 1,
        lastBatchSkippedCount: 0,
        lastBatchSkippedReasons: {},
        terminal: true,
      };
      validator?.(state, "fixture");
      validatorCalled = true;
      return state as T;
    },
    runDiscover: async () => {},
    runRecommend: async () => {},
    runMirror: async () => {},
    runInstall: async () => {},
    runActivate: async () => {},
    writeWorkspaceProgress: () => {},
  });

  assert.equal(validatorCalled, true);
});

void test("pipeline install batching surfaces max-batch exhaustion", async () => {
  let runInstallCalls = 0;
  const dependencies: WorkspacePipelineDependencies = {
    getRuntimeConfig: () => loadRuntimeConfig({ HOME: "/home/tester" }),
    readJsonFileOrNull: async <T>(): Promise<T | null> => {
      const progressState: InstallProgressState = {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        bundles: {
          stubborn: {
            host: "copilot-vscode",
            batchSize: 1,
            totalAssets: 2,
            installedAssets: 1,
            remainingAssets: 1,
            lastBatchAssetIds: ["asset-1"],
            skippedAssetIds: [],
          },
        },
      };
      return progressState as T;
    },
    runDiscover: async () => {},
    runRecommend: async () => {},
    runMirror: async () => {},
    runInstall: async () => {
      runInstallCalls += 1;
    },
    runActivate: async () => {},
    writeWorkspaceProgress: () => {},
  };

  await assert.rejects(
    installBundleBatches(
      "/project",
      "/workspace",
      ["stubborn"],
      "1",
      dependencies,
    ),
    /install batching did not complete for bundle 'stubborn' within the maximum batch count/u,
  );
  assert.equal(runInstallCalls, 200);
});

void test("github repo fetch validates persisted health state and records rate-limited misses without cache", async (context) => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-hardening-"),
  );
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response("rate limited", {
      status: 403,
      statusText: "Forbidden",
      headers: {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + 60),
      },
    });
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    clearGitHubState();
    await rm(tempRoot, { force: true, recursive: true });
  });

  await ensureDirectory(join(tempRoot, "state", "remote-cache", "github"));
  await writeFile(
    join(tempRoot, "state", "remote-cache", "github", "source-health.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: "2026-05-15T00:00:00.000Z",
        entries: {
          "previous:nulls/example": {
            sourceId: "previous",
            owner: "nulls",
            repo: "example",
            lastAttemptAt: "2026-05-14T00:00:00.000Z",
            lastSuccessAt: null,
            lastFailureAt: null,
            consecutiveFailures: 0,
            degradedMode: false,
            degradedReason: null,
            usedCacheLastAttempt: false,
            lastError: null,
          },
          "previous:strings/example": {
            sourceId: "previous",
            owner: "strings",
            repo: "example",
            lastAttemptAt: "2026-05-14T00:00:00.000Z",
            lastSuccessAt: "2026-05-14T00:00:00.000Z",
            lastFailureAt: "2026-05-14T01:00:00.000Z",
            consecutiveFailures: 2,
            degradedMode: true,
            degradedReason: "cached",
            usedCacheLastAttempt: true,
            lastError: "boom",
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  // 403 rate-limit now returns null gracefully instead of throwing.
  const first = await fetchGitHubRepoSnapshotByRepoUrl({
    repoUrl: "https://github.com/octocat/hello-world",
    projectRoot: tempRoot,
    sourceId: "fixture-source",
  });
  assert.equal(first, null, "403 rate-limit should return null");
  const second = await fetchGitHubRepoSnapshotByRepoUrl({
    repoUrl: "https://github.com/octocat/hello-world",
    projectRoot: tempRoot,
    sourceId: "fixture-source",
  });
  assert.equal(second, null);
  assert.equal(fetchCount, 1);

  const healthState = JSON.parse(
    await readFile(
      join(tempRoot, "state", "remote-cache", "github", "source-health.json"),
      "utf8",
    ),
  ) as {
    entries: Record<string, { degradedReason?: string; lastError?: string }>;
  };

  assert.ok(healthState.entries["previous:nulls/example"]);
  assert.ok(healthState.entries["previous:strings/example"]);
  assert.equal(
    healthState.entries["fixture-source:octocat/hello-world"]?.degradedReason,
    "rate-limited-no-cache",
  );
  assert.match(
    healthState.entries["fixture-source:octocat/hello-world"]?.lastError ?? "",
    /GitHub API rate limit active until/u,
  );
});

void test("github repo fetch tolerates missing README responses", async (context) => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-readme-"),
  );
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/repos/octocat/hello-world")) {
      return new Response(
        JSON.stringify({
          name: "hello-world",
          full_name: "octocat/hello-world",
          description: "fixture",
          default_branch: "main",
          updated_at: "2026-05-14T00:00:00.000Z",
          pushed_at: "2026-05-14T00:00:00.000Z",
          stargazers_count: 7,
          language: "TypeScript",
          topics: ["fixture"],
          archived: false,
          html_url: "https://github.com/octocat/hello-world",
        }),
        { status: 200 },
      );
    }
    if (url.includes("/git/trees/main?recursive=1")) {
      return new Response(
        JSON.stringify({
          sha: "tree-sha",
          truncated: false,
          tree: [
            { path: "README.md", type: "blob", size: 42, sha: "readme-sha" },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response("missing", { status: 404 });
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    clearGitHubState();
    await rm(tempRoot, { force: true, recursive: true });
  });

  const snapshot = await fetchGitHubRepoSnapshotByRepoUrl({
    repoUrl: "https://github.com/octocat/hello-world",
    projectRoot: tempRoot,
    sourceId: "fixture-source",
  });

  assert.equal(snapshot?.repoSummary.fullName, "octocat/hello-world");
  assert.equal(snapshot?.readme, null);
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
