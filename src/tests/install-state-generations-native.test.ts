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
import {
  diffInstallState,
  explainInstalledAsset,
  manageInstallGenerations,
} from "../install/generations.js";
import { installBundles } from "../install/bundle.js";
import { manageNativeInstall } from "../install/native.js";
import type { NativeInstallResult } from "../host-adapters/extension-installer.js";
import {
  INSTALL_GENERATIONS_ROOT,
  INSTALL_PROGRESS_SNAPSHOT_OUTPUT_PATH,
  INSTALL_PROGRESS_STATE_OUTPUT_PATH,
  NATIVE_INSTALL_STATE_OUTPUT_PATH,
} from "../install/paths.js";
import {
  reconcileInstallState,
  resetInstallState,
  updateInstallProgressState,
  writeInstallGenerations,
} from "../install/state.js";
import { sanitizeAssetId, sanitizeMirrorId } from "../lib/safe-paths.js";
import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { getInstallableAssets } from "../install/utils.js";
import type {
  ActivationManifest,
  AssetCatalogEntry,
  BundleLock,
  CopilotWorkspaceProfileManifest,
  InstallGenerationManifest,
  InstallProgressState,
  InstalledBundleManifest,
  InstalledPackageManifest,
  MirrorIndexEntry,
} from "../types.js";

function buildAsset(
  id: string,
  overrides: Partial<AssetCatalogEntry> = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: "extension",
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId: "fixture-source",
      authorityTier: "trusted-community",
      sourceKind: "marketplace",
      sourcePriority: 100,
      originUrl: `https://example.com/${id}`,
      publisher: "Fixture",
      publisherVerified: true,
    },
    trust: {
      score: 90,
      signals: [],
    },
    capabilities: ["fixture"],
    install: {
      method: "vscode-extension",
      nativeHosts: ["copilot-vscode"],
      manifestEntry: `fixture.${id}`,
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
    contextCost: {
      sizeClass: "tiny",
      estimatedPromptWeight: 1,
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
    ...overrides,
  };
}

function buildMirrorIndexEntry(
  assetId: string,
  overrides: Partial<MirrorIndexEntry> = {},
): MirrorIndexEntry {
  return {
    mirrorId: `sha256-${assetId}`,
    assetId,
    upstream: {
      type: "marketplace",
      url: `https://example.com/${assetId}`,
      version: "1.0.0",
    },
    source: {
      authorityTier: "trusted-community",
      publisher: "Fixture",
      publisherVerified: true,
    },
    mirroredAt: new Date().toISOString(),
    contentHash: `hash-${assetId}`,
    projectionCandidates: [
      {
        host: "copilot-vscode",
        projectionType: "native-extension",
      },
    ],
    status: "approved",
    ...overrides,
  };
}

function buildInstalledPackageManifest(
  assetId: string,
): InstalledPackageManifest {
  return {
    schemaVersion: 1,
    assetId,
    mirrorId: `sha256-${assetId}`,
    host: "copilot-vscode",
    installedAt: new Date().toISOString(),
    projectionType: "native-extension",
    assetKind: "extension",
    sourceAuthorityTier: "trusted-community",
    contextCost: {
      sizeClass: "tiny",
      estimatedPromptWeight: 1,
    },
    portfolioFit: 0.9,
    filesRoot: join("/install", assetId, "files"),
    bundleMembership: ["copilot-core"],
    activationEligible: true,
    activeByDefault: false,
    nativeInstall: {
      extensionId: `fixture.${assetId}`,
    },
    upstream: {
      mirrorId: `sha256-${assetId}`,
      mirroredAt: new Date().toISOString(),
      sourceId: "fixture-source",
      sourceOriginUrl: `https://example.com/${assetId}`,
      sourceLastUpdated: new Date().toISOString(),
      upstream: {
        type: "marketplace",
        url: `https://example.com/${assetId}`,
        version: "1.0.0",
      },
    },
  } satisfies InstalledPackageManifest;
}

void test("getInstallableAssets excludes non-activating and quarantined bundle entries", () => {
  const bundleAssets: BundleLock["assets"] = [
    {
      assetId: "ready",
      mirrorId: "sha256-ready",
      projectionType: "native-extension",
      activationEligible: true,
    },
    {
      assetId: "blocked",
      mirrorId: "sha256-blocked",
      projectionType: "native-extension",
      activationEligible: false,
    },
    {
      assetId: "quarantined",
      mirrorId: "sha256-quarantined",
      projectionType: "native-extension",
      activationEligible: true,
    },
  ];
  const mirrorIndexById = new Map<string, MirrorIndexEntry>([
    ["sha256-ready", buildMirrorIndexEntry("ready")],
    [
      "sha256-quarantined",
      buildMirrorIndexEntry("quarantined", { status: "quarantined" }),
    ],
  ]);

  const installableAssets = getInstallableAssets(bundleAssets, mirrorIndexById);

  assert.deepEqual(
    installableAssets.map((asset) => asset.assetId),
    ["ready"],
  );
});

