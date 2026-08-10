import { open, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  copyPath,
  ensureCleanDirectory,
  ensureDirectory,
  pathExists,
  toPosixPath,
  writeJsonFile,
} from "../files.js";
import { getRuntimeConfig } from "../config/runtime.js";
import { resolvePortablePath } from "./paths.js";

/**
 * Defines state root env var shared by the lifecycle pipeline.
 */
export const STATE_ROOT_ENV_VAR = "AGENT_HARNESS_STATE_ROOT";

/**
 * Lock file (per state root) that serializes first-run seeding and refresh
 * of managed state assets across concurrently starting CLI processes.
 */
export const STATE_ROOT_SEED_LOCK_FILE = "state-root.seed.lock";

const STATE_ASSET_PATHS = [
  ["discover", "sources.json"],
  ["discover", "selections.json"],
  ["discover", "official-skills-indexes.json"],
  ["discover", "official-upstreams.json"],
  ["discover", "pipeline.json"],
  ["discover", "source-packs"],
  ["discover", "schema"],
  ["discover", "recommendation-policy", "base.json"],
  ["discover", "recommendation-policy", "hosts"],
  ["discover", "seeds"],
  ["mirror", "policy.json"],
  ["mirror", "schema"],
] as const;

const SEEDED_ONCE_STATE_ASSET_PATHS = new Set([
  "discover/recommendation-policy/base.json",
  "discover/recommendation-policy/hosts",
]);

/**
 * Describes state root resolution options data exchanged by the lifecycle pipeline.
 */
export interface StateRootResolutionOptions {
  packageRoot: string;
  workingDirectory: string;
  explicitStateRoot?: string;
}

/**
 * Describes prepared state root data exchanged by the lifecycle pipeline.
 */
export interface PreparedStateRoot {
  packageRoot: string;
  stateRoot: string;
  usesPackageRoot: boolean;
}

/**
 * Describes seed-lock timing policy data exchanged by the lifecycle pipeline.
 */
export interface StateRootSeedLockPolicy {
  /** Lock files older than this are considered abandoned crash litter. */
  staleAfterMs: number;
  /** Total wall-clock budget for waiting on a live lock holder. */
  waitBudgetMs: number;
  /** Poll interval while waiting for the lock to be released. */
  pollIntervalMs: number;
}

const DEFAULT_SEED_LOCK_POLICY: StateRootSeedLockPolicy = {
  // Seeding copies a few small asset trees and finishes in well under a
  // second; 30s of patience covers pathological first-run contention.
  staleAfterMs: 30_000,
  waitBudgetMs: 30_000,
  pollIntervalMs: 100,
};

let seedLockPolicy: StateRootSeedLockPolicy = DEFAULT_SEED_LOCK_POLICY;

/**
 * Test-only failure-injection seam (#427/#428 pattern, finding R1):
 * replaces the lock-open step so tests can force transient EPERM/EACCES
 * contention deterministically instead of racing the real delete-pending
 * window. `undefined` (the default) restores the real `open(lockPath, "wx")`.
 */
type SeedLockOpenOverride = (
  lockPath: string,
) => Promise<Awaited<ReturnType<typeof open>>>;
let seedLockOpenOverride: SeedLockOpenOverride | undefined;

/**
 * Resolves state root from the provided inputs.
 */
export function resolveStateRoot(
  options: StateRootResolutionOptions,
): PreparedStateRoot {
  const normalizedPackageRoot = resolve(options.packageRoot);
  const normalizedWorkingDirectory = resolve(options.workingDirectory);
  const configuredStateRoot =
    options.explicitStateRoot ?? getRuntimeConfig().env[STATE_ROOT_ENV_VAR];
  const stateRoot = configuredStateRoot
    ? resolvePortablePath(configuredStateRoot, normalizedWorkingDirectory)
    : normalizedWorkingDirectory === normalizedPackageRoot
      ? normalizedPackageRoot
      : resolve(normalizedWorkingDirectory, ".agent-harness");
  const normalizedStateRoot = resolve(stateRoot);

  return {
    packageRoot: normalizedPackageRoot,
    stateRoot: normalizedStateRoot,
    usesPackageRoot: normalizedStateRoot === normalizedPackageRoot,
  };
}

/**
 * Runs a state-root management section under the exclusive per-root seed
 * lock.
 *
 * Concurrent CLI processes starting against the same state root (the real
 * multi-agent scenario) must not race the destructive managed-asset
 * reconciliation: without the lock, two first runs both reached the
 * template copy and one crashed with EEXIST — or worse, one process's
 * `ensureCleanDirectory` deleted a tree the other had just populated.
 * The lock is acquired with O_EXCL so exactly one process holds it; other
 * processes wait (bounded) and then run their own section once the holder
 * releases, preserving the existing per-run refresh semantics.
 *
 * Crash litter is handled: a lock file older than `staleAfterMs` is broken
 * and the acquisition retried; if a live holder exceeds `waitBudgetMs`, a
 * clear error names the lock path for manual cleanup.
 */
