import { join } from "node:path";

import {
  copyPath,
  ensureDirectory,
  listFilesRecursive,
  pathExists,
  readJsonFile,
  readJsonFileOrNull,
  readJsonLinesFile,
  removePath,
  toPosixPath,
  writeJsonFile,
  writeJsonFileWithSnapshot,
} from "./files.js";
import {
  assertAssetCatalogEntry,
  assertBundleLock,
  assertInstallGenerationManifest,
  assertInstallProgressState,
  assertInstalledBundleManifest,
  assertInstalledPackageManifest,
  assertMirrorIndexEntry,
} from "./manifest-validation.js";
import type {
  AssetCatalogEntry,
  BundleLock,
  InstallGenerationManifest,
  InstallProgressState,
  InstalledBundleManifest,
  InstalledPackageManifest,
  MirrorIndexEntry,
} from "./types.js";

const INSTALL_PROGRESS_STATE_OUTPUT_PATH = [
  "state",
  "install",
  "progress.json",
];
const INSTALL_GENERATIONS_ROOT = ["install", "generations"];
const INSTALL_PROGRESS_SNAPSHOT_OUTPUT_PATH = [
  "state",
  "install",
  "progress.previous.json",
];

export async function runInstall(
  args: string[],
  _workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [command = "help", ...rest] = args;

  switch (command) {
    case "bundle":
      await installBundles(projectRoot, rest);
      return 0;
    case "reconcile":
      await reconcileInstallState(projectRoot);
      return 0;
    case "diff":
      await diffInstallState(projectRoot, rest);
      return 0;
    case "explain":
      await explainInstalledAsset(projectRoot, rest);
      return 0;
    case "generations":
      await manageInstallGenerations(projectRoot, rest);
      return 0;
    case "reset":
      await resetInstallState(projectRoot);
      return 0;
    case "help":
      printInstallHelp();
      return 0;
    default:
      printInstallHelp();
      return 1;
  }
}

