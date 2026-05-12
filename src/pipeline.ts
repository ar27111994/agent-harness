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
  SessionIntent,
} from "./types.js";

const MIRROR_ACQUIRE_STATE_PATH = ["state", "mirror", "acquire-state.json"];
const INSTALL_PROGRESS_STATE_PATH = ["state", "install", "progress.json"];

function writeWorkspaceProgress(message: string): void {
  process.stdout.write(`${message}\n`);
}

function logWorkspacePhase(
  step: number,
  total: number,
  description: string,
): void {
  writeWorkspaceProgress(`[workspace] ${step}/${total} ${description}...`);
}

/**
 * Runs discover, recommendation, mirror, stage/install, activation, and shared
 * activation phases for a workspace before the selected adapter performs final
 * wire-in.
 */
export async function runWorkspacePipeline(options: {
  projectRoot: string;
  workspaceRoot: string;
  targetHost: "copilot-vscode" | "opencode";
  recommendationHost: HostTarget;
  sessionIntent: SessionIntent;
  sessionIntents?: readonly SessionIntent[];
  bundleIds: string[];
}): Promise<void> {
  const {
    projectRoot,
    workspaceRoot,
    targetHost,
    recommendationHost,
    sessionIntent,
    sessionIntents,
    bundleIds,
  } = options;
  const resolvedIntents: readonly SessionIntent[] =
    sessionIntents && sessionIntents.length > 1
      ? sessionIntents
      : [sessionIntent];
  const primaryIntent = resolvedIntents[0];
  const config = getRuntimeConfig();
  const mirrorBatchSize = String(config.batches.mirrorAcquire);
  const installBatchSize = String(config.batches.installBundle);

  logWorkspacePhase(1, 11, "Scanning workspace demand");
  await runDiscover(["demand-profile"], workspaceRoot, projectRoot);
  logWorkspacePhase(2, 11, "Refreshing source index");
  await runDiscover(["sources"], workspaceRoot, projectRoot);
  logWorkspacePhase(3, 11, "Syncing indexed sources");
  await runDiscover(["sync"], workspaceRoot, projectRoot);
  logWorkspacePhase(4, 11, "Refreshing source index after sync");
  await runDiscover(["sources"], workspaceRoot, projectRoot);
  logWorkspacePhase(5, 11, "Building discovery catalog");
  await runDiscover(["catalog"], workspaceRoot, projectRoot);
  logWorkspacePhase(6, 11, "Applying selection rules");
  await runDiscover(["select"], workspaceRoot, projectRoot);
  logWorkspacePhase(7, 11, "Ranking recommendations");
  await runRecommend(
    ["report", ...resolvedIntents.flatMap((i) => ["--intent", i])],
    workspaceRoot,
    projectRoot,
  );
  logWorkspacePhase(8, 11, "Planning mirror work");
  await runMirror(["plan"], workspaceRoot, projectRoot);
  logWorkspacePhase(9, 11, "Preparing mirror locks");
  await runMirror(["locks"], workspaceRoot, projectRoot);
  logWorkspacePhase(10, 11, "Acquiring and staging assets");
  await acquireAllMirrorBatches(projectRoot, workspaceRoot, mirrorBatchSize);
  await installBundleBatches(
    projectRoot,
    workspaceRoot,
    bundleIds,
    installBatchSize,
  );
  await runInstall(["reconcile"], workspaceRoot, projectRoot);
  logWorkspacePhase(11, 11, "Activating host views");
  await runActivate(
    [
      "host",
      "--host",
      targetHost,
      "--recommendation-host",
      recommendationHost,
      "--intent",
      primaryIntent,
    ],
    workspaceRoot,
    projectRoot,
  );
  await runActivate(
    ["host", "--host", "shared", "--intent", primaryIntent],
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
    writeWorkspaceProgress(
      `[workspace] mirror batch ${batchIndex + 1} acquiring artifacts...`,
    );
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
    writeWorkspaceProgress(`[workspace] staging bundle '${bundleId}'...`);
    for (
      let batchIndex = 0;
      batchIndex < maxBatchesPerBundle;
      batchIndex += 1
    ) {
      writeWorkspaceProgress(
        `[workspace] install batch ${batchIndex + 1} for bundle '${bundleId}'...`,
      );
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
