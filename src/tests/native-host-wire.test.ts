import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";

import {
  pathExists,
  readJsonFile,
  readTextFileOrNull,
  toPosixPath,
  writeJsonFile,
  writeTextFile,
} from "../files.js";
import {
  nativeWireInternals,
  wireNativeHost,
  type NativeWireHost,
} from "../host-adapters/native-wire.js";
import { resetPiNativeHost } from "../host-adapters/pi-native.js";
import {
  mergeJsonFile,
  restoreManagedSectionFromSnapshot,
} from "../host-adapters/native-utils.js";
import { sanitizeAssetId } from "../lib/safe-paths.js";
import type {
  ActivationManifest,
  AssetCatalogEntry,
  AssetHostNativeConfigMap,
  CopilotWorkspaceProfileManifest,
  ManagedTextFileSnapshot,
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
        `name: ${JSON.stringify(sanitizeAssetId("cursor.agent"))}`,
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
              // An unrelated user-owned entry that happens to share the
              // "agent-harness" NAME but not the managed identity (its path is
              // neither localSourcePath ./plugins/agent-harness nor legacyPath
              // ./agent-harness). isManagedMarketplaceEntry keys on identity,
              // not name alone — so this SAME-NAME user entry must survive both
              // apply and reset (review thread ...byOS).
              { name: "agent-harness", path: "./user-owned-same-name" },
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
              { name: "agent-harness", path: "./user-owned-same-name" },
              "ignored malformed entry",
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
        // Pre-existing marketplace.json survives reset with the
        // agent-harness entry removed (#447).
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
              { name: "agent-harness", path: "./user-owned-same-name" },
              "ignored malformed entry",
            ],
          },
        );
      }
    } finally {
      await fixture.cleanup();
    }
  }
});

void test("Codex plugin manifest omits hook registration when hook assets are absent", () => {
  const manifest = nativeWireInternals.buildCodexPluginManifest();
  assert.equal(manifest.name, "agent-harness");
  assert.equal(manifest.version, "2.1.0");
  assert.equal(manifest.skills, "./skills/");
  assert.equal("hooks" in manifest, false);
  assert.deepEqual(manifest.author, { name: "Agent Harness" });
  assert.deepEqual(manifest.interface, {
    displayName: "Agent Harness",
    shortDescription: "Curated project context and skills for Codex.",
    longDescription:
      "Project-local Agent Harness context, curated skills, and custom agents for OpenAI Codex.",
    developerName: "Agent Harness",
    category: "Productivity",
    capabilities: ["Project context", "Skills", "Custom agents"],
  });
});

void test("restoreManagedSectionFromSnapshot preserves other host sections in AGENTS.md", async () => {
  const fixture = await createNativeFixture("pi");
  try {
    const agentsPath = join(fixture.workspaceRoot, "AGENTS.md");
    // Pi section + Codex section coexist, pi reset removes only pi section
    await writeTextFile(
      agentsPath,
      "<!-- agent-harness-pi:begin -->\npi\n<!-- agent-harness-pi:end -->\n<!-- agent-harness-codex:begin -->\ncodex\n<!-- agent-harness-codex:end -->\n",
    );
    const snapshots: Array<{ path: string; content: string | null }> = [
      {
        path: toPosixPath(agentsPath),
        content:
          "<!-- agent-harness-codex:begin -->\ncodex\n<!-- agent-harness-codex:end -->\n",
      },
    ];
    await resetPiNativeHost(
      fixture.workspaceRoot,
      snapshots as ManagedTextFileSnapshot[],
    );
    const after = await readTextFileOrNull(agentsPath);
    assert.ok(after !== null);
    assert.ok(
      after.includes("agent-harness-codex:begin"),
      "codex section preserved",
    );
    assert.ok(!after.includes("agent-harness-pi:begin"), "pi section removed");
  } finally {
    await fixture.cleanup();
  }
});