async function installBundles(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const mirrorIndexEntries = await readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, "mirror", "index.jsonl"),
    assertMirrorIndexEntry,
  );
  const mirrorIndexById = new Map(
    mirrorIndexEntries.map((entry) => [entry.mirrorId, entry]),
  );
  const selectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
    assertAssetCatalogEntry,
  );
  const selectedEntryById = new Map(
    selectedEntries.map((entry) => [entry.id, entry]),
  );
  const allBundlePaths = [
    join(projectRoot, "mirror", "bundles", "opencode-global.lock.json"),
    join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
    join(projectRoot, "mirror", "bundles", "shared-mcp.lock.json"),
    join(projectRoot, "mirror", "bundles", "community-stable.lock.json"),
  ];
  const targetBundleIds = getOptionValues(args, "--bundle");
  const batchSizeRaw = Number(getOptionValue(args, "--batch-size") ?? "250");
  const batchSize = Number.isFinite(batchSizeRaw) && batchSizeRaw >= 1
    ? Math.min(Math.floor(batchSizeRaw), Number.MAX_SAFE_INTEGER)
    : 250;
  const manualBatchOffsetRaw = Number(getOptionValue(args, "--offset") ?? "0");
  const manualBatchOffset = Number.isFinite(manualBatchOffsetRaw) && manualBatchOffsetRaw >= 0
    ? Math.min(Math.floor(manualBatchOffsetRaw), Number.MAX_SAFE_INTEGER)
    : 0;
  const bundlePaths =
    targetBundleIds.length > 0
      ? allBundlePaths.filter((bundlePath) =>
          targetBundleIds.includes(extractBundleId(bundlePath)),
        )
      : allBundlePaths;

  for (const bundlePath of bundlePaths) {
    if (!(await pathExists(bundlePath))) {
      continue;
    }

    const bundleLock = await readJsonFile<BundleLock>(
      bundlePath,
      assertBundleLock,
    );
    const packageManifests: InstalledBundleManifest["packages"] = [];
    const currentBundleAssetIds = new Set(
      bundleLock.assets.map((asset) => asset.assetId),
    );
    const existingBundleManifest =
      await readJsonFileOrNull<InstalledBundleManifest>(
        join(
          projectRoot,
          "install",
          bundleLock.host,
          "bundles",
          `${bundleLock.bundleId}.install.json`,
        ),
        assertInstalledBundleManifest,
      );
    const existingRelevantPackages = (
      existingBundleManifest?.packages ?? []
    ).filter((pkg) => currentBundleAssetIds.has(pkg.assetId));
    const alreadyInstalledAssetIds = new Set(
      existingRelevantPackages.map((pkg) => pkg.assetId),
    );
    const installableAssets = getInstallableAssets(
      bundleLock.assets,
      mirrorIndexById,
    );
    const pendingAssets = getPendingAssets(
      installableAssets,
      alreadyInstalledAssetIds,
    );
    const assetsToInstall = pendingAssets.slice(
      manualBatchOffset,
      manualBatchOffset + batchSize,
    );

    for (const asset of assetsToInstall) {
      const mirrorEntry = mirrorIndexById.get(asset.mirrorId);
      if (!mirrorEntry) {
        continue;
      }

      if (mirrorEntry.status === "quarantined") {
        continue;
      }

      const catalogEntry = selectedEntryById.get(asset.assetId);
      if (!catalogEntry) {
        continue;
      }

      const sourceMaterialPath = join(
        projectRoot,
        "mirror",
        "raw",
        sanitizeMirrorId(mirrorEntry.mirrorId),
      );
      if (!(await pathExists(sourceMaterialPath))) {
        continue;
      }

      const packageRoot = join(
        projectRoot,
        "install",
        bundleLock.host,
        "packages",
        sanitizeAssetId(asset.assetId),
      );
      const filesRoot = join(packageRoot, "files");
      await copyPath(sourceMaterialPath, filesRoot);

      const packageManifest: InstalledPackageManifest = {
        schemaVersion: 1,
        assetId: asset.assetId,
        mirrorId: asset.mirrorId,
        host: bundleLock.host,
        installedAt: new Date().toISOString(),
        projectionType: asset.projectionType,
        assetKind: catalogEntry.assetKind,
        sourceAuthorityTier: catalogEntry.source.authorityTier,
        contextCost: catalogEntry.contextCost,
        portfolioFit: catalogEntry.fit.portfolioFit,
        filesRoot: toPosixPath(filesRoot),
        bundleMembership: [bundleLock.bundleId],
        activationEligible: asset.activationEligible,
        activeByDefault: false,
      };

      const manifestPath = join(packageRoot, "install-manifest.json");
      await writeJsonFile(manifestPath, packageManifest);
      packageManifests.push({
        assetId: asset.assetId,
        mirrorId: asset.mirrorId,
        manifestPath: toPosixPath(manifestPath),
      });
    }

    const bundleManifest: InstalledBundleManifest = {
      schemaVersion: 1,
      bundleId: bundleLock.bundleId,
      host: bundleLock.host,
      installedAt: new Date().toISOString(),
      packages: mergeInstalledPackages(
        existingRelevantPackages,
        packageManifests,
      ),
    };

    await writeJsonFile(
      join(
        projectRoot,
        "install",
        bundleLock.host,
        "bundles",
        `${bundleLock.bundleId}.install.json`,
      ),
      bundleManifest,
    );

    await updateInstallProgressState(
      projectRoot,
      bundleLock.bundleId,
      bundleLock.host,
      batchSize,
      installableAssets,
      bundleManifest.packages,
      assetsToInstall.map((asset) => asset.assetId),
    );
  }

  const progressState = await readJsonFileOrNull<InstallProgressState>(
    join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH),
    assertInstallProgressState,
  );
  if (progressState) {
    await writeInstallGenerations(projectRoot, progressState);
  }

  console.log(
    `Installed bundles written under ${toPosixPath(join(projectRoot, "install"))}`,
  );
}

