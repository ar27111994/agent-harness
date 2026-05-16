import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  clearRuntimeConfigForTests,
  getRuntimeConfig,
} from "../config/runtime.js";
import {
  pathExists,
  readJsonFile,
  readTextFileOrNull,
  writeJsonFile,
  writeTextFile,
} from "../files.js";
import {
  buildCopilotWorkspaceOverlayManifest,
  vscodeWireInternals,
  wireVsCode,
} from "../host-adapters/vscode.js";
import { readVsCodeSettings } from "../host-adapters/vscode-settings.js";
import { resolveVsCodeUserSettingsPath } from "../lib/paths.js";
import { sanitizeAssetId } from "../lib/safe-paths.js";
import type {
  ActivationManifest,
  AssetCatalogEntry,
  CopilotWorkspaceOverlayManifest,
  CopilotWorkspaceProfileManifest,
  InstalledBundleManifest,
  InstalledPackageManifest,
  WirePlanManifest,
  WirePreviewManifest,
} from "../types.js";

void test("VS Code wire apply/reset materializes curated assets, patches settings, and prunes generations", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-vscode-wire-"));
  const homeDirectory = join(root, "home");
  const appDataDirectory = join(root, "appdata");
  const xdgConfigHome = join(root, "xdg");
  const projectRoot = join(root, "project");
  const workspaceRoot = join(root, "workspace");
  const previousEnv = rememberEnv([
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "XDG_CONFIG_HOME",
    "GITHUB_TOKEN",
    "GITHUB_PERSONAL_ACCESS_TOKEN",
  ]);

  process.env.HOME = homeDirectory;
  process.env.USERPROFILE = homeDirectory;
  process.env.APPDATA = appDataDirectory;
  process.env.XDG_CONFIG_HOME = xdgConfigHome;
  process.env.GITHUB_TOKEN = "fixture-token";
  delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  clearRuntimeConfigForTests();

  context.after(async () => {
    restoreEnv(previousEnv);
    clearRuntimeConfigForTests();
    await rm(root, { recursive: true, force: true });
  });

  const settingsPath = resolveVsCodeUserSettingsPath();
  const curatedRoot = join(homeDirectory, ".copilot", "agent-harness");
  const activationRoot = join(projectRoot, "activate", "copilot-vscode");

  await writeTextFile(
    join(workspaceRoot, ".github", "copilot-instructions.md"),
    "# Existing instructions\n\nKeep this section.\n",
  );
  await writeTextFile(
    settingsPath,
    [
      "{",
      "  // keep this user setting",
      '  "chat.pluginLocations": {',
      '    "~/plugins/existing": true,',
      '    "~/.copilot/agent-harness/legacy/plugins": true',
      "  },",
      '  "chat.agentSkillsLocations": {',
      '    "~/skills/existing": true,',
      '    "~/.copilot/agent-harness/current/skills": true',
      "  },",
      '  "chat.hookFilesLocations": {',
      '    "~/hooks/existing": true',
      "  },",
      '  "chat.agentFilesLocations": {',
      '    "~/agents/existing": true',
      "  },",
      '  "chat.instructionsFilesLocations": {',
      '    "~/instructions/existing": true',
      "  },",
      '  "github.copilot.chat.codeGeneration.instructions": [',
      '    { "file": "existing-instructions.md" },',
      '    { "file": ".github/copilot-instructions.md" }',
      "  ]",
      "}\n",
    ].join("\n"),
  );

  const assetIds = {
    instruction: "instruction.alpha",
    agent: "agent.alpha",
    skill: "skill.alpha",
    hook: "hook.alpha",
    pluginScript: "plugin.script",
    pluginJson: "plugin.json",
    pluginReadme: "plugin.readme",
    extension: "fixture.extension",
  } as const;

  await writeJsonFile(join(activationRoot, "workspace-profile-manifest.json"), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    profileId: "fixture-profile",
    workspaceRoot,
    bundleIds: ["copilot-core"],
    selectedAssetIds: Object.values(assetIds),
    selectedInstructionIds: [assetIds.instruction],
    selectedAgentIds: [assetIds.agent],
    selectedWorkflowIds: [],
    selectedPluginIds: [
      assetIds.pluginScript,
      assetIds.pluginJson,
      assetIds.pluginReadme,
    ],
    selectedExtensionIds: [assetIds.extension],
    selectedHookIds: [assetIds.hook],
    selectedSkillIds: [assetIds.skill],
    activationBudget: 16,
  } satisfies CopilotWorkspaceProfileManifest);

  await Promise.all([
    writeActivationAsset(activationRoot, {
      asset: buildAsset(assetIds.instruction, "instruction", {
        displayName: "Instruction Alpha",
        filePath: "instructions/alpha.md",
      }),
      content: "# Instruction Alpha\n\nFollow the alpha workflow.\n",
    }),
    writeActivationAsset(activationRoot, {
      asset: buildAsset(assetIds.agent, "agent", {
        displayName: "Agent Alpha",
        filePath: "agents/alpha.md",
      }),
      content: "# Agent Alpha\n\nBe precise.\n",
    }),
    writeActivationAsset(activationRoot, {
      asset: buildAsset(assetIds.skill, "skill", {
        displayName: "Skill Alpha",
        filePath: "skills/alpha/SKILL.md",
      }),
      content: "# Skill Alpha\n\nUse the alpha skill.\n",
    }),
    writeActivationAsset(activationRoot, {
      asset: buildAsset(assetIds.hook, "hook", {
        displayName: "Hook Alpha",
        filePath: "hooks/alpha.json",
      }),
      content: '{"hook":"alpha"}\n',
    }),
    writeActivationAsset(activationRoot, {
      asset: buildAsset(assetIds.pluginScript, "plugin", {
        displayName: "Plugin Script",
        filePath: "plugins/alpha.ts",
      }),
      content: "export const alpha = true;\n",
    }),
    writeActivationAsset(activationRoot, {
      asset: buildAsset(assetIds.pluginJson, "plugin", {
        displayName: "Plugin JSON",
      }),
      content: '{"name":"plugin-json"}\n',
    }),
    writeActivationAsset(activationRoot, {
      asset: buildAsset(assetIds.pluginReadme, "plugin", {
        displayName: "Plugin Readme",
      }),
      content: "Plugin readme content\n",
    }),
    writeActivationAsset(activationRoot, {
      asset: buildAsset(assetIds.extension, "extension", {
        displayName: "Fixture Extension",
        manifestEntry: "fixture.publisher-extension",
      }),
      content: "# Extension\n",
    }),
  ]);

  await writeSharedMcpFixture(
    projectRoot,
    "shared.bundle",
    "shared.mcp.server",
  );

  const generationsRoot = join(curatedRoot, "generations");
  for (const generationId of ["old-a", "old-b", "old-c", "old-d"]) {
    await writeTextFile(
      join(generationsRoot, generationId, "marker.txt"),
      generationId,
    );
  }

  await wireVsCode({ projectRoot, workspaceRoot, mode: "preview" });

  const preview = await readJsonFile<WirePreviewManifest>(
    join(activationRoot, "wire-preview-vscode.json"),
  );
  assert.equal(preview.mode, "preview");
  assert.equal(await pathExists(join(curatedRoot, "current")), false);

  await wireVsCode({ projectRoot, workspaceRoot, mode: "apply" });

  const currentRoot = join(curatedRoot, "current");
  const applyPreview = await readJsonFile<WirePreviewManifest>(
    join(activationRoot, "wire-preview-vscode.json"),
  );
  assert.equal(applyPreview.mode, "apply");
  assert.equal(await pathExists(currentRoot), true);
  assert.equal((await stat(currentRoot)).isDirectory(), true);

  const workspaceInstructions =
    (await readTextFileOrNull(
      join(workspaceRoot, ".github", "copilot-instructions.md"),
    )) ?? "";
  assert.match(workspaceInstructions, /Existing instructions/u);
  assert.match(workspaceInstructions, /Instruction Alpha/u);
  assert.match(workspaceInstructions, /agent-harness-vscode:begin/u);

  const generationDirectories = await readdir(generationsRoot);
  assert.equal(generationDirectories.length, 3);

  assert.equal(
    await readTextFileOrNull(
      join(
        currentRoot,
        "instructions",
        `${sanitizeAssetId(assetIds.instruction)}.instructions.md`,
      ),
    ),
    "# Instruction Alpha\n\nFollow the alpha workflow.\n",
  );
  assert.equal(
    await readTextFileOrNull(
      join(
        currentRoot,
        "agents",
        `${sanitizeAssetId(assetIds.agent)}.agent.md`,
      ),
    ),
    "# Agent Alpha\n\nBe precise.\n",
  );
  assert.equal(
    await readTextFileOrNull(
      join(currentRoot, "skills", sanitizeAssetId(assetIds.skill), "SKILL.md"),
    ),
    "# Skill Alpha\n\nUse the alpha skill.\n",
  );
  assert.equal(
    await readTextFileOrNull(
      join(currentRoot, "hooks", `${sanitizeAssetId(assetIds.hook)}.json`),
    ),
    '{"hook":"alpha"}\n',
  );
  assert.equal(
    await readTextFileOrNull(
      join(
        currentRoot,
        "plugins",
        sanitizeAssetId(assetIds.pluginScript),
        "alpha.ts",
      ),
    ),
    "export const alpha = true;\n",
  );
  assert.equal(
    await readTextFileOrNull(
      join(
        currentRoot,
        "plugins",
        sanitizeAssetId(assetIds.pluginScript),
        "README.md",
      ),
    ),
    `# ${assetIds.pluginScript}\n`,
  );
  assert.equal(
    await readTextFileOrNull(
      join(
        currentRoot,
        "plugins",
        sanitizeAssetId(assetIds.pluginJson),
        "plugin.json",
      ),
    ),
    '{"name":"plugin-json"}\n',
  );
  assert.equal(
    await readTextFileOrNull(
      join(
        currentRoot,
        "plugins",
        sanitizeAssetId(assetIds.pluginReadme),
        "README.md",
      ),
    ),
    "Plugin readme content\n",
  );

  const extensionMetadata = await readJsonFile<Record<string, unknown>>(
    join(
      currentRoot,
      "extensions",
      `${sanitizeAssetId(assetIds.extension)}.json`,
    ),
  );
  assert.equal(extensionMetadata.extensionId, "fixture.publisher-extension");
  assert.equal(extensionMetadata.assetId, assetIds.extension);
  assert.equal(typeof extensionMetadata.nativeInstall, "object");

  const wirePlan = await readJsonFile<WirePlanManifest>(
    join(curatedRoot, "wire-plan.json"),
  );
  assert.deepEqual(wirePlan.extensionIds, ["fixture.publisher-extension"]);
  assert.deepEqual(wirePlan.mcpServers, ["shared.mcp.server"]);
  assert.ok(
    wirePlan.nativeInstallActions?.some((action) =>
      action.includes("fixture.publisher-extension"),
    ),
  );

  const patchedSettings = await readVsCodeSettings(settingsPath);
  assert.deepEqual(patchedSettings["chat.pluginLocations"], {
    "~/plugins/existing": true,
    "~/.copilot/agent-harness/current/plugins": true,
  });
  assert.deepEqual(patchedSettings["chat.agentSkillsLocations"], {
    "~/skills/existing": true,
    "~/.copilot/agent-harness/current/skills": true,
  });
  assert.deepEqual(patchedSettings["chat.hookFilesLocations"], {
    "~/hooks/existing": true,
    "~/.copilot/agent-harness/current/hooks": true,
  });
  assert.deepEqual(patchedSettings["chat.agentFilesLocations"], {
    "~/agents/existing": true,
    "~/.copilot/agent-harness/current/agents": true,
  });
  assert.deepEqual(patchedSettings["chat.instructionsFilesLocations"], {
    "~/instructions/existing": true,
    "~/.copilot/agent-harness/current/instructions": true,
  });
  assert.deepEqual(
    patchedSettings["github.copilot.chat.codeGeneration.instructions"],
    [
      { file: "existing-instructions.md" },
      { file: ".github/copilot-instructions.md" },
    ],
  );

  await wireVsCode({ projectRoot, workspaceRoot, mode: "reset" });

  const resetPreview = await readJsonFile<WirePreviewManifest>(
    join(activationRoot, "wire-preview-vscode.json"),
  );
  assert.equal(resetPreview.mode, "reset");
  assert.equal(await pathExists(curatedRoot), false);
  assert.equal(
    await readTextFileOrNull(
      join(workspaceRoot, ".github", "copilot-instructions.md"),
    ),
    "# Existing instructions\n\nKeep this section.\n",
  );

  const resetSettings = await readVsCodeSettings(settingsPath);
  assert.deepEqual(resetSettings["chat.pluginLocations"], {
    "~/plugins/existing": true,
  });
  assert.deepEqual(resetSettings["chat.agentSkillsLocations"], {
    "~/skills/existing": true,
  });
  assert.deepEqual(resetSettings["chat.hookFilesLocations"], {
    "~/hooks/existing": true,
  });
  assert.deepEqual(resetSettings["chat.agentFilesLocations"], {
    "~/agents/existing": true,
  });
  assert.deepEqual(resetSettings["chat.instructionsFilesLocations"], {
    "~/instructions/existing": true,
  });
  assert.deepEqual(
    resetSettings["github.copilot.chat.codeGeneration.instructions"],
    [{ file: "existing-instructions.md" }],
  );
});