void test("updateInstallProgressState deduplicates installed assets and writes a snapshot", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-state-"),
  );

  try {
    const allAssets: BundleLock["assets"] = [
      {
        assetId: "asset-a",
        mirrorId: "sha256-asset-a",
        projectionType: "native-extension",
        activationEligible: true,
      },
      {
        assetId: "asset-b",
        mirrorId: "sha256-asset-b",
        projectionType: "native-extension",
        activationEligible: true,
      },
    ];
    const installedPackages: InstalledBundleManifest["packages"] = [
      {
        assetId: "asset-a",
        mirrorId: "sha256-asset-a",
        manifestPath: "/tmp/asset-a/install-manifest.json",
      },
      {
        assetId: "asset-a",
        mirrorId: "sha256-asset-a",
        manifestPath: "/tmp/asset-a/install-manifest.json",
      },
    ];

    await updateInstallProgressState(
      projectRoot,
      "copilot-core",
      "copilot-vscode",
      25,
      allAssets,
      installedPackages,
      ["asset-a", "asset-a", "asset-b"],
    );
    await updateInstallProgressState(
      projectRoot,
      "copilot-core",
      "copilot-vscode",
      25,
      allAssets,
      installedPackages,
      ["asset-b"],
    );

    const progressState = await readJsonFile<InstallProgressState>(
      join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH),
    );

    assert.equal(progressState.bundles["copilot-core"]?.installedAssets, 1);
    assert.equal(progressState.bundles["copilot-core"]?.remainingAssets, 1);
    assert.deepEqual(progressState.bundles["copilot-core"]?.lastBatchAssetIds, [
      "asset-b",
    ]);
    assert.equal(
      await pathExists(
        join(projectRoot, ...INSTALL_PROGRESS_SNAPSHOT_OUTPUT_PATH),
      ),
      true,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("reconcileInstallState rebuilds progress state and install generations from persisted manifests", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-state-"),
  );
  const assetAManifestPath = join(
    projectRoot,
    "install",
    "copilot-vscode",
    "packages",
    "asset-a",
    "install-manifest.json",
  );
  const assetBManifestPath = join(
    projectRoot,
    "install",
    "copilot-vscode",
    "packages",
    "asset-b",
    "install-manifest.json",
  );

  try {
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      buildMirrorIndexEntry("asset-a"),
      buildMirrorIndexEntry("asset-b", { status: "quarantined" }),
    ]);
    await writeJsonFile(
      join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
      {
        schemaVersion: 1,
        bundleId: "copilot-core",
        generatedAt: new Date().toISOString(),
        host: "copilot-vscode",
        assets: [
          {
            assetId: "asset-a",
            mirrorId: "sha256-asset-a",
            projectionType: "native-extension",
            activationEligible: true,
          },
          {
            assetId: "asset-b",
            mirrorId: "sha256-asset-b",
            projectionType: "native-extension",
            activationEligible: true,
          },
        ],
      } satisfies BundleLock,
    );
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
            assetId: "asset-a",
            mirrorId: "sha256-asset-a",
            manifestPath: assetAManifestPath,
          },
          {
            assetId: "asset-a",
            mirrorId: "sha256-asset-a",
            manifestPath: assetAManifestPath,
          },
          {
            assetId: "asset-b",
            mirrorId: "sha256-asset-b",
            manifestPath: assetBManifestPath,
          },
        ],
      } satisfies InstalledBundleManifest,
    );

    await reconcileInstallState(projectRoot);

    const progressState = await readJsonFile<InstallProgressState>(
      join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH),
    );
    const currentGeneration = await readJsonFile<InstallGenerationManifest>(
      join(
        projectRoot,
        ...INSTALL_GENERATIONS_ROOT,
        "copilot-vscode",
        "current.json",
      ),
    );

    assert.equal(progressState.bundles["copilot-core"]?.totalAssets, 1);
    assert.equal(progressState.bundles["copilot-core"]?.installedAssets, 1);
    assert.equal(progressState.bundles["copilot-core"]?.remainingAssets, 0);
    assert.deepEqual(progressState.bundles["copilot-core"]?.lastBatchAssetIds, [
      "asset-a",
    ]);
    assert.deepEqual(currentGeneration.bundleIds, ["copilot-core"]);
    assert.deepEqual(currentGeneration.packageManifestPaths, [
      assetAManifestPath,
      assetBManifestPath,
    ]);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("resetInstallState removes install and state directories", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-state-"),
  );

  try {
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
      },
    );
    await writeJsonFile(
      join(projectRoot, "state", "install", "progress.json"),
      {
        schemaVersion: 1,
      },
    );

    await resetInstallState(projectRoot);

    assert.equal(await pathExists(join(projectRoot, "install")), false);
    assert.equal(
      await pathExists(join(projectRoot, "state", "install")),
      false,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("diffInstallState compares previous and current generations", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-generations-"),
  );
  const output: string[] = [];
  const assetAManifestPath = join(projectRoot, "manifests", "asset-a.json");
  const assetBManifestPath = join(projectRoot, "manifests", "asset-b.json");
  const assetCManifestPath = join(projectRoot, "manifests", "asset-c.json");

  try {
    await writeJsonFile(
      assetAManifestPath,
      buildInstalledPackageManifest("asset-a"),
    );
    await writeJsonFile(
      assetBManifestPath,
      buildInstalledPackageManifest("asset-b"),
    );
    await writeJsonFile(
      assetCManifestPath,
      buildInstalledPackageManifest("asset-c"),
    );
    await writeJsonFile(
      join(
        projectRoot,
        ...INSTALL_GENERATIONS_ROOT,
        "copilot-vscode",
        "previous.json",
      ),
      {
        schemaVersion: 1,
        generationId: "previous",
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        bundleIds: ["copilot-core"],
        packageManifestPaths: [assetAManifestPath, assetBManifestPath],
      } satisfies InstallGenerationManifest,
    );
    await writeJsonFile(
      join(
        projectRoot,
        ...INSTALL_GENERATIONS_ROOT,
        "copilot-vscode",
        "current.json",
      ),
      {
        schemaVersion: 1,
        generationId: "current",
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        bundleIds: ["copilot-core", "shared-mcp"],
        packageManifestPaths: [assetBManifestPath, assetCManifestPath],
      } satisfies InstallGenerationManifest,
    );

    t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
      output.push(args.map((value) => String(value)).join(" "));
    });

    await diffInstallState(projectRoot, ["--host", "copilot-vscode"]);

    assert.deepEqual(output, [
      "Install diff for copilot-vscode: previous -> current",
      "  Added bundles: shared-mcp",
      "  Removed bundles: none",
      "  Added assets: asset-c",
      "  Removed assets: asset-a",
    ]);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("explainInstalledAsset reports active bundle membership for installed assets", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-explain-"),
  );
  const output: string[] = [];
  const packageManifestPath = join(
    projectRoot,
    "install",
    "copilot-vscode",
    "packages",
    sanitizeAssetId("asset-a"),
    "install-manifest.json",
  );
  const inactivePackageManifestPath = join(
    projectRoot,
    "install",
    "copilot-vscode",
    "packages",
    sanitizeAssetId("asset-b"),
    "install-manifest.json",
  );

  try {
    await writeJsonFile(
      packageManifestPath,
      buildInstalledPackageManifest("asset-a"),
    );
    await writeJsonFile(
      inactivePackageManifestPath,
      buildInstalledPackageManifest("asset-b"),
    );
    await writeJsonFile(
      join(
        projectRoot,
        ...INSTALL_GENERATIONS_ROOT,
        "copilot-vscode",
        "current.json",
      ),
      {
        schemaVersion: 1,
        generationId: "current-gen",
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        bundleIds: ["copilot-core"],
        packageManifestPaths: [packageManifestPath.replace(/\\/gu, "/")],
      } satisfies InstallGenerationManifest,
    );

    t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
      output.push(args.map((value) => String(value)).join(" "));
    });

    await explainInstalledAsset(projectRoot, ["--asset", "asset-a"]);
    await explainInstalledAsset(projectRoot, ["--asset", "asset-b"]);

    assert.deepEqual(output, [
      "Install explain for asset-a",
      `Host copilot-vscode: installed via sha256-asset-a\n  bundles: copilot-core\n  files: ${join("/install", "asset-a", "files")}\n  active generation: current-gen`,
      "Install explain for asset-b",
      `Host copilot-vscode: installed via sha256-asset-b\n  bundles: copilot-core\n  files: ${join("/install", "asset-b", "files")}\n  active generation: not active`,
    ]);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("manageInstallGenerations pins, unpins, and prunes generation manifests", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-generations-"),
  );

  try {
    for (const generationId of ["2026-01-03", "2026-01-02", "2026-01-01"]) {
      await writeJsonFile(
        join(
          projectRoot,
          ...INSTALL_GENERATIONS_ROOT,
          "copilot-vscode",
          `${generationId}.json`,
        ),
        {
          schemaVersion: 1,
          generationId,
          host: "copilot-vscode",
          generatedAt: new Date().toISOString(),
          bundleIds: ["copilot-core"],
          packageManifestPaths: [],
        } satisfies InstallGenerationManifest,
      );
    }
    await writeJsonFile(
      join(
        projectRoot,
        ...INSTALL_GENERATIONS_ROOT,
        "copilot-vscode",
        "current.json",
      ),
      {
        schemaVersion: 1,
        generationId: "2026-01-03",
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        bundleIds: ["copilot-core"],
        packageManifestPaths: [],
      } satisfies InstallGenerationManifest,
    );

    await manageInstallGenerations(projectRoot, [
      "pin",
      "--host",
      "copilot-vscode",
      "--generation",
      "2026-01-02",
      "--reason",
      "Keep for regression checks",
    ]);

    let pinnedManifest = await readJsonFile<InstallGenerationManifest>(
      join(
        projectRoot,
        ...INSTALL_GENERATIONS_ROOT,
        "copilot-vscode",
        "2026-01-02.json",
      ),
    );
    assert.equal(pinnedManifest.pinned, true);
    assert.equal(pinnedManifest.pinReason, "Keep for regression checks");

    await manageInstallGenerations(projectRoot, [
      "unpin",
      "--host",
      "copilot-vscode",
      "--generation",
      "2026-01-02",
    ]);

    pinnedManifest = await readJsonFile<InstallGenerationManifest>(
      join(
        projectRoot,
        ...INSTALL_GENERATIONS_ROOT,
        "copilot-vscode",
        "2026-01-02.json",
      ),
    );
    assert.equal(pinnedManifest.pinned, false);
    assert.equal(pinnedManifest.pinReason, undefined);

    await manageInstallGenerations(projectRoot, [
      "pin",
      "--host",
      "copilot-vscode",
      "--generation",
      "2026-01-01",
    ]);
    await manageInstallGenerations(projectRoot, [
      "prune",
      "--host",
      "copilot-vscode",
      "--keep",
      "1",
    ]);

    assert.equal(
      await pathExists(
        join(
          projectRoot,
          ...INSTALL_GENERATIONS_ROOT,
          "copilot-vscode",
          "2026-01-03.json",
        ),
      ),
      true,
    );
    assert.equal(
      await pathExists(
        join(
          projectRoot,
          ...INSTALL_GENERATIONS_ROOT,
          "copilot-vscode",
          "2026-01-01.json",
        ),
      ),
      true,
    );
    assert.equal(
      await pathExists(
        join(
          projectRoot,
          ...INSTALL_GENERATIONS_ROOT,
          "copilot-vscode",
          "2026-01-02.json",
        ),
      ),
      false,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("manageNativeInstall builds a native install plan from selected activation assets", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-native-install-"),
  );
  const output: string[] = [];

  try {
    await writeJsonFile(
      join(
        projectRoot,
        "activate",
        "copilot-vscode",
        "workspace-profile-manifest.json",
      ),
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        profileId: "fixture",
        workspaceRoot: projectRoot,
        bundleIds: ["copilot-core"],
        selectedAssetIds: [],
        selectedInstructionIds: [],
        selectedAgentIds: [],
        selectedWorkflowIds: [],
        selectedExtensionIds: ["asset-a"],
        activationBudget: 10,
      } satisfies CopilotWorkspaceProfileManifest,
    );
    await writeJsonFile(
      join(
        projectRoot,
        "activate",
        "copilot-vscode",
        "activation-manifest.json",
      ),
      {
        schemaVersion: 1,
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        activeBundles: ["copilot-core"],
        activeAssets: ["asset-a"],
        runtimeRoot: join(projectRoot, "activate", "copilot-vscode"),
        notes: [],
      } satisfies ActivationManifest,
    );
    await writeJsonFile(
      join(
        projectRoot,
        "activate",
        "copilot-vscode",
        sanitizeAssetId("asset-a"),
        "asset.json",
      ),
      buildAsset("asset-a"),
    );

    t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
      output.push(args.map((value) => String(value)).join(" "));
    });

    await manageNativeInstall(projectRoot, [
      "--host",
      "vscode",
      "--operation",
      "plan",
    ]);

    assert.equal(
      output[0],
      "Native install plan for GitHub Copilot in VS Code:",
    );
    assert.match(output[1] ?? "", /fixture\.asset-a/u);
    assert.equal(
      await pathExists(join(projectRoot, ...NATIVE_INSTALL_STATE_OUTPUT_PATH)),
      false,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("manageNativeInstall rejects unsupported and invalid operations", async () => {
  await assert.rejects(
    manageNativeInstall(process.cwd(), ["--host", "not-a-host"]),
    /Unsupported host adapter/u,
  );
  await assert.rejects(
    manageNativeInstall(process.cwd(), ["--host", "zed"]),
    /Unsupported native install capability/u,
  );
  await assert.rejects(
    manageNativeInstall(process.cwd(), [
      "--host",
      "vscode",
      "--operation",
      "explode",
    ]),
    /Invalid native install operation 'explode'/u,
  );
});

void test("manageNativeInstall reports when no selected assets are ready", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-native-install-"),
  );
  const output: string[] = [];

  try {
    t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
      output.push(args.map((value) => String(value)).join(" "));
    });

    await manageNativeInstall(projectRoot, [
      "--host",
      "vscode",
      "--operation",
      "plan",
    ]);

    assert.equal(output.length, 1);
    assert.match(output[0] ?? "", /No native-install assets selected/u);
    assert.match(
      output[0] ?? "",
      /No selected extension assets are ready for native install on GitHub Copilot in VS Code\./u,
    );
    assert.match(
      output[0] ?? "",
      /agent-harness install native --host copilot-vscode --operation plan/u,
    );
    assert.equal(
      await pathExists(join(projectRoot, ...NATIVE_INSTALL_STATE_OUTPUT_PATH)),
      false,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("manageNativeInstall previews mutating operations until --apply is provided", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-native-install-"),
  );
  const output: string[] = [];

  try {
    await writeJsonFile(
      join(
        projectRoot,
        "activate",
        "copilot-vscode",
        "workspace-profile-manifest.json",
      ),
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        profileId: "fixture",
        workspaceRoot: projectRoot,
        bundleIds: ["copilot-core"],
        selectedAssetIds: ["asset-a"],
        selectedInstructionIds: [],
        selectedAgentIds: [],
        selectedWorkflowIds: [],
        selectedExtensionIds: ["asset-a"],
        activationBudget: 10,
      } satisfies CopilotWorkspaceProfileManifest,
    );
    await writeJsonFile(
      join(
        projectRoot,
        "activate",
        "copilot-vscode",
        "activation-manifest.json",
      ),
      {
        schemaVersion: 1,
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        activeBundles: ["copilot-core"],
        activeAssets: ["asset-a"],
        runtimeRoot: join(projectRoot, "activate", "copilot-vscode"),
        notes: [],
      } satisfies ActivationManifest,
    );
    await writeJsonFile(
      join(
        projectRoot,
        "activate",
        "copilot-vscode",
        sanitizeAssetId("asset-a"),
        "asset.json",
      ),
      buildAsset("asset-a"),
    );

    t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
      output.push(args.map((value) => String(value)).join(" "));
    });

    await manageNativeInstall(projectRoot, [
      "--host",
      "vscode",
      "--operation",
      "remove",
    ]);

    assert.ok(
      output.includes(
        "Native remove is mutating. Re-run with --apply to execute it.",
      ),
    );
    assert.ok(
      output.includes("Native install plan for GitHub Copilot in VS Code:"),
    );
    assert.ok(output.some((line) => /remove=.*fixture\.asset-a/u.test(line)));
    assert.equal(
      await pathExists(join(projectRoot, ...NATIVE_INSTALL_STATE_OUTPUT_PATH)),
      false,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

async function writeMirrorArtifact(
  projectRoot: string,
  mirrorId: string,
  entry: AssetCatalogEntry,
  additionalFiles: Array<{ relativePath: string; content: string }> = [],
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
    ...additionalFiles,
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
  const cliScriptPath = join(binDir, "fake-code.mjs");
  const shellWrapperPath = join(binDir, "code");
  const wrapperPath = join(binDir, "code.cmd");

  await writeTextFile(
    cliScriptPath,
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
      'if (args[0] === "--uninstall-extension") {',
      "  const extensionId = args[1];",
      "  installed = installed.filter((candidate) => candidate !== extensionId);",
      "  writeState(installed);",
      "  console.log(`removed ${extensionId}`);",
      "  process.exit(0);",
      "}",
      'console.error(`unsupported args: ${args.join(" ")}`);',
      "process.exit(1);",
      "",
    ].join("\n"),
  );
  await writeTextFile(
    shellWrapperPath,
    `#!/usr/bin/env sh\nexec "${process.execPath}" "$(dirname "$0")/fake-code.mjs" "$@"\n`,
  );
  await chmod(shellWrapperPath, 0o755);
  await writeTextFile(
    wrapperPath,
    `@echo off\r\n"${process.execPath}" "%~dp0fake-code.mjs" %*\r\n`,
  );

  return { binDir, statePath };
}

