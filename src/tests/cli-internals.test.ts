/**
 * Unit tests for cli.ts internal functions (#418, #416–#420).
 *
 * Covers:
 * - mapBundleSubcommandForHelp: edge cases for bundle → mirror subcommand
 *   routing (#418)
 */

import assert from "node:assert/strict";
import test from "node:test";

import { cliInternals } from "../cli.js";

const { mapBundleSubcommandForHelp } = cliInternals;

// ---------------------------------------------------------------------------
// mapBundleSubcommandForHelp (#418) — unit tests
// ---------------------------------------------------------------------------

void test("mapBundleSubcommandForHelp: routes 'explain' to 'bundle-explain'", () => {
  const result = mapBundleSubcommandForHelp(["explain", "--help"]);
  assert.deepEqual(result, ["bundle-explain", "--help"]);
});

void test("mapBundleSubcommandForHelp: routes 'explain' without extra args", () => {
  const result = mapBundleSubcommandForHelp(["explain"]);
  assert.deepEqual(result, ["bundle-explain"]);
});

void test("mapBundleSubcommandForHelp: passes through non-explain subcommands unchanged", () => {
  const result = mapBundleSubcommandForHelp(["locks", "--help"]);
  assert.deepEqual(result, ["locks", "--help"]);
});

void test("mapBundleSubcommandForHelp: passes through unknown single arg", () => {
  const result = mapBundleSubcommandForHelp(["unknown-cmd"]);
  assert.deepEqual(result, ["unknown-cmd"]);
});

void test("mapBundleSubcommandForHelp: handles empty args array gracefully", () => {
  const result = mapBundleSubcommandForHelp([]);
  // When args[0] is undefined, it's not "explain", so returns unchanged
  assert.deepEqual(result, []);
});

void test("mapBundleSubcommandForHelp: preserves multiple trailing flags", () => {
  const result = mapBundleSubcommandForHelp([
    "explain",
    "--help",
    "--json",
    "--host",
    "vscode",
  ]);
  assert.deepEqual(result, [
    "bundle-explain",
    "--help",
    "--json",
    "--host",
    "vscode",
  ]);
});

void test("mapBundleSubcommandForHelp: case-sensitive — 'EXPLAIN' not matched", () => {
  const result = mapBundleSubcommandForHelp(["EXPLAIN", "--help"]);
  assert.deepEqual(result, ["EXPLAIN", "--help"]);
});

void test("mapBundleSubcommandForHelp: 'explain' at non-zero index not matched", () => {
  const result = mapBundleSubcommandForHelp(["--help", "explain"]);
  // Only checks args[0], so --help is not matched
  assert.deepEqual(result, ["--help", "explain"]);
});

void test("mapBundleSubcommandForHelp: single 'explain' element returns 'bundle-explain'", () => {
  const result = mapBundleSubcommandForHelp(["explain"]);
  assert.equal(result.length, 1);
  assert.equal(result[0], "bundle-explain");
});
