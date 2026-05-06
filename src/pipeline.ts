import { join } from "node:path";

import { getRuntimeConfig } from "./config/runtime.js";
import { readJsonFileOrNull } from "./files.js";
import { runDiscover } from "./discover.js";
import { runMirror } from "./mirror.js";
import { assertMirrorAcquireState } from "./manifest-validation/mirror.js";
import { assertMirrorAcquireCheckpoint } from "./mirror/acquire-state.js";
import { runInstall } from "./install.js";
import { runRecommend } from "./recommend.js";
import { runActivate } from "./activate.js";
import type {
  HostTarget,
  InstallProgressState,
  MirrorAcquireState,
} from "./types.js";

const MIRROR_ACQUIRE_STATE_PATH = ["state", "mirror", "acquire-state.json"];
const INSTALL_PROGRESS_STATE_PATH = ["state", "install", "progress.json"];

/**
 * Runs discover, mirror, install, activation, and shared activation phases for
 * a workspace before the selected adapter performs final wire-in.
 */
export async function runWorkspacePipeline(options: {
  projectRoot: string;
  workspaceRoot: string;
  targetHost: "copilot-vscode" | "opencode";
  recommendationHost: HostTarget;
  sessionIntent: string;
  bundleIds: string[];
}): Promise<void> {
  const {
    projectRoot,
    workspaceRoot,
    targetHost,
    recommendationHost,
    sessionIntent,
    bundleIds,
  } = options;
  const config = getRuntimeConfig();
  const mirrorBatchSize = String(config.batches.mirrorAcquire);
  const installBatchSize = String(config.batches.installBundle);

  await runDiscover(["demand-profile"], workspaceRoot, projectRoot);
  await runDiscover(["sources"], workspaceRoot, projectRoot);
  await runDiscover(["catalog"], workspaceRoot, projectRoot);
  await runDiscover(["select"], workspaceRoot, projectRoot);
  await runRecommend(["report"], workspaceRoot, projectRoot);
  await runMirror(["plan"], workspaceRoot, projectRoot);
  await runMirror(["locks"], workspaceRoot, projectRoot);
  await acquireAllMirrorBatches(projectRoot, workspaceRoot, mirrorBatchSize);
  await installBundleBatches(
    projectRoot,
    workspaceRoot,
    bundleIds,
    installBatchSize,
  );
  await runInstall(["reconcile"], workspaceRoot, projectRoot);
  await runActivate(
    [
      "host",
      "--host",
      targetHost,
      "--recommendation-host",
      recommendationHost,
      "--intent",
      sessionIntent,
    ],
    workspaceRoot,
    projectRoot,
  );
  await runActivate(
    ["host", "--host", "shared", "--intent", sessionIntent],
    workspaceRoot,
    projectRoot,
  );
}

/**
 * Repeatedly acquires mirror artifacts until the checkpoint reports completion
 * or the safety batch limit is reached.
 */
async function acquireAllMirrorBatches(
  projectRoot: string,
  workspaceRoot: string,
  batchSize: string,
): Promise<void> {
  const maxBatches = 200;

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    await runMirror(
      ["acquire", "--batch-size", batchSize],
      workspaceRoot,
      projectRoot,
    );
    const state = await readJsonFileOrNull<MirrorAcquireState>(
      join(projectRoot, ...MIRROR_ACQUIRE_STATE_PATH),
      assertMirrorAcquireState,
    );
    if (assertMirrorAcquireCheckpoint(state, "workspace pipeline")) {
      return;
    }
  }

  throw new Error(
    "mirror acquire did not complete within the maximum batch count",
  );
}

/**
 * Installs every requested bundle in batches until each bundle is fully staged
 * or the safety batch limit is reached.
 */
async function installBundleBatches(
  projectRoot: string,
  workspaceRoot: string,
  bundleIds: string[],
  batchSize: string,
): Promise<void> {
  const maxBatchesPerBundle = 200;

  for (const bundleId of bundleIds) {
    for (
      let batchIndex = 0;
      batchIndex < maxBatchesPerBundle;
      batchIndex += 1
    ) {
      await runInstall(
        ["bundle", "--bundle", bundleId, "--batch-size", batchSize],
        workspaceRoot,
        projectRoot,
      );
      const progressState = await readJsonFileOrNull<InstallProgressState>(
        join(projectRoot, ...INSTALL_PROGRESS_STATE_PATH),
      );
      if (!progressState) {
        throw new Error(
          `install bundle did not produce progress state for bundle '${bundleId}'`,
        );
      }

      const bundleState = progressState.bundles[bundleId];
      if (!bundleState) {
        throw new Error(
          `install bundle did not produce progress for bundle '${bundleId}'`,
        );
      }

      if (bundleState.remainingAssets <= 0) {
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