void test("installBundles installs verified mirror content and preserves existing package metadata", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-bundle-"),
  );
  const warnings: string[] = [];
  const assetAPath = join(
    projectRoot,
    "install",
    "copilot-vscode",
    "packages",
    sanitizeAssetId("asset-a"),
    "install-manifest.json",
  );
  const assetBPath = join(
    projectRoot,
    "install",
    "copilot-vscode",
    "packages",
    sanitizeAssetId("asset-b"),
    "install-manifest.json",
  );

  try {
    const assetA = buildAsset("asset-a", {
      assetKind: "extension",
      install: {
        method: "vscode-extension",
        nativeHosts: ["copilot-vscode"],
        manifestEntry: "fixture.asset-a",
      },
    });
    const assetB = buildAsset("asset-b", {
      assetKind: "extension",
      install: {
        method: "vscode-extension",
        nativeHosts: ["copilot-vscode"],
        manifestEntry: "fixture.asset-b",
      },
    });
    const assetC = buildAsset("asset-c");
    const assetAMirrorId = "sha256-asset-a";
    const assetBMirrorId = "sha256-asset-b";
    const assetCMirrorId = "sha256-asset-c";
    const assetAHash = await writeMirrorArtifact(
      projectRoot,
      assetAMirrorId,
      assetA,
    );
    const assetBHash = await writeMirrorArtifact(
      projectRoot,
      assetBMirrorId,
      assetB,
      [{ relativePath: "notes/readme.txt", content: "bundle fixture\n" }],
    );
    const assetCHash = await writeMirrorArtifact(
      projectRoot,
      assetCMirrorId,
      assetC,
    );

    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      buildMirrorIndexEntry("asset-a", {
        mirrorId: assetAMirrorId,
        contentHash: assetAHash,
        projectionCandidates: [
          { host: "copilot-vscode", projectionType: "native-extension" },
        ],
      }),
      buildMirrorIndexEntry("asset-b", {
        mirrorId: assetBMirrorId,
        contentHash: assetBHash,
        projectionCandidates: [
          { host: "copilot-vscode", projectionType: "native-extension" },
        ],
      }),
      buildMirrorIndexEntry("asset-c", {
        mirrorId: assetCMirrorId,
        contentHash: assetCHash,
      }),
    ]);
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [assetA, assetB],
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
            assetId: "asset-a",
            mirrorId: assetAMirrorId,
            projectionType: "native-extension",
            activationEligible: true,
          },
          {
            assetId: "asset-b",
            mirrorId: assetBMirrorId,
            projectionType: "native-extension",
            activationEligible: true,
          },
          {
            assetId: "asset-c",
            mirrorId: assetCMirrorId,
            projectionType: "native-skill",
            activationEligible: true,
          },
        ],
      } satisfies BundleLock,
    );
    await writeJsonFile(assetAPath, buildInstalledPackageManifest("asset-a"));
    await writeJsonFile(assetBPath, {
      ...buildInstalledPackageManifest("asset-b"),
      assetKind: "extension",
      nativeInstall: { extensionId: "fixture.asset-b" },
      bundleMembership: ["shared-mcp"],
    } satisfies InstalledPackageManifest);
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
            assetId: "asset-a",
            mirrorId: assetAMirrorId,
            manifestPath: assetAPath.replace(/\\/gu, "/"),
          },
        ],
      } satisfies InstalledBundleManifest,
    );

    t.mock.method(globalThis.console, "warn", (...args: unknown[]) => {
      warnings.push(args.map((value) => String(value)).join(" "));
    });

    await installBundles(projectRoot, ["--batch-size", "0", "--offset", "-1"]);

    const bundleManifest = await readJsonFile<InstalledBundleManifest>(
      join(
        projectRoot,
        "install",
        "copilot-vscode",
        "bundles",
        "copilot-core.install.json",
      ),
    );
    const assetBManifest =
      await readJsonFile<InstalledPackageManifest>(assetBPath);
    const progressState = await readJsonFile<InstallProgressState>(
      join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH),
    );
    const currentGeneration = await readJsonFile<InstallGenerationManifest>(
      join(
        projectRoot,
        ...INSTALL_GENERATIONS_ROOT,
        "copilot-vscode",
        "current.json",
      ),
    );

    assert.deepEqual(
      bundleManifest.packages.map((pkg) => pkg.assetId),
      ["asset-a", "asset-b"],
    );
    assert.deepEqual(assetBManifest.bundleMembership, [
      "copilot-core",
      "shared-mcp",
    ]);
    assert.equal(assetBManifest.nativeInstall?.extensionId, "fixture.asset-b");
    assert.match(
      assetBManifest.filesRoot.replace(/\\/gu, "/"),
      /\/install\/copilot-vscode\/packages\/asset-b[^/]*\/files$/u,
    );
    assert.equal(progressState.bundles["copilot-core"]?.totalAssets, 3);
    assert.equal(progressState.bundles["copilot-core"]?.installedAssets, 2);
    assert.equal(progressState.bundles["copilot-core"]?.remainingAssets, 0);
    assert.deepEqual(progressState.bundles["copilot-core"]?.lastBatchAssetIds, [
      "asset-b",
    ]);
    assert.deepEqual(
      progressState.bundles["copilot-core"]?.skippedAssetIds,
      ["asset-c"],
      "asset-c (no catalog entry) should be recorded as skipped",
    );
    assert.deepEqual(currentGeneration.bundleIds, ["copilot-core"]);
    assert.deepEqual(currentGeneration.packageManifestPaths, [
      assetAPath.replace(/\\/gu, "/"),
      assetBPath.replace(/\\/gu, "/"),
    ]);
    assert.ok(warnings.length >= 0);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("installBundles skips malformed mirror artifacts gracefully (#409)", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-bundle-"),
  );
  const entry = buildAsset("asset-z");
  const mirrorId = "sha256-asset-z";

  try {
    const aggregateHash = await writeMirrorArtifact(
      projectRoot,
      mirrorId,
      entry,
    );
    await writeTextFile(
      join(
        projectRoot,
        "mirror",
        "raw",
        sanitizeMirrorId(mirrorId),
        "rogue.txt",
      ),
      "surprise\n",
    );
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      buildMirrorIndexEntry("asset-z", {
        mirrorId,
        contentHash: aggregateHash,
      }),
    ]);
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [entry],
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
            assetId: "asset-z",
            mirrorId,
            projectionType: "native-skill",
            activationEligible: true,
          },
        ],
      } satisfies BundleLock,
    );

    // #409: Malformed artifacts are now skipped with a warning instead of
    // aborting. The function should resolve without throwing.
    await assert.doesNotReject(
      installBundles(projectRoot, ["--bundle", "copilot-core"]),
    );

    // Verify progress state tracks the skipped asset
    const progressState = await readJsonFile<InstallProgressState>(
      join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH),
    );
    assert.deepEqual(
      progressState.bundles["copilot-core"]?.skippedAssetIds,
      ["asset-z"],
      "malformed artifact should be recorded as skipped",
    );
    assert.equal(progressState.bundles["copilot-core"]?.installedAssets, 0);
    assert.equal(
      progressState.bundles["copilot-core"]?.remainingAssets,
      1,
      "skipped asset should still count toward remaining",
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("installBundles skips artifact with missing manifest.json (#409)", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-bundle-"),
  );
  const entry = buildAsset("asset-no-manifest");
  const mirrorId = "sha256-asset-no-manifest";
  const rawDir = join(projectRoot, "mirror", "raw", sanitizeMirrorId(mirrorId));
  const warnings: string[] = [];

  try {
    // Create the raw mirror directory with asset.json and content but NO manifest.json.
    // This simulates a partially-acquired artifact where the manifest was never written.
    await writeTextFile(join(rawDir, "content.txt"), `fixture:${entry.id}\n`);
    await writeTextFile(
      join(rawDir, "asset.json"),
      `${JSON.stringify(entry, null, 2)}\n`,
    );

    // Mirror index still references the (now-missing) manifest hash.
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      buildMirrorIndexEntry("asset-no-manifest", {
        mirrorId,
        contentHash: "hash-no-manifest",
      }),
    ]);
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [entry],
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
            assetId: "asset-no-manifest",
            mirrorId,
            projectionType: "native-skill",
            activationEligible: true,
          },
        ],
      } satisfies BundleLock,
    );

    t.mock.method(globalThis.console, "warn", (...args: unknown[]) => {
      warnings.push(args.map((value) => String(value)).join(" "));
    });

    // #409: Missing manifest.json should be caught, warned about with the
    // assetId, and skipped — the install pipeline should continue.
    await assert.doesNotReject(
      installBundles(projectRoot, ["--bundle", "copilot-core"]),
    );

    // Verify the warning includes the assetId for diagnosis.
    assert.ok(
      warnings.some(
        (w) => w.includes("asset-no-manifest") && w.includes("malformed"),
      ),
      "warning should identify the malformed asset by assetId",
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("manageInstallGenerations lists generation manifests and validates host and generation ids", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-generations-"),
  );
  const output: string[] = [];

  try {
    await writeJsonFile(
      join(
        projectRoot,
        ...INSTALL_GENERATIONS_ROOT,
        "copilot-vscode",
        "2026-01-04.json",
      ),
      {
        schemaVersion: 1,
        generationId: "2026-01-04",
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        bundleIds: ["copilot-core", "shared-mcp"],
        packageManifestPaths: ["/tmp/a.json"],
        pinned: true,
      } satisfies InstallGenerationManifest,
    );

    t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
      output.push(args.map((value) => String(value)).join(" "));
    });

    await manageInstallGenerations(projectRoot, [
      "list",
      "--host",
      "copilot-vscode",
    ]);

    assert.deepEqual(output, [
      "Install generations for copilot-vscode:",
      "  2026-01-04 [pinned] bundles=2 packages=1",
    ]);
    await assert.rejects(
      diffInstallState(projectRoot, ["--host", "unknown-host"]),
      /Invalid host value: unknown-host/u,
    );
    await assert.rejects(
      manageInstallGenerations(projectRoot, [
        "pin",
        "--host",
        "copilot-vscode",
        "--generation",
        "bad/slash",
      ]),
      /Invalid generation ID: bad\/slash/u,
    );
    await manageInstallGenerations(projectRoot, [
      "prune",
      "--keep",
      "not-a-number",
    ]);
    await assert.rejects(
      manageInstallGenerations(projectRoot, ["explode"]),
      /Unknown install generations command 'explode'/u,
    );
    await assert.rejects(
      manageInstallGenerations(projectRoot, [
        "pin",
        "--host",
        "copilot-vscode",
      ]),
      /generations pin\/unpin requires --host and --generation/u,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("diffInstallState and explainInstalledAsset handle missing generation and asset lookups", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-generations-"),
  );
  const output: string[] = [];

  try {
    t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
      output.push(args.map((value) => String(value)).join(" "));
    });

    await diffInstallState(projectRoot, []);
    await explainInstalledAsset(projectRoot, ["--asset", "missing-asset"]);

    assert.deepEqual(output, [
      "No comparable generations found for opencode",
      "No comparable generations found for copilot-vscode",
      "No comparable generations found for shared",
      "Asset missing-asset is not installed in any host bundle.",
    ]);
    await assert.rejects(
      explainInstalledAsset(projectRoot, []),
      /explain requires --asset <assetId>/u,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("writeInstallGenerations tolerates missing bundle manifests and empty bundle locks", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-install-state-"),
  );
  const assetManifestPath = join(
    projectRoot,
    "install",
    "copilot-vscode",
    "packages",
    "asset-a",
    "install-manifest.json",
  );

  try {
    await writeJsonFile(
      assetManifestPath,
      buildInstalledPackageManifest("asset-a"),
    );
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
            assetId: "asset-a",
            mirrorId: "sha256-asset-a",
            manifestPath: assetManifestPath,
          },
        ],
      } satisfies InstalledBundleManifest,
    );

    await reconcileInstallState(projectRoot);
    const reconciledProgress = await readJsonFile<InstallProgressState>(
      join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH),
    );
    assert.equal(reconciledProgress.bundles["copilot-core"]?.totalAssets, 0);
    assert.equal(
      reconciledProgress.bundles["copilot-core"]?.installedAssets,
      0,
    );
    assert.equal(
      reconciledProgress.bundles["copilot-core"]?.remainingAssets,
      0,
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
            assetId: "asset-a",
            mirrorId: "sha256-asset-a",
            projectionType: "native-extension",
            activationEligible: true,
          },
        ],
      } satisfies BundleLock,
    );

    await writeInstallGenerations(projectRoot, {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      bundles: {
        "copilot-core": {
          host: "copilot-vscode",
          batchSize: 10,
          totalAssets: 1,
          installedAssets: 1,
          remainingAssets: 0,
          lastBatchAssetIds: ["asset-a"],
          skippedAssetIds: [],
        },
        "shared-mcp": {
          host: "copilot-vscode",
          batchSize: 10,
          totalAssets: 1,
          installedAssets: 1,
          remainingAssets: 0,
          lastBatchAssetIds: ["missing-asset"],
          skippedAssetIds: [],
        },
      },
    } satisfies InstallProgressState);

    const currentGeneration = await readJsonFile<InstallGenerationManifest>(
      join(
        projectRoot,
        ...INSTALL_GENERATIONS_ROOT,
        "copilot-vscode",
        "current.json",
      ),
    );
    assert.deepEqual(currentGeneration.bundleIds, [
      "copilot-core",
      "shared-mcp",
    ]);
    assert.equal(currentGeneration.packageManifestPaths.length, 1);
    assert.equal(
      currentGeneration.packageManifestPaths[0]?.replaceAll("\\", "/"),
      assetManifestPath.replaceAll("\\", "/"),
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

interface FakeCodeEnvironment {
  binDir: string;
  statePath: string;
  restore: () => void;
}

// Activates the fake `code` CLI on PATH and relaxes the host-command preflight
// timeout so the Node-based fake CLI stays reliable even under coverage
// instrumentation, where spawning a child Node process is significantly slower.
async function activateFakeCodeEnvironment(
  projectRoot: string,
): Promise<FakeCodeEnvironment> {
  const originalPath = process.env.PATH;
  const originalStatePath = process.env.AGENT_HARNESS_FAKE_CODE_STATE;
  const originalPreflightTimeout =
    process.env.AGENT_HARNESS_PREFLIGHT_COMMAND_TIMEOUT_MS;

  const { binDir, statePath } = await createFakeCodeCli(projectRoot);
  process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${originalPath ?? ""}`;
  process.env.AGENT_HARNESS_FAKE_CODE_STATE = statePath;
  process.env.AGENT_HARNESS_PREFLIGHT_COMMAND_TIMEOUT_MS = "60000";
  clearRuntimeConfigForTests();

  return {
    binDir,
    statePath,
    restore: () => {
      process.env.PATH = originalPath;
      if (originalStatePath === undefined) {
        delete process.env.AGENT_HARNESS_FAKE_CODE_STATE;
      } else {
        process.env.AGENT_HARNESS_FAKE_CODE_STATE = originalStatePath;
      }
      if (originalPreflightTimeout === undefined) {
        delete process.env.AGENT_HARNESS_PREFLIGHT_COMMAND_TIMEOUT_MS;
      } else {
        process.env.AGENT_HARNESS_PREFLIGHT_COMMAND_TIMEOUT_MS =
          originalPreflightTimeout;
      }
      clearRuntimeConfigForTests();
    },
  };
}

void test("manageNativeInstall applies installs through the host CLI and records native state", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-native-install-"),
  );
  const fakeCode = await activateFakeCodeEnvironment(projectRoot);

  try {
    await writeJsonFile(
      join(
        projectRoot,
        "activate",
        "copilot-vscode",
        "workspace-profile-manifest.json",
      ),
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        profileId: "fixture",
        workspaceRoot: projectRoot,
        bundleIds: ["copilot-core"],
        selectedAssetIds: ["asset-b"],
        selectedInstructionIds: [],
        selectedAgentIds: [],
        selectedWorkflowIds: [],
        selectedExtensionIds: ["asset-b"],
        activationBudget: 10,
      } satisfies CopilotWorkspaceProfileManifest,
    );
    await writeJsonFile(
      join(
        projectRoot,
        "activate",
        "copilot-vscode",
        "activation-manifest.json",
      ),
      {
        schemaVersion: 1,
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        activeBundles: ["copilot-core"],
        activeAssets: ["asset-b"],
        runtimeRoot: join(projectRoot, "activate", "copilot-vscode"),
        notes: [],
      } satisfies ActivationManifest,
    );
    await writeJsonFile(
      join(
        projectRoot,
        "activate",
        "copilot-vscode",
        sanitizeAssetId("asset-b"),
        "asset.json",
      ),
      buildAsset("asset-b", {
        assetKind: "extension",
        install: {
          method: "vscode-extension",
          nativeHosts: ["copilot-vscode"],
          manifestEntry: "fixture.asset-b",
        },
      }),
    );

    await manageNativeInstall(projectRoot, [
      "--host",
      "vscode",
      "--operation",
      "install",
      "--apply",
    ]);

    const nativeState = await readJsonFile<{
      host: string;
      operation: string;
      results: NativeInstallResult[];
    }>(join(projectRoot, ...NATIVE_INSTALL_STATE_OUTPUT_PATH));

    assert.equal(nativeState.host, "copilot-vscode");
    assert.equal(nativeState.operation, "install");
    assert.equal(nativeState.results.length, 1);
    assert.equal(nativeState.results[0]?.success, true);
    assert.equal(nativeState.results[0]?.installed, true);
    assert.match(
      nativeState.results[0]?.stdout ?? "",
      /fixture\.asset-b@1\.0\.0/u,
    );
  } finally {
    fakeCode.restore();
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("manageNativeInstall surfaces failed verify results after writing native state", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-native-install-"),
  );
  const fakeCode = await activateFakeCodeEnvironment(projectRoot);

  try {
    await writeJsonFile(
      join(
        projectRoot,
        "activate",
        "copilot-vscode",
        "workspace-profile-manifest.json",
      ),
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        profileId: "fixture",
        workspaceRoot: projectRoot,
        bundleIds: ["copilot-core"],
        selectedAssetIds: ["asset-c"],
        selectedInstructionIds: [],
        selectedAgentIds: [],
        selectedWorkflowIds: [],
        selectedExtensionIds: ["asset-c"],
        activationBudget: 10,
      } satisfies CopilotWorkspaceProfileManifest,
    );
    await writeJsonFile(
      join(
        projectRoot,
        "activate",
        "copilot-vscode",
        "activation-manifest.json",
      ),
      {
        schemaVersion: 1,
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        activeBundles: ["copilot-core"],
        activeAssets: ["asset-c"],
        runtimeRoot: join(projectRoot, "activate", "copilot-vscode"),
        notes: [],
      } satisfies ActivationManifest,
    );
    await writeJsonFile(
      join(
        projectRoot,
        "activate",
        "copilot-vscode",
        sanitizeAssetId("asset-c"),
        "asset.json",
      ),
      buildAsset("asset-c", {
        assetKind: "extension",
        install: {
          method: "vscode-extension",
          nativeHosts: ["copilot-vscode"],
          manifestEntry: "fixture.asset-c",
        },
      }),
    );

    await assert.rejects(
      manageNativeInstall(projectRoot, [
        "--host",
        "vscode",
        "--operation",
        "verify",
      ]),
      /Native verify failed for 1 extension\(s\)\./u,
    );

    const nativeState = await readJsonFile<{
      operation: string;
      results: NativeInstallResult[];
    }>(join(projectRoot, ...NATIVE_INSTALL_STATE_OUTPUT_PATH));
    assert.equal(nativeState.operation, "verify");
    assert.equal(nativeState.results[0]?.success, false);
    assert.equal(nativeState.results[0]?.installed, false);
  } finally {
    fakeCode.restore();
    await rm(projectRoot, { force: true, recursive: true });
  }
});
