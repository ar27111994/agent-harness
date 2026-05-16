import assert from "node:assert/strict";
import type * as ChildProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import {
  checkPathExists,
  runAdapterPreflight,
  runNativeInstallPreflight,
} from "../lib/preflight.js";
import type { HostAdapter } from "../host-adapters/registry.js";

void test("adapter and native-install preflight report unconfigured and unsupported runtimes", async () => {
  const missingRuntimeAdapter = buildAdapter({
    id: "test-host",
    displayName: "Test Host",
    runtime: undefined,
  });
  const unsupportedNativeInstallAdapter = buildAdapter({
    id: "test-host-native",
    displayName: "Test Host Native",
    runtime: {
      executable: "definitely-missing-cli",
      guidance: "Install it.",
    },
    nativeInstall: undefined,
  });

  assert.deepEqual(await runAdapterPreflight(missingRuntimeAdapter), []);
  assert.deepEqual(await runNativeInstallPreflight(missingRuntimeAdapter), [
    {
      severity: "error",
      code: "test-host-runtime-unconfigured",
      message: "No runtime executable is configured for test-host.",
    },
  ]);
  assert.deepEqual(
    await runNativeInstallPreflight(unsupportedNativeInstallAdapter),
    [
      {
        severity: "error",
        code: "test-host-native-cli",
        message: "definitely-missing-cli was not found on PATH.",
        action: "Install it.",
      },
      {
        severity: "error",
        code: "test-host-native-native-install-unsupported",
        message: "Test Host Native does not expose a native install provider.",
        action:
          "Use wire preview/apply for project-local assets or choose a host with native install support.",
      },
    ],
  );
});

void test("adapter preflight validates runtime version and readiness commands from PATH", async (context) => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-preflight-runtime-"),
  );
  const executableName = "agent-harness-runtime";
  const originalPath = process.env.PATH ?? "";
  const originalPathext = process.env.PATHEXT;

  context.after(async () => {
    process.env.PATH = originalPath;
    if (originalPathext === undefined) {
      delete process.env.PATHEXT;
    } else {
      process.env.PATHEXT = originalPathext;
    }
    clearRuntimeConfigForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  process.env.PATH = `${tempRoot}${process.platform === "win32" ? ";" : ":"}${originalPath}`;
  if (process.platform === "win32") {
    process.env.PATHEXT = ".CMD;.EXE;.BAT;.COM";
    await writeFile(
      join(tempRoot, `${executableName}.cmd`),
      [
        "@echo off",
        'if "%1"=="--version" exit /b 0',
        'if "%1"=="--ready" exit /b 0',
        "exit /b 0",
      ].join("\r\n"),
      "utf8",
    );
  } else {
    const executablePath = join(tempRoot, executableName);
    await writeFile(
      executablePath,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then exit 0; fi',
        'if [ "$1" = "--ready" ]; then exit 0; fi',
        "exit 0",
      ].join("\n"),
      "utf8",
    );
    await chmod(executablePath, 0o755);
  }
  clearRuntimeConfigForTests();

  const adapter = buildAdapter({
    id: "runtime-host",
    runtime: {
      executable: executableName,
      versionArgs: ["--version"],
      readinessArgs: ["--ready"],
      guidance: "Install the runtime-host CLI.",
    },
  });

  const diagnostics = await runAdapterPreflight(adapter);
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.severity),
    ["info", "info", "info"],
  );
  assert.match(diagnostics[0]?.message ?? "", /Found agent-harness-runtime/u);
  assert.equal(
    diagnostics[1]?.message,
    `${executableName} version command completed successfully.`,
  );
  assert.equal(
    diagnostics[2]?.message,
    `${executableName} readiness command completed successfully.`,
  );
});

const require = createRequire(import.meta.url);

