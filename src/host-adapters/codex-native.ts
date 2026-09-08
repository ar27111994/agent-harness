import { readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import {
  createContentHash,
  readJsonFileOrNull,
  readTextFileOrNull,
  removePath,
  writeJsonFile,
  writeTextFile,
} from "../files.js";
import { sanitizeAssetId } from "../lib/safe-paths.js";
import type {
  ManagedTextFileSnapshot,
  NativeConfigOperation,
} from "../types.js";
import {
  applyStructuredNativeConfig,
  assertJsonObject,
  buildManagedInstructionLines,
  buildNativeAssetContentSections,
  buildSkillFile,
  isJsonObject,
  removeEmptyParentDirectories,
  removeManagedSectionFile,
  restoreManagedTextFileSnapshot,
  upsertManagedSectionFile,
} from "./native-utils.js";
import type { NativeAsset, WireNativeFilesOptions } from "./native-utils.js";
import {
  removeManagedMarketplaceEntries,
  replaceManagedMarketplaceEntry,
} from "./marketplace-utils.js";
import {
  assertPluginDirectoryAdoptable,
  claimManagedPluginDirectory,
  hasManagedPluginMarker,
} from "./ownership-marker.js";
import {
  classifyMarketplaceState,
  classifyProfileState,
  marketplaceActorForState,
  profileActorForState,
  resolveOwnershipDecision,
} from "./codex-ownership-machine.js";
import type {
  CodexAgentProfileRecord,
  CodexCleanupProfileDecision,
  CodexMarketplaceDecision,
  CodexProfileDecision,
  CodexWriteProfileDecision,
} from "./codex-ownership-machine.js";

const CODEX_PLUGIN_NAME = "agent-harness";
const CODEX_PLUGIN_VERSION = "2.1.0";
const CODEX_MARKETPLACE_NAME = "agent-harness-local";
const CODEX_AGENT_FILE_PREFIX = "agent-harness-";
/**
 * The only filename shape `readCodexAgentProfileRecords` accepts for an owned
 * profile. Rejecting separators and requiring a non-empty `[a-zA-Z0-9_-]`
 * slug guarantees `removeCodexAgentProfiles` can never join a path that
 * escapes `.codex/agents` (review / CodeRabbit CWE-22: arbitrary filenames
 * from an ownership manifest must not become a path traversal).
 */
const CODEX_AGENT_PROFILE_NAME_PATTERN =
  /^agent-harness-[a-zA-Z0-9_-]+\.toml$/u;
const CODEX_PLUGIN_SOURCE_PATH = `./plugins/${CODEX_PLUGIN_NAME}`;
const CODEX_LEGACY_PLUGIN_PATH = `./${CODEX_PLUGIN_NAME}`;
const CODEX_MANAGED_MARKETPLACE_ENTRY = {
  name: CODEX_PLUGIN_NAME,
  localSourcePath: CODEX_PLUGIN_SOURCE_PATH,
  legacyPath: CODEX_LEGACY_PLUGIN_PATH,
} as const;

type CodexMarketplaceStyle = "current" | "legacy";

/**
 * Claims a Codex plugin directory for this apply via the shared ownership
 * helper: refuses a pre-existing unmarked dir (user-owned collision), allows
 * a dir we created this apply or already marked (re-apply safe).
 */
async function claimCodexPluginDirectory(pluginRoot: string): Promise<void> {
  await claimManagedPluginDirectory(pluginRoot, CODEX_PLUGIN_NAME);
}

/**
 * Writes Codex-native managed files using the current repo/team plugin and
 * custom-agent contracts. Hooks are intentionally not synthesized: the current
 * Codex plugin validator rejects unsupported hook fields, and raw hook assets
 * are not sufficient to construct a valid event-map safely. The apply is
 * ATOMIC-WITHOUT-ROLLBACK for the collision path: every adoption check
 * (top-level + legacy plugin roots) runs READ-ONLY before the first managed
 * write, so a user-owned collision rejects on a clean tree with zero side
 * effects. Genuine late I/O failures (a write itself throws) then trigger a
 * COMPLETE, CORRECTLY-SCOPED snapshot-restore so a reported failure never
 * leaves orphaned marketplace / profile / manifest state, and never deletes a
 * plugin root a PRIOR apply owned (CodeRabbit Major: the old partial rollback
 * was both incomplete and over-aggressive).
 *
 * Ownership decisions (which profile/marketplace cells are written, preserved,
 * removed, or restored) are NOT made by inline `if/then` arms here — they are
 * resolved from the executable CODEX ownership transition table via
 * `classifyProfileState`/`classifyMarketplaceState` +
 * `resolveOwnershipDecision` in codex-ownership-machine.ts. This file only
 * executes the returned decision.
 */
export async function writeCodexNativeFiles(
  options: WireNativeFilesOptions,
): Promise<NativeConfigOperation[]> {
  // Gate EVERY adoptable plugin root against collisions BEFORE writing any
  // managed path or ownership marker. If a root already exists unowned, the
  // read-only assertPluginDirectoryAdoptable check rejects — on a clean tree
  // with ZERO side effects, not after AGENTS.md / SKILL.md / a marker were
  // already written (Greptile P1: a failed setup left active Agent Harness
  // config behind despite reporting failure — non-atomic apply).
  const pluginRoot = join(options.workspaceRoot, "plugins", CODEX_PLUGIN_NAME);
  await assertPluginDirectoryAdoptable(pluginRoot, CODEX_PLUGIN_NAME);

  // A legacy-shaped marketplace routes the managed plugin to the nested
  // `.agents/plugins/agent-harness` root; precheck that root here too so a
  // user-owned collision there also rejects BEFORE the top-level marker lands.
  const marketplacePath = join(
    options.workspaceRoot,
    ".agents",
    "plugins",
    "marketplace.json",
  );
  const existingMarketplace =
    await readJsonFileOrNull<unknown>(marketplacePath);
  const usesLegacyLayout = isLegacyCodexMarketplace(
    existingMarketplace === null
      ? {}
      : assertJsonObject(existingMarketplace, marketplacePath),
  );
  const legacyPluginRoot = join(
    options.workspaceRoot,
    ".agents",
    "plugins",
    CODEX_PLUGIN_NAME,
  );
  if (usesLegacyLayout) {
    await assertPluginDirectoryAdoptable(legacyPluginRoot, CODEX_PLUGIN_NAME);
  }

  // Record this-apply-vs-prior-apply ownership BEFORE writing the marker: a
  // root already carrying our marker is owned by a PRIOR apply and must never
  // be deleted by a failed re-apply; an absent root is created by THIS apply
  // and is reclaimed in full on rollback.
  const pluginRootPreExisted = await hasManagedPluginMarker(
    pluginRoot,
    CODEX_PLUGIN_NAME,
  );
  const legacyRootPreExisted =
    usesLegacyLayout &&
    (await hasManagedPluginMarker(legacyPluginRoot, CODEX_PLUGIN_NAME));

  // Snapshot EVERY surface the apply may create or overwrite — managed text,
  // plugin manifests, generated profiles + their ownership manifest, the
  // marketplace + its ownership manifest, and the legacy compatibility files —
  // BEFORE the first managed write. On a late failure this yields a complete
  // restore (CodeRabbit Major: the old catch omitted the marketplace entry,
  // .agent-harness-marketplace.json, generated profiles, and
  // .agent-harness-profiles.json, orphaning them behind a reported failure).
  const agentsPath = join(options.workspaceRoot, "AGENTS.md");
  const managedSkillPath = join(
    options.workspaceRoot,
    ".agents",
    "skills",
    CODEX_PLUGIN_NAME,
    "SKILL.md",
  );
  const codexAgentsDir = join(options.workspaceRoot, ".codex", "agents");
  const rollback: CodexApplyRollback = { files: [], createdPluginRoots: [] };
  const files = rollback.files;
  files.push({
    path: agentsPath,
    priorContent: await readSnapshotTextOrNull(agentsPath),
  });
  files.push({
    path: managedSkillPath,
    priorContent: await readSnapshotTextOrNull(managedSkillPath),
  });
  // Owned profile files that may already exist on disk (a prior apply wrote
  // them) plus every profile THIS apply may create or regenerate.
  const profileFileNames = new Set<string>(
    await listCodexAgentProfileFileNames(codexAgentsDir),
  );
  for (const asset of options.nativeAssets) {
    if (asset.assetKind === "agent") {
      profileFileNames.add(codexAgentProfileFileName(asset.assetId));
    }
  }
  profileFileNames.add(CODEX_AGENT_PROFILES_MANIFEST_PATH);
  for (const name of profileFileNames) {
    files.push({
      path: join(codexAgentsDir, name),
      priorContent: await readSnapshotTextOrNull(join(codexAgentsDir, name)),
    });
  }
  files.push({
    path: marketplacePath,
    priorContent: await readSnapshotTextOrNull(marketplacePath),
  });
  files.push({
    path: join(dirname(marketplacePath), CODEX_MARKETPLACE_OWNERSHIP_MANIFEST),
    priorContent: await readSnapshotTextOrNull(
      join(dirname(marketplacePath), CODEX_MARKETPLACE_OWNERSHIP_MANIFEST),
    ),
  });
  // A RE-ADOPTED (prior-apply-owned) root is overwritten this apply, so its
  // managed files are snapshotted for byte-restore — but the root itself is
  // never reclaimed. A root CREATED this apply is reclaimed wholesale, so its
  // inner files need no per-file snapshot.
  if (pluginRootPreExisted) {
    files.push({
      path: join(pluginRoot, ".codex-plugin", "plugin.json"),
      priorContent: await readSnapshotTextOrNull(
        join(pluginRoot, ".codex-plugin", "plugin.json"),
      ),
    });
    files.push({
      path: join(pluginRoot, "skills", CODEX_PLUGIN_NAME, "SKILL.md"),
      priorContent: await readSnapshotTextOrNull(
        join(pluginRoot, "skills", CODEX_PLUGIN_NAME, "SKILL.md"),
      ),
    });
  } else {
    rollback.createdPluginRoots.push(pluginRoot);
  }
  if (usesLegacyLayout) {
    if (legacyRootPreExisted) {
      files.push({
        path: join(legacyPluginRoot, ".codex-plugin", "plugin.json"),
        priorContent: await readSnapshotTextOrNull(
          join(legacyPluginRoot, ".codex-plugin", "plugin.json"),
        ),
      });
      if (options.nativeAssets.some((asset) => asset.assetKind === "hook")) {
        files.push({
          path: join(legacyPluginRoot, "hooks", "hooks.json"),
          priorContent: await readSnapshotTextOrNull(
            join(legacyPluginRoot, "hooks", "hooks.json"),
          ),
        });
      }
    } else {
      rollback.createdPluginRoots.push(legacyPluginRoot);
    }
  }

  try {
    await claimCodexPluginDirectory(pluginRoot);
    if (usesLegacyLayout) {
      await claimCodexPluginDirectory(legacyPluginRoot);
    }

    const managedLines = buildManagedInstructionLines({
      hostName: "OpenAI Codex",
      managedRoot: options.managedRoot,
      nativeAssets: options.nativeAssets,
      materializedAssets: options.materializedAssets,
      mcpServers: options.mcpServers,
    });

    await upsertManagedSectionFile(
      agentsPath,
      "agent-harness-codex",
      managedLines,
    );
    await writeTextFile(
      managedSkillPath,
      buildSkillFile(
        CODEX_PLUGIN_NAME,
        "Use curated Agent Harness assets for this Codex project.",
        [
          ...managedLines,
          ...buildNativeAssetContentSections(options.nativeAssets, [
            "skill",
            "instruction",
            "reference-pack",
          ]),
        ],
      ),
    );

    await writeJsonFile(
      join(pluginRoot, ".codex-plugin", "plugin.json"),
      buildCodexPluginManifest(),
    );
    await writeTextFile(
      join(pluginRoot, "skills", CODEX_PLUGIN_NAME, "SKILL.md"),
      buildSkillFile(
        CODEX_PLUGIN_NAME,
        "Use curated Agent Harness assets for this Codex project.",
        [
          ...managedLines,
          ...buildNativeAssetContentSections(options.nativeAssets, [
            "skill",
            "instruction",
            "reference-pack",
            "prompt-pack",
            "workflow",
          ]),
        ],
      ),
    );

    await writeCodexAgentProfiles(options.workspaceRoot, options.nativeAssets);
    const marketplaceStyle = await mergeCodexPluginMarketplace(marketplacePath);

    if (marketplaceStyle === "legacy") {
      await writeLegacyCodexCompatibilityPlugin(options);
    }

    return applyStructuredNativeConfig(options.workspaceRoot, "codex", {
      nativeAssets: options.nativeAssets,
    });
  } catch (error) {
    // Complete, correctly-scoped snapshot-restore: restore (or remove) every
    // file this apply touched, and remove only plugin roots THIS apply created.
    // Prior-apply-owned roots are left untouched — never deleted (CodeRabbit
    // Major: the old hasManagedPluginMarker guard also matched earlier applies).
    for (const file of files) {
      if (file.priorContent === null) {
        await removePathIfReachable(file.path);
      } else {
        await writeTextFile(file.path, file.priorContent);
      }
    }
    for (const root of rollback.createdPluginRoots) {
      await removePath(root);
    }
    await pruneEmptyApplyParents(options.workspaceRoot);
    throw error;
  }
}

/**
 * The snapshot the apply captures BEFORE its first managed write. On a late
 * failure the rollback restores exactly what THIS apply touched: every file it
 * may have created or overwritten (restored byte-for-byte when it pre-existed,
 * removed when it did not), and plugin roots it CREATED this apply (removed in
 * full, marker and all). Roots a PRIOR apply owned are NEVER included and so
 * survive a failed re-apply (CodeRabbit Major: the old catch deleted a prior
 * apply's plugin directory because hasManagedPluginMarker matched it too).
 */
interface CodexApplyRollback {
  files: CodexApplySnapshotFile[];
  /** Plugin roots absent before this apply; removed wholesale on rollback. */
  createdPluginRoots: string[];
}

/** A pre-apply snapshot of one file the apply may overwrite or create. */
interface CodexApplySnapshotFile {
  path: string;
  /** Original content; null when the file did not exist before the apply. */
  priorContent: string | null;
}

/** Reads snapshot bytes, treating an unreachable path (ENOTDIR parent) as absent. */
async function readSnapshotTextOrNull(
  filePath: string,
  read: (p: string) => Promise<string | null> = readTextFileOrNull,
): Promise<string | null> {
  try {
    return await read(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOTDIR") {
      return null;
    }
    /* c8 ignore next -- defensive rethrow of an unforeseen filesystem error */
    throw error;
  }
}

/** Removes a path, tolerating an unreachable one (ENOTDIR parent, e.g. `.codex` is a file). */
async function removePathIfReachable(
  filePath: string,
  rm: (p: string) => Promise<void> = removePath,
): Promise<void> {
  try {
    await rm(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOTDIR") {
      return;
    }
    /* c8 ignore next -- defensive rethrow of an unforeseen filesystem error */
    throw error;
  }
}

/** Lists existing owned-codex profile filenames below an agents directory. */
async function listCodexAgentProfileFileNames(
  agentsDir: string,
  list: (p: string) => Promise<string[]> = readdir,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await list(agentsDir);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      (error as NodeJS.ErrnoException).code === "ENOTDIR"
    ) {
      return [];
    }
    /* c8 ignore next -- defensive rethrow of an unforeseen readdir error */
    throw error;
  }
  return entries.filter((entry) =>
    CODEX_AGENT_PROFILE_NAME_PATTERN.test(entry),
  );
}

