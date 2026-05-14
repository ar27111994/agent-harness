import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeJsonFile } from "../files.js";
import {
  clearGitHubState,
  fetchGitHubRepoSnapshotByRepoUrl,
} from "../github.js";
import type { GitHubRepoSnapshot } from "../types.js";

const RATE_LIMIT_WINDOW_SECONDS = 120;

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
