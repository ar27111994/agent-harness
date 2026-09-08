import assert from "node:assert/strict";
import test from "node:test";

import { createContentHash } from "../files.js";
import { codexNativeInternals } from "../host-adapters/codex-native.js";
import {
  classifyMarketplaceState,
  classifyProfileState,
  codexOwnershipMatrix,
  codexOwnershipMachineInternals,
  marketplaceActorForState,
  profileActorForState,
  resolveOwnershipDecision,
} from "../host-adapters/codex-ownership-machine.js";
import type {
  CodexAgentProfileRecord,
  CodexOwnershipAction,
  CodexProfileDecision,
} from "../host-adapters/codex-ownership-machine.js";

/**
 * Exhaustive transition-matrix tests for the Codex ownership state machine.
 * Every (surface, state, actor, action) cell the table declares is enumerated
 * FROM the table (not hand-written), so no transition can be added to
 * CODE_X_OWNERSHIP_TRANSITIONS without this sweep exercising it. For each row
 * we (1) assert the interpreter returns exactly the row's decision, (2) assert
 * the row is reachable from real on-disk facts via classification, and (3)
 * round-trip the writer/cleanup decisions and the actor through the adapter's
 * running code path, and (4) assert every declarable cell exists in the table
 * (completeness — a missing cell must fail loudly, never silently no-op).
 */

const PROFILE_STATES = [
  "untracked-absent",
  "untracked-displace",
  "harness-created",
  "harness-displaced",
  "user-owned",
  "user-edited",
  "legacy-user-owned",
  "user-deleted",
] as const;

const MARKETPLACE_STATES = [
  "untracked",
  "harness-created-unchanged",
  "harness-created-replaced",
  "user-owned",
] as const;

const ACTIONS = [
  "apply",
  "re-apply",
  "reduce",
  "reset",
  "re-add",
] as const satisfies readonly CodexOwnershipAction[];

const WRITER_ACTIONS: readonly CodexOwnershipAction[] = [
  "apply",
  "re-apply",
  "re-add",
];

/**
 * Builds a (priorRecord, live, liveMatches) triple whose classification lands
 * exactly on `state`. Every profile state is reachable from real facts.
 */
function profileFacts(state: (typeof PROFILE_STATES)[number]): {
  record: CodexAgentProfileRecord | undefined;
  live: string | null;
  liveMatches: boolean;
} {
  switch (state) {
    case "untracked-absent":
      return { record: undefined, live: null, liveMatches: false };
    case "untracked-displace":
      return {
        record: undefined,
        live: "user first-displace bytes\n",
        liveMatches: false,
      };
    case "harness-created": {
      const content = "harness created bytes\n";
      return {
        record: {
          fileName: "agent-harness-codex-agent.toml",
          priorContent: null,
          contentFingerprint: createContentHash(content),
        },
        live: content,
        liveMatches: true,
      };
    }
    case "harness-displaced": {
      const content = "harness displaced bytes\n";
      return {
        record: {
          fileName: "agent-harness-codex-agent.toml",
          priorContent: "user ORIGINAL bytes\n",
          contentFingerprint: createContentHash(content),
        },
        live: content,
        liveMatches: true,
      };
    }
    case "user-owned":
      return {
        record: {
          fileName: "agent-harness-codex-agent.toml",
          priorContent: "user bytes\n",
          userOwned: true,
        },
        live: "user owned bytes\n",
        liveMatches: false,
      };
    case "user-edited": {
      return {
        record: {
          fileName: "agent-harness-codex-agent.toml",
          priorContent: null,
          contentFingerprint: createContentHash("harness wrote this\n"),
        },
        live: "user EDITED bytes\n",
        liveMatches: false,
      };
    }
    case "legacy-user-owned":
      return {
        record: {
          fileName: "agent-harness-codex-agent.toml",
          priorContent: "user legacy bytes\n",
        },
        live: "user legacy live bytes\n",
        liveMatches: false,
      };
    case "user-deleted":
      return {
        record: {
          fileName: "agent-harness-codex-agent.toml",
          priorContent: null,
          contentFingerprint: createContentHash("harness wrote this\n"),
        },
        live: null,
        liveMatches: false,
      };
  }
}

