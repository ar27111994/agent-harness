import assert from "node:assert/strict";
import test from "node:test";

import { getOptionValue, getOptionValues } from "../lib/cli-options.js";

test("CLI option parsing rejects missing values and flag tokens", () => {
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

test("repeatable CLI option parsing rejects valueless entries", () => {
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
