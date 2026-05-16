import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { writeJsonFile } from "../files.js";
import {
  buildGitHubRawFileUrl,
  clearGitHubState,
  fetchGitHubRepoSnapshot,
  fetchGitHubRepoSnapshotByRepoUrl,
  githubInternals,
  isGitHubRepoSource,
  parseGitHubRepoCoordinates,
} from "../github.js";
import type { GitHubRepoSnapshot } from "../types.js";

const RATE_LIMIT_WINDOW_SECONDS = 120;

void test("github helpers parse supported repository urls", () => {
  assert.deepEqual(
    parseGitHubRepoCoordinates("https://github.com/octocat/hello-world.git"),
    {
      owner: "octocat",
      repo: "hello-world",
    },
  );
  assert.deepEqual(
    parseGitHubRepoCoordinates("git@github.com:octocat/hello-world.git"),
    {
      owner: "octocat",
      repo: "hello-world",
    },
  );
  assert.deepEqual(
    parseGitHubRepoCoordinates("ssh://git@github.com/octocat/hello-world"),
    {
      owner: "octocat",
      repo: "hello-world",
    },
  );
  assert.equal(
    parseGitHubRepoCoordinates("https://gitlab.com/octocat/hello-world"),
    null,
  );
  assert.equal(
    isGitHubRepoSource({
      id: "fixture",
      kind: "repo",
      endpoints: { repo: "https://github.com/octocat/hello-world" },
    } as never),
    true,
  );
  assert.equal(
    isGitHubRepoSource({
      id: "fixture",
      kind: "package-registry",
      endpoints: { repo: "https://github.com/octocat/hello-world" },
    } as never),
    false,
  );
  assert.equal(
    buildGitHubRawFileUrl({
      owner: "octocat",
      repo: "hello-world",
      branch: "main",
      filePath: "README.md",
    }),
    "https://raw.githubusercontent.com/octocat/hello-world/main/README.md",
  );
});

function createSnapshot(options: {
  owner: string;
  repo: string;
  sourceId: string;
}): GitHubRepoSnapshot {
  return {
    owner: options.owner,
    repo: options.repo,
    sourceId: options.sourceId,
    fetchedAt: "2026-05-14T00:00:00.000Z",
    repoSummary: {
      name: options.repo,
      fullName: `${options.owner}/${options.repo}`,
      description: "fixture",
      defaultBranch: "main",
      updatedAt: "2026-05-14T00:00:00.000Z",
      pushedAt: "2026-05-14T00:00:00.000Z",
      stars: 1,
      language: "TypeScript",
      topics: ["fixture"],
      archived: false,
      htmlUrl: `https://github.com/${options.owner}/${options.repo}`,
    },
    readme: {
      path: "README.md",
      sha: `${options.repo}-readme-sha`,
      size: 42,
      htmlUrl: `https://github.com/${options.owner}/${options.repo}#readme`,
      downloadUrl: `https://raw.githubusercontent.com/${options.owner}/${options.repo}/main/README.md`,
    },
    tree: {
      sha: `${options.repo}-tree-sha`,
      truncated: false,
      entries: [
        {
          path: "README.md",
          type: "blob",
          size: 42,
          sha: `${options.repo}-readme-sha`,
        },
      ],
    },
  };
}

async function seedSnapshotCache(
  projectRoot: string,
  snapshot: GitHubRepoSnapshot,
): Promise<void> {
  await writeJsonFile(
    join(
      projectRoot,
      "state",
      "remote-cache",
      "github",
      `${snapshot.owner}__${snapshot.repo}.json`,
    ),
    snapshot,
  );
}

function createRateLimitedResponse(): Response {
  return new Response("rate limited", {
    status: 403,
    statusText: "Forbidden",
    headers: {
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(
        Math.ceil(Date.now() / 1000) + RATE_LIMIT_WINDOW_SECONDS,
      ),
    },
  });
}

