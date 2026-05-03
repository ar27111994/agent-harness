import { join } from "node:path";

import { getRuntimeConfig } from "./config/runtime.js";
import { readJsonFileOrNull, removePath, toPosixPath } from "./files.js";
import { runDiscover } from "./discover.js";
import { runMirror } from "./mirror.js";
import { runInstall } from "./install.js";
import { runRecommend } from "./recommend.js";
import { runActivate } from "./activate.js";
import type {
  BundleLock,
  InstallProgressState,
  MirrorAcquireState,
} from "./types.js";

const MIRROR_ACQUIRE_STATE_PATH = ["state", "mirror", "acquire-state.json"];
const INSTALL_PROGRESS_STATE_PATH = ["state", "install", "progress.json"];
const BUNDLE_LOCK_FILE_NAMES = [
  "opencode-global.lock.json",
  "copilot-core.lock.json",
  "shared-mcp.lock.json",
  "community-stable.lock.json",
];

export async function runRebuild(
  args: string[],
  _workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [command = "help"] = args;

  switch (command) {
    case "clean":
      await cleanState(projectRoot);
      return 0;
    case "full":
      await cleanState(projectRoot);
      await runDiscover(["demand-profile"], projectRoot, projectRoot);
      await runDiscover(["sources"], projectRoot, projectRoot);
      await runDiscover(["catalog"], projectRoot, projectRoot);
      await runDiscover(["select"], projectRoot, projectRoot);
      await runRecommend(["report"], projectRoot, projectRoot);
      await runMirror(["plan"], projectRoot, projectRoot);
      await runMirror(["locks"], projectRoot, projectRoot);
      await acquireAllMirrorBatches(projectRoot);
      await installAllBundleBatches(projectRoot);
      await runInstall(["reconcile"], projectRoot, projectRoot);
      await runActivate(["host"], projectRoot, projectRoot);
      return 0;
    case "help":
      printRebuildHelp();
      return 0;
    default:
      printRebuildHelp();
      return 1;
  }
}

async function cleanState(projectRoot: string): Promise<void> {
  await removePath(join(projectRoot, "install"));
  await removePath(join(projectRoot, "activate"));
  await removePath(join(projectRoot, "state", "install"));
  await removePath(join(projectRoot, "state", "mirror"));
  console.log(
    `Cleaned install/activate transient state under ${toPosixPath(projectRoot)}`,
  );
}

async function acquireAllMirrorBatches(projectRoot: string): Promise<void> {
  const batchSize = String(getRuntimeConfig().batches.mirrorAcquire);
  const maxBatches = 200;

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    await runMirror(
      ["acquire", "--batch-size", batchSize],
      projectRoot,
      projectRoot,
    );
    const state = await readJsonFileOrNull<MirrorAcquireState>(
      join(projectRoot, ...MIRROR_ACQUIRE_STATE_PATH),
    );
    if (!state || state.remainingCount <= 0) {
      return;
    }
  }

  throw new Error(
    "mirror acquire did not complete within the maximum batch count",
  );
}

async function installAllBundleBatches(projectRoot: string): Promise<void> {
  const bundleIds = await discoverBundleIds(projectRoot);
  const batchSize = String(getRuntimeConfig().batches.installBundle);
  const maxBatchesPerBundle = 200;

  for (const bundleId of bundleIds) {
    for (
      let batchIndex = 0;
      batchIndex < maxBatchesPerBundle;
      batchIndex += 1
    ) {
      await runInstall(
        ["bundle", "--bundle", bundleId, "--batch-size", batchSize],
        projectRoot,
        projectRoot,
      );
      const progressState = await readJsonFileOrNull<InstallProgressState>(
        join(projectRoot, ...INSTALL_PROGRESS_STATE_PATH),
      );
      const bundleState = progressState?.bundles[bundleId];
      if (!bundleState || bundleState.remainingAssets <= 0) {
        break;
      }

      if (batchIndex === maxBatchesPerBundle - 1) {
        throw new Error(
          `install batching did not complete for bundle '${bundleId}' within the maximum batch count`,
        );
      }
    }
  }
}

async function discoverBundleIds(projectRoot: string): Promise<string[]> {
  const bundleIds: string[] = [];

  for (const bundleFileName of BUNDLE_LOCK_FILE_NAMES) {
    const bundleLock = await readJsonFileOrNull<BundleLock>(
      join(projectRoot, "mirror", "bundles", bundleFileName),
    );
    if (bundleLock && bundleLock.assets.length > 0) {
      bundleIds.push(bundleLock.bundleId);
    }
  }

  return bundleIds;
}

function printRebuildHelp(): void {
  console.log(`rebuild commands:
  clean   Remove install, activate, and transient state for a clean rebuild
  full    Perform clean + discover + select + mirror + reconcile + activate`);
}
