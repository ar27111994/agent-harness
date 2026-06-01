import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";

import {
  pathExists,
  readJsonFile,
  readTextFileOrNull,
  writeJsonFile,
  writeTextFile,
} from "../files.js";
import {
  nativeWireInternals,
  wireNativeHost,
  type NativeWireHost,
} from "../host-adapters/native-wire.js";
import { sanitizeAssetId } from "../lib/safe-paths.js";
import type {
  ActivationManifest,
  AssetCatalogEntry,
  AssetHostNativeConfigMap,
  CopilotWorkspaceProfileManifest,
  WirePlanManifest,
} from "../types.js";

void test("Cursor native wire apply/reset materializes assets and restores merged native config", async () => {
  const fixture = await createNativeFixture("cursor");

  try {
    await writeCursorActivation(
      fixture.projectRoot,
      fixture.workspaceRoot,
      fixture.assets,
    );
    await writeTextFile(
      join(fixture.workspaceRoot, ".cursor", "mcp.json"),
      `${JSON.stringify({ servers: [{ name: "existing" }] }, null, 2)}\n`,
    );

    await wireNativeHost("cursor", {
      projectRoot: fixture.projectRoot,
      workspaceRoot: fixture.workspaceRoot,
      mode: "apply",
    });

    const managedRoot = join(fixture.workspaceRoot, ".cursor", "agent-harness");
    const wirePlan = await readJsonFile<WirePlanManifest>(
      join(managedRoot, "wire-plan.json"),
    );
    assert.equal(wirePlan.host, "cursor");
    assert.deepEqual(wirePlan.extensionIds, ["fixture.cursor-extension"]);
    assert.ok(
      wirePlan.nativeInstallActions?.some((action) =>
        action.includes("fixture.cursor-extension"),
      ),
    );
    assert.ok(
      wirePlan.nativeConfigOperations?.some(
        (operation) =>
          operation.path === ".cursor/mcp.json" && operation.mode === "merge",
      ),
    );

    const cursorRule = await readFile(
      join(fixture.workspaceRoot, ".cursor", "rules", "agent-harness.mdc"),
      "utf8",
    );
    assert.match(cursorRule, /Agent Harness for Cursor/u);
    assert.match(cursorRule, /MCP references/u);
    assert.match(cursorRule, /Cursor Instruction/u);

    assert.equal(
      await readTextFileOrNull(
        join(
          fixture.workspaceRoot,
          ".cursor",
          "agents",
          "agent-harness",
          `${sanitizeAssetId("cursor.agent")}.md`,
        ),
      ),
      [
        "---",
        `name: ${JSON.stringify("cursor.agent")}`,
        `description: ${JSON.stringify("Cursor Agent")}`,
        "---",
        "",
        "# Cursor Agent body",
        "",
        "",
      ].join("\n"),
    );
    assert.equal(
      await readTextFileOrNull(
        join(managedRoot, "cursor-plugin", ".cursor-plugin", "plugin.json"),
      ),
      `${JSON.stringify(
        {
          name: "agent-harness",
          version: "1.0.0",
          description: "Curated Agent Harness project assets for Cursor.",
          rules: "./rules",
          skills: "./skills",
          agents: "./agents",
          commands: "./commands",
        },
        null,
        2,
      )}\n`,
    );
    const fallbackReference =
      (await readTextFileOrNull(
        join(
          managedRoot,
          "assets",
          "reference-packs",
          sanitizeAssetId("cursor.reference"),
          `${sanitizeAssetId("cursor.reference")}.md`,
        ),
      )) ?? "";
    assert.match(fallbackReference, /Source: cursor.reference-source/u);
    assert.match(
      fallbackReference,
      /Origin: https:\/\/example.com\/cursor.reference/u,
    );

    const mergedCursorConfig = JSON.parse(
      await readFile(
        join(fixture.workspaceRoot, ".cursor", "mcp.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.deepEqual(mergedCursorConfig, {
      servers: [{ name: "existing" }, { name: "cursor-generated" }],
    });
    assert.equal(
      await readTextFileOrNull(
        join(fixture.workspaceRoot, ".cursor", "hooks", "generated.md"),
      ),
      "# generated cursor hook\n",
    );

    await wireNativeHost("cursor", {
      projectRoot: fixture.projectRoot,
      workspaceRoot: fixture.workspaceRoot,
      mode: "reset",
    });

    assert.equal(await pathExists(managedRoot), false);
    assert.deepEqual(
      JSON.parse(
        await readFile(
          join(fixture.workspaceRoot, ".cursor", "mcp.json"),
          "utf8",
        ),
      ),
      { servers: [{ name: "existing" }] },
    );
    assert.equal(
      await pathExists(
        join(fixture.workspaceRoot, ".cursor", "hooks", "generated.md"),
      ),
      false,
    );
  } finally {
    await fixture.cleanup();
  }
});

void test("Zed native wire apply/reset updates rules and settings with reversible snapshots", async () => {
  const fixture = await createNativeFixture("zed");

  try {
    await writeOpenCodeActivation(
      fixture.projectRoot,
      fixture.workspaceRoot,
      fixture.assets,
    );
    await writeTextFile(
      join(fixture.workspaceRoot, ".rules"),
      "Existing Zed rules\n",
    );
    await writeJsonFile(join(fixture.workspaceRoot, ".zed", "settings.json"), {
      features: {
        vim_mode: true,
      },
    });

    await wireNativeHost("zed", {
      projectRoot: fixture.projectRoot,
      workspaceRoot: fixture.workspaceRoot,
      mode: "apply",
    });

    const managedRoot = join(fixture.workspaceRoot, ".zed", "agent-harness");
    const wirePlan = await readJsonFile<WirePlanManifest>(
      join(managedRoot, "wire-plan.json"),
    );
    assert.equal(wirePlan.host, "zed");
    assert.ok((wirePlan.textFileSnapshots?.length ?? 0) > 0);
    assert.match(
      (await readFile(join(fixture.workspaceRoot, ".rules"), "utf8")) ?? "",
      /agent-harness-zed:begin/u,
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(
          join(fixture.workspaceRoot, ".zed", "settings.json"),
          "utf8",
        ),
      ),
      {
        features: {
          vim_mode: true,
          assistant: true,
        },
        agent: {
          profiles: {
            "agent-harness": {
              name: "Agent Harness",
              enable_all_context_servers: true,
            },
          },
        },
      },
    );

    await wireNativeHost("zed", {
      projectRoot: fixture.projectRoot,
      workspaceRoot: fixture.workspaceRoot,
      mode: "reset",
    });

    assert.equal(
      await readTextFileOrNull(join(fixture.workspaceRoot, ".rules")),
      "Existing Zed rules\n",
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(
          join(fixture.workspaceRoot, ".zed", "settings.json"),
          "utf8",
        ),
      ),
      {
        features: {
          vim_mode: true,
        },
      },
    );
  } finally {
    await fixture.cleanup();
  }
});

