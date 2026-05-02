import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadDotEnvFile } from "../config/env-file.js";

test("dotenv loading preserves shell values while later file assignments win", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-env-"));
  await writeFile(
    join(root, ".env"),
    [
      "FOO=one",
      "FOO=two",
      "export EXPORTED=value",
      'MULTILINE="line one',
      'line two"',
      "SHELL_VALUE=file-value",
      "",
    ].join("\n"),
    "utf8",
  );

  const env: NodeJS.ProcessEnv = { SHELL_VALUE: "shell-value" };

  try {
    const result = await loadDotEnvFile(root, env);

    assert.equal(result.loaded, true);
    assert.deepEqual(result.appliedKeys, ["FOO", "EXPORTED", "MULTILINE"]);
    assert.equal(env.FOO, "two");
    assert.equal(env.EXPORTED, "value");
    assert.equal(env.MULTILINE, "line one\nline two");
    assert.equal(env.SHELL_VALUE, "shell-value");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
