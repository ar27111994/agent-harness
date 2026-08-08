import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readJsonFile,
  readJsonLinesFile,
  writeJsonFile,
  writeJsonLinesFile,
  writeTextFile,
} from "../files.js";
import {
  assertMirrorAcquireState,
  assertMirrorIndexEntry,
} from "../manifest-validation/mirror.js";
import { assertMirrorAcquireCheckpoint } from "../mirror/acquire-state.js";
import { restoreEnvVar } from "./env-test-utils.js";
import {
  acquireMirrorArtifacts,
  mirrorAcquireInternals,
} from "../mirror/acquire.js";
import type {
  AssetCatalogEntry,
  MirrorAcquireState,
  MirrorIndexEntry,
  MirrorPolicy,
} from "../types.js";

const MAX_GITHUB_MIRROR_FILE_SIZE_BYTES = 1_000_000;
const MAX_OFFICIAL_INDEX_FILE_SIZE_BYTES = 1_000_000;
const MAX_OFFICIAL_INDEX_PACKAGE_FILES = 1_000;
const MAX_OFFICIAL_INDEX_PACKAGE_TOTAL_BYTES = 20_000_000;

function createAcquireState(
  overrides: Partial<MirrorAcquireState> = {},
): MirrorAcquireState {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    batchSize: 10,
    totalEligibleCount: 10,
    mirroredCount: 0,
    remainingCount: 0,
    skippedCount: 0,
    skippedAssetIds: [],
    skippedAssetReasons: {},
    lastBatchAssetIds: [],
    lastBatchMirroredCount: 0,
    lastBatchSkippedCount: 0,
    lastBatchSkippedReasons: {},
    terminal: false,
    ...overrides,
  };
}

function buildMirrorPolicy(): MirrorPolicy {
  return {
    schemaVersion: 1,
    selection: {
      officialBeatsPopularity: true,
      requirePinnedProvenance: false,
      communityDefaultPolicy: "allow",
    },
    audit: {
      alwaysAudit: false,
      quarantineOn: [],
    },
    store: {
      root: "mirror",
      rawDirectories: ["raw"],
      normalizedDirectories: [],
      bundlesDirectory: "bundles",
      quarantineDirectory: "quarantine",
      auditDirectory: "audit",
    },
    bundleTemplates: [],
  };
}

function buildAsset(id: string): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: "skill",
    hosts: ["cursor"],
    compatibilityMode: "adaptable",
    source: {
      sourceId: "test-source",
      authorityTier: "trusted-local",
      sourceKind: "local-directory",
      sourcePriority: 100,
      originUrl: `file:///fixture/${id}`,
      publisher: "test",
      publisherVerified: true,
    },
    trust: {
      score: 100,
      signals: [],
    },
    capabilities: ["test"],
    install: {
      method: "local-file",
      adaptableHosts: ["cursor"],
    },
    evidence: {
      manifestFound: true,
      readmeFound: false,
      examplesFound: false,
      docsLinked: false,
      lineCount: 1,
      filePath: `${id}.md`,
      rootPath: "/fixture",
    },
    maintenance: {
      lastUpdated: "2026-01-01T00:00:00.000Z",
      stars: 0,
      releaseCadence: "test",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: {
      sizeClass: "tiny",
      estimatedPromptWeight: 1,
    },
    fit: {
      portfolioFit: 1,
      hostFit: 1,
    },
    dedupe: {
      candidateRankHint: "test",
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}

function buildGitHubTreeAsset(
  id: string,
  content: Buffer = Buffer.from("# example\n", "utf8"),
): AssetCatalogEntry {
  const filePath = "agents/example.agent.md";
  const blobSha = createGitBlobSha(content);

  return {
    ...buildAsset(id),
    assetKind: "agent",
    compatibilityMode: "native",
    source: {
      sourceId: "github-awesome-copilot",
      authorityTier: "official-first-party",
      sourceKind: "repo",
      sourcePriority: 100,
      originUrl: `https://github.com/github/awesome-copilot/blob/main/${filePath}`,
      publisher: "GitHub",
      publisherVerified: true,
    },
    install: {
      method: "github-tree-metadata",
      nativeHosts: ["copilot-vscode"],
      manifestEntry: blobSha,
      relativePath: filePath,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      lineCount: 1,
      filePath,
      rootPath: "https://github.com/github/awesome-copilot",
    },
  };
}

function buildOfficialIndexAsset(
  id: string,
  options: { originUrl?: string } = {},
): AssetCatalogEntry {
  const originUrl =
    options.originUrl ??
    "https://officialskills.sh/cloudflare/skills/cloudflare";
  return {
    ...buildAsset(id),
    assetKind: "skill",
    compatibilityMode: "native",
    source: {
      sourceId: "official-index:cloudflare:cloudflare",
      authorityTier: "official-first-party",
      sourceKind: "docs",
      sourcePriority: 100,
      originUrl,
      publisher: "Cloudflare",
      publisherVerified: true,
    },
    install: {
      method: "official-index-entry",
      nativeHosts: ["copilot-vscode"],
      manifestEntry: "cloudflare",
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      lineCount: 1,
      filePath: "SKILL.md",
      rootPath: originUrl,
    },
  };
}

async function createAcquireFixture(
  entries: AssetCatalogEntry[],
): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-acquire-"));
  await writeJsonFile(
    join(projectRoot, "mirror", "policy.json"),
    buildMirrorPolicy(),
  );
  await writeJsonLinesFile(
    join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
    entries,
  );
  return projectRoot;
}

function acquireStatePath(projectRoot: string): string {
  return join(projectRoot, "state", "mirror", "acquire-state.json");
}

function mirrorIndexPath(projectRoot: string): string {
  return join(projectRoot, "mirror", "index.jsonl");
}

function createMirrorIndexEntry(assetId: string): MirrorIndexEntry {
  return {
    mirrorId: `sha256-${assetId}`,
    assetId,
    upstream: {
      type: "local",
      url: `file:///fixture/${assetId}`,
    },
    source: {
      authorityTier: "trusted-local",
      publisher: "test",
      publisherVerified: true,
    },
    mirroredAt: new Date().toISOString(),
    contentHash: `hash-${assetId}`,
    projectionCandidates: [],
    status: "approved",
  };
}

async function readAcquireStateFixture(
  projectRoot: string,
): Promise<MirrorAcquireState> {
  return readJsonFile<MirrorAcquireState>(
    acquireStatePath(projectRoot),
    assertMirrorAcquireState,
  );
}

async function readMirrorIndexFixture(
  projectRoot: string,
): Promise<MirrorIndexEntry[]> {
  return readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, "mirror", "index.jsonl"),
    assertMirrorIndexEntry,
  );
}

function createMaterializer(skippedIds: readonly string[]) {
  const skipped = new Set(skippedIds);

  return async (entry: AssetCatalogEntry) => {
    if (skipped.has(entry.id)) {
      return {
        artifact: null,
        skipReason: "materialize-failed" as const,
      };
    }

    return {
      artifact: {
        content: Buffer.from(`fixture:${entry.id}`, "utf8"),
      },
    };
  };
}

function createGitBlobSha(content: Buffer): string {
  return createHash("sha1")
    .update(`blob ${content.byteLength}\0`)
    .update(content)
    .digest("hex");
}

function restoreFetchMockFlag(previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    return;
  }

  restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousValue);
}