void test("Claude Code, Pi, and Codex native wire apply/reset manage project-local context and host settings", async () => {
  for (const host of ["claude-code", "pi", "codex"] as const) {
    const fixture = await createNativeFixture(host);

    try {
      await writeOpenCodeActivation(
        fixture.projectRoot,
        fixture.workspaceRoot,
        fixture.assets,
      );
      if (host === "claude-code") {
        await writeTextFile(
          join(fixture.workspaceRoot, "CLAUDE.md"),
          "Existing CLAUDE\n",
        );
        await writeTextFile(
          join(fixture.workspaceRoot, ".claude", "CLAUDE.md"),
          "Existing local CLAUDE\n",
        );
        await writeJsonFile(
          join(fixture.workspaceRoot, ".claude", "settings.json"),
          { existing: true },
        );
      } else if (host === "pi") {
        await writeTextFile(
          join(fixture.workspaceRoot, "AGENTS.md"),
          "Existing AGENTS\n",
        );
        await writeTextFile(
          join(fixture.workspaceRoot, "SYSTEM.md"),
          "Existing SYSTEM\n",
        );
        await writeJsonFile(
          join(fixture.workspaceRoot, ".pi", "settings.json"),
          {
            skills: ["skills/existing"],
            prompts: ["prompts/existing.md"],
            agentHarness: true,
          },
        );
      } else {
        await writeTextFile(
          join(fixture.workspaceRoot, "AGENTS.md"),
          "Existing AGENTS\n",
        );
        await writeJsonFile(
          join(fixture.workspaceRoot, ".agents", "plugins", "marketplace.json"),
          {
            schemaVersion: 2,
            plugins: [
              { name: "existing", path: "./existing" },
              { name: "agent-harness", path: "./stale-agent-harness" },
              "ignored malformed entry",
            ],
          },
        );
      }

      await wireNativeHost(host, {
        projectRoot: fixture.projectRoot,
        workspaceRoot: fixture.workspaceRoot,
        mode: "apply",
      });

      if (host === "claude-code") {
        assert.match(
          (await readFile(join(fixture.workspaceRoot, "CLAUDE.md"), "utf8")) ??
            "",
          /agent-harness-claude-code:begin/u,
        );
        assert.equal(
          await pathExists(
            join(
              fixture.workspaceRoot,
              ".claude",
              "commands",
              "agent-harness.md",
            ),
          ),
          true,
        );
        assert.deepEqual(
          JSON.parse(
            await readFile(
              join(fixture.workspaceRoot, ".claude", "settings.json"),
              "utf8",
            ),
          ),
          {
            existing: true,
            claudeHarness: true,
          },
        );
      } else if (host === "pi") {
        assert.match(
          (await readFile(join(fixture.workspaceRoot, "AGENTS.md"), "utf8")) ??
            "",
          /agent-harness-pi:begin/u,
        );
        assert.equal(
          await readTextFileOrNull(
            join(
              fixture.workspaceRoot,
              ".pi",
              "extensions",
              "generated",
              "index.js",
            ),
          ),
          "export const generated = true;\n",
        );
        assert.deepEqual(
          JSON.parse(
            await readFile(
              join(fixture.workspaceRoot, ".pi", "settings.json"),
              "utf8",
            ),
          ),
          {
            skills: ["skills/existing", "skills/agent-harness"],
            prompts: ["prompts/existing.md", "prompts/agent-harness.md"],
          },
        );
      } else {
        assert.match(
          (await readFile(join(fixture.workspaceRoot, "AGENTS.md"), "utf8")) ??
            "",
          /agent-harness-codex:begin/u,
        );
        assert.deepEqual(
          JSON.parse(
            await readFile(
              join(
                fixture.workspaceRoot,
                ".agents",
                "plugins",
                "agent-harness",
                ".codex-plugin",
                "plugin.json",
              ),
              "utf8",
            ),
          ),
          {
            name: "agent-harness",
            version: "1.0.0",
            description: "Project-local Agent Harness assets for OpenAI Codex.",
            skills: "./skills",
            hooks: "./hooks/hooks.json",
          },
        );
        assert.deepEqual(
          JSON.parse(
            await readFile(
              join(
                fixture.workspaceRoot,
                ".agents",
                "plugins",
                "marketplace.json",
              ),
              "utf8",
            ),
          ),
          {
            schemaVersion: 2,
            plugins: [
              { name: "existing", path: "./existing" },
              { name: "agent-harness", path: "./agent-harness" },
            ],
          },
        );
        const codexHooksManifest = JSON.parse(
          await readFile(
            join(
              fixture.workspaceRoot,
              ".agents",
              "plugins",
              "agent-harness",
              "hooks",
              "hooks.json",
            ),
            "utf8",
          ),
        ) as {
          schemaVersion: number;
          hooks: Array<{ name: string; description: string; source: string }>;
        };
        assert.equal(codexHooksManifest.schemaVersion, 1);
        assert.deepEqual(
          codexHooksManifest.hooks.map(({ description, name }) => ({
            description,
            name,
          })),
          [
            {
              name: "cursor.hook",
              description: "Cursor Hook",
            },
          ],
        );
        assert.match(
          codexHooksManifest.hooks[0]?.source ?? "",
          /^\.\.\/\.\.\/\.\.\/\.\.\/\.codex\/agent-harness\/assets\/hooks\/cursor-hook-[a-f0-9]+\/hook\.md$/u,
        );
        assert.equal(
          isAbsolute(codexHooksManifest.hooks[0]?.source ?? ""),
          false,
        );
      }

      await wireNativeHost(host, {
        projectRoot: fixture.projectRoot,
        workspaceRoot: fixture.workspaceRoot,
        mode: "reset",
      });

      if (host === "claude-code") {
        assert.equal(
          await readTextFileOrNull(join(fixture.workspaceRoot, "CLAUDE.md")),
          "Existing CLAUDE\n",
        );
        assert.equal(
          await readTextFileOrNull(
            join(fixture.workspaceRoot, ".claude", "CLAUDE.md"),
          ),
          "Existing local CLAUDE\n",
        );
        assert.deepEqual(
          JSON.parse(
            await readFile(
              join(fixture.workspaceRoot, ".claude", "settings.json"),
              "utf8",
            ),
          ),
          { existing: true },
        );
      } else if (host === "pi") {
        assert.equal(
          await readTextFileOrNull(join(fixture.workspaceRoot, "AGENTS.md")),
          "Existing AGENTS\n",
        );
        assert.equal(
          await readTextFileOrNull(join(fixture.workspaceRoot, "SYSTEM.md")),
          "Existing SYSTEM\n",
        );
        assert.deepEqual(
          JSON.parse(
            await readFile(
              join(fixture.workspaceRoot, ".pi", "settings.json"),
              "utf8",
            ),
          ),
          {
            skills: ["skills/existing"],
            prompts: ["prompts/existing.md"],
          },
        );
        assert.equal(
          await pathExists(
            join(
              fixture.workspaceRoot,
              ".pi",
              "extensions",
              "generated",
              "index.js",
            ),
          ),
          false,
        );
      } else {
        assert.equal(
          await readTextFileOrNull(join(fixture.workspaceRoot, "AGENTS.md")),
          "Existing AGENTS\n",
        );
        assert.equal(
          await pathExists(join(fixture.workspaceRoot, ".codex")),
          false,
        );
      }
    } finally {
      await fixture.cleanup();
    }
  }
});

