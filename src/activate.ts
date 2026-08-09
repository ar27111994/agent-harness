import { rename } from "node:fs/promises";
import { join } from "node:path";

import {
  copyPath,
  ensureCleanDirectory,
  ensureDirectory,
  pathExists,
  readJsonFile,
  readJsonFileOrNull,
  removePath,
  toPosixPath,
  writeJsonFile,
} from "./files.js";
import {
  handleUnknownCommand,
  hasHelpFlag,
  hasUnknownFlagsForSubcommands,
  type SubcommandFlagSpec,
} from "./cli-help-format.js";
import { getOptionValue, getOptionValues } from "./lib/cli-options.js";
import { parseSessionIntent } from "./lib/session-intent.js";
import { isPathWithinRoot, sanitizeAssetId } from "./lib/safe-paths.js";
import {
  printActivateHelp,
  printActivateSubcommandHelp,
} from "./activate/help.js";

/**
 * Flag spec table for activate subcommands (#445): the shared unknown-flag
 * guard rejects typo'd flags (e.g. --rec-host) before activation work or
 * state writes.
 */
const ACTIVATE_SUBCOMMAND_FLAG_SPECS: Record<string, SubcommandFlagSpec> = {
  host: {
    knownFlags: new Set(["--host", "--recommendation-host", "--intent"]),
    flagsWithValues: new Set(["--host", "--recommendation-host", "--intent"]),
    usageHint: "agent-harness activate host --help",
  },
  diff: {
    knownFlags: new Set(["--host"]),
    flagsWithValues: new Set(["--host"]),
    usageHint: "agent-harness activate diff --help",
  },
  explain: {
    knownFlags: new Set(["--host", "--asset"]),
    flagsWithValues: new Set(["--host", "--asset"]),
    usageHint: "agent-harness activate explain --help",
  },
  rollback: {
    knownFlags: new Set(["--host", "--generation"]),
    flagsWithValues: new Set(["--host", "--generation"]),
    usageHint: "agent-harness activate rollback --help",
  },
  reset: {
    knownFlags: new Set(),
    flagsWithValues: new Set(),
    usageHint: "agent-harness activate reset --help",
  },
};
import {
  ACTIVATION_HOSTS,
  type ActivationHost,
  buildConcernBuckets,
  buildCopilotProfileId,
  buildTaskModeBuckets,
  compareActivationCandidates,
  filterBundleIdsForHost,
  getActivationBudget,
  getDefaultBundleIdsForHost,
  isNegativelyScored,
  selectActivationCandidates,
} from "./activate/selection.js";
import {
  getOptionalOptionValue,
  parseActivationHostOption,
  parseHostTargetOption,
  diffActivationState,
  explainActivationState,
  resetActivationState,
} from "./activate/state.js";
import {
  assertActivationManifest,
  assertInstallGenerationManifest,
  assertInstalledBundleManifest,
  assertInstalledPackageManifest,
  assertRecommendationReport,
} from "./manifest-validation.js";
import type {
  ActivationManifest,
  CopilotWorkspaceOverlayManifest,
  CopilotWorkspaceProfileManifest,
  InstallGenerationManifest,
  InstalledBundleManifest,
  HostTarget,
  InstalledPackageManifest,
  RecommendationReport,
  SessionIntent,
} from "./types.js";

const ACTIVATION_MANIFEST_FILE = "activation-manifest.json";
const ACTIVATION_PREVIOUS_MANIFEST_FILE = "activation-manifest.previous.json";

/**
 * Maximum number of fallback skill IDs added to the Copilot workspace profile
 * manifest when the primary selected set does not contain enough skills.
 * Limiting to 12 ensures the profile remains focused even when many skills are
 * installed; beyond this count the marginal utility per additional skill drops.
 */
const COPILOT_FALLBACK_SKILL_POOL_LIMIT = 12;

/**
 * Dispatches the activate CLI command group.
 */
export async function runActivate(
  args: string[],
  _workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [command = "help", ...rest] = args;

  // Detect --help flag and show subcommand-specific help (#383).
  if (hasHelpFlag(rest)) {
    printActivateSubcommandHelp(command);
    return 0;
  }

  // Strict flag validation before any activation work (#445).
  if (
    hasUnknownFlagsForSubcommands(ACTIVATE_SUBCOMMAND_FLAG_SPECS, command, rest)
  ) {
    return 1;
  }

  switch (command) {
    case "host":
      await activateHosts(projectRoot, rest);
      return 0;
    case "diff":
      await diffActivationState(projectRoot, rest);
      return 0;
    case "explain":
      await explainActivationState(projectRoot, rest);
      return 0;
    case "rollback":
      await rollbackActivation(projectRoot, rest);
      return 0;
    case "reset":
      await resetActivationState(projectRoot);
      return 0;
    case "help":
      printActivateHelp();
      return 0;
    default:
      return handleUnknownCommand(command, printActivateHelp);
  }
}

