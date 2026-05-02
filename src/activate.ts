import { join } from "node:path";

import {
  copyPath,
  ensureDirectory,
  pathExists,
  readJsonFile,
  readJsonFileOrNull,
  removePath,
  toPosixPath,
  writeJsonFile,
  writeJsonFileWithSnapshot,
} from "./files.js";
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
} from "./types.js";

const ACTIVATION_MANIFEST_FILE = "activation-manifest.json";
const ACTIVATION_PREVIOUS_MANIFEST_FILE = "activation-manifest.previous.json";

export async function runActivate(
  args: string[],
  _workingDirectory: string,
  projectRoot: string,
): Promise<number> {
  const [command = "help", ...rest] = args;

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
      printActivateHelp();
      return 1;
  }
}

async function activateHosts(
  projectRoot: string,
  args: string[] = [],
): Promise<void> {
  const sessionIntent = getOptionValue(args, "--intent") ?? "general";
  const requestedRecommendationHost = getOptionValue(
    args,
    "--recommendation-host",
  ) as HostTarget | undefined;
  const requestedHost = getOptionValue(args, "--host") as
    | "opencode"
    | "copilot-vscode"
    | "shared"
    | undefined;
  const hosts: Array<"opencode" | "copilot-vscode" | "shared"> = requestedHost
    ? [requestedHost]
    : ["opencode", "copilot-vscode", "shared"];

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
  host: "opencode" | "copilot-vscode" | "shared",
  bundleIds: string[],
  sessionIntent: string,
  recommendationHost: HostTarget = host,
): Promise<void> {
  const activeAssets = new Set<string>();
  const runtimeRoot = join(projectRoot, "activate", host);
  await ensureDirectory(runtimeRoot);
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
      const packageManifest = await readJsonFile<InstalledPackageManifest>(
        pkg.manifestPath,
        assertInstalledPackageManifest,
      );
      if (
        currentGeneration &&
        !currentGeneration.packageManifestPaths.includes(pkg.manifestPath)
      ) {
        continue;
      }
      const destinationRoot = join(
        runtimeRoot,
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
  );

  await writeJsonFile(join(runtimeRoot, `${host}-overlay-plan.json`), {
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
        compareActivationCandidates(left, right, preferredAssetOrder),
      )
      .slice(0, 12)
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
      activationBudget,
      sessionIntent,
    };

    for (const fallbackSkillId of mergedSkillIds) {
      if (!copilotProfileManifest.selectedAssetIds.includes(fallbackSkillId)) {
        copilotProfileManifest.selectedAssetIds.push(fallbackSkillId);
      }
    }

    await writeJsonFile(
      join(runtimeRoot, "workspace-profile-manifest.json"),
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
    activeBundles: activeBundleIds,
    activeAssets: [...activeAssets].sort(),
    runtimeRoot: toPosixPath(runtimeRoot),
    notes: [
      "Activation currently materializes staged install outputs into host-specific runtime views.",
      `Token-budget-aware pruning applied with current host budget of ${activationBudget} prompt-weight units.`,
      `Activation ordering is driven by recommendation rank from state/recommendations.json.`,
    ],
  };

  await writeJsonFileWithSnapshot(
    join(runtimeRoot, ACTIVATION_MANIFEST_FILE),
    join(runtimeRoot, ACTIVATION_PREVIOUS_MANIFEST_FILE),
    activationManifest,
  );
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
  console.log(`activate commands:
  host      Materialize active host views from installed bundles
  diff      Compare current host activation to the previous activation view
  explain   Explain whether an asset is active for a host
  rollback  Point a host to a previous install generation
  reset     Remove activation outputs

Options:
  --host <copilot-vscode|opencode|shared>
  --recommendation-host <host-policy-id>
  --intent <general|frontend|backend|security|docs|testing>`);
}

function getDefaultBundleIdsForHost(
  host: "opencode" | "copilot-vscode" | "shared",
): string[] {
  if (host === "opencode") {
    return ["opencode-global", "community-stable"];
  }

  if (host === "copilot-vscode") {
    return ["copilot-core", "community-stable"];
  }

  return ["shared-mcp"];
}

function sanitizeAssetId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-");
}

function buildCopilotProfileId(assetIds: string[]): string {
  return assetIds
    .slice(0, 12)
    .join("-")
    .replace(/[^a-zA-Z0-9_-]+/gu, "-")
    .slice(0, 96);
}

function getActivationBudget(
  host: "opencode" | "copilot-vscode" | "shared",
): number {
  if (host === "copilot-vscode") {
    return 60;
  }

  if (host === "opencode") {
    return 120;
  }

  return 40;
}

function compareActivationCandidates(
  left: InstalledPackageManifest,
  right: InstalledPackageManifest,
  preferredAssetOrder: Map<string, number>,
): number {
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
): Array<{
  packageManifest: InstalledPackageManifest;
  destinationRoot: string;
}> {
  const sortedCandidates = [...candidates].sort((left, right) =>
    compareActivationCandidates(
      left.packageManifest,
      right.packageManifest,
      preferredAssetOrder,
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

  buckets.set("focused", assetIds.slice(0, Math.min(20, assetIds.length)));
  buckets.set("broad", [...assetIds]);

  return Object.fromEntries(
    [...buckets.entries()].map(([key, value]) => [
      key,
      [...new Set(value)].sort(),
    ]),
  );
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
  const host = getOptionValue(args, "--host") as
    | "opencode"
    | "copilot-vscode"
    | "shared"
    | undefined;
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
  const requestedHost = getOptionValue(args, "--host") as
    | "opencode"
    | "copilot-vscode"
    | "shared"
    | undefined;
  const hosts = requestedHost
    ? [requestedHost]
    : (["opencode", "copilot-vscode", "shared"] as const);

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
  const requestedHost = getOptionValue(args, "--host") as
    | "opencode"
    | "copilot-vscode"
    | "shared"
    | undefined;

  if (!assetId) {
    throw new Error("explain requires --asset <assetId>");
  }

  const hosts = requestedHost
    ? [requestedHost]
    : (["opencode", "copilot-vscode", "shared"] as const);
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

    const isActive = activationManifest.activeAssets.includes(assetId);
    lines.push(`Host ${host}: ${isActive ? "active" : "not active"}`);
    lines.push(`  generation: ${activationManifest.generationId ?? "unknown"}`);
    lines.push(`  bundles: ${activationManifest.activeBundles.join(", ")}`);

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
