import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readJsonFile,
  readJsonLinesFile,
  writeJsonFile,
  writeJsonLinesFile,
} from "../files.js";
import {
  assertMirrorAcquireState,
  assertMirrorIndexEntry,
} from "../manifest-validation/mirror.js";
import { assertMirrorAcquireCheckpoint } from "../mirror/acquire-state.js";
import { acquireMirrorArtifacts } from "../mirror/acquire.js";
import type {
  AssetCatalogEntry,
  MirrorAcquireState,
  MirrorIndexEntry,
  MirrorPolicy,
} from "../types.js";

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
    lastBatchAssetIds: [],
    lastBatchMirroredCount: 0,
    lastBatchSkippedCount: 0,
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

function buildGitHubTreeAsset(id: string): AssetCatalogEntry {
  const filePath = "agents/example.agent.md";
  const content = Buffer.from("# example\n", "utf8");
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

function buildOfficialIndexAsset(id: string): AssetCatalogEntry {
  return {
    ...buildAsset(id),
    assetKind: "skill",
    compatibilityMode: "native",
    source: {
      sourceId: "official-index:cloudflare:cloudflare",
      authorityTier: "official-first-party",
      sourceKind: "docs",
      sourcePriority: 100,
      originUrl: "https://officialskills.sh/cloudflare/skills/cloudflare",
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
      rootPath: "https://officialskills.sh/cloudflare/skills/cloudflare",
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
      return null;
    }

    return {
      content: Buffer.from(`fixture:${entry.id}`, "utf8"),
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

  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousValue;
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
    assert.equal(state.remainingCount, 0);
    assert.equal(state.lastBatchMirroredCount, 0);
    assert.equal(state.lastBatchSkippedCount, 2);
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

void test("acquireMirrorArtifacts mirrors pinned github-tree assets when commit lookup fails but raw fetch verifies", async (context) => {
  const entry = buildGitHubTreeAsset("github-tree-agent");
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
      return new Response("# example\n", { status: 200 });
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
  const entry = buildOfficialIndexAsset("official-index-cloudflare");
  const projectRoot = await createAcquireFixture([entry]);
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const skillMarkdownContent = Buffer.from("# Cloudflare\n", "utf8");
  const skillReadmeContent = Buffer.from("See SKILL.md\n", "utf8");
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (
      requestUrl === "https://officialskills.sh/cloudflare/skills/cloudflare"
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

void test("acquireMirrorArtifacts treats mirrored overlap ids as mirrored instead of skipped", async () => {
  const entries = [buildAsset("mirror-a")];
  const projectRoot = await createAcquireFixture(entries);

  try {
    await writeJsonLinesFile(mirrorIndexPath(projectRoot), [
      createMirrorIndexEntry("mirror-a"),
    ]);
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