function createOfficialIndexHtml(repoUrl: string): string {
  return [
    "<html><body>",
    `<a href="${repoUrl}">View on GitHub</a>`,
    "</body></html>",
  ].join("");
}

void test("mirror acquire checkpoint throws when persisted state is missing", () => {
  assert.throws(
    () => assertMirrorAcquireCheckpoint(null, "workspace pipeline"),
    /workspace pipeline missing mirror acquire state/,
  );
});

void test("mirror acquire checkpoint rejects inconsistent state arithmetic", () => {
  const state = createAcquireState({
    totalEligibleCount: 20,
    mirroredCount: 8,
    skippedCount: 5,
    skippedAssetIds: ["skip-a", "skip-b", "skip-c", "skip-d", "skip-e"],
    remainingCount: 6,
    lastBatchMirroredCount: 3,
    lastBatchSkippedCount: 2,
  });

  assert.throws(
    () => assertMirrorAcquireCheckpoint(state, "workspace pipeline"),
    /workspace pipeline mirror acquire state is inconsistent/,
  );
});

void test("mirror acquire checkpoint rejects skipped-count mismatches and stalled acquire batches", () => {
  assert.throws(
    () =>
      assertMirrorAcquireCheckpoint(
        createAcquireState({
          skippedCount: 2,
          skippedAssetIds: ["skip-a"],
        }),
        "workspace pipeline",
      ),
    /skippedAssetIds\(1\) != skippedCount\(2\)/u,
  );

  assert.throws(
    () =>
      assertMirrorAcquireCheckpoint(
        createAcquireState({
          totalEligibleCount: 4,
          mirroredCount: 2,
          skippedCount: 1,
          skippedAssetIds: ["skip-a"],
          remainingCount: 1,
          lastBatchAssetIds: ["asset-d"],
          lastBatchSkippedCount: 1,
          terminal: true,
          skippedAssetReasons: undefined,
        }),
        "fixture",
      ),
    /fixture mirror acquire stalled after batch: 2\/4 mirrored, 1 skipped in last batch, 1 remaining\./u,
  );
});

void test("mirror acquire checkpoint rejects inconsistent and empty-summary refresh checkpoints", () => {
  assert.throws(
    () =>
      assertMirrorAcquireCheckpoint(
        createAcquireState({
          totalEligibleCount: 5,
          remainingCount: 2,
          skippedCount: 1,
          skippedAssetIds: ["skip-a"],
          sessionMode: "refresh",
          processedCount: 1,
        }),
        "fixture",
      ),
    /fixture mirror refresh state is inconsistent: processed\(1\) \+ remaining\(2\) != total\(5\)/u,
  );

  assert.throws(
    () =>
      assertMirrorAcquireCheckpoint(
        createAcquireState({
          totalEligibleCount: 3,
          remainingCount: 1,
          skippedCount: 0,
          skippedAssetIds: [],
          lastBatchAssetIds: ["asset-c"],
          sessionMode: "refresh",
          processedCount: 2,
          terminal: true,
          skippedAssetReasons: {},
        }),
        "fixture",
      ),
    /fixture mirror refresh stalled after batch: 2\/3 processed, 0 skipped in last batch, 1 remaining\./u,
  );
});

