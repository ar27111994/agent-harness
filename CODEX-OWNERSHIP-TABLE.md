# CODEX-OWNERSHIP-TABLE

The definitive ownership/transition contract for the Codex host adapter
(`src/host-adapters/codex-native.ts`), and the **executable source of truth**:
the same table is encoded as data in `src/host-adapters/codex-ownership-machine.ts`
(`CODE_X_OWNERSHIP_TRANSITIONS`), read and interpreted by that module's
`resolveOwnershipDecision`. `codex-native.ts` never hard-codes these
transitions as `if/then` arms — it classifies the live on-disk state and asks
the machine for the decision. This ended the media-probe loop of "one fix
birthing the next": every transition cell is enumerated here, so it is either
explicitly governed or loudly un-reachable (a missing cell throws, never
silently no-ops).

## Why this table exists

The old adapter hand-rolled an ownership state machine as scattered branches.
Each reviewer-found data-loss fix added another arm, and the fix for one defect
frequently opened the cell its successor attacked:

- a displaced user profile was **restored** on reset (not deleted);
- a harness-created profile was **removed** on reset (not resurrected);
- a user-edited profile was **preserved** and ownership **relinquished**;
- a legacy no-fingerprint profile was **never** deleted (can't prove we wrote it);
- a deleted profile was **regenerated** on apply with `priorContent:null` so
  reset never resurrects the user-deleted bytes;
- the pre-apply snapshot carried the ORIGINAL user content forward across
  re-applies (never re-snapshot harness bytes as the user's "prior");
- marketplace whole-file ownership was **relinquished** (not laundered) when the
  user replaced a harness-created marketplace.

Table-driven interpretation makes those cells **data**, not code, so the review
bots cannot re-find them one round at a time.

## Vocabulary

- **surface** — the owned artifact the row governs: `profile` (a generated
  `agent-harness-*.toml` + its manifest record) or `marketplace` (the repo
  `.agents/plugins/marketplace.json` + its ownership manifest).
- **state** — the ownership classification of the surface, derived from the
  prior manifest record and the live on-disk bytes:
  - _profile_: `untracked-absent`, `untracked-displace` (no record; a
    pre-existing colliding user file), `harness-created` (untouched, priorContent
    null), `harness-displaced` (untouched, priorContent = displaced user bytes),
    `user-owned`, `user-edited`, `legacy-user-owned` (no fingerprint), `user-deleted`.
  - _marketplace_: `untracked` (file absent), `harness-created-unchanged`,
    `harness-created-replaced` (user replaced/edited it), `user-owned`.
- **actor** — the principal whose ownership right the transition honors:
  `harness` (owns the artifact, untouched) or `user` (edited / deleted /
  replaced it / legacy unprovable).
- **action** — the lifecycle operation: `apply`, `re-apply`, `reduce` (agent
  dropped from the set), `reset`, `re-add`. Writer actions funnel in-coming
  profiles through the writer rows; cleanup actions funnel dropped / reset
  profiles through the cleanup rows.

## Profile transition matrix

Rows are `state → decision`, one per `(state, actor, action)`.

### Writer (apply / re-apply / re-add — agent IS in the incoming set)

| state              | actor   | decision                                  | effect                                                                                                              |
| ------------------ | ------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| untracked-absent   | harness | **write** `priorContentMode:none`         | create the profile; record `priorContent:null` so reset removes it (harness-created)                                |
| untracked-displace | user    | **write** `priorContentMode:live`         | displace the colliding user file; record its bytes so reset restores them                                           |
| harness-created    | harness | **write** `priorContentMode:prior-record` | re-write untouched generated profile; carry ORIGINAL prior content forward                                          |
| harness-displaced  | harness | **write** `priorContentMode:prior-record` | re-write untouched profile over a displaced user file; carry original user bytes                                    |
| user-owned         | user    | **preserve-user-edit**                    | keep the user's bytes; never regenerate; RETAIN the `userOwned` record                                              |
| user-edited        | user    | **preserve-user-edit**                    | live bytes ≠ fingerprint; preserve edit, release ownership, mark `userOwned` (compare-before-write)                 |
| legacy-user-owned  | user    | **preserve-user-edit**                    | no fingerprint — can't prove we wrote it; preserve + promote to `userOwned` (over-preservation)                     |
| user-deleted       | user    | **write** `priorContentMode:none`         | regenerate so the selected agent stays provisioned; `priorContent:null` so reset never resurrects the deleted bytes |

### Cleanup (reduce / reset — agent dropped or full reset)

| state              | actor   | decision                  | effect                                                                          |
| ------------------ | ------- | ------------------------- | ------------------------------------------------------------------------------- |
| untracked-absent   | harness | **ghost-drop**            | nothing to clean; never invent ownership where we have none                     |
| untracked-displace | user    | **ghost-drop**            | no ownership record — never prefix-delete a user's colliding profile            |
| harness-created    | harness | **remove-harness-file**   | untouched profile this apply created: remove it (nothing to restore)            |
| harness-displaced  | harness | **restore-prior-content** | untouched profile over a displaced user file: restore the user's original bytes |
| user-owned         | user    | **retain-user-owned**     | preserved; RETAIN the record so a later re-add never regenerates over the edit  |
| user-edited        | user    | **retain-user-owned**     | orphan-edited profile preserved + promoted to `userOwned`                       |
| legacy-user-owned  | user    | **retain-user-owned**     | legacy no-fingerprint profile preserved + promoted to `userOwned`               |
| user-deleted       | user    | **ghost-drop**            | file gone; drop the stale record (no ghost dangles)                             |

## Marketplace transition matrix

### Merge (apply / re-apply / re-add)

| state                     | actor   | decision                     | effect                                                                                           |
| ------------------------- | ------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| untracked                 | harness | **merge-and-keep-ownership** | create the file; own the whole file (`created:true`)                                             |
| harness-created-unchanged | harness | **merge-and-keep-ownership** | prior apply created it + live bytes match; unchanged reapply keeps `created:true`                |
| harness-created-replaced  | user    | **merge-and-relinquish**     | user replaced/edited it; relinquish whole-file ownership (`created:false`) so reset preserves it |
| user-owned                | user    | **merge-and-relinquish**     | pre-existing user/team file; merge the managed entry in but never claim whole-file ownership     |

### Cleanup (reduce / reset)

| state                     | actor   | decision                    | effect                                                                      |
| ------------------------- | ------- | --------------------------- | --------------------------------------------------------------------------- |
| untracked                 | harness | **marketplace-preserve**    | no file to touch                                                            |
| harness-created-unchanged | harness | **remove-marketplace-file** | harness provably created it + bytes unchanged: reset whole-deletes it       |
| harness-created-replaced  | user    | **marketplace-preserve**    | user replaced a harness-created file: preserve it (strip the managed entry) |
| user-owned                | user    | **marketplace-preserve**    | pre-existing user/team file: strip the managed entry, never whole-delete    |

## Invariants this table guarantees

1. **Completeness** — every `(surface, state, actor, action)` cell above has a
   row; `resolveOwnershipDecision` throws if one is missing, so a missed
   transition fails loudly instead of silently choosing the wrong effect. The
   exhaustive matrix test regenerates the cell set from these universes and
   asserts every cell is present.
2. **Atomicity** — the pre-apply snapshot-restore (full-surface restore +
   prior-root byte-restore for `52eeb30` semantics) is orthogonal to ownership
   and lives in `writeCodexNativeFiles`; the table governs _which_ cell is hit,
   the apply wrapper governs _what gets rolled back_ on a late failure.
3. **No untested transition** — the matrix test
   (`src/tests/codex-ownership-machine.test.ts`) enumerates every row from the
   table and asserts classification → decision round-trips and that writer vs
   cleanup action groups return the correct decision family.
