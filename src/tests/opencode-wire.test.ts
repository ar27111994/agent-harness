import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  pathExists,
  readJsonFile,
  readTextFileOrNull,
  writeJsonFile,
  writeTextFile,
} from "../files.js";
import {
  openCodeWireInternals,
  wireOpenCode,
} from "../host-adapters/opencode.js";
import { sanitizeAssetId } from "../lib/safe-paths.js";
import type {
  ActivationManifest,
  AssetCatalogEntry,
  AssetHostNativeConfigMap,
  InstalledBundleManifest,
  InstalledPackageManifest,
  WirePlanManifest,
} from "../types.js";

void test("OpenCode wire apply/reset creates managed links, merges native config, and restores AGENTS", async () => {
  const fixture = await createOpenCodeFixture();

  try {
    await writeOpenCodeActivationFixture(
      fixture.projectRoot,
      fixture.workspaceRoot,
      fixture.assets,
    );
    await writeTextFile(
      join(fixture.workspaceRoot, "AGENTS.md"),
      "Existing AGENTS\n",
    );
    await writeJsonFile(join(fixture.workspaceRoot, "opencode.json"), {
      instructions: ["./existing.md"],
      plugins: {
        existing: true,
      },
    });

    await wireOpenCode({
      projectRoot: fixture.projectRoot,
      workspaceRoot: fixture.workspaceRoot,
      mode: "apply",
    });

    const localOverlayRoot = join(fixture.workspaceRoot, ".opencode");
    const localContextRoot = join(
      localOverlayRoot,
      "context",
      "project-intelligence",
      "agent-harness",
    );
    const wirePlan = await readJsonFile<WirePlanManifest>(
      join(localContextRoot, "wire-plan.json"),
    );

    assert.equal(wirePlan.host, "opencode-project");
    assert.ok((wirePlan.linkedPaths?.length ?? 0) >= fixture.assets.length - 1);
    assert.ok(
      wirePlan.nativeConfigOperations?.some(
        (operation) =>
          operation.path === "opencode.json" && operation.mode === "merge",
      ),
    );

    const agentsContent =
      (await readTextFileOrNull(join(fixture.workspaceRoot, "AGENTS.md"))) ??
      "";
    assert.match(agentsContent, /Agent Harness OpenCode overlay/u);
    assert.match(agentsContent, /shared.mcp.server/u);
    assert.match(agentsContent, /agent-harness:begin/u);

    const instructionLinkPath = join(
      localOverlayRoot,
      "context",
      "project-intelligence",
      "agent-harness",
      "instructions",
      `${sanitizeAssetId("opencode.instruction")}.md`,
    );
    assert.equal(
      await readTextFileOrNull(instructionLinkPath),
      "# OpenCode instruction\n",
    );
    assert.equal(
      await pathExists(
        join(localOverlayRoot, "skills", sanitizeAssetId("opencode.skill")),
      ),
      true,
    );
    assert.equal(
      await pathExists(
        join(localOverlayRoot, "plugins", sanitizeAssetId("opencode.plugin")),
      ),
      true,
    );

    assert.deepEqual(
      JSON.parse(
        await readFile(join(fixture.workspaceRoot, "opencode.json"), "utf8"),
      ),
      {
        instructions: [
          "./existing.md",
          `.opencode/context/project-intelligence/agent-harness/instructions/${sanitizeAssetId("opencode.instruction")}.md`,
        ],
        plugins: {
          existing: true,
          generated: true,
        },
      },
    );
    assert.equal(
      await readTextFileOrNull(
        join(fixture.workspaceRoot, ".opencode", "tools", "generated.md"),
      ),
      "# generated tool\n",
    );

    await wireOpenCode({
      projectRoot: fixture.projectRoot,
      workspaceRoot: fixture.workspaceRoot,
      mode: "reset",
    });

    assert.equal(
      await readTextFileOrNull(join(fixture.workspaceRoot, "AGENTS.md")),
      "Existing AGENTS\n",
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(join(fixture.workspaceRoot, "opencode.json"), "utf8"),
      ),
      {
        instructions: ["./existing.md"],
        plugins: {
          existing: true,
        },
      },
    );
    assert.equal(await pathExists(localContextRoot), false);
    assert.equal(
      await pathExists(
        join(localOverlayRoot, "skills", sanitizeAssetId("opencode.skill")),
      ),
      false,
    );
  } finally {
    await fixture.cleanup();
  }
});

