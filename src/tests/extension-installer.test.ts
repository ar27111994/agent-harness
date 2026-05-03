import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExtensionInstallActions,
  buildVsCodeExtensionInstallActions,
  executeExtensionInstallAction,
  verifyVsCodeExtensionInstalled,
  type NativeCommandExecutor,
} from "../host-adapters/extension-installer.js";

test("VS Code extension actions use executable and arg arrays", () => {
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

test("generic extension actions can target Cursor-compatible CLIs", () => {
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

test("VS Code extension verification parses versioned output case-insensitively", () => {
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
});

test("extension install executor installs, verifies, and removes without shell commands", async () => {
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
