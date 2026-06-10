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
  formatWirePlanSummary,
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
        join(
          localContextRoot,
          "plugin-references",
          `${sanitizeAssetId("opencode.plugin")}.md`,
        ),
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

void test("OpenCode apply and reset tolerate prior wire plans with omitted optional state", async () => {
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
      textFileSnapshots: [],
      notes: [],
    } satisfies WirePlanManifest);
    await writeTextFile(
      join(fixture.workspaceRoot, "AGENTS.md"),
      [
        "<!-- agent-harness:begin -->",
        "stale managed section",
        "<!-- agent-harness:end -->",
        "",
      ].join("\n"),
    );

    await wireOpenCode({
      projectRoot: fixture.projectRoot,
      workspaceRoot: fixture.workspaceRoot,
      mode: "apply",
    });

    assert.match(
      (await readTextFileOrNull(join(fixture.workspaceRoot, "AGENTS.md"))) ??
        "",
      /No active OpenCode assets were found at wire time/u,
    );

    await writeJsonFile(join(localContextRoot, "wire-plan.json"), {
      schemaVersion: 1,
      host: "opencode-project",
      generatedAt: new Date().toISOString(),
      workspaceRoot: fixture.workspaceRoot,
      runtimeRoot: join(fixture.workspaceRoot, ".opencode"),
      textFileSnapshots: [],
      notes: [],
    } satisfies WirePlanManifest);

    await wireOpenCode({
      projectRoot: fixture.projectRoot,
      workspaceRoot: fixture.workspaceRoot,
      mode: "reset",
    });

    assert.equal(await pathExists(localContextRoot), false);
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