void test("Codex plugin manifest omits hook registration when hook assets are absent", () => {
  assert.deepEqual(
    nativeWireInternals.buildCodexPluginManifest([
      {
        assetId: "codex.skill",
        assetKind: "skill",
        displayName: "Codex Skill",
        compatibilityMode: "native",
        content: "# Codex skill\n",
      },
    ]),
    {
      name: "agent-harness",
      version: "1.0.0",
      description: "Project-local Agent Harness assets for OpenAI Codex.",
      skills: "./skills",
    },
  );
});

void test("native wire skips missing activation assets and falls back to asset metadata when content is absent", async () => {
  const fixture = await createNativeFixture("cursor");

  try {
    await writeCursorActivation(
      fixture.projectRoot,
      fixture.workspaceRoot,
      fixture.assets,
    );
    await rm(
      join(
        fixture.projectRoot,
        "activate",
        "copilot-vscode",
        sanitizeAssetId("cursor.reference"),
        "content.txt",
      ),
      { force: true },
    );
    await rm(
      join(
        fixture.projectRoot,
        "activate",
        "copilot-vscode",
        sanitizeAssetId("cursor.workflow"),
        "asset.json",
      ),
      { force: true },
    );

    await wireNativeHost("cursor", {
      projectRoot: fixture.projectRoot,
      workspaceRoot: fixture.workspaceRoot,
      mode: "apply",
    });

    const managedRoot = join(fixture.workspaceRoot, ".cursor", "agent-harness");
    const referenceFallback =
      (await readTextFileOrNull(
        join(
          managedRoot,
          "assets",
          "reference-packs",
          sanitizeAssetId("cursor.reference"),
          `${sanitizeAssetId("cursor.reference")}.md`,
        ),
      )) ?? "";
    assert.match(referenceFallback, /Source: cursor.reference-source/u);
    assert.equal(
      await pathExists(
        join(
          managedRoot,
          "assets",
          "workflows",
          sanitizeAssetId("cursor.workflow"),
          "prompt.md",
        ),
      ),
      false,
    );
  } finally {
    await fixture.cleanup();
  }
});

