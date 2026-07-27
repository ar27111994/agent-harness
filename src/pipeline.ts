import { join } from "node:path";

import { getRuntimeConfig, type RuntimeConfig } from "./config/runtime.js";
import { readJsonFileOrNull, type JsonValidator } from "./files.js";
import { runDiscover } from "./discover.js";
import { runMirror } from "./mirror.js";
import { assertInstallProgressState } from "./manifest-validation/install.js";
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
  progressWriter: (message: string) => void,
): void {
  progressWriter(`[workspace] ${step}/${total} ${description}...`);
}

/**
 * Defines injectable workspace pipeline dependencies for deterministic tests.
 */
export interface WorkspacePipelineDependencies {
  getRuntimeConfig(): RuntimeConfig;
  readJsonFileOrNull<T>(
    path: string,
    validator?: JsonValidator<T>,
  ): Promise<T | null>;
  runDiscover(
    args: string[],
    workspaceRoot: string,
    projectRoot: string,
  ): Promise<unknown>;
  runRecommend(
    args: string[],
    workspaceRoot: string,
    projectRoot: string,
  ): Promise<unknown>;
  runMirror(
    args: string[],
    workspaceRoot: string,
    projectRoot: string,
  ): Promise<unknown>;
  runInstall(
    args: string[],
    workspaceRoot: string,
    projectRoot: string,
  ): Promise<unknown>;
  runActivate(
    args: string[],
    workspaceRoot: string,
    projectRoot: string,
  ): Promise<unknown>;
  writeWorkspaceProgress(message: string): void;
}

const DEFAULT_WORKSPACE_PIPELINE_DEPENDENCIES: WorkspacePipelineDependencies = {
  getRuntimeConfig,
  readJsonFileOrNull,
  runDiscover,
  runRecommend,
  runMirror,
  runInstall,
  runActivate,
  writeWorkspaceProgress,
};

function resolveWorkspacePipelineDependencies(
  overrides: Partial<WorkspacePipelineDependencies> = {},
): WorkspacePipelineDependencies {
  return {
    ...DEFAULT_WORKSPACE_PIPELINE_DEPENDENCIES,
    ...overrides,
  };
}

/**
 * Runs discover, recommendation, mirror, stage/install, activation, and shared
 * activation phases for a workspace before the selected adapter performs final
 * wire-in.
 */