void test("github cache fallback records degraded mode after rate limiting", async (context) => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-rate-limit-"),
  );
  const snapshot = createSnapshot({
    owner: "octocat",
    repo: "hello-world",
    sourceId: "fixture-source",
  });
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = async () => {
    fetchCount += 1;
    return createRateLimitedResponse();
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    clearGitHubState();
    await rm(tempRoot, { force: true, recursive: true });
  });

  await seedSnapshotCache(tempRoot, snapshot);
  clearGitHubState();

  const firstResult = await fetchGitHubRepoSnapshotByRepoUrl({
    repoUrl: "https://github.com/octocat/hello-world",
    projectRoot: tempRoot,
    sourceId: snapshot.sourceId,
  });
  const secondResult = await fetchGitHubRepoSnapshotByRepoUrl({
    repoUrl: "https://github.com/octocat/hello-world",
    projectRoot: tempRoot,
    sourceId: snapshot.sourceId,
  });

  assert.deepEqual(firstResult, snapshot);
  assert.deepEqual(secondResult, snapshot);
  assert.equal(fetchCount, 1);

  const healthState = JSON.parse(
    await readFile(
      join(tempRoot, "state", "remote-cache", "github", "source-health.json"),
      "utf8",
    ),
  ) as {
    entries?: Record<
      string,
      {
        degradedMode?: boolean;
        degradedReason?: string;
        usedCacheLastAttempt?: boolean;
      }
    >;
  };
  const degradedSummary = JSON.parse(
    await readFile(
      join(
        tempRoot,
        "state",
        "remote-cache",
        "github",
        "degraded-summary.json",
      ),
      "utf8",
    ),
  ) as {
    degradedSources?: Array<{
      owner?: string;
      repo?: string;
      degradedReason?: string;
    }>;
  };

  assert.deepEqual(Object.keys(healthState.entries ?? {}), [
    "fixture-source:octocat/hello-world",
  ]);
  assert.equal(
    healthState.entries?.["fixture-source:octocat/hello-world"]?.degradedMode,
    true,
  );
  assert.equal(
    healthState.entries?.["fixture-source:octocat/hello-world"]?.degradedReason,
    "rate-limited-cache-fallback",
  );
  assert.equal(
    healthState.entries?.["fixture-source:octocat/hello-world"]
      ?.usedCacheLastAttempt,
    true,
  );
  assert.equal(degradedSummary.degradedSources?.length, 1);
  assert.equal(degradedSummary.degradedSources?.[0]?.owner, "octocat");
  assert.equal(degradedSummary.degradedSources?.[0]?.repo, "hello-world");
  assert.equal(
    degradedSummary.degradedSources?.[0]?.degradedReason,
    "rate-limited-cache-fallback",
  );
});

void test("github source health recovers from malformed state and serializes concurrent cache updates", async (context) => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-health-"),
  );
  const snapshotA = createSnapshot({
    owner: "octocat",
    repo: "hello-world",
    sourceId: "fixture-a",
  });
  const snapshotB = createSnapshot({
    owner: "github",
    repo: "docs",
    sourceId: "fixture-b",
  });
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = async () => {
    fetchCount += 1;
    return createRateLimitedResponse();
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    clearGitHubState();
    await rm(tempRoot, { force: true, recursive: true });
  });

  await seedSnapshotCache(tempRoot, snapshotA);
  await seedSnapshotCache(tempRoot, snapshotB);
  await writeFile(
    join(tempRoot, "state", "remote-cache", "github", "source-health.json"),
    "{not-json",
    "utf8",
  );
  clearGitHubState();

  const warmup = await fetchGitHubRepoSnapshotByRepoUrl({
    repoUrl: "https://github.com/octocat/hello-world",
    projectRoot: tempRoot,
    sourceId: snapshotA.sourceId,
  });
  const [resultA, resultB] = await Promise.all([
    fetchGitHubRepoSnapshotByRepoUrl({
      repoUrl: "https://github.com/octocat/hello-world",
      projectRoot: tempRoot,
      sourceId: snapshotA.sourceId,
    }),
    fetchGitHubRepoSnapshotByRepoUrl({
      repoUrl: "https://github.com/github/docs",
      projectRoot: tempRoot,
      sourceId: snapshotB.sourceId,
    }),
  ]);

  assert.deepEqual(warmup, snapshotA);
  assert.deepEqual(resultA, snapshotA);
  assert.deepEqual(resultB, snapshotB);
  assert.equal(fetchCount, 1);

  const healthState = JSON.parse(
    await readFile(
      join(tempRoot, "state", "remote-cache", "github", "source-health.json"),
      "utf8",
    ),
  ) as {
    entries?: Record<string, { degradedMode?: boolean }>;
  };

  assert.deepEqual(Object.keys(healthState.entries ?? {}).sort(), [
    "fixture-a:octocat/hello-world",
    "fixture-b:github/docs",
  ]);
  assert.equal(
    healthState.entries?.["fixture-a:octocat/hello-world"]?.degradedMode,
    true,
  );
  assert.equal(
    healthState.entries?.["fixture-b:github/docs"]?.degradedMode,
    true,
  );
});

void test("github fetch stores successful snapshots and retries transient failures", async (context) => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-success-"),
  );
  const originalFetch = globalThis.fetch;
  const previousRetryEnv = process.env.AGENT_HARNESS_GITHUB_FETCH_RETRIES;
  process.env.AGENT_HARNESS_GITHUB_FETCH_RETRIES = "2";
  clearRuntimeConfigForTests();

  let attempt = 0;
  globalThis.fetch = async (input) => {
    attempt += 1;
    const url = String(input);
    if (attempt === 1) {
      return new Response("busy", {
        status: 500,
        statusText: "Server Error",
        headers: { "retry-after": "0" },
      });
    }
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
    return new Response(
      JSON.stringify({
        path: "README.md",
        sha: "readme-sha",
        size: 42,
        html_url: "https://github.com/octocat/hello-world#readme",
        download_url:
          "https://raw.githubusercontent.com/octocat/hello-world/main/README.md",
      }),
      { status: 200 },
    );
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv("AGENT_HARNESS_GITHUB_FETCH_RETRIES", previousRetryEnv);
    clearRuntimeConfigForTests();
    clearGitHubState();
    await rm(tempRoot, { force: true, recursive: true });
  });

  const snapshot = await fetchGitHubRepoSnapshot(
    {
      id: "fixture-source",
      kind: "repo",
      endpoints: { repo: "https://github.com/octocat/hello-world" },
    } as never,
    tempRoot,
  );

  assert.equal(snapshot?.repoSummary.fullName, "octocat/hello-world");
  assert.equal(snapshot?.tree.entries[0]?.path, "README.md");
  assert.ok(attempt >= 4);
});

