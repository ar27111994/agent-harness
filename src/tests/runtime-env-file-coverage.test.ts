import assert from "node:assert/strict";
import { homedir } from "node:os";
import test from "node:test";

import { envFileInternals } from "../config/env-file.js";
import { loadRuntimeConfig } from "../config/runtime.js";

void test("runtime config and env-file helpers cover fallback parser edges", () => {
  const config = loadRuntimeConfig({
    AGENT_HARNESS_HOME: "   ",
    HOME: "   ",
    USERPROFILE: "   ",
  });
  assert.equal(config.paths.homeDirectory, homedir());

  assert.deepEqual(
    envFileInternals.collectDotEnvLogicalLines('NOEQUALS"quoted"\nKEY=value'),
    ['NOEQUALS"quoted"', "KEY=value"],
  );
  assert.equal(envFileInternals.parseDotEnvLine("NO_SEPARATOR"), null);
  assert.equal(envFileInternals.parseDotEnvLine("=missing-key"), null);
  assert.equal(
    envFileInternals.parseQuotedDotEnvValue('"unterminated', '"'),
    "unterminated",
  );
  assert.equal(envFileInternals.decodeDoubleQuotedEscape("r"), "\r");
  assert.equal(envFileInternals.decodeDoubleQuotedEscape("\\"), "\\");
  assert.equal(envFileInternals.decodeDoubleQuotedEscape(undefined), "");
});