void test("native wire reset rejects wire plans with duplicate managed text snapshots", async () => {
  const fixture = await createNativeFixture("zed");

  try {
    const hostActivationRoot = join(fixture.projectRoot, "activate", "zed");
    await writeJsonFile(join(hostActivationRoot, "wire-plan.json"), {
      schemaVersion: 1,
      host: "zed",
      generatedAt: new Date().toISOString(),
      workspaceRoot: fixture.workspaceRoot,
      runtimeRoot: join(fixture.workspaceRoot, ".zed", "agent-harness"),
      textFileSnapshots: [
        {
          path: join(fixture.workspaceRoot, ".rules").replaceAll("\\", "/"),
          content: null,
        },
        {
          path: join(fixture.workspaceRoot, ".rules").replaceAll("\\", "/"),
          content: "duplicate",
        },
      ],
      notes: [],
    } satisfies WirePlanManifest);

    await assert.rejects(
      wireNativeHost("zed", {
        projectRoot: fixture.projectRoot,
        workspaceRoot: fixture.workspaceRoot,
        mode: "reset",
      }),
      /duplicate path/u,
    );
  } finally {
    await fixture.cleanup();
  }
});

void test("Zed native wire rolls back partial apply when host settings are not a JSON object", async () => {
  const fixture = await createNativeFixture("zed");

  try {
    await writeOpenCodeActivation(
      fixture.projectRoot,
      fixture.workspaceRoot,
      fixture.assets,
    );
    await writeTextFile(
      join(fixture.workspaceRoot, ".rules"),
      "Existing Zed rules\n",
    );
    await writeTextFile(
      join(fixture.workspaceRoot, ".zed", "settings.json"),
      "[]\n",
    );

    await assert.rejects(
      wireNativeHost("zed", {
        projectRoot: fixture.projectRoot,
        workspaceRoot: fixture.workspaceRoot,
        mode: "apply",
      }),
      /Expected .*\.zed\/settings\.json to contain a JSON object, but found array/u,
    );

    assert.equal(
      await readTextFileOrNull(join(fixture.workspaceRoot, ".rules")),
      "Existing Zed rules\n",
    );
    assert.equal(
      await readTextFileOrNull(
        join(fixture.workspaceRoot, ".zed", "settings.json"),
      ),
      "[]\n",
    );
    assert.equal(
      await pathExists(join(fixture.workspaceRoot, ".zed", "agent-harness")),
      false,
    );
    assert.equal(
      await pathExists(
        join(fixture.projectRoot, "activate", "zed", "wire-plan.json"),
      ),
      false,
    );
  } finally {
    await fixture.cleanup();
  }
});

void test("native wire preview writes only the preview manifest", async () => {
  const fixture = await createNativeFixture("cursor");

  try {
    await writeCursorActivation(
      fixture.projectRoot,
      fixture.workspaceRoot,
      fixture.assets,
    );

    await wireNativeHost("cursor", {
      projectRoot: fixture.projectRoot,
      workspaceRoot: fixture.workspaceRoot,
      mode: "preview",
    });

    const preview = await readJsonFile<{ mode: string }>(
      join(
        fixture.projectRoot,
        "activate",
        "cursor",
        "wire-preview-cursor.json",
      ),
    );
    assert.equal(preview.mode, "preview");
    assert.equal(
      await pathExists(join(fixture.workspaceRoot, ".cursor", "agent-harness")),
      false,
    );
    assert.equal(
      await pathExists(
        join(fixture.workspaceRoot, ".cursor", "rules", "agent-harness.mdc"),
      ),
      false,
    );
  } finally {
    await fixture.cleanup();
  }
});

void test("Pi and Codex native wire reset removes managed-only files and settings", async () => {
  for (const host of ["pi", "codex"] as const) {
    const fixture = await createNativeFixture(host);

    try {
      await writeOpenCodeActivation(
        fixture.projectRoot,
        fixture.workspaceRoot,
        fixture.assets,
      );

      await wireNativeHost(host, {
        projectRoot: fixture.projectRoot,
        workspaceRoot: fixture.workspaceRoot,
        mode: "apply",
      });

      assert.match(
        (await readTextFileOrNull(join(fixture.workspaceRoot, "AGENTS.md"))) ??
          "",
        new RegExp(`agent-harness-${host}:begin`, "u"),
      );

      await wireNativeHost(host, {
        projectRoot: fixture.projectRoot,
        workspaceRoot: fixture.workspaceRoot,
        mode: "reset",
      });

      assert.equal(
        await readTextFileOrNull(join(fixture.workspaceRoot, "AGENTS.md")),
        null,
      );
      if (host === "pi") {
        assert.equal(
          await readTextFileOrNull(join(fixture.workspaceRoot, "SYSTEM.md")),
          null,
        );
        assert.equal(
          await readTextFileOrNull(
            join(fixture.workspaceRoot, ".pi", "settings.json"),
          ),
          null,
        );
      } else {
        assert.equal(
          await pathExists(join(fixture.workspaceRoot, ".agents")),
          false,
        );
        assert.equal(
          await pathExists(join(fixture.workspaceRoot, ".codex")),
          false,
        );
      }
    } finally {
      await fixture.cleanup();
    }
  }
});

