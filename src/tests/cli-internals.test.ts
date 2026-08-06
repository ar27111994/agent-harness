/**
 * Unit tests for cli.ts internal functions (#418, #416–#420, #428).
 *
 * Covers:
 * - mapBundleSubcommandForHelp: edge cases for bundle → mirror subcommand
 *   routing (#418)
 * - readPackageVersion: version extraction and fallback behavior (#428)
 * - runHelpCommand routing: subcommand-depth help dispatch incl. the
 *   workspace/wire domains and the unknown-domain fallback (#428)
 * - main(): the full non-help/non-version dispatch path (state-root
 *   preparation and deadline wiring) (428)
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cliInternals } from "../cli.js";
import { repositoryRoot } from "./built-cli-harness.js";

const { mapBundleSubcommandForHelp, readPackageVersion, runHelpCommand, main } =
  cliInternals;

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

// ---------------------------------------------------------------------------
// readPackageVersion (#428) — version extraction and fallbacks
// ---------------------------------------------------------------------------

void test("readPackageVersion reads the installed package version", async () => {
  const version = await readPackageVersion(repositoryRoot);
  assert.match(version, /^\d+\.\d+\.\d+$/u);
});

void test("readPackageVersion returns 0.0.0 when package.json lacks a version", async () => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-cli-version-missing-"),
  );
  try {
    await writeFile(
      join(tempRoot, "package.json"),
      JSON.stringify({ name: "no-version" }),
      "utf8",
    );
    assert.equal(await readPackageVersion(tempRoot), "0.0.0");
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("readPackageVersion returns 0.0.0 when package.json is unreadable", async () => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-cli-version-unreadable-"),
  );
  try {
    // No package.json in this directory → the read throws → fallback.
    assert.equal(await readPackageVersion(tempRoot), "0.0.0");
    // A corrupt package.json also falls back through the same catch.
    await writeFile(join(tempRoot, "package.json"), "{not json", "utf8");
    assert.equal(await readPackageVersion(tempRoot), "0.0.0");
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

async function captureHelpOutput(
  invocation: () => Promise<number>,
): Promise<{ code: number; output: string }> {
  const output: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: unknown): boolean => {
    output.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  let code: number;
  try {
    code = await invocation();
  } finally {
    process.stdout.write = originalWrite;
  }
  return { code, output: output.join("") };
}

void test("runHelpCommand routes workspace subcommand help to workspace help", async () => {
  const { code, output } = await captureHelpOutput(() =>
    runHelpCommand(["workspace", "opencode", "--help"], ""),
  );
  assert.equal(code, 0);
  assert.ok(
    output.includes("workspace opencode"),
    `expected workspace subcommand help, got: ${output}`,
  );
});

void test("runHelpCommand routes wire subcommand help to wire help", async () => {
  const { code, output } = await captureHelpOutput(() =>
    runHelpCommand(["wire", "opencode", "--help"], ""),
  );
  assert.equal(code, 0);
  assert.ok(output.includes("wire"), `expected wire help, got: ${output}`);
});

void test("runHelpCommand falls back to the generic help for an unknown domain", async () => {
  const { code, output } = await captureHelpOutput(() =>
    runHelpCommand(["not-a-domain", "subcommand", "--help"], ""),
  );
  assert.equal(code, 1);
  assert.ok(
    output.includes("agent-harness"),
    `expected top-level help, got: ${output}`,
  );
});

// ---------------------------------------------------------------------------
// main() (#428) — the full non-help/non-version dispatch path
// ---------------------------------------------------------------------------

void test("main prepares the state root, wires a deadline, and dispatches", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-cli-main-"));
  try {
    const stateRoot = join(tempRoot, "state");
    const originalArgv = process.argv;
    process.argv = [
      process.execPath,
      "dist/cli.js",
      "--no-dotenv",
      "--state-root",
      stateRoot,
      "install",
      "help",
    ];
    let result: { code: number; output: string };
    try {
      result = await captureHelpOutput(() => main());
    } finally {
      process.argv = originalArgv;
    }
    assert.equal(result.code, 0);
    assert.ok(
      result.output.includes("install"),
      `expected install help, got: ${result.output}`,
    );

    // prepareStateRoot seeded the managed discovery assets into the root.
    const { readFile } = await import("node:fs/promises");
    const seeded = await readFile(join(stateRoot, "state-root.json"), "utf8");
    assert.ok(seeded.includes("managedAssets"));
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});
