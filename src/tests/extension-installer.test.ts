import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeTextFile } from "../files.js";

import {
  buildExtensionInstallActions,
  buildVsCodeExtensionInstallActions,
  executeExtensionInstallAction,
  extensionInstallerInternals,
  formatExtensionInstallActions,
  verifyExtensionInstallAction,
  verifyVsCodeExtensionInstalled,
  type NativeCommandExecutor,
} from "../host-adapters/extension-installer.js";

void test("VS Code extension actions use executable and arg arrays", () => {
  const actions = buildVsCodeExtensionInstallActions([
    "github.copilot",
    "not-a-valid-extension-id",
  ]);

  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.executable, "code");
  assert.deepEqual(actions[0]?.installArgs, [
    "--install-extension",
    "github.copilot",
  ]);
  assert.deepEqual(actions[0]?.removeArgs, [
    "--uninstall-extension",
    "github.copilot",
  ]);
  assert.equal(actions[0]?.command, "code --install-extension github.copilot");
});

void test("generic extension actions can target Cursor-compatible CLIs", () => {
  const [action] = buildExtensionInstallActions({
    executable: "cursor",
    host: "cursor",
    extensionIds: ["github.copilot"],
  });

  assert.ok(action);
  assert.equal(action.executable, "cursor");
  assert.equal(action.host, "cursor");
  assert.equal(action.command, "cursor --install-extension github.copilot");
});

void test("extension install action formatter quotes executables and args that contain spaces", () => {
  const [formattedAction] = buildExtensionInstallActions({
    executable: "C:/Program Files/Cursor/cursor.cmd",
    host: "cursor",
    extensionIds: ["github.copilot"],
  });

  assert.deepEqual(formatExtensionInstallActions([formattedAction!]), [
    'cursor:github.copilot install="\\"C:/Program Files/Cursor/cursor.cmd\\" --install-extension github.copilot" verify="\\"C:/Program Files/Cursor/cursor.cmd\\" --list-extensions --show-versions" remove="\\"C:/Program Files/Cursor/cursor.cmd\\" --uninstall-extension github.copilot"',
  ]);
});

void test("VS Code extension verification parses versioned output case-insensitively", () => {
  assert.equal(
    verifyVsCodeExtensionInstalled(
      "GitHub.Copilot@1.2.3\nms-python.python@2025.1.0",
      "github.copilot",
    ),
    true,
  );
  assert.equal(
    verifyVsCodeExtensionInstalled(
      "ms-python.python@2025.1.0",
      "github.copilot",
    ),
    false,
  );
  assert.equal(
    verifyVsCodeExtensionInstalled(
      "\n  \nGitHub.Copilot@1.2.3",
      "github.copilot",
    ),
    true,
  );
});

void test("extension install executor installs, verifies, and removes without shell commands", async () => {
  const [action] = buildVsCodeExtensionInstallActions(["github.copilot"]);
  assert.ok(action);

  let installed = false;
  const calls: string[][] = [];
  const executor: NativeCommandExecutor = async (executable, args) => {
    calls.push([executable, ...args]);
    if (args[0] === "--install-extension") {
      installed = true;
      return { exitCode: 0, stdout: "installed", stderr: "" };
    }
    if (args[0] === "--uninstall-extension") {
      installed = false;
      return { exitCode: 0, stdout: "removed", stderr: "" };
    }
    return {
      exitCode: 0,
      stdout: installed ? "github.copilot@1.0.0" : "",
      stderr: "",
    };
  };

  const installResult = await executeExtensionInstallAction(
    action,
    "install",
    executor,
  );
  assert.equal(installResult.success, true);
  assert.equal(installResult.installed, true);

  const removeResult = await executeExtensionInstallAction(
    action,
    "remove",
    executor,
  );
  assert.equal(removeResult.success, true);
  assert.equal(removeResult.installed, false);
  assert.deepEqual(calls[0], ["code", "--install-extension", "github.copilot"]);
  assert.deepEqual(calls.at(-2), [
    "code",
    "--uninstall-extension",
    "github.copilot",
  ]);
});

void test("extension install executor surfaces command failures before verification", async () => {
  const [action] = buildVsCodeExtensionInstallActions(["github.copilot"]);
  assert.ok(action);

  const installResult = await executeExtensionInstallAction(
    action,
    "install",
    async () => ({ exitCode: 17, stdout: "", stderr: "boom" }),
  );

  assert.equal(installResult.success, false);
  assert.equal(installResult.installed, false);
  assert.equal(installResult.exitCode, 17);
  assert.match(installResult.message, /install command failed/u);
});

