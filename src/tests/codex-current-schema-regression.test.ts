import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildCodexHooksManifest,
  mergeCodexPluginMarketplace,
  resetCodexNativeHost,
  writeCodexNativeFiles,
} from "../host-adapters/codex-native.js";
import { nativeWireInternals } from "../host-adapters/native-wire.js";
import type {
  MaterializedNativeAssets,
  NativeAsset,
} from "../host-adapters/native-utils.js";
import { pathExists, writeJsonFile } from "../files.js";
import { sanitizeAssetId } from "../lib/safe-paths.js";

/** Computes the deterministic Codex profile filename for an asset id. */
function codexProfileFileName(assetId: string): string {
  const slug = sanitizeAssetId(assetId).replace(/[^a-zA-Z0-9_-]+/gu, "-");
  return `agent-harness-${slug}.toml`;
}

void test("native preview specs advertise the current Claude and Codex managed paths", () => {
  const codexPaths =
    nativeWireInternals.nativeHostSpecs.codex.targetPathSegments.map(
      (segments) => segments.join("/"),
    );
  assert.ok(
    codexPaths.includes("plugins/agent-harness/.codex-plugin/plugin.json"),
  );
  assert.ok(codexPaths.includes(".agents/plugins/marketplace.json"));
  assert.ok(!codexPaths.includes(".codex/hooks.json"));

  const claudePaths = nativeWireInternals.nativeHostSpecs[
    "claude-code"
  ].targetPathSegments.map((segments) => segments.join("/"));
  assert.ok(
    claudePaths.includes("plugins/agent-harness/.claude-plugin/plugin.json"),
  );
  assert.ok(claudePaths.includes(".claude-plugin/marketplace.json"));
});

