import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

void test("adapter runtime preflight can execute Windows cmd wrappers", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-specific wrapper execution test.");
    return;
  }

  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-preflight-wrapper-"),
  );
  await t.test("cmd wrapper resolves and executes", async () => {
    const wrapperPath = join(tempRoot, "fake-wrapper.cmd");
    await writeFile(
      wrapperPath,
      [
        "@echo off",
        'if "%~1"=="--version" echo fake-wrapper 1.0.0',
        'if "%~1"=="--version" exit /b 0',
        "echo unexpected args",
        "exit /b 1",
      ].join("\r\n"),
      "utf8",
    );

    const originalPath = process.env.PATH ?? "";
    const originalPathext = process.env.PATHEXT;
    process.env.PATH = `${tempRoot};${originalPath}`;
    process.env.PATHEXT = ".CMD;.EXE;.BAT;.COM";

    try {
      const diagnostics = await runAdapterPreflight({
        ...buildFakeAdapter(),
        runtime: {
          executable: "fake-wrapper",
          versionArgs: ["--version"],
          guidance: "Install the fake host CLI.",
        },
      });

      assert.equal(diagnostics.length, 2);
      assert.equal(diagnostics[0]?.severity, "info");
      assert.equal(diagnostics[1]?.severity, "info");
      assert.equal(diagnostics[1]?.code, "fake-host-version");
    } finally {
      process.env.PATH = originalPath;
      if (originalPathext === undefined) {
        delete process.env.PATHEXT;
      } else {
        process.env.PATHEXT = originalPathext;
      }
    }
  });

  await rm(tempRoot, { recursive: true, force: true });
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
