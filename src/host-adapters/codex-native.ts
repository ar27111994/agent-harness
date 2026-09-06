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
 * custom-agent contracts. Hooks are intentionally not synthesized: the
 * current Codex plugin validator rejects unsupported hook fields, and raw
 * hook assets are not sufficient to construct a valid event-map safely.
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

  // All adoptable roots passed their read-only check, so no claim can reject:
  // commit the markers, then write the managed files. If a LATER step fails,
  // roll back exactly what this apply wrote so a reported failure leaves a
  // clean tree — never orphaned managed config + a marker (Greptile P1 / codex
  // atomicity: "Late write failure leaves managed state").
  await claimCodexPluginDirectory(pluginRoot);
  if (usesLegacyLayout) {
    await claimCodexPluginDirectory(legacyPluginRoot);
  }

  // Snapshot every text path the apply OVERWRITES before writing, so a late
  // failure restores byte-for-byte — never a delete that destroys a user's
  // pre-existing file (review: rollback = snapshot-then-restore, not delete).
  const agentsPath = join(options.workspaceRoot, "AGENTS.md");
  const agentsSnapshot = await readTextFileOrNull(agentsPath);
  const managedSkillPath = join(
    options.workspaceRoot,
    ".agents",
    "skills",
    CODEX_PLUGIN_NAME,
    "SKILL.md",
  );
  const managedSkillSnapshot = await readTextFileOrNull(managedSkillPath);

  try {
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
    // Restore over-written text files byte-for-byte (snapshot-then-restore,
    // NOT delete): the apply may have overwritten a user's pre-existing
    // AGENTS.md / SKILL.md, and a delete-rollback would destroy their content
    // (review). Marker-proven plugin directories are reclaimed (safe — the
    // claim gate rejects unmarked dirs, so these are harness-owned).
    if (agentsSnapshot === null) {
      await removeManagedSectionFile(agentsPath, "agent-harness-codex");
    } else {
      await writeTextFile(agentsPath, agentsSnapshot);
    }
    if (managedSkillSnapshot === null) {
      await removePath(managedSkillPath);
    } else {
      await writeTextFile(managedSkillPath, managedSkillSnapshot);
    }
    if (await hasManagedPluginMarker(pluginRoot, CODEX_PLUGIN_NAME)) {
      await removePath(pluginRoot);
    }
    if (
      usesLegacyLayout &&
      (await hasManagedPluginMarker(legacyPluginRoot, CODEX_PLUGIN_NAME))
    ) {
      await removePath(legacyPluginRoot);
    }
    throw error;
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

/** A single Codex custom-agent profile file Agent Harness owns. */
interface CodexAgentProfileRecord {
  fileName: string;
  /** Original pre-apply content; null when the file did not exist before. */
  priorContent: string | null;
  /**
   * Content hash of the EXACT bytes this apply wrote for the profile. Reset /
   * reduced-agent reconcile removes (or restores the prior snapshot of) a
   * profile ONLY when the on-disk bytes still match this fingerprint; a user
   * who edited the generated `agent-harness-*.toml` after apply changes the
   * bytes, so the user's edits are preserved instead of deleted/overwritten
   * (Greptile P1: "Codex profile cleanup overwrites user edits").
   */
  contentFingerprint?: string;
  /**
   * True when this profile is user-owned: the user edited the generated file
   * after apply, so Agent Harness relinquished ownership. The record is
   * RETAINED (not dropped) so a subsequent apply recognizes the profile as
   * user-owned and never regenerates/overwrites it — dropping the record
   * would let the next reapply see it as untracked and clobber the user's
   * file (Greptile P1: "Profile ownership vanishes after reapply").
   */
  userOwned?: boolean;
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

  // Reconcile prior records absent from the incoming agent set BEFORE the
  // manifest is replaced: a removed agent's generated profile would otherwise
  // stay on disk yet vanish from the ownership manifest, so reset could never
  // remove it (or restore the user profile it displaced) — orphaned, active,
  // and untracked (Greptile P1: "reduced agent sets strand Codex profiles").
  // Cleanup deletes/restores ONLY when the profile is still the untouched
  // generated bytes; a user post-apply edit is preserved, never overwritten.
  const records: CodexAgentProfileRecord[] = [];
  for (const [fileName, priorRecord] of previousByFileName) {
    if (incomingFileNames.has(fileName)) continue;
    // A user-owned profile (edited after apply, or already marked user-owned)
    // is never orphan-cleaned. RETAIN its userOwned record in the new manifest
    // instead of dropping it: dropping would let a later re-add of this agent
    // see the preserved file as untracked pre-existing and regenerate over the
    // user's edit (Greptile P1: "Profile ownership vanishes after reapply" —
    // the record must survive omit→re-add and reduced-set reconcile).
    if (
      priorRecord.userOwned === true ||
      !(await isCodexProfileUnedited(agentsDir, priorRecord))
    ) {
      await retainUserOwnedProfile(records, agentsDir, fileName);
      continue;
    }
    const orphanedPath = join(agentsDir, fileName);
    if (priorRecord.priorContent === null) {
      await removePath(orphanedPath);
    } else {
      await writeTextFile(orphanedPath, priorRecord.priorContent);
    }
  }

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
    // Writer-guard: compare-before-write. Reapplying the SAME agent must
    // not clobber a user-edited profile. If a prior apply owned this file and
    // its live bytes no longer match the recorded fingerprint (or the profile
    // was already marked user-owned by an earlier edit), the user edited it
    // after apply — preserve their work, RELEASE harness ownership, and RETAIN
    // the record marked userOwned:true so a subsequent reapply recognizes it
    // and never reclaims/overwrites it (Greptile P1: "Profile ownership
    // vanishes after reapply"). We only write when the profile is untouched
    // (bytes match), was never owned, or is absent.
    const live = await readTextFileOrNull(profilePath);
    const wasUserOwned = priorRecord?.userOwned === true;
    // Preserve only a user-edited file that STILL EXISTS. A deleted file
    // (live === null) has nothing to preserve — regenerate the profile so the
    // selected agent is provisioned this apply (Greptile/CodeRabbit P1:
    // deleted user-owned profile must be regenerated, not left absent).
    // Any ABSENT profile with a prior ownership record is regenerated as
    // harness-created from scratch — whether it was user-owned or a legacy
    // fingerprint-less record. Its new record must carry priorContent:null so
    // reset/reconcile NEVER resurrect the stale bytes the user explicitly
    // deleted (Greptile P1: a legacy no-fingerprint record kept its old
    // snapshot on regeneration and reset then restored it).
    const regeneratingAbsentProfile =
      priorRecord !== undefined && live === null;
    const preserveUserEdit =
      live !== null &&
      (wasUserOwned ||
        (priorRecord !== undefined &&
          priorRecord.contentFingerprint !== undefined &&
          createContentHash(live) !== priorRecord.contentFingerprint) ||
        // Legacy record written before `contentFingerprint` existed carries no
        // fingerprint we can verify — treat its live bytes as a user edit we
        // must not clobber (over-preservation: never overwrite what we can't
        // prove we wrote / CodeRabbit Major 5124991541). Only a present file
        // is preserved; a deleted legacy file has nothing to protect and is
        // regenerated so the selected agent stays provisioned.
        (priorRecord !== undefined &&
          priorRecord.contentFingerprint === undefined));
    if (preserveUserEdit) {
      // Keep the user's bytes, never regenerate; retain the record as
      // user-owned so later applies preserve it too.
      records.push({
        fileName,
        priorContent: live,
        userOwned: true,
      });
      continue;
    }
    records.push({
      fileName,
      // A REGENERATED profile (its file was absent this apply — the user
      // deleted it, including a legacy fingerprint-less record) is now
      // harness-created: its priorContent must be null so reset/reconcile
      // never resurrect the stale bytes the user explicitly deleted (Greptile
      // P1: "Deleted legacy content resurfaces"). Otherwise keep the recorded
      // priorContent (the displaced user bytes a reset should restore) or
      // snapshot the current file.
      priorContent: regeneratingAbsentProfile
        ? null
        : priorRecord !== undefined
          ? priorRecord.priorContent
          : ((await readTextFileOrNull(profilePath)) ?? null),
      // Fingerprint the exact generated bytes so cleanup deletes/restores it
      // only when untouched; a user's post-apply edit changes the bytes.
      contentFingerprint: createContentHash(content),
    });
    await writeTextFile(profilePath, content);
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
  // Whole-file ownership is TRUE only when the file did NOT exist before this
  // apply, OR a prior apply created it AND the live bytes still match what the
  // harness originally wrote. If a harness-created marketplace was later
  // replaced/edited by the user (live bytes diverge from the prior recorded
  // fingerprint), RELINQUISH whole-file ownership (created:false) so reset
  // cannot whole-delete the user's replacement — provenance semantics, not
  // just byte-match (review: "marketplace reapply turns user content into
  // deletable state").
  const wasCreatedPreviously = priorOwnership?.created === true;
  const priorFingerprint =
    typeof priorOwnership?.fingerprint === "string"
      ? priorOwnership.fingerprint
      : null;
  const liveIsUnedited =
    existing !== null &&
    priorFingerprint !== null &&
    createContentHash(serializeMarketplaceFile(existing)) === priorFingerprint;
  const createdNow = existing === null;
  const ownsWholeFile = createdNow || (wasCreatedPreviously && liveIsUnedited);
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
 * `created` is the caller-computed whole-file ownership: true only when this
 * apply created it from scratch, or a prior apply created it AND the live
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
 * ownership vanishes after reapply"). If the user-owned file has since been
 * DELETED (live === null) there is nothing to preserve — drop the ghost.
 */
async function retainUserOwnedProfile(
  records: CodexAgentProfileRecord[],
  agentsDir: string,
  fileName: string,
): Promise<void> {
  const live = await readTextFileOrNull(join(agentsDir, fileName));
  if (live === null) return;
  records.push({ fileName, priorContent: live, userOwned: true });
}

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
    const profilePath = join(agentsDir, record.fileName);
    // A user-owned profile (edited after apply) is never removed/restored by
    // reset — the user's file is preserved as-is and the record carried over.
    if (record.userOwned === true) {
      await retainUserOwnedProfile(retained, agentsDir, record.fileName);
      continue;
    }
    // A user-edited profile (fingerprint mismatch, not yet flagged) is likewise
    // preserved and promoted to userOwned so future applies honor it.
    if (!(await isCodexProfileUnedited(agentsDir, record))) {
      await retainUserOwnedProfile(retained, agentsDir, record.fileName);
      continue;
    }
    if (record.priorContent === null) {
      // This apply created the profile (absent before apply) — remove it.
      await removePath(profilePath);
    } else {
      // A user-owned profile was displaced at apply — restore its original
      // content instead of deleting it.
      await writeTextFile(profilePath, record.priorContent);
    }
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
 * Returns whether an owned profile file still matches the generated bytes this
 * apply wrote. When the record carries a `contentFingerprint`, the current
 * file is compared against it; a mismatch means the user edited the profile
 * after apply, so cleanup must preserve it rather than delete/overwrite the
 * user's changes. Records WITHOUT a fingerprint (legacy manifests written
 * before this field existed) are treated as EDITED — preserved, never
 * deleted/restored by cleanup — because we cannot prove we own their bytes
 * ("never delete what we can't prove we own"; Gap 2 / CodeRabbit Major
 * 5124991541: a legacy manifest must not let cleanup delete a user's
 * post-apply edit).
 */
async function isCodexProfileUnedited(
  agentsDir: string,
  record: CodexAgentProfileRecord,
): Promise<boolean> {
  if (record.contentFingerprint === undefined) return false;
  const current = await readTextFileOrNull(join(agentsDir, record.fileName));
  return (
    current !== null && createContentHash(current) === record.contentFingerprint
  );
}

async function removeCodexMarketplaceEntry(filePath: string): Promise<void> {
  const ownershipManifestPath = join(
    dirname(filePath),
    CODEX_MARKETPLACE_OWNERSHIP_MANIFEST,
  );
  const ownership = await readJsonFileOrNull<{
    created?: unknown;
    fingerprint?: unknown;
  }>(ownershipManifestPath);
  const ownsWholeFile = ownership !== null && ownership.created === true;
  const recordedFingerprint =
    typeof ownership?.fingerprint === "string" ? ownership.fingerprint : null;
  // Always consume the ownership manifest — this apply is done with it.
  await removePath(ownershipManifestPath);

  const existingText = await readTextFileOrNull(filePath);
  if (existingText === null) return;
  // Delete the ENTIRE file ONLY when the ownership manifest proves this apply
  // created it AND the current bytes still match the exact content the harness
  // wrote. A user who replaces a harness-created marketplace with their own
  // file (even one shaped like `agent-harness-local`) changes the bytes, so
  // reset keeps it rather than deleting the user's replacement (Greptile P1 /
  // review). A managed file the user edited since apply is likewise preserved.
  if (
    ownsWholeFile &&
    recordedFingerprint !== null &&
    createContentHash(existingText) === recordedFingerprint
  ) {
    await removePath(filePath);
    return;
  }

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