function mergeInstalledPackages(
  existingPackages: InstalledBundleManifest["packages"],
  newPackages: InstalledBundleManifest["packages"],
): InstalledBundleManifest["packages"] {
  const packagesByAssetId = new Map(
    existingPackages.map((pkg) => [pkg.assetId, pkg]),
  );

  for (const pkg of newPackages) {
    packagesByAssetId.set(pkg.assetId, pkg);
  }

  return [...packagesByAssetId.values()].sort((left, right) =>
    left.assetId.localeCompare(right.assetId),
  );
}

function printInstallHelp(): void {
  console.log(`install commands:
  bundle      Stage installed assets from mirror bundle locks
  reconcile   Recompute install progress from bundle install manifests
  diff        Compare current vs previous or explicit install generations
  explain     Explain where an installed asset is present and active
  generations Manage generation list, pinning, and pruning
  reset       Remove install state, packages, bundles, and generations`);
}

function sanitizeMirrorId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-");
}

function sanitizeAssetId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-");
}

function getOptionValue(
  args: string[],
  optionName: string,
): string | undefined {
  const optionIndex = args.indexOf(optionName);

  if (optionIndex === -1) {
    return undefined;
  }

  return args[optionIndex + 1];
}

function getOptionValues(args: string[], optionName: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === optionName) {
      const nextValue = args[index + 1];
      if (nextValue) {
        values.push(nextValue);
      }
    }
  }

  return values;
}

function getPendingAssets(
  bundleAssets: BundleLock["assets"],
  installedAssetIds: Set<string>,
): BundleLock["assets"] {
  return bundleAssets.filter((asset) => !installedAssetIds.has(asset.assetId));
}

function getInstallableAssets(
  bundleAssets: BundleLock["assets"],
  mirrorIndexById: Map<string, MirrorIndexEntry>,
): BundleLock["assets"] {
  return bundleAssets.filter((asset) => {
    const mirrorEntry = mirrorIndexById.get(asset.mirrorId);
    return Boolean(mirrorEntry && mirrorEntry.status !== "quarantined");
  });
}

function extractBundleId(bundlePath: string): string {
  return (
    bundlePath
      .split(/[/\\]/u)
      .at(-1)
      ?.replace(/\.lock\.json$/u, "") ?? bundlePath
  );
}

async function updateInstallProgressState(
  projectRoot: string,
  bundleId: string,
  host: BundleLock["host"],
  batchSize: number,
  allAssets: BundleLock["assets"],
  installedAssets: InstalledBundleManifest["packages"],
  lastBatchAssetIds: string[],
): Promise<void> {
  const currentState = (await readJsonFileOrNull<InstallProgressState>(
    join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH),
    assertInstallProgressState,
  )) ?? {
    schemaVersion: 1,
    updatedAt: new Date(0).toISOString(),
    bundles: {},
  };

  currentState.updatedAt = new Date().toISOString();
  currentState.bundles[bundleId] = {
    host,
    batchSize,
    totalAssets: allAssets.length,
    installedAssets: [...new Set(installedAssets.map((asset) => asset.assetId))]
      .length,
    remainingAssets: Math.max(
      0,
      allAssets.length -
        [...new Set(installedAssets.map((asset) => asset.assetId))].length,
    ),
    lastBatchAssetIds: [...new Set(lastBatchAssetIds)],
  };

  await writeJsonFileWithSnapshot(
    join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH),
    join(projectRoot, ...INSTALL_PROGRESS_SNAPSHOT_OUTPUT_PATH),
    currentState,
  );
}

