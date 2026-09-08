import assert from "node:assert/strict";
import test from "node:test";

import { runSetup, setupInternals } from "../setup.js";
import type { PreflightDiagnostic } from "../lib/preflight.js";

void test("doctor labels timeout scopes, routes diagnostics to stderr, and prints readiness verdict", async (t) => {
  const stdout: string[] = [];
  let stderr = "";
  t.mock.method(console, "log", (...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  });
  t.mock.method(process.stderr, "write", ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write);

  const ok = await setupInternals.runDoctor(["--host", "cursor"], undefined, {
    preflightRunner: async (): Promise<PreflightDiagnostic[]> => [
      {
        severity: "warning",
        code: "cursor-version-cancelled",
        message: "cursor --version timed out after 15000ms.",
        action: "check Cursor",
      },
    ],
  });

  assert.equal(
    ok,
    true,
    "warning-only readiness failures remain informational",
  );
  assert.match(stderr, /per-adapter timeout: 30000ms/u);
  assert.match(stderr, /cumulative timeout: 50000ms/u);
  assert.match(stderr, /\[warning\] cursor-version-cancelled/u);
  assert.doesNotMatch(stdout.join("\n"), /\[(?:info|warning|error)\]/u);
  assert.ok(
    stdout.some((line) =>
      line.includes(
        "Lifecycle host: copilot-vscode (reused lifecycle implementation for cursor)",
      ),
    ),
  );
  assert.equal(stdout.at(-1), "0/1 hosts ready");
});

void test("doctor counts info-only adapters as ready", async (t) => {
  const stdout: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  });
  t.mock.method(
    process.stderr,
    "write",
    (() => true) as typeof process.stderr.write,
  );

  const ok = await setupInternals.runDoctor(["--host", "codex"], undefined, {
    preflightRunner: async (): Promise<PreflightDiagnostic[]> => [
      { severity: "info", code: "fixture-info", message: "informational" },
    ],
  });
  assert.equal(ok, true);
  assert.equal(stdout.at(-1), "1/1 hosts ready");
});

void test("doctor help documents stable warning and hard-failure exit semantics", async (t) => {
  const stdout: string[] = [];
  t.mock.method(process.stdout, "write", ((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);

  assert.equal(await runSetup(["doctor", "--help"]), 0);
  const help = stdout.join("\n");
  assert.match(help, /default: 30000/u);
  assert.match(help, /exit 0 means the doctor completed without a hard error/u);
  assert.match(help, /exit 1 means a\s*hard preflight\/internal failure/u);
  assert.match(help, /N\/M hosts ready/u);
});
