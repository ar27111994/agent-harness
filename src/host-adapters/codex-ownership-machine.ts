/**
 * CODEX-OWNERSHIP-MACHINE
 *
 * The EXECUTABLE replacement for the hand-rolled `if/then` ownership arms in
 * `codex-native.ts`. Each Codex-owned artifact (a generated `agent-harness-*`
 * profile, or the repo marketplace) has an OWNERSHIP STATE. A LIFECYCLE ACTION
 * (apply / re-apply / reduce / reset / re-add) is driven by an ACTOR (harness
 * or user). The decision for every (surface, state, actor, action) cell is
 * declared here as DATA — the `CODE_X_OWNERSHIP_TRANSITIONS` table — not as
 * scattered branches, so no transition can be left unguarded or drift from the
 * documented contract. This module is the single interpreter: classification
 * turns observed on-disk facts into a state, and resolution looks the matching
 * row up in the table and returns the concrete decision the adapter executes
 * against the filesystem.
 *
 * This module mirrors `CODEX-OWNERSHIP-TABLE.md` (the human-readable spec); the
 * table here IS the executable form the adapter code reads. The full matrix is
 * enumerable via `codexOwnershipMatrix()` for exhaustive transition-matrix
 * tests generated FROM the table — no hand-written transition is left outside
 * the enumerable set the tests sweep.
 */

/**
 * A single Codex custom-agent profile file Agent Harness owns. The machine
 * defines the record shape (single source of truth); `codex-native.ts` reads
 * and writes it via the manifest.
 */
export interface CodexAgentProfileRecord {
  fileName: string;
  /** Original pre-apply content; null when the file did not exist before. */
  priorContent: string | null;
  /**
   * Content hash of the EXACT bytes this apply wrote for the profile. Reset /
   * reduced-agent reconcile removes (or restores the prior snapshot of) a
   * profile ONLY when the on-disk bytes still match this fingerprint; a user
   * who edited the generated `agent-harness-*.toml` after apply changes the
   * bytes, so the user's edits are preserved instead of deleted/overwritten.
   * Absent on legacy records written before the field existed.
   */
  contentFingerprint?: string;
  /**
   * True when this profile is user-owned: the user edited the generated file
   * after apply, so Agent Harness relinquished ownership. The record is
   * RETAINED (not dropped) so a subsequent apply recognizes the profile as
   * user-owned and never regenerates/overwrites it.
   */
  userOwned?: boolean;
}

/** The owned Codex surfaces the machine governs. */
export type CodexOwnershipSurface = "profile" | "marketplace";

/**
 * The lifecycle operation being performed on the surface.
 *
 * apply / re-apply / re-add all funnel an IN-COMING profile through the writer;
 * reduce / reset funnel DROPPED, absent, or reset profiles through cleanup. The
 * two groups resolve identically for a given state, but each action is
 * enumerated as a distinct row so the matrix is exhaustive and an action can
 * never silently go unexpressed by the table.
 */
export type CodexOwnershipAction =
  "apply" | "re-apply" | "reduce" | "reset" | "re-add";

/**
 * The principal whose ownership right a transition honors: `harness` owns the
 * artifact (created/wrote it, untouched), `user` owns it (edited it, deleted
 * it, replaced a harness file, or a legacy record we cannot prove we wrote).
 */
export type CodexOwnershipActor = "harness" | "user";

/**
 * Classification of a single Codex agent profile's ownership, derived from the
 * prior manifest record (or none) and the live on-disk bytes.
 */
export type CodexProfileState =
  /** No record and no live file: a fresh profile this apply may create. */
  | "untracked-absent"
  /**
   * No record but a live file: a pre-existing user file whose deterministic
   * name collides with the profile. The first apply DISPLACES it (records the
   * user's bytes as priorContent so reset restores them).
   */
  | "untracked-displace"
  /**
   * Record says harness wrote it (fingerprint present, live bytes match) and
   * priorContent was null: harness created it from nothing.
   */
  | "harness-created"
  /**
   * Record says harness wrote it (fingerprint matches) and priorContent was
   * non-null: harness displaced a pre-existing user file to write this.
   */
  | "harness-displaced"
  /** Record is userOwned:true and the file is present. */
  | "user-owned"
  /** Record has a fingerprint but the live bytes differ: user edited it. */
  | "user-edited"
  /** Legacy no-fingerprint record: cannot prove we wrote those bytes. */
  | "legacy-user-owned"
  /** Record exists but the live file is absent: the user deleted it. */
  | "user-deleted";

