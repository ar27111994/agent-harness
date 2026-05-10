import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  pathExists,
  readJsonFile,
  writeJsonFile,
  writeJsonLinesFile,
} from "../files.js";
import { manageInstallRefresh } from "../install/refresh.js";
import {
  INSTALL_REFRESH_REPORT_OUTPUT_PATH,
  INSTALL_REFRESH_STATE_OUTPUT_PATH,
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
        publisherVerified: false,
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
        publisherVerified: false,
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
    assert.equal(refreshState.policy, "manual");
    assert.equal(refreshState.staleCount, 1);
    assert.equal(refreshState.applyEligibleCount, 0);
    assert.ok(
      Date.parse(refreshState.nextCheckAt) > Date.parse(refreshState.updatedAt),
    );
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

  try {
    await writeJsonFile(refreshStatePath, {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      policy: "manual",
      intervalMs: 21_600_000,
      nextCheckAt: futureNextCheckAt,
      refreshedMirrorState: false,
      staleCount: 0,
      applyEligibleCount: 0,
    } satisfies InstallRefreshState);

    await manageInstallRefresh(projectRoot, projectRoot, ["--due-only"]);

    assert.equal(await pathExists(reportPath), false);
    const refreshState = await readJsonFile<InstallRefreshState>(
      refreshStatePath,
      assertInstallRefreshState,
    );
    assert.equal(refreshState.nextCheckAt, futureNextCheckAt);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});