async function reconcileInstallState(projectRoot: string): Promise<void> {
  const mirrorIndexEntries = await readJsonLinesFile<MirrorIndexEntry>(
    join(projectRoot, "mirror", "index.jsonl"),
    assertMirrorIndexEntry,
  );
  const mirrorIndexById = new Map(
    mirrorIndexEntries.map((entry) => [entry.mirrorId, entry]),
  );
  const hosts: Array<BundleLock["host"]> = [
    "opencode",
    "copilot-vscode",
    "shared",
  ];
  const reconciledState: InstallProgressState = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    bundles: {},
  };

  for (const host of hosts) {
    const bundlesRoot = join(projectRoot, "install", host, "bundles");
    if (!(await pathExists(bundlesRoot))) {
      continue;
    }

    const bundleManifestPaths = (await listFilesRecursive(bundlesRoot)).filter(
      (filePath) => filePath.endsWith(".install.json"),
    );

    for (const bundleManifestPath of bundleManifestPaths) {
      const bundleManifest = await readJsonFile<InstalledBundleManifest>(
        bundleManifestPath,
        assertInstalledBundleManifest,
      );
      const bundleLockPath = join(
        projectRoot,
        "mirror",
        "bundles",
        `${bundleManifest.bundleId}.lock.json`,
      );
      const bundleLock = (await readJsonFileOrNull<BundleLock>(
        bundleLockPath,
        assertBundleLock,
      )) ?? {
        schemaVersion: 1,
        bundleId: bundleManifest.bundleId,
        generatedAt: new Date(0).toISOString(),
        host,
        assets: [],
      };
      const installableAssets = getInstallableAssets(
        bundleLock.assets,
        mirrorIndexById,
      );
      const currentBundleAssetIds = new Set(
        installableAssets.map((asset) => asset.assetId),
      );
      const uniqueInstalledAssetIds = [
        ...new Set(
          bundleManifest.packages
            .map((pkg) => pkg.assetId)
            .filter((assetId) => currentBundleAssetIds.has(assetId)),
        ),
      ];

      reconciledState.bundles[bundleManifest.bundleId] = {
        host,
        batchSize: Math.min(250, uniqueInstalledAssetIds.length),
        totalAssets: installableAssets.length,
        installedAssets: uniqueInstalledAssetIds.length,
        remainingAssets: Math.max(
          0,
          installableAssets.length - uniqueInstalledAssetIds.length,
        ),
        lastBatchAssetIds: uniqueInstalledAssetIds.slice(
          -Math.min(50, uniqueInstalledAssetIds.length),
        ),
      };
    }
  }

  await ensureDirectory(join(projectRoot, "state", "install"));
  await writeJsonFileWithSnapshot(
    join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH),
    join(projectRoot, ...INSTALL_PROGRESS_SNAPSHOT_OUTPUT_PATH),
    reconciledState,
  );
  await writeInstallGenerations(projectRoot, reconciledState);
  console.log(
    `Install progress reconciled at ${toPosixPath(join(projectRoot, ...INSTALL_PROGRESS_STATE_OUTPUT_PATH))}`,
  );
}

async function resetInstallState(projectRoot: string): Promise<void> {
  await removePath(join(projectRoot, "install"));
  await removePath(join(projectRoot, "state", "install"));
  console.log(
    `Install state reset under ${toPosixPath(join(projectRoot, "install"))}`,
  );
}

async function writeInstallGenerations(
  projectRoot: string,
  progressState: InstallProgressState,
): Promise<void> {
  const generationId = new Date().toISOString().replace(/[:.]/gu, "-");
  const hosts: Array<BundleLock["host"]> = [
    "opencode",
    "copilot-vscode",
    "shared",
  ];

  for (const host of hosts) {
    const bundleIds = Object.entries(progressState.bundles)
      .filter(([, bundleState]) => bundleState.host === host)
      .map(([bundleId]) => bundleId)
      .sort((left, right) => left.localeCompare(right));

    const packageManifestPaths: string[] = [];

    for (const bundleId of bundleIds) {
      const bundleManifestPath = join(
        projectRoot,
        "install",
        host,
        "bundles",
        `${bundleId}.install.json`,
      );
      const bundleManifest = await readJsonFileOrNull<InstalledBundleManifest>(
        bundleManifestPath,
        assertInstalledBundleManifest,
      );
      if (!bundleManifest) {
        continue;
      }

      const bundleLockPath = join(
        projectRoot,
        "mirror",
        "bundles",
        `${bundleId}.lock.json`,
      );
      const bundleLock = await readJsonFileOrNull<BundleLock>(
        bundleLockPath,
        assertBundleLock,
      );
      const currentBundleAssetIds = new Set(
        (bundleLock?.assets ?? []).map((asset) => asset.assetId),
      );

      for (const pkg of bundleManifest.packages) {
        if (currentBundleAssetIds.has(pkg.assetId)) {
          packageManifestPaths.push(pkg.manifestPath);
        }
      }
    }

    const generationManifest: InstallGenerationManifest = {
      schemaVersion: 1,
      generationId,
      host,
      generatedAt: new Date().toISOString(),
      bundleIds,
      packageManifestPaths: [...new Set(packageManifestPaths)].sort(
        (left, right) => left.localeCompare(right),
      ),
    };

    await ensureDirectory(join(projectRoot, ...INSTALL_GENERATIONS_ROOT, host));
    const currentGenerationPath = join(
      projectRoot,
      ...INSTALL_GENERATIONS_ROOT,
      host,
      "current.json",
    );
    await writeJsonFile(
      join(
        projectRoot,
        ...INSTALL_GENERATIONS_ROOT,
        host,
        `${generationId}.json`,
      ),
      generationManifest,
    );
    await writeJsonFileWithSnapshot(
      currentGenerationPath,
      join(projectRoot, ...INSTALL_GENERATIONS_ROOT, host, "previous.json"),
      generationManifest,
    );
  }
}