/** Classification of the repo marketplace's whole-file ownership. */
export type CodexMarketplaceState =
  /** No marketplace file: this apply would create it from nothing. */
  | "untracked"
  /** Ownership says harness created it and the live bytes still match. */
  | "harness-created-unchanged"
  /** Ownership says harness created it but the live bytes differ (user replaced it). */
  | "harness-created-replaced"
  /** No harness provenance (pre-existing user or team marketplace). */
  | "user-owned";

/**
 * The source of the `priorContent` a WRITE decision must record.
 *
 * - "none": record priorContent null (harness created it from nothing, or is
 *   regenerating a deleted profile so reset must never resurrect stale bytes).
 * - "live": record the current on-disk bytes as prior (first apply displacing a
 *   colliding user file — reset must restore them).
 * - "prior-record": carry the prior record's original priorContent forward
 *   (a re-write of an already-owned profile must NOT re-snapshot harness bytes
 *   as the user's "prior" — the re-apply-poisoning guard).
 */
export type CodexPriorContentMode = "none" | "live" | "prior-record";

/** The decision the machine returns for a profile cell; the adapter executes it. */
export type CodexProfileDecision =
  /** Create/regenerate the profile: write bytes, record the priorContent by mode. */
  | { kind: "write"; priorContentMode: CodexPriorContentMode }
  /** Keep the user's live bytes, do not write; record the profile as user-owned. */
  | { kind: "preserve-user-edit" }
  /** Keep the user-owned profile and RETAIN its record across cleanup. */
  | { kind: "retain-user-owned" }
  /** Remove the harness-created file (priorContent was null). */
  | { kind: "remove-harness-file" }
  /** Restore the displaced user bytes (priorContent was non-null). */
  | { kind: "restore-prior-content" }
  /** The user-deleted file is already gone; drop its record without touching disk. */
  | { kind: "ghost-drop" };

/** Writer-side profile decisions (apply / re-apply / re-add rows). */
export type CodexWriteProfileDecision = Extract<
  CodexProfileDecision,
  { kind: "write" } | { kind: "preserve-user-edit" }
>;

/** Cleanup-side profile decisions (reduce / reset rows). */
export type CodexCleanupProfileDecision = Extract<
  CodexProfileDecision,
  | { kind: "retain-user-owned" }
  | { kind: "remove-harness-file" }
  | { kind: "restore-prior-content" }
  | { kind: "ghost-drop" }
>;

/** The decision the machine returns for a marketplace cell. */
export type CodexMarketplaceDecision =
  /** Merge the managed entry and keep whole-file ownership (created:true). */
  | { kind: "merge-and-keep-ownership" }
  /** Merge but relinquish whole-file ownership (created:false). */
  | { kind: "merge-and-relinquish" }
  /** Reset: no whole-file delete (preserve / strip-managed-entry only). */
  | { kind: "marketplace-preserve" }
  /** Reset: whole-delete the provably harness-created, byte-unchanged file. */
  | { kind: "remove-marketplace-file" };

/** A single transition row in the ownership table. */
export interface CodexOwnershipTransition {
  surface: CodexOwnershipSurface;
  state: CodexProfileState | CodexMarketplaceState;
  actor: CodexOwnershipActor;
  action: CodexOwnershipAction;
  /** The decision the interpreter returns when this cell is hit. */
  decision: CodexProfileDecision | CodexMarketplaceDecision;
  /**
   * Human-readable contract line for the row, mirroring CODEX-OWNERSHIP-TABLE.md.
   * Names the Greptile/CodeRabbit finding or ownership doctrine this cell seals.
   */
  contract: string;
}

/** A typed row constructor; keeps the table type-safe and the literals consistent. */
function row(transition: CodexOwnershipTransition): CodexOwnershipTransition {
  return transition;
}

/**
 * Writer-side profile rows. apply / re-apply / re-add resolve identically: the
 * OWNERSHIP STATE already captures whether this is a first write, a re-write,
 * or a re-add, so the writer makes the same decision per state for any of the
 * three in-coming actions.
 */