void test("VS Code wire skips missing activation assets and removes managed-only code generation instructions on reset", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-vscode-wire-"));
  const homeDirectory = join(root, "home");
  const appDataDirectory = join(root, "appdata");
  const projectRoot = join(root, "project");
  const workspaceRoot = join(root, "workspace");
  const previousEnv = rememberEnv([
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "XDG_CONFIG_HOME",
  ]);

  process.env.HOME = homeDirectory;
  process.env.USERPROFILE = homeDirectory;
  process.env.APPDATA = appDataDirectory;
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  clearRuntimeConfigForTests();

  context.after(async () => {
    restoreEnv(previousEnv);
    clearRuntimeConfigForTests();
    await rm(root, { recursive: true, force: true });
  });

  const settingsPath = resolveVsCodeUserSettingsPath();
  const activationRoot = join(projectRoot, "activate", "copilot-vscode");
  const missingAssetId = "instruction.missing";
  const presentAssetId = "plugin.present";

  await writeTextFile(
    settingsPath,
    JSON.stringify(
      {
        "github.copilot.chat.codeGeneration.instructions": [
          { file: ".github/copilot-instructions.md" },
        ],
      },
      null,
      2,
    ),
  );
  await writeJsonFile(join(activationRoot, "workspace-profile-manifest.json"), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    profileId: "missing-assets-profile",
    workspaceRoot,
    bundleIds: [],
    selectedAssetIds: [missingAssetId, presentAssetId],
    selectedInstructionIds: [missingAssetId],
    selectedAgentIds: [],
    selectedWorkflowIds: [],
    selectedPluginIds: [presentAssetId],
    activationBudget: 2,
  } satisfies CopilotWorkspaceProfileManifest);
  await writeActivationAsset(activationRoot, {
    asset: buildAsset(presentAssetId, "plugin", {
      displayName: "Plugin present",
      filePath: "plugins/plugin.present.ts",
    }),
    content: "export const present = true;\n",
  });

  await wireVsCode({ projectRoot, workspaceRoot, mode: "apply" });

  const currentRoot = join(
    homeDirectory,
    ".copilot",
    "agent-harness",
    "current",
  );
  assert.equal(
    await pathExists(
      join(
        currentRoot,
        "instructions",
        `${sanitizeAssetId(missingAssetId)}.instructions.md`,
      ),
    ),
    false,
  );
  assert.equal(
    await pathExists(
      join(currentRoot, "plugins", sanitizeAssetId(presentAssetId)),
    ),
    true,
  );

  await wireVsCode({ projectRoot, workspaceRoot, mode: "reset" });
  const resetSettings = await readVsCodeSettings(settingsPath);
  assert.equal(
    resetSettings["github.copilot.chat.codeGeneration.instructions"],
    undefined,
  );
});