void test("restoreManagedSectionFromSnapshot null-content snapshot preserves preexisting content", async () => {
  const fixture = await createNativeFixture("pi");
  try {
    const agentsPath = join(fixture.workspaceRoot, "AGENTS.md");
    await writeTextFile(
      agentsPath,
      "before\n<!-- agent-harness-pi:begin -->\npi\n<!-- agent-harness-pi:end -->\n",
    );
    const snapshots: Array<{ path: string; content: string | null }> = [
      { path: toPosixPath(agentsPath), content: null },
    ];
    await resetPiNativeHost(
      fixture.workspaceRoot,
      snapshots as ManagedTextFileSnapshot[],
    );
    const after = await readTextFileOrNull(agentsPath);
    assert.ok(after !== null);
    assert.ok(!after.includes("agent-harness-pi"));
    assert.ok(after.includes("before"), "preexisting text survives");
  } finally {
    await fixture.cleanup();
  }
});

void test("restoreManagedSectionFromSnapshot restores snapshot section version", async () => {
  const fixture = await createNativeFixture("pi");
  try {
    const agentsPath = join(fixture.workspaceRoot, "AGENTS.md");
    await writeTextFile(
      agentsPath,
      "<!-- agent-harness-pi:begin -->\nv1\n<!-- agent-harness-pi:end -->\n",
    );
    const snapshots: Array<{ path: string; content: string | null }> = [
      {
        path: toPosixPath(agentsPath),
        content:
          "<!-- agent-harness-pi:begin -->\nv2\n<!-- agent-harness-pi:end -->\n",
      },
    ];
    await resetPiNativeHost(
      fixture.workspaceRoot,
      snapshots as ManagedTextFileSnapshot[],
    );
    const after = await readTextFileOrNull(agentsPath);
    assert.ok(after !== null);
    assert.ok(!after.includes("v1"));
    assert.ok(after.includes("v2"));
  } finally {
    await fixture.cleanup();
  }
});

