import { isAbsolute, join, relative, resolve } from "node:path";

import {
  createDirectoryLink,
  ensureDirectory,
  pathEntryExists,
  pathExists,
  readJsonFile,
  readJsonFileOrNull,
  readTextFileOrNull,
  removeManagedSection,
  removePath,
  upsertManagedSection,
  toPosixPath,
  writeJsonFile,
  writeTextFile,
} from "../files.js";
import { assertWirePlanManifest } from "../manifest-validation.js";
import { sanitizeAssetId } from "../lib/safe-paths.js";
import { readSharedMcpAssetIds } from "../lib/shared-mcp.js";
import { captureManagedTextFileSnapshots } from "./native-utils.js";
import {
  applyHostNativeFilePayloads,
  collectHostNativeFilePayloads,
  revertNativeConfigOperations,
  toWorkspaceRelativeConfigPath,
} from "./native-config.js";
import type {
  ActivationManifest,
  AssetCatalogEntry,
  AssetKind,
  InstalledBundleManifest,
  InstalledPackageManifest,
  ManagedTextFileSnapshot,
  NativeConfigOperation,
  WirePlanManifest,
  WirePreviewManifest,
} from "../types.js";

const OPENCODE_DIRECTORY_BY_ASSET_KIND: Record<AssetKind, string> = {
  agent: "agents",
  skill: "skills",
  instruction: "context/project-intelligence/agent-harness/instructions",
  workflow: "commands",
  hook: "context/project-intelligence/agent-harness/hooks",
  plugin: "context/project-intelligence/agent-harness/plugin-references",
  "mcp-server": "context/project-intelligence/agent-harness/mcp-references",
  extension: "context/project-intelligence/agent-harness/extensions",
  "prompt-pack": "commands",
  "reference-pack":
    "context/project-intelligence/agent-harness/reference-packs",
  "payable-api": "context/project-intelligence/agent-harness/payable-apis",
  "acp-agent": "context/project-intelligence/agent-harness/acp-agents",
};

interface OpenCodeLinkedAsset {
  assetId: string;
  assetKind: AssetKind;
  compatibilityMode: AssetCatalogEntry["compatibilityMode"];
  sourcePath: string;
  linkPath: string;
  linkMode: "directory" | "file";
}

/**
 * Provides wire open code for the lifecycle pipeline.
 */
