import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cliInternals } from "../cli.js";
import {
  createIsolatedCliEnvironment,
  runBuiltCli,
} from "./built-cli-harness.js";

void test("top-level help teaches the discovery-to-recommend workflow and state outputs", async (t) => {
  const output: string[] = [];
  t.mock.method(process.stdout, "write", ((chunk: string | Uint8Array) => {
    output.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);

  const code = await cliInternals.runHelpCommand(["--help"], process.cwd());
  assert.equal(code, 0);
  const rendered = output.join("\n");
  assert.match(
    rendered,
    /demand-profile -> sources -> sync \(optional cache\/index refresh\) -> catalog -> select -> recommend report/u,
  );
  assert.match(
    rendered,
    /mutable discovery\/recommendation artifacts are written under <state-root>/u,
  );
  assert.match(
    rendered,
    /recommend report\s+Build a scored report \(requires discover select outputs\)/u,
  );
});

void test("discover catalog help states that sync is optional", async (t) => {
  const output: string[] = [];
  t.mock.method(process.stdout, "write", ((chunk: string | Uint8Array) => {
    output.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);

  const code = await cliInternals.runHelpCommand(
    ["discover", "catalog", "--help"],
    process.cwd(),
  );
  assert.equal(code, 0);
  const rendered = output.join("\n");
  assert.match(rendered, /discover sync.*is optional/iu);
  assert.doesNotMatch(rendered, /Run 'discover sync' first/iu);
});

void test(
  "spawned doctor prints timeout scopes and a host-readiness summary",
  { timeout: 30_000 },
  async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-first-run-"));
    try {
      const { workspaceRoot, env } =
        await createIsolatedCliEnvironment(tempRoot);
      const result = await runBuiltCli({
        cwd: workspaceRoot,
        env: {
          ...env,
          AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS: "1",
          AGENT_HARNESS_SETUP_DOCTOR_TIMEOUT_MS: "10",
        },
        args: ["setup", "doctor", "--host", "opencode"],
        timeout: 20_000,
      });

      assert.match(result.stdout, /[01]\/1 hosts ready/u);
      assert.match(result.stderr, /per-adapter timeout: 1ms/u);
      assert.match(result.stderr, /cumulative timeout: 10ms/u);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  },
);

void test("catalog progress copy distinguishes scheduled, subtotal, and final totals", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      join(
        process.cwd(),
        "src",
        "domains",
        "discovery",
        "catalog-generation.ts",
      ),
      "utf8",
    ),
  );

  assert.match(
    source,
    /Scheduled \$\{scheduledSourceCount\} source\(s\) this pass/u,
  );
  assert.match(source, /Local\/indexed subtotal:/u);
  assert.match(source, /total deduplicated entries/u);
});