void test("VS Code wire tolerates malformed shared MCP state and reset removes managed-only instruction files", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-vscode-wire-"));
  const homeDirectory = join(root, "home");
  const appDataDirectory = join(root, "appdata");
  const projectRoot = join(root, "project");
  const workspaceRoot = join(root, "workspace");
  const previousEnv = rememberEnv([
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "XDG_CONFIG_HOME",
  ]);

  process.env.HOME = homeDirectory;
  process.env.USERPROFILE = homeDirectory;
  process.env.APPDATA = appDataDirectory;
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  clearRuntimeConfigForTests();

  context.after(async () => {
    restoreEnv(previousEnv);
    clearRuntimeConfigForTests();
    await rm(root, { recursive: true, force: true });
  });

  const activationRoot = join(projectRoot, "activate", "copilot-vscode");
  const assetId = "instruction.warning";
  await writeJsonFile(join(activationRoot, "workspace-profile-manifest.json"), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    profileId: "warning-profile",
    workspaceRoot,
    bundleIds: ["copilot-core"],
    selectedAssetIds: [assetId],
    selectedInstructionIds: [assetId],
    selectedAgentIds: [],
    selectedWorkflowIds: [],
    activationBudget: 1,
  } satisfies CopilotWorkspaceProfileManifest);
  await writeActivationAsset(activationRoot, {
    asset: buildAsset(assetId, "instruction", {
      displayName: "Warning instruction",
    }),
    content: "# Warning instruction\n",
  });
  await writeJsonFile(
    join(projectRoot, "activate", "shared", "activation-manifest.json"),
    { malformed: true },
  );

  const warningMessages: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => {
    warningMessages.push(String(message ?? ""));
  };

  try {
    await wireVsCode({ projectRoot, workspaceRoot, mode: "apply" });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warningMessages.length, 1);
  assert.match(
    warningMessages[0] ?? "",
    /Failed to project shared MCP assets into VS Code wire plan/u,
  );

  const instructionPath = join(
    workspaceRoot,
    ".github",
    "copilot-instructions.md",
  );
  assert.match(
    (await readFile(instructionPath, "utf8")) ?? "",
    /Warning instruction/u,
  );

  await wireVsCode({ projectRoot, workspaceRoot, mode: "reset" });
  assert.equal(await pathExists(instructionPath), false);
});

