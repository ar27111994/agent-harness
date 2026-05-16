import assert from "node:assert/strict";
import test from "node:test";

import {
  assertArray,
  assertBoolean,
  assertHostTarget,
  assertHostTargetArray,
  assertLiteral,
  assertMaybeArray,
  assertMaybeNumber,
  assertMaybeRecord,
  assertMaybeString,
  assertMaybeStringArray,
  assertNumber,
  assertRecord,
  assertString,
  assertStringArray,
  assertStringArrayRecord,
  fail,
} from "../manifest-validation/primitives.js";

void test("manifest validation primitives accept valid values and return them when appropriate", () => {
  assert.equal(assertHostTarget("copilot-vscode", "host"), "copilot-vscode");
  assert.deepEqual(assertArray([1, 2], "array"), [1, 2]);
  assert.deepEqual(assertRecord({ ok: true }, "record"), { ok: true });
  assert.equal(assertString("value", "string"), "value");
  assert.equal(assertNumber(3, "number"), 3);
  assert.equal(assertMaybeString(undefined, "maybeString", false), undefined);
  assert.equal(assertMaybeNumber(undefined, "maybeNumber", false), undefined);
  assert.equal(assertMaybeArray(undefined, "maybeArray", false), undefined);
  assert.equal(assertMaybeRecord(undefined, "maybeRecord", false), undefined);
  assert.equal(
    assertMaybeStringArray(undefined, "maybeStringArray", false),
    undefined,
  );
  assert.equal(assertBoolean(true, "boolean"), true);
  assert.equal(assertLiteral("alpha", ["alpha", "beta"], "literal"), "alpha");

  assert.doesNotThrow(() =>
    assertHostTargetArray(["shared", "cursor"], "hosts"),
  );
  assert.doesNotThrow(() => assertStringArray(["a", "b"], "strings"));
  assert.doesNotThrow(() =>
    assertStringArrayRecord({ a: ["x"], b: [] }, "record"),
  );
});

void test("manifest validation primitives reject invalid values with clear contexts", () => {
  const cases = [
    {
      fn: () => assertHostTarget("Bad Host", "host"),
      pattern: /host.*lowercase host identifier/u,
    },
    {
      fn: () => assertHostTargetArray(["shared", "Bad Host"], "hosts"),
      pattern: /hosts\[1\].*lowercase host identifier/u,
    },
    {
      fn: () => assertStringArray(["ok", 1], "strings"),
      pattern: /strings\[1\].*expected a string/u,
    },
    {
      fn: () => assertStringArrayRecord({ ok: ["x"], nope: [1] }, "record"),
      pattern: /record.nope\[0\].*expected a string/u,
    },
    {
      fn: () => assertArray("nope", "array"),
      pattern: /array.*expected an array/u,
    },
    {
      fn: () => assertRecord(null, "record"),
      pattern: /record.*expected an object/u,
    },
    {
      fn: () => assertString(1, "string"),
      pattern: /string.*expected a string/u,
    },
    {
      fn: () => assertNumber("1", "number"),
      pattern: /number.*expected a number/u,
    },
    {
      fn: () => assertMaybeString(undefined, "maybeString", true),
      pattern: /maybeString.*expected a string/u,
    },
    {
      fn: () => assertMaybeString(1, "maybeString", false),
      pattern: /maybeString.*expected a string/u,
    },
    {
      fn: () => assertMaybeNumber(undefined, "maybeNumber", true),
      pattern: /maybeNumber.*expected a number/u,
    },
    {
      fn: () => assertMaybeNumber("1", "maybeNumber", false),
      pattern: /maybeNumber.*expected a number/u,
    },
    {
      fn: () => assertMaybeArray(undefined, "maybeArray", true),
      pattern: /maybeArray.*expected an array/u,
    },
    {
      fn: () => assertMaybeArray("nope", "maybeArray", false),
      pattern: /maybeArray.*expected an array/u,
    },
    {
      fn: () => assertMaybeRecord(undefined, "maybeRecord", true),
      pattern: /maybeRecord.*expected an object/u,
    },
    {
      fn: () => assertMaybeRecord([], "maybeRecord", false),
      pattern: /maybeRecord.*expected an object/u,
    },
    {
      fn: () => assertMaybeStringArray(undefined, "maybeStringArray", true),
      pattern: /maybeStringArray.*expected an array/u,
    },
    {
      fn: () => assertMaybeStringArray(["ok", 1], "maybeStringArray", false),
      pattern: /maybeStringArray\[1\].*expected a string/u,
    },
    {
      fn: () => assertBoolean("true", "boolean"),
      pattern: /boolean.*expected a boolean/u,
    },
    {
      fn: () => assertLiteral("gamma", ["alpha", "beta"], "literal"),
      pattern: /literal.*expected one of alpha, beta/u,
    },
    { fn: () => fail("context", "broken"), pattern: /context: broken/u },
  ] as const;

  for (const { fn, pattern } of cases) {
    assert.throws(fn, pattern);
  }
});
