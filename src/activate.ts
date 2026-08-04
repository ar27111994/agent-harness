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
  hasHelpFlag,
  isFlagLike,
  printSubcommandHelp,
  printUnknownArgumentError,
  type SubcommandHelpEntry,
} from "./cli-help-format.js";
import { listHostAdapters } from "./host-adapters/registry.js";
import { printCommandHelp } from "./lib/cli-output.js";
import { getOptionValue, getOptionValues } from "./lib/cli-options.js";
import {
  parseSessionIntent,
  recommendationMatchesSessionIntent,
  SESSION_INTENT_CHOICES,
} from "./lib/session-intent.js";
import { isPathWithinRoot, sanitizeAssetId } from "./lib/safe-paths.js";
import {
  assertActivationManifest,
  assertCopilotWorkspaceProfileManifest,
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
  RecommendationEntry,
  RecommendationReport,
  SessionIntent,
} from "./types.js";

const ACTIVATION_MANIFEST_FILE = "activation-manifest.json";
const ACTIVATION_PREVIOUS_MANIFEST_FILE = "activation-manifest.previous.json";
type ActivationHost = "opencode" | "copilot-vscode" | "shared";
const ACTIVATION_HOSTS = [
  "opencode",
  "copilot-vscode",
  "shared",
] as const satisfies readonly ActivationHost[];
const SHARED_HOST_TARGET = "shared" as const satisfies HostTarget;

/**
 * Maximum character length of a generated Copilot workspace profile ID.
 * IDs are derived by joining asset IDs with hyphens and stripping non-slug
 * characters; truncating at 96 characters keeps them within settings-file
 * limits while remaining unique for practical asset sets.
 */
const COPILOT_PROFILE_ID_MAX_LENGTH = 96;

/**
 * Number of asset ID segments joined before the profile ID is truncated.
 * Using the first 12 IDs balances uniqueness against ID length; longer
 * lists produce IDs that are indistinguishable after truncation anyway.
 */
const COPILOT_PROFILE_ID_ASSET_SEGMENT_COUNT = 12;

/**
 * Per-host activation budgets — maximum number of assets selected for
 * the runtime activation manifest on each host.
 *
 * Copilot VS Code: 60 — bounded by the Copilot chat context window.
 * OpenCode:       120 — larger context tolerance allows a bigger set.
 * Default/shared:  40 — conservative floor for hosts with unknown limits.
 */
const COPILOT_VSCODE_ACTIVATION_BUDGET = 60;
const OPENCODE_ACTIVATION_BUDGET = 120;
const DEFAULT_ACTIVATION_BUDGET = 40;

/**
 * Maximum number of assets placed in the "focused" activation bucket.
 * The focused bucket contains the highest-priority intent-matched assets.
 * Capping at 20 ensures that a single session intent cannot crowd out the
 * broader set when both buckets are merged.
 */
const FOCUSED_ACTIVATION_BUCKET_MAX_SIZE = 20;

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
      if (isFlagLike(command)) {
        printUnknownArgumentError(command);
        return 1;
      }
      printActivateHelp();
      return 1;
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

function filterBundleIdsForHost(
  bundleIds: string[],
  host: HostTarget,
  recommendationReport: RecommendationReport | null,
): string[] {
  const suggestedBundleIds = new Set(
    (recommendationReport?.suggestedBundles ?? [])
      .filter((bundle) => bundle.host === host)
      .map((bundle) => bundle.bundleId),
  );

  if (suggestedBundleIds.size === 0) {
    return bundleIds;
  }

  const filteredBundleIds = bundleIds.filter((bundleId) =>
    suggestedBundleIds.has(bundleId),
  );
  return filteredBundleIds.length > 0 ? filteredBundleIds : bundleIds;
}

function printActivateHelp(): void {
  printCommandHelp({
    heading: "activate commands:",
    entries: [
      {
        command: "host",
        description: "Materialize active host views from installed bundles",
      },
      {
        command: "diff",
        description:
          "Compare current host activation to the previous activation view",
      },
      {
        command: "explain",
        description: "Explain whether an asset is active for a host",
      },
      {
        command: "rollback",
        description: "Point a host to a previous install generation",
      },
      {
        command: "reset",
        description: "Remove activation outputs",
      },
    ],
    sections: [
      {
        title: "Options:",
        lines: [
          "--host <copilot-vscode|opencode|shared>",
          "--recommendation-host <host-policy-id>",
          `--intent <${SESSION_INTENT_CHOICES}> Repeatable; first intent is used for activation context`,
        ],
      },
    ],
  });
}