void test("VS Code overlay manifest helper normalizes the workspace root", () => {
  const overlay = buildCopilotWorkspaceOverlayManifest({
    workspaceRoot: "C:\\workspace\\repo",
    overlayPlan: {
      schemaVersion: 1,
      host: "copilot-vscode",
      generatedAt: "2026-01-01T00:00:00.000Z",
      workspaceRoot: ".",
      selectedBundleIds: ["copilot-core"],
      selectedAssetIds: ["asset.alpha"],
      activationBudget: 10,
      mode: "apply",
    } satisfies CopilotWorkspaceOverlayManifest,
  });

  assert.equal(overlay.workspaceRoot, "C:/workspace/repo");
});

void test("VS Code reset preserves non-array code-generation settings and skips missing workspace instructions", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-vscode-reset-"));
  const homeDirectory = join(root, "home");
  const appDataDirectory = join(root, "appdata");
  const projectRoot = join(root, "project");
  const workspaceRoot = join(root, "workspace");
  const previousEnv = rememberEnv([
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "XDG_CONFIG_HOME",
  ]);

  process.env.HOME = homeDirectory;
  process.env.USERPROFILE = homeDirectory;
  process.env.APPDATA = appDataDirectory;
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  clearRuntimeConfigForTests();

  context.after(async () => {
    restoreEnv(previousEnv);
    clearRuntimeConfigForTests();
    await rm(root, { recursive: true, force: true });
  });

  const settingsPath = resolveVsCodeUserSettingsPath();
  await writeTextFile(
    settingsPath,
    JSON.stringify(
      {
        "github.copilot.chat.codeGeneration.instructions": "legacy",
      },
      null,
      2,
    ),
  );

  await wireVsCode({ projectRoot, workspaceRoot, mode: "reset" });

  const resetSettings = await readVsCodeSettings(settingsPath);
  assert.equal(
    resetSettings["github.copilot.chat.codeGeneration.instructions"],
    "legacy",
  );
  assert.equal(
    await pathExists(join(workspaceRoot, ".github", "copilot-instructions.md")),
    false,
  );
});