void test("OpenCode wire apply writes a fallback activation manifest when activation state is missing", async () => {
  const fixture = await createOpenCodeFixture();

  try {
    await wireOpenCode({
      projectRoot: fixture.projectRoot,
      workspaceRoot: fixture.workspaceRoot,
      mode: "apply",
    });

    const localContextRoot = join(
      fixture.workspaceRoot,
      ".opencode",
      "context",
      "project-intelligence",
      "agent-harness",
    );
    const fallbackManifest = await readJsonFile<ActivationManifest>(
      join(localContextRoot, "activation-manifest.json"),
    );
    assert.deepEqual(fallbackManifest.activeAssets, []);
    assert.match(
      fallbackManifest.notes[0] ?? "",
      /No OpenCode activation manifest was found/u,
    );
    assert.match(
      (await readTextFileOrNull(join(fixture.workspaceRoot, "AGENTS.md"))) ??
        "",
      /No active OpenCode assets were found at wire time/u,
    );
  } finally {
    await fixture.cleanup();
  }
});

void test("OpenCode wire reset rejects wire plans that escape the managed root", async () => {
  const fixture = await createOpenCodeFixture();

  try {
    const localContextRoot = join(
      fixture.workspaceRoot,
      ".opencode",
      "context",
      "project-intelligence",
      "agent-harness",
    );
    await writeJsonFile(join(localContextRoot, "wire-plan.json"), {
      schemaVersion: 1,
      host: "opencode-project",
      generatedAt: new Date().toISOString(),
      workspaceRoot: fixture.workspaceRoot,
      runtimeRoot: join(fixture.workspaceRoot, ".opencode"),
      linkedPaths: [join(fixture.workspaceRoot, "..", "escape")],
      textFileSnapshots: [],
      notes: [],
    } satisfies WirePlanManifest);

    await assert.rejects(
      wireOpenCode({
        projectRoot: fixture.projectRoot,
        workspaceRoot: fixture.workspaceRoot,
        mode: "reset",
      }),
      /outside managed OpenCode root/u,
    );
  } finally {
    await fixture.cleanup();
  }
});

void test("OpenCode wire rolls back managed links and AGENTS changes when a target link already exists", async () => {
  const fixture = await createOpenCodeFixture();

  try {
    await writeOpenCodeActivationFixture(
      fixture.projectRoot,
      fixture.workspaceRoot,
      fixture.assets,
    );
    await writeTextFile(
      join(fixture.workspaceRoot, "AGENTS.md"),
      "Existing AGENTS\n",
    );
    await writeTextFile(
      join(
        fixture.workspaceRoot,
        ".opencode",
        "context",
        "project-intelligence",
        "agent-harness",
        "instructions",
        `${sanitizeAssetId("opencode.instruction")}.md`,
      ),
      "conflict\n",
    );

    await assert.rejects(
      wireOpenCode({
        projectRoot: fixture.projectRoot,
        workspaceRoot: fixture.workspaceRoot,
        mode: "apply",
      }),
      /Refusing to overwrite existing OpenCode file link/u,
    );

    assert.equal(
      await readTextFileOrNull(join(fixture.workspaceRoot, "AGENTS.md")),
      "Existing AGENTS\n",
    );
    assert.equal(
      await pathExists(
        join(
          fixture.workspaceRoot,
          ".opencode",
          "context",
          "project-intelligence",
          "agent-harness",
          "wire-plan.json",
        ),
      ),
      false,
    );
    assert.equal(
      await pathExists(
        join(
          fixture.workspaceRoot,
          ".opencode",
          "skills",
          sanitizeAssetId("opencode.skill"),
        ),
      ),
      false,
    );
  } finally {
    await fixture.cleanup();
  }
});