function profileWriteRows(action: "apply" | "re-apply" | "re-add") {
  return [
    row({
      surface: "profile",
      state: "untracked-absent",
      actor: "harness",
      action,
      decision: { kind: "write", priorContentMode: "none" },
      contract:
        "Fresh profile this apply creates from nothing; priorContent null means reset must remove it, never resurrect.",
    }),
    row({
      surface: "profile",
      state: "untracked-displace",
      actor: "user",
      action,
      decision: { kind: "write", priorContentMode: "live" },
      contract:
        "Deterministic-name collision: first apply displaces the user file, recording its bytes so reset restores them (Greptile P1).",
    }),
    row({
      surface: "profile",
      state: "harness-created",
      actor: "harness",
      action,
      decision: { kind: "write", priorContentMode: "prior-record" },
      contract:
        "Untouched harness-generated profile re-written; carry the ORIGINAL priorContent so a re-apply cannot re-snapshot harness bytes as the user's prior.",
    }),
    row({
      surface: "profile",
      state: "harness-displaced",
      actor: "harness",
      action,
      decision: { kind: "write", priorContentMode: "prior-record" },
      contract:
        "Untouched harness-generated profile over a displaced user file re-written; original user bytes carried forward for reset restore.",
    }),
    row({
      surface: "profile",
      state: "user-owned",
      actor: "user",
      action,
      decision: { kind: "preserve-user-edit" },
      contract:
        "User-owned profile (edited or marked): never regenerate/overwrite; RETAIN the record as userOwned (ownership vanishes after reapply).",
    }),
    row({
      surface: "profile",
      state: "user-edited",
      actor: "user",
      action,
      decision: { kind: "preserve-user-edit" },
      contract:
        "Live bytes differ from the recorded fingerprint: preserve the user's edit, release harness ownership, mark userOwned (compare-before-write).",
    }),
    row({
      surface: "profile",
      state: "legacy-user-owned",
      actor: "user",
      action,
      decision: { kind: "preserve-user-edit" },
      contract:
        "Legacy no-fingerprint record: cannot prove we wrote those bytes, preserve and promote to userOwned (over-preservation, CodeRabbit 5124991541).",
    }),
    row({
      surface: "profile",
      state: "user-deleted",
      actor: "user",
      action,
      decision: { kind: "write", priorContentMode: "none" },
      contract:
        "User deleted a recorded profile (incl. legacy): REGENERATE so the selected agent stays provisioned, priorContent null so reset never resurrects the deleted bytes.",
    }),
  ] satisfies readonly CodexOwnershipTransition[];
}

/** Cleanup/reconcile-side profile rows (decision identical for reduce/reset). */
function profileCleanupRows(action: "reduce" | "reset") {
  return [
    row({
      surface: "profile",
      state: "untracked-absent",
      actor: "harness",
      action,
      decision: { kind: "ghost-drop" },
      contract:
        "No record, nothing on disk: nothing to clean, and never invent ownership where we have none.",
    }),
    row({
      surface: "profile",
      state: "untracked-displace",
      actor: "user",
      action,
      decision: { kind: "ghost-drop" },
      contract:
        "No ownership record: never prefix-delete a user's colliding profile (over-preservation).",
    }),
    row({
      surface: "profile",
      state: "harness-created",
      actor: "harness",
      action,
      decision: { kind: "remove-harness-file" },
      contract:
        "Untouched harness-created profile (priorContent null): remove it, it has no user content to restore.",
    }),
    row({
      surface: "profile",
      state: "harness-displaced",
      actor: "harness",
      action,
      decision: { kind: "restore-prior-content" },
      contract:
        "Untouched harness-written profile over a displaced user file: restore the user's original bytes, do not delete.",
    }),
    row({
      surface: "profile",
      state: "user-owned",
      actor: "user",
      action,
      decision: { kind: "retain-user-owned" },
      contract:
        "User-owned profile survives cleanup; RETAIN its record so a later re-add never regenerates over the user's edit.",
    }),
    row({
      surface: "profile",
      state: "user-edited",
      actor: "user",
      action,
      decision: { kind: "retain-user-owned" },
      contract:
        "User-edited orphaned profile preserved + promoted to userOwned during reconcile (fingerprint differs -> preserve arm).",
    }),
    row({
      surface: "profile",
      state: "legacy-user-owned",
      actor: "user",
      action,
      decision: { kind: "retain-user-owned" },
      contract:
        "Legacy no-fingerprint record preserved + promoted to userOwned on cleanup (isCodexProfileUnedited false).",
    }),
    row({
      surface: "profile",
      state: "user-deleted",
      actor: "user",
      action,
      decision: { kind: "ghost-drop" },
      contract:
        "User deleted the file; nothing to preserve, DROP the ghost record so no stale ownership dangles.",
    }),
  ] satisfies readonly CodexOwnershipTransition[];
}