async function activateHosts(
  projectRoot: string,
  args: string[] = [],
): Promise<void> {
  const sessionIntents = getOptionValues(args, "--intent").map((value) =>
    parseSessionIntent(value),
  );
  const sessionIntent = sessionIntents[0] ?? parseSessionIntent(undefined);
  const requestedRecommendationHost = parseHostTargetOption(
    getOptionalOptionValue(args, "--recommendation-host"),
    "--recommendation-host",
  );
  const requestedHost = parseActivationHostOption(
    getOptionalOptionValue(args, "--host"),
    "--host",
  );
  const hosts: ActivationHost[] = requestedHost
    ? [requestedHost]
    : [...ACTIVATION_HOSTS];

  for (const host of hosts) {
    await activateHost(
      projectRoot,
      host,
      getDefaultBundleIdsForHost(host),
      sessionIntent,
      requestedRecommendationHost ?? host,
    );
  }

  console.log(
    `Activation views written under ${toPosixPath(join(projectRoot, "activate"))}`,
  );
}

async function activateHost(
  projectRoot: string,
  host: ActivationHost,
  bundleIds: string[],
  sessionIntent: SessionIntent,
  recommendationHost: HostTarget = host,
): Promise<void> {
  const activeAssets = new Set<string>();
  const runtimeRoot = join(projectRoot, "activate", host);
  const stagingRuntimeRoot = `${runtimeRoot}.tmp`;
  await ensureDirectory(join(projectRoot, "activate"));
  await ensureCleanDirectory(stagingRuntimeRoot);
  const previousActivationManifest =
    await readJsonFileOrNull<ActivationManifest>(
      join(runtimeRoot, ACTIVATION_MANIFEST_FILE),
      assertActivationManifest,
    );
  const recommendationReport = await readJsonFileOrNull<RecommendationReport>(
    join(projectRoot, "state", "recommendations.json"),
    assertRecommendationReport,
  );
  const activationBudget =
    recommendationReport?.hostSummaries[recommendationHost]?.activationBudget ??
    getActivationBudget(host);
  const currentGeneration = await readJsonFileOrNull<InstallGenerationManifest>(
    join(projectRoot, "install", "generations", host, "current.json"),
    assertInstallGenerationManifest,
  );
  const recommendationEntries =
    recommendationReport?.topByHost[recommendationHost] ?? [];
  const preferredAssetOrder = new Map(
    recommendationEntries.map((entry, index) => [
      entry.assetId,
      entry.rank || index,
    ]),
  );
  const recommendationEntryByAssetId = new Map(
    recommendationEntries.map((entry) => [entry.assetId, entry]),
  );
  const activeBundleIds = filterBundleIdsForHost(
    bundleIds,
    recommendationHost,
    recommendationReport,
  );
  const candidates: Array<{
    packageManifest: InstalledPackageManifest;
    destinationRoot: string;
  }> = [];

  for (const bundleId of activeBundleIds) {
    const bundleManifestPath = join(
      projectRoot,
      "install",
      host,
      "bundles",
      `${bundleId}.install.json`,
    );
    if (!(await pathExists(bundleManifestPath))) {
      continue;
    }

    const bundleManifest = await readJsonFile<InstalledBundleManifest>(
      bundleManifestPath,
      assertInstalledBundleManifest,
    );

    for (const pkg of bundleManifest.packages) {
      if (
        !isPathWithinRoot(join(projectRoot, "install", host), pkg.manifestPath)
      ) {
        throw new Error(
          `Refusing to activate package manifest outside install root: ${pkg.manifestPath}`,
        );
      }

      const packageManifest = await readJsonFile<InstalledPackageManifest>(
        pkg.manifestPath,
        assertInstalledPackageManifest,
      );
      if (
        !isPathWithinRoot(
          join(projectRoot, "install", host, "packages"),
          packageManifest.filesRoot,
        )
      ) {
        throw new Error(
          `Refusing to activate files outside package root: ${packageManifest.filesRoot}`,
        );
      }
      if (
        currentGeneration &&
        !currentGeneration.packageManifestPaths.includes(pkg.manifestPath)
      ) {
        continue;
      }
      if (!packageManifest.activationEligible) {
        continue;
      }
      const destinationRoot = join(
        stagingRuntimeRoot,
        sanitizeAssetId(packageManifest.assetId),
      );
      candidates.push({ packageManifest, destinationRoot });
    }
  }

  const selectedCandidates = selectActivationCandidates(
    candidates,
    preferredAssetOrder,
    recommendationEntryByAssetId,
    activationBudget,
    sessionIntent,
  );

  await writeJsonFile(join(stagingRuntimeRoot, `${host}-overlay-plan.json`), {
    schemaVersion: 1,
    host,
    generatedAt: new Date().toISOString(),
    selectedBundleIds: activeBundleIds,
    selectedAssetIds: selectedCandidates.map(
      (candidate) => candidate.packageManifest.assetId,
    ),
    activationBudget,
    mode:
      host === "copilot-vscode"
        ? "profile-workspace-overlay"
        : host === "opencode"
          ? "global-harness-overlay"
          : "shared-runtime-overlay",
    sessionIntent,
    recommendationHost,
    concernBuckets: buildConcernBuckets(
      selectedCandidates.map((candidate) => candidate.packageManifest.assetId),
      recommendationEntryByAssetId,
    ),
    taskModeBuckets: buildTaskModeBuckets(
      selectedCandidates.map((candidate) => candidate.packageManifest.assetId),
      recommendationEntryByAssetId,
      sessionIntent,
    ),
  } satisfies CopilotWorkspaceOverlayManifest | Record<string, unknown>);

  if (host === "copilot-vscode") {
    const selectedSkillIds = selectedCandidates
      .filter((candidate) => candidate.packageManifest.assetKind === "skill")
      .map((candidate) => candidate.packageManifest.assetId);

    const fallbackSkillIds = candidates
      .map((candidate) => candidate.packageManifest)
      .filter((packageManifest) => packageManifest.assetKind === "skill")
      .filter((packageManifest) => {
        // Same negative-score hard boundary as the main selection (#426).
        const recommendedEntry = recommendationEntryByAssetId.get(
          packageManifest.assetId,
        );
        return !isNegativelyScored(recommendedEntry);
      })
      .sort((left, right) =>
        compareActivationCandidates(
          left,
          right,
          preferredAssetOrder,
          recommendationEntryByAssetId,
          sessionIntent,
        ),
      )
      .slice(0, COPILOT_FALLBACK_SKILL_POOL_LIMIT)
      .map((packageManifest) => packageManifest.assetId);

    const mergedSkillIds = [
      ...new Set([...selectedSkillIds, ...fallbackSkillIds]),
    ];

    const copilotProfileManifest: CopilotWorkspaceProfileManifest = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      profileId: buildCopilotProfileId(
        selectedCandidates.map(
          (candidate) => candidate.packageManifest.assetId,
        ),
      ),
      workspaceRoot: toPosixPath(projectRoot),
      bundleIds: activeBundleIds,
      selectedAssetIds: selectedCandidates.map(
        (candidate) => candidate.packageManifest.assetId,
      ),
      selectedInstructionIds: selectedCandidates
        .filter(
          (candidate) => candidate.packageManifest.assetKind === "instruction",
        )
        .map((candidate) => candidate.packageManifest.assetId),
      selectedAgentIds: selectedCandidates
        .filter((candidate) => candidate.packageManifest.assetKind === "agent")
        .map((candidate) => candidate.packageManifest.assetId),
      selectedWorkflowIds: selectedCandidates
        .filter(
          (candidate) => candidate.packageManifest.assetKind === "workflow",
        )
        .map((candidate) => candidate.packageManifest.assetId),
      selectedPluginIds: selectedCandidates
        .filter((candidate) => candidate.packageManifest.assetKind === "plugin")
        .map((candidate) => candidate.packageManifest.assetId),
      selectedExtensionIds: selectedCandidates
        .filter(
          (candidate) => candidate.packageManifest.assetKind === "extension",
        )
        .map((candidate) => candidate.packageManifest.assetId),
      selectedHookIds: selectedCandidates
        .filter((candidate) => candidate.packageManifest.assetKind === "hook")
        .map((candidate) => candidate.packageManifest.assetId),
      selectedSkillIds: mergedSkillIds,
      selectedPromptPackIds: selectedCandidates
        .filter(
          (candidate) => candidate.packageManifest.assetKind === "prompt-pack",
        )
        .map((candidate) => candidate.packageManifest.assetId),
      selectedReferencePackIds: selectedCandidates
        .filter(
          (candidate) =>
            candidate.packageManifest.assetKind === "reference-pack",
        )
        .map((candidate) => candidate.packageManifest.assetId),
      activationBudget,
      sessionIntent,
    };

    for (const fallbackSkillId of mergedSkillIds) {
      if (!copilotProfileManifest.selectedAssetIds.includes(fallbackSkillId)) {
        copilotProfileManifest.selectedAssetIds.push(fallbackSkillId);
      }
    }

    await writeJsonFile(
      join(stagingRuntimeRoot, "workspace-profile-manifest.json"),
      copilotProfileManifest,
    );
  }

  for (const candidate of selectedCandidates) {
    await copyPath(
      candidate.packageManifest.filesRoot,
      candidate.destinationRoot,
    );
    activeAssets.add(candidate.packageManifest.assetId);
  }

  const activationManifest: ActivationManifest = {
    schemaVersion: 1,
    host,
    generatedAt: new Date().toISOString(),
    generationId: currentGeneration?.generationId,
    recommendationHost,
    activationBudget,
    activeBundles: activeBundleIds,
    activeAssets: [...activeAssets].sort(),
    runtimeRoot: toPosixPath(runtimeRoot),
    notes: [
      "Activation currently materializes staged install outputs into host-specific runtime views.",
      `Token-budget-aware pruning applied with current host budget of ${activationBudget} prompt-weight units.`,
      `Activation ordering is driven by recommendation rank from state/recommendations.json.`,
    ],
  };

  if (previousActivationManifest) {
    await writeJsonFile(
      join(stagingRuntimeRoot, ACTIVATION_PREVIOUS_MANIFEST_FILE),
      previousActivationManifest,
    );
  }
  await writeJsonFile(
    join(stagingRuntimeRoot, ACTIVATION_MANIFEST_FILE),
    activationManifest,
  );

  await swapActivationRuntimeRoot(runtimeRoot, stagingRuntimeRoot);
}