void test("OpenCode wire skips file-linked assets whose activation content is missing", async () => {
  const fixture = await createOpenCodeFixture();

  try {
    await writeOpenCodeActivationFixture(
      fixture.projectRoot,
      fixture.workspaceRoot,
      fixture.assets,
    );

    await rm(
      join(
        fixture.projectRoot,
        "activate",
        "opencode",
        sanitizeAssetId("opencode.instruction"),
        "content.txt",
      ),
      { force: true },
    );

    await wireOpenCode({
      projectRoot: fixture.projectRoot,
      workspaceRoot: fixture.workspaceRoot,
      mode: "apply",
    });

    assert.equal(
      await pathExists(
        join(
          fixture.workspaceRoot,
          ".opencode",
          "context",
          "project-intelligence",
          "agent-harness",
          "instructions",
          `${sanitizeAssetId("opencode.instruction")}.md`,
        ),
      ),
      false,
    );
  } finally {
    await fixture.cleanup();
  }
});

void test("OpenCode preview writes only the preview manifest", async () => {
  const fixture = await createOpenCodeFixture();

  try {
    await writeOpenCodeActivationFixture(
      fixture.projectRoot,
      fixture.workspaceRoot,
      fixture.assets,
    );

    await wireOpenCode({
      projectRoot: fixture.projectRoot,
      workspaceRoot: fixture.workspaceRoot,
      mode: "preview",
    });

    const preview = await readJsonFile<WirePlanManifest & { mode: string }>(
      join(
        fixture.projectRoot,
        "activate",
        "opencode",
        "wire-preview-opencode.json",
      ),
    );
    assert.equal(preview.mode, "preview");
    assert.equal(
      await pathExists(
        join(
          fixture.workspaceRoot,
          ".opencode",
          "context",
          "project-intelligence",
          "agent-harness",
        ),
      ),
      false,
    );
    assert.equal(
      await readTextFileOrNull(join(fixture.workspaceRoot, "AGENTS.md")),
      null,
    );
  } finally {
    await fixture.cleanup();
  }
});

void test("OpenCode reset removes AGENTS.md when the managed section was the only content", async () => {
  const fixture = await createOpenCodeFixture();

  try {
    await writeOpenCodeActivationFixture(
      fixture.projectRoot,
      fixture.workspaceRoot,
      fixture.assets,
    );

    await wireOpenCode({
      projectRoot: fixture.projectRoot,
      workspaceRoot: fixture.workspaceRoot,
      mode: "apply",
    });

    assert.match(
      (await readTextFileOrNull(join(fixture.workspaceRoot, "AGENTS.md"))) ??
        "",
      /agent-harness:begin/u,
    );

    await wireOpenCode({
      projectRoot: fixture.projectRoot,
      workspaceRoot: fixture.workspaceRoot,
      mode: "reset",
    });

    assert.equal(
      await readTextFileOrNull(join(fixture.workspaceRoot, "AGENTS.md")),
      null,
    );
  } finally {
    await fixture.cleanup();
  }
});

