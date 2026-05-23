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
    assert.equal(assetReport?.policyDecision, "notify");
    assert.match(assetReport?.policyReason ?? "", /Manual policy/u);
    assert.equal(refreshState.policy, "manual");
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
      policy: "manual",
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

void test("install refresh apply-safe reapplies stale bundles and native installs", async () => {
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

    assert.equal(report.hosts[0]?.staleCount, 0);
    assert.equal(report.hosts[0]?.currentCount, 1);
    assert.equal(report.hosts[0]?.assets[0]?.lastRefreshAction, "staged");
    assert.equal(refreshState.stageEligibleCount, 0);
    assert.equal(refreshState.applyEligibleCount, 0);
    assert.equal(refreshState.reviewRequiredCount, 0);
    assert.equal(refreshState.quarantinedCount, 0);
    assert.equal(updatedBundleManifest.packages[0]?.mirrorId, latestMirrorId);
    assert.equal(updatedManifest.mirrorId, latestMirrorId);
    assert.equal(
      updatedManifest.nativeInstall?.extensionId,
      "pub.flutter-skill",
    );
    assert.equal(refreshState.policy, "apply-safe");
    assert.match(refreshState.lastAppliedAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
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