void test("Codex wire emits current marketplace, plugin manifest, and project custom-agent TOML", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-current-"),
  );
  try {
    const marketplacePath = join(
      workspaceRoot,
      ".agents",
      "plugins",
      "marketplace.json",
    );
    await writeJsonFile(marketplacePath, {
      name: "team-marketplace",
      interface: { displayName: "Team Marketplace" },
      plugins: [
        {
          name: "existing",
          source: { source: "local", path: "./plugins/existing" },
          policy: {
            installation: "AVAILABLE",
            authentication: "ON_INSTALL",
          },
          category: "Productivity",
        },
      ],
    });

    const nativeAssets: NativeAsset[] = [
      nativeAsset("codex.skill", "skill", "Skill body"),
      nativeAsset("codex.agent", "agent", "Agent body\nwith multiple lines"),
      nativeAsset("codex.hook", "hook", "not a structured Codex hook"),
    ];
    await writeCodexNativeFiles({
      workspaceRoot,
      managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
      nativeAssets,
      materializedAssets: emptyMaterializedAssets(),
      mcpServers: [],
    });

    const marketplace = JSON.parse(
      await readFile(marketplacePath, "utf8"),
    ) as Record<string, unknown> & {
      plugins: Array<Record<string, unknown>>;
    };
    assert.equal("schemaVersion" in marketplace, false);
    assert.deepEqual(marketplace.interface, {
      displayName: "Team Marketplace",
    });
    const managedEntry = marketplace.plugins.find(
      (plugin) => plugin.name === "agent-harness",
    );
    assert.deepEqual(managedEntry, {
      name: "agent-harness",
      source: { source: "local", path: "./plugins/agent-harness" },
      policy: {
        installation: "AVAILABLE",
        authentication: "ON_INSTALL",
      },
      category: "Productivity",
    });
    assert.ok(marketplace.plugins.some((plugin) => plugin.name === "existing"));

    const manifest = JSON.parse(
      await readFile(
        join(
          workspaceRoot,
          "plugins",
          "agent-harness",
          ".codex-plugin",
          "plugin.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.equal(manifest.name, "agent-harness");
    assert.equal(manifest.version, "2.1.0");
    assert.equal(manifest.skills, "./skills/");
    assert.equal("hooks" in manifest, false);
    assert.deepEqual(
      (manifest.interface as Record<string, unknown>).displayName,
      "Agent Harness",
    );
    assert.equal(buildCodexHooksManifest(), null);

    const agentFiles = await readdir(join(workspaceRoot, ".codex", "agents"));
    const managedAgents = agentFiles.filter(
      (file) => file.startsWith("agent-harness-") && file.endsWith(".toml"),
    );
    assert.equal(managedAgents.length, 1);
    const agentToml = await readFile(
      join(workspaceRoot, ".codex", "agents", managedAgents[0]),
      "utf8",
    );
    assert.match(agentToml, /^name = "codex\.agent"/mu);
    assert.match(
      agentToml,
      /developer_instructions = "Agent body\\nwith multiple lines"/u,
    );

    await assert.rejects(
      readFile(join(workspaceRoot, ".codex", "hooks.json"), "utf8"),
      { code: "ENOENT" },
    );
    await assert.rejects(
      readFile(
        join(
          workspaceRoot,
          ".agents",
          "plugins",
          "agent-harness",
          ".codex-plugin",
          "plugin.json",
        ),
        "utf8",
      ),
      { code: "ENOENT" },
    );

    await resetCodexNativeHost(workspaceRoot, undefined);
    await assert.rejects(
      readFile(
        join(
          workspaceRoot,
          "plugins",
          "agent-harness",
          ".codex-plugin",
          "plugin.json",
        ),
        "utf8",
      ),
      { code: "ENOENT" },
    );
    const remainingAgentFiles = await readdir(
      join(workspaceRoot, ".codex", "agents"),
    ).catch(() => []);
    assert.equal(
      remainingAgentFiles.some((file) => file.startsWith("agent-harness-")),
      false,
    );

    const resetMarketplace = JSON.parse(
      await readFile(marketplacePath, "utf8"),
    ) as { plugins: Array<{ name: string }> };
    assert.deepEqual(
      resetMarketplace.plugins.map((plugin) => plugin.name),
      ["existing"],
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("legacy Codex marketplaces are preserved non-destructively", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-legacy-"),
  );
  try {
    const marketplacePath = join(
      workspaceRoot,
      ".agents",
      "plugins",
      "marketplace.json",
    );
    await writeJsonFile(marketplacePath, {
      schemaVersion: 2,
      interface: { displayName: 42 },
      plugins: [{ name: "existing", path: "./existing" }],
    });

    await writeCodexNativeFiles({
      workspaceRoot,
      managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
      nativeAssets: [nativeAsset("codex.skill", "skill", "Skill")],
      materializedAssets: emptyMaterializedAssets(),
      mcpServers: [],
    });

    const marketplace = JSON.parse(await readFile(marketplacePath, "utf8")) as {
      schemaVersion: number;
      plugins: Array<Record<string, unknown>>;
    };
    assert.equal(marketplace.schemaVersion, 2);
    assert.deepEqual(
      marketplace.plugins.find((plugin) => plugin.name === "agent-harness"),
      { name: "agent-harness", path: "./agent-harness" },
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex marketplace preserves a user-owned same-name plugin on apply and reset", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-marketplace-owner-"),
  );
  try {
    const marketplacePath = join(
      workspaceRoot,
      ".agents",
      "plugins",
      "marketplace.json",
    );
    const userOwnedEntry = {
      name: "agent-harness",
      source: {
        source: "github",
        repo: "example-user/external-agent-harness",
        ref: "v9.9.9",
      },
      policy: { installation: "MANUAL", authentication: "NONE" },
    };
    await writeJsonFile(marketplacePath, {
      name: "team-marketplace",
      interface: { displayName: "Team Marketplace" },
      plugins: [userOwnedEntry],
    });

    await mergeCodexPluginMarketplace(marketplacePath);
    const merged = JSON.parse(await readFile(marketplacePath, "utf8")) as {
      plugins: Array<Record<string, unknown>>;
    };
    assert.deepEqual(merged.plugins[0], userOwnedEntry);
    assert.ok(
      merged.plugins.some(
        (plugin) =>
          plugin.name === "agent-harness" &&
          typeof plugin.source === "object" &&
          plugin.source !== null &&
          (plugin.source as Record<string, unknown>).path ===
            "./plugins/agent-harness",
      ),
    );

    await resetCodexNativeHost(workspaceRoot, undefined);
    const reset = JSON.parse(await readFile(marketplacePath, "utf8")) as {
      plugins: Array<Record<string, unknown>>;
    };
    assert.deepEqual(reset.plugins, [userOwnedEntry]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("current Codex marketplace repairs a non-string interface display name", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-interface-edge-"),
  );
  try {
    const marketplacePath = join(
      workspaceRoot,
      ".agents",
      "plugins",
      "marketplace.json",
    );
    await writeJsonFile(marketplacePath, {
      interface: { displayName: 42 },
      plugins: [],
    });

    assert.equal(await mergeCodexPluginMarketplace(marketplacePath), "current");
    const marketplace = JSON.parse(await readFile(marketplacePath, "utf8")) as {
      interface: { displayName: unknown };
    };
    assert.equal(marketplace.interface.displayName, "Agent Harness Local");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("legacy layout is detected from a path-only entries array (no schemaVersion)", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-legacy-array-edge-"),
  );
  try {
    const marketplacePath = join(
      workspaceRoot,
      ".agents",
      "plugins",
      "marketplace.json",
    );
    // No schemaVersion, a non-object entry in the array, and an object entry
    // whose `path` selects legacy — covers every isLegacyCodexMarketplace
    // predicate outcome (isJsonObject false, then path-string true).
    await writeJsonFile(marketplacePath, {
      plugins: ["non-object-entry", { name: "existing", path: "./existing" }],
    });

    assert.equal(await mergeCodexPluginMarketplace(marketplacePath), "legacy");
    const marketplace = JSON.parse(await readFile(marketplacePath, "utf8")) as {
      plugins: Array<unknown>;
    };
    assert.equal(marketplace.plugins[0], "non-object-entry");
    assert.deepEqual(
      (marketplace.plugins as Array<Record<string, unknown>>).find(
        (plugin) => plugin.name === "agent-harness",
      ),
      { name: "agent-harness", path: "./agent-harness" },
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex reset rethrows unexpected agent-profile directory errors", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-reset-edge-"),
  );
  try {
    await mkdir(join(workspaceRoot, ".codex"), { recursive: true });
    await writeFile(join(workspaceRoot, ".codex", "agents"), "not-a-directory");
    await assert.rejects(resetCodexNativeHost(workspaceRoot, undefined), {
      code: "ENOTDIR",
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex reset preserves an unmarked plugin and tolerates a missing agents path", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-reset-missing-path-"),
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
    await resetCodexNativeHost(workspaceRoot, undefined);
    assert.equal(await readFile(userFile, "utf8"), "user content\n");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex write refuses to claim a pre-existing unmarked plugin directory", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-claim-guard-"),
  );
  try {
    // A user-owned plugin directory that already exists WITHOUT our marker is
    // a collision, not an adoptable directory (Greptile P1).
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(
      join(pluginRoot, "user-owned.md"),
      "user content\n",
      "utf8",
    );

    await assert.rejects(
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: [nativeAsset("codex.agent", "agent", "Agent body")],
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
    // Atomic apply (the claim-first arm): the rejected collision must NOT have
    // left ANY managed file behind — no AGENTS.md section, no managed SKILL.md
    // path (Greptile P1: the old order wrote both before claiming, orphaning
    // active Agent Harness config behind a reported failure).
    assert.equal(
      await pathExists(join(workspaceRoot, "AGENTS.md")),
      false,
      "AGENTS.md must not be written when the plugin claim rejects",
    );
    assert.equal(
      await pathExists(
        join(workspaceRoot, ".agents", "skills", "agent-harness"),
      ),
      false,
      "managed .agents/skills/agent-harness must not be written when the plugin claim rejects",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex late write failure rolls back all managed state atomic-apply style", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-latefail-"),
  );
  try {
    // Seed a pre-existing user AGENTS.md so the rollback must RESTORE it
    // byte-for-byte rather than delete it (review: snapshot-restore, not
    // delete-rollback).
    await writeFile(
      join(workspaceRoot, "AGENTS.md"),
      "# User AGENTS\nuser content untouched by harness\n",
      "utf8",
    );
    // Also seed a pre-existing (user) managed SKILL.md the apply overwrites,
    // so the rollback must restore IT byte-for-byte too, not delete it.
    const userManagedSkill = join(
      workspaceRoot,
      ".agents",
      "skills",
      "agent-harness",
      "SKILL.md",
    );
    await mkdir(join(userManagedSkill, ".."), { recursive: true });
    await writeFile(
      userManagedSkill,
      "# User Codex skill\nuser skill content\n",
      "utf8",
    );
    // Force a failure AFTER AGENTS.md (upsert) is written: make `.codex` a
    // FILE so writeCodexAgentProfiles throws when it tries to create
    // `.codex/agents`. The precheck (plugin adoptability) passes, so only the
    // later write step fails (Greptile P1: "Late write failure leaves managed
    // state").
    await writeFile(join(workspaceRoot, ".codex"), "not-a-directory\n", "utf8");

    await assert.rejects(
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: [nativeAsset("codex.agent", "agent", "Agent body")],
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      }),
    );

    // The pre-existing user AGENTS.md must be restored byte-for-byte — NOT
    // deleted.
    assert.equal(
      await readFile(join(workspaceRoot, "AGENTS.md"), "utf8"),
      "# User AGENTS\nuser content untouched by harness\n",
      "user AGENTS.md restored byte-for-byte on late write failure",
    );
    // The pre-existing (user) SKILL.md must be restored byte-for-byte — NOT
    // deleted.
    assert.equal(
      await readFile(
        join(workspaceRoot, ".agents", "skills", "agent-harness", "SKILL.md"),
        "utf8",
      ),
      "# User Codex skill" + "\n" + "user skill content" + "\n",
      "user managed SKILL.md restored byte-for-byte on late write failure",
    );
    // The claimed plugin dir (harness-owned, freshly created) is removed.
    assert.equal(
      await pathExists(join(workspaceRoot, "plugins", "agent-harness")),
      false,
      "plugin dir rolled back on late write failure",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex late write failure rolls back legacy layout plugin roots too", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-latefail-legacy-"),
  );
  try {
    // Legacy-shaped marketplace routes the managed plugin to the nested
    // `.agents/plugins/agent-harness` root; a late failure must roll back BOTH
    // claimed roots + AGENTS.md + skills (Greptile P1: non-atomic apply).
    const marketplacePath = join(
      workspaceRoot,
      ".agents",
      "plugins",
      "marketplace.json",
    );
    await mkdir(join(workspaceRoot, ".agents", "plugins"), { recursive: true });
    await writeJsonFile(marketplacePath, {
      schemaVersion: 2,
      plugins: [{ name: "existing", path: "./existing" }],
    });
    // Force the late write failure after both roots are claimed.
    await writeFile(join(workspaceRoot, ".codex"), "not-a-directory\n", "utf8");

    await assert.rejects(
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: [nativeAsset("codex.agent", "agent", "Agent body")],
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      }),
    );

    assert.equal(
      await pathExists(join(workspaceRoot, "plugins", "agent-harness")),
      false,
      "current-layout plugin dir rolled back on legacy late failure",
    );
    assert.equal(
      await pathExists(
        join(workspaceRoot, ".agents", "plugins", "agent-harness"),
      ),
      false,
      "legacy-layout plugin root rolled back on late failure",
    );
    assert.equal(
      await pathExists(join(workspaceRoot, "AGENTS.md")),
      false,
      "AGENTS.md rolled back on legacy late failure",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex write refuses a legacy unmarked .agents/plugins/agent-harness with zero writes", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-legacy-claim-guard-"),
  );
  try {
    // A legacy-shaped marketplace routes the managed plugin to the NESTED
    // `.agents/plugins/agent-harness` root. A pre-existing unmarked dir there
    // is a user-owned collision that must reject BEFORE AGENTS.md / SKILL.md
    // are written — not after the fallback legacy layout is discovered.
    const legacyRoot = join(
      workspaceRoot,
      ".agents",
      "plugins",
      "agent-harness",
    );
    await mkdir(legacyRoot, { recursive: true });
    await writeFile(
      join(legacyRoot, "user-owned.md"),
      "user content\n",
      "utf8",
    );
    await writeJsonFile(
      join(workspaceRoot, ".agents", "plugins", "marketplace.json"),
      {
        schemaVersion: 2,
        plugins: [{ name: "existing", path: "./existing" }],
      },
    );

    await assert.rejects(
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: [nativeAsset("codex.agent", "agent", "Agent body")],
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      }),
      /Refusing to claim existing unmarked agent-harness plugin directory/u,
    );
    assert.equal(
      await readFile(join(legacyRoot, "user-owned.md"), "utf8"),
      "user content\n",
    );
    // None of the managed files may have been written before the reject.
    assert.equal(
      await pathExists(join(workspaceRoot, "AGENTS.md")),
      false,
      "AGENTS.md must not be written when the legacy claim rejects",
    );
    assert.equal(
      await pathExists(
        join(workspaceRoot, ".agents", "skills", "agent-harness"),
      ),
      false,
      "managed .agents/skills/agent-harness must not be written when the legacy claim rejects",
    );
    assert.equal(
      await pathExists(join(workspaceRoot, "plugins", "agent-harness")),
      false,
      "the top-level managed plugin must not be written when the legacy claim rejects",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex write re-adopts an already-marked plugin directory", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-readopt-"),
  );
  try {
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    // Our marker proves prior Agent Harness ownership; re-apply is safe.
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });

    await writeCodexNativeFiles({
      workspaceRoot,
      managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
      nativeAssets: [nativeAsset("codex.agent", "agent", "Agent body")],
      materializedAssets: emptyMaterializedAssets(),
      mcpServers: [],
    });

    const manifest = JSON.parse(
      await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"),
    ) as { name: string };
    assert.equal(manifest.name, "agent-harness");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex reset restores a displaced user-owned agent profile instead of deleting it", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-profile-restore-"),
  );
  try {
    // Pre-existing user-owned profile whose deterministic name collides with
    // what the adapter writes (Greptile P1).
    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const collidingProfile = join(
      agentsDir,
      codexProfileFileName("codex.agent"),
    );
    await writeFile(collidingProfile, "user TOML content\n", "utf8");

    // Keep the plugin dir owned so write succeeds; only the profile collision
    // matters for this assertion. Ensure the plugin dir is marked (re-apply).
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });

    await writeCodexNativeFiles({
      workspaceRoot,
      managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
      nativeAssets: [nativeAsset("codex.agent", "agent", "Agent body")],
      materializedAssets: emptyMaterializedAssets(),
      mcpServers: [],
    });
    // Apply displaced the user profile with harness content.
    await assert.match(
      await readFile(collidingProfile, "utf8"),
      /^name = "codex\.agent"/mu,
    );

    await resetCodexNativeHost(workspaceRoot, undefined);
    // Reset restores the pre-apply user content rather than deleting the file.
    assert.equal(
      await readFile(collidingProfile, "utf8"),
      "user TOML content\n",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex reset preserves unrelated agent-harness-prefixed profiles when no ownership record exists", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-norecord-"),
  );
  try {
    // No apply ran here, so no ownership manifest exists. A user-owned
    // `agent-harness-*.toml` in the agents dir must NOT be prefix-deleted.
    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const userProfile = join(agentsDir, "agent-harness-user-custom.toml");
    await writeFile(userProfile, "user custom profile\n", "utf8");

    await resetCodexNativeHost(workspaceRoot, undefined);
    assert.equal(await readFile(userProfile, "utf8"), "user custom profile\n");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex re-apply preserves the original priorContent and the manifest is removed on reset", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-readd-"),
  );
  try {
    // Keep the plugin dir owned so write succeeds; the profile ownership is
    // what this test exercises.
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });

    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const collidingProfile = join(
      agentsDir,
      codexProfileFileName("codex.agent"),
    );
    // User-owned colliding profile displaced by the first apply.
    await writeFile(collidingProfile, "user ORIGINAL content\n", "utf8");

    const firstApply = () =>
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: [nativeAsset("codex.agent", "agent", "Agent body")],
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      });

    await firstApply();
    await assert.match(
      await readFile(collidingProfile, "utf8"),
      /^name = "codex\.agent"/mu,
    );

    // Re-apply over the harness-written file must NOT re-snapshot harness
    // bytes as the new "prior" — the original user content must survive.
    await firstApply();

    await resetCodexNativeHost(workspaceRoot, undefined);
    assert.equal(
      await readFile(collidingProfile, "utf8"),
      "user ORIGINAL content\n",
    );
    // The ownership manifest itself must not dangle in the user's tree.
    assert.equal(
      await pathExists(join(agentsDir, ".agent-harness-profiles.json")),
      false,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex no-agent re-apply consumes profile ownership: restores displaced user content", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-noagent-reapply-"),
  );
  try {
    // Keep the plugin dir owned so write succeeds; the profile ownership is
    // what this test exercises.
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });
    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const collidingProfile = join(
      agentsDir,
      codexProfileFileName("codex.agent"),
    );
    // User-owned colliding profile displaced by the first (agent) apply.
    await writeFile(collidingProfile, "user ORIGINAL content\n", "utf8");

    const applyWithAgents = () =>
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: [nativeAsset("codex.agent", "agent", "Agent body")],
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      });
    const applyWithoutAgents = () =>
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: [nativeAsset("codex.skill", "skill", "Skill body")],
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      });

    await applyWithAgents();
    await assert.match(
      await readFile(collidingProfile, "utf8"),
      /^name = "codex\.agent"/mu,
    );

    // Re-apply WITHOUT agent assets must consume the previous ownership:
    // restore the displaced user profile, remove the generated one, and drop
    // the manifest — so nothing strands in the tree (Greptile P1 / CodeRabbit).
    await applyWithoutAgents();
    assert.equal(
      await readFile(collidingProfile, "utf8"),
      "user ORIGINAL content\n",
      "displaced user content restored by the no-agent re-apply",
    );
    assert.equal(
      await pathExists(join(agentsDir, ".agent-harness-profiles.json")),
      false,
      "ownership manifest consumed by the no-agent re-apply",
    );

    // A later reset is profile-safe and must not disturb the restored file.
    await resetCodexNativeHost(workspaceRoot, undefined);
    assert.equal(
      await readFile(collidingProfile, "utf8"),
      "user ORIGINAL content\n",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex reset drops hostile profile-manifest entries instead of traversing outside .codex/agents", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-hostile-"),
  );
  try {
    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    // A real file OUTSIDE the agents dir that a traversal would try to reach.
    const outside = join(workspaceRoot, "escape-target.toml");
    await writeFile(outside, "keep me\n", "utf8");
    // A real non-managed user profile that must NOT be touched (no prefix).
    const userProfile = join(agentsDir, "user.toml");
    await writeFile(userProfile, "user\n", "utf8");
    // A real mis-typed priorContent record must be ignored, not written over.
    const misTyped = join(agentsDir, codexProfileFileName("bad.agent"));
    await writeFile(misTyped, "harness-written\n", "utf8");
    // A harness-created profile that IS validly owned → removed on reset
    // (record carries a real contentFingerprint matching the live bytes, so
    // removal-by-byte-match is proven).
    const okProfile = join(agentsDir, codexProfileFileName("ok.agent"));
    await writeFile(okProfile, "generated\n", "utf8");
    // A legacy fingerprint-less record (predates the contentFingerprint field):
    // reset/preserve must NOT delete or restore it — we can't prove we own the
    // bytes ("never delete what we can't prove we own" / Gap 2).
    const legacyProfile = join(agentsDir, codexProfileFileName("legacy.agent"));
    await writeFile(legacyProfile, "user EDITED legacy\n", "utf8");

    await writeJsonFile(join(agentsDir, ".agent-harness-profiles.json"), {
      schemaVersion: 1,
      profiles: [
        { fileName: "../../escape-target.toml", priorContent: null },
        { fileName: "user.toml", priorContent: null },
        { fileName: codexProfileFileName("bad.agent"), priorContent: 42 },
        {
          fileName: codexProfileFileName("badfingerprint.agent"),
          priorContent: null,
          contentFingerprint: 42,
        },
        {
          fileName: codexProfileFileName("badowned.agent"),
          priorContent: null,
          userOwned: "yes",
        },
        {
          fileName: codexProfileFileName("ok.agent"),
          priorContent: null,
          contentFingerprint:
            "9f5936ff15d3a2ba7d3d8f21858338a6c1e2adc9fe34c685c7de5b4a00caa29a",
        },
        {
          fileName: codexProfileFileName("legacy.agent"),
          priorContent: null,
        },
        "not-an-object",
        { fileName: 42, priorContent: null },
      ],
    });

    await resetCodexNativeHost(workspaceRoot, undefined);

    assert.equal(
      await readFile(outside, "utf8"),
      "keep me\n",
      "path-traversal filename must not escape .codex/agents",
    );
    assert.equal(
      await readFile(userProfile, "utf8"),
      "user\n",
      "non-prefixed profile preserved",
    );
    assert.equal(
      await readFile(misTyped, "utf8"),
      "harness-written\n",
      "mis-typed priorContent record ignored (over-preservation)",
    );
    assert.equal(
      await pathExists(okProfile),
      false,
      "validly-owned harness profile removed",
    );
    assert.equal(
      await readFile(legacyProfile, "utf8"),
      "user EDITED legacy\n",
      "legacy fingerprint-less profile preserved by reset (never deleted/restored)",
    );
    // The retained legacy profile keeps a refreshed manifest so a later apply
    // still recognizes it as owned rather than treating it as untracked.
    const retainedManifest = JSON.parse(
      await readFile(join(agentsDir, ".agent-harness-profiles.json"), "utf8"),
    ) as { profiles: Array<{ fileName: string; userOwned?: boolean }> };
    assert.ok(
      Array.isArray(retainedManifest.profiles) &&
        retainedManifest.profiles.length === 1 &&
        retainedManifest.profiles.every(
          (p) =>
            p.fileName === codexProfileFileName("legacy.agent") &&
            p.userOwned === true,
        ),
      "only the preserved legacy profile survives in the retained manifest, marked userOwned",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex reset preserves a user-owned fresh-shaped marketplace it did not create", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-market-userowned-"),
  );
  try {
    const marketplacePath = join(
      workspaceRoot,
      ".agents",
      "plugins",
      "marketplace.json",
    );
    const ownershipManifest = join(
      workspaceRoot,
      ".agents",
      "plugins",
      ".agent-harness-marketplace.json",
    );
    // A user-owned `agent-harness-local` marketplace that matches the managed
    // shape but that Agent Harness never created must survive reset
    // (Greptile P1: never infer whole-file ownership from a shape heuristic).
    const userOwned = {
      name: "agent-harness-local",
      interface: { displayName: "User's own local shopping list" },
      plugins: [],
    };
    await writeJsonFile(marketplacePath, userOwned);

    await resetCodexNativeHost(workspaceRoot, undefined);

    assert.deepEqual(
      JSON.parse(await readFile(marketplacePath, "utf8")),
      userOwned,
      "user-owned fresh-shaped marketplace must survive reset (Greptile P1)",
    );
    assert.equal(
      await pathExists(ownershipManifest),
      false,
      "no ownership manifest dangles in the user's tree",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex reset deletes only marketplace files Agent Harness actually created", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-market-created-"),
  );
  try {
    const marketplacePath = join(
      workspaceRoot,
      ".agents",
      "plugins",
      "marketplace.json",
    );
    const ownershipManifest = join(
      workspaceRoot,
      ".agents",
      "plugins",
      ".agent-harness-marketplace.json",
    );
    // (a) Agent Harness created the file from scratch on apply → records
    //     whole-file ownership and reset deletes it entirely.
    await mergeCodexPluginMarketplace(marketplacePath);
    assert.equal(await pathExists(marketplacePath), true);
    assert.equal(await pathExists(ownershipManifest), true);

    // (b) A managed file the user edited after apply is stripped of the
    //     managed entry but never wholesale-deleted.
    await writeJsonFile(marketplacePath, {
      name: "agent-harness-local",
      interface: { displayName: "Agent Harness Local" },
      plugins: [
        {
          name: "agent-harness",
          source: { source: "local", path: "./plugins/agent-harness" },
          policy: {
            installation: "AVAILABLE",
            authentication: "ON_INSTALL",
          },
          category: "Productivity",
        },
      ],
      provenance: "user edit",
    });

    await resetCodexNativeHost(workspaceRoot, undefined);

    // (a) swallowed a fresh-shaped file; (b) survives (extra key → not the
    // pristine managed shape), with the managed entry stripped.
    const survivor = JSON.parse(await readFile(marketplacePath, "utf8")) as {
      provenance?: string;
      plugins: unknown[];
    };
    assert.equal(survivor.provenance, "user edit");
    assert.deepEqual(survivor.plugins, []);
    assert.equal(await pathExists(ownershipManifest), false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex marketplace ownership survives an unchanged reapply so reset removes the harness-created file", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-market-reapply-"),
  );
  try {
    const marketplacePath = join(
      workspaceRoot,
      ".agents",
      "plugins",
      "marketplace.json",
    );
    const ownershipManifest = join(
      workspaceRoot,
      ".agents",
      "plugins",
      ".agent-harness-marketplace.json",
    );
    // First apply creates the marketplace from nothing → records created:true.
    await mergeCodexPluginMarketplace(marketplacePath);
    assert.equal(await pathExists(marketplacePath), true);
    assert.equal(await pathExists(ownershipManifest), true);

    // Unchanged reapply: the file now exists, so createdNow would be false —
    // but the prior created:true ownership must be PRESERVED (Greptile P1:
    // "marketplace ownership is lost on reapply").
    await mergeCodexPluginMarketplace(marketplacePath);
    const ownership = JSON.parse(await readFile(ownershipManifest, "utf8")) as {
      created: boolean;
    };
    assert.equal(ownership.created, true);

    // Reset must therefore still delete the whole harness-created file.
    await resetCodexNativeHost(workspaceRoot, undefined);
    assert.equal(
      await pathExists(marketplacePath),
      false,
      "marketplace created by harness and reapplied unchanged is deleted on reset",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex reapply with a smaller agent set reconciles orphaned profiles", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-reduced-set-"),
  );
  try {
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });

    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const alphaProfile = join(agentsDir, codexProfileFileName("codex.alpha"));
    const betaProfile = join(agentsDir, codexProfileFileName("codex.beta"));
    const gammaProfile = join(agentsDir, codexProfileFileName("codex.gamma"));
    // beta displaces a user-owned profile on the first apply.
    await writeFile(betaProfile, "user BETA content\n", "utf8");
    // gamma does NOT pre-exist, so apply creates it as a pure harness-owned
    // profile (priorContent null → the removePath reconcile arm).

    const apply = (assetIds: string[]) =>
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: assetIds.map((id) =>
          nativeAsset(id, "agent", `${id} body`),
        ),
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      });

    await apply(["codex.alpha", "codex.beta", "codex.gamma"]);
    assert.equal(await pathExists(alphaProfile), true);
    assert.equal(await pathExists(betaProfile), true);
    assert.equal(await pathExists(gammaProfile), true);

    // Reapply with only alpha: beta and gamma are no longer in the incoming
    // set, so they must be reconciled — beta's displaced user content is
    // restored, gamma (harness-created) is removed — instead of stranded in
    // the tree (Greptile P1: "reduced agent sets strand profiles").
    await apply(["codex.alpha"]);
    assert.equal(
      await readFile(betaProfile, "utf8"),
      "user BETA content\n",
      "beta's displaced user content restored on reduced reapply",
    );
    assert.equal(
      await pathExists(gammaProfile),
      false,
      "gamma's harness-created profile removed on reduced reapply",
    );
    assert.equal(
      await pathExists(alphaProfile),
      true,
      "alpha profile still written",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex reduced-agent reconcile preserves a user-edited orphaned profile", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-reduced-edit-"),
  );
  try {
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });

    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const alphaProfile = join(agentsDir, codexProfileFileName("codex.alpha"));
    const betaProfile = join(agentsDir, codexProfileFileName("codex.beta"));

    const apply = (assetIds: string[]) =>
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: assetIds.map((id) =>
          nativeAsset(id, "agent", `${id} body`),
        ),
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      });

    await apply(["codex.alpha", "codex.beta"]);
    // User edits beta's generated profile after apply.
    await writeFile(betaProfile, "user EDITED beta\n", "utf8");

    // Reapply with only alpha: beta is orphaned AND user-edited, so the
    // reconcile must PRESERVE it (not delete/restore) — the fingerprint differs.
    await apply(["codex.alpha"]);
    assert.equal(
      await readFile(betaProfile, "utf8"),
      "user EDITED beta\n",
      "user-edited orphaned profile preserved on reduced reapply",
    );
    assert.equal(
      await pathExists(alphaProfile),
      true,
      "alpha profile still written",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex reduced-agent reconcile preserves an already user-owned orphaned profile", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-reduced-owned-"),
  );
  try {
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });

    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const alphaProfile = join(agentsDir, codexProfileFileName("codex.alpha"));
    const betaProfile = join(agentsDir, codexProfileFileName("codex.beta"));

    const apply = (assetIds: string[]) =>
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: assetIds.map((id) =>
          nativeAsset(id, "agent", `${id} body`),
        ),
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      });

    await apply(["codex.alpha", "codex.beta"]);
    // User edits beta, then a full reapply marks beta user-owned.
    await writeFile(betaProfile, "user EDITED beta\n", "utf8");
    await apply(["codex.alpha", "codex.beta"]);
    // beta is now user-owned; a reduced reapply orphans it.
    await apply(["codex.alpha"]);
    assert.equal(
      await readFile(betaProfile, "utf8"),
      "user EDITED beta\n",
      "already user-owned orphaned profile preserved on reduced reapply",
    );
    assert.equal(
      await pathExists(alphaProfile),
      true,
      "alpha profile still written",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex regenerates a deleted user-owned profile so the agent stays provisioned", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-regen-deleted-"),
  );
  try {
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });

    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const alphaProfile = join(agentsDir, codexProfileFileName("codex.alpha"));

    const apply = () =>
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: [nativeAsset("codex.alpha", "agent", "Alpha body")],
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      });

    await apply();
    // User edits, then deletes the generated profile — it is now user-owned
    // but absent.
    await writeFile(alphaProfile, "user EDITED alpha\n", "utf8");
    await apply();
    await rm(alphaProfile, { force: true });

    // Reapply: the deleted user-owned file must be REGENERATED so the selected
    // agent is provisioned, not left absent (Greptile/CodeRabbit P1: deleted
    // user-owned profile is not regenerated).
    await apply();
    assert.equal(await pathExists(alphaProfile), true);
    assert.match(
      await readFile(alphaProfile, "utf8"),
      /^name = "codex\.alpha"/mu,
      "deleted user-owned profile regenerated on reapply",
    );

    // Reset must NOT resurrect the deleted user content: the regenerated
    // profile is now harness-owned (priorContent null), so reset removes it
    // cleanly rather than restoring the stale "user EDITED alpha" bytes
    // (Greptile P1: "Deleted profile content resurfaces").
    await resetCodexNativeHost(workspaceRoot, undefined);
    assert.equal(
      await pathExists(alphaProfile),
      false,
      "reset removes the regenerated harness-owned profile, no deleted-content resurfacing",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex reset preserves a user's replacement of a harness-created marketplace", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-market-replaced-"),
  );
  try {
    const marketplacePath = join(
      workspaceRoot,
      ".agents",
      "plugins",
      "marketplace.json",
    );
    // Harness creates the marketplace from scratch → records created:true with
    // a fingerprint of the exact bytes it wrote.
    await mergeCodexPluginMarketplace(marketplacePath);
    assert.equal(await pathExists(marketplacePath), true);

    // User REPLACES the whole file with their own minimal marketplace that
    // happens to use the agent-harness-local name + a three-key shape.
    await writeJsonFile(marketplacePath, {
      name: "agent-harness-local",
      interface: { displayName: "My Company Marketplace" },
      plugins: [],
      sourcedBy: "user",
    });

    // Reset must NOT delete the user's replacement wholesale — the bytes no
    // longer match the harness fingerprint, so it is preserved; only the
    // managed entry is stripped (there is none) (Greptile P1: "marketplace
    // replacement is deleted by reset").
    await resetCodexNativeHost(workspaceRoot, undefined);
    const survivor = JSON.parse(
      await readFile(marketplacePath, "utf8"),
    ) as Record<string, unknown>;
    assert.equal(survivor.sourcedBy, "user");
    assert.deepEqual(survivor.interface, {
      displayName: "My Company Marketplace",
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex reset preserves a user's post-apply edit to a generated profile", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-profile-edit-"),
  );
  try {
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });

    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    // Displaced user profile (priorContent non-null) so reset would restore it.
    const alphaProfile = join(agentsDir, codexProfileFileName("codex.alpha"));
    await writeFile(alphaProfile, "user ORIGINAL alpha\n", "utf8");

    await writeCodexNativeFiles({
      workspaceRoot,
      managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
      nativeAssets: [nativeAsset("codex.alpha", "agent", "Agent body")],
      materializedAssets: emptyMaterializedAssets(),
      mcpServers: [],
    });
    // User edits the generated profile after apply — must not be overwritten.
    await writeFile(alphaProfile, "user EDITED alpha\n", "utf8");

    await resetCodexNativeHost(workspaceRoot, undefined);
    assert.equal(
      await readFile(alphaProfile, "utf8"),
      "user EDITED alpha\n",
      "user's post-apply edit survives reset (not overwritten by snapshot)",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex same-agent reapply preserves a user's edit to a generated profile", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-reapply-edit-"),
  );
  try {
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });

    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const alphaProfile = join(agentsDir, codexProfileFileName("codex.alpha"));
    await writeFile(alphaProfile, "user ORIGINAL alpha\n", "utf8");

    const apply = () =>
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: [nativeAsset("codex.alpha", "agent", "Alpha body")],
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      });

    await apply();
    // User edits the generated profile after the first apply.
    await writeFile(alphaProfile, "user EDITED alpha\n", "utf8");

    // Reapply the SAME agent: the write-direction guard must NOT clobber the
    // user edit (compare-before-write), and must release ownership.
    await apply();
    assert.equal(
      await readFile(alphaProfile, "utf8"),
      "user EDITED alpha\n",
      "same-agent reapply preserves the user's profile edit",
    );

    // A SECOND reapply must keep preserving the user-owned profile — the
    // retained userOwned record stops it being treated as untracked and
    // regenerated (Greptile P1: "Profile ownership vanishes after reapply").
    await apply();
    assert.equal(
      await readFile(alphaProfile, "utf8"),
      "user EDITED alpha\n",
      "second same-agent reapply still preserves the user's profile edit",
    );

    // Reset must likewise preserve the user-owned profile, not restore the
    // stale harness snapshot or delete it.
    await resetCodexNativeHost(workspaceRoot, undefined);
    assert.equal(
      await readFile(alphaProfile, "utf8"),
      "user EDITED alpha\n",
      "reset preserves the user-owned profile edit",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex marketplace reapply relinquishes ownership after a user replacement so reset preserves it", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-market-relaunder-"),
  );
  try {
    const marketplacePath = join(
      workspaceRoot,
      ".agents",
      "plugins",
      "marketplace.json",
    );
    // Harness creates the marketplace from scratch -> records created:true.
    await mergeCodexPluginMarketplace(marketplacePath);
    assert.equal(await pathExists(marketplacePath), true);

    // User REPLACES the whole file with their own minimal marketplace.
    await writeJsonFile(marketplacePath, {
      name: "agent-harness-local",
      interface: { displayName: "My Company Marketplace" },
      plugins: [],
      sourcedBy: "user",
    });

    // Reapply: the live bytes no longer match the prior fingerprint, so the
    // harness RELINQUISHES whole-file ownership (created:false) rather than
    // re-blessing the user replacement as reset-deletable.
    await mergeCodexPluginMarketplace(marketplacePath);
    const ownership = JSON.parse(
      await readFile(
        join(
          workspaceRoot,
          ".agents",
          "plugins",
          ".agent-harness-marketplace.json",
        ),
        "utf8",
      ),
    ) as { created: boolean };
    assert.equal(
      ownership.created,
      false,
      "ownership relinquished after user replacement + reapply",
    );

    // Reset must therefore preserve the user's replacement.
    await resetCodexNativeHost(workspaceRoot, undefined);
    const survivor = JSON.parse(
      await readFile(marketplacePath, "utf8"),
    ) as Record<string, unknown>;
    assert.equal(survivor.sourcedBy, "user");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex omit→re-add: a user-owned profile's record survives the omission so re-add never regenerates over the user's edit", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-omit-readd-"),
  );
  try {
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });
    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const betaProfile = join(agentsDir, codexProfileFileName("codex.beta"));
    const manifestPath = join(agentsDir, ".agent-harness-profiles.json");

    const apply = (assetIds: string[]) =>
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: assetIds.map((id) =>
          nativeAsset(id, "agent", `${id} body`),
        ),
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      });

    // (1) apply alpha + beta
    await apply(["codex.alpha", "codex.beta"]);
    // (2) user edits beta
    await writeFile(betaProfile, "user EDITED beta\n", "utf8");
    // (3) re-apply marks beta user-owned
    await apply(["codex.alpha", "codex.beta"]);
    // (4) omit beta: reduced-set reconcile must RETAIN beta's userOwned record
    await apply(["codex.alpha"]);
    const afterOmit = JSON.parse(await readFile(manifestPath, "utf8")) as {
      profiles: Array<{ fileName: string; userOwned?: boolean }>;
    };
    const betaOmitRecord = afterOmit.profiles.find(
      (p) => p.fileName === codexProfileFileName("codex.beta"),
    );
    assert.ok(
      betaOmitRecord?.userOwned === true,
      "user-owned beta record RETAINED across omit (not dropped)",
    );
    assert.equal(
      await readFile(betaProfile, "utf8"),
      "user EDITED beta\n",
      "beta file preserved across the omission",
    );
    // (5) re-add beta: the retained record must stop the writer-guard from
    // treating beta as untracked pre-existing and regenerating over the edit
    await apply(["codex.alpha", "codex.beta"]);
    assert.equal(
      await readFile(betaProfile, "utf8"),
      "user EDITED beta\n",
      "omit→re-add does not clobber the user-owned beta profile",
    );
    // (6) reset honors the surviving record
    await resetCodexNativeHost(workspaceRoot, undefined);
    assert.equal(
      await readFile(betaProfile, "utf8"),
      "user EDITED beta\n",
      "reset after omit→re-add still preserves the user-owned beta profile",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex reduced-set reconcile: a user-edited (not-yet-owned) profile is PRESERVED and promoted to userOwned in the manifest", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-reduced-promote-"),
  );
  try {
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });
    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const betaProfile = join(agentsDir, codexProfileFileName("codex.beta"));
    const manifestPath = join(agentsDir, ".agent-harness-profiles.json");

    const apply = (assetIds: string[]) =>
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: assetIds.map((id) =>
          nativeAsset(id, "agent", `${id} body`),
        ),
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      });

    await apply(["codex.alpha", "codex.beta"]);
    // User edits beta but does NOT re-apply: the record still says harness-owned.
    await writeFile(betaProfile, "user EDITED beta\n", "utf8");

    // Reduced-set reconcile (alpha only): beta is orphaned AND user-edited.
    // The preserve arm must run, AND the record must be (re)recorded as
    // userOwned so a later re-add does not regenerate over it.
    await apply(["codex.alpha"]);
    assert.equal(
      await readFile(betaProfile, "utf8"),
      "user EDITED beta\n",
      "user-edited orphaned profile preserved on reduced reapply",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      profiles: Array<{ fileName: string; userOwned?: boolean }>;
    };
    const betaRecord = manifest.profiles.find(
      (p) => p.fileName === codexProfileFileName("codex.beta"),
    );
    assert.ok(
      betaRecord?.userOwned === true,
      "user-edited profile promoted to userOwned during reduced reconcile",
    );

    // Re-add beta: must NOT clobber the user's edit.
    await apply(["codex.alpha", "codex.beta"]);
    assert.equal(
      await readFile(betaProfile, "utf8"),
      "user EDITED beta\n",
      "re-add after promotion does not clobber the user's edit",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex no-agent apply: a user-owned profile's record survives and a later re-add preserves it", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-noagent-survive-"),
  );
  try {
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });
    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const alphaProfile = join(agentsDir, codexProfileFileName("codex.alpha"));
    const manifestPath = join(agentsDir, ".agent-harness-profiles.json");

    const apply = (assetIds: string[]) =>
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: assetIds.map((id) =>
          nativeAsset(id, "agent", `${id} body`),
        ),
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      });
    const applyNoAgents = () =>
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: [nativeAsset("codex.skill", "skill", "Skill body")],
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      });

    await apply(["codex.alpha"]);
    // User edits alpha, then a full re-apply marks it user-owned.
    await writeFile(alphaProfile, "user EDITED alpha\n", "utf8");
    await apply(["codex.alpha"]);

    // No-agent apply: alpha is user-owned, so it is preserved AND its record is
    // RETAINED (not consumed) — a later re-add must keep preserving it.
    await applyNoAgents();
    assert.equal(
      await readFile(alphaProfile, "utf8"),
      "user EDITED alpha\n",
      "no-agent apply preserves the user-owned profile",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      profiles: Array<{ fileName: string; userOwned?: boolean }>;
    };
    const alphaRecord = manifest.profiles.find(
      (p) => p.fileName === codexProfileFileName("codex.alpha"),
    );
    assert.ok(
      alphaRecord?.userOwned === true,
      "user-owned record RETAINED across no-agent apply",
    );

    // Re-add alpha: must not regenerate over the user's edit.
    await apply(["codex.alpha"]);
    assert.equal(
      await readFile(alphaProfile, "utf8"),
      "user EDITED alpha\n",
      "re-add after no-agent apply does not clobber the user-owned profile",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex reset: a user-owned profile's record survives reset so a later re-add preserves it", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-reset-survive-"),
  );
  try {
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });
    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const alphaProfile = join(agentsDir, codexProfileFileName("codex.alpha"));
    const manifestPath = join(agentsDir, ".agent-harness-profiles.json");

    const apply = () =>
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: [nativeAsset("codex.alpha", "agent", "Alpha body")],
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      });

    await apply();
    // User edits alpha, then a full re-apply marks it user-owned.
    await writeFile(alphaProfile, "user EDITED alpha\n", "utf8");
    await apply();

    // Reset: alpha is user-owned, so it is preserved AND its record RETAINED
    // so a later apply still recognizes it (not treated as untracked).
    await resetCodexNativeHost(workspaceRoot, undefined);
    assert.equal(
      await readFile(alphaProfile, "utf8"),
      "user EDITED alpha\n",
      "reset preserves the user-owned profile",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      profiles: Array<{ fileName: string; userOwned?: boolean }>;
    };
    const alphaRecord = manifest.profiles.find(
      (p) => p.fileName === codexProfileFileName("codex.alpha"),
    );
    assert.ok(
      alphaRecord?.userOwned === true,
      "user-owned record RETAINED across reset",
    );

    // A later apply must keep preserving the survived record.
    const pluginRootNeedsReclaim = join(
      workspaceRoot,
      "plugins",
      "agent-harness",
    );
    await writeJsonFile(
      join(pluginRootNeedsReclaim, ".agent-harness-managed.json"),
      {
        managedBy: "agent-harness",
        markerVersion: 1,
        pluginName: "agent-harness",
      },
    );
    await apply();
    assert.equal(
      await readFile(alphaProfile, "utf8"),
      "user EDITED alpha\n",
      "re-add after reset does not clobber the user-owned profile",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex ghost-drop: a user-owned profile DELETED by the user has its record dropped on reset so no stale record dangles", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-ghost-drop-"),
  );
  try {
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });
    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const alphaProfile = join(agentsDir, codexProfileFileName("codex.alpha"));
    const manifestPath = join(agentsDir, ".agent-harness-profiles.json");

    const apply = () =>
      writeCodexNativeFiles({
        workspaceRoot,
        managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
        nativeAssets: [nativeAsset("codex.alpha", "agent", "Alpha body")],
        materializedAssets: emptyMaterializedAssets(),
        mcpServers: [],
      });

    await apply();
    // User edits alpha, then a full re-apply marks it user-owned.
    await writeFile(alphaProfile, "user EDITED alpha\n", "utf8");
    await apply();
    // Prove the re-apply PRESERVED the edit and recorded userOwned before the
    // test deletes the profile — otherwise a preservation regression would
    // silently take the normal harness-owned path through the later delete/
    // regeneration/reset assertions (CodeRabbit functional-correctness thread).
    assert.equal(
      await readFile(alphaProfile, "utf8"),
      "user EDITED alpha\n",
      "re-apply preserved the user edit before deletion",
    );
    const ghostManifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      profiles: Array<{ fileName: string; userOwned?: boolean }>;
    };
    assert.equal(
      ghostManifest.profiles.find(
        (p) => p.fileName === codexProfileFileName("codex.alpha"),
      )?.userOwned,
      true,
      "re-apply marked the preserved profile userOwned before deletion",
    );
    // User DELETES the user-owned profile entirely.
    await rm(alphaProfile, { force: true });

    // Reset: alpha is user-owned, so removeCodexAgentProfiles would normally
    // retain it — but its live file is now absent, so retainUserOwnedProfile
    // must DROP the ghost record rather than re-assert ownership of nothing.
    // With no profile surviving, the ownership manifest is removed outright.
    await resetCodexNativeHost(workspaceRoot, undefined);
    assert.equal(
      await pathExists(alphaProfile),
      false,
      "deleted profile stays deleted after reset",
    );
    assert.equal(
      await pathExists(manifestPath),
      false,
      "no stale user-owned inline manifest dangles after the file was deleted",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex legacy-manifest reapply preserves a user's edit to a pre-fingerprint profile and marks it userOwned", async () => {
  // Gap 2 write-arm: an ownership record written BEFORE the contentFingerprint
  // field existed (no contentFingerprint, no userOwned) must never let a
  // same-agent reapply regenerate over a user's post-apply edit. Over-
  // preservation: we cannot prove we wrote those bytes, so treat them as
  // user-owned (CodeRabbit Major 5124991541).
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-legacy-reapply-"),
  );
  try {
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });

    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const alphaProfile = join(agentsDir, codexProfileFileName("codex.alpha"));
    const manifestPath = join(agentsDir, ".agent-harness-profiles.json");
    // A legacy manifest predating the contentFingerprint field: the record
    // carries a fileName + priorContent but NEITHER a fingerprint NOR
    // userOwned — exactly the shape a pre-field apply leaves behind.
    await writeFile(alphaProfile, "user ORIGINAL alpha\n", "utf8");
    await writeJsonFile(manifestPath, {
      schemaVersion: 1,
      profiles: [
        {
          fileName: codexProfileFileName("codex.alpha"),
          priorContent: "user ORIGINAL alpha\n",
        },
      ],
    });
    // The user edits the legacy-owned profile after the original apply.
    await writeFile(alphaProfile, "user EDITED alpha\n", "utf8");

    await writeCodexNativeFiles({
      workspaceRoot,
      managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
      nativeAssets: [nativeAsset("codex.alpha", "agent", "Alpha body")],
      materializedAssets: emptyMaterializedAssets(),
      mcpServers: [],
    });

    assert.equal(
      await readFile(alphaProfile, "utf8"),
      "user EDITED alpha\n",
      "same-agent reapply must NOT rewrite a legacy fingerprint-less profile the user edited",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      profiles: Array<{ fileName: string; userOwned?: boolean }>;
    };
    const alphaRecord = manifest.profiles.find(
      (p) => p.fileName === codexProfileFileName("codex.alpha"),
    );
    assert.equal(
      alphaRecord?.userOwned,
      true,
      "legacy profile is marked userOwned so later applies keep preserving it",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex reset preserves a legacy fingerprint-less profile a user edited (does not delete/restore)", async () => {
  // Gap 2 cleanup-arm: reset must never delete or restore-overwrite a legacy
  // no-fingerprint record — we cannot prove we own its bytes, so preserve.
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-legacy-reset-"),
  );
  try {
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });

    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const alphaProfile = join(agentsDir, codexProfileFileName("codex.alpha"));
    const manifestPath = join(agentsDir, ".agent-harness-profiles.json");
    await writeFile(alphaProfile, "user ORIGINAL alpha\n", "utf8");
    await writeJsonFile(manifestPath, {
      schemaVersion: 1,
      profiles: [
        {
          fileName: codexProfileFileName("codex.alpha"),
          priorContent: "user ORIGINAL alpha\n",
        },
      ],
    });
    await writeFile(alphaProfile, "user EDITED alpha\n", "utf8");

    await resetCodexNativeHost(workspaceRoot, undefined);
    assert.equal(
      await readFile(alphaProfile, "utf8"),
      "user EDITED alpha\n",
      "reset must not delete or restore a legacy no-fingerprint profile the user edited",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex regenerates a deleted legacy profile with priorContent null so reset never resurrects it", async () => {
  // Greptile P1 ("Deleted legacy content resurfaces"): a legacy fingerprint-
  // less record whose profile file was DELETED kept its old priorContent on
  // regeneration, and reset then restored the bytes the user explicitly
  // deleted. The regenerated record must carry priorContent:null
  // (harness-created from scratch) so reset removes it instead of restoring it.
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-legacy-regenerate-"),
  );
  try {
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });

    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const alphaProfile = join(agentsDir, codexProfileFileName("codex.alpha"));
    const manifestPath = join(agentsDir, ".agent-harness-profiles.json");
    // A legacy record predating the contentFingerprint field: fileName +
    // priorContent only, with NO fingerprint and NO userOwned flag. The user
    // then deleted the generated profile entirely.
    await writeJsonFile(manifestPath, {
      schemaVersion: 1,
      profiles: [
        {
          fileName: codexProfileFileName("codex.alpha"),
          priorContent: "user OLD content\n",
        },
      ],
    });
    assert.equal(
      await pathExists(alphaProfile),
      false,
      "precondition: the user deleted the profile file",
    );

    // Re-applying the same agent regenerates the deleted legacy profile.
    await writeCodexNativeFiles({
      workspaceRoot,
      managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
      nativeAssets: [nativeAsset("codex.alpha", "agent", "Alpha body")],
      materializedAssets: emptyMaterializedAssets(),
      mcpServers: [],
    });
    assert.equal(
      await pathExists(alphaProfile),
      true,
      "deleted profile regenerated so the selected agent stays provisioned",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      profiles: Array<{ fileName: string; priorContent?: string | null }>;
    };
    const alphaRecord = manifest.profiles.find(
      (p) => p.fileName === codexProfileFileName("codex.alpha"),
    );
    assert.equal(
      alphaRecord?.priorContent,
      null,
      "regenerated record drops the stale priorContent so reset cannot resurrect it",
    );

    // Reset must REMOVE the regenerated harness file, not restore "user OLD".
    await resetCodexNativeHost(workspaceRoot, undefined);
    assert.equal(
      await pathExists(alphaProfile),
      false,
      "reset removes the regenerated profile instead of resurrecting user-deleted content",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("Codex reduced-set reconcile preserves a legacy fingerprint-less profile the user edited", async () => {
  // Gap 2 reconcile-arm: when a reduced agent set orphans a legacy no-
  // fingerprint profile, reconcile must preserve its bytes (isCodexProfile-
  // Unedited returns false — never delete what we can't prove we own).
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-codex-legacy-reduce-"),
  );
  try {
    const pluginRoot = join(workspaceRoot, "plugins", "agent-harness");
    await mkdir(pluginRoot, { recursive: true });
    await writeJsonFile(join(pluginRoot, ".agent-harness-managed.json"), {
      managedBy: "agent-harness",
      markerVersion: 1,
      pluginName: "agent-harness",
    });

    const agentsDir = join(workspaceRoot, ".codex", "agents");
    await mkdir(agentsDir, { recursive: true });
    const alphaProfile = join(agentsDir, codexProfileFileName("codex.alpha"));
    const manifestPath = join(agentsDir, ".agent-harness-profiles.json");
    await writeFile(alphaProfile, "user ORIGINAL alpha\n", "utf8");
    await writeJsonFile(manifestPath, {
      schemaVersion: 1,
      profiles: [
        {
          fileName: codexProfileFileName("codex.alpha"),
          priorContent: "user ORIGINAL alpha\n",
        },
      ],
    });
    await writeFile(alphaProfile, "user EDITED alpha\n", "utf8");

    // Reduced-set apply (beta only): alpha is NOT in the incoming set, so it
    // is orphan-reconciled — it must be preserved, not removed/restored.
    await writeCodexNativeFiles({
      workspaceRoot,
      managedRoot: join(workspaceRoot, ".codex", "agent-harness"),
      nativeAssets: [nativeAsset("codex.beta", "agent", "Beta body")],
      materializedAssets: emptyMaterializedAssets(),
      mcpServers: [],
    });
    assert.equal(
      await readFile(alphaProfile, "utf8"),
      "user EDITED alpha\n",
      "reduced-set reconcile must not delete/restore a legacy no-fingerprint profile the user edited",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      profiles: Array<{ fileName: string; userOwned?: boolean }>;
    };
    const alphaRecord = manifest.profiles.find(
      (p) => p.fileName === codexProfileFileName("codex.alpha"),
    );
    assert.equal(
      alphaRecord?.userOwned,
      true,
      "legacy orphaned profile retained as userOwned in the manifest",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

function nativeAsset(
  assetId: string,
  assetKind: NativeAsset["assetKind"],
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