/** Deterministic owned-profile filename for an agent asset id. */
function codexAgentProfileFileName(assetId: string): string {
  const slug = sanitizeAssetId(assetId).replace(/[^a-zA-Z0-9_-]+/gu, "-");
  return `${CODEX_AGENT_FILE_PREFIX}${slug}.toml`;
}

/** Prunes directories emptied by a rollback, stopping at the workspace root. */
async function pruneEmptyApplyParents(
  workspaceRoot: string,
  prune: (p: string) => Promise<void> = (p) =>
    removeEmptyParentDirectories(p, workspaceRoot),
): Promise<void> {
  const starts = [
    join(workspaceRoot, ".codex", "agents"),
    join(workspaceRoot, ".codex"),
    join(workspaceRoot, ".agents", "skills", CODEX_PLUGIN_NAME),
    join(workspaceRoot, ".agents", "skills"),
    join(workspaceRoot, ".agents", "plugins", CODEX_PLUGIN_NAME),
    join(workspaceRoot, ".agents", "plugins"),
    join(workspaceRoot, ".agents"),
    join(workspaceRoot, "plugins"),
  ];
  for (const start of starts) {
    try {
      await prune(start);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT" ||
        (error as NodeJS.ErrnoException).code === "ENOTDIR"
      ) {
        continue;
      }
      /* c8 ignore next -- defensive rethrow of an unforeseen removeEmptyParentDirectories error */
      throw error;
    }
  }
}