void test("VS Code wire skips missing agent, skill, hook, plugin, and extension records", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-vscode-sparse-"));
  const homeDirectory = join(root, "home");
  const appDataDirectory = join(root, "appdata");
  const projectRoot = join(root, "project");
  const workspaceRoot = join(root, "workspace");
  const previousEnv = rememberEnv([
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "XDG_CONFIG_HOME",
  ]);

  process.env.HOME = homeDirectory;
  process.env.USERPROFILE = homeDirectory;
  process.env.APPDATA = appDataDirectory;
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  clearRuntimeConfigForTests();

  context.after(async () => {
    restoreEnv(previousEnv);
    clearRuntimeConfigForTests();
    await rm(root, { recursive: true, force: true });
  });

  const activationRoot = join(projectRoot, "activate", "copilot-vscode");
  const currentRoot = join(
    homeDirectory,
    ".copilot",
    "agent-harness",
    "current",
  );
  const selectedIds = {
    instruction: "instruction.present",
    agent: "agent.missing",
    skill: "skill.missing",
    hook: "hook.missing",
    plugin: "plugin.missing",
    extension: "extension.missing",
  } as const;

  await writeJsonFile(join(activationRoot, "workspace-profile-manifest.json"), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    profileId: "sparse-profile",
    workspaceRoot,
    bundleIds: [],
    selectedAssetIds: Object.values(selectedIds),
    selectedInstructionIds: [selectedIds.instruction],
    selectedAgentIds: [selectedIds.agent],
    selectedWorkflowIds: [],
    selectedPluginIds: [selectedIds.plugin],
    selectedExtensionIds: [selectedIds.extension],
    selectedHookIds: [selectedIds.hook],
    selectedSkillIds: [selectedIds.skill],
    activationBudget: 8,
  } satisfies CopilotWorkspaceProfileManifest);
  await writeActivationAsset(activationRoot, {
    asset: buildAsset(selectedIds.instruction, "instruction", {
      displayName: "Present instruction",
    }),
    content: "# Present instruction\n",
  });

  await wireVsCode({ projectRoot, workspaceRoot, mode: "apply" });

  assert.equal(
    await pathExists(
      join(
        currentRoot,
        "agents",
        `${sanitizeAssetId(selectedIds.agent)}.agent.md`,
      ),
    ),
    false,
  );
  assert.equal(
    await pathExists(
      join(currentRoot, "skills", sanitizeAssetId(selectedIds.skill)),
    ),
    false,
  );
  assert.equal(
    await pathExists(
      join(currentRoot, "hooks", `${sanitizeAssetId(selectedIds.hook)}.md`),
    ),
    false,
  );
  assert.equal(
    await pathExists(
      join(currentRoot, "plugins", sanitizeAssetId(selectedIds.plugin)),
    ),
    false,
  );
  assert.equal(
    await pathExists(
      join(
        currentRoot,
        "extensions",
        `${sanitizeAssetId(selectedIds.extension)}.json`,
      ),
    ),
    false,
  );
  assert.match(
    (await readTextFileOrNull(
      join(workspaceRoot, ".github", "copilot-instructions.md"),
    )) ?? "",
    /Present instruction/u,
  );
});