export async function runWorkspacePipeline(
  options: {
    projectRoot: string;
    workspaceRoot: string;
    targetHost: "copilot-vscode" | "opencode";
    recommendationHost: HostTarget;
    sessionIntent: SessionIntent;
    sessionIntents?: readonly SessionIntent[];
    bundleIds: string[];
  },
  dependencyOverrides: Partial<WorkspacePipelineDependencies> = {},
): Promise<void> {
  const {
    projectRoot,
    workspaceRoot,
    targetHost,
    recommendationHost,
    sessionIntent,
    sessionIntents,
    bundleIds,
  } = options;
  const dependencies =
    resolveWorkspacePipelineDependencies(dependencyOverrides);
  const resolvedIntents: readonly SessionIntent[] =
    sessionIntents && sessionIntents.length > 1
      ? sessionIntents
      : [sessionIntent];
  const primaryIntent = resolvedIntents[0];
  const config = dependencies.getRuntimeConfig();
  const mirrorBatchSize = String(config.batches.mirrorAcquire);
  const installBatchSize = String(config.batches.installBundle);

  logWorkspacePhase(
    1,
    11,
    "Scanning workspace demand",
    dependencies.writeWorkspaceProgress,
  );
  await dependencies.runDiscover(
    ["demand-profile"],
    workspaceRoot,
    projectRoot,
  );
  logWorkspacePhase(
    2,
    11,
    "Refreshing source index",
    dependencies.writeWorkspaceProgress,
  );
  await dependencies.runDiscover(["sources"], workspaceRoot, projectRoot);
  logWorkspacePhase(
    3,
    11,
    "Syncing indexed sources",
    dependencies.writeWorkspaceProgress,
  );
  await dependencies.runDiscover(["sync"], workspaceRoot, projectRoot);
  logWorkspacePhase(
    4,
    11,
    "Refreshing source index after sync",
    dependencies.writeWorkspaceProgress,
  );
  await dependencies.runDiscover(["sources"], workspaceRoot, projectRoot);
  logWorkspacePhase(
    5,
    11,
    "Building discovery catalog",
    dependencies.writeWorkspaceProgress,
  );
  await dependencies.runDiscover(["catalog"], workspaceRoot, projectRoot);
  logWorkspacePhase(
    6,
    11,
    "Applying selection rules",
    dependencies.writeWorkspaceProgress,
  );
  await dependencies.runDiscover(["select"], workspaceRoot, projectRoot);
  logWorkspacePhase(
    7,
    11,
    "Ranking recommendations",
    dependencies.writeWorkspaceProgress,
  );
  const recommendResult = await dependencies.runRecommend(
    ["report", ...resolvedIntents.flatMap((intent) => ["--intent", intent])],
    workspaceRoot,
    projectRoot,
  );
  const recommendExitCode = recommendResult;
  if (typeof recommendExitCode !== "number") {
    throw new Error(
      "recommend phase returned a non-number exit code — " +
        "expected 0 for success or non-zero for failure. " +
        `Got: ${String(recommendExitCode)}`,
    );
  }
  if (recommendExitCode !== 0) {
    throw new Error(
      "recommend phase failed — no recommendations could be produced. " +
        "Run 'discover full' or 'discover select' to build the catalog " +
        "before running 'recommend'.",
    );
  }
  logWorkspacePhase(
    8,
    11,
    "Planning mirror work",
    dependencies.writeWorkspaceProgress,
  );
  await dependencies.runMirror(["plan"], workspaceRoot, projectRoot);
  logWorkspacePhase(
    9,
    11,
    "Preparing mirror locks",
    dependencies.writeWorkspaceProgress,
  );
  await dependencies.runMirror(["locks"], workspaceRoot, projectRoot);
  logWorkspacePhase(
    10,
    11,
    "Acquiring and staging assets",
    dependencies.writeWorkspaceProgress,
  );
  await acquireAllMirrorBatches(
    projectRoot,
    workspaceRoot,
    mirrorBatchSize,
    dependencies,
  );
  await installBundleBatches(
    projectRoot,
    workspaceRoot,
    bundleIds,
    installBatchSize,
    dependencies,
  );
  await dependencies.runInstall(["reconcile"], workspaceRoot, projectRoot);
  logWorkspacePhase(
    11,
    11,
    "Activating host views",
    dependencies.writeWorkspaceProgress,
  );
  await dependencies.runActivate(
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
  await dependencies.runActivate(
    ["host", "--host", "shared", "--intent", primaryIntent],
    workspaceRoot,
    projectRoot,
  );
}

/**
 * Repeatedly acquires mirror artifacts until the checkpoint reports completion
 * or the safety batch limit is reached.
 */
export async function acquireAllMirrorBatches(
  projectRoot: string,
  workspaceRoot: string,
  batchSize: string,
  dependencyOverrides: Partial<WorkspacePipelineDependencies> = {},
): Promise<void> {
  const dependencies =
    resolveWorkspacePipelineDependencies(dependencyOverrides);
  const maxBatches = 200;

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    dependencies.writeWorkspaceProgress(
      `[workspace] mirror batch ${batchIndex + 1} acquiring artifacts...`,
    );
    await dependencies.runMirror(
      ["acquire", "--batch-size", batchSize],
      workspaceRoot,
      projectRoot,
    );
    const state = await dependencies.readJsonFileOrNull<MirrorAcquireState>(
      join(projectRoot, ...MIRROR_ACQUIRE_STATE_PATH),
      (value) => {
        assertMirrorAcquireState(value, "workspace pipeline");
        return value as MirrorAcquireState;
      },
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
export async function installBundleBatches(
  projectRoot: string,
  workspaceRoot: string,
  bundleIds: string[],
  batchSize: string,
  dependencyOverrides: Partial<WorkspacePipelineDependencies> = {},
): Promise<void> {
  const dependencies =
    resolveWorkspacePipelineDependencies(dependencyOverrides);
  const maxBatchesPerBundle = 200;

  for (const bundleId of bundleIds) {
    dependencies.writeWorkspaceProgress(
      `[workspace] staging bundle '${bundleId}'...`,
    );
    for (
      let batchIndex = 0;
      batchIndex < maxBatchesPerBundle;
      batchIndex += 1
    ) {
      dependencies.writeWorkspaceProgress(
        `[workspace] install batch ${batchIndex + 1} for bundle '${bundleId}'...`,
      );
      await dependencies.runInstall(
        ["bundle", "--bundle", bundleId, "--batch-size", batchSize],
        workspaceRoot,
        projectRoot,
      );
      const progressState =
        await dependencies.readJsonFileOrNull<InstallProgressState>(
          join(projectRoot, ...INSTALL_PROGRESS_STATE_PATH),
          (value) => {
            assertInstallProgressState(value, "workspace pipeline");
            return value as InstallProgressState;
          },
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