const ALLOWED_HOSTS = ["opencode", "copilot-vscode", "shared"] as const;
const GENERATION_ID_PATTERN = /^[A-Za-z0-9._-]+$/u;

function validateHost(value: string | undefined): BundleLock["host"] | undefined {
  if (!value) {
    return undefined;
  }
  if (!ALLOWED_HOSTS.includes(value as BundleLock["host"])) {
    throw new Error(`Invalid host value: ${value}. Must be one of: ${ALLOWED_HOSTS.join(", ")}`);
  }
  return value as BundleLock["host"];
}

function validateGenerationId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (!GENERATION_ID_PATTERN.test(value)) {
    throw new Error(`Invalid generation ID: ${value}. Must contain only alphanumeric characters, dots, underscores, and hyphens.`);
  }
  return value;
}

async function diffInstallState(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const host = validateHost(getOptionValue(args, "--host"));
  const leftGenerationId = validateGenerationId(getOptionValue(args, "--left"));
  const rightGenerationId = validateGenerationId(getOptionValue(args, "--right"));
  const hosts = host
    ? [host]
    : (["opencode", "copilot-vscode", "shared"] as Array<BundleLock["host"]>);

  for (const currentHost of hosts) {
    const leftGeneration = await resolveInstallGenerationManifest(
      projectRoot,
      currentHost,
      leftGenerationId ?? "previous",
    );
    const rightGeneration = await resolveInstallGenerationManifest(
      projectRoot,
      currentHost,
      rightGenerationId ?? "current",
    );

    if (!leftGeneration || !rightGeneration) {
      console.log(`No comparable generations found for ${currentHost}`);
      continue;
    }

    const leftAssets = await loadGenerationAssetIds(leftGeneration);
    const rightAssets = await loadGenerationAssetIds(rightGeneration);
    const bundleDiff = diffStringSets(
      leftGeneration.bundleIds,
      rightGeneration.bundleIds,
    );
    const assetDiff = diffStringSets(leftAssets, rightAssets);

    console.log(
      `Install diff for ${currentHost}: ${leftGeneration.generationId} -> ${rightGeneration.generationId}`,
    );
    console.log(`  Added bundles: ${formatDiffList(bundleDiff.added)}`);
    console.log(`  Removed bundles: ${formatDiffList(bundleDiff.removed)}`);
    console.log(`  Added assets: ${formatDiffList(assetDiff.added)}`);
    console.log(`  Removed assets: ${formatDiffList(assetDiff.removed)}`);
  }
}

