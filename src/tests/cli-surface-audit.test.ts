/**
 * CLI surface audit — validates that parent help and subcommand-specific
 * help accurately reflect the actual CLI command surface.
 *
 * Guards against:
 * 1. Phantom commands listed in parent help that don't exist
 * 2. Real subcommands not listed in parent help
 * 3. Subcommands lacking subcommand-specific --help output
 */

import assert from "node:assert/strict";
import test from "node:test";

import { runBuiltCli } from "./built-cli-harness.js";

// ─── Shared helpers ─────────────────────────────────────────────────────────

/**
 * Extracts the subcommand names listed under a section heading in parent
 * help output. Expects lines like "  discover demand-profile     Scan..."
 */
function extractSubcommandsFromSection(
  stdout: string,
  sectionTitle: string,
  prefix: string,
): string[] {
  const lines = stdout.split("\n");
  let inSection = false;
  const commands: string[] = [];

  for (const line of lines) {
    if (line.includes(sectionTitle)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      // Section ends at an empty line or next section header
      if (line.trim() === "") break;
      if (line.match(/^\S/) && !line.startsWith("  ")) break;

      const match = line.match(new RegExp(`^\\s{2,}${prefix} (\\S+)`));
      if (match && match[1]) {
        commands.push(match[1]);
      }
    }
  }

  return commands;
}

/**
 * Shared parent-help validation: runs --help, extracts subcommands from
 * the named section(s), and asserts bidirectional equality with the
 * expected set.
 *
 * @param label      Human-readable command group name for error messages
 * @param sections   One or more parent-help section titles to scan
 * @param prefix     The command prefix (e.g. "discover", "mirror")
 * @param expected   Set of subcommand names that actually exist
 */
async function assertParentHelpListsAll(
  label: string,
  sections: string[],
  prefix: string,
  expected: ReadonlySet<string>,
): Promise<void> {
  const { stdout } = await runBuiltCli({
    cwd: process.cwd(),
    env: {},
    stateRoot: "",
    timeout: 10_000,
    args: ["--help"],
  });

  const listed = sections.flatMap((title) =>
    extractSubcommandsFromSection(stdout, title, prefix),
  );

  for (const cmd of listed) {
    assert.ok(
      expected.has(cmd),
      `Parent help lists ${label} subcommand '${cmd}' but it doesn't exist`,
    );
  }

  for (const cmd of expected) {
    assert.ok(
      listed.includes(cmd),
      `${label} subcommand '${cmd}' exists but is not listed in parent help`,
    );
  }
}

// ─── Parent-help completeness tests ─────────────────────────────────────────

void test("parent help lists all discover subcommands that exist", async () => {
  await assertParentHelpListsAll(
    "discover",
    ["Discover —"],
    "discover",
    new Set([
      "demand-profile",
      "sources",
      "catalog",
      "index",
      "sync",
      "select",
      "full",
      "breadth",
      "enrich",
      "stats",
      "diff",
      "environment-index",
      "ard-export",
      "inspect",
    ]),
  );
});

void test("parent help lists all recommend subcommands that exist", async () => {
  await assertParentHelpListsAll(
    "recommend",
    ["Recommend —"],
    "recommend",
    new Set(["report", "ai-review", "explain", "evaluate", "policy:print"]),
  );
});

void test("parent help lists all mirror subcommands that exist", async () => {
  await assertParentHelpListsAll(
    "mirror",
    ["Mirror & Install", "Rebuild & Bundle"],
    "mirror",
    new Set(["locks", "acquire", "bundle-explain", "plan", "diff", "explain"]),
  );
});

void test("parent help lists all install subcommands that exist", async () => {
  await assertParentHelpListsAll(
    "install",
    ["Mirror & Install"],
    "install",
    new Set([
      "bundle",
      "native",
      "refresh",
      "reconcile",
      "diff",
      "explain",
      "generations",
      "reset",
    ]),
  );
});

void test("parent help lists all activate subcommands that exist", async () => {
  await assertParentHelpListsAll(
    "activate",
    ["Activate & Wire"],
    "activate",
    new Set(["host", "diff", "explain", "rollback"]),
  );
});

void test("parent help lists all quarantine subcommands that exist", async () => {
  await assertParentHelpListsAll(
    "quarantine",
    ["Quarantine —"],
    "quarantine",
    new Set(["list", "approve", "reject", "pin"]),
  );
});

// ─── Subcommand-specific help test ──────────────────────────────────────────

void test("every known subcommand has subcommand-specific --help", async () => {
  // Subcommands that should have specific help output (not parent help)
  const subcommandsWithHelp = [
    ["discover", "demand-profile"],
    ["discover", "sources"],
    ["discover", "sync"],
    ["discover", "catalog"],
    ["discover", "select"],
    ["discover", "full"],
    ["discover", "breadth"],
    ["discover", "stats"],
    ["discover", "diff"],
    ["discover", "environment-index"],
    ["discover", "ard-export"],
    ["discover", "enrich"],
    ["discover", "inspect"],
    ["discover", "index"],
    ["recommend", "report"],
    ["recommend", "evaluate"],
    ["recommend", "ai-review"],
    ["recommend", "explain"],
    ["recommend", "policy:print"],
    ["mirror", "locks"],
    ["mirror", "acquire"],
    ["mirror", "bundle-explain"],
    ["mirror", "plan"],
    ["mirror", "diff"],
    ["mirror", "explain"],
    ["install", "bundle"],
    ["install", "native"],
    ["install", "refresh"],
    ["install", "reconcile"],
    ["install", "diff"],
    ["install", "explain"],
    ["install", "generations"],
    ["install", "reset"],
    ["activate", "host"],
    ["activate", "diff"],
    ["activate", "explain"],
    ["activate", "rollback"],
    ["quarantine", "list"],
    ["quarantine", "approve"],
    ["quarantine", "reject"],
    ["quarantine", "pin"],
    ["rebuild", "clean"],
    ["rebuild", "full"],
    ["setup", "doctor"],
    ["setup", "hosts"],
    ["setup", "login"],
  ];

  for (const [domain, subcommand] of subcommandsWithHelp) {
    const { stdout } = await runBuiltCli({
      cwd: process.cwd(),
      env: {},
      stateRoot: "",
      timeout: 10_000,
      args: [domain, subcommand, "--help"],
    });

    // Subcommand-specific help should show the subcommand name in its
    // heading (first line). Anchor to line start so incidental mentions
    // in descriptions or options cannot satisfy the assertion.
    const subcommandName = `${domain} ${subcommand}`;
    const escaped = subcommandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      stdout,
      new RegExp(`^${escaped}`, "mu"),
      `${subcommandName} --help should show subcommand-specific help`,
    );
  }
});