/** Marketplace merge-side rows. */
function marketplaceMergeRows(action: "apply" | "re-apply" | "re-add") {
  return [
    row({
      surface: "marketplace",
      state: "untracked",
      actor: "harness",
      action,
      decision: { kind: "merge-and-keep-ownership" },
      contract:
        "No marketplace existed: harness creates it and owns the whole file (createdNow).",
    }),
    row({
      surface: "marketplace",
      state: "harness-created-unchanged",
      actor: "harness",
      action,
      decision: { kind: "merge-and-keep-ownership" },
      contract:
        "Prior apply created it and the live bytes match the recorded fingerprint: unchanged reapply keeps created:true.",
    }),
    row({
      surface: "marketplace",
      state: "harness-created-replaced",
      actor: "user",
      action,
      decision: { kind: "merge-and-relinquish" },
      contract:
        "Live bytes diverge from the recorded fingerprint: user replaced/edited it, RELINQUISH whole-file ownership (created:false) so reset preserves it.",
    }),
    row({
      surface: "marketplace",
      state: "user-owned",
      actor: "user",
      action,
      decision: { kind: "merge-and-relinquish" },
      contract:
        "Pre-existing user/team marketplace: merge the managed entry in without claiming whole-file ownership.",
    }),
  ] satisfies readonly CodexOwnershipTransition[];
}

/** Marketplace cleanup/reset-side rows. */
function marketplaceResetRows(action: "reduce" | "reset") {
  return [
    row({
      surface: "marketplace",
      state: "untracked",
      actor: "harness",
      action,
      decision: { kind: "marketplace-preserve" },
      contract:
        "No marketplace file to touch (createdNow is only relevant at merge time).",
    }),
    row({
      surface: "marketplace",
      state: "harness-created-unchanged",
      actor: "harness",
      action,
      decision: { kind: "remove-marketplace-file" },
      contract:
        "Harness provably created it and bytes are unchanged: reset whole-deletes the harness-created file.",
    }),
    row({
      surface: "marketplace",
      state: "harness-created-replaced",
      actor: "user",
      action,
      decision: { kind: "marketplace-preserve" },
      contract:
        "User replaced a harness-created file: reset preserves it (strip the managed entry only).",
    }),
    row({
      surface: "marketplace",
      state: "user-owned",
      actor: "user",
      action,
      decision: { kind: "marketplace-preserve" },
      contract:
        "Pre-existing user/team marketplace: reset strips the managed entry, never whole-deletes the user file.",
    }),
  ] satisfies readonly CodexOwnershipTransition[];
}

/**
 * The ownership transition table — the single source of truth. Every
 * (surface, state, actor, action) cell the adapter can reach has exactly one
 * row; `resolveOwnershipDecision` throws if a cell is missing, so an
 * unguarded/un-tested transition fails loudly instead of silently degrading.
 */
export const CODE_X_OWNERSHIP_TRANSITIONS: readonly CodexOwnershipTransition[] =
  [
    // ── PROFILE writer (apply / re-apply / re-add: agent IS in the incoming set) ──
    ...profileWriteRows("apply"),
    ...profileWriteRows("re-apply"),
    ...profileWriteRows("re-add"),
    // ── PROFILE cleanup (reduce / reset: agent dropped or full reset) ──
    ...profileCleanupRows("reduce"),
    ...profileCleanupRows("reset"),
    // ── MARKETPLACE merge (apply / re-apply / re-add) ──
    ...marketplaceMergeRows("apply"),
    ...marketplaceMergeRows("re-apply"),
    ...marketplaceMergeRows("re-add"),
    // ── MARKETPLACE reset ──
    ...marketplaceResetRows("reduce"),
    ...marketplaceResetRows("reset"),
  ];

/** Returns every (surface, state, actor, action) row in the transition table. */
export function codexOwnershipMatrix(): readonly CodexOwnershipTransition[] {
  return CODE_X_OWNERSHIP_TRANSITIONS;
}