export async function wireOpenCode(options: {
  projectRoot: string;
  workspaceRoot: string;
  mode: "preview" | "apply" | "reset";
}): Promise<void> {
  const { projectRoot, workspaceRoot, mode } = options;
  const activationRoot = join(projectRoot, "activate", "opencode");
  const localOverlayRoot = join(workspaceRoot, ".opencode");
  const localContextRoot = join(
    localOverlayRoot,
    "context",
    "project-intelligence",
    "agent-harness",
  );
  const localAgentsPath = join(workspaceRoot, "AGENTS.md");
  const gitignorePath = join(workspaceRoot, ".opencode", ".gitignore");
  const previousWirePlan = await readValidatedOpenCodeWirePlan(
    join(localContextRoot, "wire-plan.json"),
    localOverlayRoot,
    [localAgentsPath, gitignorePath],
  );

  const preview: WirePreviewManifest = {
    schemaVersion: 1,
    host: "opencode",
    mode,
    generatedAt: new Date().toISOString(),
    workspaceRoot: toPosixPath(workspaceRoot),
    targetPaths: [
      toPosixPath(localAgentsPath),
      toPosixPath(localContextRoot),
      ...buildOpenCodeLinkRoots(localOverlayRoot),
    ],
    notes: [
      "OpenCode wire-in writes a project-local overlay under .opencode/context/project-intelligence/agent-harness.",
      "Documented OpenCode-native directories stay under .opencode/agents, .opencode/skills, .opencode/commands, and .opencode/plugins.",
      "Undocumented asset buckets are staged under the managed context root instead of being projected as top-level .opencode directories.",
      "The global OpenCode/OpenAgentsControl-managed install is not modified.",
    ],
  };

  await writeJsonFile(
    join(activationRoot, "wire-preview-opencode.json"),
    preview,
  );

  if (mode === "preview") {
    const prospectivePlan = await buildOpenCodeProspectivePlan({
      projectRoot,
      workspaceRoot,
      activationRoot,
      localOverlayRoot,
      localContextRoot,
      localAgentsPath,
    });
    process.stdout.write(formatWirePlanSummary(prospectivePlan));
    return;
  }

  if (mode === "reset") {
    await revertNativeConfigOperations({
      workspaceRoot,
      host: "opencode",
      operations: previousWirePlan?.nativeConfigOperations,
    });
    await restoreManagedTextFileSnapshot(
      localAgentsPath,
      previousWirePlan?.textFileSnapshots,
    );
    await restoreManagedTextFileSnapshot(
      gitignorePath,
      previousWirePlan?.textFileSnapshots,
    );
    await removeManagedLinks(getManagedLinkedPaths(previousWirePlan));
    await removePath(localContextRoot);
    return;
  }

  await revertNativeConfigOperations({
    workspaceRoot,
    host: "opencode",
    operations: previousWirePlan?.nativeConfigOperations,
  });
  await removeManagedAgentsSection(localAgentsPath);
  await removeManagedLinks(previousWirePlan?.linkedPaths ?? []);
  await ensureDirectory(localContextRoot);

  const activationManifest = await readJsonFileOrNull<ActivationManifest>(
    join(activationRoot, "activation-manifest.json"),
  );
  const sharedMcpAssetIds = await readSharedMcpAssetIdsBestEffort(projectRoot);

  await writeJsonFile(
    join(localContextRoot, "activation-manifest.json"),
    activationManifest ?? {
      schemaVersion: 1,
      host: "opencode",
      generatedAt: new Date().toISOString(),
      activeBundles: [],
      activeAssets: [],
      runtimeRoot: toPosixPath(localContextRoot),
      notes: ["No OpenCode activation manifest was found at apply time."],
    },
  );

  const linkedAssets = await resolveOpenCodeLinkedAssets({
    projectRoot,
    activationRoot,
    activationManifest,
    localOverlayRoot,
  });
  const activeAssets = await loadActiveOpenCodeAssets(
    activationRoot,
    activationManifest,
  );

  const createdLinkPaths: string[] = [];
  // On re-apply the managed content written by the previous apply is still
  // present. Two constraints: (a) the fresh snapshot must record the TRUE
  // pre-apply state (so reset removes/restores adapter-owned content, not
  // itself — #447), and (b) user edits made BETWEEN applies must survive
  // (restoring the previous plan's snapshot over the current files would
  // silently delete them — review). So strip ONLY adapter-owned content
  // from the current files (the marked AGENTS.md section; the gitignore
  // entries THIS plan added — never a user's pre-existing required entry)
  // before capturing.
  if (previousWirePlan !== null && previousWirePlan !== undefined) {
    await removeManagedAgentsSection(localAgentsPath);
    await stripOpenCodeOverlayGitignoreEntries(
      gitignorePath,
      inferOpenCodeGitignoreOwnedEntries(
        previousWirePlan,
        gitignorePath,
        OPENCODE_OVERLAY_GITIGNORE_REQUIRED_ENTRIES,
      ),
    );
  }
  // Snapshot both AGENTS.md and .opencode/.gitignore before mutating them so
  // that wire --reset can restore either file to its pre-apply state.
  // gitignorePath is already declared above (used for allowedTextFilePaths).
  const textFileSnapshots = await captureManagedTextFileSnapshots([
    localAgentsPath,
    gitignorePath,
  ]);
  let nativeConfigOperations: NativeConfigOperation[] = [];
  try {
    for (const linkedAsset of linkedAssets) {
      await materializeOpenCodeLinkedAsset(linkedAsset);
      createdLinkPaths.push(linkedAsset.linkPath);
    }

    await upsertManagedAgentsSection({
      localAgentsPath,
      localOverlayRoot,
      localContextRoot,
      linkedAssets,
      sharedMcpAssetIds,
    });

    nativeConfigOperations = await applyOpenCodeNativeConfig({
      workspaceRoot,
      activeAssets,
      linkedAssets,
    });

    // Ensure .opencode/.gitignore lists node_modules (and other npm artefacts)
    // so that OpenCode's overlay scanner skips them and does not emit OVERLAY:
    // lines for the ~800 files that npm install writes into .opencode/.
    const ownedGitignoreEntries =
      await ensureOpenCodeOverlayGitignore(workspaceRoot);

    const npmInstallSummary =
      await readOpenCodeNpmInstallSummary(workspaceRoot);

    const wirePlan: WirePlanManifest = {
      schemaVersion: 1,
      host: "opencode-project",
      generatedAt: new Date().toISOString(),
      workspaceRoot: toPosixPath(workspaceRoot),
      runtimeRoot: toPosixPath(localOverlayRoot),
      linkedPaths: createdLinkPaths.map(toPosixPath),
      mcpServers: sharedMcpAssetIds,
      nativeConfigOperations,
      textFileSnapshots,
      gitignoreOwnedEntries: [...ownedGitignoreEntries],
      ...(npmInstallSummary !== null ? { npmInstallSummary } : {}),
      notes: [
        "Project-local OpenCode overlay written under .opencode/context/project-intelligence/agent-harness.",
        "Documented OpenCode-native asset buckets stay under .opencode/agents, .opencode/skills, .opencode/commands, and .opencode/plugins.",
        "Undocumented asset buckets are staged under the managed context root as harness-owned references.",
        "On Windows, managed directory links are created as junctions for compatibility.",
        "Shared MCP assets are surfaced in the effective OpenCode wire plan when available.",
        ...buildNpmInstallNotes(npmInstallSummary ?? null),
      ],
    };

    await writeJsonFile(join(localContextRoot, "wire-plan.json"), wirePlan);
  } catch (error) {
    await revertNativeConfigOperations({
      workspaceRoot,
      host: "opencode",
      operations: nativeConfigOperations,
    });
    await restoreManagedTextFileSnapshot(localAgentsPath, textFileSnapshots);
    await restoreManagedTextFileSnapshot(gitignorePath, textFileSnapshots);
    await removeManagedLinksBestEffort(createdLinkPaths);
    await removePath(localContextRoot);
    throw error;
  }
}