async function swapActivationRuntimeRoot(
  runtimeRoot: string,
  stagingRuntimeRoot: string,
  renameFn: (oldPath: string, newPath: string) => Promise<void> = rename,
): Promise<void> {
  const backupRuntimeRoot = `${runtimeRoot}.previous`;
  await removePath(backupRuntimeRoot);
  const hadRuntimeRoot = await pathExists(runtimeRoot);

  if (hadRuntimeRoot) {
    await renameFn(runtimeRoot, backupRuntimeRoot);
  }

  try {
    await renameFn(stagingRuntimeRoot, runtimeRoot);
  } catch (error) {
    if (hadRuntimeRoot && !(await pathExists(runtimeRoot))) {
      try {
        await renameFn(backupRuntimeRoot, runtimeRoot);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Activation failed and the runtime root rollback also failed — " +
            "the runtime root may be missing. Restore it manually from the " +
            `backup at '${backupRuntimeRoot}' if present.`,
          { cause: rollbackError },
        );
      }
    }
    throw error;
  }

  await removePath(backupRuntimeRoot);
}

async function rollbackActivation(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const host = parseActivationHostOption(
    getOptionalOptionValue(args, "--host"),
    "--host",
  );
  const generationId = getOptionValue(args, "--generation");

  if (!host || !generationId) {
    throw new Error("rollback requires --host and --generation");
  }

  const generationPath = join(
    projectRoot,
    "install",
    "generations",
    host,
    `${generationId}.json`,
  );
  if (!(await pathExists(generationPath))) {
    throw new Error(`generation not found: ${toPosixPath(generationPath)}`);
  }

  const generation = await readJsonFile<InstallGenerationManifest>(
    generationPath,
    assertInstallGenerationManifest,
  );
  await writeJsonFile(
    join(projectRoot, "install", "generations", host, "current.json"),
    generation,
  );
  await activateHosts(projectRoot, ["--host", host]);
}

/**
 * Exposes internal activation helpers for focused test coverage.
 * Not part of the public API.
 */
export const activateInternals = {
  swapActivationRuntimeRoot,
  selectActivationCandidates,
  compareActivationCandidates,
  getActivationBudget,
  buildTaskModeBuckets,
};
