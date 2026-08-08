import assert from "node:assert/strict";
import test from "node:test";

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

void test("extension install executor verifies explicit cmd wrapper paths", async () => {
  const wrapperPath = "C:\\Tools\\fake-cli.cmd";
  const calls: Array<{ executable: string; args: string[] }> = [];

  const result = await executeExtensionInstallAction(
    {
      host: "copilot-vscode",
      extensionId: "github.copilot",
      executable: wrapperPath,
      installArgs: [],
      verifyArgs: ["--list-extensions", "--show-versions"],
      removeArgs: [],
      command: wrapperPath,
      verifyCommand: wrapperPath,
      removeCommand: wrapperPath,
    },
    "verify",
    async (executable, args) => {
      calls.push({ executable, args });
      return {
        exitCode: 0,
        stdout: "github.copilot@1.0.0",
        stderr: "",
      };
    },
  );

  assert.equal(result.success, true);
  assert.equal(result.installed, true);
  assert.deepEqual(calls, [
    {
      executable: wrapperPath,
      args: ["--list-extensions", "--show-versions"],
    },
  ]);
});

void test("extension installer internals cover command formatting and native error conversion", () => {
  assert.deepEqual(
    extensionInstallerInternals.buildExecutableCandidates("code", "win32"),
    ["code", "code.cmd", "code.exe", "code.bat"],
  );
  assert.deepEqual(
    extensionInstallerInternals.buildExecutableCandidates("code", "linux"),
    ["code"],
  );
  assert.equal(
    extensionInstallerInternals.formatCommand(
      "C:/Program Files/Code/code.cmd",
      ["--install-extension", "publisher.extension", "--flag=has space"],
    ),
    '"C:/Program Files/Code/code.cmd" --install-extension publisher.extension "--flag=has space"',
  );
  assert.equal(
    extensionInstallerInternals.shouldRunCandidateThroughShell(
      "code.cmd",
      "win32",
    ),
    true,
  );
  assert.equal(
    extensionInstallerInternals.shouldRunCandidateThroughShell(
      "code.bat",
      "win32",
    ),
    true,
  );
  assert.equal(
    extensionInstallerInternals.shouldRunCandidateThroughShell(
      "code.cmd",
      "linux",
    ),
    false,
  );
  assert.equal(
    extensionInstallerInternals.shouldRunCandidateThroughShell("code", "win32"),
    false,
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
  assert.equal(typeof result.stderr, "string");
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

void test("verifyVsCodeExtensionInstalled strips only trailing @version — IDs containing @ are matched correctly", () => {
  // Extension IDs that contain @ in the publisher/name part should NOT be truncated
  // e.g. "@scope/pkg@1.0.0" → match ID "@scope/pkg"
  // Regression: split("@")[0] would yield "" for "@scope/pkg" — matching nothing
  assert.equal(
    verifyVsCodeExtensionInstalled(
      "@scope/my-extension@1.2.3",
      "@scope/my-extension",
    ),
    true,
    "scoped ID with version should match",
  );

  // A plain non-scoped ID still works
  assert.equal(
    verifyVsCodeExtensionInstalled(
      "ms-vscode.cpptools@1.0.0",
      "ms-vscode.cpptools",
    ),
    true,
    "plain ID with version should match",
  );

  // An ID with multiple @ segments: only the last @version suffix is stripped
  assert.equal(
    verifyVsCodeExtensionInstalled(
      "some-publisher.some@pkg@2.0.0",
      "some-publisher.some@pkg",
    ),
    true,
    "ID with internal @ should match after stripping only trailing @version",
  );

  // Non-matching scoped ID
  assert.equal(
    verifyVsCodeExtensionInstalled(
      "@scope/other-extension@1.0.0",
      "@scope/my-extension",
    ),
    false,
    "different scoped ID should not match",
  );

  // Extension without a version suffix
  assert.equal(
    verifyVsCodeExtensionInstalled("ms-python.python", "ms-python.python"),
    true,
    "ID without version should match",
  );

  // Empty output
  assert.equal(
    verifyVsCodeExtensionInstalled("", "github.copilot"),
    false,
    "empty output should not match",
  );
});

void test("buildShellWrapperRefusal fail-closes .cmd wrappers with metacharacter args on every platform (#428)", () => {
  const refusal = extensionInstallerInternals.buildShellWrapperRefusal(
    "code.CMD",
    ["--install-extension", "github.copilot", "a&b"],
    "win32",
  );
  assert.ok(
    refusal !== null,
    "win32 .cmd wrapper + metachar args must be refused",
  );
  assert.equal(refusal?.exitCode, Number.MAX_SAFE_INTEGER);
  assert.match(refusal?.stderr ?? "", /strict VS Code pattern/u);

  assert.equal(
    extensionInstallerInternals.buildShellWrapperRefusal(
      "code.CMD",
      ["--install-extension", "github.copilot"],
      "win32",
    ),
    null,
    "safe literal args on a wrapper pass through",
  );
  assert.equal(
    extensionInstallerInternals.buildShellWrapperRefusal(
      "code",
      ["a&b"],
      "linux",
    ),
    null,
    "non-win32 platforms are not the wrapper class",
  );
});
