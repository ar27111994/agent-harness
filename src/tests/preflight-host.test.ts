import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import {
  assertNoPreflightErrors,
  checkExecutableOnPath,
  formatPreflightDiagnostics,
  runConfigPreflight,
  runHostPreflight,
} from "../lib/preflight.js";

void test("config preflight reports optional GitHub token state", async (context) => {
  const previousToken = process.env.GITHUB_TOKEN;
  const previousPersonalToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  context.after(() => {
    restoreMaybeEnv("GITHUB_TOKEN", previousToken);
    restoreMaybeEnv("GITHUB_PERSONAL_ACCESS_TOKEN", previousPersonalToken);
    clearRuntimeConfigForTests();
  });

  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  clearRuntimeConfigForTests();
  const missingDiagnostics = await runConfigPreflight();
  assert.equal(missingDiagnostics.length, 1);
  assert.equal(missingDiagnostics[0]?.severity, "info");
  assert.match(
    missingDiagnostics[0]?.message ?? "",
    /No GitHub token is configured/u,
  );

  process.env.GITHUB_TOKEN = "test-token";
  clearRuntimeConfigForTests();
  assert.deepEqual(await runConfigPreflight(), []);
});

void test("preflight executable detection finds temp binaries on PATH", async (context) => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-preflight-bin-"),
  );
  const commandBaseName = "agent-harness-temp-bin";
  const originalPath = process.env.PATH ?? "";
  const originalPathext = process.env.PATHEXT;

  context.after(async () => {
    process.env.PATH = originalPath;
    restoreMaybeEnv("PATHEXT", originalPathext);
    await rm(tempRoot, { recursive: true, force: true });
  });

  process.env.PATH = `${tempRoot}${process.platform === "win32" ? ";" : ":"}${originalPath}`;

  if (process.platform === "win32") {
    process.env.PATHEXT = ".CMD;.EXE;.BAT;.COM";
    await writeFile(
      join(tempRoot, `${commandBaseName}.cmd`),
      ["@echo off", "echo ok", "exit /b 0"].join("\r\n"),
      "utf8",
    );
  } else {
    const executablePath = join(tempRoot, commandBaseName);
    await writeFile(executablePath, "#!/bin/sh\necho ok\n", "utf8");
    await chmod(executablePath, 0o755);
  }

  const diagnostic = await checkExecutableOnPath(commandBaseName, "temp-bin");
  assert.equal(diagnostic.severity, "info");
  assert.match(diagnostic.message, /Found agent-harness-temp-bin/u);
});

void test("preflight executable detection returns default guidance when a binary is missing", async () => {
  const diagnostic = await checkExecutableOnPath(
    "definitely-missing-agent-harness-bin",
    "missing-bin",
  );

  assert.deepEqual(diagnostic, {
    severity: "warning",
    code: "missing-bin",
    message: "definitely-missing-agent-harness-bin was not found on PATH.",
    action:
      "Install the host CLI or ensure it is available on PATH if you want runtime readiness validation beyond project-local file wiring.",
  });
});

void test("host preflight reports host guidance without requiring writable host paths", async (context) => {
  const previousToken = process.env.GITHUB_TOKEN;
  const previousPersonalToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  context.after(() => {
    restoreMaybeEnv("GITHUB_TOKEN", previousToken);
    restoreMaybeEnv("GITHUB_PERSONAL_ACCESS_TOKEN", previousPersonalToken);
    clearRuntimeConfigForTests();
  });

  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  clearRuntimeConfigForTests();

  const vscodeDiagnostics = await runHostPreflight("copilot-vscode");
  assert.ok(
    vscodeDiagnostics.some(
      (diagnostic) => diagnostic.code === "github-token-optional",
    ),
  );
  assert.ok(
    vscodeDiagnostics.some(
      (diagnostic) => diagnostic.code === "vscode-native-install-boundary",
    ),
  );

  const opencodeDiagnostics = await runHostPreflight("opencode");
  assert.ok(
    opencodeDiagnostics.some(
      (diagnostic) => diagnostic.code === "github-token-optional",
    ),
  );
  assert.ok(
    opencodeDiagnostics.some(
      (diagnostic) => diagnostic.code === "opencode-project-overlay",
    ),
  );
});

void test("host preflight elevates missing required host paths and reports host-specific guidance", async (context) => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-host-preflight-"),
  );
  const homeDirectory = join(tempRoot, "home");
  const appDataDirectory = join(tempRoot, "appdata");
  const xdgConfigHome = join(tempRoot, "xdg");
  await Promise.all([
    mkdir(homeDirectory, { recursive: true }),
    mkdir(appDataDirectory, { recursive: true }),
    mkdir(xdgConfigHome, { recursive: true }),
  ]);

  const previousEnv = {
    AGENT_HARNESS_HOME: process.env.AGENT_HARNESS_HOME,
    APPDATA: process.env.APPDATA,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
  };
  process.env.AGENT_HARNESS_HOME = homeDirectory;
  process.env.APPDATA = appDataDirectory;
  process.env.XDG_CONFIG_HOME = xdgConfigHome;
  process.env.GITHUB_TOKEN = "test-token";
  delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  clearRuntimeConfigForTests();

  context.after(async () => {
    restoreEnv(previousEnv);
    clearRuntimeConfigForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  const vscodeConfigDirectory =
    process.platform === "win32"
      ? join(appDataDirectory, "Code", "User")
      : process.platform === "darwin"
        ? join(homeDirectory, "Library", "Application Support", "Code", "User")
        : join(xdgConfigHome, "Code", "User");
  await mkdir(vscodeConfigDirectory, { recursive: true });

  const vscodeDiagnostics = await runHostPreflight("copilot-vscode", {
    requireHostPaths: true,
  });
  assert.ok(
    vscodeDiagnostics.some(
      (diagnostic) =>
        diagnostic.code === "vscode-user-settings-directory" &&
        diagnostic.severity === "info",
    ),
  );
  assert.ok(
    vscodeDiagnostics.some(
      (diagnostic) => diagnostic.code === "vscode-native-install-boundary",
    ),
  );

  const opencodeDiagnostics = await runHostPreflight("opencode", {
    requireHostPaths: true,
  });
  assert.ok(
    opencodeDiagnostics.some(
      (diagnostic) =>
        diagnostic.code === "opencode-config-directory" &&
        diagnostic.severity === "error",
    ),
  );
  assert.ok(
    opencodeDiagnostics.some(
      (diagnostic) =>
        diagnostic.code === "opencode-project-overlay" &&
        diagnostic.severity === "info",
    ),
  );
});

void test("preflight diagnostics format cleanly and throw only on errors", () => {
  const diagnostics = [
    {
      severity: "warning",
      code: "warn-code",
      message: "Something needs attention.",
      action: "Do the thing.",
    },
    {
      severity: "error",
      code: "error-code",
      message: "Something failed.",
    },
  ] as const;

  assert.equal(
    formatPreflightDiagnostics(diagnostics as never),
    "[warning] warn-code: Something needs attention. Action: Do the thing.\n[error] error-code: Something failed.",
  );
  assert.doesNotThrow(() => {
    assertNoPreflightErrors([
      { severity: "info", code: "ok", message: "fine" },
    ]);
  });
  assert.throws(
    () => assertNoPreflightErrors(diagnostics as never),
    /\[error\] error-code: Something failed\./u,
  );
});

function restoreEnv(previousEnv: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previousEnv)) {
    restoreMaybeEnv(key, value);
  }
}

function restoreMaybeEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