/** Builds the current Codex plugin manifest. */
export function buildCodexPluginManifest(): Record<string, unknown> {
  return {
    name: CODEX_PLUGIN_NAME,
    version: CODEX_PLUGIN_VERSION,
    description: "Project-local Agent Harness assets for OpenAI Codex.",
    author: { name: "Agent Harness" },
    skills: "./skills/",
    interface: {
      displayName: "Agent Harness",
      shortDescription: "Curated project context and skills for Codex.",
      longDescription:
        "Project-local Agent Harness context, curated skills, and custom agents for OpenAI Codex.",
      developerName: "Agent Harness",
      category: "Productivity",
      capabilities: ["Project context", "Skills", "Custom agents"],
    },
  };
}

/** Current Codex plugins do not synthesize hook manifests. */
export function buildCodexHooksManifest(): null {
  return null;
}

/** Builds the legacy hook manifest used by legacy Codex plugin layouts. */
export function buildLegacyCodexHooksManifest(
  nativeAssets: readonly NativeAsset[],
  contentPathByAssetId: Readonly<Record<string, string>>,
  hooksManifestPath?: string,
): Record<string, unknown> {
  const manifestDirectory = hooksManifestPath
    ? dirname(hooksManifestPath)
    : undefined;

  return {
    schemaVersion: 1,
    hooks: nativeAssets
      .filter((nativeAsset) => nativeAsset.assetKind === "hook")
      .map((nativeAsset) => {
        const matchedFile = contentPathByAssetId[nativeAsset.assetId];
        const source = matchedFile
          ? manifestDirectory
            ? relative(manifestDirectory, matchedFile).replaceAll("\\", "/")
            : matchedFile
          : nativeAsset.assetId;
        return {
          name: nativeAsset.assetId,
          description: nativeAsset.displayName,
          source,
        };
      }),
  };
}

