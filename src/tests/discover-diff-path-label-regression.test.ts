import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSerializedPathLabel } from "../domains/discovery/diff.js";

void test("discover diff normalizes Windows path separators for JSON labels", () => {
  const cliBaseline = "C:/Projects/agent-harness-qa/v2-final/ws3";
  const resolvedCurrent = "C:\\Projects\\agent-harness-qa\\v2-final\\ws3";

  assert.equal(normalizeSerializedPathLabel(cliBaseline), cliBaseline);
  assert.equal(normalizeSerializedPathLabel(resolvedCurrent), cliBaseline);
  assert.equal(
    normalizeSerializedPathLabel(resolvedCurrent),
    normalizeSerializedPathLabel(cliBaseline),
  );
  assert.doesNotMatch(normalizeSerializedPathLabel(resolvedCurrent), /\\/u);
});

void test("discover diff path normalization is lexical and portable", () => {
  assert.equal(
    normalizeSerializedPathLabel("\\\\server\\share\\state"),
    "//server/share/state",
  );
  assert.equal(
    normalizeSerializedPathLabel("/home/agent-harness/state"),
    "/home/agent-harness/state",
  );
  assert.equal(normalizeSerializedPathLabel(""), "");
});
