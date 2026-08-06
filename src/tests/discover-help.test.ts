/**
 * In-process tests for discover help routing (#383, #428): subcommand-help
 * dispatch must route full/breadth aliases to their specific help and fall
 * back to the parent discover help for unknown subcommands.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  printDiscoverBreadthHelp,
  printDiscoverFullHelp,
  printDiscoverHelp,
  printDiscoverSubcommandHelp,
} from "../discover-help.js";

function captureHelp(invocation: () => void): string {
  const output: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: unknown): boolean => {
    output.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    invocation();
  } finally {
    process.stdout.write = originalWrite;
  }
  return output.join("");
}

void test("printDiscoverSubcommandHelp routes the full subcommand to its specific help", () => {
  const output = captureHelp(() => printDiscoverSubcommandHelp("full"));
  assert.ok(output.includes("discover full"), `got: ${output}`);
  // Parent help is not printed for a routed subcommand.
  assert.ok(!output.includes("discover commands:"), `got: ${output}`);
});

void test("printDiscoverSubcommandHelp routes breadth aliases to breadth help", () => {
  for (const alias of ["breadth", "recall", "candidate-pool"]) {
    const output = captureHelp(() => printDiscoverSubcommandHelp(alias));
    assert.ok(
      output.includes("discover breadth"),
      `alias ${alias} should route to breadth help: ${output}`,
    );
  }
});

void test("printDiscoverSubcommandHelp falls back to parent help for unknown subcommands", () => {
  const output = captureHelp(() => printDiscoverSubcommandHelp("nonsense"));
  assert.ok(
    output.includes("discover commands:"),
    `expected parent discover help fallback: ${output}`,
  );
});

void test("printDiscoverHelp prints the parent command listing", () => {
  const output = captureHelp(() => printDiscoverHelp());
  assert.ok(output.includes("discover commands:"), `got: ${output}`);
});

void test("printDiscoverFullHelp prints the full subcommand usage", () => {
  const output = captureHelp(() => printDiscoverFullHelp());
  assert.ok(output.includes("discover full"), `got: ${output}`);
});

void test("printDiscoverBreadthHelp prints the breadth subcommand usage", () => {
  const output = captureHelp(() => printDiscoverBreadthHelp());
  assert.ok(output.includes("discover breadth"), `got: ${output}`);
});
