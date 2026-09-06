import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  mergeClaudePluginMarketplace,
  resetClaudeCodeNativeHost,
  writeClaudeCodeNativeFiles,
} from "../host-adapters/claude-code-native.js";
import type {
  MaterializedNativeAssets,
  NativeAsset,
} from "../host-adapters/native-utils.js";

void test("Claude Code wire writes a valid local marketplace/plugin tree and reset preserves unrelated entries", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-claude-plugin-"),
  );
  try {
    const marketplacePath = join(
      workspaceRoot,
      ".claude-plugin",
      "marketplace.json",
    );
    await import("../files.js").then(({ writeJsonFile }) =>
      writeJsonFile(marketplacePath, {
        name: "team-tools",
        owner: { name: "Team" },
        plugins: [{ name: "existing", source: "./plugins/existing" }],
      }),
    );

    await writeClaudeCodeNativeFiles({
      workspaceRoot,
      managedRoot: join(workspaceRoot, ".claude", "agent-harness"),
      nativeAssets: [
        nativeAsset("claude.skill", "skill", "Skill body"),
        nativeAsset("claude.agent", "agent", "Agent body"),
        nativeAsset("claude.prompt", "prompt-pack", "Prompt body"),
      ],
      materializedAssets: emptyMaterializedAssets(),
      mcpServers: [],
    });

    const manifest = JSON.parse(
      await readFile(
        join(
          workspaceRoot,
          "plugins",
          "agent-harness",
          ".claude-plugin",
          "plugin.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.equal(manifest.name, "agent-harness");
    assert.equal(manifest.version, "2.1.0");
    assert.deepEqual(manifest.author, { name: "Agent Harness" });
    assert.equal("commands" in manifest, false);
    assert.equal("agents" in manifest, false);
    assert.equal("skills" in manifest, false);

    const marketplace = JSON.parse(await readFile(marketplacePath, "utf8")) as {
      name: string;
      plugins: Array<Record<string, unknown>>;
    };
    assert.equal(marketplace.name, "team-tools");
    assert.deepEqual(
      marketplace.plugins.find((plugin) => plugin.name === "agent-harness"),
      {
        name: "agent-harness",
        source: "./plugins/agent-harness",
        description: "Curated Agent Harness project assets for Claude Code.",
      },
    );
    assert.ok(marketplace.plugins.some((plugin) => plugin.name === "existing"));

    for (const relativePath of [
      ["plugins", "agent-harness", "skills", "agent-harness", "SKILL.md"],
      ["plugins", "agent-harness", "agents", "agent-harness.md"],
      ["plugins", "agent-harness", "commands", "agent-harness.md"],
    ]) {
      assert.ok(
        (await readFile(join(workspaceRoot, ...relativePath), "utf8")).length >
          0,
      );
    }

    await resetClaudeCodeNativeHost(workspaceRoot, undefined);
    await assert.rejects(
      readFile(
        join(
          workspaceRoot,
          "plugins",
          "agent-harness",
          ".claude-plugin",
          "plugin.json",
        ),
        "utf8",
      ),
      { code: "ENOENT" },
    );
    const resetMarketplace = JSON.parse(
      await readFile(marketplacePath, "utf8"),
    ) as { plugins: Array<Record<string, unknown>> };
    assert.deepEqual(resetMarketplace.plugins, [
      { name: "existing", source: "./plugins/existing" },
    ]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Claude marketplace preserves a user-owned same-name plugin on apply and reset", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-claude-marketplace-owner-"),
  );
  try {
    const marketplacePath = join(
      workspaceRoot,
      ".claude-plugin",
      "marketplace.json",
    );
    const userOwnedEntry = {
      name: "agent-harness",
      source: {
        source: "github",
        repo: "example-user/external-agent-harness",
        ref: "v9.9.9",
      },
      description: "User-owned plugin with a colliding public name",
    };
    await import("../files.js").then(({ writeJsonFile }) =>
      writeJsonFile(marketplacePath, {
        name: "team-tools",
        owner: { name: "Team" },
        plugins: [userOwnedEntry],
      }),
    );

    await mergeClaudePluginMarketplace(marketplacePath);
    const merged = JSON.parse(await readFile(marketplacePath, "utf8")) as {
      plugins: Array<Record<string, unknown>>;
    };
    assert.deepEqual(merged.plugins[0], userOwnedEntry);
    assert.ok(
      merged.plugins.some(
        (plugin) =>
          plugin.name === "agent-harness" &&
          plugin.source === "./plugins/agent-harness",
      ),
    );

    await resetClaudeCodeNativeHost(workspaceRoot, undefined);
    const reset = JSON.parse(await readFile(marketplacePath, "utf8")) as {
      plugins: Array<Record<string, unknown>>;
    };
    assert.deepEqual(reset.plugins, [userOwnedEntry]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Claude reset removes a marketplace generated from an empty workspace", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-claude-generated-marketplace-"),
  );
  try {
    const marketplacePath = join(
      workspaceRoot,
      ".claude-plugin",
      "marketplace.json",
    );

    await writeClaudeCodeNativeFiles({
      workspaceRoot,
      managedRoot: join(workspaceRoot, ".claude", "agent-harness"),
      nativeAssets: [nativeAsset("claude.skill", "skill", "Skill body")],
      materializedAssets: emptyMaterializedAssets(),
      mcpServers: [],
    });
    await readFile(marketplacePath, "utf8");

    await resetClaudeCodeNativeHost(workspaceRoot, undefined);
    await assert.rejects(readFile(marketplacePath, "utf8"), {
      code: "ENOENT",
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Claude Code reset tolerates a marketplace with a non-array plugins field", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-claude-plugin-edge-"),
  );
  try {
    const marketplacePath = join(
      workspaceRoot,
      ".claude-plugin",
      "marketplace.json",
    );
    await mkdir(join(workspaceRoot, ".claude-plugin"), { recursive: true });
    await writeFile(
      marketplacePath,
      JSON.stringify({
        name: "team-tools",
        owner: { name: "Team" },
        plugins: "not-an-array",
      }),
      "utf8",
    );

    await resetClaudeCodeNativeHost(workspaceRoot, undefined);
    const resetMarketplace = JSON.parse(
      await readFile(marketplacePath, "utf8"),
    ) as { plugins: unknown[] };
    assert.deepEqual(resetMarketplace.plugins, []);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Claude Code reset preserves an unmarked same-name plugin directory", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-claude-plugin-owned-"),
  );
  try {
    const userFile = join(
      workspaceRoot,
      "plugins",
      "agent-harness",
      "user-owned.md",
    );
    await mkdir(join(workspaceRoot, "plugins", "agent-harness"), {
      recursive: true,
    });
    await writeFile(userFile, "user content\n", "utf8");
    await resetClaudeCodeNativeHost(workspaceRoot, undefined);
    assert.equal(await readFile(userFile, "utf8"), "user content\n");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Claude Code write refuses to claim a pre-existing unmarked plugin directory", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-claude-claim-guard-"),
  );
  try {
    // A user-owned plugin directory that already exists WITHOUT our marker is
    // a collision, not an adoptable directory (review thread ...bbJOF).
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(
      join(pluginRoot, "user-owned.md"),
      "user content\n",
      "utf8",
    );

    await assert.rejects(
      writeClaudeCodeNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".claude", "agent-harness"),
        nativeAssets: [nativeAsset("claude.agent", "agent", "Agent body")],
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      }),
      /Refusing to claim existing unmarked agent-harness plugin directory/u,
    );
    // The user's directory and its content are untouched.
    assert.equal(
      await readFile(join(pluginRoot, "user-owned.md"), "utf8"),
      "user content\n",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

function nativeAsset(
  assetId: string,
  assetKind: "skill" | "agent" | "prompt-pack",
  content: string,
): NativeAsset {
  return {
    assetId,
    assetKind,
    displayName: assetId,
    compatibilityMode: "native",
    content,
  };
}

function emptyMaterializedAssets(): MaterializedNativeAssets {
  return {
    instructionFiles: [],
    agentFiles: [],
    skillDirs: [],
    pluginDirs: [],
    hookFiles: [],
    hookContentPathByAssetId: {},
    workflowFiles: [],
    referenceFiles: [],
    extensionIds: [],
    mcpServers: [],
  };
}