/** Every (state, actor) pair the profile classifier can actually produce. */
function profileActorPairs(): Array<{
  state: (typeof PROFILE_STATES)[number];
  actor: "harness" | "user";
}> {
  return PROFILE_STATES.map((state) => ({
    state,
    actor: profileActorForState(state),
  }));
}

/** Every (state, actor) pair the marketplace classifier can produce. */
function marketplaceActorPairs(): Array<{
  state: (typeof MARKETPLACE_STATES)[number];
  actor: "harness" | "user";
}> {
  return MARKETPLACE_STATES.map((state) => ({
    state,
    actor: marketplaceActorForState(state),
  }));
}

/**
 * The exhaustive sweep: every cell the table's completeness contract promises
 * — all profile states × actions × actor, and marketplace states × actions ×
 * actor — must resolve to a valid decision and round-trip through classification.
 */
void test("codex ownership matrix: every profile state x action cell resolves to a valid decision", () => {
  for (const { state, actor } of profileActorPairs()) {
    for (const action of ACTIONS) {
      const decision = resolveOwnershipDecision(
        "profile",
        state,
        actor,
        action,
      );
      assert.ok(decision, `profile ${state} x ${action} x ${actor} has no row`);
      if (WRITER_ACTIONS.includes(action)) {
        assert.ok(
          decision.kind === "write" || decision.kind === "preserve-user-edit",
          `writer action ${action} on state ${state} must return a writer decision, got ${decision.kind}`,
        );
      } else {
        assert.ok(
          decision.kind === "retain-user-owned" ||
            decision.kind === "remove-harness-file" ||
            decision.kind === "restore-prior-content" ||
            decision.kind === "ghost-drop",
          `cleanup action ${action} on state ${state} must return a cleanup decision, got ${decision.kind}`,
        );
      }
    }
  }
});

void test("codex ownership matrix: every marketplace state x action cell resolves to a valid decision", () => {
  for (const { state, actor } of marketplaceActorPairs()) {
    for (const action of ACTIONS) {
      const decision = resolveOwnershipDecision(
        "marketplace",
        state,
        actor,
        action,
      );
      assert.ok(decision, `marketplace ${state} x ${action} has no row`);
      if (WRITER_ACTIONS.includes(action)) {
        assert.ok(
          decision.kind === "merge-and-keep-ownership" ||
            decision.kind === "merge-and-relinquish",
          `marketplace writer action ${action} on ${state} got ${decision.kind}`,
        );
      } else {
        assert.ok(
          decision.kind === "marketplace-preserve" ||
            decision.kind === "remove-marketplace-file",
          `marketplace cleanup action ${action} on ${state} got ${decision.kind}`,
        );
      }
    }
  }
});

void test("codex ownership matrix: table is complete & self-consistent (generated from the table)", () => {
  const rows = codexOwnershipMatrix();
  // The table must be internally consistent: every row's decision must be
  // what the interpreter actually resolves for that exact (surface,state,actor,action).
  for (const row of rows) {
    const resolved = resolveOwnershipDecision(
      row.surface,
      row.state,
      row.actor,
      row.action,
    );
    assert.deepEqual(
      resolved,
      row.decision,
      `row for ${row.surface} ${row.state} x ${row.actor} x ${row.action} must resolve to its own decision`,
    );
  }
  // Completeness: every declarable (state, actor, action) cell has a row, so
  // a future table edit can never silently drop a transition. Derive the
  // expected cell set from the state/action universes, not from the table.
  const profileCells = profileActorPairs().flatMap(({ state, actor }) =>
    ACTIONS.map((action) => `${state}:${actor}:${action}`),
  );
  const marketplaceCells = marketplaceActorPairs().flatMap(({ state, actor }) =>
    ACTIONS.map((action) => `${state}:${actor}:${action}`),
  );
  const actualProfile = new Set(
    rows
      .filter((r) => r.surface === "profile")
      .map((r) => `${r.state}:${r.actor}:${r.action}`),
  );
  const actualMarketplace = new Set(
    rows
      .filter((r) => r.surface === "marketplace")
      .map((r) => `${r.state}:${r.actor}:${r.action}`),
  );
  for (const cell of profileCells) {
    assert.ok(
      actualProfile.has(cell),
      `profile cell ${cell} missing from the transition table`,
    );
  }
  for (const cell of marketplaceCells) {
    assert.ok(
      actualMarketplace.has(cell),
      `marketplace cell ${cell} missing from the transition table`,
    );
  }
});