void test("OpenCode wire skips missing bundles, inactive packages, and duplicate package entries", async () => {
  const fixture = await createOpenCodeFixture();

  try {
    await writeOpenCodeActivationFixture(
      fixture.projectRoot,
      fixture.workspaceRoot,
      fixture.assets,
    );

    const activationManifestPath = join(
      fixture.projectRoot,
      "activate",
      "opencode",
      "activation-manifest.json",
    );
    const activationManifest = await readJsonFile<ActivationManifest>(
      activationManifestPath,
    );
    await writeJsonFile(activationManifestPath, {
      ...activationManifest,
      activeBundles: ["missing-bundle", ...activationManifest.activeBundles],
    } satisfies ActivationManifest);

    const bundleManifestPath = join(
      fixture.projectRoot,
      "install",
      "opencode",
      "bundles",
      "opencode-global.install.json",
    );
    const bundleManifest =
      await readJsonFile<InstalledBundleManifest>(bundleManifestPath);
    await writeJsonFile(bundleManifestPath, {
      ...bundleManifest,
      packages: [
        ...bundleManifest.packages,
        {
          assetId: "inactive.asset",
          mirrorId: "inactive-mirror",
          manifestPath: join(
            fixture.projectRoot,
            "install",
            "opencode",
            "packages",
            "inactive.install.json",
          ),
        },
        bundleManifest.packages[0]!,
      ],
    } satisfies InstalledBundleManifest);

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
    const wirePlan = await readJsonFile<WirePlanManifest>(
      join(localContextRoot, "wire-plan.json"),
    );
    const linkedPaths = wirePlan.linkedPaths ?? [];
    assert.equal(
      linkedPaths.filter((linkedPath) =>
        linkedPath.includes(sanitizeAssetId("opencode.instruction")),
      ).length,
      1,
    );
    assert.equal(
      linkedPaths.some((linkedPath) => linkedPath.includes("inactive")),
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

void test("OpenCode preview includes npmInstallSummary note when .opencode/package.json exists", async () => {
  // Exercises buildOpenCodeProspectivePlan's npmInstallSummary != null branch.
  // The prospective plan is returned in-memory (not written to disk), so we call
  // buildOpenCodeProspectivePlan via openCodeWireInternals directly.
  const fixture = await createOpenCodeFixture();

  try {
    await writeOpenCodeActivationFixture(
      fixture.projectRoot,
      fixture.workspaceRoot,
      fixture.assets,
    );

    // Write a .opencode/package.json so buildOpenCodeProspectivePlan reads
    // the npm install summary and includes it in the notes.
    const opencodeDir = join(fixture.workspaceRoot, ".opencode");
    await mkdir(opencodeDir, { recursive: true });
    await writeJsonFile(join(opencodeDir, "package.json"), {
      dependencies: {
        "@opencode/some-plugin": "^1.0.0",
        "another-plugin": "^2.0.0",
      },
    });
    // Write a package-lock.json so the estimatedPackageCount uses lockfile entries.
    await writeJsonFile(join(opencodeDir, "package-lock.json"), {
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/@opencode/some-plugin": { version: "1.0.0" },
        "node_modules/another-plugin": { version: "2.0.0" },
        "node_modules/transitive-dep": { version: "3.0.0" },
      },
    });

    const activationRoot = join(fixture.projectRoot, "activate", "opencode");
    const localOverlayRoot = join(fixture.workspaceRoot, ".opencode");
    const localContextRoot = join(
      localOverlayRoot,
      "context",
      "project-intelligence",
      "agent-harness",
    );
    const localAgentsPath = join(fixture.workspaceRoot, "AGENTS.md");

    const prospectivePlan =
      await openCodeWireInternals.buildOpenCodeProspectivePlan({
        projectRoot: fixture.projectRoot,
        workspaceRoot: fixture.workspaceRoot,
        activationRoot,
        localOverlayRoot,
        localContextRoot,
        localAgentsPath,
      });

    // The prospective wire plan notes must include the npm install summary.
    const npmNote = prospectivePlan.notes.find((n) =>
      n.startsWith("OpenCode plugin npm install:"),
    );
    assert.ok(
      npmNote !== undefined,
      "wire plan notes must include the npm install summary when package.json exists",
    );
    assert.ok(
      npmNote.includes("2 declared dependencies"),
      `note must report declared dep count: ${npmNote}`,
    );
    assert.ok(
      npmNote.includes("installed packages"),
      `note must include installed-packages estimate: ${npmNote}`,
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
    buildAsset("opencode.plugin", "plugin", {
      compatibilityMode: "reference-only",
    }),
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
    compatibilityMode?: AssetCatalogEntry["compatibilityMode"];
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
    compatibilityMode: options.compatibilityMode ?? "adaptable",
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
      compatibilityMode: "adaptable",
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

// ─── formatWirePlanSummary tests ─────────────────────────────────────────────

function makeMinimalPlan(
  overrides: Partial<WirePlanManifest> = {},
): WirePlanManifest {
  return {
    schemaVersion: 1,
    host: "opencode-project",
    generatedAt: "2025-01-01T00:00:00.000Z",
    workspaceRoot: "/workspace",
    runtimeRoot: "/workspace/.opencode",
    notes: [],
    ...overrides,
  };
}

void test("formatWirePlanSummary includes header with host and workspace", () => {
  const summary = formatWirePlanSummary(makeMinimalPlan());
  assert.ok(summary.includes("wire opencode — plan preview"), "missing header");
  assert.ok(summary.includes("opencode-project"), "missing host");
  assert.ok(summary.includes("/workspace"), "missing workspace");
});

void test("formatWirePlanSummary shows linked path count and entries", () => {
  const plan = makeMinimalPlan({
    linkedPaths: [
      "/workspace/.opencode/agents/tool-a",
      "/workspace/.opencode/agents/tool-b",
    ],
  });
  const summary = formatWirePlanSummary(plan);
  assert.ok(summary.includes("Linked paths (2)"), "wrong linked path count");
  assert.ok(summary.includes("tool-a"), "missing path entry");
  assert.ok(summary.includes("tool-b"), "missing path entry");
});

void test("formatWirePlanSummary shows zero linked paths when absent", () => {
  const summary = formatWirePlanSummary(makeMinimalPlan({ linkedPaths: [] }));
  assert.ok(summary.includes("Linked paths (0)"), "wrong count for empty");
  assert.ok(summary.includes("— none"), "missing '— none' marker");
});

void test("formatWirePlanSummary shows MCP servers", () => {
  const plan = makeMinimalPlan({
    mcpServers: ["shared-mcp-asset-1", "shared-mcp-asset-2"],
  });
  const summary = formatWirePlanSummary(plan);
  assert.ok(summary.includes("MCP servers (2)"), "wrong MCP count");
  assert.ok(summary.includes("shared-mcp-asset-1"), "missing MCP entry");
});

void test("formatWirePlanSummary shows native config operations", () => {
  const plan = makeMinimalPlan({
    nativeConfigOperations: [
      { path: "opencode.json", format: "json", mode: "merge", content: {} },
    ],
  });
  const summary = formatWirePlanSummary(plan);
  assert.ok(summary.includes("Native config operations (1)"), "wrong op count");
  assert.ok(
    summary.includes("[merge] opencode.json (json)"),
    "wrong op format",
  );
});

void test("formatWirePlanSummary shows text file snapshots with preview", () => {
  const plan = makeMinimalPlan({
    textFileSnapshots: [
      { path: "AGENTS.md", content: "# Agent instructions\nLine 2" },
    ],
  });
  const summary = formatWirePlanSummary(plan);
  assert.ok(
    summary.includes("Text file snapshots (1)"),
    "wrong snapshot count",
  );
  assert.ok(summary.includes("AGENTS.md"), "missing snapshot path");
  assert.ok(summary.includes("Agent instructions"), "missing snapshot preview");
});

void test("formatWirePlanSummary shows null snapshot content as (null)", () => {
  const plan = makeMinimalPlan({
    textFileSnapshots: [{ path: "AGENTS.md", content: null }],
  });
  const summary = formatWirePlanSummary(plan);
  assert.ok(summary.includes("(null)"), "missing null marker");
});

void test("formatWirePlanSummary shows notes section", () => {
  const plan = makeMinimalPlan({
    notes: ["This is a preview.", "Nothing has been written."],
  });
  const summary = formatWirePlanSummary(plan);
  assert.ok(summary.includes("Notes:"), "missing notes section");
  assert.ok(summary.includes("This is a preview."), "missing note text");
  assert.ok(summary.includes("Nothing has been written."), "missing note text");
});

void test("formatWirePlanSummary skips notes section when notes is empty", () => {
  const summary = formatWirePlanSummary(makeMinimalPlan({ notes: [] }));
  assert.ok(!summary.includes("Notes:"), "notes section should be absent");
});

void test("formatWirePlanSummary output ends with newline", () => {
  const summary = formatWirePlanSummary(makeMinimalPlan());
  assert.ok(
    summary.endsWith("\n"),
    "must end with newline for clean terminal output",
  );
});

// ─── ensureOpenCodeOverlayGitignore tests ────────────────────────────────────

import { writeFile, mkdir } from "node:fs/promises";

const { ensureOpenCodeOverlayGitignore, readOpenCodeNpmInstallSummary } =
  openCodeWireInternals;

const REQUIRED_GITIGNORE_ENTRIES = [
  "node_modules",
  "package-lock.json",
  "bun.lockb",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".gitignore",
];

async function makeTmpWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "agent-harness-test-"));
}

void test("ensureOpenCodeOverlayGitignore: creates .gitignore when .opencode/ does not exist", async () => {
  const workspace = await makeTmpWorkspace();
  try {
    await ensureOpenCodeOverlayGitignore(workspace);
    const content = await readFile(
      join(workspace, ".opencode", ".gitignore"),
      "utf8",
    );
    for (const entry of REQUIRED_GITIGNORE_ENTRIES) {
      assert.ok(content.includes(entry), `missing entry: ${entry}`);
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

void test("ensureOpenCodeOverlayGitignore: adds missing entries to existing .gitignore", async () => {
  const workspace = await makeTmpWorkspace();
  try {
    await mkdir(join(workspace, ".opencode"), { recursive: true });
    await writeFile(
      join(workspace, ".opencode", ".gitignore"),
      "node_modules\n",
    );
    await ensureOpenCodeOverlayGitignore(workspace);
    const content = await readFile(
      join(workspace, ".opencode", ".gitignore"),
      "utf8",
    );
    for (const entry of REQUIRED_GITIGNORE_ENTRIES) {
      assert.ok(
        content.includes(entry),
        `missing entry after update: ${entry}`,
      );
    }
    // Original entry preserved
    assert.ok(content.includes("node_modules"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

void test("ensureOpenCodeOverlayGitignore: is idempotent when all entries already present", async () => {
  const workspace = await makeTmpWorkspace();
  try {
    await mkdir(join(workspace, ".opencode"), { recursive: true });
    const full = REQUIRED_GITIGNORE_ENTRIES.join("\n") + "\n";
    await writeFile(join(workspace, ".opencode", ".gitignore"), full);
    await ensureOpenCodeOverlayGitignore(workspace);
    const content = await readFile(
      join(workspace, ".opencode", ".gitignore"),
      "utf8",
    );
    assert.strictEqual(content, full, "file must be unchanged");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

void test("ensureOpenCodeOverlayGitignore: preserves existing custom entries", async () => {
  const workspace = await makeTmpWorkspace();
  try {
    await mkdir(join(workspace, ".opencode"), { recursive: true });
    await writeFile(
      join(workspace, ".opencode", ".gitignore"),
      "# custom\nmy-secret-dir\n",
    );
    await ensureOpenCodeOverlayGitignore(workspace);
    const content = await readFile(
      join(workspace, ".opencode", ".gitignore"),
      "utf8",
    );
    assert.ok(
      content.includes("my-secret-dir"),
      "custom entry must be preserved",
    );
    for (const entry of REQUIRED_GITIGNORE_ENTRIES) {
      assert.ok(content.includes(entry), `missing required entry: ${entry}`);
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

// ─── readOpenCodeNpmInstallSummary tests ─────────────────────────────────────

void test("readOpenCodeNpmInstallSummary: returns null when no .opencode/package.json", async () => {
  const workspace = await makeTmpWorkspace();
  try {
    const result = await readOpenCodeNpmInstallSummary(workspace);
    assert.strictEqual(result, null);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

void test("readOpenCodeNpmInstallSummary: returns summary with lockfile package count", async () => {
  const workspace = await makeTmpWorkspace();
  try {
    await mkdir(join(workspace, ".opencode"), { recursive: true });
    await writeFile(
      join(workspace, ".opencode", "package.json"),
      JSON.stringify({ dependencies: { "@opencode-ai/plugin": "1.4.3" } }),
    );
    const lockfile = {
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/@opencode-ai/plugin": {},
        "node_modules/zod": {},
        "node_modules/cross-spawn": {},
      },
    };
    await writeFile(
      join(workspace, ".opencode", "package-lock.json"),
      JSON.stringify(lockfile),
    );
    const result = await readOpenCodeNpmInstallSummary(workspace);
    assert.ok(result !== null);
    assert.strictEqual(result!.declaredDependencyCount, 1);
    // 4 packages in lockfile minus 1 for root "" entry = 3
    assert.strictEqual(result!.estimatedPackageCount, 3);
    assert.ok(result!.packageJsonPath.endsWith(".opencode/package.json"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

void test("readOpenCodeNpmInstallSummary: falls back to heuristic when no lockfile", async () => {
  const workspace = await makeTmpWorkspace();
  try {
    await mkdir(join(workspace, ".opencode"), { recursive: true });
    await writeFile(
      join(workspace, ".opencode", "package.json"),
      JSON.stringify({
        dependencies: { a: "1.0.0", b: "2.0.0" },
        devDependencies: { c: "3.0.0" },
      }),
    );
    const result = await readOpenCodeNpmInstallSummary(workspace);
    assert.ok(result !== null);
    assert.strictEqual(result!.declaredDependencyCount, 3);
    // No lockfile: falls back to declared count (no multiplier — honest estimate)
    assert.strictEqual(result!.estimatedPackageCount, 3);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

void test("readOpenCodeNpmInstallSummary: handles empty dependencies gracefully", async () => {
  const workspace = await makeTmpWorkspace();
  try {
    await mkdir(join(workspace, ".opencode"), { recursive: true });
    await writeFile(
      join(workspace, ".opencode", "package.json"),
      JSON.stringify({ name: "test" }),
    );
    const result = await readOpenCodeNpmInstallSummary(workspace);
    assert.ok(result !== null);
    assert.strictEqual(result!.declaredDependencyCount, 0);
    assert.strictEqual(result!.estimatedPackageCount, 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

void test("readOpenCodeNpmInstallSummary: throws when .opencode/package.json contains invalid JSON", async () => {
  // readJsonFileOrNull re-throws JSON parse errors (it only masks ENOENT).
  // Verify the function surfaces the parse error rather than silently returning null.
  const workspace = await makeTmpWorkspace();
  try {
    await mkdir(join(workspace, ".opencode"), { recursive: true });
    await writeFile(
      join(workspace, ".opencode", "package.json"),
      "{ this is not valid JSON !!!",
    );
    await assert.rejects(
      () => readOpenCodeNpmInstallSummary(workspace),
      /Invalid JSON/,
      "should rethrow JSON parse errors from readJsonFileOrNull",
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

void test("wireOpenCode: wire-plan notes include npm install summary when .opencode/package.json exists", async () => {
  // Exercises opencode.ts:226-231 — the npmInstallSummary !== null branch inside
  // buildOpenCodeWirePlan that appends the npm-install note to the plan notes array.
  const fixture = await createOpenCodeFixture();

  try {
    await writeOpenCodeActivationFixture(
      fixture.projectRoot,
      fixture.workspaceRoot,
      fixture.assets,
    );

    // Pre-create .opencode/package.json so readOpenCodeNpmInstallSummary returns non-null
    await mkdir(join(fixture.workspaceRoot, ".opencode"), { recursive: true });
    await writeFile(
      join(fixture.workspaceRoot, ".opencode", "package.json"),
      JSON.stringify({
        dependencies: { "@opencode-ai/test-plugin": "1.0.0" },
      }),
    );

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
    const wirePlan = await readJsonFile<WirePlanManifest>(
      join(localContextRoot, "wire-plan.json"),
    );

    // The npm-install note should be present when npmInstallSummary is non-null
    const npmNote = wirePlan.notes?.find((n) =>
      n.includes("OpenCode plugin npm install"),
    );
    assert.ok(
      npmNote !== undefined,
      "wire plan should include npm install summary note when .opencode/package.json is present",
    );
    assert.ok(
      npmNote!.includes("1 declared dependencies"),
      "note should include declared dependency count",
    );
    assert.ok(
      wirePlan.npmInstallSummary !== undefined,
      "wire plan should include npmInstallSummary when .opencode/package.json is present",
    );
  } finally {
    await fixture.cleanup();
  }
});
