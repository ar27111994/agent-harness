import assert from "node:assert/strict";
import test from "node:test";

import type { HostAdapter } from "../host-adapters/registry.js";
import {
  runAdapterPreflight,
  runNativeInstallPreflight,
} from "../lib/preflight.js";

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

void test("native install preflight makes missing runtime fatal", async () => {
  const diagnostics = await runNativeInstallPreflight({
    ...buildFakeAdapter(),
    nativeInstall: {
      assetKind: "extension",
      collectActions: () => [],
    },
  });

  assert.equal(diagnostics[0]?.severity, "error");
});

void test("native install preflight rejects adapters without native provider", async () => {
  const diagnostics = await runNativeInstallPreflight(buildFakeAdapter());

  assert.ok(
    diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "fake-host-native-install-unsupported",
    ),
  );
});

function buildFakeAdapter(): HostAdapter {
  return {
    id: "fake-host",
    aliases: [],
    displayName: "Fake Host",
    lifecycleHost: "opencode",
    recommendationHost: "opencode",
    defaultBundleIds: [],
    mutatesHostPaths: false,
    runtime: {
      executable: "definitely-missing-agent-harness-host",
      guidance: "Install the fake host CLI.",
    },
    capabilities: [],
    wire: async () => {},
  };
}