void test("native wire tolerates malformed shared MCP package state", async () => {
  const fixture = await createNativeFixture("cursor");
  const warnings: string[] = [];
  const originalWarn = console.warn;

  console.warn = (message?: unknown, ...args: unknown[]) => {
    warnings.push([message, ...args].map(String).join(" "));
  };

  try {
    await writeCursorActivation(
      fixture.projectRoot,
      fixture.workspaceRoot,
      fixture.assets,
    );
    await writeJsonFile(
      join(
        fixture.projectRoot,
        "activate",
        "shared",
        "activation-manifest.json",
      ),
      {
        schemaVersion: 1,
        host: "shared",
        generatedAt: new Date().toISOString(),
        activeBundles: ["shared-bundle"],
        activeAssets: ["shared.mcp.server"],
        runtimeRoot: join(fixture.projectRoot, "activate", "shared"),
        notes: [],
      } satisfies ActivationManifest,
    );
    await writeJsonFile(
      join(
        fixture.projectRoot,
        "install",
        "shared",
        "bundles",
        "shared-bundle.install.json",
      ),
      {
        schemaVersion: 1,
        bundleId: "shared-bundle",
        host: "shared",
        installedAt: new Date().toISOString(),
        packages: [
          {
            assetId: "shared.mcp.server",
            mirrorId: "shared-mirror",
            manifestPath: join(
              fixture.projectRoot,
              "install",
              "shared",
              "packages",
              "shared-mcp.install.json",
            ),
          },
        ],
      },
    );
    await writeTextFile(
      join(
        fixture.projectRoot,
        "install",
        "shared",
        "packages",
        "shared-mcp.install.json",
      ),
      '{"schemaVersion":1,"assetId":null}\n',
    );

    await wireNativeHost("cursor", {
      projectRoot: fixture.projectRoot,
      workspaceRoot: fixture.workspaceRoot,
      mode: "apply",
    });

    assert.ok(
      warnings.some((warning) =>
        warning.includes(
          "Failed to project shared MCP assets into Cursor wire plan",
        ),
      ),
    );
  } finally {
    console.warn = originalWarn;
    await fixture.cleanup();
  }
});

async function createNativeFixture(host: NativeWireHost): Promise<{
  projectRoot: string;
  workspaceRoot: string;
  assets: AssetCatalogEntry[];
  cleanup: () => Promise<void>;
}> {
  const root = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(join(tmpdir(), `agent-harness-native-wire-${host}-`)),
  );
  const projectRoot = join(root, "project");
  const workspaceRoot = join(root, "workspace");
  const assets = buildNativeAssets(host);

  return {
    projectRoot,
    workspaceRoot,
    assets,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function writeCursorActivation(
  projectRoot: string,
  workspaceRoot: string,
  assets: AssetCatalogEntry[],
): Promise<void> {
  const activationRoot = join(projectRoot, "activate", "copilot-vscode");
  await writeJsonFile(join(activationRoot, "workspace-profile-manifest.json"), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    profileId: "cursor-profile",
    workspaceRoot,
    bundleIds: ["copilot-core"],
    selectedAssetIds: assets.map((asset) => asset.id),
    selectedInstructionIds: assets
      .filter((asset) => asset.assetKind === "instruction")
      .map((asset) => asset.id),
    selectedAgentIds: assets
      .filter((asset) => asset.assetKind === "agent")
      .map((asset) => asset.id),
    selectedWorkflowIds: assets
      .filter((asset) => asset.assetKind === "workflow")
      .map((asset) => asset.id),
    activationBudget: 32,
  } satisfies CopilotWorkspaceProfileManifest);

  for (const asset of assets) {
    const assetRoot = join(activationRoot, sanitizeAssetId(asset.id));
    await writeJsonFile(join(assetRoot, "asset.json"), asset);
    const content = defaultContentForAsset(asset);
    if (content !== null) {
      await writeTextFile(join(assetRoot, "content.txt"), content);
    }
  }
}

async function writeOpenCodeActivation(
  projectRoot: string,
  workspaceRoot: string,
  assets: AssetCatalogEntry[],
): Promise<void> {
  const activationRoot = join(projectRoot, "activate", "opencode");
  await writeJsonFile(join(activationRoot, "activation-manifest.json"), {
    schemaVersion: 1,
    host: "opencode",
    generatedAt: new Date().toISOString(),
    activeBundles: ["opencode-global"],
    activeAssets: assets.map((asset) => asset.id),
    runtimeRoot: join(workspaceRoot, ".opencode"),
    notes: [],
  } satisfies ActivationManifest);

  for (const asset of assets) {
    const assetRoot = join(activationRoot, sanitizeAssetId(asset.id));
    await writeJsonFile(join(assetRoot, "asset.json"), asset);
    const content = defaultContentForAsset(asset);
    if (content !== null) {
      await writeTextFile(join(assetRoot, "content.txt"), content);
    }
  }
}

function buildNativeAssets(host: NativeWireHost): AssetCatalogEntry[] {
  return [
    buildAsset("cursor.instruction", "instruction", {
      displayName:
        host === "cursor" ? "Cursor Instruction" : `${host} instruction`,
      hostNativeConfig: undefined,
    }),
    buildAsset("cursor.agent", "agent", {
      displayName: host === "cursor" ? "Cursor Agent" : `${host} agent`,
    }),
    buildAsset("cursor.skill", "skill"),
    buildAsset("cursor.workflow", "workflow"),
    buildAsset("cursor.prompt-pack", "prompt-pack"),
    buildAsset("cursor.plugin", "plugin"),
    buildAsset("cursor.hook", "hook"),
    buildAsset("cursor.mcp", "mcp-server"),
    buildAsset("cursor.extension", "extension", {
      manifestEntry: "fixture.cursor-extension",
    }),
    buildAsset("cursor.reference", "reference-pack", {
      withContent: false,
    }),
    buildAsset("native-config.asset", "plugin", {
      hostNativeConfig: buildHostNativeConfig(host),
    }),
  ];
}