void test("OpenCode wire tolerates malformed shared MCP package state", async () => {
  const fixture = await createOpenCodeFixture();
  const warnings: string[] = [];
  const originalWarn = console.warn;

  console.warn = (message?: unknown, ...args: unknown[]) => {
    warnings.push([message, ...args].map(String).join(" "));
  };

  try {
    await writeOpenCodeActivationFixture(
      fixture.projectRoot,
      fixture.workspaceRoot,
      fixture.assets,
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

    await wireOpenCode({
      projectRoot: fixture.projectRoot,
      workspaceRoot: fixture.workspaceRoot,
      mode: "apply",
    });

    assert.ok(
      warnings.some((warning) =>
        warning.includes(
          "Failed to project shared MCP assets into OpenCode wire plan",
        ),
      ),
    );
  } finally {
    console.warn = originalWarn;
    await fixture.cleanup();
  }
});

async function createOpenCodeFixture(): Promise<{
  projectRoot: string;
  workspaceRoot: string;
  assets: AssetCatalogEntry[];
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-opencode-wire-"));
  const projectRoot = join(root, "project");
  const workspaceRoot = join(root, "workspace");
  return {
    projectRoot,
    workspaceRoot,
    assets: buildAssets(),
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function writeOpenCodeActivationFixture(
  projectRoot: string,
  workspaceRoot: string,
  assets: AssetCatalogEntry[],
): Promise<void> {
  const activationRoot = join(projectRoot, "activate", "opencode");
  const bundleId = "opencode-global";
  await writeJsonFile(join(activationRoot, "activation-manifest.json"), {
    schemaVersion: 1,
    host: "opencode",
    generatedAt: new Date().toISOString(),
    activeBundles: [bundleId],
    activeAssets: assets.map((asset) => asset.id),
    runtimeRoot: join(workspaceRoot, ".opencode"),
    notes: [],
  } satisfies ActivationManifest);

  const packageEntries: InstalledBundleManifest["packages"] = [];
  for (const asset of assets) {
    const assetRoot = join(activationRoot, sanitizeAssetId(asset.id));
    const packageManifestPath = join(
      projectRoot,
      "install",
      "opencode",
      "packages",
      `${sanitizeAssetId(asset.id)}.install.json`,
    );
    packageEntries.push({
      assetId: asset.id,
      mirrorId: `${asset.id}-mirror`,
      manifestPath: packageManifestPath,
    });

    await writeJsonFile(join(assetRoot, "asset.json"), asset);
    await writeTextFile(
      join(assetRoot, "content.txt"),
      `# ${asset.displayName}\n`,
    );
    await writeJsonFile(packageManifestPath, {
      schemaVersion: 1,
      assetId: asset.id,
      mirrorId: `${asset.id}-mirror`,
      host: "opencode",
      installedAt: new Date().toISOString(),
      projectionType:
        asset.assetKind === "instruction" ||
        asset.assetKind === "workflow" ||
        asset.assetKind === "prompt-pack"
          ? "file"
          : "linked",
      assetKind: asset.assetKind,
      sourceAuthorityTier: "trusted-local",
      contextCost: {
        sizeClass: "tiny",
        estimatedPromptWeight: 1,
      },
      portfolioFit: 1,
      filesRoot: assetRoot,
      bundleMembership: [bundleId],
      activationEligible: true,
      activeByDefault: true,
    } satisfies InstalledPackageManifest);
  }

  await writeJsonFile(
    join(
      projectRoot,
      "install",
      "opencode",
      "bundles",
      `${bundleId}.install.json`,
    ),
    {
      schemaVersion: 1,
      bundleId,
      host: "opencode",
      installedAt: new Date().toISOString(),
      packages: packageEntries,
    } satisfies InstalledBundleManifest,
  );

  await writeJsonFile(
    join(projectRoot, "activate", "shared", "activation-manifest.json"),
    {
      schemaVersion: 1,
      host: "shared",
      generatedAt: new Date().toISOString(),
      activeBundles: ["shared-bundle"],
      activeAssets: ["shared.mcp.server"],
      runtimeRoot: join(projectRoot, "activate", "shared"),
      notes: [],
    } satisfies ActivationManifest,
  );
  const sharedPackageManifestPath = join(
    projectRoot,
    "install",
    "shared",
    "packages",
    "shared-mcp.install.json",
  );
  await writeJsonFile(
    join(
      projectRoot,
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
          manifestPath: sharedPackageManifestPath,
        },
      ],
    } satisfies InstalledBundleManifest,
  );
  await writeJsonFile(sharedPackageManifestPath, {
    schemaVersion: 1,
    assetId: "shared.mcp.server",
    mirrorId: "shared-mirror",
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
    filesRoot: join(projectRoot, "install", "shared", "packages", "shared"),
    bundleMembership: ["shared-bundle"],
    activationEligible: true,
    activeByDefault: true,
  } satisfies InstalledPackageManifest);
}

function buildAssets(): AssetCatalogEntry[] {
  return [
    buildAsset("opencode.instruction", "instruction"),
    buildAsset("opencode.workflow", "workflow"),
    buildAsset("opencode.prompt-pack", "prompt-pack"),
    buildAsset("opencode.skill", "skill"),
    buildAsset("opencode.plugin", "plugin"),
    buildAsset("opencode.reference", "reference-pack"),
    buildAsset("opencode.native", "plugin", {
      hostNativeConfig: {
        opencode: {
          files: [
            {
              path: "opencode.json",
              format: "json",
              merge: true,
              content: {
                plugins: {
                  generated: true,
                },
              },
            },
            {
              path: ".opencode/tools/generated.md",
              format: "text",
              content: "# generated tool\n",
            },
          ],
        },
      },
    }),
  ];
}

function buildAsset(
  id: string,
  assetKind: AssetCatalogEntry["assetKind"],
  options: {
    hostNativeConfig?: AssetHostNativeConfigMap;
  } = {},
): AssetCatalogEntry {
  return {
    id,
    displayName:
      assetKind === "instruction"
        ? "OpenCode instruction"
        : id.replace(/[.-]/gu, " "),
    assetKind,
    hosts: ["opencode"],
    compatibilityMode: "adaptable",
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
      method: "local-file",
      adaptableHosts: ["opencode"],
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
    hostNativeConfig: options.hostNativeConfig,
  };
}

void test("OpenCode wire internals validate snapshots and restore AGENTS fallbacks", async (context) => {
  const root = await mkdtemp(
    join(tmpdir(), "agent-harness-opencode-internals-"),
  );
  const agentsPath = join(root, "AGENTS.md");
  const missingSourcePath = join(root, "missing-source.md");
  const linkPath = join(root, "link.md");

  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  assert.equal(
    openCodeWireInternals.validateManagedTextFileSnapshots(
      undefined,
      [agentsPath],
      agentsPath,
    ),
    undefined,
  );
  assert.throws(
    () =>
      openCodeWireInternals.validateManagedTextFileSnapshots(
        [
          {
            path: join(root, "outside.md").replaceAll("\\", "/"),
            content: null,
          },
        ],
        [agentsPath],
        join(root, "wire-plan.json"),
      ),
    /outside the managed OpenCode restore set/u,
  );
  assert.throws(
    () =>
      openCodeWireInternals.validateManagedTextFileSnapshots(
        [
          { path: agentsPath.replaceAll("\\", "/"), content: null },
          { path: agentsPath.replaceAll("\\", "/"), content: "duplicate" },
        ],
        [agentsPath],
        join(root, "wire-plan.json"),
      ),
    /duplicate textFileSnapshots/u,
  );

  await assert.rejects(
    openCodeWireInternals.materializeOpenCodeLinkedAsset({
      assetId: "missing.instruction",
      assetKind: "instruction",
      sourcePath: missingSourcePath,
      linkPath,
      linkMode: "file",
    }),
    /source content is missing/u,
  );

  await writeTextFile(
    agentsPath,
    [
      "<!-- agent-harness:begin -->",
      "managed",
      "<!-- agent-harness:end -->",
      "",
    ].join("\n"),
  );
  await openCodeWireInternals.restoreManagedTextFileSnapshot(
    agentsPath,
    undefined,
  );
  assert.equal(await readTextFileOrNull(agentsPath), null);

  await writeTextFile(agentsPath, "current\n");
  await openCodeWireInternals.restoreManagedTextFileSnapshot(agentsPath, [
    { path: agentsPath.replaceAll("\\", "/"), content: "snapshot\n" },
  ]);
  assert.equal(await readTextFileOrNull(agentsPath), "snapshot\n");

  await openCodeWireInternals.restoreManagedTextFileSnapshot(agentsPath, [
    { path: agentsPath.replaceAll("\\", "/"), content: null },
  ]);
  assert.equal(await readTextFileOrNull(agentsPath), null);

  assert.equal(openCodeWireInternals.toLoggableErrorMessage("plain"), "plain");
});
