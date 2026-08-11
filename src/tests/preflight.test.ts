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

void test("adapter runtime preflight builds Windows wrapper spawn specs", () => {
  const wrapperSpec = preflightInternals.buildRuntimeCommandSpawnSpec({
    args: ["--version"],
    executable: "fake-wrapper",
    platform: "win32",
    resolvedExecutable: "C:\\Tools\\fake-wrapper.cmd",
  });
  assert.equal(wrapperSpec.executable, "powershell.exe");
  assert.deepEqual(wrapperSpec.args.slice(0, 4), [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
  ]);
  // The spawn spec must invoke the VALIDATED resolved executable, never the
  // bare configured name (review): PowerShell would re-resolve `fake-wrapper`
  // through PATH and could pick a different wrapper than the one the
  // wrapper-refusal checks validated against.
  assert.equal(
    wrapperSpec.args.at(-1),
    "& 'C:\\Tools\\fake-wrapper.cmd' '--version'",
  );

  assert.deepEqual(
    preflightInternals.buildRuntimeCommandSpawnSpec({
      args: ["--version"],
      executable: "node",
      platform: "linux",
      resolvedExecutable: "/usr/bin/node",
    }),
    { executable: "/usr/bin/node", args: ["--version"] },
  );
  assert.deepEqual(
    preflightInternals.buildRuntimeCommandSpawnSpec({
      args: ["--version"],
      executable: "node",
      resolvedExecutable: "/usr/bin/node",
    }),
    { executable: "/usr/bin/node", args: ["--version"] },
  );
});

void test("executable preflight handles empty PATH and default Windows extensions", async () => {
  const originalPath = process.env.PATH;
  const originalPathext = process.env.PATHEXT;

  try {
    delete process.env.PATH;
    const missing = await checkExecutableOnPath(
      "definitely-missing-agent-harness-host",
      "missing-host",
    );
    assert.equal(missing.severity, "warning");
    assert.equal(missing.action?.startsWith("Install the host CLI"), true);

    const found = await preflightInternals.findExecutableOnPath("default-ext", {
      accessPath: async (candidate) => {
        if (String(candidate).endsWith("default-ext.CMD")) {
          return;
        }
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
      env: { PATH: "C:\\Tools" } as NodeJS.ProcessEnv,
      platform: "win32",
    });
    assert.equal(found, "C:\\Tools\\default-ext.CMD");
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    if (originalPathext === undefined) {
      delete process.env.PATHEXT;
    } else {
      process.env.PATHEXT = originalPathext;
    }
  }
});

// ── isAborted coverage (#355) ──────────────────────────────────────────

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
  assert.match(diagnostics[0]?.message ?? "", /preflight check skipped/i);
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
