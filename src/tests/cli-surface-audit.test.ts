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

void test("parent help lists all discover subcommands that exist", async () => {
  // Discover subcommands from cli.ts switch statement
  const realDiscoverSubcommands = new Set([
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
  ]);

  const { stdout } = await runBuiltCli({
    cwd: process.cwd(),
    env: {},
    stateRoot: "",
    timeout: 10_000,
    args: ["--help"],
  });

  const listed = extractSubcommandsFromSection(
    stdout,
    "Discover —",
    "discover",
  );

  for (const cmd of listed) {
    assert.ok(
      realDiscoverSubcommands.has(cmd),
      `Parent help lists discover subcommand '${cmd}' but it doesn't exist`,
    );
  }

  for (const cmd of realDiscoverSubcommands) {
    assert.ok(
      listed.includes(cmd),
      `Discover subcommand '${cmd}' exists but is not listed in parent help`,
    );
  }
});

void test("parent help lists all recommend subcommands that exist", async () => {
  const realRecommendSubcommands = new Set([
    "report",
    "ai-review",
    "explain",
    "evaluate",
    "policy:print",
  ]);

  const { stdout } = await runBuiltCli({
    cwd: process.cwd(),
    env: {},
    stateRoot: "",
    timeout: 10_000,
    args: ["--help"],
  });

  const listed = extractSubcommandsFromSection(
    stdout,
    "Recommend —",
    "recommend",
  );

  for (const cmd of listed) {
    assert.ok(
      realRecommendSubcommands.has(cmd),
      `Parent help lists recommend subcommand '${cmd}' but it doesn't exist`,
    );
  }

  for (const cmd of realRecommendSubcommands) {
    assert.ok(
      listed.includes(cmd),
      `Recommend subcommand '${cmd}' exists but is not listed in parent help`,
    );
  }
});

void test("parent help lists all mirror subcommands that exist", async () => {
  const realMirrorSubcommands = new Set([
    "locks",
    "acquire",
    "bundle-explain",
    "plan",
    "diff",
    "explain",
  ]);

  const { stdout } = await runBuiltCli({
    cwd: process.cwd(),
    env: {},
    stateRoot: "",
    timeout: 10_000,
    args: ["--help"],
  });

  const listed = [
    ...extractSubcommandsFromSection(stdout, "Mirror & Install", "mirror"),
    ...extractSubcommandsFromSection(stdout, "Rebuild & Bundle", "mirror"),
  ];

  for (const cmd of listed) {
    assert.ok(
      realMirrorSubcommands.has(cmd),
      `Parent help lists mirror subcommand '${cmd}' but it doesn't exist`,
    );
  }

  for (const cmd of realMirrorSubcommands) {
    assert.ok(
      listed.includes(cmd),
      `Mirror subcommand '${cmd}' exists but is not listed in parent help`,
    );
  }
});

void test("parent help lists all install subcommands that exist", async () => {
  const realInstallSubcommands = new Set([
    "bundle",
    "native",
    "refresh",
    "reconcile",
    "diff",
    "explain",
    "generations",
    "reset",
  ]);

  const { stdout } = await runBuiltCli({
    cwd: process.cwd(),
    env: {},
    stateRoot: "",
    timeout: 10_000,
    args: ["--help"],
  });

  const listed = extractSubcommandsFromSection(
    stdout,
    "Mirror & Install",
    "install",
  );

  for (const cmd of listed) {
    assert.ok(
      realInstallSubcommands.has(cmd),
      `Parent help lists install subcommand '${cmd}' but it doesn't exist`,
    );
  }

  for (const cmd of realInstallSubcommands) {
    assert.ok(
      listed.includes(cmd),
      `Install subcommand '${cmd}' exists but is not listed in parent help`,
    );
  }
});

void test("parent help lists all activate subcommands that exist", async () => {
  const realActivateSubcommands = new Set([
    "host",
    "diff",
    "explain",
    "rollback",
  ]);

  const { stdout } = await runBuiltCli({
    cwd: process.cwd(),
    env: {},
    stateRoot: "",
    timeout: 10_000,
    args: ["--help"],
  });

  const listed = extractSubcommandsFromSection(
    stdout,
    "Activate & Wire",
    "activate",
  );

  for (const cmd of listed) {
    assert.ok(
      realActivateSubcommands.has(cmd),
      `Parent help lists activate subcommand '${cmd}' but it doesn't exist`,
    );
  }

  for (const cmd of realActivateSubcommands) {
    assert.ok(
      listed.includes(cmd),
      `Activate subcommand '${cmd}' exists but is not listed in parent help`,
    );
  }
});

void test("parent help lists all quarantine subcommands that exist", async () => {
  const realQuarantineSubcommands = new Set([
    "list",
    "approve",
    "reject",
    "pin",
  ]);

  const { stdout } = await runBuiltCli({
    cwd: process.cwd(),
    env: {},
    stateRoot: "",
    timeout: 10_000,
    args: ["--help"],
  });

  const listed = extractSubcommandsFromSection(
    stdout,
    "Quarantine —",
    "quarantine",
  );

  for (const cmd of listed) {
    assert.ok(
      realQuarantineSubcommands.has(cmd),
      `Parent help lists quarantine subcommand '${cmd}' but it doesn't exist`,
    );
  }

  for (const cmd of realQuarantineSubcommands) {
    assert.ok(
      listed.includes(cmd),
      `Quarantine subcommand '${cmd}' exists but is not listed in parent help`,
    );
  }
});

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

    // Subcommand-specific help should contain the subcommand name in its
    // heading, not show the parent command list.
    const subcommandName = `${domain} ${subcommand}`;
    assert.match(
      stdout,
      new RegExp(subcommandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
      `${subcommandName} --help should show subcommand-specific help`,
    );
  }
});
