import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDirectoryLink,
  filesInternals,
  listFilesRecursiveWithTelemetry,
  pathExists,
  readTextFileOrNull,
  removeManagedSection,
  replaceDirectoryLink,
  writeTextFile,
} from "../files.js";
import { installBundleInternals } from "../install/bundle.js";
import {
  buildAssetPrerequisitesFromMetadata,
  buildPrerequisiteDiagnostics,
} from "../lib/asset-prerequisites.js";
import {
  fetchTextWithGuards,
  httpInternals,
  type ResolvedHostnameAddress,
} from "../lib/http.js";
import { checkPathExists } from "../lib/preflight.js";
import { mirrorAcquireInternals } from "../mirror/acquire.js";
import {
  nativeWireInternals,
  type NativeWireHost,
} from "../host-adapters/native-wire.js";
import { openCodeWireInternals } from "../host-adapters/opencode.js";
import { vscodeWireInternals } from "../host-adapters/vscode.js";
import type {
  AssetCatalogEntry,
  MirrorAcquireState,
  WirePlanManifest,
} from "../types.js";

void test("core residual branches handle filesystem and ignore edge cases", async () => {
  const root = await mkdtempFixture("agent-harness-core-residual-");
  try {
    assert.equal(
      removeManagedSection({ originalContent: "plain\n", markerId: "missing" }),
      "plain\n",
    );

    const target = join(root, "target");
    const link = join(root, "links", "managed");
    await mkdir(target, { recursive: true });
    await mkdir(link, { recursive: true });
    await assert.rejects(
      createDirectoryLink(link, target),
      /destination already exists/u,
    );
    await rm(link, { recursive: true, force: true });
    await assert.rejects(
      createDirectoryLink(join(root, "missing-link"), join(root, "missing")),
      /target does not exist/u,
    );

    await mkdir(`${link}.next`, { recursive: true });
    await replaceDirectoryLink(link, target);
    assert.equal(await pathExists(link), true);
    assert.equal(await pathExists(`${link}.next`), false);

    await mkdir(join(root, "scan", "nested"), { recursive: true });
    await writeTextFile(join(root, "scan", "nested", "file.txt"), "body");
    const depthResult = await listFilesRecursiveWithTelemetry(
      join(root, "scan"),
      new Set(),
      { maxDepth: 0, maxFiles: 100, maxBytes: 1_000 },
    );
    assert.deepEqual(depthResult.files, []);
    assert.equal(depthResult.telemetry.truncated, true);
    assert.equal(depthResult.telemetry.truncationReason, "max-depth");

    await writeTextFile(
      join(root, "scan", ".gitignore"),
      ["ignored/**", "!ignored/keep.txt", ""].join("\n"),
    );
    await mkdir(join(root, "scan", "ignored"), { recursive: true });
    await writeTextFile(join(root, "scan", "ignored", "keep.txt"), "keep");
    const ignoredResult = await listFilesRecursiveWithTelemetry(
      join(root, "scan"),
      new Set(),
      { maxDepth: 5, maxFiles: 100, maxBytes: 1_000 },
    );
    assert.ok(
      ignoredResult.files.some((filePath) => filePath.endsWith("keep.txt")),
    );

    assert.equal(
      filesInternals.getErrorMessage("plain failure"),
      "plain failure",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("http residual branches cover guarded text defaults and pinned failures", async () => {
  assert.equal(
    await fetchTextWithGuards("https://example.com/path", {
      resolveHostname: async () => [{ address: "8.8.8.8", family: 4 }],
      timeoutMs: 100,
    }),
    null,
  );

  assert.equal(httpInternals.isPrivateIpv4Address("192.168.1.1"), true);
  assert.equal(httpInternals.isPrivateIpv4Address("8.8.8.8"), false);

  const restoreRequest = httpInternals.setHttpsRequestForTests((() => {
    const requestMessage = new EventEmitter() as EventEmitter & {
      write(chunk: unknown): void;
      end(): void;
    };
    requestMessage.write = () => undefined;
    requestMessage.end = () =>
      queueMicrotask(() => requestMessage.emit("error", "string-failure"));
    return requestMessage;
  }) as never);
  try {
    await assert.rejects(
      httpInternals.fetchWithPinnedResolution(
        new URL("https://example.com/path"),
        [{ address: "8.8.8.8", family: 4 } satisfies ResolvedHostnameAddress],
        {},
        100,
      ),
      /All resolved addresses failed for example\.com/u,
    );
  } finally {
    restoreRequest();
  }
});

void test("asset prerequisite diagnostics cover optional guidance and unknown OAuth", () => {
  const prerequisites = buildAssetPrerequisitesFromMetadata({
    providers: ["custom-provider", "github"],
    envVars: ["CUSTOM_TOKEN", "CUSTOM_TOKEN", ""],
    hostLogins: ["vscode", ""],
    oauthProviders: ["unknown-oauth"],
    setupUrl: "https://example.com/setup",
  });
  assert.deepEqual(
    prerequisites.map((prerequisite) => prerequisite.id),
    [
      "auth:custom-provider",
      "auth:github",
      "env:CUSTOM_TOKEN",
      "host-login:copilot-vscode",
      "oauth:unknown-oauth",
    ],
  );

  const asset = buildAsset("prereq-asset", {
    install: {
      method: "local-file",
      nativeHosts: ["copilot-vscode"],
      manifestEntry: "prereq-asset",
      prerequisites: [
        {
          id: "optional-manual",
          kind: "manual",
          required: false,
          description: "Read the setup notes",
        },
        {
          id: "host-unspecified",
          kind: "host-login",
          required: true,
          description: "Sign in somewhere",
        },
        {
          id: "oauth-unknown",
          kind: "oauth",
          required: true,
          provider: "unknown-oauth",
          description: "Authorize unknown provider",
        },
      ],
    },
  });

  const diagnostics = buildPrerequisiteDiagnostics(asset);
  assert.equal(diagnostics[0]?.severity, "info");
  assert.match(diagnostics[0]?.action ?? "", /Complete the provider setup/u);
  assert.equal(diagnostics[1]?.severity, "warning");
  assert.match(diagnostics[1]?.message ?? "", /signed-in host session/u);
  assert.equal(diagnostics[2]?.severity, "warning");
});

void test("preflight path checks report permission-style access failures", async () => {
  const diagnostic = await checkPathExists("\0invalid", "invalid-path");
  assert.equal(diagnostic.severity, "error");
  assert.equal(diagnostic.code, "invalid-path");
  assert.match(diagnostic.message, /Unable to access/u);
});

void test("mirror acquire residual pure helpers cover fallback and invalid states", async () => {
  assert.equal(
    mirrorAcquireInternals.restoreRefreshProcessedCount(
      buildAcquireState({
        sessionMode: "refresh",
        terminal: false,
        totalEligibleCount: 5,
        processedCount: Number.NaN,
      }),
      5,
    ),
    0,
  );
  assert.equal(
    mirrorAcquireInternals.restoreRefreshProcessedCount(
      buildAcquireState({
        sessionMode: "refresh",
        terminal: false,
        totalEligibleCount: 5,
        processedCount: 99,
      }),
      5,
    ),
    5,
  );
  assert.equal(
    mirrorAcquireInternals.restoreRefreshProcessedCount(
      buildAcquireState({
        sessionMode: "refresh",
        terminal: true,
        totalEligibleCount: 5,
        processedCount: 4,
      }),
      5,
    ),
    0,
  );

  const invalidGitHubTree = buildAsset("invalid-github-tree", {
    source: {
      sourceId: "unknown-github-source",
      authorityTier: "unverified-community",
      sourceKind: "repo",
      sourcePriority: 10,
      originUrl:
        "https://github.com/octo/example/blob/main/skills/example/SKILL.md",
      publisher: "Octo",
      publisherVerified: false,
    },
    install: {
      method: "github-tree-metadata",
      nativeHosts: ["copilot-vscode"],
      manifestEntry: "not-a-sha",
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: "different/SKILL.md",
      rootPath: "https://github.com/octo/example",
    },
  });
  assert.match(
    (
      await mirrorAcquireInternals.materializeGitHubTreeArtifact(
        invalidGitHubTree,
        false,
      )
    ).artifact?.content.toString("utf8") ?? "",
    /invalid-github-tree/u,
  );
  assert.deepEqual(
    await mirrorAcquireInternals.materializeGitHubTreeArtifact(
      invalidGitHubTree,
      true,
    ),
    { artifact: null },
  );
  assert.deepEqual(
    mirrorAcquireInternals.parseGitHubBlobEntry({
      ...invalidGitHubTree,
      source: {
        ...invalidGitHubTree.source,
        originUrl: "https://github.com//example/blob/main/SKILL.md",
      },
      evidence: { ...invalidGitHubTree.evidence, filePath: "SKILL.md" },
    }),
    null,
  );
});

void test("install bundle residual helpers keep path identity behavior explicit", () => {
  assert.equal(
    installBundleInternals.extractBundleId("C:/tmp/copilot-core.lock.json"),
    "copilot-core",
  );
  assert.deepEqual(
    installBundleInternals.getPendingAssets(
      [
        {
          assetId: "asset-a",
          mirrorId: "mirror-a",
          projectionType: "copy",
          activationEligible: true,
        },
        {
          assetId: "asset-b",
          mirrorId: "mirror-b",
          projectionType: "copy",
          activationEligible: true,
        },
      ],
      new Set(["asset-a:mirror-a"]),
    ),
    [
      {
        assetId: "asset-b",
        mirrorId: "mirror-b",
        projectionType: "copy",
        activationEligible: true,
      },
    ],
  );
});

void test("host adapter residual helpers cover duplicate snapshots and error formatting", async () => {
  const root = await mkdtempFixture("agent-harness-host-residual-");
  try {
    const workspaceRoot = join(root, "workspace");
    const managedRoot = join(workspaceRoot, ".cursor", "agent-harness");
    await mkdir(join(workspaceRoot, "empty", "child"), { recursive: true });
    await nativeWireInternals.removeEmptyParentDirectories(
      join(workspaceRoot, "empty", "child"),
      workspaceRoot,
    );
    assert.equal(await pathExists(join(workspaceRoot, "empty")), false);

    await mkdir(join(workspaceRoot, "non-empty", "child"), { recursive: true });
    await writeFile(join(workspaceRoot, "non-empty", "kept.txt"), "kept");
    await nativeWireInternals.removeEmptyParentDirectories(
      join(workspaceRoot, "non-empty", "child"),
      workspaceRoot,
    );
    assert.equal(await pathExists(join(workspaceRoot, "non-empty")), true);

    const duplicateSnapshotPlan = buildWirePlan(
      "cursor",
      workspaceRoot,
      managedRoot,
      [
        {
          path: join(workspaceRoot, "AGENTS.md").replaceAll("\\", "/"),
          content: null,
        },
        {
          path: join(workspaceRoot, "AGENTS.md").replaceAll("\\", "/"),
          content: "again",
        },
      ],
    );
    assert.throws(
      () =>
        nativeWireInternals.validateManagedTextFileSnapshots(
          duplicateSnapshotPlan,
          [join(workspaceRoot, "AGENTS.md")],
          join(managedRoot, "wire-plan.json"),
        ),
      /duplicate textFileSnapshots/u,
    );

    const errorWithoutStack = new Error("no stack");
    errorWithoutStack.stack = undefined;
    assert.equal(
      nativeWireInternals.toLoggableErrorMessage(errorWithoutStack),
      "Error: no stack",
    );
    assert.equal(
      vscodeWireInternals.toLoggableErrorMessage(errorWithoutStack),
      "Error: no stack",
    );
    assert.equal(
      openCodeWireInternals.toLoggableErrorMessage(errorWithoutStack),
      "Error: no stack",
    );

    assert.equal(
      vscodeWireInternals.inferPluginFileName({
        content: "plain text",
        sourcePath: join(root, "plugin.yaml"),
      }),
      "plugin.yaml",
    );

    const agentsPath = join(root, "AGENTS.md");
    await writeTextFile(
      agentsPath,
      [
        "before",
        "<!-- agent-harness:begin -->",
        "managed",
        "<!-- agent-harness:end -->",
        "after",
        "",
      ].join("\n"),
    );
    await openCodeWireInternals.restoreManagedTextFileSnapshot(
      agentsPath,
      undefined,
    );
    assert.equal(await readTextFileOrNull(agentsPath), "before\nafter\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function mkdtempFixture(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function buildAcquireState(
  overrides: Partial<MirrorAcquireState> = {},
): MirrorAcquireState {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    batchSize: 10,
    totalEligibleCount: 0,
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

function buildWirePlan(
  host: NativeWireHost,
  workspaceRoot: string,
  runtimeRoot: string,
  textFileSnapshots: WirePlanManifest["textFileSnapshots"],
): WirePlanManifest {
  return {
    schemaVersion: 1,
    host,
    generatedAt: new Date().toISOString(),
    workspaceRoot,
    runtimeRoot,
    textFileSnapshots,
    notes: [],
  };
}

function buildAsset(
  id: string,
  overrides: Partial<AssetCatalogEntry> = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: "skill",
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId: "fixture-source",
      authorityTier: "official-first-party",
      sourceKind: "docs",
      sourcePriority: 100,
      originUrl: `https://example.com/${id}`,
      publisher: "Fixture",
      publisherVerified: true,
    },
    trust: { score: 100, signals: [] },
    capabilities: ["fixture"],
    install: {
      method: "local-file",
      nativeHosts: ["copilot-vscode"],
      manifestEntry: id,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: `${id}.md`,
      rootPath: "/fixture",
    },
    maintenance: {
      lastUpdated: "2026-01-01T00:00:00.000Z",
      stars: 0,
      releaseCadence: "active",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: { sizeClass: "tiny", estimatedPromptWeight: 1 },
    fit: { portfolioFit: 0.8, hostFit: 0.9 },
    dedupe: { candidateRankHint: "fixture" },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
    ...overrides,
  };
}