/**
 * The actor (owner principal) implied by a classified profile state. States
 * that are harness-owned (untracked-absent, and untouched harness-created /
 * harness-displaced) belong to harness; every user-owned / user-edited /
 * legacy / displaced-user / deleted cell belongs to the user. Deriving the
 * actor from the STATE (not from raw record fields) keeps the transition table
 * unambiguous for untracked cells where optional-chaining would mislabel them.
 */
export function profileActorForState(
  state: CodexProfileState,
): CodexOwnershipActor {
  switch (state) {
    case "untracked-absent":
    case "harness-created":
    case "harness-displaced":
      return "harness";
    case "untracked-displace":
    case "user-owned":
    case "user-edited":
    case "legacy-user-owned":
    case "user-deleted":
      return "user";
  }
}

/**
 * The actor (owner principal) implied by a classified marketplace state.
 * `untracked` (harness would create it) and `harness-created-unchanged`
 * (harness owns it, untouched) belong to harness; a replaced or pre-existing
 * user marketplace belongs to the user.
 */
export function marketplaceActorForState(
  state: CodexMarketplaceState,
): CodexOwnershipActor {
  switch (state) {
    case "untracked":
    case "harness-created-unchanged":
      return "harness";
    case "harness-created-replaced":
    case "user-owned":
      return "user";
  }
}

/**
 * Fit the observed facts for a profile into one of the ownership states.
 *
 * `priorRecord` is the manifest record from the last apply (or undefined for a
 * never-owned file); `live` is the current on-disk bytes (null when absent);
 * `liveMatchesFingerprint` is whether `createContentHash(live)` equals the
 * record's recorded fingerprint (the adapter computes the hash once).
 */
export function classifyProfileState(
  priorRecord: CodexAgentProfileRecord | undefined,
  live: string | null,
  liveMatchesFingerprint: boolean,
): CodexProfileState {
  if (priorRecord === undefined) {
    return live === null ? "untracked-absent" : "untracked-displace";
  }
  if (priorRecord.userOwned === true) {
    return live === null ? "user-deleted" : "user-owned";
  }
  if (priorRecord.contentFingerprint === undefined) {
    // Legacy record: we cannot prove we wrote these bytes.
    return live === null ? "user-deleted" : "legacy-user-owned";
  }
  if (live === null) {
    return "user-deleted";
  }
  return liveMatchesFingerprint
    ? priorRecord.priorContent === null
      ? "harness-created"
      : "harness-displaced"
    : "user-edited";
}

/**
 * Fit the observed marketplace facts into one of the four ownership states.
 * `createdPreviously` is the recorded `created` flag; `liveMatchesFingerprint`
 * is whether the current bytes match the recorded fingerprint.
 */
export function classifyMarketplaceState(
  exists: boolean,
  createdPreviously: boolean,
  liveMatchesFingerprint: boolean,
): CodexMarketplaceState {
  if (!exists) return "untracked";
  if (createdPreviously) {
    return liveMatchesFingerprint
      ? "harness-created-unchanged"
      : "harness-created-replaced";
  }
  return "user-owned";
}

/**
 * The interpreter: looks the (surface, state, actor, action) cell up in the
 * transition table and returns the concrete decision for the adapter to run.
 * A cell with no row throws — the matrix must be complete or a transition
 * cannot be silently left undefined (the terminating-refactor requirement).
 */
export function resolveOwnershipDecision(
  surface: CodexOwnershipSurface,
  state: CodexProfileState | CodexMarketplaceState,
  actor: CodexOwnershipActor,
  action: CodexOwnershipAction,
): CodexProfileDecision | CodexMarketplaceDecision {
  const match = CODE_X_OWNERSHIP_TRANSITIONS.find(
    (transition) =>
      transition.surface === surface &&
      transition.state === state &&
      transition.actor === actor &&
      transition.action === action,
  );
  if (match === undefined) {
    throw new Error(
      `codex-ownership-machine: no transition for ${surface} state="${state}" actor="${actor}" action="${action}"`,
    );
  }
  return match.decision;
}

/** Test-only surface for the machine: types, classification, resolution, table. */
export const codexOwnershipMachineInternals = {
  CODE_X_OWNERSHIP_TRANSITIONS,
  classifyProfileState,
  classifyMarketplaceState,
  resolveOwnershipDecision,
  codexOwnershipMatrix,
  profileActorForState,
  marketplaceActorForState,
  profileWriteRows,
  profileCleanupRows,
  marketplaceMergeRows,
  marketplaceResetRows,
};
