import assert from "node:assert/strict";
import test from "node:test";

import { runRecommend } from "../recommend/commands.js";
import {
  formatRecommendationHostForDisplay,
  getRecommendationHostChoices,
  resolveRecommendationHost,
} from "../recommend/hosts.js";

void test("recommendation host helpers normalize VS Code to the user-facing vscode name", () => {
  assert.equal(resolveRecommendationHost("vscode"), "copilot-vscode");
  assert.equal(resolveRecommendationHost(" VSCode "), "copilot-vscode");
  assert.equal(resolveRecommendationHost("copilot-vscode"), "copilot-vscode");
  assert.equal(formatRecommendationHostForDisplay("copilot-vscode"), "vscode");
  assert.ok(getRecommendationHostChoices().includes("vscode"));
  assert.ok(!getRecommendationHostChoices().includes("copilot-vscode"));
});

void test("recommend policy:print accepts vscode as the VS Code host name", async (t) => {
  const output: string[] = [];
  const consoleObject = globalThis.console;
  t.mock.method(consoleObject, "log", (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  });

  const exitCode = await runRecommend(
    ["policy:print", "--host", "vscode", "--compact"],
    process.cwd(),
    process.cwd(),
  );

  assert.equal(exitCode, 0);

  const printedPolicy = JSON.parse(output.join("\n")) as {
    host: string;
    hostPolicy?: unknown;
  };
  assert.equal(printedPolicy.host, "vscode");
  assert.ok(printedPolicy.hostPolicy);
});