/**
 * Records which `agent-harness-*.toml` custom-agent profiles THIS apply owns,
 * plus their pre-apply content. Reset strips exactly these and restores any
 * displaced user-owned profile instead of prefix-deleting every match (review
 * / Greptile P1: deterministic filename collisions must not erase user files).
 */
const CODEX_AGENT_PROFILES_MANIFEST_PATH = ".agent-harness-profiles.json";
/**
 * Records whether THIS apply created the repo marketplace file from scratch
 * (plain name/interface/plugins) versus merged into a user-owned or repo-owned
 * marketplace that already existed. Reset deletes the whole marketplace file
 * ONLY when this manifest proves Agent Harness created it; a user's own
 * `agent-harness-local` marketplace that merely looks managed-shaped must
 * survive (review / Greptile P1: never infer whole-file ownership from a
 * shape heuristic).
 */
const CODEX_MARKETPLACE_OWNERSHIP_MANIFEST = ".agent-harness-marketplace.json";

/**
 * Writes the owned agent profiles and the running ownership manifest, routing
 * every per-profile decision through the executable ownership transition table:
 *
 * - INCOMING agents (apply / re-apply / re-add) → writer decisions.
 * - Prior records DROPPED from the incoming set (reduce / no-agent reconcile)
 *   → cleanup decisions.
 *
 * This replaces the previous inlined `if/then` preserve/write/regenerate arms
 * with `classifyProfileState` + `resolveOwnershipDecision`; the concrete
 * filesystem work is performed by `executeCodexProfileDecision`.
 */