void test("native-install preflight escalates runtime command failures to errors", async (context) => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-preflight-runtime-"),
  );
  const executableName = "agent-harness-runtime-fail";
  const originalPath = process.env.PATH ?? "";
  const originalPathext = process.env.PATHEXT;

  context.after(async () => {
    process.env.PATH = originalPath;
    if (originalPathext === undefined) {
      delete process.env.PATHEXT;
    } else {
      process.env.PATHEXT = originalPathext;
    }
    clearRuntimeConfigForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  process.env.PATH = `${tempRoot}${process.platform === "win32" ? ";" : ":"}${originalPath}`;
  if (process.platform === "win32") {
    process.env.PATHEXT = ".CMD;.EXE;.BAT;.COM";
    await writeFile(
      join(tempRoot, `${executableName}.cmd`),
      [
        "@echo off",
        'if "%1"=="--version" exit /b 0',
        'if "%1"=="--ready" (1>&2 echo not ready & exit /b 2)',
        "exit /b 0",
      ].join("\r\n"),
      "utf8",
    );
  } else {
    const executablePath = join(tempRoot, executableName);
    await writeFile(
      executablePath,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then exit 0; fi',
        'if [ "$1" = "--ready" ]; then echo not ready 1>&2; exit 2; fi',
        "exit 0",
      ].join("\n"),
      "utf8",
    );
    await chmod(executablePath, 0o755);
  }
  clearRuntimeConfigForTests();

  const adapter = buildAdapter({
    id: "runtime-required",
    displayName: "Runtime Required",
    runtime: {
      executable: executableName,
      versionArgs: ["--version"],
      readinessArgs: ["--ready"],
      guidance: "Fix the runtime install.",
    },
  });

  const diagnostics = await runNativeInstallPreflight(adapter);
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.severity),
    ["info", "info", "error"],
  );
  assert.match(
    diagnostics[2]?.message ?? "",
    new RegExp(`${executableName} --ready failed:`, "u"),
  );
  assert.equal(diagnostics[2]?.action, "Fix the runtime install.");
});

void test("adapter preflight falls back to default guidance and non-wrapper execution for direct executables", async () => {
  const diagnostics = await runAdapterPreflight(
    buildAdapter({
      id: "default-guidance-host",
      runtime: {
        executable: "node",
        versionArgs: ["-e", "process.exit(2)"],
        readinessArgs: ["-e", "process.exit(3)"],
      },
    }),
  );

  assert.equal(diagnostics[0]?.severity, "info");
  assert.equal(diagnostics[1]?.severity, "warning");
  assert.equal(
    diagnostics[1]?.action,
    "Confirm the host CLI is installed correctly and can report its version.",
  );
  assert.equal(diagnostics[2]?.severity, "warning");
  assert.equal(
    diagnostics[2]?.action,
    "Sign in to the host CLI and confirm marketplace/runtime access is available.",
  );
});