export async function runWithStateRootSeedLock(
  stateRoot: string,
  seedSection: () => Promise<void>,
): Promise<void> {
  const lockPath = join(stateRoot, STATE_ROOT_SEED_LOCK_FILE);
  const startedWaitingAt = Date.now();

  for (;;) {
    let lockHandle: Awaited<ReturnType<typeof open>>;
    try {
      lockHandle = seedLockOpenOverride
        ? await seedLockOpenOverride(lockPath)
        : await open(lockPath, "wx");
    } catch (error) {
      if (!isPathExistsError(error) && !isTransientLockOpenError(error)) {
        throw error;
      }
      if (await isStaleLockFile(lockPath)) {
        // Best effort break of abandoned crash litter; force ignores the
        // not-found race where the holder removed it just before us.
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() - startedWaitingAt > seedLockPolicy.waitBudgetMs) {
        throw new Error(
          `Timed out waiting for another process to finish managing the state root: ${toPosixPath(stateRoot)}. If no other agent-harness process is running, remove the stale lock file ${toPosixPath(lockPath)} and retry.`,
          { cause: error },
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, seedLockPolicy.pollIntervalMs),
      );
      continue;
    }

    try {
      await lockHandle.writeFile(
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
        }),
      );
      await seedSection();
    } finally {
      await lockHandle.close();
      // Force ignores the not-found race: the section itself may have
      // removed the lock, and the holder is the only legitimate remover.
      await rm(lockPath, { force: true });
    }
    return;
  }
}

/**
 * Provides prepare state root for the lifecycle pipeline.
 */
export async function prepareStateRoot(
  preparedRoot: PreparedStateRoot,
): Promise<void> {
  await ensureDirectory(preparedRoot.stateRoot);

  if (preparedRoot.usesPackageRoot) {
    return;
  }

  if (isPathWithinRoot(preparedRoot.stateRoot, preparedRoot.packageRoot)) {
    throw new Error(
      `Refusing to use a state root that contains the package root: ${toPosixPath(preparedRoot.stateRoot)}`,
    );
  }

  await runWithStateRootSeedLock(preparedRoot.stateRoot, async () => {
    for (const pathSegments of STATE_ASSET_PATHS) {
      const sourcePath = resolve(preparedRoot.packageRoot, ...pathSegments);
      if (!(await pathExists(sourcePath))) {
        continue;
      }

      const destinationPath = resolve(preparedRoot.stateRoot, ...pathSegments);
      const managedAssetPath = pathSegments.join("/");
      if (SEEDED_ONCE_STATE_ASSET_PATHS.has(managedAssetPath)) {
        if (!(await pathExists(destinationPath))) {
          await copyPath(sourcePath, destinationPath);
        }
        continue;
      }

      if (pathSegments.at(-1)?.includes(".")) {
        await copyPath(sourcePath, destinationPath);
        continue;
      }

      await ensureCleanDirectory(destinationPath);
      await copyPath(sourcePath, destinationPath);
    }

    await writeJsonFile(resolve(preparedRoot.stateRoot, "state-root.json"), {
      schemaVersion: 1,
      packageRoot: toPosixPath(preparedRoot.packageRoot),
      stateRoot: toPosixPath(preparedRoot.stateRoot),
      generatedAt: new Date().toISOString(),
      managedAssets: STATE_ASSET_PATHS.map((segments) => segments.join("/")),
    });
  });
}

/**
 * Exposes test-only hooks for the state-root seed lock (#428 cross-process
 * hardening): deterministic policy overrides and direct section execution.
 */
export const stateRootInternals = {
  /**
   * Runs a section under the exclusive state-root seed lock.
   */
  runSeedSectionForTests: runWithStateRootSeedLock,
  /**
   * Returns whether a lock file is old enough to be treated as abandoned
   * crash litter, given the current seed-lock policy.
   */
  isStaleLockFileForTests: isStaleLockFile,
  /**
   * Returns whether a filesystem error means the lock file already exists.
   */
  isPathExistsErrorForTests: isPathExistsError,
  /**
   * Replaces the seed-lock timing policy (stale age / wait budget / poll
   * interval) so tests can exercise the stale-break and timeout branches
   * deterministically instead of waiting on real timers.
   */
  setSeedLockPolicyForTests(policy: StateRootSeedLockPolicy): void {
    seedLockPolicy = policy;
  },
  /**
   * Restores the default seed-lock timing policy.
   */
  resetSeedLockPolicyForTests(): void {
    seedLockPolicy = DEFAULT_SEED_LOCK_POLICY;
  },
  /**
   * Test-only failure injection: replaces the lock-open step (finding R1).
   * Pass `undefined` to restore the real open.
   */
  setSeedLockOpenOverrideForTests(
    override: SeedLockOpenOverride | undefined,
  ): void {
    seedLockOpenOverride = override;
  },
};

function isPathWithinRoot(containerPath: string, innerPath: string): boolean {
  const relativePath = relative(resolve(containerPath), resolve(innerPath));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

/** Returns whether a filesystem error means the lock file already exists. */
function isPathExistsError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  return code === "EEXIST";
}

/**
 * Returns whether a filesystem error is transient seed-lock contention.
 *
 * On Windows, open(path, "wx") during the holder's close→rm delete-pending
 * window returns EPERM (ERROR_ACCESS_DENIED) — or occasionally EACCES —
 * rather than EEXIST, because the directory entry still exists while the
 * delete is pending. Treating only EEXIST as contention crashed with a raw
 * stack under the rare race (#428 class; finding R1). These codes are
 * therefore treated as "the lock is effectively present" and retried under
 * the same stale-break + wait-budget policy; a genuine permission problem
 * then surfaces as the descriptive timeout guidance instead of a crash.
 */
function isTransientLockOpenError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  return code === "EPERM" || code === "EACCES";
}

/** Returns whether a lock file is old enough to be abandoned crash litter. */
async function isStaleLockFile(lockPath: string): Promise<boolean> {
  try {
    const lockInfo = await stat(lockPath);
    return Date.now() - lockInfo.mtimeMs > seedLockPolicy.staleAfterMs;
  } catch {
    // The holder removed the lock between our failed open and this stat;
    // the next loop iteration re-attempts acquisition instead.
    return false;
  }
}