function buildAsset(
  id: string,
  assetKind: AssetCatalogEntry["assetKind"],
  overrides: {
    displayName?: string;
    filePath?: string;
    manifestEntry?: string;
  } = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: overrides.displayName ?? id,
    assetKind,
    hosts: ["copilot-vscode"],
    compatibilityMode: assetKind === "extension" ? "native" : "adaptable",
    source: {
      sourceId: `${id}-source`,
      authorityTier: "trusted-local",
      sourceKind: "local-directory",
      sourcePriority: 1,
      originUrl: `file:///fixtures/${sanitizeAssetId(id)}`,
      publisher: "tests",
      publisherVerified: true,
    },
    trust: { score: 100, signals: [] },
    capabilities: [assetKind],
    install: {
      method: assetKind === "extension" ? "vscode-extension" : "local-file",
      adaptableHosts:
        assetKind === "extension" ? undefined : ["copilot-vscode"],
      nativeHosts: assetKind === "extension" ? ["copilot-vscode"] : undefined,
      manifestEntry: overrides.manifestEntry,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: overrides.filePath,
      rootPath: "/fixtures",
    },
    maintenance: {
      lastUpdated: "2026-01-01T00:00:00.000Z",
      stars: 1,
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
  };
}

async function writeActivationAsset(
  activationRoot: string,
  options: { asset: AssetCatalogEntry; content: string },
): Promise<void> {
  const assetRoot = join(activationRoot, sanitizeAssetId(options.asset.id));
  await writeJsonFile(join(assetRoot, "asset.json"), options.asset);
  await writeTextFile(join(assetRoot, "content.txt"), options.content);
}