function buildAsset(
  id: string,
  assetKind: AssetCatalogEntry["assetKind"],
  options: {
    displayName?: string;
    hostNativeConfig?: AssetHostNativeConfigMap;
    manifestEntry?: string;
    withContent?: boolean;
  } = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: options.displayName ?? toDisplayName(id),
    assetKind,
    hosts: ["cursor"],
    compatibilityMode: assetKind === "extension" ? "native" : "adaptable",
    source: {
      sourceId: `${id}-source`,
      authorityTier: "trusted-local",
      sourceKind: "local-directory",
      sourcePriority: 1,
      originUrl: `https://example.com/${id}`,
      publisher: "tests",
      publisherVerified: true,
    },
    trust: { score: 100, signals: [] },
    capabilities: [assetKind],
    install: {
      method: assetKind === "extension" ? "vscode-extension" : "local-file",
      nativeHosts: assetKind === "extension" ? ["cursor"] : undefined,
      adaptableHosts: assetKind === "extension" ? undefined : ["opencode"],
      manifestEntry: options.manifestEntry,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: `${sanitizeAssetId(id)}.md`,
      rootPath: "/fixtures",
    },
    maintenance: {
      lastUpdated: "2026-01-01T00:00:00.000Z",
      stars: 10,
      releaseCadence: "active",
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
      candidateRankHint: sanitizeAssetId(id),
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
    hostNativeConfig: options.hostNativeConfig,
  };
}

function defaultContentForAsset(asset: AssetCatalogEntry): string | null {
  if (asset.id === "cursor.reference") {
    return null;
  }

  return `# ${asset.displayName} body\n`;
}

function buildHostNativeConfig(host: NativeWireHost): AssetHostNativeConfigMap {
  switch (host) {
    case "cursor":
      return {
        cursor: {
          files: [
            {
              path: ".cursor/mcp.json",
              format: "json",
              merge: true,
              content: {
                servers: [{ name: "cursor-generated" }],
              },
            },
            {
              path: ".cursor/hooks/generated.md",
              format: "text",
              content: "# generated cursor hook\n",
            },
          ],
        },
      };
    case "zed":
      return {
        zed: {
          files: [
            {
              path: ".zed/settings.json",
              format: "json",
              merge: true,
              content: {
                features: {
                  assistant: true,
                },
              },
            },
          ],
        },
      };
    case "claude-code":
      return {
        "claude-code": {
          files: [
            {
              path: ".claude/settings.json",
              format: "json",
              merge: true,
              content: {
                claudeHarness: true,
              },
            },
          ],
        },
      };
    case "pi":
      return {
        pi: {
          files: [
            {
              path: ".pi/extensions/generated/index.js",
              format: "text",
              content: "export const generated = true;\n",
            },
            {
              path: ".pi/packages/generated/package.json",
              format: "text",
              content: '{"name":"generated"}\n',
            },
          ],
        },
      };
    case "codex":
      return {
        codex: {
          files: [
            {
              path: ".codex/config.toml",
              format: "text",
              content: "# generated codex config\n",
            },
            {
              path: ".codex/hooks.json",
              format: "json",
              merge: true,
              content: {
                hooks: [],
              },
            },
          ],
        },
      };
  }
}

function toDisplayName(id: string): string {
  return id
    .split(/[.-]/u)
    .map((segment) => `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`)
    .join(" ");
}

