/**
 * Property-style regression for the single-process env-restore contract
 * (review gap: the env-restore fix needed a named regression test).
 *
 * The suite runs with `--test-isolation=none`, so any leaked environment
 * mutation travels into every later test and spawned child. The contract:
 * restoring a previously-unset variable DELETES it (never assigns the
 * literal string "undefined", which Node coerces env assignments to), and
 * restoring a previously-set variable restores its exact value.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { restoreEnvVar } from "./env-test-utils.js";

void test('restoreEnvVar property: never leaves the literal string "undefined"', () => {
  const names = [
    "AGENT_HARNESS_TEST_RESTORE_A",
    "AGENT_HARNESS_TEST_RESTORE_B",
    "AGENT_HARNESS_TEST_RESTORE_C",
  ];
  const previousValues = [undefined, "real-value", ""];

  for (const name of names) {
    for (const previous of previousValues) {
      // Exercise the full capture -> mutate -> restore cycle.
      process.env[name] = "mutated-by-test";
      restoreEnvVar(name, previous);

      if (previous === undefined) {
        assert.ok(
          !(name in process.env),
          `${name} must be deleted when it was previously unset`,
        );
      } else {
        assert.equal(
          process.env[name],
          previous,
          `${name} must return to its exact previous value`,
        );
      }
      // The literal string is the poisoning failure mode — a deleted key
      // reads back as real undefined, never as the coerced "undefined".
      assert.notEqual(
        process.env[name],
        "undefined",
        `${name} must never hold the literal string "undefined"`,
      );
      delete process.env[name];
    }
  }
});

void test("restoreEnvVar property: repetition preserves the invariant", () => {
  // Repeated save/restore cycles must not accumulate state (the leak class
  // that poisoned the suite came from a single restore of an unset var).
  const name = "AGENT_HARNESS_TEST_RESTORE_CYCLE";
  delete process.env[name];
  for (let cycle = 0; cycle < 5; cycle += 1) {
    const previous = process.env[name];
    process.env[name] = `cycle-${cycle}`;
    restoreEnvVar(name, previous);
    assert.ok(
      !(name in process.env),
      "previously-unset variable stays deleted across cycles",
    );
  }
});