async function writeCodexAgentProfiles(
  workspaceRoot: string,
  nativeAssets: NativeAsset[],
): Promise<void> {
  const agents = nativeAssets.filter((asset) => asset.assetKind === "agent");
  const agentsDir = join(workspaceRoot, ".codex", "agents");
  const manifestPath = join(agentsDir, CODEX_AGENT_PROFILES_MANIFEST_PATH);
  // Preserve the ORIGINAL priorContent for files a previous apply already
  // owned (indexed by fileName). Without this, a re-apply would re-snapshot
  // the harness's own written bytes as the new "prior", so a user file
  // displaced on the first apply would be "restored" to harness content on
  // remove (re-apply poisons fresh snapshots — same trap as the wire-reset
  // ownership doctored for opencode's gitignoreOwnedEntries).
  const previousRecords =
    ((await readCodexAgentProfileRecords(workspaceRoot)) as
      CodexAgentProfileRecord[] | null) ?? [];
  const previousByFileName = new Map(
    previousRecords.map((record) => [record.fileName, record]),
  );
  const incomingFileNames = new Set<string>();
  for (const asset of agents) {
    const slug = sanitizeAssetId(asset.assetId).replace(
      /[^a-zA-Z0-9_-]+/gu,
      "-",
    );
    incomingFileNames.add(`${CODEX_AGENT_FILE_PREFIX}${slug}.toml`);
  }

  const records: CodexAgentProfileRecord[] = [];

  // CLEANUP: reconcile prior records absent from the incoming agent set BEFORE
  // the manifest is replaced (reduce semantics). A removed agent's generated
  // profile would otherwise stay on disk yet vanish from the ownership
  // manifest, so reset could never remove it (or restore the user profile it
  // displaced) — orphaned, active, and untracked (Greptile P1). Each record's
  // decision comes from the ownership table (cleanup rows).
  for (const [fileName, priorRecord] of previousByFileName) {
    if (incomingFileNames.has(fileName)) continue;
    const live = await readTextFileOrNull(join(agentsDir, fileName));
    const decision = lookupProfileDecision(priorRecord, live, "reduce");
    await executeCodexProfileDecision(
      records,
      agentsDir,
      fileName,
      priorRecord,
      decision as CodexCleanupProfileDecision,
    );
  }

  // WRITER: provision (or preserve) every in-coming agent. The decision for
  // each profile (write vs preserve-user-edit, and what priorContent to record)
  // comes from the ownership table (writer rows).
  for (const asset of agents) {
    const slug = sanitizeAssetId(asset.assetId).replace(
      /[^a-zA-Z0-9_-]+/gu,
      "-",
    );
    const fileName = `${CODEX_AGENT_FILE_PREFIX}${slug}.toml`;
    const profilePath = join(agentsDir, fileName);
    const priorRecord = previousByFileName.get(fileName);
    const content = [
      `name = ${JSON.stringify(asset.displayName)}`,
      `description = ${JSON.stringify(`Agent Harness asset ${asset.assetId}`)}`,
      `developer_instructions = ${JSON.stringify(asset.content)}`,
      "",
    ].join("\n");
    const live = await readTextFileOrNull(profilePath);
    const decision = lookupProfileDecision(priorRecord, live, "apply");
    await executeCodexProfileDecisionWithContent(
      records,
      agentsDir,
      fileName,
      priorRecord,
      live,
      decision as CodexWriteProfileDecision,
      content,
    );
  }

  // Persist the running manifest. The reconcile loop above already cleaned
  // orphaned harness-owned profiles (removed/restored) and RETAINED any
  // surviving user-owned profiles in `records` — including when a no-agent
  // apply orphans every prior record. So the same write/remove path applies in
  // both cases: write the manifest when user-owned profiles survive (their
  // record must outlive the apply so a later re-add keeps preserving them),
  // otherwise drop the manifest so it never dangles in the user's tree.
  if (records.length > 0) {
    await writeJsonFile(manifestPath, {
      schemaVersion: 1,
      profiles: records,
    });
  } else {
    await removePath(manifestPath);
  }
}

/**
 * Looks up the profile's ownership state from its prior record + live bytes and
 * resolves the transition-table decision for the given action, narrowed to the
 * actions that action group can actually produce:
 * - "apply"/"re-apply"/"re-add" → writer decisions (write / preserve-user-edit)
 * - "reduce"/"reset" → cleanup decisions (retain / remove / restore / ghost-drop)
 * This is the ONLY place `codex-native` derives a profile decision — the table
 * is the source of truth. The actor is derived from the classified state.
 */
function lookupProfileDecision(
  priorRecord: CodexAgentProfileRecord | undefined,
  live: string | null,
  action: "apply" | "re-apply" | "re-add" | "reduce" | "reset",
): CodexProfileDecision {
  const liveMatches =
    priorRecord?.contentFingerprint !== undefined &&
    live !== null &&
    createContentHash(live) === priorRecord.contentFingerprint;
  const state = classifyProfileState(priorRecord, live, liveMatches);
  // The transition table's actor is derived from the CLASSIFIED state (the
  // state already encodes who owns the artifact), never from the raw record —
  // optional-chaining on an undefined record would mislabel untracked cells.
  const actor = profileActorForState(state);
  const decision = resolveOwnershipDecision("profile", state, actor, action);
  // The table guarantees the action group's rows only contain that group's
  // decision kinds (enforced structurally by the row builders + asserted
  // exhaustively in the matrix test), and resolveOwnershipDecision already
  // throws on a missing cell — so no runtime family guard is needed here.
  return decision as CodexProfileDecision;
}

/**
 * Executes a CLEANUP profile decision (reduce/reset rows): retain, remove,
 * restore, or ghost-drop. The table guarantees only cleanup kinds reach here;
 * every arm below is reachable (harness-created/displaced states imply a live
 * file — the fingerprint-match guard downstream already excluded null).
 */
async function executeCodexProfileDecision(
  records: CodexAgentProfileRecord[],
  agentsDir: string,
  fileName: string,
  priorRecord: CodexAgentProfileRecord,
  decision: CodexCleanupProfileDecision,
): Promise<void> {
  switch (decision.kind) {
    case "retain-user-owned":
      // A user-owned profile must SURVIVE cleanup; its record is re-recorded
      // (or, if the file was deleted, ghost-dropped — nothing to reclaim).
      await retainUserOwnedProfile(records, agentsDir, fileName);
      return;
    case "remove-harness-file":
      // Untouched harness-created profile (priorContent null): remove it.
      await removePath(join(agentsDir, fileName));
      return;
    case "restore-prior-content":
      // Untouched harness-written profile over a displaced user file: restore
      // the user's original bytes instead of deleting. This decision is only
      // produced for the harness-displaced state, which classification gates on
      // priorRecord.priorContent !== null, so the value is non-null here.
      await writeTextFile(join(agentsDir, fileName), priorRecord.priorContent!);
      return;
    case "ghost-drop":
      // User deleted the file (or no ownership record): nothing on disk to
      // touch — drop the ghost record so no stale ownership dangles.
      return;
  }
}

/**
 * Executes a WRITER profile decision (apply/re-apply/re-add rows): write the
 * generated bytes with the decision's priorContent mode, or preserve the user's
 * live bytes without writing.
 */