async function explainInstalledAsset(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const assetId = getOptionValue(args, "--asset") ?? args[0];

  if (!assetId) {
    throw new Error("explain requires --asset <assetId>");
  }

  const hosts: Array<BundleLock["host"]> = [
    "opencode",
    "copilot-vscode",
    "shared",
  ];
  const lines: string[] = [];

  for (const host of hosts) {
    const packageManifestPath = join(
      projectRoot,
      "install",
      host,
      "packages",
      sanitizeAssetId(assetId),
      "install-manifest.json",
    );
    const packageManifest = await readJsonFileOrNull<InstalledPackageManifest>(
      packageManifestPath,
      assertInstalledPackageManifest,
    );

    if (!packageManifest) {
      continue;
    }

    const currentGeneration = await resolveInstallGenerationManifest(
      projectRoot,
      host,
      "current",
    );
    const isInCurrentGeneration =
      currentGeneration?.packageManifestPaths.includes(
        toPosixPath(packageManifestPath),
      ) ?? false;
    lines.push(`Host ${host}: installed via ${packageManifest.mirrorId}`);
    lines.push(`  bundles: ${packageManifest.bundleMembership.join(", ")}`);
    lines.push(`  files: ${packageManifest.filesRoot}`);
    lines.push(
      `  active generation: ${isInCurrentGeneration ? (currentGeneration?.generationId ?? "current") : "not active"}`,
    );
  }

  if (lines.length === 0) {
    console.log(`Asset ${assetId} is not installed in any host bundle.`);
    return;
  }

  console.log(`Install explain for ${assetId}`);
  console.log(lines.join("\n"));
}

async function manageInstallGenerations(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const [subcommand = "list"] = args;

  switch (subcommand) {
    case "list":
      await listInstallGenerations(projectRoot, args.slice(1));
      return;
    case "pin":
      await pinInstallGeneration(projectRoot, args.slice(1), true);
      return;
    case "unpin":
      await pinInstallGeneration(projectRoot, args.slice(1), false);
      return;
    case "prune":
      await pruneInstallGenerations(projectRoot, args.slice(1));
      return;
    default:
      throw new Error(`Unknown install generations command '${subcommand}'`);
  }
}

async function listInstallGenerations(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const host = validateHost(getOptionValue(args, "--host"));
  const hosts = host
    ? [host]
    : (["opencode", "copilot-vscode", "shared"] as Array<BundleLock["host"]>);

  for (const currentHost of hosts) {
    const manifests = await listGenerationManifests(projectRoot, currentHost);
    console.log(`Install generations for ${currentHost}:`);
    for (const manifest of manifests) {
      console.log(
        `  ${manifest.generationId}${manifest.pinned ? " [pinned]" : ""} bundles=${manifest.bundleIds.length} packages=${manifest.packageManifestPaths.length}`,
      );
    }
  }
}

async function pinInstallGeneration(
  projectRoot: string,
  args: string[],
  pinned: boolean,
): Promise<void> {
  const host = validateHost(getOptionValue(args, "--host"));
  const generationId = validateGenerationId(getOptionValue(args, "--generation"));
  const reason = getOptionValue(args, "--reason");

  if (!host || !generationId) {
    throw new Error("generations pin/unpin requires --host and --generation");
  }

  const generationPath = join(
    projectRoot,
    ...INSTALL_GENERATIONS_ROOT,
    host,
    `${generationId}.json`,
  );
  const generationManifest = await readJsonFile<InstallGenerationManifest>(
    generationPath,
    assertInstallGenerationManifest,
  );
  generationManifest.pinned = pinned;
  generationManifest.pinReason = pinned
    ? (reason ?? "Pinned manually")
    : undefined;
  await writeJsonFile(generationPath, generationManifest);

  const currentGenerationPath = join(
    projectRoot,
    ...INSTALL_GENERATIONS_ROOT,
    host,
    "current.json",
  );
  const currentGeneration = await readJsonFileOrNull<InstallGenerationManifest>(
    currentGenerationPath,
    assertInstallGenerationManifest,
  );

  if (currentGeneration?.generationId === generationManifest.generationId) {
    currentGeneration.pinned = generationManifest.pinned;
    currentGeneration.pinReason = generationManifest.pinReason;
    await writeJsonFile(currentGenerationPath, currentGeneration);
  }

  console.log(
    `${pinned ? "Pinned" : "Unpinned"} generation ${generationId} for ${host}`,
  );
}