void test("native wire internals clean failed applies and validate helper edge cases", async (context) => {
  const root = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(join(tmpdir(), "agent-harness-native-wire-internals-")),
  );
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const workspaceRoot = join(root, "workspace");
  const hostActivationRoot = join(root, "project", "activate", "native");
  const managedRoot = join(workspaceRoot, ".cursor", "agent-harness");
  await writeTextFile(join(managedRoot, "wire-plan.json"), "{}\n");
  await writeTextFile(join(hostActivationRoot, "wire-plan.json"), "{}\n");
  await writeTextFile(
    join(workspaceRoot, ".cursor", "rules", "agent-harness.mdc"),
    "rule\n",
  );
  await writeTextFile(
    join(workspaceRoot, ".cursor", "agents", "agent-harness", "agent.md"),
    "agent\n",
  );

  await nativeWireInternals.cleanupFailedNativeHostApply(
    nativeWireInternals.nativeHostSpecs.cursor,
    workspaceRoot,
    managedRoot,
    hostActivationRoot,
    [],
  );
  assert.equal(
    await pathExists(
      join(workspaceRoot, ".cursor", "rules", "agent-harness.mdc"),
    ),
    false,
  );
  assert.equal(
    await pathExists(join(workspaceRoot, ".cursor", "agents", "agent-harness")),
    false,
  );
  assert.equal(
    await pathExists(join(hostActivationRoot, "wire-plan.json")),
    false,
  );

  const managedOnlySection = (markerId: string) =>
    [
      `<!-- ${markerId}:begin -->`,
      "managed",
      `<!-- ${markerId}:end -->`,
      "",
    ].join("\n");

  const zedManagedRoot = join(workspaceRoot, ".zed", "agent-harness");
  const zedActivationRoot = join(root, "project", "activate", "zed");
  await writeTextFile(join(zedManagedRoot, "wire-plan.json"), "{}\n");
  await writeTextFile(join(zedActivationRoot, "wire-plan.json"), "{}\n");
  await writeTextFile(
    join(workspaceRoot, ".rules"),
    managedOnlySection("agent-harness-zed"),
  );
  await nativeWireInternals.cleanupFailedNativeHostApply(
    nativeWireInternals.nativeHostSpecs.zed,
    workspaceRoot,
    zedManagedRoot,
    zedActivationRoot,
    [],
  );
  assert.equal(await readTextFileOrNull(join(workspaceRoot, ".rules")), null);

  const claudeFallbackManagedRoot = join(
    workspaceRoot,
    ".claude-fallback",
    "agent-harness",
  );
  const claudeFallbackActivationRoot = join(
    root,
    "project",
    "activate",
    "claude-code-fallback",
  );
  await writeTextFile(
    join(claudeFallbackManagedRoot, "wire-plan.json"),
    "{}\n",
  );
  await writeTextFile(
    join(claudeFallbackActivationRoot, "wire-plan.json"),
    "{}\n",
  );
  await writeTextFile(
    join(workspaceRoot, "CLAUDE.md"),
    managedOnlySection("agent-harness-claude-code"),
  );
  await writeTextFile(
    join(workspaceRoot, ".claude", "CLAUDE.md"),
    managedOnlySection("agent-harness-claude-code"),
  );
  await nativeWireInternals.cleanupFailedNativeHostApply(
    nativeWireInternals.nativeHostSpecs["claude-code"],
    workspaceRoot,
    claudeFallbackManagedRoot,
    claudeFallbackActivationRoot,
    [],
  );
  assert.equal(
    await readTextFileOrNull(join(workspaceRoot, "CLAUDE.md")),
    null,
  );
  assert.equal(
    await readTextFileOrNull(join(workspaceRoot, ".claude", "CLAUDE.md")),
    null,
  );

  const piFallbackManagedRoot = join(
    workspaceRoot,
    ".pi-fallback",
    "agent-harness",
  );
  const piFallbackActivationRoot = join(
    root,
    "project",
    "activate",
    "pi-fallback",
  );
  await writeTextFile(join(piFallbackManagedRoot, "wire-plan.json"), "{}\n");
  await writeTextFile(join(piFallbackActivationRoot, "wire-plan.json"), "{}\n");
  await writeTextFile(
    join(workspaceRoot, "AGENTS.md"),
    managedOnlySection("agent-harness-pi"),
  );
  await writeTextFile(
    join(workspaceRoot, "SYSTEM.md"),
    managedOnlySection("agent-harness-pi"),
  );
  await nativeWireInternals.cleanupFailedNativeHostApply(
    nativeWireInternals.nativeHostSpecs.pi,
    workspaceRoot,
    piFallbackManagedRoot,
    piFallbackActivationRoot,
    [],
  );
  assert.equal(
    await readTextFileOrNull(join(workspaceRoot, "AGENTS.md")),
    null,
  );
  assert.equal(
    await readTextFileOrNull(join(workspaceRoot, "SYSTEM.md")),
    null,
  );

  const claudeManagedRoot = join(workspaceRoot, ".claude", "agent-harness");
  const claudeActivationRoot = join(root, "project", "activate", "claude-code");
  await writeTextFile(join(claudeManagedRoot, "wire-plan.json"), "{}\n");
  await writeTextFile(join(claudeActivationRoot, "wire-plan.json"), "{}\n");
  await writeTextFile(join(workspaceRoot, "CLAUDE.md"), "current\n");
  await writeTextFile(
    join(workspaceRoot, ".claude", "CLAUDE.md"),
    "current local\n",
  );
  await writeTextFile(
    join(workspaceRoot, ".claude", "rules", "agent-harness.md"),
    "rule\n",
  );
  await writeTextFile(
    join(workspaceRoot, ".claude", "agents", "agent-harness.md"),
    "agent\n",
  );
  await writeTextFile(
    join(workspaceRoot, ".claude", "skills", "agent-harness", "SKILL.md"),
    "skill\n",
  );
  await writeTextFile(
    join(workspaceRoot, ".claude", "commands", "agent-harness.md"),
    "command\n",
  );

  await nativeWireInternals.cleanupFailedNativeHostApply(
    nativeWireInternals.nativeHostSpecs["claude-code"],
    workspaceRoot,
    claudeManagedRoot,
    claudeActivationRoot,
    [
      {
        path: join(workspaceRoot, "CLAUDE.md").replaceAll("\\", "/"),
        content: "snapshot\n",
      },
      {
        path: join(workspaceRoot, ".claude", "CLAUDE.md").replaceAll("\\", "/"),
        content: null,
      },
    ],
  );
  assert.equal(
    await readTextFileOrNull(join(workspaceRoot, "CLAUDE.md")),
    "snapshot\n",
  );
  assert.equal(
    await readTextFileOrNull(join(workspaceRoot, ".claude", "CLAUDE.md")),
    null,
  );
  assert.equal(
    await pathExists(
      join(workspaceRoot, ".claude", "rules", "agent-harness.md"),
    ),
    false,
  );

  const codexManagedRoot = join(
    workspaceRoot,
    ".agents",
    "plugins",
    "agent-harness",
  );
  const codexActivationRoot = join(root, "project", "activate", "codex");
  await writeTextFile(join(codexManagedRoot, "wire-plan.json"), "{}\n");
  await writeTextFile(join(codexActivationRoot, "wire-plan.json"), "{}\n");
  await writeTextFile(
    join(workspaceRoot, "AGENTS.md"),
    managedOnlySection("agent-harness-codex"),
  );
  await writeTextFile(
    join(workspaceRoot, ".agents", "skills", "agent-harness", "SKILL.md"),
    "skill\n",
  );
  await writeTextFile(
    join(
      workspaceRoot,
      ".agents",
      "plugins",
      "agent-harness",
      ".codex-plugin",
      "plugin.json",
    ),
    "{}\n",
  );
  await writeTextFile(
    join(workspaceRoot, ".agents", "plugins", "marketplace.json"),
    "{}\n",
  );
  await nativeWireInternals.cleanupFailedNativeHostApply(
    nativeWireInternals.nativeHostSpecs.codex,
    workspaceRoot,
    codexManagedRoot,
    codexActivationRoot,
    [],
  );
  assert.equal(
    await readTextFileOrNull(join(workspaceRoot, "AGENTS.md")),
    null,
  );
  assert.equal(
    await pathExists(join(workspaceRoot, ".agents", "skills", "agent-harness")),
    false,
  );
  assert.equal(
    await pathExists(
      join(workspaceRoot, ".agents", "plugins", "agent-harness"),
    ),
    false,
  );
  assert.equal(
    await pathExists(
      join(workspaceRoot, ".agents", "plugins", "marketplace.json"),
    ),
    false,
  );

  const piManagedRoot = join(workspaceRoot, ".pi", "agent-harness");
  const piActivationRoot = join(root, "project", "activate", "pi");
  await writeTextFile(join(piManagedRoot, "wire-plan.json"), "{}\n");
  await writeTextFile(join(piActivationRoot, "wire-plan.json"), "{}\n");
  await writeTextFile(join(workspaceRoot, "AGENTS.md"), "current agents\n");
  await writeTextFile(join(workspaceRoot, "SYSTEM.md"), "current system\n");
  await writeJsonFile(join(workspaceRoot, ".pi", "settings.json"), {
    skills: ["skills/agent-harness", "skills/keep", "skills/keep"],
    prompts: ["prompts/agent-harness.md"],
    agentHarness: true,
  });
  await writeTextFile(
    join(workspaceRoot, ".pi", "skills", "agent-harness", "SKILL.md"),
    "skill\n",
  );
  await writeTextFile(
    join(workspaceRoot, ".pi", "prompts", "agent-harness.md"),
    "prompt\n",
  );
  await nativeWireInternals.cleanupFailedNativeHostApply(
    nativeWireInternals.nativeHostSpecs.pi,
    workspaceRoot,
    piManagedRoot,
    piActivationRoot,
    [
      {
        path: join(workspaceRoot, "AGENTS.md").replaceAll("\\", "/"),
        content: null,
      },
      {
        path: join(workspaceRoot, "SYSTEM.md").replaceAll("\\", "/"),
        content: "system snapshot\n",
      },
    ],
  );
  assert.equal(
    await readTextFileOrNull(join(workspaceRoot, "AGENTS.md")),
    null,
  );
  assert.equal(
    await readTextFileOrNull(join(workspaceRoot, "SYSTEM.md")),
    "system snapshot\n",
  );
  assert.deepEqual(
    await readJsonFile(join(workspaceRoot, ".pi", "settings.json")),
    { skills: ["skills/keep", "skills/keep"] },
  );

  assert.throws(
    () =>
      nativeWireInternals.validateManagedTextFileSnapshots(
        {
          schemaVersion: 1,
          host: "zed",
          generatedAt: new Date().toISOString(),
          workspaceRoot,
          runtimeRoot: join(workspaceRoot, ".zed", "agent-harness"),
          textFileSnapshots: [
            {
              path: join(workspaceRoot, "outside.md").replaceAll("\\", "/"),
              content: null,
            },
          ],
          notes: [],
        } satisfies WirePlanManifest,
        [join(workspaceRoot, ".rules")],
        join(workspaceRoot, ".zed", "agent-harness", "wire-plan.json"),
      ),
    /outside the managed restore set/u,
  );

  assert.equal(nativeWireInternals.describeJsonValue([]), "array");
  assert.equal(nativeWireInternals.describeJsonValue(null), "null");
  assert.equal(nativeWireInternals.describeJsonValue({}), "object");
  assert.equal(nativeWireInternals.toLoggableErrorMessage("plain"), "plain");
  assert.deepEqual(
    nativeWireInternals.mergeJsonObjects(
      { existing: ["keep"], nested: { keep: true }, scalar: true },
      { existing: ["keep", "add", 1], nested: { add: true }, scalar: false },
    ),
    {
      existing: ["add", "keep"],
      nested: { keep: true, add: true },
      scalar: false,
    },
  );
  const settings: Record<string, unknown> = {};
  nativeWireInternals.removeManagedStringArrayEntries(settings, "missing", [
    "value",
  ]);
  assert.deepEqual(settings, {});
  assert.deepEqual(
    nativeWireInternals.mergeStringArraysPreservingOrder(
      ["a", "b"],
      ["b", "c"],
    ),
    ["a", "b", "c"],
  );
  await assert.rejects(
    nativeWireInternals.removeEmptyParentDirectories(
      join(root, "outside"),
      workspaceRoot,
    ),
    /within cleanup boundary/u,
  );

  const fileInsteadOfDirectory = join(workspaceRoot, "not-a-directory.txt");
  await writeTextFile(fileInsteadOfDirectory, "content");
  await assert.rejects(
    nativeWireInternals.removeEmptyParentDirectories(
      fileInsteadOfDirectory,
      workspaceRoot,
    ),
    /ENOTDIR|not a directory/u,
  );
});