async function executeCodexProfileDecisionWithContent(
  records: CodexAgentProfileRecord[],
  agentsDir: string,
  fileName: string,
  priorRecord: CodexAgentProfileRecord | undefined,
  live: string | null,
  decision: CodexWriteProfileDecision,
  content: string,
): Promise<void> {
  if (decision.kind === "preserve-user-edit") {
    // Keep the user's bytes, never regenerate; record the profile as
    // user-owned so later applies preserve it too.
    records.push({
      fileName,
      priorContent: live,
      userOwned: true,
    });
    return;
  }
  // WRITE (create / displace / re-write / regenerate): record the priorContent
  // the table's decision mode selected.
  const profilePath = join(agentsDir, fileName);
  let priorContent: string | null;
  switch (decision.priorContentMode) {
    case "live":
      // First apply displaced a colliding user file: record its bytes so reset
      // restores them.
      priorContent = live;
      break;
    case "prior-record":
      // Carry the ORIGINAL priorContent forward (re-apply poisoning guard).
      // This decision mode is only produced for the harness-created /
      // harness-displaced writer states, which classification guarantees carry
      // a prior record — so it is always defined here.
      priorContent = priorRecord!.priorContent;
      break;
    case "none":
      // Fresh create, or regenerate a deleted profile: priorContent null so
      // reset never resurrects stale/deleted bytes.
      priorContent = null;
      break;
  }
  records.push({
    fileName,
    priorContent,
    // Fingerprint the exact generated bytes so cleanup deletes/restores it
    // only when untouched; a user's post-apply edit changes the bytes.
    contentFingerprint: createContentHash(content),
  });
  await writeTextFile(profilePath, content);
}

/** Reads the owned-profile manifest recorded by the last apply (null if none). */
async function readCodexAgentProfileRecords(
  workspaceRoot: string,
): Promise<CodexAgentProfileRecord[] | null> {
  const manifest = await readJsonFileOrNull<{
    profiles?: unknown;
  }>(
    join(workspaceRoot, ".codex", "agents", CODEX_AGENT_PROFILES_MANIFEST_PATH),
  );
  if (!manifest || !Array.isArray(manifest.profiles)) {
    return null;
  }
  return manifest.profiles.filter((entry): entry is CodexAgentProfileRecord => {
    if (!isJsonObject(entry)) return false;
    if (typeof entry.fileName !== "string") return false;
    // A plain `agent-harness-*.toml` filename only — reject separators and
    // the empty slug so a hostile manifest can never point cleanup at a path
    // outside `.codex/agents` (review / CodeRabbit CWE-22 path traversal).
    if (!CODEX_AGENT_PROFILE_NAME_PATTERN.test(entry.fileName)) return false;
    // priorContent is exactly the recorded shape (string | null).
    if (entry.priorContent !== null && typeof entry.priorContent !== "string") {
      return false;
    }
    // contentFingerprint, when present, is exactly a string.
    if (
      entry.contentFingerprint !== undefined &&
      typeof entry.contentFingerprint !== "string"
    ) {
      return false;
    }
    // userOwned, when present, is exactly a boolean.
    if (entry.userOwned !== undefined && typeof entry.userOwned !== "boolean") {
      return false;
    }
    return true;
  });
}

/**
 * True when a marketplace value (the parsed `.agents/plugins/marketplace.json`
 * object) selects the LEGACY plugin layout, which routes the managed Codex
 * plugin to the nested `.agents/plugins/agent-harness` path instead of the
 * top-level `plugins/agent-harness`. Shared by the apply-time claim gate (so a
 * user-owned collision at the legacy root rejects BEFORE any managed file is
 * written) and by `mergeCodexPluginMarketplace` (single source of truth for the
 * layout decision).
 */
function isLegacyCodexMarketplace(
  marketplace: Record<string, unknown>,
): boolean {
  const rawPlugins: unknown[] = Array.isArray(marketplace.plugins)
    ? marketplace.plugins
    : [];
  return (
    typeof marketplace.schemaVersion === "number" ||
    rawPlugins.some(
      (entry) => isJsonObject(entry) && typeof entry.path === "string",
    )
  );
}

/** Merges the managed plugin into the repo/team Codex marketplace. */
export async function mergeCodexPluginMarketplace(
  filePath: string,
): Promise<CodexMarketplaceStyle> {
  const existing = await readJsonFileOrNull<unknown>(filePath);
  const ownershipManifestPath = join(
    dirname(filePath),
    CODEX_MARKETPLACE_OWNERSHIP_MANIFEST,
  );
  const priorOwnership = await readJsonFileOrNull<{
    created?: unknown;
    fingerprint?: unknown;
  }>(ownershipManifestPath);
  const wasCreatedPreviously = priorOwnership?.created === true;
  const priorFingerprint =
    typeof priorOwnership?.fingerprint === "string"
      ? priorOwnership.fingerprint
      : null;
  const liveIsUnedited =
    existing !== null &&
    priorFingerprint !== null &&
    createContentHash(serializeMarketplaceFile(existing)) === priorFingerprint;
  // Whole-file ownership is decided by the executable ownership table: the
  // market-merge rows map (exists, created-previously, live-matches) to
  // keep-ownership vs relinquish (provenance semantics, not just byte-match —
  // "marketplace reapply turns user content into deletable state").
  const state = classifyMarketplaceState(
    existing !== null,
    wasCreatedPreviously,
    liveIsUnedited,
  );
  const decision = resolveOwnershipDecision(
    "marketplace",
    state,
    marketplaceActorForState(state),
    "apply",
  ) as CodexMarketplaceDecision;
  const ownsWholeFile = decision.kind === "merge-and-keep-ownership";

  const marketplace =
    existing === null ? {} : assertJsonObject(existing, filePath);
  const rawPlugins: unknown[] = Array.isArray(marketplace.plugins)
    ? marketplace.plugins
    : [];
  const legacy = isLegacyCodexMarketplace(marketplace);

  if (legacy) {
    const legacyMarketplace = {
      ...marketplace,
      plugins: replaceManagedMarketplaceEntry(
        rawPlugins,
        CODEX_MANAGED_MARKETPLACE_ENTRY,
        { name: CODEX_PLUGIN_NAME, path: CODEX_LEGACY_PLUGIN_PATH },
      ),
    };
    await writeJsonFile(filePath, legacyMarketplace);
    await recordCodexMarketplaceOwnership(
      filePath,
      ownsWholeFile,
      createContentHash(serializeMarketplaceFile(legacyMarketplace)),
    );
    return "legacy";
  }

  const currentMarketplace = {
    ...marketplace,
    name:
      typeof marketplace.name === "string"
        ? marketplace.name
        : CODEX_MARKETPLACE_NAME,
    interface: isJsonObject(marketplace.interface)
      ? {
          ...marketplace.interface,
          displayName:
            typeof marketplace.interface.displayName === "string"
              ? marketplace.interface.displayName
              : "Agent Harness Local",
        }
      : { displayName: "Agent Harness Local" },
    plugins: replaceManagedMarketplaceEntry(
      rawPlugins,
      CODEX_MANAGED_MARKETPLACE_ENTRY,
      {
        name: CODEX_PLUGIN_NAME,
        source: {
          source: "local",
          path: CODEX_PLUGIN_SOURCE_PATH,
        },
        policy: {
          installation: "AVAILABLE",
          authentication: "ON_INSTALL",
        },
        category: "Productivity",
      },
    ),
  };
  await writeJsonFile(filePath, currentMarketplace);
  await recordCodexMarketplaceOwnership(
    filePath,
    ownsWholeFile,
    createContentHash(serializeMarketplaceFile(currentMarketplace)),
  );
  return "current";
}

