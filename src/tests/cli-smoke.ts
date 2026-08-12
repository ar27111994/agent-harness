import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

import {
  createIsolatedCliEnvironment,
  runBuiltCli,
} from "./built-cli-harness.js";

const hosts = [
  "vscode",
  "opencode",
  "cursor",
  "zed",
  "claude-code",
  "pi",
  "codex",
];

const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-cli-smoke-"));
try {
  const { workspaceRoot, env } = await createIsolatedCliEnvironment(tempRoot);

  await runBuiltCli({ cwd: workspaceRoot, env, args: ["setup", "hosts"] });
  await runBuiltCli({
    cwd: workspaceRoot,
    env,
    args: ["setup", "login", "--provider", "github"],
  });
  for (const host of ["vscode", "cursor", "codex"]) {
    await assertSmokeStep(
      `install native plan (${host})`,
      runBuiltCli({
        cwd: workspaceRoot,
        env,
        args: ["install", "native", "--host", host],
      }),
    );
  }
  await assertSmokeStep(
    "discover enrich",
    runBuiltCli({ cwd: workspaceRoot, env, args: ["discover", "enrich"] }),
  );

  for (const host of hosts) {
    // Preview/apply/reset must each produce output and never emit an error
    // line (review: smoke asserts beyond exit codes).
    await assertSmokeStep(
      `wire ${host} preview`,
      runBuiltCli({
        cwd: workspaceRoot,
        env,
        args: ["wire", host, "--preview"],
      }),
    );
    await assertSmokeStep(
      `wire ${host} apply`,
      runBuiltCli({
        cwd: workspaceRoot,
        env,
        args: ["wire", host, "--apply"],
      }),
    );
    await assertSmokeStep(
      `wire ${host} reset`,
      runBuiltCli({
        cwd: workspaceRoot,
        env,
        args: ["wire", host, "--reset"],
      }),
    );
  }

  console.log(`CLI smoke completed with isolated workspace ${workspaceRoot}`);
} finally {
  await rm(tempRoot, { force: true, recursive: true });
}

async function assertSmokeStep(
  step: string,
  run: Promise<{ stdout: string; stderr: string }>,
): Promise<void> {
  const result = await run;
  assert.ok(
    result.stdout.length > 0 || result.stderr.length > 0,
    `${step}: must produce output`,
  );
  // Error lines are checked against the COMBINED output, not stderr alone
  // (review): a CLI command that writes `error:` to stdout and still exits
  // cleanly must fail the smoke just like one that uses stderr.
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /error:/iu,
    `${step}: must not emit an error line`,
  );
}