void test("extension verification handles expected absence and mismatches", async () => {
  const [action] = buildVsCodeExtensionInstallActions(["github.copilot"]);
  assert.ok(action);

  const absentResult = await verifyExtensionInstallAction(
    action,
    async () => ({ exitCode: 0, stdout: "ms-python.python@1.0.0", stderr: "" }),
    false,
  );
  assert.equal(absentResult.success, true);
  assert.equal(absentResult.installed, false);
  assert.match(absentResult.message, /not installed/u);

  const mismatchResult = await verifyExtensionInstallAction(
    action,
    async () => ({ exitCode: 0, stdout: "github.copilot@1.0.0", stderr: "" }),
    false,
  );
  assert.equal(mismatchResult.success, false);
  assert.equal(mismatchResult.installed, true);
  assert.match(mismatchResult.message, /expected absent/u);
});

void test("extension install executor can use the default native command runner with node", async () => {
  const action = {
    host: "copilot-vscode",
    extensionId: "github.copilot",
    executable: "node",
    installArgs: ["-e", "process.stdout.write('installed')"],
    verifyArgs: ["-e", "process.stdout.write('github.copilot@1.0.0')"],
    removeArgs: ["-e", "process.stdout.write('removed')"],
    command: "node -e install",
    verifyCommand: "node -e verify",
    removeCommand: "node -e remove",
  };

  const result = await executeExtensionInstallAction(action, "install");

  assert.equal(result.success, true);
  assert.equal(result.installed, true);
  assert.match(result.stdout, /github\.copilot@1\.0\.0/u);
});

void test("extension install executor runs cmd wrappers through the shell when needed", async () => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-extension-installer-"),
  );
  const wrapperPath = join(tempRoot, "fake-cli.cmd");

  try {
    await writeTextFile(
      wrapperPath,
      "@echo off\r\necho github.copilot@1.0.0\r\n",
    );

    const result = await executeExtensionInstallAction(
      {
        host: "copilot-vscode",
        extensionId: "github.copilot",
        executable: wrapperPath,
        installArgs: [],
        verifyArgs: [],
        removeArgs: [],
        command: wrapperPath,
        verifyCommand: wrapperPath,
        removeCommand: wrapperPath,
      },
      "verify",
    );

    assert.equal(result.success, true);
    assert.equal(result.installed, true);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test("extension installer internals cover command formatting and native error conversion", () => {
  assert.deepEqual(
    extensionInstallerInternals.buildExecutableCandidates("code"),
    process.platform === "win32"
      ? ["code", "code.cmd", "code.exe", "code.bat"]
      : ["code"],
  );
  assert.equal(
    extensionInstallerInternals.formatCommand(
      "C:/Program Files/Code/code.cmd",
      ["--install-extension", "publisher.extension", "--flag=has space"],
    ),
    '"C:/Program Files/Code/code.cmd" --install-extension publisher.extension "--flag=has space"',
  );
  assert.equal(
    extensionInstallerInternals.shouldRunCandidateThroughShell("code.cmd"),
    process.platform === "win32",
  );
  assert.deepEqual(
    extensionInstallerInternals.toNativeCommandResult({ code: 7 }),
    { exitCode: 7, stdout: "", stderr: "[object Object]" },
  );
  assert.deepEqual(
    extensionInstallerInternals.toNativeCommandResult(
      new Error("plain failure"),
    ),
    { exitCode: Number.MAX_SAFE_INTEGER, stdout: "", stderr: "plain failure" },
  );
});

void test("extension install executor reports missing executables from the default runner", async () => {
  const result = await executeExtensionInstallAction(
    {
      host: "copilot-vscode",
      extensionId: "github.copilot",
      executable: "definitely-missing-agent-harness-cli",
      installArgs: [],
      verifyArgs: [],
      removeArgs: [],
      command: "missing",
      verifyCommand: "missing",
      removeCommand: "missing",
    },
    "verify",
  );

  assert.equal(result.success, false);
  assert.equal(result.installed, false);
  assert.ok(result.exitCode >= 1);
  assert.match(result.stderr, /ENOENT|not recognized/u);
});

void test("extension install executor exhausts explicit executable candidates before returning ENOENT", async () => {
  const result = await executeExtensionInstallAction(
    {
      host: "copilot-vscode",
      extensionId: "github.copilot",
      executable: "definitely-missing-agent-harness-cli.exe",
      installArgs: [],
      verifyArgs: [],
      removeArgs: [],
      command: "missing.exe",
      verifyCommand: "missing.exe",
      removeCommand: "missing.exe",
    },
    "verify",
  );

  assert.equal(result.success, false);
  assert.equal(result.installed, false);
  assert.equal(result.exitCode, Number.MAX_SAFE_INTEGER);
  assert.equal(typeof result.stderr, "string");
});