/**
 * Entries the harness owns in `.opencode/.gitignore` (npm install artefacts
 * that must be excluded from OpenCode overlay scanning). Shared by the
 * ensure (upsert) and strip (re-apply/ownership) paths so the two always
 * agree on what counts as adapter-owned.
 */
const OPENCODE_OVERLAY_GITIGNORE_REQUIRED_ENTRIES = [
  "node_modules",
  "package-lock.json",
  "bun.lockb",
  "yarn.lock",
  "pnpm-lock.yaml",
] as const;

/**
 * Idempotently writes `.opencode/.gitignore` so OpenCode's overlay scanner
 * skips npm-install artefacts (node_modules, package-lock.json, etc.).
 * If the file already exists and already contains all required entries,
 * it is left untouched.  Otherwise it is created / updated in place.
 *
 * Returns the entries THIS call added (empty when nothing was missing) so
 * the wire plan can record exact harness ownership for later strips.
 *
 * This must be called during `wire --apply` so the gitignore is present
 * before OpenCode starts and begins enumerating its overlay directory.
 */
async function ensureOpenCodeOverlayGitignore(
  workspaceRoot: string,
): Promise<readonly string[]> {
  // Entries to exclude from OpenCode overlay scanning (npm install artefacts).
  // The .gitignore itself is excluded by the overlay scanner by default — entries
  // here target package-manager lockfiles and the node_modules directory.

  const gitignorePath = join(workspaceRoot, ".opencode", ".gitignore");
  const existing = (await readTextFileOrNull(gitignorePath)) ?? "";
  const existingEntries = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );

  const missing = OPENCODE_OVERLAY_GITIGNORE_REQUIRED_ENTRIES.filter(
    (entry) => !existingEntries.has(entry),
  );
  if (missing.length === 0) {
    return [];
  }

  await ensureDirectory(join(workspaceRoot, ".opencode"));

  const preamble = existing.trimEnd();
  const additions = missing.join("\n");
  const next =
    preamble.length === 0
      ? additions + "\n"
      : preamble + "\n" + additions + "\n";

  await writeTextFile(gitignorePath, next);
  return missing;
}

/**
 * Resolves the gitignore entries a previous apply OWNS for strip purposes.
 *
 * Preference order:
 * 1. `gitignoreOwnedEntries` recorded by current plans — exact ownership.
 * 2. Plans from before that field existed: infer from the previous plan's
 *    .opencode/.gitignore text snapshot. A NULL baseline means the file
 *    did not exist before the previous apply, so every required entry now
 *    present was harness-added. A NON-NULL baseline means only the
 *    required entries missing from the baseline were added — a user's
 *    pre-existing `node_modules` (or any other required line) is theirs.
 * 3. No snapshot entry at all: ownership cannot be inferred. Skip
 *    stripping (empty set) — over-preservation never deletes user lines,
 *    and the next apply records exact ownership going forward (review).
 */