void test("github fetch returns null for 404 repositories and invalid urls", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-github-404-"));
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response("missing", { status: 404 });

  context.after(async () => {
    globalThis.fetch = originalFetch;
    clearGitHubState();
    await rm(tempRoot, { force: true, recursive: true });
  });

  const invalid = await fetchGitHubRepoSnapshotByRepoUrl({
    repoUrl: "https://gitlab.com/octocat/hello-world",
    projectRoot: tempRoot,
    sourceId: "fixture-source",
  });
  const missing = await fetchGitHubRepoSnapshotByRepoUrl({
    repoUrl: "https://github.com/octocat/missing",
    projectRoot: tempRoot,
    sourceId: "fixture-source",
  });

  assert.equal(invalid, null);
  assert.equal(missing, null);
});

void test("github fetch normalizes omitted repository topics and tree entries", async (context) => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-sparse-success-"),
  );
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/repos/octocat/sparse")) {
      return new Response(
        JSON.stringify({
          name: "sparse",
          full_name: "octocat/sparse",
          description: null,
          default_branch: "main",
          updated_at: "2026-05-14T00:00:00.000Z",
          pushed_at: "2026-05-14T00:00:00.000Z",
          stargazers_count: 3,
          language: null,
          archived: false,
          html_url: "https://github.com/octocat/sparse",
        }),
        { status: 200 },
      );
    }
    if (url.includes("/git/trees/main?recursive=1")) {
      return new Response(
        JSON.stringify({
          sha: "tree-sha",
          truncated: false,
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
    repoUrl: "https://github.com/octocat/sparse",
    projectRoot: tempRoot,
    sourceId: "fixture-source",
  });

  assert.deepEqual(snapshot?.repoSummary.topics, []);
  assert.deepEqual(snapshot?.tree.entries, []);
  assert.equal(snapshot?.readme, null);
});

void test("github source health preserves omitted optional failure fields and defaults new flags", async () => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-github-health-merge-"),
  );
  const key = "fixture-source:octocat/sparse";

  try {
    await githubInternals.updateGitHubSourceHealth(tempRoot, key, {
      sourceId: "fixture-source",
      owner: "octocat",
      repo: "sparse",
      lastAttemptAt: "2026-05-14T00:00:00.000Z",
      lastFailureAt: "2026-05-14T00:00:00.000Z",
      consecutiveFailures: 2,
      degradedMode: true,
      degradedReason: "rate-limited-cache-fallback",
      usedCacheLastAttempt: true,
      lastError: "rate limited",
    });
    await githubInternals.updateGitHubSourceHealth(tempRoot, key, {
      sourceId: "fixture-source",
      owner: "octocat",
      repo: "sparse",
      lastAttemptAt: "2026-05-14T01:00:00.000Z",
    });

    const state = JSON.parse(
      await readFile(
        join(tempRoot, "state", "remote-cache", "github", "source-health.json"),
        "utf8",
      ),
    ) as {
      entries?: Record<string, Record<string, unknown>>;
    };
    const entry = state.entries?.[key];

    assert.equal(entry?.lastAttemptAt, "2026-05-14T01:00:00.000Z");
    assert.equal(entry?.lastFailureAt, "2026-05-14T00:00:00.000Z");
    assert.equal(entry?.degradedMode, true);
    assert.equal(entry?.degradedReason, "rate-limited-cache-fallback");
    assert.equal(entry?.lastError, "rate limited");
    assert.equal(entry?.usedCacheLastAttempt, false);

    await githubInternals.updateGitHubSourceHealth(
      tempRoot,
      "fixture-source:github/docs",
      {
        sourceId: "fixture-source",
        owner: "github",
        repo: "docs",
        lastAttemptAt: "2026-05-14T02:00:00.000Z",
      },
    );
    const nextState = JSON.parse(
      await readFile(
        join(tempRoot, "state", "remote-cache", "github", "source-health.json"),
        "utf8",
      ),
    ) as {
      entries?: Record<string, Record<string, unknown>>;
    };

    assert.equal(
      nextState.entries?.["fixture-source:github/docs"]?.degradedMode,
      false,
    );
    assert.equal(
      nextState.entries?.["fixture-source:github/docs"]?.usedCacheLastAttempt,
      false,
    );
  } finally {
    clearGitHubState();
    await rm(tempRoot, { force: true, recursive: true });
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
