import assert from "node:assert/strict";
import test from "node:test";

import type { HostAdapter } from "../host-adapters/registry.js";
import {
  checkExecutableOnPath,
  preflightInternals,
  runAdapterPreflight,
  runNativeInstallPreflight,
} from "../lib/preflight.js";

const { isAborted } = preflightInternals;

void test("adapter runtime preflight is driven by adapter metadata", async () => {
  const diagnostics = await runAdapterPreflight(buildFakeAdapter());

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.severity, "warning");
  assert.equal(diagnostics[0]?.code, "fake-host-cli");
  assert.match(
    diagnostics[0]?.message ?? "",
    /definitely-missing-agent-harness-host/u,
  );
});

void test("isAborted: returns false when signal is undefined", () => {
  assert.equal(isAborted(undefined), false);
});

void test("isAborted: returns false when signal is not aborted", () => {
  const controller = new AbortController();
  assert.equal(isAborted(controller.signal), false);
});

void test("isAborted: returns true when signal is aborted", () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(isAborted(controller.signal), true);
});

void test("runAdapterPreflight returns skipped diagnostic when abort signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();

  const diagnostics = await runAdapterPreflight(
    buildFakeAdapter(),
    controller.signal,
  );

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.severity, "warning");
  assert.match(
    diagnostics[0]?.message ?? "",
    /preflight check skipped/i,
  );
});

function buildFakeAdapter(): HostAdapter {
  return {
    id: "fake-host",
    displayName: "Fake IDE",
    lifecycleHost: "copilot-vscode" as const,
    recommendationHost: "copilot-vscode" as const,
    mutatesHostPaths: false,
    defaultBundleIds: [],
    runtime: {
      executable: "definitely-missing-agent-harness-host",
      guidance: "Install the fake host CLI.",
    },
    capabilities: [],
    wire: async () => {},
    aliases: [],
  };
}
