import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  patchVsCodeSettings,
  readVsCodeSettings,
} from "../host-adapters/vscode-settings.js";

test("VS Code settings reader tolerates missing files and object JSONC", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-vscode-"));
  const settingsPath = join(root, "Code", "User", "settings.json");

  try {
    assert.deepEqual(await readVsCodeSettings(settingsPath), {});
    await mkdir(join(root, "Code", "User"), { recursive: true });
    await writeFile(
      settingsPath,
      '{\n  // comment\n  "chat.pluginLocations": { "~/existing": true },\n}\n',
      "utf8",
    );

    assert.deepEqual(await readVsCodeSettings(settingsPath), {
      "chat.pluginLocations": { "~/existing": true },
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("VS Code settings patch creates parent directories and preserves JSONC formatting", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-vscode-"));
  const settingsPath = join(root, "Code", "User", "settings.json");

  try {
    await patchVsCodeSettings(settingsPath, {
      "chat.agentFilesLocations": { "~/agent-harness/current/agents": true },
    });

    const settings = await readVsCodeSettings(settingsPath);
    assert.deepEqual(settings, {
      "chat.agentFilesLocations": {
        "~/agent-harness/current/agents": true,
      },
    });
    assert.match(
      await readFile(settingsPath, "utf8"),
      /chat\.agentFilesLocations/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