void test("acquireMirrorArtifacts writes terminal incomplete state for all-skip fixtures", async () => {
  const entries = [buildAsset("skip-a"), buildAsset("skip-b")];
  const projectRoot = await createAcquireFixture(entries);

  try {
    await acquireMirrorArtifacts(
      projectRoot,
      projectRoot,
      ["--batch-size", "10"],
      {
        materializeArtifact: createMaterializer(
          entries.map((entry) => entry.id),
        ),
      },
    );

    const state = await readAcquireStateFixture(projectRoot);
    const mirrorIndex = await readMirrorIndexFixture(projectRoot);

    assert.equal(state.terminal, true);
    assert.equal(state.totalEligibleCount, 2);
    assert.equal(state.mirroredCount, 0);
    assert.equal(state.skippedCount, 2);
    assert.deepEqual(state.skippedAssetIds, ["skip-a", "skip-b"]);
    assert.deepEqual(state.skippedAssetReasons, {
      "skip-a": "materialize-failed",
      "skip-b": "materialize-failed",
    });
    assert.equal(state.remainingCount, 0);
    assert.equal(state.lastBatchMirroredCount, 0);
    assert.equal(state.lastBatchSkippedCount, 2);
    assert.deepEqual(state.lastBatchSkippedReasons, {
      "skip-a": "materialize-failed",
      "skip-b": "materialize-failed",
    });
    assert.deepEqual(state.lastBatchAssetIds, ["skip-a", "skip-b"]);
    assert.equal(mirrorIndex.length, 0);

    assert.throws(
      () => assertMirrorAcquireCheckpoint(state, "fixture"),
      /fixture mirror acquire ended incomplete: 0\/2 mirrored, 2 skipped/,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("acquireMirrorArtifacts ignores stale persisted skipped ids outside the current eligible set", async () => {
  const entries = [buildAsset("mirror-a")];
  const projectRoot = await createAcquireFixture(entries);

  try {
    await writeJsonFile(
      acquireStatePath(projectRoot),
      createAcquireState({
        totalEligibleCount: 1,
        skippedCount: 1,
        skippedAssetIds: ["stale-skip"],
        remainingCount: 0,
        terminal: true,
      }),
    );

    await acquireMirrorArtifacts(
      projectRoot,
      projectRoot,
      ["--batch-size", "10"],
      { materializeArtifact: createMaterializer([]) },
    );

    const state = await readAcquireStateFixture(projectRoot);
    const mirrorIndex = await readMirrorIndexFixture(projectRoot);

    assert.equal(state.terminal, true);
    assert.equal(state.mirroredCount, 1);
    assert.equal(state.skippedCount, 0);
    assert.deepEqual(state.skippedAssetIds, []);
    assert.equal(state.remainingCount, 0);
    assert.equal(state.lastBatchMirroredCount, 1);
    assert.equal(state.lastBatchSkippedCount, 0);
    assert.deepEqual(state.lastBatchAssetIds, ["mirror-a"]);
    assert.deepEqual(
      mirrorIndex.map((entry) => entry.assetId),
      ["mirror-a"],
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("mirror acquire stale-manifest detection ignores ineligible index entries", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-acquire-"));

  try {
    const staleAssetIds =
      await mirrorAcquireInternals.findAssetIdsMissingMirrorManifests(
        projectRoot,
        [createMirrorIndexEntry("outside-current-selection")],
        new Set(["mirror-a"]),
      );

    assert.deepEqual([...staleAssetIds], []);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("acquireMirrorArtifacts refreshes stale mirror entries without manifests", async () => {
  const entries = [buildAsset("mirror-a")];
  const projectRoot = await createAcquireFixture(entries);
  const staleMirrorEntry = createMirrorIndexEntry("mirror-a");

  try {
    await writeJsonLinesFile(mirrorIndexPath(projectRoot), [staleMirrorEntry]);
    await writeTextFile(
      join(
        projectRoot,
        "mirror",
        "raw",
        staleMirrorEntry.mirrorId,
        "content.txt",
      ),
      "legacy mirror content without a file manifest",
    );

    await acquireMirrorArtifacts(
      projectRoot,
      projectRoot,
      ["--batch-size", "10"],
      { materializeArtifact: createMaterializer([]) },
    );

    const state = await readAcquireStateFixture(projectRoot);
    const mirrorIndex = await readMirrorIndexFixture(projectRoot);

    assert.equal(state.terminal, true);
    assert.equal(state.mirroredCount, 1);
    assert.equal(state.skippedCount, 0);
    assert.equal(state.remainingCount, 0);
    assert.equal(state.lastBatchMirroredCount, 1);
    assert.deepEqual(state.lastBatchAssetIds, ["mirror-a"]);
    assert.equal(mirrorIndex.length, 1);
    assert.equal(mirrorIndex[0]?.assetId, "mirror-a");
    assert.notEqual(mirrorIndex[0]?.mirrorId, staleMirrorEntry.mirrorId);

    const refreshedManifest = await readFile(
      join(
        projectRoot,
        "mirror",
        "raw",
        mirrorIndex[0]!.mirrorId,
        "manifest.json",
      ),
      "utf8",
    );
    assert.match(refreshedManifest, /"aggregateHash"/u);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("acquireMirrorArtifacts refreshes stale mirror entries with manifest directories", async () => {
  const entries = [buildAsset("mirror-a")];
  const projectRoot = await createAcquireFixture(entries);
  const staleMirrorEntry = createMirrorIndexEntry("mirror-a");

  try {
    await writeJsonLinesFile(mirrorIndexPath(projectRoot), [staleMirrorEntry]);
    await mkdir(
      join(
        projectRoot,
        "mirror",
        "raw",
        staleMirrorEntry.mirrorId,
        "manifest.json",
      ),
      { recursive: true },
    );

    await acquireMirrorArtifacts(
      projectRoot,
      projectRoot,
      ["--batch-size", "10"],
      { materializeArtifact: createMaterializer([]) },
    );

    const state = await readAcquireStateFixture(projectRoot);
    const mirrorIndex = await readMirrorIndexFixture(projectRoot);

    assert.equal(state.terminal, true);
    assert.equal(state.mirroredCount, 1);
    assert.equal(state.skippedCount, 0);
    assert.deepEqual(state.lastBatchAssetIds, ["mirror-a"]);
    assert.equal(mirrorIndex.length, 1);
    assert.notEqual(mirrorIndex[0]?.mirrorId, staleMirrorEntry.mirrorId);
    assert.equal(
      await mirrorAcquireInternals.pathLooksReadable(
        join(
          projectRoot,
          "mirror",
          "raw",
          staleMirrorEntry.mirrorId,
          "manifest.json",
        ),
      ),
      false,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("acquireMirrorArtifacts mirrors pinned github-tree assets between legacy and relaxed size caps when commit lookup fails but raw fetch verifies", async (context) => {
  const largeContent = Buffer.alloc(
    MAX_GITHUB_MIRROR_FILE_SIZE_BYTES - 200_000,
    "a",
  );
  const entry = buildGitHubTreeAsset("github-tree-agent", largeContent);
  const projectRoot = await createAcquireFixture([entry]);
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (requestUrl.startsWith("https://api.github.com/")) {
      return new Response("rate limited", { status: 503 });
    }

    if (requestUrl.startsWith("https://raw.githubusercontent.com/")) {
      return new Response(largeContent, { status: 200 });
    }

    throw new Error(`Unexpected URL: ${requestUrl}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  try {
    const policy = buildMirrorPolicy();
    await writeJsonFile(join(projectRoot, "mirror", "policy.json"), {
      ...policy,
      selection: {
        ...policy.selection,
        requirePinnedProvenance: true,
      },
    });

    await acquireMirrorArtifacts(projectRoot, projectRoot, [
      "--batch-size",
      "10",
    ]);

    const state = await readAcquireStateFixture(projectRoot);
    const mirrorIndex = await readMirrorIndexFixture(projectRoot);

    assert.equal(state.terminal, true);
    assert.equal(state.mirroredCount, 1);
    assert.equal(state.skippedCount, 0);
    assert.deepEqual(state.skippedAssetIds, []);
    assert.equal(state.remainingCount, 0);
    assert.equal(state.lastBatchMirroredCount, 1);
    assert.equal(state.lastBatchSkippedCount, 0);
    assert.deepEqual(state.lastBatchAssetIds, ["github-tree-agent"]);
    assert.equal(mirrorIndex.length, 1);
    assert.equal(mirrorIndex[0]?.assetId, "github-tree-agent");
    assert.equal(mirrorIndex[0]?.upstream.commit, undefined);
    assert.equal(assertMirrorAcquireCheckpoint(state, "fixture"), true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("acquireMirrorArtifacts mirrors official-index packages when commit lookup fails but raw files verify", async (context) => {
  // A unique originUrl guarantees the module-level resolution cache is cold
  // for THIS entry even in a shared-process run, so the cache-miss fetch
  // branch is genuinely exercised.
  const entry = buildOfficialIndexAsset("official-index-cloudflare", {
    originUrl:
      "https://officialskills.sh/cloudflare-acquire-cold/skills/cloudflare",
  });
  const projectRoot = await createAcquireFixture([entry]);
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const skillMarkdownContent = Buffer.from("# Cloudflare\n", "utf8");
  const skillReadmeContent = Buffer.from("See SKILL.md\n", "utf8");
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (
      requestUrl ===
      "https://officialskills.sh/cloudflare-acquire-cold/skills/cloudflare"
    ) {
      return new Response(
        [
          "<html><body>",
          '<a href="https://github.com/cloudflare/skills/tree/main/skills/cloudflare">View on GitHub</a>',
          "</body></html>",
        ].join(""),
        { status: 200 },
      );
    }

    if (requestUrl === "https://api.github.com/repos/cloudflare/skills") {
      return Response.json({
        name: "skills",
        full_name: "cloudflare/skills",
        description: "fixture",
        default_branch: "main",
        updated_at: "2026-01-01T00:00:00.000Z",
        pushed_at: "2026-01-01T00:00:00.000Z",
        stargazers_count: 1,
        language: "Markdown",
        topics: [],
        archived: false,
        html_url: "https://github.com/cloudflare/skills",
      });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/cloudflare/skills/git/trees/main?recursive=1"
    ) {
      return Response.json({
        sha: "tree-sha",
        truncated: false,
        tree: [
          {
            path: "cloudflare/SKILL.md",
            type: "blob",
            size: skillMarkdownContent.byteLength,
            sha: createGitBlobSha(skillMarkdownContent),
          },
          {
            path: "cloudflare/README.md",
            type: "blob",
            size: skillReadmeContent.byteLength,
            sha: createGitBlobSha(skillReadmeContent),
          },
        ],
      });
    }

    if (
      requestUrl === "https://api.github.com/repos/cloudflare/skills/readme"
    ) {
      return new Response("not found", { status: 404 });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/cloudflare/skills/commits/main"
    ) {
      return new Response("rate limited", { status: 503 });
    }

    if (
      requestUrl ===
      "https://raw.githubusercontent.com/cloudflare/skills/main/cloudflare/SKILL.md"
    ) {
      return new Response(skillMarkdownContent, { status: 200 });
    }

    if (
      requestUrl ===
      "https://raw.githubusercontent.com/cloudflare/skills/main/cloudflare/README.md"
    ) {
      return new Response(skillReadmeContent, { status: 200 });
    }

    throw new Error(`Unexpected URL: ${requestUrl}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  try {
    const policy = buildMirrorPolicy();
    await writeJsonFile(join(projectRoot, "mirror", "policy.json"), {
      ...policy,
      selection: {
        ...policy.selection,
        requirePinnedProvenance: true,
      },
    });

    await acquireMirrorArtifacts(projectRoot, projectRoot, [
      "--batch-size",
      "10",
    ]);

    const state = await readAcquireStateFixture(projectRoot);
    const mirrorIndex = await readMirrorIndexFixture(projectRoot);

    assert.equal(state.terminal, true);
    assert.equal(state.mirroredCount, 1);
    assert.equal(state.skippedCount, 0);
    assert.deepEqual(state.skippedAssetIds, []);
    assert.equal(state.remainingCount, 0);
    assert.equal(mirrorIndex.length, 1);
    assert.equal(mirrorIndex[0]?.assetId, "official-index-cloudflare");
    assert.equal(mirrorIndex[0]?.upstream.commit, undefined);
    assert.equal(assertMirrorAcquireCheckpoint(state, "fixture"), true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("acquireMirrorArtifacts falls back to later official-index repo candidates when an earlier candidate exceeds policy caps", async (context) => {
  // A unique originUrl keeps the module-level resolution cache cold in a
  // shared-process run so the candidate pre-fetch actually executes.
  const entry = buildOfficialIndexAsset("official-index-fallback-candidate", {
    originUrl:
      "https://officialskills.sh/cloudflare-candidates-cold/skills/cloudflare",
  });
  const projectRoot = await createAcquireFixture([entry]);
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  const oversizedRepoUrl =
    "https://github.com/cloudflare/cloudflare-skills/tree/main/skills/cloudflare";
  const oversizedTree = Array.from(
    { length: MAX_OFFICIAL_INDEX_PACKAGE_FILES + 1 },
    (_, index) => ({
      path:
        index === 0
          ? "skills/cloudflare/SKILL.md"
          : `skills/cloudflare/references/oversized-${index}.md`,
      type: "blob",
      size: 128,
      sha: `oversized-sha-${index}`,
    }),
  );
  const fallbackSkillMarkdownContent = Buffer.from(
    "# Cloudflare fallback\n",
    "utf8",
  );
  const fallbackReadmeContent = Buffer.from("Fallback repo\n", "utf8");

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (
      requestUrl ===
      "https://officialskills.sh/cloudflare-candidates-cold/skills/cloudflare"
    ) {
      return new Response(createOfficialIndexHtml(oversizedRepoUrl), {
        status: 200,
      });
    }

    if (
      requestUrl === "https://api.github.com/repos/cloudflare/cloudflare-skills"
    ) {
      return Response.json({
        name: "cloudflare-skills",
        full_name: "cloudflare/cloudflare-skills",
        description: "fixture",
        default_branch: "main",
        updated_at: "2026-01-01T00:00:00.000Z",
        pushed_at: "2026-01-01T00:00:00.000Z",
        stargazers_count: 1,
        language: "Markdown",
        topics: [],
        archived: false,
        html_url: "https://github.com/cloudflare/cloudflare-skills",
      });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/cloudflare/cloudflare-skills/git/trees/main?recursive=1"
    ) {
      return Response.json({
        sha: "oversized-tree-sha",
        truncated: false,
        tree: oversizedTree,
      });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/cloudflare/cloudflare-skills/readme"
    ) {
      return new Response("not found", { status: 404 });
    }

    if (requestUrl === "https://api.github.com/repos/cloudflare/skills") {
      return Response.json({
        name: "skills",
        full_name: "cloudflare/skills",
        description: "fixture",
        default_branch: "main",
        updated_at: "2026-01-01T00:00:00.000Z",
        pushed_at: "2026-01-01T00:00:00.000Z",
        stargazers_count: 1,
        language: "Markdown",
        topics: [],
        archived: false,
        html_url: "https://github.com/cloudflare/skills",
      });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/cloudflare/skills/git/trees/main?recursive=1"
    ) {
      return Response.json({
        sha: "fallback-tree-sha",
        truncated: false,
        tree: [
          {
            path: "skills/cloudflare/SKILL.md",
            type: "blob",
            size: fallbackSkillMarkdownContent.byteLength,
            sha: createGitBlobSha(fallbackSkillMarkdownContent),
          },
          {
            path: "skills/cloudflare/README.md",
            type: "blob",
            size: fallbackReadmeContent.byteLength,
            sha: createGitBlobSha(fallbackReadmeContent),
          },
        ],
      });
    }

    if (
      requestUrl === "https://api.github.com/repos/cloudflare/skills/readme"
    ) {
      return new Response("not found", { status: 404 });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/cloudflare/skills/commits/main"
    ) {
      return new Response("rate limited", { status: 503 });
    }

    if (
      requestUrl ===
      "https://raw.githubusercontent.com/cloudflare/skills/main/skills/cloudflare/SKILL.md"
    ) {
      return new Response(fallbackSkillMarkdownContent, { status: 200 });
    }

    if (
      requestUrl ===
      "https://raw.githubusercontent.com/cloudflare/skills/main/skills/cloudflare/README.md"
    ) {
      return new Response(fallbackReadmeContent, { status: 200 });
    }

    throw new Error(`Unexpected URL: ${requestUrl}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  try {
    const policy = buildMirrorPolicy();
    await writeJsonFile(join(projectRoot, "mirror", "policy.json"), {
      ...policy,
      selection: {
        ...policy.selection,
        requirePinnedProvenance: true,
      },
    });

    await acquireMirrorArtifacts(projectRoot, projectRoot, [
      "--batch-size",
      "10",
    ]);

    const state = await readAcquireStateFixture(projectRoot);
    const mirrorIndex = await readMirrorIndexFixture(projectRoot);

    assert.equal(state.terminal, true);
    assert.equal(state.mirroredCount, 1);
    assert.equal(state.skippedCount, 0);
    assert.deepEqual(state.skippedAssetIds, []);
    assert.deepEqual(state.skippedAssetReasons, {});
    assert.equal(mirrorIndex.length, 1);
    assert.equal(mirrorIndex[0]?.assetId, "official-index-fallback-candidate");
  } finally {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("acquireMirrorArtifacts mirrors official-index packages with more than the legacy file-count cap", async (context) => {
  const entry = buildOfficialIndexAsset("official-index-many-files");
  const projectRoot = await createAcquireFixture([entry]);
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  const repoUrl =
    "https://github.com/cloudflare/skills/tree/main/skills/cloudflare";
  const packageFiles = Array.from({ length: 60 }, (_, index) => {
    const relativePath =
      index === 0 ? "SKILL.md" : `references/example-${index}.md`;
    const content = Buffer.from(`fixture:${relativePath}\n`, "utf8");
    return {
      relativePath,
      path: `skills/cloudflare/${relativePath}`,
      content,
    };
  });
  const packageContentByPath = new Map(
    packageFiles.map((file) => [file.path, file.content]),
  );

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (
      requestUrl === "https://officialskills.sh/cloudflare/skills/cloudflare"
    ) {
      return new Response(createOfficialIndexHtml(repoUrl), { status: 200 });
    }

    if (requestUrl === "https://api.github.com/repos/cloudflare/skills") {
      return Response.json({
        name: "skills",
        full_name: "cloudflare/skills",
        description: "fixture",
        default_branch: "main",
        updated_at: "2026-01-01T00:00:00.000Z",
        pushed_at: "2026-01-01T00:00:00.000Z",
        stargazers_count: 1,
        language: "Markdown",
        topics: [],
        archived: false,
        html_url: "https://github.com/cloudflare/skills",
      });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/cloudflare/skills/git/trees/main?recursive=1"
    ) {
      return Response.json({
        sha: "tree-sha",
        truncated: false,
        tree: packageFiles.map((file) => ({
          path: file.path,
          type: "blob",
          size: file.content.byteLength,
          sha: createGitBlobSha(file.content),
        })),
      });
    }

    if (
      requestUrl === "https://api.github.com/repos/cloudflare/skills/readme"
    ) {
      return new Response("not found", { status: 404 });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/cloudflare/skills/commits/main"
    ) {
      return new Response("rate limited", { status: 503 });
    }

    const rawPrefix =
      "https://raw.githubusercontent.com/cloudflare/skills/main/";
    if (requestUrl.startsWith(rawPrefix)) {
      const content = packageContentByPath.get(
        requestUrl.slice(rawPrefix.length),
      );
      if (!content) {
        throw new Error(`Unexpected raw URL: ${requestUrl}`);
      }

      return new Response(content, { status: 200 });
    }

    throw new Error(`Unexpected URL: ${requestUrl}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  try {
    const policy = buildMirrorPolicy();
    await writeJsonFile(join(projectRoot, "mirror", "policy.json"), {
      ...policy,
      selection: {
        ...policy.selection,
        requirePinnedProvenance: true,
      },
    });

    await acquireMirrorArtifacts(projectRoot, projectRoot, [
      "--batch-size",
      "10",
    ]);

    const state = await readAcquireStateFixture(projectRoot);
    const mirrorIndex = await readMirrorIndexFixture(projectRoot);

    assert.equal(state.terminal, true);
    assert.equal(state.mirroredCount, 1);
    assert.equal(state.skippedCount, 0);
    assert.deepEqual(state.skippedAssetIds, []);
    assert.equal(mirrorIndex.length, 1);
    assert.equal(mirrorIndex[0]?.assetId, "official-index-many-files");
  } finally {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("acquireMirrorArtifacts mirrors official-index packages with files between legacy and relaxed size caps", async (context) => {
  const entry = {
    ...buildOfficialIndexAsset("official-index-large-file"),
    source: {
      sourceId: "official-index:figma:figma-use",
      authorityTier: "official-first-party" as const,
      sourceKind: "docs" as const,
      sourcePriority: 100,
      originUrl: "https://officialskills.sh/figma/skills/figma-use",
      publisher: "Figma",
      publisherVerified: true,
    },
    install: {
      method: "official-index-entry" as const,
      nativeHosts: ["copilot-vscode" as const],
      manifestEntry: "figma-use",
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      lineCount: 1,
      filePath: "SKILL.md",
      rootPath: "https://officialskills.sh/figma/skills/figma-use",
    },
  };
  const projectRoot = await createAcquireFixture([entry]);
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  const repoUrl =
    "https://github.com/figma/mcp-server-guide/tree/main/skills/figma-use";
  const skillMarkdownContent = Buffer.from("# Figma Use\n", "utf8");
  const largeReferenceContent = Buffer.alloc(
    Math.min(MAX_OFFICIAL_INDEX_FILE_SIZE_BYTES - 100_000, 700_000),
    "d",
  );

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (requestUrl === "https://officialskills.sh/figma/skills/figma-use") {
      return new Response(createOfficialIndexHtml(repoUrl), { status: 200 });
    }

    if (requestUrl === "https://api.github.com/repos/figma/mcp-server-guide") {
      return Response.json({
        name: "mcp-server-guide",
        full_name: "figma/mcp-server-guide",
        description: "fixture",
        default_branch: "main",
        updated_at: "2026-01-01T00:00:00.000Z",
        pushed_at: "2026-01-01T00:00:00.000Z",
        stargazers_count: 1,
        language: "Markdown",
        topics: [],
        archived: false,
        html_url: "https://github.com/figma/mcp-server-guide",
      });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/figma/mcp-server-guide/git/trees/main?recursive=1"
    ) {
      return Response.json({
        sha: "tree-sha",
        truncated: false,
        tree: [
          {
            path: "skills/figma-use/SKILL.md",
            type: "blob",
            size: skillMarkdownContent.byteLength,
            sha: createGitBlobSha(skillMarkdownContent),
          },
          {
            path: "skills/figma-use/references/plugin-api-standalone.d.ts",
            type: "blob",
            size: largeReferenceContent.byteLength,
            sha: createGitBlobSha(largeReferenceContent),
          },
        ],
      });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/figma/mcp-server-guide/readme"
    ) {
      return new Response("not found", { status: 404 });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/figma/mcp-server-guide/commits/main"
    ) {
      return new Response("rate limited", { status: 503 });
    }

    if (
      requestUrl ===
      "https://raw.githubusercontent.com/figma/mcp-server-guide/main/skills/figma-use/SKILL.md"
    ) {
      return new Response(skillMarkdownContent, { status: 200 });
    }

    if (
      requestUrl ===
      "https://raw.githubusercontent.com/figma/mcp-server-guide/main/skills/figma-use/references/plugin-api-standalone.d.ts"
    ) {
      return new Response(largeReferenceContent, { status: 200 });
    }

    throw new Error(`Unexpected URL: ${requestUrl}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  try {
    const policy = buildMirrorPolicy();
    await writeJsonFile(join(projectRoot, "mirror", "policy.json"), {
      ...policy,
      selection: {
        ...policy.selection,
        requirePinnedProvenance: true,
      },
    });

    await acquireMirrorArtifacts(projectRoot, projectRoot, [
      "--batch-size",
      "10",
    ]);

    const state = await readAcquireStateFixture(projectRoot);
    const mirrorIndex = await readMirrorIndexFixture(projectRoot);

    assert.equal(state.terminal, true);
    assert.equal(state.mirroredCount, 1);
    assert.equal(state.skippedCount, 0);
    assert.deepEqual(state.skippedAssetIds, []);
    assert.equal(mirrorIndex.length, 1);
    assert.equal(mirrorIndex[0]?.assetId, "official-index-large-file");
  } finally {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("acquireMirrorArtifacts falls back to official-index page content when cap failures are followed by non-cap candidate failures", async (context) => {
  const originUrl =
    "https://officialskills.sh/cloudflare/skills/cloudflare?cap-then-noncap=1";
  const baseEntry = buildOfficialIndexAsset(
    "official-index-cap-then-noncap-failure",
  );
  const entry = {
    ...baseEntry,
    source: {
      ...baseEntry.source,
      originUrl,
    },
    evidence: {
      ...baseEntry.evidence,
      rootPath: originUrl,
    },
  };
  const projectRoot = await createAcquireFixture([entry]);
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  const repoUrl =
    "https://github.com/cloudflare/cloudflare-skills/tree/main/skills/cloudflare";
  const oversizedTree = Array.from(
    { length: MAX_OFFICIAL_INDEX_PACKAGE_FILES + 1 },
    (_, index) => ({
      path:
        index === 0
          ? "skills/cloudflare/SKILL.md"
          : `skills/cloudflare/references/oversized-${index}.md`,
      type: "blob",
      size: 128,
      sha: `oversized-sha-${index}`,
    }),
  );

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (requestUrl === originUrl) {
      return new Response(createOfficialIndexHtml(repoUrl), { status: 200 });
    }

    if (
      requestUrl === "https://api.github.com/repos/cloudflare/cloudflare-skills"
    ) {
      return Response.json({
        name: "cloudflare-skills",
        full_name: "cloudflare/cloudflare-skills",
        description: "fixture",
        default_branch: "main",
        updated_at: "2026-01-01T00:00:00.000Z",
        pushed_at: "2026-01-01T00:00:00.000Z",
        stargazers_count: 1,
        language: "Markdown",
        topics: [],
        archived: false,
        html_url: "https://github.com/cloudflare/cloudflare-skills",
      });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/cloudflare/cloudflare-skills/git/trees/main?recursive=1"
    ) {
      return Response.json({
        sha: "oversized-tree-sha",
        truncated: false,
        tree: oversizedTree,
      });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/cloudflare/cloudflare-skills/readme"
    ) {
      return new Response("not found", { status: 404 });
    }

    if (requestUrl === "https://api.github.com/repos/cloudflare/skills") {
      return Response.json({
        name: "skills",
        full_name: "cloudflare/skills",
        description: "fixture",
        default_branch: "main",
        updated_at: "2026-01-01T00:00:00.000Z",
        pushed_at: "2026-01-01T00:00:00.000Z",
        stargazers_count: 1,
        language: "Markdown",
        topics: [],
        archived: false,
        html_url: "https://github.com/cloudflare/skills",
      });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/cloudflare/skills/git/trees/main?recursive=1"
    ) {
      return Response.json({
        sha: "fallback-tree-sha",
        truncated: false,
        tree: [
          {
            path: "skills/other-skill/SKILL.md",
            type: "blob",
            size: 128,
            sha: "other-skill-sha",
          },
        ],
      });
    }

    if (
      requestUrl === "https://api.github.com/repos/cloudflare/skills/readme"
    ) {
      return new Response("not found", { status: 404 });
    }

    throw new Error(`Unexpected URL: ${requestUrl}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  try {
    await acquireMirrorArtifacts(projectRoot, projectRoot, [
      "--batch-size",
      "10",
    ]);

    const state = await readAcquireStateFixture(projectRoot);
    const mirrorIndex = await readMirrorIndexFixture(projectRoot);

    assert.equal(state.terminal, true);
    assert.equal(state.mirroredCount, 1);
    assert.equal(state.skippedCount, 0);
    assert.deepEqual(state.skippedAssetIds, []);
    assert.deepEqual(state.skippedAssetReasons, {});
    assert.deepEqual(state.lastBatchSkippedReasons, {});
    assert.equal(mirrorIndex.length, 1);
    assert.equal(
      mirrorIndex[0]?.assetId,
      "official-index-cap-then-noncap-failure",
    );

    const mirroredContent = await readFile(
      join(
        projectRoot,
        "mirror",
        "raw",
        mirrorIndex[0]?.mirrorId ?? "",
        "content.txt",
      ),
      "utf8",
    );
    assert.ok(mirroredContent.includes(`**Official Page**: ${originUrl}`));
    assert.match(
      mirroredContent,
      /\*\*GitHub\*\*: https:\/\/github\.com\/cloudflare\/cloudflare-skills\/tree\/main\/skills\/cloudflare/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("acquireMirrorArtifacts records official-index total-byte cap skips with reasons", async (context) => {
  const entry = buildOfficialIndexAsset("official-index-too-large");
  const projectRoot = await createAcquireFixture([entry]);
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  const repoUrl =
    "https://github.com/cloudflare/skills/tree/main/skills/cloudflare";
  const oversizedFileCount =
    Math.ceil(
      MAX_OFFICIAL_INDEX_PACKAGE_TOTAL_BYTES /
        MAX_OFFICIAL_INDEX_FILE_SIZE_BYTES,
    ) + 1;
  const oversizedTree = Array.from(
    { length: oversizedFileCount },
    (_, index) => ({
      path:
        index === 0
          ? "skills/cloudflare/SKILL.md"
          : `skills/cloudflare/references/large-${index}.md`,
      type: "blob",
      size: index === 0 ? 128 : MAX_OFFICIAL_INDEX_FILE_SIZE_BYTES,
      sha: `sha-${index}`,
    }),
  );

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (
      requestUrl === "https://officialskills.sh/cloudflare/skills/cloudflare"
    ) {
      return new Response(createOfficialIndexHtml(repoUrl), { status: 200 });
    }

    if (requestUrl === "https://api.github.com/repos/cloudflare/skills") {
      return Response.json({
        name: "skills",
        full_name: "cloudflare/skills",
        description: "fixture",
        default_branch: "main",
        updated_at: "2026-01-01T00:00:00.000Z",
        pushed_at: "2026-01-01T00:00:00.000Z",
        stargazers_count: 1,
        language: "Markdown",
        topics: [],
        archived: false,
        html_url: "https://github.com/cloudflare/skills",
      });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/cloudflare/skills/git/trees/main?recursive=1"
    ) {
      return Response.json({
        sha: "tree-sha",
        truncated: false,
        tree: oversizedTree,
      });
    }

    if (
      requestUrl === "https://api.github.com/repos/cloudflare/skills/readme"
    ) {
      return new Response("not found", { status: 404 });
    }

    if (
      requestUrl === "https://api.github.com/repos/cloudflare/cloudflare-skills"
    ) {
      return Response.json({
        name: "cloudflare-skills",
        full_name: "cloudflare/cloudflare-skills",
        description: "fixture",
        default_branch: "main",
        updated_at: "2026-01-01T00:00:00.000Z",
        pushed_at: "2026-01-01T00:00:00.000Z",
        stargazers_count: 1,
        language: "Markdown",
        topics: [],
        archived: false,
        html_url: "https://github.com/cloudflare/cloudflare-skills",
      });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/cloudflare/cloudflare-skills/git/trees/main?recursive=1"
    ) {
      return Response.json({
        sha: "owner-tree-sha",
        truncated: false,
        tree: oversizedTree,
      });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/cloudflare/cloudflare-skills/readme"
    ) {
      return new Response("not found", { status: 404 });
    }

    throw new Error(`Unexpected URL: ${requestUrl}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  try {
    await acquireMirrorArtifacts(projectRoot, projectRoot, [
      "--batch-size",
      "10",
    ]);

    const state = await readAcquireStateFixture(projectRoot);
    const mirrorIndex = await readMirrorIndexFixture(projectRoot);

    assert.equal(state.terminal, true);
    assert.equal(state.mirroredCount, 0);
    assert.equal(state.skippedCount, 1);
    assert.deepEqual(state.skippedAssetIds, ["official-index-too-large"]);
    assert.deepEqual(state.skippedAssetReasons, {
      "official-index-too-large": "official-index-package-too-large",
    });
    assert.deepEqual(state.lastBatchSkippedReasons, {
      "official-index-too-large": "official-index-package-too-large",
    });
    assert.equal(mirrorIndex.length, 0);
    assert.throws(
      () => assertMirrorAcquireCheckpoint(state, "fixture"),
      /Top skip reasons: official-index-package-too-large \(1\)\./,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("acquireMirrorArtifacts records official-index file-count cap skips with reasons", async (context) => {
  const entry = buildOfficialIndexAsset("official-index-too-many-files");
  const projectRoot = await createAcquireFixture([entry]);
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  const repoUrl =
    "https://github.com/cloudflare/skills/tree/main/skills/cloudflare";
  const oversizedTree = Array.from(
    { length: MAX_OFFICIAL_INDEX_PACKAGE_FILES + 1 },
    (_, index) => ({
      path:
        index === 0
          ? "skills/cloudflare/SKILL.md"
          : `skills/cloudflare/references/file-${index}.md`,
      type: "blob",
      size: 128,
      sha: `sha-${index}`,
    }),
  );

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (
      requestUrl === "https://officialskills.sh/cloudflare/skills/cloudflare"
    ) {
      return new Response(createOfficialIndexHtml(repoUrl), { status: 200 });
    }

    if (requestUrl === "https://api.github.com/repos/cloudflare/skills") {
      return Response.json({
        name: "skills",
        full_name: "cloudflare/skills",
        description: "fixture",
        default_branch: "main",
        updated_at: "2026-01-01T00:00:00.000Z",
        pushed_at: "2026-01-01T00:00:00.000Z",
        stargazers_count: 1,
        language: "Markdown",
        topics: [],
        archived: false,
        html_url: "https://github.com/cloudflare/skills",
      });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/cloudflare/skills/git/trees/main?recursive=1"
    ) {
      return Response.json({
        sha: "tree-sha",
        truncated: false,
        tree: oversizedTree,
      });
    }

    if (
      requestUrl === "https://api.github.com/repos/cloudflare/skills/readme"
    ) {
      return new Response("not found", { status: 404 });
    }

    if (
      requestUrl === "https://api.github.com/repos/cloudflare/cloudflare-skills"
    ) {
      return Response.json({
        name: "cloudflare-skills",
        full_name: "cloudflare/cloudflare-skills",
        description: "fixture",
        default_branch: "main",
        updated_at: "2026-01-01T00:00:00.000Z",
        pushed_at: "2026-01-01T00:00:00.000Z",
        stargazers_count: 1,
        language: "Markdown",
        topics: [],
        archived: false,
        html_url: "https://github.com/cloudflare/cloudflare-skills",
      });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/cloudflare/cloudflare-skills/git/trees/main?recursive=1"
    ) {
      return Response.json({
        sha: "owner-tree-sha",
        truncated: false,
        tree: oversizedTree,
      });
    }

    if (
      requestUrl ===
      "https://api.github.com/repos/cloudflare/cloudflare-skills/readme"
    ) {
      return new Response("not found", { status: 404 });
    }

    throw new Error(`Unexpected URL: ${requestUrl}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
  });

  try {
    await acquireMirrorArtifacts(projectRoot, projectRoot, [
      "--batch-size",
      "10",
    ]);

    const state = await readAcquireStateFixture(projectRoot);

    assert.equal(state.terminal, true);
    assert.equal(state.mirroredCount, 0);
    assert.equal(state.skippedCount, 1);
    assert.deepEqual(state.skippedAssetReasons, {
      "official-index-too-many-files": "official-index-package-too-many-files",
    });
    assert.deepEqual(state.lastBatchSkippedReasons, {
      "official-index-too-many-files": "official-index-package-too-many-files",
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreFetchMockFlag(previousFetchMockFlag);
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("acquireMirrorArtifacts treats mirrored overlap ids as mirrored instead of skipped", async () => {
  const entries = [buildAsset("mirror-a")];
  const projectRoot = await createAcquireFixture(entries);

  try {
    await acquireMirrorArtifacts(
      projectRoot,
      projectRoot,
      ["--batch-size", "10"],
      { materializeArtifact: createMaterializer([]) },
    );
    await writeJsonFile(
      acquireStatePath(projectRoot),
      createAcquireState({
        totalEligibleCount: 1,
        mirroredCount: 0,
        skippedCount: 1,
        skippedAssetIds: ["mirror-a"],
        remainingCount: 0,
        terminal: true,
      }),
    );

    await acquireMirrorArtifacts(
      projectRoot,
      projectRoot,
      ["--batch-size", "10"],
      { materializeArtifact: createMaterializer([]) },
    );

    const state = await readAcquireStateFixture(projectRoot);
    const mirrorIndex = await readMirrorIndexFixture(projectRoot);

    assert.equal(state.terminal, true);
    assert.equal(state.mirroredCount, 1);
    assert.equal(state.skippedCount, 0);
    assert.deepEqual(state.skippedAssetIds, []);
    assert.equal(state.remainingCount, 0);
    assert.equal(state.lastBatchMirroredCount, 0);
    assert.equal(state.lastBatchSkippedCount, 0);
    assert.deepEqual(state.lastBatchAssetIds, []);
    assert.deepEqual(
      mirrorIndex.map((entry) => entry.assetId),
      ["mirror-a"],
    );
    assert.equal(assertMirrorAcquireCheckpoint(state, "fixture"), true);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("acquireMirrorArtifacts continues past skipped first slice and mirrors later entries", async () => {
  const entries = [
    buildAsset("skip-a"),
    buildAsset("skip-b"),
    buildAsset("mirror-c"),
  ];
  const projectRoot = await createAcquireFixture(entries);
  const materializeArtifact = createMaterializer(["skip-a", "skip-b"]);

  try {
    await acquireMirrorArtifacts(
      projectRoot,
      projectRoot,
      ["--batch-size", "2"],
      { materializeArtifact },
    );

    const firstState = await readAcquireStateFixture(projectRoot);
    const firstMirrorIndex = await readMirrorIndexFixture(projectRoot);

    assert.equal(firstState.terminal, false);
    assert.equal(firstState.mirroredCount, 0);
    assert.equal(firstState.skippedCount, 2);
    assert.deepEqual(firstState.skippedAssetIds, ["skip-a", "skip-b"]);
    assert.deepEqual(firstState.skippedAssetReasons, {
      "skip-a": "materialize-failed",
      "skip-b": "materialize-failed",
    });
    assert.equal(firstState.remainingCount, 1);
    assert.equal(firstState.lastBatchMirroredCount, 0);
    assert.equal(firstState.lastBatchSkippedCount, 2);
    assert.deepEqual(firstState.lastBatchAssetIds, ["skip-a", "skip-b"]);
    assert.equal(firstMirrorIndex.length, 0);
    assert.equal(assertMirrorAcquireCheckpoint(firstState, "fixture"), false);

    await acquireMirrorArtifacts(
      projectRoot,
      projectRoot,
      ["--batch-size", "2"],
      { materializeArtifact },
    );

    const secondState = await readAcquireStateFixture(projectRoot);
    const secondMirrorIndex = await readMirrorIndexFixture(projectRoot);

    assert.equal(secondState.terminal, true);
    assert.equal(secondState.mirroredCount, 1);
    assert.equal(secondState.skippedCount, 2);
    assert.deepEqual(secondState.skippedAssetIds, ["skip-a", "skip-b"]);
    assert.deepEqual(secondState.skippedAssetReasons, {
      "skip-a": "materialize-failed",
      "skip-b": "materialize-failed",
    });
    assert.equal(secondState.remainingCount, 0);
    assert.equal(secondState.lastBatchMirroredCount, 1);
    assert.equal(secondState.lastBatchSkippedCount, 0);
    assert.deepEqual(secondState.lastBatchAssetIds, ["mirror-c"]);
    assert.deepEqual(
      secondMirrorIndex.map((entry) => entry.assetId),
      ["mirror-c"],
    );

    assert.throws(
      () => assertMirrorAcquireCheckpoint(secondState, "fixture"),
      /fixture mirror acquire ended incomplete: 1\/3 mirrored, 2 skipped/,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("acquireMirrorArtifacts tracks full refresh progress across refresh batches", async () => {
  const entries = [
    buildAsset("mirror-a"),
    buildAsset("mirror-b"),
    buildAsset("mirror-c"),
  ];
  const projectRoot = await createAcquireFixture(entries);
  const materializeArtifact = createMaterializer([]);

  try {
    await writeJsonLinesFile(mirrorIndexPath(projectRoot), [
      createMirrorIndexEntry("mirror-a"),
      createMirrorIndexEntry("mirror-b"),
      createMirrorIndexEntry("mirror-c"),
    ]);

    await acquireMirrorArtifacts(
      projectRoot,
      projectRoot,
      ["--refresh", "--batch-size", "2"],
      { materializeArtifact },
    );

    const firstState = await readAcquireStateFixture(projectRoot);
    assert.equal(firstState.sessionMode, "refresh");
    assert.equal(firstState.processedCount, 2);
    assert.equal(firstState.terminal, false);
    assert.equal(firstState.remainingCount, 1);
    assert.equal(assertMirrorAcquireCheckpoint(firstState, "fixture"), false);

    await acquireMirrorArtifacts(
      projectRoot,
      projectRoot,
      ["--refresh", "--batch-size", "2"],
      { materializeArtifact },
    );

    const secondState = await readAcquireStateFixture(projectRoot);
    assert.equal(secondState.sessionMode, "refresh");
    assert.equal(secondState.processedCount, 3);
    assert.equal(secondState.terminal, true);
    assert.equal(secondState.remainingCount, 0);
    assert.equal(assertMirrorAcquireCheckpoint(secondState, "fixture"), true);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("acquireMirrorArtifacts records partial skip and mirror results from one batch", async () => {
  const entries = [buildAsset("mirror-a"), buildAsset("skip-b")];
  const projectRoot = await createAcquireFixture(entries);

  try {
    await acquireMirrorArtifacts(
      projectRoot,
      projectRoot,
      ["--batch-size", "10"],
      { materializeArtifact: createMaterializer(["skip-b"]) },
    );

    const state = await readAcquireStateFixture(projectRoot);
    const mirrorIndex = await readMirrorIndexFixture(projectRoot);

    assert.equal(state.terminal, true);
    assert.equal(state.mirroredCount, 1);
    assert.equal(state.skippedCount, 1);
    assert.deepEqual(state.skippedAssetIds, ["skip-b"]);
    assert.deepEqual(state.skippedAssetReasons, {
      "skip-b": "materialize-failed",
    });
    assert.equal(state.remainingCount, 0);
    assert.equal(state.lastBatchMirroredCount, 1);
    assert.equal(state.lastBatchSkippedCount, 1);
    assert.deepEqual(state.lastBatchAssetIds, ["mirror-a", "skip-b"]);
    assert.deepEqual(
      mirrorIndex.map((entry) => entry.assetId),
      ["mirror-a"],
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("acquireMirrorArtifacts writes terminal complete state for full success fixtures", async () => {
  const entries = [buildAsset("mirror-a"), buildAsset("mirror-b")];
  const projectRoot = await createAcquireFixture(entries);

  try {
    await acquireMirrorArtifacts(
      projectRoot,
      projectRoot,
      ["--batch-size", "10"],
      { materializeArtifact: createMaterializer([]) },
    );

    const state = await readAcquireStateFixture(projectRoot);
    const mirrorIndex = await readMirrorIndexFixture(projectRoot);

    assert.equal(state.terminal, true);
    assert.equal(state.mirroredCount, 2);
    assert.equal(state.skippedCount, 0);
    assert.deepEqual(state.skippedAssetIds, []);
    assert.equal(state.remainingCount, 0);
    assert.equal(state.lastBatchMirroredCount, 2);
    assert.equal(state.lastBatchSkippedCount, 0);
    assert.deepEqual(state.lastBatchAssetIds, ["mirror-a", "mirror-b"]);
    assert.deepEqual(
      mirrorIndex.map((entry) => entry.assetId),
      ["mirror-a", "mirror-b"],
    );
    assert.equal(assertMirrorAcquireCheckpoint(state, "fixture"), true);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("mirror acquire checkpoint reports stalled refresh batches with summarized skip reasons", () => {
  const refreshState = createAcquireState({
    totalEligibleCount: 4,
    mirroredCount: 0,
    skippedCount: 3,
    skippedAssetIds: ["asset-a", "asset-b", "asset-c"],
    skippedAssetReasons: {
      "asset-a": "materialize-failed",
      "asset-b": "materialize-failed",
      "asset-c": "official-index-package-too-large",
    },
    remainingCount: 1,
    lastBatchAssetIds: ["asset-d"],
    lastBatchSkippedCount: 1,
    terminal: true,
    sessionMode: "refresh",
    processedCount: 3,
  });

  assert.throws(
    () => assertMirrorAcquireCheckpoint(refreshState, "fixture"),
    /fixture mirror refresh stalled after batch: 3\/4 processed, 1 skipped in last batch, 1 remaining.*Top skip reasons: materialize-failed \(2\), official-index-package-too-large \(1\)\./u,
  );
});

void test("acquireMirrorArtifacts falls back to scoped GitHub cache content when present", async () => {
  const projectRoot = await createAcquireFixture([]);
  const entry: AssetCatalogEntry = {
    ...buildAsset("cached-github-entry"),
    source: {
      sourceId: "github-awesome-copilot",
      authorityTier: "official-first-party",
      sourceKind: "repo",
      sourcePriority: 100,
      originUrl:
        "https://github.com/github/awesome-copilot/blob/main/README.md",
      publisher: "GitHub",
      publisherVerified: true,
    },
    install: {
      method: "local-file",
      nativeHosts: ["copilot-vscode"],
      manifestEntry: "cached-github-entry",
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      lineCount: 1,
      filePath: undefined,
      rootPath: "/fixture",
    },
  };
  const cachePath = join(
    projectRoot,
    "state",
    "remote-cache",
    "github",
    "github__awesome-copilot.json",
  );

  try {
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [entry],
    );
    await writeJsonLinesFile(mirrorIndexPath(projectRoot), []);
    await writeTextFile(cachePath, "cached fixture\n");

    await acquireMirrorArtifacts(projectRoot, projectRoot, [
      "--batch-size",
      "10",
    ]);

    const mirrorIndex = await readMirrorIndexFixture(projectRoot);
    const mirroredContent = await readFile(
      join(
        projectRoot,
        "mirror",
        "raw",
        mirrorIndex[0]?.mirrorId ?? "",
        "content.txt",
      ),
      "utf8",
    );

    assert.equal(mirrorIndex.length, 1);
    assert.equal(mirrorIndex[0]?.assetId, "cached-github-entry");
    assert.equal(mirroredContent, "cached fixture\n");
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});
