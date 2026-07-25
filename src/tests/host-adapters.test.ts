import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  resolveHostAdapter,
  type HostAdapter,
} from "../host-adapters/registry.js";
import { sanitizeAssetId } from "../lib/safe-paths.js";
import type {
  AssetCatalogEntry,
  AssetKind,
  WirePlanManifest,
  WirePreviewManifest,
} from "../types.js";

const NATIVE_HOSTS = ["cursor", "zed", "claude-code", "pi", "codex"] as const;
const ALL_ASSET_KINDS = [
  "agent",
  "skill",
  "instruction",
  "workflow",
  "hook",
  "plugin",
  "mcp-server",
  "extension",
  "prompt-pack",
  "reference-pack",
] as const satisfies readonly AssetKind[];

void test("native host adapters are registered with expected lifecycle hosts", () => {
  const cursorAdapter = resolveHostAdapter("cursor");
  assert.equal(cursorAdapter?.lifecycleHost, "copilot-vscode");
  assert.equal(cursorAdapter?.recommendationHost, "cursor");
  assert.equal(cursorAdapter?.nativeInstall?.assetKind, "extension");
  assert.ok(
    cursorAdapter?.capabilities.some(
      (capability) => capability.assetKind === "prompt-pack",
    ),
  );
  assert.ok(
    cursorAdapter?.capabilities.some(
      (capability) => capability.assetKind === "reference-pack",
    ),
  );
  assertWireCapabilities(cursorAdapter, ALL_ASSET_KINDS);
  assert.ok(
    cursorAdapter?.capabilities
      .find((capability) => capability.assetKind === "extension")
      ?.behaviors.includes("native-install"),
  );

  const zedAdapter = resolveHostAdapter("zed");
  assert.equal(zedAdapter?.lifecycleHost, "opencode");
  assert.equal(zedAdapter?.recommendationHost, "zed");
  assertWireCapabilities(zedAdapter, ALL_ASSET_KINDS);
  assert.equal(resolveHostAdapter("claude")?.id, "claude-code");
  assert.equal(resolveHostAdapter("claudecode")?.id, "claude-code");
  assert.equal(resolveHostAdapter("pi-coding-agent")?.id, "pi");
  assert.equal(resolveHostAdapter("openai-codex")?.id, "codex");
  assert.equal(resolveHostAdapter("codex-app")?.id, "codex");

  const vscodeAdapter = resolveHostAdapter("vscode");
  assert.ok(vscodeAdapter);
  assert.equal(vscodeAdapter.runtime?.executable, "code");
  assert.equal(vscodeAdapter.nativeInstall?.assetKind, "extension");
  assert.ok(
    vscodeAdapter.capabilities.some(
      (capability) => capability.assetKind === "prompt-pack",
    ),
    "copilot-vscode adapter must support prompt-pack (#344)",
  );
  assert.ok(
    vscodeAdapter.capabilities.some(
      (capability) => capability.assetKind === "reference-pack",
    ),
    "copilot-vscode adapter must support reference-pack (#344)",
  );
  assert.ok(
    vscodeAdapter.capabilities
      .find((capability) => capability.assetKind === "extension")
      ?.behaviors.includes("native-install"),
  );

  const claudeCodeAdapter = resolveHostAdapter("claude");
  assert.equal(claudeCodeAdapter?.recommendationHost, "claude-code");
  assertWireCapabilities(claudeCodeAdapter, ALL_ASSET_KINDS);

  const opencodeAdapter = resolveHostAdapter("opencode");
  assertWireCapabilities(opencodeAdapter, ALL_ASSET_KINDS);
  assert.ok(
    opencodeAdapter?.capabilities.some(
      (capability) => capability.assetKind === "payable-api",
    ),
    "OpenCode adapter must support payable-api (#345)",
  );
  assert.ok(
    opencodeAdapter?.capabilities.some(
      (capability) => capability.assetKind === "acp-agent",
    ),
    "OpenCode adapter must support acp-agent (#345)",
  );

  const piAdapter = resolveHostAdapter("pi");
  assert.ok(piAdapter);
  assert.equal(piAdapter.recommendationHost, "pi");
  assertWireCapabilities(piAdapter, ALL_ASSET_KINDS);

  const codexAdapter = resolveHostAdapter("codex");
  assert.ok(codexAdapter);
  assert.equal(codexAdapter.lifecycleHost, "opencode");
  assert.equal(codexAdapter.recommendationHost, "codex");
  assert.deepEqual(codexAdapter.defaultBundleIds, [
    "opencode-global",
    "community-stable",
    "shared-mcp",
  ]);
  assertWireCapabilities(codexAdapter, ALL_ASSET_KINDS);
});