async function pruneInstallGenerations(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const host = validateHost(getOptionValue(args, "--host"));
  const keepRaw = Number(getOptionValue(args, "--keep") ?? "2");
  const keep = Number.isFinite(keepRaw) && keepRaw >= 0
    ? Math.min(Math.floor(keepRaw), Number.MAX_SAFE_INTEGER)
    : 2;
  const hosts = host
    ? [host]
    : (["opencode", "copilot-vscode", "shared"] as Array<BundleLock["host"]>);

  for (const currentHost of hosts) {
    const currentGeneration = await resolveInstallGenerationManifest(
      projectRoot,
      currentHost,
      "current",
    );
    const manifests = await listGenerationManifests(projectRoot, currentHost);
    const keepGenerationIds = new Set(
      manifests
        .filter((manifest) => manifest.pinned)
        .map((manifest) => manifest.generationId),
    );

    if (currentGeneration) {
      keepGenerationIds.add(currentGeneration.generationId);
    }

    for (const manifest of manifests.slice(0, Math.max(keep, 0))) {
      keepGenerationIds.add(manifest.generationId);
    }

    for (const manifest of manifests) {
      if (keepGenerationIds.has(manifest.generationId)) {
        continue;
      }

      await removePath(
        join(
          projectRoot,
          ...INSTALL_GENERATIONS_ROOT,
          currentHost,
          `${manifest.generationId}.json`,
        ),
      );
    }

    console.log(
      `Pruned install generations for ${currentHost}; kept ${keepGenerationIds.size}`,
    );
  }
}

async function listGenerationManifests(
  projectRoot: string,
  host: BundleLock["host"],
): Promise<InstallGenerationManifest[]> {
  const generationsRoot = join(projectRoot, ...INSTALL_GENERATIONS_ROOT, host);
  if (!(await pathExists(generationsRoot))) {
    return [];
  }

  const generationFiles = (await listFilesRecursive(generationsRoot))
    .filter((filePath) => filePath.endsWith(".json"))
    .filter((filePath) => !filePath.endsWith("current.json"))
    .filter((filePath) => !filePath.endsWith("previous.json"));

  const manifests = await Promise.all(
    generationFiles.map((filePath) =>
      readJsonFile<InstallGenerationManifest>(
        filePath,
        assertInstallGenerationManifest,
      ),
    ),
  );

  return manifests.sort((left, right) =>
    right.generationId.localeCompare(left.generationId),
  );
}

async function resolveInstallGenerationManifest(
  projectRoot: string,
  host: BundleLock["host"],
  generationId: string,
): Promise<InstallGenerationManifest | null> {
  const fileName = `${generationId}.json`;
  const generationPath = join(
    projectRoot,
    ...INSTALL_GENERATIONS_ROOT,
    host,
    fileName,
  );

  return readJsonFileOrNull<InstallGenerationManifest>(
    generationPath,
    assertInstallGenerationManifest,
  );
}

async function loadGenerationAssetIds(
  generation: InstallGenerationManifest,
): Promise<string[]> {
  const packageManifests = await Promise.all(
    generation.packageManifestPaths.map(async (manifestPath) => {
      try {
        const manifest = await readJsonFileOrNull<InstalledPackageManifest>(
          manifestPath,
          assertInstalledPackageManifest,
        );
        return manifest;
      } catch {
        return null;
      }
    }),
  );

  return packageManifests
    .filter((manifest): manifest is InstalledPackageManifest => manifest !== null)
    .map((manifest) => manifest.assetId)
    .sort((left, right) => left.localeCompare(right));
}

function diffStringSets(
  left: string[],
  right: string[],
): { added: string[]; removed: string[] } {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  return {
    added: [...rightSet]
      .filter((value) => !leftSet.has(value))
      .sort((a, b) => a.localeCompare(b)),
    removed: [...leftSet]
      .filter((value) => !rightSet.has(value))
      .sort((a, b) => a.localeCompare(b)),
  };
}

function formatDiffList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}