/**
 * Records whether the marketplace file is Agent-Harness-create-able on reset.
 * `created` is the caller/table-computed whole-file ownership: true only when
 * this apply created it from scratch, or a prior apply created it AND the live
 * bytes still match the prior fingerprint (unchanged reapply). A harness-
 * created marketplace the user later replaced/edited is recorded with
 * `created:false` (provenance relinquished) so reset never whole-deletes the
 * user's file. `fingerprint` is the content hash of the EXACT bytes this apply
 * wrote, so reset deletes the whole file ONLY when the current bytes still
 * match what the harness wrote (review / Greptile P1).
 */
async function recordCodexMarketplaceOwnership(
  filePath: string,
  created: boolean,
  fingerprint: string,
): Promise<void> {
  const ownershipManifestPath = join(
    dirname(filePath),
    CODEX_MARKETPLACE_OWNERSHIP_MANIFEST,
  );
  await writeJsonFile(ownershipManifestPath, {
    schemaVersion: 1,
    created,
    fingerprint,
  });
}

/** Serializes a marketplace object exactly as writeJsonFile writes it. */
function serializeMarketplaceFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeLegacyCodexCompatibilityPlugin(
  options: WireNativeFilesOptions,
): Promise<void> {
  const legacyPluginRoot = join(
    options.workspaceRoot,
    ".agents",
    "plugins",
    CODEX_PLUGIN_NAME,
  );
  await claimCodexPluginDirectory(legacyPluginRoot);
  const hookAssets = options.nativeAssets.filter(
    (asset) => asset.assetKind === "hook",
  );
  await writeJsonFile(join(legacyPluginRoot, ".codex-plugin", "plugin.json"), {
    name: CODEX_PLUGIN_NAME,
    version: "1.0.0",
    description: "Project-local Agent Harness assets for OpenAI Codex.",
    skills: "./skills",
    ...(hookAssets.length > 0 ? { hooks: "./hooks/hooks.json" } : {}),
  });
  if (hookAssets.length > 0) {
    const hooksManifestPath = join(legacyPluginRoot, "hooks", "hooks.json");
    await writeJsonFile(hooksManifestPath, {
      schemaVersion: 1,
      hooks: hookAssets.map((asset) => {
        const sourcePath = join(
          options.managedRoot,
          "assets",
          "hooks",
          sanitizeAssetId(asset.assetId),
          "hook.md",
        );
        return {
          name: asset.assetId,
          description: asset.displayName,
          source: relative(dirname(hooksManifestPath), sourcePath).replaceAll(
            "\\",
            "/",
          ),
        };
      }),
    });
  }
}

/** Removes all Codex-native files installed by agent-harness. */
export async function resetCodexNativeHost(
  workspaceRoot: string,
  textFileSnapshots: ManagedTextFileSnapshot[] | undefined,
): Promise<void> {
  await restoreManagedTextFileSnapshot(
    join(workspaceRoot, "AGENTS.md"),
    textFileSnapshots,
    () =>
      removeManagedSectionFile(
        join(workspaceRoot, "AGENTS.md"),
        "agent-harness-codex",
      ),
  );
  await removePath(join(workspaceRoot, ".agents", "skills", CODEX_PLUGIN_NAME));
  const pluginRoot = join(workspaceRoot, "plugins", CODEX_PLUGIN_NAME);
  if (await hasManagedPluginMarker(pluginRoot, CODEX_PLUGIN_NAME)) {
    await removePath(pluginRoot);
  }
  const legacyPluginRoot = join(
    workspaceRoot,
    ".agents",
    "plugins",
    CODEX_PLUGIN_NAME,
  );
  if (await hasManagedPluginMarker(legacyPluginRoot, CODEX_PLUGIN_NAME)) {
    await removePath(legacyPluginRoot);
  }
  await removeCodexAgentProfiles(workspaceRoot);
  await removeCodexMarketplaceEntry(
    join(workspaceRoot, ".agents", "plugins", "marketplace.json"),
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, ".agents", "skills"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, ".agents", "plugins"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, ".agents"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, ".codex", "agents"),
    workspaceRoot,
  );
  await removeEmptyParentDirectories(
    join(workspaceRoot, "plugins"),
    workspaceRoot,
  );
}

