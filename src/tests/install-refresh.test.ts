import assert from "node:assert/strict";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createContentHash,
  pathExists,
  readJsonFile,
  writeJsonFile,
  writeJsonLinesFile,
  writeTextFile,
} from "../files.js";
import { clearRuntimeConfigForTests } from "../config/runtime.js";
import {
  installRefreshInternals,
  manageInstallRefresh,
} from "../install/refresh.js";
import {
  INSTALL_REFRESH_REPORT_OUTPUT_PATH,
  INSTALL_REFRESH_STATE_OUTPUT_PATH,
  NATIVE_INSTALL_STATE_OUTPUT_PATH,
} from "../install/paths.js";
import {
  assertInstallRefreshReport,
  assertInstallRefreshState,
} from "../manifest-validation.js";
import { sanitizeMirrorId } from "../mirror/paths.js";
import type {
  AssetCatalogEntry,
  BundleLock,
  InstallGenerationManifest,
  InstallRefreshReport,
  InstallRefreshState,
  InstalledBundleManifest,
  InstalledPackageManifest,
  MirrorIndexEntry,
} from "../types.js";

void test("install refresh reports stale assets when bundle locks move to a new mirror", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-refresh-"),
  );

  try {
    const installManifestPath = join(
      projectRoot,
      "install",
      "copilot-vscode",
      "packages",
      "flutter-skill",
      "install-manifest.json",
    );
    const installManifest: InstalledPackageManifest = {
      schemaVersion: 1,
      assetId: "flutter-skill",
      mirrorId: "sha256-old",
      host: "copilot-vscode",
      installedAt: new Date().toISOString(),
      projectionType: "native-skill",
      assetKind: "skill",
      sourceAuthorityTier: "trusted-community",
      contextCost: {
        sizeClass: "small",
        estimatedPromptWeight: 2,
      },
      portfolioFit: 0.9,
      filesRoot: join(
        projectRoot,
        "install",
        "copilot-vscode",
        "packages",
        "flutter-skill",
        "files",
      ),
      bundleMembership: ["copilot-core"],
      activationEligible: true,
      activeByDefault: false,
      upstream: {
        mirrorId: "sha256-old",
        mirroredAt: new Date(0).toISOString(),
        sourceId: "vscode-marketplace",
        sourceOriginUrl:
          "https://marketplace.visualstudio.com/items?itemName=pub.flutter-skill",
        sourceLastUpdated: new Date(0).toISOString(),
        upstream: {
          type: "marketplace",
          url: "https://marketplace.visualstudio.com/items?itemName=pub.flutter-skill",
          version: "1.0.0",
        },
      },
      nativeInstall: {
        extensionId: "pub.flutter-skill",
      },
    };
    const currentGeneration: InstallGenerationManifest = {
      schemaVersion: 1,
      generationId: "current-gen",
      host: "copilot-vscode",
      generatedAt: new Date().toISOString(),
      bundleIds: ["copilot-core"],
      packageManifestPaths: [installManifestPath],
    };
    const latestBundleLock: BundleLock = {
      schemaVersion: 1,
      bundleId: "copilot-core",
      generatedAt: new Date().toISOString(),
      host: "copilot-vscode",
      assets: [
        {
          assetId: "flutter-skill",
          mirrorId: "sha256-new",
          projectionType: "native-skill",
          activationEligible: true,
        },
      ],
    };
    const latestMirrorIndex: MirrorIndexEntry = {
      mirrorId: "sha256-new",
      assetId: "flutter-skill",
      upstream: {
        type: "marketplace",
        url: "https://marketplace.visualstudio.com/items?itemName=pub.flutter-skill",
        version: "1.1.0",
      },
      source: {
        authorityTier: "trusted-community",
        publisher: "fixture",
        publisherVerified: true,
      },
      mirroredAt: new Date().toISOString(),
      contentHash: "hash-new",
      projectionCandidates: [
        {
          host: "copilot-vscode",
          projectionType: "native-skill",
        },
      ],
      status: "approved",
    };
    const latestAsset: AssetCatalogEntry = {
      id: "flutter-skill",
      displayName: "Flutter Skill",
      assetKind: "skill",
      hosts: ["copilot-vscode"],
      compatibilityMode: "native",
      source: {
        sourceId: "vscode-marketplace",
        authorityTier: "trusted-community",
        sourceKind: "marketplace",
        sourcePriority: 90,
        originUrl:
          "https://marketplace.visualstudio.com/items?itemName=pub.flutter-skill",
        publisher: "fixture",
        publisherVerified: true,
      },
      trust: {
        score: 80,
        signals: ["fixture"],
      },
      capabilities: ["flutter", "mobile"],
      install: {
        method: "vscode-extension",
        nativeHosts: ["copilot-vscode"],
        manifestEntry: "pub.flutter-skill",
      },
      evidence: {
        manifestFound: true,
        readmeFound: true,
        examplesFound: false,
        docsLinked: true,
        filePath: "README.md",
      },
      maintenance: {
        lastUpdated: new Date().toISOString(),
        stars: 0,
        releaseCadence: "active",
      },
      risk: {
        level: "low",
        hasHooks: false,
        hasExecScripts: false,
        requiresNetwork: false,
      },
      contextCost: {
        sizeClass: "small",
        estimatedPromptWeight: 2,
      },
      fit: {
        portfolioFit: 0.9,
        hostFit: 0.9,
      },
      dedupe: {
        candidateRankHint: "fixture",
      },
      status: {
        cataloged: true,
        mirrorEligible: true,
        installEligible: true,
        activationEligible: true,
      },
    };

    await writeJsonFile(installManifestPath, installManifest);
    await writeJsonFile(
      join(
        projectRoot,
        "install",
        "generations",
        "copilot-vscode",
        "current.json",
      ),
      currentGeneration,
    );
    await writeJsonFile(
      join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
      latestBundleLock,
    );
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      latestMirrorIndex,
    ]);
    await writeJsonFile(
      join(
        projectRoot,
        "mirror",
        "raw",
        sanitizeMirrorId("sha256-new"),
        "asset.json",
      ),
      latestAsset,
    );

    await manageInstallRefresh(projectRoot, projectRoot, [
      "--host",
      "copilot-vscode",
      "--no-mirror-refresh",
    ]);

    const report = await readJsonFile<InstallRefreshReport>(
      join(projectRoot, ...INSTALL_REFRESH_REPORT_OUTPUT_PATH),
      assertInstallRefreshReport,
    );
    const refreshState = await readJsonFile<InstallRefreshState>(
      join(projectRoot, ...INSTALL_REFRESH_STATE_OUTPUT_PATH),
      assertInstallRefreshState,
    );
    const hostReport = report.hosts.find(
      (host) => host.host === "copilot-vscode",
    );
    const assetReport = hostReport?.assets.find(
      (asset) => asset.assetId === "flutter-skill",
    );

    assert.equal(hostReport?.staleCount, 1);
    assert.equal(assetReport?.status, "stale");
    assert.equal(assetReport?.latestMirrorId, "sha256-new");
    assert.equal(assetReport?.nativeInstall?.extensionId, "pub.flutter-skill");
    assert.equal(assetReport?.refreshTier, "auto-report-only");
    assert.equal(assetReport?.policyDecision, "plan");
    assert.match(assetReport?.policyReason ?? "", /Report-only policy/u);
    assert.equal(refreshState.policy, "report-only");
    assert.equal(refreshState.staleCount, 1);
    assert.equal(refreshState.stageEligibleCount, 0);
    assert.equal(refreshState.applyEligibleCount, 0);
    assert.equal(refreshState.reviewRequiredCount, 0);
    assert.equal(refreshState.quarantinedCount, 0);
    assert.ok(
      Date.parse(refreshState.nextCheckAt) > Date.parse(refreshState.updatedAt),
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("install refresh blocks assets when bundle locks disagree on mirror identity", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-refresh-"),
  );

  try {
    const installManifestPath = join(
      projectRoot,
      "install",
      "copilot-vscode",
      "packages",
      "flutter-skill",
      "install-manifest.json",
    );
    await writeJsonFile(installManifestPath, {
      schemaVersion: 1,
      assetId: "flutter-skill",
      mirrorId: "sha256-old",
      host: "copilot-vscode",
      installedAt: new Date().toISOString(),
      projectionType: "native-skill",
      assetKind: "skill",
      sourceAuthorityTier: "trusted-community",
      contextCost: {
        sizeClass: "small",
        estimatedPromptWeight: 2,
      },
      portfolioFit: 0.9,
      filesRoot: join(
        projectRoot,
        "install",
        "copilot-vscode",
        "packages",
        "flutter-skill",
        "files",
      ),
      bundleMembership: ["copilot-core"],
      activationEligible: true,
      activeByDefault: false,
    } satisfies InstalledPackageManifest);
    await writeJsonFile(
      join(
        projectRoot,
        "install",
        "generations",
        "copilot-vscode",
        "current.json",
      ),
      {
        schemaVersion: 1,
        generationId: "current-gen",
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        bundleIds: ["copilot-core", "shared-mcp"],
        packageManifestPaths: [installManifestPath],
      } satisfies InstallGenerationManifest,
    );
    await writeJsonFile(
      join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
      {
        schemaVersion: 1,
        bundleId: "copilot-core",
        generatedAt: new Date().toISOString(),
        host: "copilot-vscode",
        assets: [
          {
            assetId: "flutter-skill",
            mirrorId: "sha256-new-a",
            projectionType: "native-skill",
            activationEligible: true,
          },
        ],
      } satisfies BundleLock,
    );
    await writeJsonFile(
      join(projectRoot, "mirror", "bundles", "shared-mcp.lock.json"),
      {
        schemaVersion: 1,
        bundleId: "shared-mcp",
        generatedAt: new Date().toISOString(),
        host: "copilot-vscode",
        assets: [
          {
            assetId: "flutter-skill",
            mirrorId: "sha256-new-b",
            projectionType: "native-skill",
            activationEligible: true,
          },
        ],
      } satisfies BundleLock,
    );

    await manageInstallRefresh(projectRoot, projectRoot, [
      "--host",
      "copilot-vscode",
      "--no-mirror-refresh",
    ]);

    const report = await readJsonFile<InstallRefreshReport>(
      join(projectRoot, ...INSTALL_REFRESH_REPORT_OUTPUT_PATH),
      assertInstallRefreshReport,
    );
    const hostReport = report.hosts.find(
      (host) => host.host === "copilot-vscode",
    );
    const assetReport = hostReport?.assets.find(
      (asset) => asset.assetId === "flutter-skill",
    );

    assert.equal(hostReport?.blockedCount, 1);
    assert.equal(assetReport?.status, "blocked");
    assert.equal(assetReport?.latestMirrorId, undefined);
    assert.equal(assetReport?.refreshTier, "review-required");
    assert.equal(assetReport?.policyDecision, "review-required");
    assert.match(assetReport?.reason ?? "", /conflicting bundle lock mirrors/u);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("install refresh due-only skips runs before the next scheduled check", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-refresh-"),
  );
  const refreshStatePath = join(
    projectRoot,
    ...INSTALL_REFRESH_STATE_OUTPUT_PATH,
  );
  const reportPath = join(projectRoot, ...INSTALL_REFRESH_REPORT_OUTPUT_PATH);
  const futureNextCheckAt = new Date(Date.now() + 60_000).toISOString();
  const initialUpdatedAt = new Date().toISOString();

  try {
    await writeJsonFile(refreshStatePath, {
      schemaVersion: 1,
      updatedAt: initialUpdatedAt,
      policy: "report-only",
      intervalMs: 21_600_000,
      nextCheckAt: futureNextCheckAt,
      refreshedMirrorState: false,
      staleCount: 0,
      stageEligibleCount: 0,
      applyEligibleCount: 0,
      reviewRequiredCount: 0,
      quarantinedCount: 0,
    } satisfies InstallRefreshState);

    const originalRefreshState = await readJsonFile<InstallRefreshState>(
      refreshStatePath,
      assertInstallRefreshState,
    );

    await manageInstallRefresh(projectRoot, projectRoot, ["--due-only"]);

    assert.equal(await pathExists(reportPath), false);
    const refreshState = await readJsonFile<InstallRefreshState>(
      refreshStatePath,
      assertInstallRefreshState,
    );
    assert.equal(originalRefreshState.updatedAt, initialUpdatedAt);
    assert.equal(refreshState.updatedAt, initialUpdatedAt);
    assert.equal(refreshState.nextCheckAt, futureNextCheckAt);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

async function writeMirrorArtifact(
  projectRoot: string,
  mirrorId: string,
  entry: AssetCatalogEntry,
): Promise<string> {
  const rawRoot = join(
    projectRoot,
    "mirror",
    "raw",
    sanitizeMirrorId(mirrorId),
  );
  const files = [
    {
      relativePath: "content.txt",
      content: `fixture:${entry.id}\n`,
    },
    {
      relativePath: "asset.json",
      content: `${JSON.stringify(entry, null, 2)}\n`,
    },
  ].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const manifestFiles = files.map((file) => ({
    relativePath: file.relativePath,
    sha256: createContentHash(file.content),
    sizeBytes: Buffer.byteLength(file.content),
  }));
  const aggregateHash = createContentHash(
    manifestFiles
      .map((file) =>
        [file.relativePath, file.sha256, String(file.sizeBytes), ""].join("\0"),
      )
      .join("\n"),
  );

  for (const file of files) {
    await writeTextFile(join(rawRoot, file.relativePath), file.content);
  }
  await writeJsonFile(join(rawRoot, "manifest.json"), {
    schemaVersion: 1,
    aggregateHash,
    files: manifestFiles,
  });

  return aggregateHash;
}

async function createFakeCodeCli(tempRoot: string): Promise<{
  binDir: string;
  statePath: string;
}> {
  const binDir = join(tempRoot, "fake-code-bin");
  const statePath = join(tempRoot, "fake-code-state.json");
  await writeTextFile(
    join(binDir, "fake-code.mjs"),
    [
      'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
      "const statePath = process.env.AGENT_HARNESS_FAKE_CODE_STATE;",
      "const args = process.argv.slice(2);",
      "const readState = () =>",
      "  statePath && existsSync(statePath)",
      '    ? JSON.parse(readFileSync(statePath, "utf8"))',
      "    : [];",
      "const writeState = (ids) => {",
      '  if (statePath) writeFileSync(statePath, JSON.stringify(ids), "utf8");',
      "};",
      "let installed = readState();",
      'if (args[0] === "--version") { console.log("1.0.0"); process.exit(0); }',
      'if (args[0] === "--list-extensions") {',
      '  if (installed.length > 0) console.log(installed.map((id) => `${id}@1.0.0`).join("\\n"));',
      "  process.exit(0);",
      "}",
      'if (args[0] === "--install-extension") {',
      "  const extensionId = args[1];",
      "  installed = [...new Set([...installed, extensionId])].sort();",
      "  writeState(installed);",
      "  console.log(`installed ${extensionId}`);",
      "  process.exit(0);",
      "}",
      'console.error(`unsupported args: ${args.join(" ")}`);',
      "process.exit(1);",
      "",
    ].join("\n"),
  );
  const codePath = join(binDir, "code");
  await writeTextFile(
    codePath,
    `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-code.mjs" "$@"\n`,
  );
  await chmod(codePath, 0o755);
  await writeTextFile(
    join(binDir, "code.cmd"),
    `@echo off\r\n"${process.execPath}" "%~dp0fake-code.mjs" %*\r\n`,
  );

  return { binDir, statePath };
}

void test("install refresh honors report-only and pinned policies", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-refresh-"),
  );
  const originalPolicy = process.env.AGENT_HARNESS_INSTALL_REFRESH_POLICY;
  const installManifestPath = join(
    projectRoot,
    "install",
    "copilot-vscode",
    "packages",
    "flutter-skill",
    "install-manifest.json",
  );

  try {
    process.env.AGENT_HARNESS_INSTALL_REFRESH_POLICY = "report-only";
    clearRuntimeConfigForTests();

    await writeJsonFile(installManifestPath, {
      schemaVersion: 1,
      assetId: "flutter-skill",
      mirrorId: "sha256-old",
      host: "copilot-vscode",
      installedAt: new Date().toISOString(),
      projectionType: "native-skill",
      assetKind: "skill",
      sourceAuthorityTier: "trusted-community",
      contextCost: {
        sizeClass: "small",
        estimatedPromptWeight: 2,
      },
      portfolioFit: 0.9,
      filesRoot: join(
        projectRoot,
        "install",
        "copilot-vscode",
        "packages",
        "flutter-skill",
        "files",
      ),
      bundleMembership: ["copilot-core"],
      activationEligible: true,
      activeByDefault: false,
      upstream: {
        mirrorId: "sha256-old",
        mirroredAt: new Date(0).toISOString(),
        sourceId: "fixture-source",
        sourceOriginUrl: "https://example.com/flutter-skill",
        sourceLastUpdated: new Date(0).toISOString(),
        upstream: { type: "docs", url: "https://example.com/flutter-skill" },
      },
    } satisfies InstalledPackageManifest);
    await writeJsonFile(
      join(
        projectRoot,
        "install",
        "generations",
        "copilot-vscode",
        "current.json",
      ),
      {
        schemaVersion: 1,
        generationId: "current-gen",
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        bundleIds: ["copilot-core"],
        packageManifestPaths: [installManifestPath],
        pinned: true,
      } satisfies InstallGenerationManifest,
    );
    await writeJsonFile(
      join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
      {
        schemaVersion: 1,
        bundleId: "copilot-core",
        generatedAt: new Date().toISOString(),
        host: "copilot-vscode",
        assets: [
          {
            assetId: "flutter-skill",
            mirrorId: "sha256-new",
            projectionType: "native-skill",
            activationEligible: true,
          },
        ],
      } satisfies BundleLock,
    );
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      {
        mirrorId: "sha256-new",
        assetId: "flutter-skill",
        upstream: { type: "docs", url: "https://example.com/flutter-skill" },
        source: {
          authorityTier: "trusted-community",
          publisher: "fixture",
          publisherVerified: true,
        },
        mirroredAt: new Date().toISOString(),
        contentHash: "hash-new",
        projectionCandidates: [
          { host: "copilot-vscode", projectionType: "native-skill" },
        ],
        status: "approved",
      } satisfies MirrorIndexEntry,
    ]);

    await manageInstallRefresh(projectRoot, projectRoot, [
      "--host",
      "copilot-vscode",
      "--no-mirror-refresh",
    ]);

    const pinnedReport = await readJsonFile<InstallRefreshReport>(
      join(projectRoot, ...INSTALL_REFRESH_REPORT_OUTPUT_PATH),
      assertInstallRefreshReport,
    );
    const pinnedAsset = pinnedReport.hosts[0]?.assets[0];
    assert.equal(pinnedAsset?.status, "pinned");
    assert.equal(pinnedAsset?.policyDecision, "ignore");
    assert.equal(pinnedAsset?.refreshTier, "auto-report-only");

    await writeJsonFile(
      join(
        projectRoot,
        "install",
        "generations",
        "copilot-vscode",
        "current.json",
      ),
      {
        schemaVersion: 1,
        generationId: "current-gen",
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        bundleIds: ["copilot-core"],
        packageManifestPaths: [installManifestPath],
      } satisfies InstallGenerationManifest,
    );

    await manageInstallRefresh(projectRoot, projectRoot, [
      "--host",
      "copilot-vscode",
      "--no-mirror-refresh",
    ]);

    const reportOnlyReport = await readJsonFile<InstallRefreshReport>(
      join(projectRoot, ...INSTALL_REFRESH_REPORT_OUTPUT_PATH),
      assertInstallRefreshReport,
    );
    const reportOnlyAsset = reportOnlyReport.hosts[0]?.assets[0];
    assert.equal(reportOnlyAsset?.status, "stale");
    assert.equal(reportOnlyAsset?.policyDecision, "plan");
    assert.equal(reportOnlyAsset?.refreshTier, "auto-report-only");
  } finally {
    if (originalPolicy === undefined) {
      delete process.env.AGENT_HARNESS_INSTALL_REFRESH_POLICY;
    } else {
      process.env.AGENT_HARNESS_INSTALL_REFRESH_POLICY = originalPolicy;
    }
    clearRuntimeConfigForTests();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("install refresh apply-safe applies low-risk stale updates", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-refresh-apply-"),
  );
  const originalPolicy = process.env.AGENT_HARNESS_INSTALL_REFRESH_POLICY;
  const originalPath = process.env.PATH;
  const originalStatePath = process.env.AGENT_HARNESS_FAKE_CODE_STATE;
  const installManifestPath = join(
    projectRoot,
    "install",
    "copilot-vscode",
    "packages",
    "safe-skill",
    "install-manifest.json",
  );

  try {
    process.env.AGENT_HARNESS_INSTALL_REFRESH_POLICY = "apply-safe";
    clearRuntimeConfigForTests();
    const { binDir, statePath } = await createFakeCodeCli(projectRoot);
    process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${originalPath ?? ""}`;
    process.env.AGENT_HARNESS_FAKE_CODE_STATE = statePath;

    const latestAsset = buildRefreshAsset("safe-skill", {
      authorityTier: "official-first-party",
      publisherVerified: true,
      activationEligible: false,
    });
    const latestMirrorId = "sha256-safe-new";
    const latestHash = await writeMirrorArtifact(
      projectRoot,
      latestMirrorId,
      latestAsset,
    );

    await seedRefreshInstallState({
      projectRoot,
      assetId: "safe-skill",
      assetKind: "skill",
      sourceAuthorityTier: "official-first-party",
      oldMirrorId: "sha256-safe-old",
      latestMirrorId,
      installManifestPath,
      activationEligible: false,
    });
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      buildRefreshMirrorIndex("safe-skill", latestMirrorId, latestHash, {
        authorityTier: "official-first-party",
      }),
    ]);

    await manageInstallRefresh(projectRoot, projectRoot, [
      "--host",
      "copilot-vscode",
      "--apply",
      "--no-mirror-refresh",
    ]);

    const refreshState = await readJsonFile<InstallRefreshState>(
      join(projectRoot, ...INSTALL_REFRESH_STATE_OUTPUT_PATH),
      assertInstallRefreshState,
    );
    assert.equal(refreshState.lastAppliedAt, refreshState.updatedAt);
    assert.equal(refreshState.applyEligibleCount, 1);
    const report = await readJsonFile<InstallRefreshReport>(
      join(projectRoot, ...INSTALL_REFRESH_REPORT_OUTPUT_PATH),
      assertInstallRefreshReport,
    );
    assert.equal(report.hosts[0]?.assets[0]?.status, "stale");
    assert.equal(report.hosts[0]?.assets[0]?.policyDecision, "apply");
    assert.equal(report.hosts[0]?.assets[0]?.lastRefreshAction, "refreshed");
  } finally {
    if (originalPolicy === undefined) {
      delete process.env.AGENT_HARNESS_INSTALL_REFRESH_POLICY;
    } else {
      process.env.AGENT_HARNESS_INSTALL_REFRESH_POLICY = originalPolicy;
    }
    if (originalStatePath === undefined) {
      delete process.env.AGENT_HARNESS_FAKE_CODE_STATE;
    } else {
      process.env.AGENT_HARNESS_FAKE_CODE_STATE = originalStatePath;
    }
    process.env.PATH = originalPath;
    clearRuntimeConfigForTests();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("install refresh apply-safe applies safe assets when mixed with quarantined assets", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-refresh-mixed-"),
  );
  const originalPolicy = process.env.AGENT_HARNESS_INSTALL_REFRESH_POLICY;
  const safeManifestPath = join(
    projectRoot,
    "install",
    "copilot-vscode",
    "packages",
    "safe-skill",
    "install-manifest.json",
  );
  const quarantinedManifestPath = join(
    projectRoot,
    "install",
    "copilot-vscode",
    "packages",
    "quarantined-skill",
    "install-manifest.json",
  );

  try {
    process.env.AGENT_HARNESS_INSTALL_REFRESH_POLICY = "apply-safe";
    clearRuntimeConfigForTests();

    // Safe asset: official-first-party, low-risk — eligible for apply.
    const safeAsset = buildRefreshAsset("safe-skill", {
      authorityTier: "official-first-party",
      publisherVerified: true,
      activationEligible: false,
    });
    const safeLatestMirrorId = "sha256-safe-new";
    const safeHash = await writeMirrorArtifact(
      projectRoot,
      safeLatestMirrorId,
      safeAsset,
    );

    // Quarantined asset: latest mirror is quarantined — ineligible for apply.
    const quarantinedAsset = buildRefreshAsset("quarantined-skill", {
      authorityTier: "official-first-party",
      publisherVerified: true,
      activationEligible: false,
    });
    const quarantinedMirrorId = "sha256-quarantined-new";
    const quarantinedHash = await writeMirrorArtifact(
      projectRoot,
      quarantinedMirrorId,
      quarantinedAsset,
    );

    // Seed safe asset install state.
    await writeJsonFile(safeManifestPath, {
      schemaVersion: 1,
      assetId: "safe-skill",
      mirrorId: "sha256-safe-old",
      host: "copilot-vscode",
      installedAt: new Date().toISOString(),
      projectionType: "native-skill",
      assetKind: "skill",
      sourceAuthorityTier: "official-first-party",
      contextCost: { sizeClass: "small", estimatedPromptWeight: 2 },
      portfolioFit: 0.9,
      filesRoot: join(
        projectRoot,
        "install",
        "copilot-vscode",
        "packages",
        "safe-skill",
        "files",
      ),
      bundleMembership: ["copilot-core"],
      activationEligible: false,
      activeByDefault: false,
      upstream: {
        mirrorId: "sha256-safe-old",
        mirroredAt: new Date(0).toISOString(),
        sourceId: "fixture-source",
        sourceOriginUrl: "https://example.com/safe-skill",
        sourceLastUpdated: new Date(0).toISOString(),
        upstream: { type: "docs", url: "https://example.com/safe-skill" },
      },
    } satisfies InstalledPackageManifest);

    // Seed quarantined asset install state.
    await writeJsonFile(quarantinedManifestPath, {
      schemaVersion: 1,
      assetId: "quarantined-skill",
      mirrorId: "sha256-quarantined-old",
      host: "copilot-vscode",
      installedAt: new Date().toISOString(),
      projectionType: "native-skill",
      assetKind: "skill",
      sourceAuthorityTier: "official-first-party",
      contextCost: { sizeClass: "small", estimatedPromptWeight: 2 },
      portfolioFit: 0.9,
      filesRoot: join(
        projectRoot,
        "install",
        "copilot-vscode",
        "packages",
        "quarantined-skill",
        "files",
      ),
      bundleMembership: ["copilot-core"],
      activationEligible: false,
      activeByDefault: false,
      upstream: {
        mirrorId: "sha256-quarantined-old",
        mirroredAt: new Date(0).toISOString(),
        sourceId: "fixture-source",
        sourceOriginUrl: "https://example.com/quarantined-skill",
        sourceLastUpdated: new Date(0).toISOString(),
        upstream: {
          type: "docs",
          url: "https://example.com/quarantined-skill",
        },
      },
    } satisfies InstalledPackageManifest);

    // Both assets share one bundle, so one bundle install handles both.
    await writeJsonFile(
      join(
        projectRoot,
        "install",
        "copilot-vscode",
        "bundles",
        "copilot-core.install.json",
      ),
      {
        schemaVersion: 1,
        bundleId: "copilot-core",
        host: "copilot-vscode",
        installedAt: new Date().toISOString(),
        packages: [
          {
            assetId: "safe-skill",
            mirrorId: "sha256-safe-old",
            manifestPath: safeManifestPath.replace(/\\/gu, "/"),
          },
          {
            assetId: "quarantined-skill",
            mirrorId: "sha256-quarantined-old",
            manifestPath: quarantinedManifestPath.replace(/\\/gu, "/"),
          },
        ],
      } satisfies InstalledBundleManifest,
    );
    await writeJsonFile(
      join(
        projectRoot,
        "install",
        "generations",
        "copilot-vscode",
        "current.json",
      ),
      {
        schemaVersion: 1,
        generationId: "current-gen",
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        bundleIds: ["copilot-core"],
        packageManifestPaths: [safeManifestPath, quarantinedManifestPath],
      } satisfies InstallGenerationManifest,
    );
    await writeJsonFile(
      join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
      {
        schemaVersion: 1,
        bundleId: "copilot-core",
        generatedAt: new Date().toISOString(),
        host: "copilot-vscode",
        assets: [
          {
            assetId: "safe-skill",
            mirrorId: safeLatestMirrorId,
            projectionType: "native-skill",
            activationEligible: false,
          },
          {
            assetId: "quarantined-skill",
            mirrorId: quarantinedMirrorId,
            projectionType: "native-skill",
            activationEligible: false,
          },
        ],
      } satisfies BundleLock,
    );
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      buildRefreshMirrorIndex("safe-skill", safeLatestMirrorId, safeHash, {
        authorityTier: "official-first-party",
      }),
      buildRefreshMirrorIndex(
        "quarantined-skill",
        quarantinedMirrorId,
        quarantinedHash,
        { authorityTier: "official-first-party", status: "quarantined" },
      ),
    ]);
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [safeAsset, quarantinedAsset],
    );

    await manageInstallRefresh(projectRoot, projectRoot, [
      "--host",
      "copilot-vscode",
      "--apply",
      "--no-mirror-refresh",
    ]);

    const report = await readJsonFile<InstallRefreshReport>(
      join(projectRoot, ...INSTALL_REFRESH_REPORT_OUTPUT_PATH),
      assertInstallRefreshReport,
    );
    const refreshState = await readJsonFile<InstallRefreshState>(
      join(projectRoot, ...INSTALL_REFRESH_STATE_OUTPUT_PATH),
      assertInstallRefreshState,
    );

    const assets = report.hosts[0]?.assets ?? [];
    const safeReport = assets.find((a) => a.assetId === "safe-skill");
    const quarantinedReport = assets.find(
      (a) => a.assetId === "quarantined-skill",
    );

    // Safe asset must be refreshed despite the quarantined peer.
    assert.equal(safeReport?.policyDecision, "apply");
    assert.equal(safeReport?.lastRefreshAction, "refreshed");

    // Quarantined asset must be blocked and left unrefreshed.
    assert.equal(quarantinedReport?.policyDecision, "blocked-quarantined");
    assert.equal(quarantinedReport?.lastRefreshAction, "skipped");

    // Apply ran, so lastAppliedAt must be set.
    assert.notEqual(refreshState.lastAppliedAt, undefined);
    assert.equal(refreshState.applyEligibleCount, 1);
    assert.equal(refreshState.quarantinedCount, 1);
  } finally {
    if (originalPolicy === undefined) {
      delete process.env.AGENT_HARNESS_INSTALL_REFRESH_POLICY;
    } else {
      process.env.AGENT_HARNESS_INSTALL_REFRESH_POLICY = originalPolicy;
    }
    clearRuntimeConfigForTests();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("install refresh apply-safe blocks community executable refreshes", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-refresh-"),
  );
  const originalPolicy = process.env.AGENT_HARNESS_INSTALL_REFRESH_POLICY;
  const originalPath = process.env.PATH;
  const originalStatePath = process.env.AGENT_HARNESS_FAKE_CODE_STATE;
  const installManifestPath = join(
    projectRoot,
    "install",
    "copilot-vscode",
    "packages",
    "flutter-skill",
    "install-manifest.json",
  );
  const bundleManifestPath = join(
    projectRoot,
    "install",
    "copilot-vscode",
    "bundles",
    "copilot-core.install.json",
  );

  try {
    process.env.AGENT_HARNESS_INSTALL_REFRESH_POLICY = "apply-safe";
    clearRuntimeConfigForTests();
    const { binDir, statePath } = await createFakeCodeCli(projectRoot);
    process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${originalPath ?? ""}`;
    process.env.AGENT_HARNESS_FAKE_CODE_STATE = statePath;

    const latestAsset: AssetCatalogEntry = {
      id: "flutter-skill",
      displayName: "Flutter Skill",
      assetKind: "extension",
      hosts: ["copilot-vscode"],
      compatibilityMode: "native",
      source: {
        sourceId: "fixture-source",
        authorityTier: "trusted-community",
        sourceKind: "marketplace",
        sourcePriority: 90,
        originUrl: "https://example.com/flutter-skill",
        publisher: "fixture",
        publisherVerified: true,
      },
      trust: {
        score: 80,
        signals: ["fixture"],
      },
      capabilities: ["flutter"],
      install: {
        method: "vscode-extension",
        nativeHosts: ["copilot-vscode"],
        manifestEntry: "pub.flutter-skill",
      },
      evidence: {
        manifestFound: true,
        readmeFound: true,
        examplesFound: false,
        docsLinked: true,
        filePath: "README.md",
      },
      maintenance: {
        lastUpdated: new Date().toISOString(),
        stars: 0,
        releaseCadence: "active",
      },
      risk: {
        level: "low",
        hasHooks: false,
        hasExecScripts: false,
        requiresNetwork: false,
      },
      contextCost: {
        sizeClass: "small",
        estimatedPromptWeight: 2,
      },
      fit: {
        portfolioFit: 0.9,
        hostFit: 0.9,
      },
      dedupe: {
        candidateRankHint: "fixture",
      },
      status: {
        cataloged: true,
        mirrorEligible: true,
        installEligible: true,
        activationEligible: true,
      },
    };
    const latestMirrorId = "sha256-new";
    const latestHash = await writeMirrorArtifact(
      projectRoot,
      latestMirrorId,
      latestAsset,
    );

    await writeJsonFile(installManifestPath, {
      schemaVersion: 1,
      assetId: "flutter-skill",
      mirrorId: "sha256-old",
      host: "copilot-vscode",
      installedAt: new Date().toISOString(),
      projectionType: "native-extension",
      assetKind: "extension",
      sourceAuthorityTier: "trusted-community",
      contextCost: {
        sizeClass: "small",
        estimatedPromptWeight: 2,
      },
      portfolioFit: 0.9,
      filesRoot: join(
        projectRoot,
        "install",
        "copilot-vscode",
        "packages",
        "flutter-skill",
        "files",
      ),
      bundleMembership: ["copilot-core"],
      activationEligible: true,
      activeByDefault: false,
      upstream: {
        mirrorId: "sha256-old",
        mirroredAt: new Date(0).toISOString(),
        sourceId: "fixture-source",
        sourceOriginUrl: "https://example.com/flutter-skill",
        sourceLastUpdated: new Date(0).toISOString(),
        upstream: {
          type: "marketplace",
          url: "https://example.com/flutter-skill",
          version: "1.0.0",
        },
      },
      nativeInstall: {
        extensionId: "pub.flutter-skill",
      },
    } satisfies InstalledPackageManifest);
    await writeJsonFile(bundleManifestPath, {
      schemaVersion: 1,
      bundleId: "copilot-core",
      host: "copilot-vscode",
      installedAt: new Date().toISOString(),
      packages: [
        {
          assetId: "flutter-skill",
          mirrorId: "sha256-old",
          manifestPath: installManifestPath.replace(/\\/gu, "/"),
        },
      ],
    } satisfies InstalledBundleManifest);
    await writeJsonFile(
      join(
        projectRoot,
        "install",
        "generations",
        "copilot-vscode",
        "current.json",
      ),
      {
        schemaVersion: 1,
        generationId: "current-gen",
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        bundleIds: ["copilot-core"],
        packageManifestPaths: [installManifestPath],
      } satisfies InstallGenerationManifest,
    );
    await writeJsonFile(
      join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
      {
        schemaVersion: 1,
        bundleId: "copilot-core",
        generatedAt: new Date().toISOString(),
        host: "copilot-vscode",
        assets: [
          {
            assetId: "flutter-skill",
            mirrorId: latestMirrorId,
            projectionType: "native-extension",
            activationEligible: true,
          },
        ],
      } satisfies BundleLock,
    );
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      {
        mirrorId: latestMirrorId,
        assetId: "flutter-skill",
        upstream: {
          type: "marketplace",
          url: "https://example.com/flutter-skill",
          version: "1.1.0",
        },
        source: {
          authorityTier: "trusted-community",
          publisher: "fixture",
          publisherVerified: true,
        },
        mirroredAt: new Date().toISOString(),
        contentHash: latestHash,
        projectionCandidates: [
          { host: "copilot-vscode", projectionType: "native-extension" },
        ],
        status: "approved",
      } satisfies MirrorIndexEntry,
    ]);
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [latestAsset],
    );

    await manageInstallRefresh(projectRoot, projectRoot, [
      "--host",
      "copilot-vscode",
      "--apply",
      "--no-mirror-refresh",
    ]);

    const report = await readJsonFile<InstallRefreshReport>(
      join(projectRoot, ...INSTALL_REFRESH_REPORT_OUTPUT_PATH),
      assertInstallRefreshReport,
    );
    const refreshState = await readJsonFile<InstallRefreshState>(
      join(projectRoot, ...INSTALL_REFRESH_STATE_OUTPUT_PATH),
      assertInstallRefreshState,
    );
    assert.equal(
      await pathExists(join(projectRoot, ...NATIVE_INSTALL_STATE_OUTPUT_PATH)),
      false,
    );
    const updatedBundleManifest =
      await readJsonFile<InstalledBundleManifest>(bundleManifestPath);
    const updatedManifest = await readJsonFile<InstalledPackageManifest>(
      updatedBundleManifest.packages[0]?.manifestPath ?? installManifestPath,
    );

    assert.equal(report.hosts[0]?.staleCount, 1);
    assert.equal(report.hosts[0]?.currentCount, 0);
    assert.equal(report.hosts[0]?.assets[0]?.policyDecision, "review-required");
    assert.equal(report.hosts[0]?.assets[0]?.refreshTier, "review-required");
    assert.equal(report.hosts[0]?.assets[0]?.lastRefreshAction, undefined);
    assert.equal(refreshState.stageEligibleCount, 0);
    assert.equal(refreshState.applyEligibleCount, 0);
    assert.equal(refreshState.reviewRequiredCount, 1);
    assert.equal(refreshState.quarantinedCount, 0);
    assert.equal(updatedBundleManifest.packages[0]?.mirrorId, "sha256-old");
    assert.equal(updatedManifest.mirrorId, "sha256-old");
    assert.equal(
      updatedManifest.nativeInstall?.extensionId,
      "pub.flutter-skill",
    );
    assert.equal(refreshState.policy, "apply-safe");
    assert.equal(refreshState.lastAppliedAt, undefined);
  } finally {
    if (originalPolicy === undefined) {
      delete process.env.AGENT_HARNESS_INSTALL_REFRESH_POLICY;
    } else {
      process.env.AGENT_HARNESS_INSTALL_REFRESH_POLICY = originalPolicy;
    }
    if (originalStatePath === undefined) {
      delete process.env.AGENT_HARNESS_FAKE_CODE_STATE;
    } else {
      process.env.AGENT_HARNESS_FAKE_CODE_STATE = originalStatePath;
    }
    process.env.PATH = originalPath;
    clearRuntimeConfigForTests();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

function buildRefreshAsset(
  id: string,
  options: {
    authorityTier: AssetCatalogEntry["source"]["authorityTier"];
    publisherVerified: boolean;
    activationEligible: boolean;
  },
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: "skill",
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId: "fixture-source",
      authorityTier: options.authorityTier,
      sourceKind: "docs",
      sourcePriority: 100,
      originUrl: `https://example.com/${id}`,
      publisher: "fixture",
      publisherVerified: options.publisherVerified,
    },
    trust: { score: 100, signals: ["fixture"] },
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
      filePath: "README.md",
    },
    maintenance: {
      lastUpdated: new Date().toISOString(),
      stars: 0,
      releaseCadence: "active",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: { sizeClass: "small", estimatedPromptWeight: 2 },
    fit: { portfolioFit: 0.9, hostFit: 0.9 },
    dedupe: { candidateRankHint: "fixture" },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: options.activationEligible,
    },
  };
}