function inferOpenCodeGitignoreOwnedEntries(
  previousWirePlan: WirePlanManifest,
  gitignorePath: string,
  requiredEntries: readonly string[],
): ReadonlySet<string> {
  if (previousWirePlan.gitignoreOwnedEntries !== undefined) {
    return new Set(previousWirePlan.gitignoreOwnedEntries);
  }

  const baseline = previousWirePlan.textFileSnapshots?.find(
    (entry) => entry.path === toPosixPath(gitignorePath),
  );
  if (baseline === undefined) {
    return new Set<string>();
  }
  if (baseline.content === null) {
    return new Set(requiredEntries);
  }

  const baselineEntries = new Set(
    baseline.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
  return new Set(
    requiredEntries.filter((entry) => !baselineEntries.has(entry)),
  );
}

/**
 * Removes ONLY the harness-owned entries recorded in the previous wire
 * plan from `.opencode/.gitignore`, preserving every user line — including
 * a user's own pre-existing `node_modules` (or any other required entry)
 * — and the file itself when anything user-authored remains (review).
 *
 * Re-apply calls this BEFORE capturing the reset snapshot: the previous
 * apply's entries are still present and must not be recorded as
 * pre-apply state (#447), while user edits made between applies must
 * survive the re-apply.
 */
async function stripOpenCodeOverlayGitignoreEntries(
  gitignorePath: string,
  ownedEntries: ReadonlySet<string>,
): Promise<void> {
  const existing = await readTextFileOrNull(gitignorePath);
  if (existing === null) {
    return;
  }
  const kept = existing
    .split(/\r?\n/)
    .filter((line) => !ownedEntries.has(line.trim()));
  const next = kept.join("\n");
  if (next.trim().length === 0) {
    // The file was adapter-created (only owned entries); reset semantics
    // then record it as ABSENT so wire --reset removes it.
    await removePath(gitignorePath);
    return;
  }
  if (next !== existing) {
    await writeTextFile(gitignorePath, next);
  }
}

/**
 * Reads the optional `.opencode/package.json` and `package-lock.json` to
 * build a summary of the npm install footprint that OpenCode manages.
 * Returns `null` when no `.opencode/package.json` exists.
 */
async function readOpenCodeNpmInstallSummary(
  workspaceRoot: string,
): Promise<WirePlanManifest["npmInstallSummary"] | null> {
  const packageJsonPath = join(workspaceRoot, ".opencode", "package.json");
  if (!(await pathEntryExists(packageJsonPath))) {
    return null;
  }

  const packageJson = await readJsonFileOrNull<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(packageJsonPath);

  // readJsonFileOrNull only returns null for ENOENT (already guarded above),
  // but keep this check as a safety net for future changes to readJsonFileOrNull.
  /* c8 ignore next 3 */
  if (packageJson === null) {
    return null;
  }

  const declaredDependencyCount =
    Object.keys(packageJson.dependencies ?? {}).length +
    Object.keys(packageJson.devDependencies ?? {}).length;

  // Prefer package-lock.json package count for accuracy; fall back to a
  // conservative per-dependency estimate when the lockfile is absent.
  const lockfilePath = join(workspaceRoot, ".opencode", "package-lock.json");
  const lockfile = await readJsonFileOrNull<{
    packages?: Record<string, unknown>;
  }>(lockfilePath);

  const estimatedPackageCount =
    lockfile?.packages !== undefined
      ? // package-lock v2/v3: packages includes the root "" entry, subtract 1
        Math.max(0, Object.keys(lockfile.packages).length - 1)
      : // Rough heuristic when no lockfile: use declared dependency count
        declaredDependencyCount;

  const relativePackageJsonPath = toPosixPath(
    relative(workspaceRoot, packageJsonPath),
  );

  return {
    packageJsonPath: relativePackageJsonPath,
    declaredDependencyCount,
    estimatedPackageCount,
  };
}

function buildOpenCodeLinkRoots(localOverlayRoot: string): string[] {
  return [...new Set(Object.values(OPENCODE_DIRECTORY_BY_ASSET_KIND))]
    .map((directoryName) => toPosixPath(join(localOverlayRoot, directoryName)))
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Computes what `wire opencode --apply` would do without writing anything.
 *
 * Reads the activation manifest and shared MCP asset IDs, resolves the linked
 * assets and native-config payloads, then returns a WirePlanManifest that
 * describes the prospective operation. Nothing is written to disk.
 */
async function buildOpenCodeProspectivePlan(options: {
  projectRoot: string;
  workspaceRoot: string;
  activationRoot: string;
  localOverlayRoot: string;
  localContextRoot: string;
  localAgentsPath: string;
}): Promise<WirePlanManifest> {
  const {
    projectRoot,
    workspaceRoot,
    activationRoot,
    localOverlayRoot,
    localContextRoot,
    localAgentsPath,
  } = options;

  const activationManifest = await readJsonFileOrNull<ActivationManifest>(
    join(activationRoot, "activation-manifest.json"),
  );
  const sharedMcpAssetIds = await readSharedMcpAssetIdsBestEffort(projectRoot);

  const linkedAssets = await resolveOpenCodeLinkedAssets({
    projectRoot,
    activationRoot,
    activationManifest,
    localOverlayRoot,
  });
  const activeAssets = await loadActiveOpenCodeAssets(
    activationRoot,
    activationManifest,
  );

  // Compute native-config operations descriptively (no disk writes).
  const nativeConfigOperations = buildOpenCodeNativeConfigPreview({
    workspaceRoot,
    activeAssets,
    linkedAssets,
  });

  // Read npm install summary so preview accurately reflects what --apply reports.
  const npmInstallSummary = await readOpenCodeNpmInstallSummary(workspaceRoot);

  return {
    schemaVersion: 1,
    host: "opencode-project",
    generatedAt: new Date().toISOString(),
    workspaceRoot: toPosixPath(workspaceRoot),
    runtimeRoot: toPosixPath(localOverlayRoot),
    linkedPaths: linkedAssets.map((a) => toPosixPath(a.linkPath)),
    mcpServers: sharedMcpAssetIds,
    nativeConfigOperations,
    textFileSnapshots: [],
    notes: [
      "This is a preview of what --apply would do. Nothing has been written.",
      `AGENTS.md target: ${toPosixPath(localAgentsPath)}`,
      `Context root: ${toPosixPath(localContextRoot)}`,
      ...(npmInstallSummary != null
        ? [
            `OpenCode plugin npm install: ${npmInstallSummary.declaredDependencyCount} declared dependencies, ` +
              `~${npmInstallSummary.estimatedPackageCount} installed packages under ${npmInstallSummary.packageJsonPath}. ` +
              `These files are written by OpenCode itself (not by wire --apply) and are excluded from overlay scanning via .opencode/.gitignore.`,
          ]
        : []),
    ],
  };
}

/**
 * Computes native-config operation descriptors that `--apply` would produce,
 * without touching the filesystem. Mirrors the logic of applyOpenCodeNativeConfig.
 */
function buildOpenCodeNativeConfigPreview(options: {
  workspaceRoot: string;
  activeAssets: AssetCatalogEntry[];
  linkedAssets: OpenCodeLinkedAsset[];
}): NativeConfigOperation[] {
  const instructionPaths = options.linkedAssets
    .filter((asset) => asset.assetKind === "instruction")
    .map((asset) =>
      toWorkspaceRelativeConfigPath(options.workspaceRoot, asset.linkPath),
    );
  const payloads = collectHostNativeFilePayloads(
    options.activeAssets,
    "opencode",
  );

  if (instructionPaths.length > 0) {
    payloads.unshift({
      path: "opencode.json",
      format: "json",
      merge: true,
      content: { instructions: instructionPaths },
    });
  }

  return payloads.map((payload) => {
    const isJson = payload.format === "json";
    const merge = isJson && (payload as { merge?: boolean }).merge === true;
    return {
      path: payload.path,
      format: payload.format,
      mode: (merge ? "merge" : "write") as "merge" | "write",
      content: payload.content as string | Record<string, unknown>,
    } satisfies NativeConfigOperation;
  });
}

/**
 * Formats a WirePlanManifest as a human-readable summary string for stdout.
 *
 * Outputs:
 *   - header with host and timestamp
 *   - linked paths section (count + list)
 *   - MCP servers section
 *   - native config operations section
 *   - text file snapshots section
 *   - notes section
 */
export function formatWirePlanSummary(plan: WirePlanManifest): string {
  const lines: string[] = [];
  const hr = "─".repeat(60);

  lines.push(hr);
  lines.push(`  wire opencode — plan preview`);
  lines.push(`  host: ${plan.host}  •  generated: ${plan.generatedAt}`);
  lines.push(`  workspace: ${plan.workspaceRoot}`);
  lines.push(hr);

  // Linked paths
  const linkedPaths = plan.linkedPaths ?? [];
  lines.push(
    `\n  Linked paths (${linkedPaths.length})${linkedPaths.length === 0 ? " — none" : ":"}`,
  );
  for (const p of linkedPaths) {
    lines.push(`    • ${p}`);
  }

  // MCP servers
  const mcpServers = plan.mcpServers ?? [];
  lines.push(
    `\n  MCP servers (${mcpServers.length})${mcpServers.length === 0 ? " — none" : ":"}`,
  );
  for (const s of mcpServers) {
    lines.push(`    • ${s}`);
  }

  // Native config operations
  const ops = plan.nativeConfigOperations ?? [];
  lines.push(
    `\n  Native config operations (${ops.length})${ops.length === 0 ? " — none" : ":"}`,
  );
  for (const op of ops) {
    lines.push(`    • [${op.mode}] ${op.path} (${op.format})`);
  }

  // Text file snapshots
  const snapshots = plan.textFileSnapshots ?? [];
  lines.push(
    `\n  Text file snapshots (${snapshots.length})${snapshots.length === 0 ? " — none" : ":"}`,
  );
  for (const snap of snapshots) {
    const preview =
      typeof snap.content === "string"
        ? snap.content.slice(0, 80).replace(/\n/g, "↵")
        : "(null)";
    lines.push(`    • ${snap.path}: ${preview}`);
  }

  // Notes
  const notes = plan.notes ?? [];
  if (notes.length > 0) {
    lines.push(`\n  Notes:`);
    for (const note of notes) {
      lines.push(`    ℹ ${note}`);
    }
  }

  lines.push(`\n${hr}\n`);

  return lines.join("\n") + "\n";
}

async function resolveOpenCodeLinkedAssets(options: {
  projectRoot: string;
  activationRoot: string;
  activationManifest: ActivationManifest | null;
  localOverlayRoot: string;
}): Promise<OpenCodeLinkedAsset[]> {
  const { projectRoot, activationRoot, activationManifest, localOverlayRoot } =
    options;

  if (!activationManifest) {
    return [];
  }

  const activeAssetIds = new Set(activationManifest.activeAssets);
  const linkedAssets: OpenCodeLinkedAsset[] = [];
  const seenAssetIds = new Set<string>();

  for (const bundleId of activationManifest.activeBundles) {
    const bundleManifestPath = join(
      projectRoot,
      "install",
      "opencode",
      "bundles",
      `${bundleId}.install.json`,
    );
    const bundleManifest =
      await readJsonFileOrNull<InstalledBundleManifest>(bundleManifestPath);

    if (!bundleManifest) {
      continue;
    }

    for (const pkg of bundleManifest.packages) {
      if (!activeAssetIds.has(pkg.assetId) || seenAssetIds.has(pkg.assetId)) {
        continue;
      }

      const packageManifest = await readJsonFile<InstalledPackageManifest>(
        pkg.manifestPath,
      );
      const assetRoot = join(
        activationRoot,
        sanitizeAssetId(packageManifest.assetId),
      );
      const catalogEntry = await readJsonFileOrNull<AssetCatalogEntry>(
        join(assetRoot, "asset.json"),
      );
      const compatibilityMode =
        catalogEntry?.compatibilityMode ??
        (packageManifest.assetKind === "extension" ? "native" : "adaptable");
      const fileLinkedAsset = isOpenCodeFileLinkedAsset(
        packageManifest.assetKind,
        compatibilityMode,
      );
      const sourcePath = fileLinkedAsset
        ? join(assetRoot, "content.txt")
        : assetRoot;

      if (!(await pathExists(sourcePath))) {
        continue;
      }

      linkedAssets.push({
        assetId: packageManifest.assetId,
        assetKind: packageManifest.assetKind,
        compatibilityMode,
        sourcePath,
        linkMode: fileLinkedAsset ? "file" : "directory",
        linkPath: join(
          localOverlayRoot,
          OPENCODE_DIRECTORY_BY_ASSET_KIND[packageManifest.assetKind],
          fileLinkedAsset
            ? `${sanitizeAssetId(packageManifest.assetId)}.md`
            : sanitizeAssetId(packageManifest.assetId),
        ),
      });
      seenAssetIds.add(pkg.assetId);
    }
  }

  return linkedAssets.sort((left, right) =>
    left.linkPath.localeCompare(right.linkPath),
  );
}

async function loadActiveOpenCodeAssets(
  activationRoot: string,
  activationManifest: ActivationManifest | null,
): Promise<AssetCatalogEntry[]> {
  if (!activationManifest) {
    return [];
  }

  const assets: AssetCatalogEntry[] = [];
  for (const assetId of activationManifest.activeAssets) {
    const asset = await readJsonFileOrNull<AssetCatalogEntry>(
      join(activationRoot, sanitizeAssetId(assetId), "asset.json"),
    );
    if (asset) {
      assets.push(asset);
    }
  }

  return assets.sort((left, right) => left.id.localeCompare(right.id));
}

async function applyOpenCodeNativeConfig(options: {
  workspaceRoot: string;
  activeAssets: AssetCatalogEntry[];
  linkedAssets: OpenCodeLinkedAsset[];
}): Promise<NativeConfigOperation[]> {
  const instructionPaths = options.linkedAssets
    .filter((asset) => asset.assetKind === "instruction")
    .map((asset) =>
      toWorkspaceRelativeConfigPath(options.workspaceRoot, asset.linkPath),
    );
  const payloads = collectHostNativeFilePayloads(
    options.activeAssets,
    "opencode",
  );

  if (instructionPaths.length > 0) {
    payloads.unshift({
      path: "opencode.json",
      format: "json",
      merge: true,
      content: {
        instructions: instructionPaths,
      },
    });
  }

  if (payloads.length === 0) {
    return [];
  }

  return applyHostNativeFilePayloads({
    workspaceRoot: options.workspaceRoot,
    host: "opencode",
    payloads,
  });
}

async function materializeOpenCodeLinkedAsset(
  linkedAsset: OpenCodeLinkedAsset,
): Promise<void> {
  if (linkedAsset.linkMode === "directory") {
    await createDirectoryLink(linkedAsset.linkPath, linkedAsset.sourcePath);
    return;
  }

  if (await pathEntryExists(linkedAsset.linkPath)) {
    throw new Error(
      `Refusing to overwrite existing OpenCode file link for asset ${linkedAsset.assetKind}:${linkedAsset.assetId}: ${toPosixPath(linkedAsset.linkPath)}`,
    );
  }

  const content = await readTextFileOrNull(linkedAsset.sourcePath);
  if (content === null) {
    throw new Error(
      `Cannot materialize OpenCode file link because source content is missing: ${toPosixPath(linkedAsset.sourcePath)} -> ${toPosixPath(linkedAsset.linkPath)}`,
    );
  }

  await writeTextFile(linkedAsset.linkPath, content);
}

function isOpenCodeFileLinkedAsset(
  assetKind: AssetKind,
  compatibilityMode: AssetCatalogEntry["compatibilityMode"],
): boolean {
  return (
    assetKind === "instruction" ||
    assetKind === "workflow" ||
    assetKind === "prompt-pack" ||
    assetKind === "reference-pack" ||
    compatibilityMode === "reference-only"
  );
}

/**
 * Projects shared MCP references into OpenCode wire plans without failing the
 * project-local apply when shared activation state is stale or malformed.
 */
async function readSharedMcpAssetIdsBestEffort(
  projectRoot: string,
): Promise<string[]> {
  try {
    return await readSharedMcpAssetIds(projectRoot);
  } catch (error) {
    /* c8 ignore next 4 */
    console.warn(
      `Failed to project shared MCP assets into OpenCode wire plan: ${toLoggableErrorMessage(error)}`,
    );
    return [];
  }
}

async function upsertManagedAgentsSection(options: {
  localAgentsPath: string;
  localOverlayRoot: string;
  localContextRoot: string;
  linkedAssets: OpenCodeLinkedAsset[];
  sharedMcpAssetIds: string[];
}): Promise<void> {
  const existingAgentsContent =
    (await readTextFileOrNull(options.localAgentsPath)) ?? "";
  const bodyLines = [
    "# Agent Harness OpenCode overlay",
    "",
    `Managed overlay root: ${toPosixPath(options.localOverlayRoot)}`,
    `Managed context root: ${toPosixPath(options.localContextRoot)}`,
    "",
    "## Linked assets",
    ...(options.linkedAssets.length > 0
      ? options.linkedAssets.map(
          (asset) =>
            `- ${asset.assetId} (${asset.assetKind}) -> ${toPosixPath(asset.linkPath)}`,
        )
      : ["- No active OpenCode assets were found at wire time."]),
    ...(options.sharedMcpAssetIds.length > 0
      ? /* c8 ignore next 5 -- sharedMcpAssetIds ternary: true branch requires wire plan with MCP asset IDs */
        [
          "",
          "## Shared MCP references",
          ...options.sharedMcpAssetIds.map((assetId) => `- ${assetId}`),
        ]
      : []),
    "",
    "Review generated links before committing project-local host configuration.",
  ];

  await writeTextFile(
    options.localAgentsPath,
    upsertManagedSection({
      originalContent: existingAgentsContent,
      markerId: "agent-harness",
      bodyLines,
    }),
  );
}

async function removeManagedAgentsSection(
  localAgentsPath: string,
): Promise<void> {
  const existingAgentsContent = await readTextFileOrNull(localAgentsPath);

  if (existingAgentsContent === null) {
    return;
  }

  const nextAgentsContent = removeManagedSection({
    originalContent: existingAgentsContent,
    markerId: "agent-harness",
  });
  if (nextAgentsContent.trim().length === 0) {
    await removePath(localAgentsPath);
    return;
  }

  await writeTextFile(localAgentsPath, nextAgentsContent);
}

function getManagedLinkedPaths(
  wirePlan: WirePlanManifest | null | undefined,
): string[] {
  return wirePlan?.linkedPaths ?? [];
}

async function removeManagedLinks(linkedPaths: string[]): Promise<void> {
  for (const linkedPath of linkedPaths) {
    await removePath(linkedPath);
  }
}

async function removeManagedLinksBestEffort(
  linkedPaths: string[],
  removeManagedLink: typeof removePath = removePath,
): Promise<void> {
  for (const linkedPath of linkedPaths) {
    try {
      await removeManagedLink(linkedPath);
    } catch (error) {
      console.warn(
        `Failed to roll back managed link ${linkedPath}: ${toLoggableErrorMessage(error)}`,
      );
    }
  }
}

async function readValidatedOpenCodeWirePlan(
  wirePlanPath: string,
  managedRoot: string,
  allowedTextFilePaths: string[],
): Promise<WirePlanManifest | null> {
  const wirePlan = await readJsonFileOrNull<unknown>(wirePlanPath);
  if (wirePlan === null) {
    return null;
  }

  assertWirePlanManifest(wirePlan, wirePlanPath);
  const linkedPaths = wirePlan.linkedPaths ?? [];
  for (const linkedPath of linkedPaths) {
    if (!isPathWithinRoot(linkedPath, managedRoot)) {
      throw new Error(
        `Wire plan contains linkedPath outside managed OpenCode root (${toPosixPath(managedRoot)}): ${linkedPath}`,
      );
    }
  }

  const textFileSnapshots = validateManagedTextFileSnapshots(
    wirePlan.textFileSnapshots,
    allowedTextFilePaths,
    wirePlanPath,
  );

  return {
    ...wirePlan,
    linkedPaths,
    textFileSnapshots,
  };
}

function validateManagedTextFileSnapshots(
  snapshots: ManagedTextFileSnapshot[] | undefined,
  allowedPaths: string[],
  wirePlanPath: string,
): ManagedTextFileSnapshot[] | undefined {
  if (snapshots === undefined) {
    return snapshots;
  }

  const allowedSnapshotPaths = new Set(
    allowedPaths.map((pathValue) => toPosixPath(pathValue)),
  );
  const seenPaths = new Set<string>();

  for (const snapshot of snapshots) {
    if (!allowedSnapshotPaths.has(snapshot.path)) {
      throw new Error(
        `Wire plan contains textFileSnapshots path outside the managed OpenCode restore set (${toPosixPath(wirePlanPath)}): ${snapshot.path}`,
      );
    }

    if (seenPaths.has(snapshot.path)) {
      throw new Error(
        `Wire plan contains duplicate textFileSnapshots entry (${toPosixPath(wirePlanPath)}): ${snapshot.path}`,
      );
    }

    seenPaths.add(snapshot.path);
  }

  return snapshots;
}

function isPathWithinRoot(pathValue: string, rootPath: string): boolean {
  const absoluteRoot = resolve(rootPath);
  const absolutePath = resolve(pathValue);
  const relativePath = relative(absoluteRoot, absolutePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

async function restoreManagedTextFileSnapshot(
  filePath: string,
  snapshots: ManagedTextFileSnapshot[] | undefined,
): Promise<void> {
  const snapshot = snapshots?.find(
    (entry) => toPosixPath(filePath) === entry.path,
  );

  if (!snapshot) {
    await removeManagedAgentsSection(filePath);
    return;
  }

  if (snapshot.content === null) {
    await removePath(filePath);
    return;
  }

  await writeTextFile(filePath, snapshot.content);
}

function toLoggableErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  return String(error);
}

/**
 * Builds the npm install notes line for the wire-plan manifest notes array.
 * When `summary` is null (npm install summary unavailable), returns an empty
 * array — no notes are contributed.
 *
 * Extracted to a standalone function so TypeScript can properly narrow
 * the `summary` type through a regular guard rather than relying on
 * non-null assertions inside a spread expression.
 */
function buildNpmInstallNotes(
  summary: NonNullable<WirePlanManifest["npmInstallSummary"]> | null,
): string[] {
  if (summary == null) {
    return [];
  }

  return [
    `OpenCode plugin npm install: ${summary.declaredDependencyCount} declared dependencies, ` +
      `~${summary.estimatedPackageCount} installed packages under ${summary.packageJsonPath}. ` +
      `These files are written by OpenCode itself (not by wire --apply) and are excluded from overlay scanning via .opencode/.gitignore.`,
  ];
}

/**
 * Exposes focused OpenCode wire helpers for behavioral coverage.
 */
export const openCodeWireInternals = {
  getManagedLinkedPaths,
  materializeOpenCodeLinkedAsset,
  isOpenCodeFileLinkedAsset,
  validateManagedTextFileSnapshots,
  restoreManagedTextFileSnapshot,
  removeManagedLinksBestEffort,
  toLoggableErrorMessage,
  ensureOpenCodeOverlayGitignore,
  readOpenCodeNpmInstallSummary,
  buildOpenCodeProspectivePlan,
};
