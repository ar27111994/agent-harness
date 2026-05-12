import assert from "node:assert/strict";
import test from "node:test";

import { getOptionValue, getOptionValues } from "../lib/cli-options.js";
import { getWireMode } from "../wire.js";

void test("CLI option parsing rejects missing values and flag tokens", () => {
  assert.equal(getOptionValue(["--host", "vscode"], "--host"), "vscode");
  assert.equal(getOptionValue([], "--host"), undefined);
  assert.throws(
    () => getOptionValue(["--host", "--apply"], "--host"),
    /Missing value for '--host'/u,
  );
  assert.throws(
    () => getOptionValue(["--host"], "--host"),
    /Missing value for '--host'/u,
  );
});

void test("wire mode parsing honors explicit apply and defaults to preview", () => {
  assert.equal(getWireMode([]), "preview");
  assert.equal(getWireMode(["--preview"]), "preview");
  assert.equal(getWireMode(["--apply"]), "apply");
  assert.equal(getWireMode(["--reset"]), "reset");
  assert.throws(
    () => getWireMode(["--apply", "--preview"]),
    /Conflicting wire mode flags/u,
  );
});

void test("repeatable CLI option parsing collects multi-intent values", () => {
  assert.deepEqual(
    getOptionValues(["--intent", "backend", "--intent", "docs"], "--intent"),
    ["backend", "docs"],
  );
  assert.deepEqual(getOptionValues([], "--intent"), []);
});

void test("repeatable CLI option parsing rejects valueless entries", () => {
  assert.deepEqual(
    getOptionValues(["--bundle", "one", "--bundle", "two"], "--bundle"),
    ["one", "two"],
  );
  assert.throws(
    () =>
      getOptionValues(["--bundle", "one", "--bundle", "--reset"], "--bundle"),
    /Missing value for '--bundle'/u,
  );
});