/**
 * Prints help for a specific activate subcommand (#383).
 */
function printActivateSubcommandHelp(subcommand: string): void {
  const helpTexts: Record<string, SubcommandHelpEntry> = {
    host: {
      heading: "activate host — Materialize active host views",
      lines: [
        "Usage: agent-harness activate host [--host <host>] [--intent <intent>]",
        "",
        "Materializes active host views from installed bundles. Builds host-specific",
        "runtime views (MCP server configs, skill registries, instruction sets) from",
        "the installed asset bundles.",
        "",
        "Options:",
        "  --host <host>                           Target host",
        "  --intent <intent>                       Session intent (repeatable)",
        "  --recommendation-host <host-policy-id>   Override recommendation host policy",
        "",
        "Supported hosts: copilot-vscode, opencode, shared",
      ],
    },
    diff: {
      heading: "activate diff — Compare activation states",
      lines: [
        "Usage: agent-harness activate diff [--host <host>]",
        "",
        "Compares the current host activation view against the previous",
        "activation snapshot, reporting added, removed, and changed assets.",
      ],
    },
    explain: {
      heading: "activate explain — Explain activation state",
      lines: [
        "Usage: agent-harness activate explain --asset <assetId> [--host <host>]",
        "",
        "Explains whether a specific asset is active for a host and why.",
      ],
    },
    rollback: {
      heading: "activate rollback — Roll back to previous generation",
      lines: [
        "Usage: agent-harness activate rollback [--host <host>]",
        "",
        "Points a host back to a previous install generation, reverting",
        "the active asset set to an earlier known-good state.",
      ],
    },
    reset: {
      heading: "activate reset — Remove activation outputs",
      lines: [
        "Usage: agent-harness activate reset",
        "",
        "Removes all activation outputs, resetting the host runtime views",
        "to an empty state.",
      ],
    },
  };

  printSubcommandHelp(subcommand, helpTexts, printActivateHelp);
}

function getDefaultBundleIdsForHost(host: ActivationHost): string[] {
  if (host === "opencode") {
    return ["opencode-global", "community-stable"];
  }

  if (host === "copilot-vscode") {
    return ["copilot-core", "community-stable"];
  }

  return ["shared-mcp"];
}

function buildCopilotProfileId(assetIds: string[]): string {
  return assetIds
    .slice(0, COPILOT_PROFILE_ID_ASSET_SEGMENT_COUNT)
    .join("-")
    .replace(/[^a-zA-Z0-9_-]+/gu, "-")
    .slice(0, COPILOT_PROFILE_ID_MAX_LENGTH);
}

const ACTIVATION_BUDGET_BY_HOST = new Map<ActivationHost, number>([
  ["copilot-vscode", COPILOT_VSCODE_ACTIVATION_BUDGET],
  ["opencode", OPENCODE_ACTIVATION_BUDGET],
]);

function getActivationBudget(host: ActivationHost): number {
  return ACTIVATION_BUDGET_BY_HOST.get(host) ?? DEFAULT_ACTIVATION_BUDGET;
}

function compareActivationCandidates(
  left: InstalledPackageManifest,
  right: InstalledPackageManifest,
  preferredAssetOrder: Map<string, number>,
  recommendationEntryByAssetId: Map<string, RecommendationEntry>,
  sessionIntent: SessionIntent,
): number {
  const intentDifference =
    getSessionIntentMatchRank(
      recommendationEntryByAssetId.get(right.assetId),
      sessionIntent,
    ) -
    getSessionIntentMatchRank(
      recommendationEntryByAssetId.get(left.assetId),
      sessionIntent,
    );
  if (intentDifference !== 0) {
    return intentDifference;
  }

  const recommendedOrderDifference =
    getRecommendationOrder(left.assetId, preferredAssetOrder) -
    getRecommendationOrder(right.assetId, preferredAssetOrder);
  if (recommendedOrderDifference !== 0) {
    return recommendedOrderDifference;
  }

  const authorityDifference =
    getAuthorityRank(right.sourceAuthorityTier) -
    getAuthorityRank(left.sourceAuthorityTier);
  if (authorityDifference !== 0) {
    return authorityDifference;
  }

  const portfolioFitDifference = right.portfolioFit - left.portfolioFit;
  if (portfolioFitDifference !== 0) {
    return portfolioFitDifference;
  }

  const contextCostDifference =
    getContextCostRank(left.contextCost.sizeClass) -
    getContextCostRank(right.contextCost.sizeClass);
  if (contextCostDifference !== 0) {
    return contextCostDifference;
  }

  return left.assetId.localeCompare(right.assetId);
}