void test("OpenCode adapter upserts and resets only the managed AGENTS section", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-opencode-"));
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-workspace-"),
  );
  const agentsPath = join(workspaceRoot, "AGENTS.md");

  try {
    await writeFile(agentsPath, "# Existing guidance\n\nKeep this.\n", "utf8");
    const adapter = resolveHostAdapter("opencode");
    assert.ok(adapter);

    await adapter.wire({ projectRoot, workspaceRoot, mode: "apply" });
    const appliedContent = await readFile(agentsPath, "utf8");
    assert.match(appliedContent, /Keep this\./u);
    assert.match(appliedContent, /agent-harness:begin/u);

    await adapter.wire({ projectRoot, workspaceRoot, mode: "reset" });
    const resetContent = await readFile(agentsPath, "utf8");
    assert.match(resetContent, /Keep this\./u);
    assert.doesNotMatch(resetContent, /agent-harness:begin/u);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

void test("OpenCode wire treats extensions as native when catalog metadata is unavailable", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-opencode-"));
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-workspace-"),
  );

  try {
    const selectedAssets = [buildAsset("ms-python.python", "extension")];
    await writeOpenCodeActivation(projectRoot, selectedAssets);
    await writeOpenCodeInstallBundle(projectRoot, selectedAssets);
    await rm(
      join(
        projectRoot,
        "activate",
        "opencode",
        sanitizeAssetId("ms-python.python"),
        "asset.json",
      ),
      { force: true },
    );
    await rm(
      join(
        projectRoot,
        "activate",
        "opencode",
        sanitizeAssetId("ms-python.python"),
        "content.txt",
      ),
      { force: true },
    );

    const adapter = resolveHostAdapter("opencode");
    assert.ok(adapter);
    await adapter.wire({ projectRoot, workspaceRoot, mode: "apply" });

    await assertPathExists(
      join(
        workspaceRoot,
        ".opencode",
        "context",
        "project-intelligence",
        "agent-harness",
        "extensions",
        sanitizeAssetId("ms-python.python"),
      ),
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

void test("OpenCode wire projects reference-only plugin and MCP assets as files", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-opencode-"));
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-workspace-"),
  );

  try {
    const selectedAssets = buildAllAssetFixtures().map((asset) =>
      asset.assetKind === "plugin" || asset.assetKind === "mcp-server"
        ? { ...asset, compatibilityMode: "reference-only" as const }
        : asset,
    );
    await writeOpenCodeActivation(projectRoot, selectedAssets);
    await writeOpenCodeInstallBundle(projectRoot, selectedAssets);

    const adapter = resolveHostAdapter("opencode");
    assert.ok(adapter);
    const assetAgentsRoot = join(
      projectRoot,
      "activate",
      "opencode",
      sanitizeAssetId("asset-agent"),
    );
    await rename(
      assetAgentsRoot,
      join(
        projectRoot,
        "activate",
        "opencode",
        sanitizeAssetId("asset-agent-renamed"),
      ),
    );

    await adapter.wire({ projectRoot, workspaceRoot, mode: "apply" });

    const localOverlayRoot = join(workspaceRoot, ".opencode");
    const wirePlan = JSON.parse(
      await readFile(
        join(
          localOverlayRoot,
          "context",
          "project-intelligence",
          "agent-harness",
          "wire-plan.json",
        ),
        "utf8",
      ),
    ) as WirePlanManifest;
    assert.equal(wirePlan.host, "opencode-project");

    const managedContextRoot = join(
      localOverlayRoot,
      "context",
      "project-intelligence",
      "agent-harness",
    );
    await assertPathExists(
      join(
        managedContextRoot,
        "instructions",
        `${sanitizeAssetId("asset-instruction")}.md`,
      ),
    );
    await assertPathExists(
      join(
        managedContextRoot,
        "extensions",
        sanitizeAssetId("ms-python.python"),
      ),
    );
    await assertPathExists(
      join(localOverlayRoot, "skills", sanitizeAssetId("asset-skill")),
    );
    await assertPathExists(
      join(
        managedContextRoot,
        "plugin-references",
        `${sanitizeAssetId("asset-plugin")}.md`,
      ),
    );
    await assertPathExists(
      join(managedContextRoot, "hooks", sanitizeAssetId("asset-hook")),
    );
    await assertPathExists(
      join(
        managedContextRoot,
        "reference-packs",
        `${sanitizeAssetId("asset-reference")}.md`,
      ),
    );
    await assertPathExists(
      join(
        managedContextRoot,
        "mcp-references",
        `${sanitizeAssetId("asset-mcp")}.md`,
      ),
    );
    await assertPathExists(
      join(
        managedContextRoot,
        "extensions",
        sanitizeAssetId("ms-python.python"),
      ),
    );
    assert.equal(wirePlan.mcpServers?.includes("asset-mcp"), false);
    await assertPathExists(
      join(
        localOverlayRoot,
        "commands",
        `${sanitizeAssetId("asset-workflow")}.md`,
      ),
    );
    await assertPathExists(
      join(
        localOverlayRoot,
        "commands",
        `${sanitizeAssetId("asset-prompt-pack")}.md`,
      ),
    );

    const managedAgents = await readFile(
      join(workspaceRoot, "AGENTS.md"),
      "utf8",
    );
    assert.match(managedAgents, /agent-harness:begin/u);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

void test("Cursor native wire plan exposes supported staged asset buckets", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-cursor-wire-"),
  );
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-workspace-"),
  );

  try {
    const activationRoot = join(projectRoot, "activate", "copilot-vscode");
    const yamlSensitiveDisplayName = 'YAML: "quoted"\n# heading';
    const selectedAssets = buildAllAssetFixtures().map((asset) =>
      asset.id === "asset-instruction"
        ? { ...asset, displayName: yamlSensitiveDisplayName }
        : asset,
    );

    await writeJson(join(activationRoot, "workspace-profile-manifest.json"), {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      profileId: "cursor-test-profile",
      workspaceRoot,
      bundleIds: [],
      selectedAssetIds: selectedAssets.map((asset) => asset.id),
      selectedInstructionIds: [],
      selectedAgentIds: [],
      selectedWorkflowIds: [],
      selectedPluginIds: [],
      selectedExtensionIds: [],
      selectedHookIds: [],
      selectedSkillIds: [],
      activationBudget: 100,
    });
    for (const asset of selectedAssets) {
      await writeActivationAsset(activationRoot, asset);
    }

    const adapter = resolveHostAdapter("cursor");
    assert.ok(adapter);
    await adapter.wire({ projectRoot, workspaceRoot, mode: "apply" });

    const plan = JSON.parse(
      await readFile(
        join(projectRoot, "activate", "cursor", "wire-plan.json"),
        "utf8",
      ),
    ) as WirePlanManifest;
    assertCompleteNativeWirePlan(plan);
    assert.ok(
      plan.nativeInstallActions?.some((action) =>
        action.includes("--install-extension ms-python.python"),
      ),
    );

    const pluginManifest = JSON.parse(
      await readFile(
        join(
          workspaceRoot,
          ".cursor",
          "agent-harness",
          "cursor-plugin",
          ".cursor-plugin",
          "plugin.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.equal(pluginManifest.agents, "./agents");
    assert.equal(pluginManifest.skills, "./skills");
    assert.equal(pluginManifest.commands, "./commands");

    const cursorRuleAsset = await readFile(
      join(
        workspaceRoot,
        ".cursor",
        "agent-harness",
        "cursor-plugin",
        "rules",
        `${sanitizeAssetId("asset-instruction")}.mdc`,
      ),
      "utf8",
    );
    assert.ok(
      cursorRuleAsset.includes(
        `description: ${JSON.stringify(yamlSensitiveDisplayName)}`,
      ),
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

void test("OpenCode-compatible native wire plans keep reference-only runnable assets as references", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-native-wire-"),
  );
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-workspace-"),
  );

  try {
    const selectedAssets = buildAllAssetFixtures().map((asset) =>
      asset.assetKind === "plugin" ||
      asset.assetKind === "mcp-server" ||
      asset.assetKind === "extension"
        ? { ...asset, compatibilityMode: "reference-only" as const }
        : asset,
    );
    await writeOpenCodeActivation(projectRoot, selectedAssets);

    for (const host of ["zed", "claude-code", "pi"] as const) {
      const adapter = resolveHostAdapter(host);
      assert.ok(adapter);
      await adapter.wire({ projectRoot, workspaceRoot, mode: "apply" });

      const plan = JSON.parse(
        await readFile(
          join(projectRoot, "activate", host, "wire-plan.json"),
          "utf8",
        ),
      ) as WirePlanManifest;
      assertCompleteNativeWirePlan(plan, {
        pluginRunnable: false,
        mcpRunnable: false,
        extensionRunnable: false,
      });
    }
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

void test("Pi wire updates documented top-level settings arrays and cleans legacy config", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-pi-wire-"));
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-workspace-"),
  );

  try {
    await writeOpenCodeActivation(projectRoot, buildAllAssetFixtures());
    await writeJson(join(workspaceRoot, ".pi", "settings.json"), {
      skills: ["skills/custom-skill"],
      prompts: ["prompts/custom.md"],
      agentHarness: {
        skills: ["skills/legacy-agent-harness"],
        prompts: ["prompts/legacy-agent-harness.md"],
      },
    });

    const adapter = resolveHostAdapter("pi");
    assert.ok(adapter);
    await adapter.wire({ projectRoot, workspaceRoot, mode: "apply" });

    const appliedSettings = JSON.parse(
      await readFile(join(workspaceRoot, ".pi", "settings.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.deepEqual(appliedSettings.skills, [
      "skills/custom-skill",
      "skills/agent-harness",
    ]);
    assert.deepEqual(appliedSettings.prompts, [
      "prompts/custom.md",
      "prompts/agent-harness.md",
    ]);
    assert.equal("agentHarness" in appliedSettings, false);

    await adapter.wire({ projectRoot, workspaceRoot, mode: "reset" });

    const resetSettings = JSON.parse(
      await readFile(join(workspaceRoot, ".pi", "settings.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.deepEqual(resetSettings.skills, ["skills/custom-skill"]);
    assert.deepEqual(resetSettings.prompts, ["prompts/custom.md"]);
    assert.equal("agentHarness" in resetSettings, false);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

void test("native adapters write host-specific project files and wire plans", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-hosts-"));
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-workspace-"),
  );

  try {
    for (const host of NATIVE_HOSTS) {
      const adapter = resolveHostAdapter(host);
      assert.ok(adapter);

      await adapter.wire({ projectRoot, workspaceRoot, mode: "apply" });

      const activationRoot = join(projectRoot, "activate", host);
      const preview = JSON.parse(
        await readFile(
          join(activationRoot, `wire-preview-${host}.json`),
          "utf8",
        ),
      ) as WirePreviewManifest;
      const plan = JSON.parse(
        await readFile(join(activationRoot, "wire-plan.json"), "utf8"),
      ) as WirePlanManifest;

      assert.equal(plan.host, host);
      assert.equal(preview.host, host === "cursor" ? "vscode" : "opencode");
      assert.equal(preview.mode, "apply");
      assert.ok(plan.nativeInstallActions?.length);
      await assertNativeHostFile(host, workspaceRoot);
      await assertNativeHostExtras(host, workspaceRoot);

      await adapter.wire({ projectRoot, workspaceRoot, mode: "reset" });
      await assert.rejects(
        readFile(join(activationRoot, "wire-plan.json"), "utf8"),
        { code: "ENOENT" },
      );
    }
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

void test("native reset restores pre-existing managed text files byte-for-byte", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-hosts-"));
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-workspace-"),
  );
  const zedRulesContent = "# Existing Zed rules\n\nKeep this.\n";
  const rootClaudeContent = "# Existing Claude\n\nKeep this.\n";
  const nestedClaudeContent = "# Existing nested Claude\n\nKeep this too.\n";
  const agentsContent = "# Existing agents\n\nKeep this.\n";
  const systemContent = "# Existing system\n\nKeep this too.\n";

  try {
    await writeFile(join(workspaceRoot, ".rules"), zedRulesContent, "utf8");
    await mkdir(join(workspaceRoot, ".claude"), { recursive: true });
    await writeFile(
      join(workspaceRoot, "CLAUDE.md"),
      rootClaudeContent,
      "utf8",
    );
    await writeFile(
      join(workspaceRoot, ".claude", "CLAUDE.md"),
      nestedClaudeContent,
      "utf8",
    );
    await writeFile(join(workspaceRoot, "AGENTS.md"), agentsContent, "utf8");
    await writeFile(join(workspaceRoot, "SYSTEM.md"), systemContent, "utf8");

    for (const host of ["zed", "claude-code", "pi"] as const) {
      const adapter = resolveHostAdapter(host);
      assert.ok(adapter);
      await adapter.wire({ projectRoot, workspaceRoot, mode: "apply" });
      await adapter.wire({ projectRoot, workspaceRoot, mode: "reset" });
    }

    assert.equal(
      await readFile(join(workspaceRoot, ".rules"), "utf8"),
      zedRulesContent,
    );
    assert.equal(
      await readFile(join(workspaceRoot, "CLAUDE.md"), "utf8"),
      rootClaudeContent,
    );
    assert.equal(
      await readFile(join(workspaceRoot, ".claude", "CLAUDE.md"), "utf8"),
      nestedClaudeContent,
    );
    assert.equal(
      await readFile(join(workspaceRoot, "AGENTS.md"), "utf8"),
      agentsContent,
    );
    assert.equal(
      await readFile(join(workspaceRoot, "SYSTEM.md"), "utf8"),
      systemContent,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

void test("OpenCode synthesizes structured native config payloads and removes them on reset", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-opencode-native-"),
  );
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-workspace-"),
  );

  try {
    const assets = [
      buildAsset("asset-instruction", "instruction"),
      buildAsset("opencode-native", "mcp-server", {
        hostNativeConfig: {
          opencode: {
            files: [
              {
                path: "opencode.json",
                format: "json",
                merge: true,
                content: {
                  mcp: {
                    "agent-harness-test": {
                      command: "node",
                      args: ["server.js"],
                    },
                  },
                },
              },
              {
                path: ".opencode/tools/agent-harness/test-tool.json",
                format: "json",
                content: {
                  name: "test-tool",
                  command: "node",
                },
              },
            ],
          },
        },
      }),
    ];

    await writeOpenCodeActivation(projectRoot, assets);
    await writeOpenCodeInstallBundle(projectRoot, assets);
    await writeJson(join(workspaceRoot, "opencode.json"), {
      telemetry: false,
    });

    const adapter = resolveHostAdapter("opencode");
    assert.ok(adapter);
    await adapter.wire({ projectRoot, workspaceRoot, mode: "apply" });

    const opencodeConfig = JSON.parse(
      await readFile(join(workspaceRoot, "opencode.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.ok(Array.isArray(opencodeConfig.instructions));
    assert.ok(
      (opencodeConfig.instructions as string[]).some((entry) =>
        entry.includes("asset-instruction"),
      ),
    );
    assert.deepEqual(opencodeConfig.mcp, {
      "agent-harness-test": {
        command: "node",
        args: ["server.js"],
      },
    });

    const toolManifest = JSON.parse(
      await readFile(
        join(
          workspaceRoot,
          ".opencode",
          "tools",
          "agent-harness",
          "test-tool.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.equal(toolManifest.name, "test-tool");

    await adapter.wire({ projectRoot, workspaceRoot, mode: "reset" });

    const restoredOpenCodeConfig = JSON.parse(
      await readFile(join(workspaceRoot, "opencode.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.deepEqual(restoredOpenCodeConfig, {
      telemetry: false,
    });
    await assert.rejects(
      readFile(
        join(
          workspaceRoot,
          ".opencode",
          "tools",
          "agent-harness",
          "test-tool.json",
        ),
        "utf8",
      ),
      { code: "ENOENT" },
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

void test("native adapters synthesize structured host config surfaces and reset them", async () => {
  const cursorProjectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-cursor-native-"),
  );
  const cursorWorkspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-workspace-"),
  );
  const sharedProjectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-native-shared-"),
  );
  const sharedWorkspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-workspace-"),
  );

  try {
    const cursorAssets = [
      buildAsset("cursor-agent", "agent", {
        hostNativeConfig: {
          cursor: {
            files: [
              {
                path: ".cursor/mcp.json",
                format: "json",
                merge: true,
                content: {
                  mcpServers: {
                    "agent-harness-cursor": {
                      command: "node",
                      args: ["cursor-mcp.js"],
                    },
                  },
                },
              },
              {
                path: ".cursor/hooks.json",
                format: "json",
                merge: true,
                content: {
                  hooks: [
                    {
                      event: "afterSave",
                      command: ".cursor/hooks/agent-harness/test.sh",
                    },
                  ],
                },
              },
              {
                path: ".cursor/hooks/agent-harness/test.sh",
                format: "text",
                content: "echo cursor\n",
              },
            ],
          },
        },
      }),
    ];

    const cursorActivationRoot = join(
      cursorProjectRoot,
      "activate",
      "copilot-vscode",
    );
    await writeJson(
      join(cursorActivationRoot, "workspace-profile-manifest.json"),
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        profileId: "cursor-native-profile",
        workspaceRoot: cursorWorkspaceRoot,
        bundleIds: [],
        selectedAssetIds: cursorAssets.map((asset) => asset.id),
        selectedInstructionIds: [],
        selectedAgentIds: cursorAssets.map((asset) => asset.id),
        selectedWorkflowIds: [],
        selectedPluginIds: [],
        selectedExtensionIds: [],
        selectedHookIds: [],
        selectedSkillIds: [],
        activationBudget: 100,
      },
    );
    for (const asset of cursorAssets) {
      await writeActivationAsset(cursorActivationRoot, asset);
    }

    const cursorAdapter = resolveHostAdapter("cursor");
    assert.ok(cursorAdapter);
    await cursorAdapter.wire({
      projectRoot: cursorProjectRoot,
      workspaceRoot: cursorWorkspaceRoot,
      mode: "apply",
    });

    const cursorMcp = JSON.parse(
      await readFile(join(cursorWorkspaceRoot, ".cursor", "mcp.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.deepEqual(cursorMcp.mcpServers, {
      "agent-harness-cursor": {
        command: "node",
        args: ["cursor-mcp.js"],
      },
    });
    await assertPathExists(
      join(cursorWorkspaceRoot, ".cursor", "hooks", "agent-harness", "test.sh"),
    );
    await assertPathExists(
      join(
        cursorWorkspaceRoot,
        ".cursor",
        "agents",
        "agent-harness",
        `${sanitizeAssetId("cursor-agent")}.md`,
      ),
    );

    await cursorAdapter.wire({
      projectRoot: cursorProjectRoot,
      workspaceRoot: cursorWorkspaceRoot,
      mode: "reset",
    });
    await assert.rejects(
      readFile(join(cursorWorkspaceRoot, ".cursor", "mcp.json"), "utf8"),
      { code: "ENOENT" },
    );
    await assert.rejects(
      readFile(
        join(
          cursorWorkspaceRoot,
          ".cursor",
          "agents",
          "agent-harness",
          `${sanitizeAssetId("cursor-agent")}.md`,
        ),
        "utf8",
      ),
      { code: "ENOENT" },
    );

    const sharedAssets = [
      buildAsset("zed-native", "mcp-server", {
        hostNativeConfig: {
          zed: {
            files: [
              {
                path: ".zed/settings.json",
                format: "json",
                merge: true,
                content: {
                  context_servers: {
                    "agent-harness-zed": {
                      command: "node",
                      args: ["zed-mcp.js"],
                    },
                  },
                },
              },
            ],
          },
        },
      }),
      buildAsset("claude-native", "mcp-server", {
        hostNativeConfig: {
          "claude-code": {
            files: [
              {
                path: ".mcp.json",
                format: "json",
                merge: true,
                content: {
                  mcpServers: {
                    "agent-harness-claude": {
                      command: "node",
                      args: ["claude-mcp.js"],
                    },
                  },
                },
              },
              {
                path: ".claude/settings.local.json",
                format: "json",
                merge: true,
                content: {
                  hooks: {
                    PostToolUse: ["echo claude"],
                  },
                },
              },
            ],
          },
        },
      }),
      buildAsset("pi-native", "plugin", {
        hostNativeConfig: {
          pi: {
            files: [
              {
                path: ".pi/extensions/agent-harness/test-extension.json",
                format: "json",
                content: {
                  name: "test-extension",
                },
              },
              {
                path: ".pi/packages/agent-harness/test-package.json",
                format: "json",
                content: {
                  name: "test-package",
                },
              },
            ],
          },
        },
      }),
    ];

    await writeOpenCodeActivation(sharedProjectRoot, sharedAssets);

    const zedAdapter = resolveHostAdapter("zed");
    assert.ok(zedAdapter);
    await zedAdapter.wire({
      projectRoot: sharedProjectRoot,
      workspaceRoot: sharedWorkspaceRoot,
      mode: "apply",
    });
    const zedSettings = JSON.parse(
      await readFile(
        join(sharedWorkspaceRoot, ".zed", "settings.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.deepEqual(
      (zedSettings.context_servers as Record<string, unknown>)[
        "agent-harness-zed"
      ],
      {
        command: "node",
        args: ["zed-mcp.js"],
      },
    );
    await zedAdapter.wire({
      projectRoot: sharedProjectRoot,
      workspaceRoot: sharedWorkspaceRoot,
      mode: "reset",
    });
    await assert.rejects(stat(join(sharedWorkspaceRoot, ".zed")), {
      code: "ENOENT",
    });

    const claudeAdapter = resolveHostAdapter("claude-code");
    assert.ok(claudeAdapter);
    await claudeAdapter.wire({
      projectRoot: sharedProjectRoot,
      workspaceRoot: sharedWorkspaceRoot,
      mode: "apply",
    });
    const claudeMcp = JSON.parse(
      await readFile(join(sharedWorkspaceRoot, ".mcp.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.deepEqual(claudeMcp.mcpServers, {
      "agent-harness-claude": {
        command: "node",
        args: ["claude-mcp.js"],
      },
    });
    await claudeAdapter.wire({
      projectRoot: sharedProjectRoot,
      workspaceRoot: sharedWorkspaceRoot,
      mode: "reset",
    });

    const piAdapter = resolveHostAdapter("pi");
    assert.ok(piAdapter);
    await piAdapter.wire({
      projectRoot: sharedProjectRoot,
      workspaceRoot: sharedWorkspaceRoot,
      mode: "apply",
    });
    await assertPathExists(
      join(
        sharedWorkspaceRoot,
        ".pi",
        "extensions",
        "agent-harness",
        "test-extension.json",
      ),
    );
    await assertPathExists(
      join(
        sharedWorkspaceRoot,
        ".pi",
        "packages",
        "agent-harness",
        "test-package.json",
      ),
    );
    await piAdapter.wire({
      projectRoot: sharedProjectRoot,
      workspaceRoot: sharedWorkspaceRoot,
      mode: "reset",
    });
    await assert.rejects(
      readFile(
        join(
          sharedWorkspaceRoot,
          ".pi",
          "packages",
          "agent-harness",
          "test-package.json",
        ),
        "utf8",
      ),
      { code: "ENOENT" },
    );
  } finally {
    await rm(cursorProjectRoot, { force: true, recursive: true });
    await rm(cursorWorkspaceRoot, { force: true, recursive: true });
    await rm(sharedProjectRoot, { force: true, recursive: true });
    await rm(sharedWorkspaceRoot, { force: true, recursive: true });
  }
});

async function assertNativeHostFile(
  host: (typeof NATIVE_HOSTS)[number],
  workspaceRoot: string,
): Promise<void> {
  const hostFileByHost = {
    cursor: join(workspaceRoot, ".cursor", "rules", "agent-harness.mdc"),
    zed: join(workspaceRoot, ".rules"),
    "claude-code": join(workspaceRoot, "CLAUDE.md"),
    pi: join(workspaceRoot, "AGENTS.md"),
    codex: join(workspaceRoot, "AGENTS.md"),
  } satisfies Record<(typeof NATIVE_HOSTS)[number], string>;

  const content = await readFile(hostFileByHost[host], "utf8");
  assert.match(content, /Agent Harness/u);
}

async function assertNativeHostExtras(
  host: (typeof NATIVE_HOSTS)[number],
  workspaceRoot: string,
): Promise<void> {
  if (host === "cursor") {
    const pluginManifest = await readFile(
      join(
        workspaceRoot,
        ".cursor",
        "agent-harness",
        "cursor-plugin",
        ".cursor-plugin",
        "plugin.json",
      ),
      "utf8",
    );
    assert.match(pluginManifest, /agent-harness/u);
  }

  if (host === "claude-code") {
    const agentFile = await readFile(
      join(workspaceRoot, ".claude", "agents", "agent-harness.md"),
      "utf8",
    );
    assert.match(agentFile, /Agent Harness/u);
  }

  if (host === "codex") {
    const skillFile = await readFile(
      join(workspaceRoot, ".agents", "skills", "agent-harness", "SKILL.md"),
      "utf8",
    );
    const pluginManifest = await readFile(
      join(
        workspaceRoot,
        ".agents",
        "plugins",
        "agent-harness",
        ".codex-plugin",
        "plugin.json",
      ),
      "utf8",
    );
    assert.match(skillFile, /Agent Harness/u);
    assert.match(pluginManifest, /agent-harness/u);
  }
}

function assertCompleteNativeWirePlan(
  plan: WirePlanManifest,
  options: {
    pluginRunnable: boolean;
    mcpRunnable: boolean;
    extensionRunnable: boolean;
  } = {
    pluginRunnable: true,
    mcpRunnable: true,
    extensionRunnable: true,
  },
): void {
  assert.ok(plan.instructionsFiles?.length);
  assert.ok(plan.agentFiles?.length);
  assert.ok(plan.skillDirs?.length);
  if (options.pluginRunnable) {
    assert.ok(plan.pluginDirs?.length);
  } else {
    assert.equal(plan.pluginDirs?.length ?? 0, 0);
  }
  assert.ok(plan.hookFiles?.length);
  assert.ok(plan.workflowFiles?.length);
  assert.ok(plan.referenceFiles?.length);
  if (options.mcpRunnable) {
    assert.ok(plan.mcpServers?.includes("asset-mcp"));
  } else {
    assert.equal(plan.mcpServers?.includes("asset-mcp"), false);
  }
  if (options.extensionRunnable) {
    assert.ok(plan.extensionIds?.includes("ms-python.python"));
  } else {
    assert.equal(plan.extensionIds?.includes("ms-python.python"), false);
  }
}

function assertWireCapabilities(
  adapter: HostAdapter | null | undefined,
  assetKinds: readonly AssetKind[],
): void {
  assert.ok(adapter);
  for (const assetKind of assetKinds) {
    assert.ok(
      adapter.capabilities
        .find((capability) => capability.assetKind === assetKind)
        ?.behaviors.includes("wire"),
      `${adapter.id} should wire ${assetKind}`,
    );
  }
}

async function writeOpenCodeActivation(
  projectRoot: string,
  assets: AssetCatalogEntry[],
): Promise<void> {
  const activationRoot = join(projectRoot, "activate", "opencode");
  await writeJson(join(activationRoot, "activation-manifest.json"), {
    schemaVersion: 1,
    host: "opencode",
    generatedAt: new Date().toISOString(),
    activeBundles: ["bundle-all-assets"],
    activeAssets: assets.map((asset) => asset.id),
    runtimeRoot: activationRoot,
    notes: [],
  });

  for (const asset of assets) {
    await writeActivationAsset(activationRoot, asset);
  }
}

async function writeOpenCodeInstallBundle(
  projectRoot: string,
  assets: AssetCatalogEntry[],
): Promise<void> {
  const installRoot = join(projectRoot, "install", "opencode");
  const packagesRoot = join(installRoot, "packages");
  const bundlePath = join(
    installRoot,
    "bundles",
    "bundle-all-assets.install.json",
  );
  const packages = [] as Array<{
    assetId: string;
    mirrorId: string;
    manifestPath: string;
  }>;

  for (const asset of assets) {
    const manifestPath = join(
      packagesRoot,
      sanitizeAssetId(asset.id),
      "package.install.json",
    );
    await writeJson(manifestPath, {
      schemaVersion: 1,
      assetId: asset.id,
      mirrorId: `mirror-${asset.id}`,
      host: "opencode",
      installedAt: new Date().toISOString(),
      projectionType: "test-fixture",
      assetKind: asset.assetKind,
      sourceAuthorityTier: "trusted-local",
      contextCost: {
        sizeClass: "tiny",
        estimatedPromptWeight: 1,
      },
      portfolioFit: 1,
      filesRoot: join(
        projectRoot,
        "activate",
        "opencode",
        sanitizeAssetId(asset.id),
      ),
      bundleMembership: ["bundle-all-assets"],
      activationEligible: true,
      activeByDefault: true,
    });
    packages.push({
      assetId: asset.id,
      mirrorId: `mirror-${asset.id}`,
      manifestPath,
    });
  }

  await writeJson(bundlePath, {
    schemaVersion: 1,
    bundleId: "bundle-all-assets",
    host: "opencode",
    installedAt: new Date().toISOString(),
    packages,
  });
}

async function writeActivationAsset(
  activationRoot: string,
  asset: AssetCatalogEntry,
): Promise<void> {
  const assetRoot = join(activationRoot, sanitizeAssetId(asset.id));
  await writeJson(join(assetRoot, "asset.json"), asset);
  await writeFile(
    join(assetRoot, "content.txt"),
    `# ${asset.displayName}\n\n${asset.assetKind} fixture\n`,
    "utf8",
  );
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function assertPathExists(pathValue: string): Promise<void> {
  let entry;
  try {
    entry = await stat(pathValue);
  } catch (error) {
    throw new Error(`expected ${pathValue} to exist`, {
      cause: error,
    });
  }

  assert.ok(
    entry.isDirectory() || entry.isFile(),
    `expected ${pathValue} to be a file or directory`,
  );
}

function buildAllAssetFixtures(): AssetCatalogEntry[] {
  return [
    buildAsset("asset-instruction", "instruction"),
    buildAsset("asset-agent", "agent"),
    buildAsset("asset-skill", "skill"),
    buildAsset("asset-workflow", "workflow"),
    buildAsset("asset-prompt-pack", "prompt-pack"),
    buildAsset("asset-plugin", "plugin"),
    buildAsset("asset-hook", "hook"),
    buildAsset("asset-reference", "reference-pack"),
    buildAsset("asset-mcp", "mcp-server"),
    buildAsset("ms-python.python", "extension"),
  ];
}

function buildAsset(
  id: string,
  assetKind: AssetKind,
  overrides: Partial<AssetCatalogEntry> = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind,
    hosts: ["cursor"],
    compatibilityMode: assetKind === "extension" ? "native" : "adaptable",
    source: {
      sourceId: "test-source",
      authorityTier: "trusted-local",
      sourceKind: "local-directory",
      sourcePriority: 100,
      originUrl: `file:///test/${id}`,
      publisher: "test",
      publisherVerified: true,
    },
    trust: {
      score: 100,
      signals: [],
    },
    capabilities: [assetKind],
    install: {
      method: assetKind === "extension" ? "vscode-extension" : "test-file",
      adaptableHosts: ["cursor"],
      manifestEntry: assetKind === "extension" ? id : undefined,
    },
    evidence: {
      manifestFound: true,
      readmeFound: false,
      examplesFound: false,
      docsLinked: false,
      lineCount: 1,
      filePath: `${id}.md`,
      rootPath: "/test",
    },
    maintenance: {
      lastUpdated: "2026-01-01T00:00:00.000Z",
      stars: 0,
      releaseCadence: "test",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: {
      sizeClass: "tiny",
      estimatedPromptWeight: 1,
    },
    fit: {
      portfolioFit: 1,
      hostFit: 1,
    },
    dedupe: {
      candidateRankHint: "test",
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
    ...overrides,
  };
}
