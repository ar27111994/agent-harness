import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
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

const NATIVE_HOSTS = ["cursor", "zed", "claude-code", "pi"] as const;
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

  const vscodeAdapter = resolveHostAdapter("vscode");
  assert.ok(vscodeAdapter);
  assert.equal(vscodeAdapter.runtime?.executable, "code");
  assert.equal(vscodeAdapter.nativeInstall?.assetKind, "extension");
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

  const piAdapter = resolveHostAdapter("pi");
  assert.ok(piAdapter);
  assert.equal(piAdapter.recommendationHost, "pi");
  assertWireCapabilities(piAdapter, ALL_ASSET_KINDS);
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

void test("OpenCode wire links every supported asset bucket into the project overlay", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-opencode-"));
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-workspace-"),
  );

  try {
    const selectedAssets = buildAllAssetFixtures();
    await writeOpenCodeActivation(projectRoot, selectedAssets);
    await writeOpenCodeInstallBundle(projectRoot, selectedAssets);

    const adapter = resolveHostAdapter("opencode");
    assert.ok(adapter);
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
        sanitizeAssetId("asset-instruction"),
      ),
    );
    await assertPathExists(
      join(localOverlayRoot, "agents", sanitizeAssetId("asset-agent")),
    );
    await assertPathExists(
      join(localOverlayRoot, "skills", sanitizeAssetId("asset-skill")),
    );
    await assertPathExists(
      join(localOverlayRoot, "plugins", sanitizeAssetId("asset-plugin")),
    );
    await assertPathExists(
      join(managedContextRoot, "hooks", sanitizeAssetId("asset-hook")),
    );
    await assertPathExists(
      join(
        managedContextRoot,
        "reference-packs",
        sanitizeAssetId("asset-reference"),
      ),
    );
    await assertPathExists(
      join(managedContextRoot, "mcp-servers", sanitizeAssetId("asset-mcp")),
    );
    await assertPathExists(
      join(
        managedContextRoot,
        "extensions",
        sanitizeAssetId("ms-python.python"),
      ),
    );
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

void test("OpenCode-compatible native wire plans expose every asset bucket", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-native-wire-"),
  );
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-workspace-"),
  );

  try {
    const selectedAssets = buildAllAssetFixtures();
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
      assertCompleteNativeWirePlan(plan);
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

async function assertNativeHostFile(
  host: (typeof NATIVE_HOSTS)[number],
  workspaceRoot: string,
): Promise<void> {
  const hostFileByHost = {
    cursor: join(workspaceRoot, ".cursor", "rules", "agent-harness.mdc"),
    zed: join(workspaceRoot, ".rules"),
    "claude-code": join(workspaceRoot, "CLAUDE.md"),
    pi: join(workspaceRoot, "AGENTS.md"),
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
}

function assertCompleteNativeWirePlan(plan: WirePlanManifest): void {
  assert.ok(plan.instructionsFiles?.length);
  assert.ok(plan.agentFiles?.length);
  assert.ok(plan.skillDirs?.length);
  assert.ok(plan.pluginDirs?.length);
  assert.ok(plan.hookFiles?.length);
  assert.ok(plan.workflowFiles?.length);
  assert.ok(plan.referenceFiles?.length);
  assert.ok(plan.mcpServers?.includes("asset-mcp"));
  assert.ok(plan.extensionIds?.includes("ms-python.python"));
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

function buildAsset(id: string, assetKind: AssetKind): AssetCatalogEntry {
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
  };
}