function selectActivationCandidates(
  candidates: Array<{
    packageManifest: InstalledPackageManifest;
    destinationRoot: string;
  }>,
  preferredAssetOrder: Map<string, number>,
  recommendationEntryByAssetId: Map<string, RecommendationEntry>,
  activationBudget: number,
  sessionIntent: SessionIntent,
): Array<{
  packageManifest: InstalledPackageManifest;
  destinationRoot: string;
}> {
  const sortedCandidates = [...candidates].sort((left, right) =>
    compareActivationCandidates(
      left.packageManifest,
      right.packageManifest,
      preferredAssetOrder,
      recommendationEntryByAssetId,
      sessionIntent,
    ),
  );
  const selectedCandidates: Array<{
    packageManifest: InstalledPackageManifest;
    destinationRoot: string;
  }> = [];
  let remainingBudget = activationBudget;

  for (const candidate of sortedCandidates) {
    const recommendedEntry = recommendationEntryByAssetId.get(
      candidate.packageManifest.assetId,
    );
    const promptWeight =
      recommendedEntry?.estimatedPromptWeight ??
      candidate.packageManifest.contextCost.estimatedPromptWeight;

    if (promptWeight <= remainingBudget || selectedCandidates.length === 0) {
      selectedCandidates.push(candidate);
      remainingBudget -= promptWeight;
    }
  }

  return selectedCandidates;
}

function buildConcernBuckets(
  assetIds: string[],
  recommendationEntryByAssetId: Map<string, RecommendationEntry>,
): Record<string, string[]> {
  const buckets = new Map<string, string[]>();

  for (const assetId of assetIds) {
    const recommendationEntry = recommendationEntryByAssetId.get(assetId);
    if (!recommendationEntry) {
      continue;
    }
    for (const tag of recommendationEntry.coverageTags) {
      const bucket = buckets.get(tag) ?? [];
      bucket.push(assetId);
      buckets.set(tag, bucket);
    }
  }

  return Object.fromEntries(
    [...buckets.entries()].map(([key, value]) => [
      key,
      [...new Set(value)].sort(),
    ]),
  );
}

function buildTaskModeBuckets(
  assetIds: string[],
  recommendationEntryByAssetId: Map<string, RecommendationEntry>,
  sessionIntent: SessionIntent,
): Record<string, string[]> {
  const buckets = new Map<string, string[]>();

  for (const assetId of assetIds) {
    const recommendationEntry = recommendationEntryByAssetId.get(assetId);
    if (!recommendationEntry) {
      continue;
    }
    for (const taskMode of recommendationEntry.taskModes) {
      const bucket = buckets.get(taskMode) ?? [];
      bucket.push(assetId);
      buckets.set(taskMode, bucket);
    }
  }

  const originalOrder = new Map(
    assetIds.map((assetId, index) => [assetId, index] as const),
  );
  const focusedAssetIds = [...assetIds].sort((left, right) => {
    const intentDifference =
      getSessionIntentMatchRank(
        recommendationEntryByAssetId.get(right),
        sessionIntent,
      ) -
      getSessionIntentMatchRank(
        recommendationEntryByAssetId.get(left),
        sessionIntent,
      );
    if (intentDifference !== 0) {
      return intentDifference;
    }

    return (
      getRecommendationOrder(left, originalOrder) -
      getRecommendationOrder(right, originalOrder)
    );
  });

  buckets.set(
    "focused",
    focusedAssetIds.slice(
      0,
      Math.min(FOCUSED_ACTIVATION_BUCKET_MAX_SIZE, focusedAssetIds.length),
    ),
  );
  buckets.set("broad", [...assetIds]);

  return Object.fromEntries(
    [...buckets.entries()].map(([key, value]) => [
      key,
      [...new Set(value)].sort(),
    ]),
  );
}