function buildRefreshMirrorIndex(
  assetId: string,
  mirrorId: string,
  contentHash: string,
  options: {
    authorityTier: MirrorIndexEntry["source"]["authorityTier"];
    publisherVerified?: boolean;
    status?: MirrorIndexEntry["status"];
  },
): MirrorIndexEntry {
  return {
    mirrorId,
    assetId,
    upstream: {
      type: "docs",
      url: `https://example.com/${assetId}`,
    },
    source: {
      authorityTier: options.authorityTier,
      publisher: "fixture",
      publisherVerified: options.publisherVerified ?? true,
    },
    mirroredAt: new Date().toISOString(),
    contentHash,
    projectionCandidates: [
      { host: "copilot-vscode", projectionType: "native-skill" },
    ],
    status: options.status ?? "approved",
  };
}

async function seedRefreshInstallState(options: {
  projectRoot: string;
  assetId: string;
  assetKind: InstalledPackageManifest["assetKind"];
  sourceAuthorityTier: InstalledPackageManifest["sourceAuthorityTier"];
  oldMirrorId: string;
  latestMirrorId: string;
  installManifestPath: string;
  activationEligible: boolean;
}): Promise<void> {
  await writeJsonFile(options.installManifestPath, {
    schemaVersion: 1,
    assetId: options.assetId,
    mirrorId: options.oldMirrorId,
    host: "copilot-vscode",
    installedAt: new Date().toISOString(),
    projectionType: "native-skill",
    assetKind: options.assetKind,
    sourceAuthorityTier: options.sourceAuthorityTier,
    contextCost: { sizeClass: "small", estimatedPromptWeight: 2 },
    portfolioFit: 0.9,
    filesRoot: join(
      options.projectRoot,
      "install",
      "copilot-vscode",
      "packages",
      options.assetId,
      "files",
    ),
    bundleMembership: ["copilot-core"],
    activationEligible: options.activationEligible,
    activeByDefault: false,
    upstream: {
      mirrorId: options.oldMirrorId,
      mirroredAt: new Date(0).toISOString(),
      sourceId: "fixture-source",
      sourceOriginUrl: `https://example.com/${options.assetId}`,
      sourceLastUpdated: new Date(0).toISOString(),
      upstream: {
        type: "docs",
        url: `https://example.com/${options.assetId}`,
      },
    },
  } satisfies InstalledPackageManifest);
  await writeJsonFile(
    join(
      options.projectRoot,
      "install",
      "copilot-vscode",
      "bundles",
      "copilot-core.install.json",
    ),
    {
      schemaVersion: 1,
      bundleId: "copilot-core",
      host: "copilot-vscode",
      installedAt: new Date().toISOString(),
      packages: [
        {
          assetId: options.assetId,
          mirrorId: options.oldMirrorId,
          manifestPath: options.installManifestPath.replace(/\\/gu, "/"),
        },
      ],
    } satisfies InstalledBundleManifest,
  );
  await writeJsonFile(
    join(
      options.projectRoot,
      "install",
      "generations",
      "copilot-vscode",
      "current.json",
    ),
    {
      schemaVersion: 1,
      generationId: "current-gen",
      host: "copilot-vscode",
      generatedAt: new Date().toISOString(),
      bundleIds: ["copilot-core"],
      packageManifestPaths: [options.installManifestPath],
    } satisfies InstallGenerationManifest,
  );
  await writeJsonFile(
    join(options.projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
    {
      schemaVersion: 1,
      bundleId: "copilot-core",
      generatedAt: new Date().toISOString(),
      host: "copilot-vscode",
      assets: [
        {
          assetId: options.assetId,
          mirrorId: options.latestMirrorId,
          projectionType: "native-skill",
          activationEligible: options.activationEligible,
        },
      ],
    } satisfies BundleLock,
  );
}

void test("install refresh report marks quarantined and current assets explicitly", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-refresh-current-"),
  );
  const installManifestPath = join(
    projectRoot,
    "install",
    "copilot-vscode",
    "packages",
    "safe-skill",
    "install-manifest.json",
  );

  try {
    const currentAsset = buildRefreshAsset("safe-skill", {
      authorityTier: "official-first-party",
      publisherVerified: true,
      activationEligible: false,
    });
    const currentMirrorId = "sha256-safe-current";
    const currentHash = await writeMirrorArtifact(
      projectRoot,
      currentMirrorId,
      currentAsset,
    );
    await seedRefreshInstallState({
      projectRoot,
      assetId: "safe-skill",
      assetKind: "skill",
      sourceAuthorityTier: "official-first-party",
      oldMirrorId: currentMirrorId,
      latestMirrorId: currentMirrorId,
      installManifestPath,
      activationEligible: false,
    });
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      buildRefreshMirrorIndex("safe-skill", currentMirrorId, currentHash, {
        authorityTier: "official-first-party",
      }),
    ]);

    const report = await installRefreshInternals.buildInstallRefreshReport(
      projectRoot,
      ["copilot-vscode"],
      "apply-safe",
      false,
    );
    assert.equal(report.hosts[0]?.assets[0]?.status, "current");
    assert.equal(
      report.hosts[0]?.assets[0]?.reason,
      "Installed mirror matches the latest bundle lock mirror.",
    );

    const quarantinedMirrorId = "sha256-safe-quarantined";
    await writeJsonFile(
      join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
      {
        schemaVersion: 1,
        bundleId: "copilot-core",
        generatedAt: new Date().toISOString(),
        host: "copilot-vscode",
        assets: [
          {
            assetId: "safe-skill",
            mirrorId: quarantinedMirrorId,
            projectionType: "native-skill",
            activationEligible: false,
          },
        ],
      } satisfies BundleLock,
    );
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      buildRefreshMirrorIndex("safe-skill", quarantinedMirrorId, currentHash, {
        authorityTier: "official-first-party",
        status: "quarantined",
      }),
    ]);

    const quarantinedReport =
      await installRefreshInternals.buildInstallRefreshReport(
        projectRoot,
        ["copilot-vscode"],
        "apply-safe",
        false,
      );
    assert.equal(quarantinedReport.hosts[0]?.assets[0]?.status, "blocked");
    assert.match(
      quarantinedReport.hosts[0]?.assets[0]?.reason ?? "",
      /is quarantined/u,
    );

    const reviewRequiredMirrorId = "sha256-safe-review-required";
    await writeJsonFile(
      join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
      {
        schemaVersion: 1,
        bundleId: "copilot-core",
        generatedAt: new Date().toISOString(),
        host: "copilot-vscode",
        assets: [
          {
            assetId: "safe-skill",
            mirrorId: reviewRequiredMirrorId,
            projectionType: "native-skill",
            activationEligible: false,
          },
        ],
      } satisfies BundleLock,
    );
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      buildRefreshMirrorIndex(
        "safe-skill",
        reviewRequiredMirrorId,
        currentHash,
        {
          authorityTier: "unverified-community",
        },
      ),
    ]);
    const reviewRequiredReport =
      await installRefreshInternals.buildInstallRefreshReport(
        projectRoot,
        ["copilot-vscode"],
        "apply-safe",
        false,
      );
    assert.equal(reviewRequiredReport.hosts[0]?.assets[0]?.status, "stale");
    assert.equal(
      reviewRequiredReport.hosts[0]?.assets[0]?.policyDecision,
      "review-required",
    );

    await seedRefreshInstallState({
      projectRoot,
      assetId: "safe-skill",
      assetKind: "skill",
      sourceAuthorityTier: "official-first-party",
      oldMirrorId: "sha256-safe-old",
      latestMirrorId: reviewRequiredMirrorId,
      installManifestPath,
      activationEligible: false,
    });
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      buildRefreshMirrorIndex(
        "safe-skill",
        reviewRequiredMirrorId,
        currentHash,
        {
          authorityTier: "official-first-party",
          publisherVerified: false,
        },
      ),
    ]);
    const unverifiedPublisherReport =
      await installRefreshInternals.buildInstallRefreshReport(
        projectRoot,
        ["copilot-vscode"],
        "apply-safe",
        false,
      );
    assert.equal(
      unverifiedPublisherReport.hosts[0]?.assets[0]?.status,
      "stale",
    );
    assert.equal(
      unverifiedPublisherReport.hosts[0]?.assets[0]?.policyDecision,
      "review-required",
    );

    const riskyExecutableAsset = buildRefreshAsset("safe-skill", {
      authorityTier: "trusted-community",
      publisherVerified: true,
      activationEligible: false,
    });
    riskyExecutableAsset.assetKind = "plugin";
    const riskyMirrorId = "sha256-safe-risky";
    const riskyHash = await writeMirrorArtifact(
      projectRoot,
      riskyMirrorId,
      riskyExecutableAsset,
    );
    await seedRefreshInstallState({
      projectRoot,
      assetId: "safe-skill",
      assetKind: "plugin",
      sourceAuthorityTier: "trusted-community",
      oldMirrorId: "sha256-safe-old",
      latestMirrorId: riskyMirrorId,
      installManifestPath,
      activationEligible: false,
    });
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [riskyExecutableAsset],
    );
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      buildRefreshMirrorIndex("safe-skill", riskyMirrorId, riskyHash, {
        authorityTier: "trusted-community",
      }),
    ]);
    const riskyExecutableReport =
      await installRefreshInternals.buildInstallRefreshReport(
        projectRoot,
        ["copilot-vscode"],
        "apply-safe",
        false,
      );
    assert.equal(
      riskyExecutableReport.hosts[0]?.assets[0]?.policyDecision,
      "review-required",
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("install refresh native apply rejects invalid ids and failed host installs", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-refresh-native-failure-"),
  );
  const originalPath = process.env.PATH;
  const originalStatePath = process.env.AGENT_HARNESS_FAKE_CODE_STATE;

  try {
    const { binDir, statePath } = await createFakeCodeCli(projectRoot);
    process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${originalPath ?? ""}`;
    process.env.AGENT_HARNESS_FAKE_CODE_STATE = statePath;

    await assert.rejects(
      installRefreshInternals.applyNativeRefreshes(
        projectRoot,
        new Map([["copilot-vscode", [""]]]),
      ),
      /one or more extension ids were invalid/u,
    );

    await installRefreshInternals.applyNativeRefreshes(
      projectRoot,
      new Map([["copilot-vscode", ["fixture.pass-install"]]]),
    );
    const nativeState = await readJsonFile<Record<string, unknown>>(
      join(projectRoot, ...NATIVE_INSTALL_STATE_OUTPUT_PATH),
    );
    assert.equal(nativeState.operation, "install");

    await writeTextFile(
      join(binDir, "fake-code.mjs"),
      [
        "const args = process.argv.slice(2);",
        'if (args[0] === "--version") { console.log("1.0.0"); process.exit(0); }',
        'if (args[0] === "--list-extensions") process.exit(0);',
        'if (args[0] === "--install-extension") { console.error("install failed"); process.exit(1); }',
        "process.exit(1);",
        "",
      ].join("\n"),
    );

    await assert.rejects(
      installRefreshInternals.applyNativeRefreshes(
        projectRoot,
        new Map([["copilot-vscode", ["fixture.fail-install"]]]),
      ),
      /Native install refresh failed for fixture\.fail-install/u,
    );
  } finally {
    if (originalStatePath === undefined) {
      delete process.env.AGENT_HARNESS_FAKE_CODE_STATE;
    } else {
      process.env.AGENT_HARNESS_FAKE_CODE_STATE = originalStatePath;
    }
    process.env.PATH = originalPath;
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("install refresh rejects unsupported host filters", async () => {
  await assert.rejects(
    manageInstallRefresh(process.cwd(), process.cwd(), [
      "--host",
      "not-a-host",
    ]),
    /Invalid --host value 'not-a-host'/u,
  );
});