async function writeSharedMcpFixture(
  projectRoot: string,
  bundleId: string,
  assetId: string,
): Promise<void> {
  const packageManifestPath = join(
    projectRoot,
    "install",
    "shared",
    "packages",
    `${sanitizeAssetId(assetId)}.install.json`,
  );
  await writeJsonFile(
    join(projectRoot, "activate", "shared", "activation-manifest.json"),
    {
      schemaVersion: 1,
      host: "shared",
      generatedAt: new Date().toISOString(),
      activeBundles: [bundleId],
      activeAssets: [assetId],
      runtimeRoot: join(projectRoot, "activate", "shared"),
      notes: [],
    } satisfies ActivationManifest,
  );
  await writeJsonFile(
    join(
      projectRoot,
      "install",
      "shared",
      "bundles",
      `${bundleId}.install.json`,
    ),
    {
      schemaVersion: 1,
      bundleId,
      host: "shared",
      installedAt: new Date().toISOString(),
      packages: [
        {
          assetId,
          mirrorId: `${assetId}-mirror`,
          manifestPath: packageManifestPath,
        },
      ],
    } satisfies InstalledBundleManifest,
  );
  await writeJsonFile(packageManifestPath, {
    schemaVersion: 1,
    assetId,
    mirrorId: `${assetId}-mirror`,
    host: "shared",
    installedAt: new Date().toISOString(),
    projectionType: "linked",
    assetKind: "mcp-server",
    sourceAuthorityTier: "trusted-local",
    contextCost: {
      sizeClass: "tiny",
      estimatedPromptWeight: 1,
    },
    portfolioFit: 1,
    filesRoot: join(
      projectRoot,
      "install",
      "shared",
      "packages",
      sanitizeAssetId(assetId),
    ),
    bundleMembership: [bundleId],
    activationEligible: true,
    activeByDefault: true,
  } satisfies InstalledPackageManifest);
}

function rememberEnv(keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(previousEnv: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}

void test("VS Code wire internals strip managed settings and infer fallback plugin names", () => {
  const curatedRoot = join(
    getRuntimeConfig().paths.homeDirectory,
    ".copilot",
    "agent-harness",
  );

  assert.deepEqual(
    vscodeWireInternals.stripManagedVsCodeLocationEntries(null, curatedRoot),
    {},
  );
  assert.deepEqual(
    vscodeWireInternals.stripManagedVsCodeLocationEntries(
      {
        "~/keep": true,
        "~/.copilot/agent-harness": true,
        "~/.copilot/agent-harness/current/plugins": true,
        "~/explicit": true,
      },
      curatedRoot,
      new Set(["~/explicit"]),
    ),
    { "~/keep": true },
  );

  assert.equal(vscodeWireInternals.isManagedCodeGenerationEntry(null), false);
  assert.equal(
    vscodeWireInternals.isManagedCodeGenerationEntry("legacy"),
    false,
  );
  assert.deepEqual(
    vscodeWireInternals.stripManagedCodeGenerationInstructions([
      "legacy",
      { file: ".github/copilot-instructions.md" },
      { file: "keep.md" },
    ]),
    ["legacy", { file: "keep.md" }],
  );
  assert.deepEqual(
    vscodeWireInternals.upsertManagedCodeGenerationInstructions({
      file: "not-array",
    }),
    [{ file: ".github/copilot-instructions.md" }],
  );

  assert.equal(
    vscodeWireInternals.inferPluginFileName({
      content: "plain plugin",
      sourcePath: "",
    }),
    "README.md",
  );
  assert.equal(
    vscodeWireInternals.inferPluginFileName({ content: "[1, 2, 3]" }),
    "plugin.json",
  );
  assert.equal(vscodeWireInternals.toLoggableErrorMessage("plain"), "plain");
});