function getSessionIntentMatchRank(
  recommendationEntry: RecommendationEntry | undefined,
  sessionIntent: SessionIntent,
): number {
  return recommendationEntry &&
    recommendationMatchesSessionIntent({
      intent: sessionIntent,
      coverageTags: recommendationEntry.coverageTags,
      taskModes: recommendationEntry.taskModes,
    })
    ? 1
    : 0;
}

function getRecommendationOrder(
  assetId: string,
  preferredAssetOrder: Map<string, number>,
): number {
  return preferredAssetOrder.get(assetId) ?? Number.MAX_SAFE_INTEGER;
}

function getAuthorityRank(
  authorityTier: InstalledPackageManifest["sourceAuthorityTier"],
): number {
  const ranks: Record<InstalledPackageManifest["sourceAuthorityTier"], number> =
    {
      "official-first-party": 6,
      "official-marketplace": 5,
      "official-compatible": 4,
      "trusted-local": 3,
      "trusted-community": 2,
      "unverified-community": 1,
    };

  return ranks[authorityTier];
}

function getContextCostRank(
  sizeClass: InstalledPackageManifest["contextCost"]["sizeClass"],
): number {
  const ranks: Record<
    InstalledPackageManifest["contextCost"]["sizeClass"],
    number
  > = {
    tiny: 1,
    small: 2,
    medium: 3,
    large: 4,
  };

  return ranks[sizeClass];
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

async function diffActivationState(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const requestedHost = parseActivationHostOption(
    getOptionalOptionValue(args, "--host"),
    "--host",
  );
  const hosts = requestedHost ? [requestedHost] : ACTIVATION_HOSTS;

  for (const host of hosts) {
    const runtimeRoot = join(projectRoot, "activate", host);
    const currentManifest = await readJsonFileOrNull<ActivationManifest>(
      join(runtimeRoot, ACTIVATION_MANIFEST_FILE),
      assertActivationManifest,
    );
    const previousManifest = await readJsonFileOrNull<ActivationManifest>(
      join(runtimeRoot, ACTIVATION_PREVIOUS_MANIFEST_FILE),
      assertActivationManifest,
    );

    if (!currentManifest || !previousManifest) {
      console.log(`No comparable activation manifests found for ${host}`);
      continue;
    }

    const assetDiff = diffStringSets(
      previousManifest.activeAssets,
      currentManifest.activeAssets,
    );
    const bundleDiff = diffStringSets(
      previousManifest.activeBundles,
      currentManifest.activeBundles,
    );
    console.log(
      `Activation diff for ${host}: ${previousManifest.generationId ?? "unknown"} -> ${currentManifest.generationId ?? "unknown"}`,
    );
    console.log(`  Added assets: ${formatDiffList(assetDiff.added)}`);
    console.log(`  Removed assets: ${formatDiffList(assetDiff.removed)}`);
    console.log(`  Added bundles: ${formatDiffList(bundleDiff.added)}`);
    console.log(`  Removed bundles: ${formatDiffList(bundleDiff.removed)}`);
  }
}

async function explainActivationState(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const assetId = getOptionValue(args, "--asset") ?? args[0];
  const requestedHost = parseActivationHostOption(
    getOptionalOptionValue(args, "--host"),
    "--host",
  );

  if (!assetId) {
    throw new Error("explain requires --asset <assetId>");
  }

  const hosts = requestedHost ? [requestedHost] : ACTIVATION_HOSTS;
  const lines: string[] = [];

  for (const host of hosts) {
    const runtimeRoot = join(projectRoot, "activate", host);
    const activationManifest = await readJsonFileOrNull<ActivationManifest>(
      join(runtimeRoot, ACTIVATION_MANIFEST_FILE),
      assertActivationManifest,
    );

    if (!activationManifest) {
      continue;
    }

    const recommendationReport = await readJsonFileOrNull<RecommendationReport>(
      join(projectRoot, "state", "recommendations.json"),
      assertRecommendationReport,
    );
    const recommendationHost = activationManifest.recommendationHost ?? host;
    const recommendationEntry = recommendationReport?.topByHost[
      recommendationHost
    ]?.find((entry) => entry.assetId === assetId);
    const suggestedBundle = recommendationReport?.suggestedBundles.find(
      (bundle) =>
        bundle.host === recommendationHost &&
        (bundle.assetIds.includes(assetId) ||
          (bundle.budgetPrunedAssetIds?.includes(assetId) ?? false)),
    );
    const budgetPrunedAsset = suggestedBundle?.budgetPrunedAssets?.find(
      (asset) => asset.assetId === assetId,
    );
    const activationBudget =
      activationManifest.activationBudget ??
      recommendationReport?.hostSummaries[recommendationHost]
        ?.activationBudget ??
      getActivationBudget(host);
    const isActive = activationManifest.activeAssets.includes(assetId);
    lines.push(`Host ${host}: ${isActive ? "active" : "not active"}`);
    lines.push(`  generation: ${activationManifest.generationId ?? "unknown"}`);
    lines.push(`  bundles: ${activationManifest.activeBundles.join(", ")}`);
    lines.push(`  activation budget: ${activationBudget}`);
    if (recommendationEntry) {
      lines.push(
        `  recommendation: rank ${recommendationEntry.rank}, score ${recommendationEntry.score}, prompt weight ${recommendationEntry.estimatedPromptWeight}`,
      );
    }
    if (isActive) {
      lines.push(
        "  reason: selected from staged bundle outputs by recommendation order, session intent, trust, and activation budget",
      );
    } else if (budgetPrunedAsset) {
      lines.push(`  reason: ${budgetPrunedAsset.reason}`);
    } else if (suggestedBundle) {
      lines.push(
        `  reason: present in suggested bundle ${suggestedBundle.bundleId} but absent from current activation manifest`,
      );
    } else {
      lines.push(
        "  reason: absent from the current activation manifest and current suggested bundle metadata",
      );
    }

    if (host === "copilot-vscode") {
      const profileManifest =
        await readJsonFileOrNull<CopilotWorkspaceProfileManifest>(
          join(runtimeRoot, "workspace-profile-manifest.json"),
          assertCopilotWorkspaceProfileManifest,
        );
      if (profileManifest) {
        lines.push(
          `  profile selected: ${profileManifest.selectedAssetIds.includes(assetId) ? "yes" : "no"}`,
        );
      }
    }
  }

  if (lines.length === 0) {
    console.log(`Asset ${assetId} has not been activated for any host.`);
    return;
  }

  console.log(`Activation explain for ${assetId}`);
  console.log(lines.join("\n"));
}

async function resetActivationState(projectRoot: string): Promise<void> {
  await removePath(join(projectRoot, "activate"));
  console.log(
    `Activation state reset under ${toPosixPath(join(projectRoot, "activate"))}`,
  );
}

/**
 * Reads an optional CLI flag value and fails fast when the flag is present
 * without a concrete value.
 */
function getOptionalOptionValue(
  args: string[],
  optionName: string,
): string | undefined {
  return getOptionValue(args, optionName);
}

/**
 * Validates a raw CLI value against every registered recommendation host id.
 */
function parseHostTargetOption(
  value: string | undefined,
  optionName: string,
): HostTarget | undefined {
  if (value === undefined) {
    return undefined;
  }

  const targets = getHostTargets();
  if (targets.includes(value as HostTarget)) {
    return value;
  }

  throw new Error(
    `Invalid ${optionName} value: ${value}. Must be one of: ${targets.join(", ")}`,
  );
}

function getHostTargets(): HostTarget[] {
  return [
    ...new Set([
      SHARED_HOST_TARGET,
      ...listHostAdapters().map((adapter) => adapter.recommendationHost),
    ]),
  ];
}

/**
 * Validates a raw CLI value against activation-capable lifecycle host ids.
 */
function parseActivationHostOption(
  value: string | undefined,
  optionName: string,
): ActivationHost | undefined {
  const hostTarget = parseHostTargetOption(value, optionName);
  if (hostTarget === undefined) {
    return undefined;
  }

  if (isActivationHost(hostTarget)) {
    return hostTarget;
  }

  throw new Error(
    `Invalid ${optionName} value: ${hostTarget}. Must be one of: ${ACTIVATION_HOSTS.join(", ")}`,
  );
}

/**
 * Returns whether a host target can be directly materialized by activation.
 */
function isActivationHost(value: HostTarget): value is ActivationHost {
  return ACTIVATION_HOSTS.includes(value as ActivationHost);
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

/**
 * Exposes internal activation helpers for focused test coverage.
 * Not part of the public API.
 */
export const activateInternals = {
  swapActivationRuntimeRoot,
};