void test("adapter preflight honors default PATHEXT when resolving Windows executables", async (context) => {
  if (process.platform !== "win32") {
    context.skip("Windows-specific PATH resolution test.");
    return;
  }

  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-preflight-pathext-"),
  );
  const executableName = "agent-harness-runtime-default-pathext";
  const originalPath = process.env.PATH ?? "";
  const originalPathext = process.env.PATHEXT;

  context.after(async () => {
    process.env.PATH = originalPath;
    if (originalPathext === undefined) {
      delete process.env.PATHEXT;
    } else {
      process.env.PATHEXT = originalPathext;
    }
    clearRuntimeConfigForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  process.env.PATH = `${tempRoot};${originalPath}`;
  delete process.env.PATHEXT;
  await writeFile(
    join(tempRoot, `${executableName}.CMD`),
    ["@echo off", "exit /b 0"].join("\r\n"),
    "utf8",
  );
  clearRuntimeConfigForTests();

  const diagnostics = await runAdapterPreflight(
    buildAdapter({
      id: "default-pathext-host",
      runtime: {
        executable: executableName,
        versionArgs: ["--version"],
      },
    }),
  );

  assert.equal(diagnostics[0]?.severity, "info");
});

void test("adapter preflight surfaces spawn errors without error codes", async (context) => {
  const childProcess = require("node:child_process") as typeof ChildProcess;
  const originalSpawn = childProcess.spawn;

  context.after(() => {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  });

  childProcess.spawn = (() => {
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    setImmediate(() => {
      child.emit("error", new Error("spawn blocked without code"));
      child.emit("close", null);
    });
    return child as never;
  }) as typeof childProcess.spawn;
  syncBuiltinESMExports();
  clearRuntimeConfigForTests();

  const diagnostics = await runAdapterPreflight(
    buildAdapter({
      id: "spawn-error-host",
      runtime: {
        executable: "node",
        versionArgs: ["-e", "process.exit(0)"],
      },
    }),
  );

  assert.equal(diagnostics[1]?.severity, "warning");
  assert.match(diagnostics[1]?.message ?? "", /spawn blocked without code/u);
});

void test("adapter preflight surfaces timeout and spawn error branches from runtime commands", async (context) => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-preflight-timeout-"),
  );
  const executableName = "agent-harness-runtime-timeout";
  const originalPath = process.env.PATH ?? "";
  const originalPathext = process.env.PATHEXT;
  const originalTimeout =
    process.env.AGENT_HARNESS_PREFLIGHT_COMMAND_TIMEOUT_MS;
  const childProcess = require("node:child_process") as typeof ChildProcess;
  const originalSpawn = childProcess.spawn;

  context.after(async () => {
    process.env.PATH = originalPath;
    if (originalPathext === undefined) {
      delete process.env.PATHEXT;
    } else {
      process.env.PATHEXT = originalPathext;
    }
    if (originalTimeout === undefined) {
      delete process.env.AGENT_HARNESS_PREFLIGHT_COMMAND_TIMEOUT_MS;
    } else {
      process.env.AGENT_HARNESS_PREFLIGHT_COMMAND_TIMEOUT_MS = originalTimeout;
    }
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
    clearRuntimeConfigForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  process.env.PATH = `${tempRoot}${process.platform === "win32" ? ";" : ":"}${originalPath}`;
  process.env.AGENT_HARNESS_PREFLIGHT_COMMAND_TIMEOUT_MS = "5";
  if (process.platform === "win32") {
    process.env.PATHEXT = ".CMD;.EXE;.BAT;.COM";
    await writeFile(
      join(tempRoot, `${executableName}.cmd`),
      "@echo off\r\n",
      "utf8",
    );
  } else {
    const executablePath = join(tempRoot, executableName);
    await writeFile(executablePath, "#!/bin/sh\n", "utf8");
    await chmod(executablePath, 0o755);
  }
  clearRuntimeConfigForTests();

  const adapter = buildAdapter({
    id: "timeout-host",
    runtime: {
      executable: executableName,
      versionArgs: ["--version"],
      guidance: "Install timeout-host.",
    },
  });

  childProcess.spawn = (() => {
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stderr = new EventEmitter();
    child.kill = () => {
      setImmediate(() => child.emit("close", null));
    };
    return child as never;
  }) as typeof childProcess.spawn;
  syncBuiltinESMExports();

  const timeoutDiagnostics = await runAdapterPreflight(adapter);
  assert.equal(timeoutDiagnostics[1]?.severity, "warning");
  assert.match(timeoutDiagnostics[1]?.message ?? "", /timed out after 5ms/u);

  childProcess.spawn = (() => {
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    setImmediate(() => {
      child.emit(
        "error",
        Object.assign(new Error("blocked"), { code: "EACCES" }),
      );
      child.emit("close", null);
    });
    return child as never;
  }) as typeof childProcess.spawn;
  syncBuiltinESMExports();
  clearRuntimeConfigForTests();

  const errorDiagnostics = await runAdapterPreflight(adapter);
  assert.equal(errorDiagnostics[1]?.severity, "warning");
  assert.match(errorDiagnostics[1]?.message ?? "", /EACCES/u);
});

void test("checkPathExists reports non-ENOENT access failures as errors", async (context) => {
  const fsPromises = require("node:fs/promises") as typeof FsPromises;
  const originalAccess = fsPromises.access;

  context.after(() => {
    fsPromises.access = originalAccess;
    syncBuiltinESMExports();
  });

  fsPromises.access = (async () => {
    const error = new Error("denied") as NodeJS.ErrnoException;
    error.code = "EACCES";
    throw error;
  }) as typeof fsPromises.access;
  syncBuiltinESMExports();

  const diagnostic = await checkPathExists("/tmp/blocked", "blocked-path");
  assert.deepEqual(diagnostic, {
    severity: "error",
    code: "blocked-path",
    message: "Unable to access /tmp/blocked: EACCES.",
    action:
      "Check permissions and confirm the path is readable by the current user.",
  });
});

function buildAdapter(
  overrides: Partial<HostAdapter> & Pick<HostAdapter, "id">,
): HostAdapter {
  return {
    id: overrides.id,
    aliases: overrides.aliases ?? [],
    displayName: overrides.displayName ?? overrides.id,
    lifecycleHost: overrides.lifecycleHost ?? "opencode",
    recommendationHost: overrides.recommendationHost ?? "opencode",
    defaultBundleIds: overrides.defaultBundleIds ?? [],
    mutatesHostPaths: overrides.mutatesHostPaths ?? true,
    requiresLifecycleHostPaths: overrides.requiresLifecycleHostPaths ?? false,
    runtime: overrides.runtime,
    nativeInstall:
      "nativeInstall" in overrides
        ? overrides.nativeInstall
        : {
            assetKind: "extension",
            collectActions: () => [],
          },
    capabilities: overrides.capabilities ?? [
      { assetKind: "plugin", behaviors: ["wire"] },
    ],
    wire: overrides.wire ?? (async () => {}),
  };
}