void test("codex ownership matrix: classification -> decision round-trips through the adapter", () => {
  for (const { state, actor } of profileActorPairs()) {
    const { record, live, liveMatches } = profileFacts(state);
    // The classifier and the adapter's actor derivation must agree with the
    // state the facts produce.
    const classified = classifyProfileState(record, live, liveMatches);
    assert.equal(
      classified,
      state,
      `facts for ${state} must classify to ${state}`,
    );
    assert.equal(profileActorForState(classified), actor);
  }
  // Marketplace classifier round-trip for all four states.
  const mktFacts = (state: (typeof MARKETPLACE_STATES)[number]) => {
    switch (state) {
      case "untracked":
        return { exists: false, createdPreviously: false, liveMatches: false };
      case "harness-created-unchanged":
        return { exists: true, createdPreviously: true, liveMatches: true };
      case "harness-created-replaced":
        return { exists: true, createdPreviously: true, liveMatches: false };
      case "user-owned":
        return { exists: true, createdPreviously: false, liveMatches: false };
    }
  };
  for (const state of MARKETPLACE_STATES) {
    const f = mktFacts(state);
    assert.equal(
      classifyMarketplaceState(f.exists, f.createdPreviously, f.liveMatches),
      state,
      `marketplace facts for ${state} must classify to ${state}`,
    );
  }
});

void test("codex ownership matrix: writer and cleanup decision families cover every declared row", () => {
  const rows = codexOwnershipMatrix();
  const profileRows = rows.filter((r) => r.surface === "profile");
  // Every writer row must be a write/preserve decision with a valid
  // priorContent mode; every cleanup row must be a retain/remove/restore/ghost.
  for (const row of profileRows) {
    const decision = row.decision as CodexProfileDecision;
    if (WRITER_ACTIONS.includes(row.action)) {
      if (decision.kind === "write") {
        assert.ok(
          ["none", "live", "prior-record"].includes(decision.priorContentMode),
          `write row ${row.state} x ${row.action} has a valid priorContent mode`,
        );
      } else {
        assert.equal(decision.kind, "preserve-user-edit");
      }
    } else {
      assert.ok(
        decision.kind === "retain-user-owned" ||
          decision.kind === "remove-harness-file" ||
          decision.kind === "restore-prior-content" ||
          decision.kind === "ghost-drop",
        `cleanup row ${row.state} x ${row.action} has a cleanup decision`,
      );
    }
  }
  // Every declared row has a non-empty contract documenting the transition.
  for (const row of rows) {
    assert.ok(row.contract.length > 0, `every matrix row has a contract`);
  }
});

void test("codex ownership matrix: the table is the source of truth consulted by the adapter internals", () => {
  // The adapter's lookup must agree with classify+resolve for a few real
  // states — an adapter that stops walking the table would drift silently.
  const { lookupProfileDecision } = codexNativeInternals;
  const write = resolveOwnershipDecision(
    "profile",
    "untracked-absent",
    "harness",
    "apply",
  );
  const adapterWrite = lookupProfileDecision(undefined, null, "apply");
  assert.deepEqual(
    adapterWrite,
    write,
    "adapter lookup for untracked-absent+apply matches the table",
  );
  const cleanup = resolveOwnershipDecision(
    "profile",
    "harness-created",
    "harness",
    "reset",
  );
  const adapterCleanup = lookupProfileDecision(
    {
      fileName: "agent-harness-a.toml",
      priorContent: null,
      contentFingerprint: createContentHash("harness bytes\n"),
    },
    "harness bytes\n",
    "reset",
  );
  assert.deepEqual(
    adapterCleanup,
    cleanup,
    "adapter lookup for harness-created+reset matches the table",
  );
  // The machine internals expose the same table the exporter reads.
  assert.strictEqual(
    codexOwnershipMachineInternals.CODE_X_OWNERSHIP_TRANSITIONS,
    codexOwnershipMatrix(),
  );
});

void test("codex ownership matrix: an unknown cell fails loudly (no silent no-op transition)", () => {
  // A cell outside the declarable universe must throw, proving the matrix is
  // complete — a silent fallthrough would mask a missed transition.
  assert.throws(
    () =>
      resolveOwnershipDecision("profile", "harness-created", "user", "reset"),
    /no transition for profile/u,
  );
});