/**
 * RETAINS (or re-records) a user-owned profile in the running manifest: keeps
 * the user's live bytes and marks the record userOwned:true so any later
 * apply/reset recognizes it and never regenerates over it. Used on the
 * reduced-set reconcile, no-agent apply, and reset paths — the record must
 * survive those transitions, not just the file (Greptile P1: "Profile
 * ownership vanishes after reapply"). Only invoked for the ownership table's
 * `retain-user-owned` decision, which classification produces ONLY when the
 * file is present (user-owned / user-edited / legacy-user-owned all require
 * `live !== null`); a DELETED user-owned profile maps to the `user-deleted` /
 * `ghost-drop` decision instead, which drops the record without calling here —
 * so this function always sees a live file and never needs a null guard.
 */
async function retainUserOwnedProfile(
  records: CodexAgentProfileRecord[],
  agentsDir: string,
  fileName: string,
): Promise<void> {
  const live = await readTextFileOrNull(join(agentsDir, fileName));
  records.push({ fileName, priorContent: live, userOwned: true });
}

/**
 * Removes Agent Harness's owned agent profiles on reset. Every record's
 * cleanup decision (retain / remove / restore / ghost-drop) comes from the
 * executable ownership transition table via `classifyProfileState` +
 * `resolveOwnershipDecision`, so reset honors the same doctrine as the
 * reduced-set reconcile.
 */
async function removeCodexAgentProfiles(workspaceRoot: string): Promise<void> {
  const agentsDir = join(workspaceRoot, ".codex", "agents");
  const records = await readCodexAgentProfileRecords(workspaceRoot);
  if (records === null) {
    // No ownership record: do NOT prefix-delete. Over-preservation is safe —
    // never delete user files we cannot prove we own (review / Greptile P1).
    return;
  }
  // Profiles that survive reset/no-agent apply (user-edited or user-owned) are
  // RETAINED in a refreshed manifest, not dropped: dropping the record would
  // let a later re-add see the preserved file as untracked pre-existing and
  // regenerate over the user's edit (Greptile P1: record must survive reset).
  const retained: CodexAgentProfileRecord[] = [];
  for (const record of records) {
    const live = await readTextFileOrNull(join(agentsDir, record.fileName));
    const decision = lookupProfileDecision(record, live, "reset");
    await executeCodexProfileDecision(
      retained,
      agentsDir,
      record.fileName,
      record,
      decision as CodexCleanupProfileDecision,
    );
  }
  if (retained.length > 0) {
    await writeJsonFile(join(agentsDir, CODEX_AGENT_PROFILES_MANIFEST_PATH), {
      schemaVersion: 1,
      profiles: retained,
    });
  } else {
    await removePath(join(agentsDir, CODEX_AGENT_PROFILES_MANIFEST_PATH));
  }
}

/**
 * Removes the managed marketplace entry (or the whole file Agent Harness
 * provably created) on reset. The whole-file-delete decision comes from the
 * executable ownership table (marketplace reset rows): the file is removed
 * ONLY when the table says harness created it AND the current bytes still
 * match the exact content the harness wrote; otherwise only the managed entry
 * is stripped and the user's file preserved.
 */
async function removeCodexMarketplaceEntry(filePath: string): Promise<void> {
  const ownershipManifestPath = join(
    dirname(filePath),
    CODEX_MARKETPLACE_OWNERSHIP_MANIFEST,
  );
  const ownership = await readJsonFileOrNull<{
    created?: unknown;
    fingerprint?: unknown;
  }>(ownershipManifestPath);
  const recordedFingerprint =
    typeof ownership?.fingerprint === "string" ? ownership.fingerprint : null;
  // Always consume the ownership manifest — this apply is done with it.
  await removePath(ownershipManifestPath);

  const existingText = await readTextFileOrNull(filePath);
  if (existingText === null) return;
  const createdPreviously = ownership?.created === true;
  const liveMatches =
    recordedFingerprint !== null &&
    createContentHash(existingText) === recordedFingerprint;
  const state = classifyMarketplaceState(true, createdPreviously, liveMatches);
  const decision = resolveOwnershipDecision(
    "marketplace",
    state,
    marketplaceActorForState(state),
    "reset",
  ) as CodexMarketplaceDecision;
  if (decision.kind === "remove-marketplace-file") {
    await removePath(filePath);
    return;
  }

  // marketplace-preserve: strip only the managed entry, never whole-delete the
  // user file (a managed file the user edited since apply is likewise kept).
  const marketplace = assertJsonObject(JSON.parse(existingText), filePath);
  const rawPlugins: unknown[] = Array.isArray(marketplace.plugins)
    ? marketplace.plugins
    : [];
  const plugins = removeManagedMarketplaceEntries(
    rawPlugins,
    CODEX_MANAGED_MARKETPLACE_ENTRY,
  );
  await writeJsonFile(filePath, { ...marketplace, plugins });
}

/**
 * Test-only surface for the snapshot-restore guard helpers + ownership
 * classification. The underlying filesystem ops are injectable so each error
 * arm (ENOENT / ENOTDIR / other) is driven deterministically on every OS —
 * Windows surfaces these differently in real fs calls (ENOENT under a
 * file-path), so injection is the only platform-independent way to cover the
 * ENOTDIR branches (platform-isolation doctrine).
 */
export const codexNativeInternals = {
  readSnapshotTextOrNull,
  removePathIfReachable,
  listCodexAgentProfileFileNames,
  pruneEmptyApplyParents,
  codexAgentProfileFileName,
  lookupProfileDecision,
};