void test("restoreManagedSectionFromSnapshot inserts section when file absent", async () => {
  const fixture = await createNativeFixture("pi");
  try {
    const agentsPath = join(fixture.workspaceRoot, "AGENTS.md");
    const snapshots: ManagedTextFileSnapshot[] = [
      {
        path: toPosixPath(agentsPath),
        content:
          "<!-- agent-harness-pi:begin -->\nrestored\n<!-- agent-harness-pi:end -->\n",
      },
    ];
    await resetPiNativeHost(fixture.workspaceRoot, snapshots);
    const after = await readTextFileOrNull(agentsPath);
    assert.ok(after !== null);
    assert.ok(after.includes("restored"));
  } finally {
    await fixture.cleanup();
  }
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
      /Zed settings\.json is not a JSON object \(found array\)/u,
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
        // Section-scoped reset removes only the host's managed section,
        // preserving content from other hosts. The file may be deleted
        // if empty after section removal.
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
        // The adapter created marketplace.json on a fresh workspace, so
        // reset removes it entirely (#447) — no phantom managed file.
        assert.equal(
          await readTextFileOrNull(
            join(
              fixture.workspaceRoot,
              ".agents",
              "plugins",
              "marketplace.json",
            ),
          ),
          null,
          "adapter-created marketplace.json must be removed on reset",
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
    JSON.stringify({
      schemaVersion: 1,
      plugins: [
        { name: "agent-harness", path: "./agent-harness" },
        "non-object-entry",
        42,
        { name: "third-party-plugin", version: "2.0" },
      ],
    }),
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
  // Marketplace file is preserved with non-object entries intact (#374).
  // Verify the preserved content has the expected structure and retains
  // non-object values from the original plugins array.
  const mktContent = await readTextFileOrNull(
    join(workspaceRoot, ".agents", "plugins", "marketplace.json"),
  );
  assert.ok(mktContent !== null, "marketplace.json should be preserved");
  const mkt = JSON.parse(mktContent) as Record<string, unknown>;
  assert.ok(
    Array.isArray(mkt.plugins),
    "marketplace.json should still have a plugins array",
  );
  // No agent-harness entry remains in the filtered plugins
  const plugins = mkt.plugins as Array<unknown>;
  const pluginNames = plugins
    .filter(
      (p): p is Record<string, unknown> => typeof p === "object" && p !== null,
    )
    .map((p) => p.name);
  assert.ok(
    !pluginNames.includes("agent-harness"),
    "agent-harness plugin should be removed from marketplace",
  );
  // Non-object entries must survive the filter
  assert.ok(
    plugins.includes("non-object-entry"),
    "non-object string entry should be preserved in plugins",
  );
  assert.ok(
    plugins.includes(42),
    "non-object number entry should be preserved in plugins",
  );
  // Third-party plugin should still be present
  assert.ok(
    pluginNames.includes("third-party-plugin"),
    "third-party-plugin should survive agent-harness removal",
  );

  // Test non-array plugins field: marketplace with plugins as a string
  // should be handled gracefully without throwing.
  await writeTextFile(
    join(workspaceRoot, ".agents", "plugins", "marketplace.json"),
    JSON.stringify({ schemaVersion: 1, plugins: "not-an-array" }),
  );
  // create a minimal wire-plan so cleanup can find the managed root
  await writeTextFile(join(codexManagedRoot, "wire-plan.json"), "{}\n");
  await nativeWireInternals.cleanupFailedNativeHostApply(
    nativeWireInternals.nativeHostSpecs.codex,
    workspaceRoot,
    codexManagedRoot,
    codexActivationRoot,
    [],
  );
  const afterNonArray = await readTextFileOrNull(
    join(workspaceRoot, ".agents", "plugins", "marketplace.json"),
  );
  assert.ok(
    afterNonArray !== null,
    "marketplace.json preserved with non-array plugins",
  );
  const nonArrayMkt = JSON.parse(afterNonArray) as Record<string, unknown>;
  assert.deepEqual(nonArrayMkt.plugins, []);

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
  // Section-scoped restore: null-content snapshot means file absent,
  // but since no pi section exists, the file stays unchanged.
  assert.equal(
    await readTextFileOrNull(join(workspaceRoot, "AGENTS.md")),
    "current agents\n",
  );
  // Section-scoped restore: snapshot content is searched for pi section;
  // since none exists, current content is preserved.
  assert.equal(
    await readTextFileOrNull(join(workspaceRoot, "SYSTEM.md")),
    "current system\n",
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
      // Arrays are replaced directly from the patch (preserving order,
      // structure, and non-string entries) rather than merged via
      // uniqueStrings which would drop non-strings and reorder.
      existing: ["keep", "add", 1],
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

void test("restoreManagedSectionFromSnapshot removes file when snapshot section absent and file only contains managed section", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-native-restore-"));
  try {
    const agentsPath = join(root, "AGENTS.md");
    // Write AGENTS.md with ONLY the pi managed section
    await writeTextFile(
      agentsPath,
      "<!-- agent-harness-pi:begin -->\npi content\n<!-- agent-harness-pi:end -->\n",
    );
    // Snapshot has content but NO pi managed section markers
    const snapshots: ManagedTextFileSnapshot[] = [
      {
        path: toPosixPath(agentsPath),
        content: "# No pi section here\n\nJust other host stuff.\n",
      },
    ];
    let fallbackCalled = false;
    await restoreManagedSectionFromSnapshot(
      agentsPath,
      snapshots,
      "agent-harness-pi",
      async () => {
        fallbackCalled = true;
      },
    );
    assert.ok(
      !fallbackCalled,
      "fallback should not be called when snapshot exists",
    );
    const exists = await pathExists(agentsPath);
    assert.ok(
      !exists,
      "AGENTS.md should be removed when it only contains the managed section",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("mergeJsonFile merges patch into existing and new files", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-merge-json-"));
  try {
    const filePath = join(root, "settings.json");

    // Merge into non-existent file — currentValue is null path
    await mergeJsonFile(filePath, { key: "value" });
    const content1 = await readJsonFile<Record<string, unknown>>(filePath);
    assert.deepEqual(content1, { key: "value" });

    // Merge into existing file — currentValue is non-null path
    await mergeJsonFile(filePath, { another: "thing" });
    const content2 = await readJsonFile<Record<string, unknown>>(filePath);
    assert.deepEqual(content2, { key: "value", another: "thing" });

    // Merge overwrites existing keys
    await mergeJsonFile(filePath, { key: "updated" });
    const content3 = await readJsonFile<Record<string, unknown>>(filePath);
    assert.deepEqual(content3, { key: "updated", another: "thing" });

    // Merge into file with arrays: patch arrays replace directly
    const filePath2 = join(root, "array.json");
    await writeJsonFile(filePath2, {
      skills: ["security"],
      settings: { theme: "dark" },
    });
    await mergeJsonFile(filePath2, {
      skills: ["testing", "linting"],
      settings: { indent: 2 },
    });
    const content4 = await readJsonFile<Record<string, unknown>>(filePath2);
    assert.deepEqual(content4, {
      skills: ["testing", "linting"],
      settings: { theme: "dark", indent: 2 },
    });

    // Merge into empty object works
    const filePath3 = join(root, "empty.json");
    await writeJsonFile(filePath3, {});
    await mergeJsonFile(filePath3, { key: "value" });
    const content5 = await readJsonFile<Record<string, unknown>>(filePath3);
    assert.deepEqual(content5, { key: "value" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("restoreManagedSectionFromSnapshot handles snapshot with begin tag but no end tag", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "agent-harness-native-begin-only-"),
  );
  try {
    const agentsPath = join(root, "AGENTS.md");
    // Current file has the pi section
    await writeTextFile(
      agentsPath,
      "# Before\n<!-- agent-harness-pi:begin -->\npi\n<!-- agent-harness-pi:end -->\n",
    );
    // Snapshot has begin tag but NO end tag — endIdx === -1 branch
    const snapshots: ManagedTextFileSnapshot[] = [
      {
        path: toPosixPath(agentsPath),
        content: "# Other\n<!-- agent-harness-pi:begin -->\nbroken content\n",
      },
    ];
    await restoreManagedSectionFromSnapshot(
      agentsPath,
      snapshots,
      "agent-harness-pi",
      async () => {},
    );
    // No end tag → snapshotSection === null → section removed from current
    const after = await readTextFileOrNull(agentsPath);
    assert.ok(after !== null);
    assert.ok(!after.includes("agent-harness-pi"));
    assert.ok(after.includes("# Before"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("restoreManagedSectionFromSnapshot handles inline begin/end tags without newlines", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-native-inline-"));
  try {
    const agentsPath = join(root, "AGENTS.md");
    // Snapshot has begin and end tags inline on same line — endLineStart === -1 branch
    const snapshots: ManagedTextFileSnapshot[] = [
      {
        path: toPosixPath(agentsPath),
        content:
          "<!-- agent-harness-pi:begin -->inline-content<!-- agent-harness-pi:end -->",
      },
    ];
    // No current file — insert from snapshot
    await restoreManagedSectionFromSnapshot(
      agentsPath,
      snapshots,
      "agent-harness-pi",
      async () => {},
    );
    const after = await readTextFileOrNull(agentsPath);
    assert.ok(after !== null);
    assert.ok(after.includes("inline-content"));
    assert.ok(after.includes("agent-harness-pi:begin"));
    assert.ok(after.includes("agent-harness-pi:end"));
    // The begin marker must appear exactly once — the old bug included the
    // begin marker in the extracted section, causing duplication on restore.
    const beginCount = after.split("agent-harness-pi:begin").length - 1;
    assert.equal(
      beginCount,
      1,
      "begin marker must appear exactly once (not duplicated)",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("restoreManagedSectionFromSnapshot handles malformed begin marker without closing -->", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "agent-harness-native-malformed-begin-"),
  );
  try {
    const agentsPath = join(root, "AGENTS.md");
    // Current file has the pi section
    await writeTextFile(
      agentsPath,
      "# Before\n<!-- agent-harness-pi:begin -->\npi\n<!-- agent-harness-pi:end -->\n",
    );
    // Snapshot has begin tag but NO closing --> — beginCommentEnd === -1 path
    const snapshots: ManagedTextFileSnapshot[] = [
      {
        path: toPosixPath(agentsPath),
        content:
          "<!-- agent-harness-pi:begin broken marker with no closing comment\n",
      },
    ];
    await restoreManagedSectionFromSnapshot(
      agentsPath,
      snapshots,
      "agent-harness-pi",
      async () => {},
    );
    // Malformed begin marker → extractManagedSectionContent returns null →
    // falls through to section removal
    const after = await readTextFileOrNull(agentsPath);
    assert.ok(after !== null);
    assert.ok(!after.includes("agent-harness-pi"));
    assert.ok(after.includes("# Before"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("mergeJsonObjects preserves array ordering and non-string entries", () => {
  // Arrays are replaced directly from the patch — ordering is preserved
  // (uniqueStrings would deduplicate/sort) and non-string entries survive
  // (uniqueStrings would filter them out).

  // Ordering: patch array order is kept, not sorted
  assert.deepEqual(
    nativeWireInternals.mergeJsonObjects(
      { items: ["a", "b"] },
      { items: ["z", "a", "m", "b"] },
    ),
    { items: ["z", "a", "m", "b"] },
  );

  // Non-string entries preserved (objects, numbers, booleans, null)
  assert.deepEqual(
    nativeWireInternals.mergeJsonObjects(
      { items: ["old"] },
      {
        items: [{ name: "structured" }, 42, true, null, "string"],
      },
    ),
    {
      items: [{ name: "structured" }, 42, true, null, "string"],
    },
  );

  // Nested objects still merge recursively
  assert.deepEqual(
    nativeWireInternals.mergeJsonObjects(
      { config: { host: "localhost", port: 3000 } },
      { config: { host: "production", debug: false } },
    ),
    { config: { host: "production", port: 3000, debug: false } },
  );

  // Scalars are replaced, not merged
  assert.deepEqual(
    nativeWireInternals.mergeJsonObjects(
      { mode: "read", count: 1 },
      { mode: "write", active: true },
    ),
    { mode: "write", count: 1, active: true },
  );
});

// ---------------------------------------------------------------------------
// formatWirePreviewManifest — structured preview output (#403)
// ---------------------------------------------------------------------------

const { formatWirePreviewManifest } = nativeWireInternals;

void test("formatWirePreviewManifest produces structured output", () => {
  const preview = {
    schemaVersion: 1,
    mode: "preview" as const,
    host: "cursor",
    generatedAt: "2026-07-31T00:00:00Z",
    workspaceRoot: "/c/Projects/test",
    targetPaths: ["/path/to/settings.json", "/path/to/mcp.json"],
    notes: ["note-1", "note-2"],
  };

  const output = formatWirePreviewManifest(preview);

  assert.ok(output.includes("wire cursor — plan preview"));
  assert.ok(output.includes("host: cursor"));
  assert.ok(output.includes("workspace: /c/Projects/test"));
  assert.ok(output.includes("Target paths (2):"));
  assert.ok(output.includes("/path/to/settings.json"));
  assert.ok(output.includes("/path/to/mcp.json"));
  assert.ok(output.includes("Notes:"));
  assert.ok(output.includes("note-1"));
  assert.ok(output.includes("note-2"));
});

void test("formatWirePreviewManifest handles empty targetPaths and notes", () => {
  const preview = {
    schemaVersion: 1,
    mode: "preview" as const,
    host: "codex",
    generatedAt: "2026-07-31T00:00:00Z",
    workspaceRoot: "/tmp",
    targetPaths: [] as string[],
    notes: [] as string[],
  };

  const output = formatWirePreviewManifest(preview);

  assert.ok(output.includes("wire codex — plan preview"));
  assert.ok(!output.includes("Target paths"));
  assert.ok(!output.includes("Notes:"));
});
