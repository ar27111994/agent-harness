import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readJsonFile,
  writeJsonFile,
  writeJsonLinesFile,
  writeTextFile,
} from "../files.js";
import { generateBundleLocks, resolveBundleLocks } from "../mirror/bundles.js";
import {
  diffMirrorIndex,
  explainBundleLock,
  explainMirrorArtifact,
} from "../mirror/inspect.js";
import { MIRROR_PLAN_OUTPUT_PATH } from "../mirror/constants.js";
import { generateMirrorPlan } from "../mirror/plan.js";
import type {
  AssetCatalogEntry,
  BundleLock,
  MirrorIndexEntry,
  MirrorPlan,
  MirrorPolicy,
} from "../types.js";

function buildMirrorPolicy(): MirrorPolicy {
  return {
    schemaVersion: 1,
    selection: {
      officialBeatsPopularity: true,
      requirePinnedProvenance: false,
      communityDefaultPolicy: "allow",
    },
    audit: {
      alwaysAudit: false,
      quarantineOn: [],
    },
    store: {
      root: "mirror",
      rawDirectories: ["raw"],
      normalizedDirectories: [],
      bundlesDirectory: "bundles",
      quarantineDirectory: "quarantine",
      auditDirectory: "audit",
    },
    bundleTemplates: [
      {
        id: "community-stable",
        host: "copilot-vscode",
        description: "Community fixtures",
        assetKinds: ["skill", "instruction"],
        defaultPromotion: "manual",
      },
      {
        id: "copilot-core",
        host: "copilot-vscode",
        description: "Core copilot assets",
        assetKinds: ["skill", "agent", "instruction"],
        defaultPromotion: "auto",
      },
      {
        id: "shared-mcp",
        host: "shared",
        description: "Shared MCP assets",
        assetKinds: ["mcp-server", "instruction"],
        defaultPromotion: "auto",
      },
      {
        id: "shared-overlays",
        host: "shared",
        description: "Shared overlays",
        assetKinds: ["instruction", "skill"],
        defaultPromotion: "manual",
      },
    ],
  };
}

function buildAsset(
  id: string,
  overrides: Partial<AssetCatalogEntry> = {},
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: "skill",
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId: "fixture-source",
      authorityTier: "official-first-party",
      sourceKind: "docs",
      sourcePriority: 100,
      originUrl: `https://example.com/assets/${id}`,
      publisher: "Fixture",
      publisherVerified: true,
    },
    trust: {
      score: 100,
      signals: [],
    },
    capabilities: ["fixture"],
    install: {
      method: "local-file",
      nativeHosts: ["copilot-vscode"],
      manifestEntry: id,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: `${id}.md`,
      rootPath: "/fixture",
    },
    maintenance: {
      lastUpdated: "2026-01-01T00:00:00.000Z",
      stars: 0,
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
      portfolioFit: 0.9,
      hostFit: 0.9,
    },
    dedupe: {
      candidateRankHint: "fixture",
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

function createMirrorIndexEntry(
  assetId: string,
  overrides: Partial<MirrorIndexEntry> = {},
): MirrorIndexEntry {
  return {
    mirrorId: `sha256-${assetId}`,
    assetId,
    upstream: {
      type: "local",
      url: `file:///fixture/${assetId}`,
    },
    source: {
      authorityTier: "trusted-local",
      publisher: "Fixture",
      publisherVerified: true,
    },
    mirroredAt: new Date().toISOString(),
    contentHash: `hash-${assetId}`,
    projectionCandidates: [
      {
        host: "copilot-vscode",
        projectionType: "native-skill",
      },
    ],
    status: "approved",
    ...overrides,
  };
}

void test("generateMirrorPlan summarizes ready mirror inputs and counts candidates", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-mirror-plan-"),
  );
  const consoleOutput: string[] = [];

  try {
    await writeJsonFile(
      join(projectRoot, "mirror", "policy.json"),
      buildMirrorPolicy(),
    );
    await writeJsonFile(
      join(projectRoot, "discover", "output", "demand-profile.json"),
      {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
      },
    );
    await writeJsonFile(
      join(projectRoot, "discover", "output", "source-index.json"),
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
      },
    );
    await writeJsonLinesFile(
      join(projectRoot, "discover", "catalog.assets.jsonl"),
      [
        buildAsset("copilot-skill"),
        buildAsset("shared-guide", {
          assetKind: "instruction",
          hosts: ["shared", "copilot-vscode"],
        }),
        buildAsset("audit-only", {
          status: {
            cataloged: true,
            mirrorEligible: false,
            installEligible: false,
            activationEligible: false,
          },
        }),
      ],
    );
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [
        buildAsset("copilot-skill"),
        buildAsset("shared-guide", {
          assetKind: "instruction",
          hosts: ["shared", "copilot-vscode"],
        }),
      ],
    );

    t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
      consoleOutput.push(args.map((value) => String(value)).join(" "));
    });

    await generateMirrorPlan(projectRoot);

    const mirrorPlan = await readJsonFile<MirrorPlan>(
      join(projectRoot, ...MIRROR_PLAN_OUTPUT_PATH),
    );

    assert.equal(mirrorPlan.inputs.demandProfile, true);
    assert.equal(mirrorPlan.inputs.sourceIndex, true);
    assert.equal(mirrorPlan.inputs.catalogEntries, 3);
    assert.equal(mirrorPlan.inputs.mirrorEligibleEntries, 2);
    assert.equal(mirrorPlan.candidateBreakdown.byHost["copilot-vscode"], 2);
    assert.equal(mirrorPlan.candidateBreakdown.byHost.shared, 1);
    assert.equal(mirrorPlan.candidateBreakdown.byAssetKind.skill, 1);
    assert.equal(mirrorPlan.candidateBreakdown.byAssetKind.instruction, 1);
    assert.deepEqual(mirrorPlan.nextActions, [
      "Resolve exact artifact versions for canonical selected assets before writing mirror locks.",
      "Mirror only canonical or explicitly approved alternative assets into the inert mirror store.",
    ]);
    assert.match(consoleOutput.join("\n"), /Mirror plan written to /u);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("generateMirrorPlan emits corrective next actions when prerequisites are incomplete", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-mirror-plan-"),
  );

  try {
    await writeJsonFile(
      join(projectRoot, "mirror", "policy.json"),
      buildMirrorPolicy(),
    );
    await writeJsonLinesFile(
      join(projectRoot, "discover", "catalog.assets.jsonl"),
      [
        buildAsset("audit-only", {
          status: {
            cataloged: true,
            mirrorEligible: false,
            installEligible: false,
            activationEligible: false,
          },
        }),
      ],
    );
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [],
    );

    await generateMirrorPlan(projectRoot);

    const mirrorPlan = await readJsonFile<MirrorPlan>(
      join(projectRoot, ...MIRROR_PLAN_OUTPUT_PATH),
    );

    assert.deepEqual(mirrorPlan.nextActions, [
      "Run discover demand-profile to capture current-directory portfolio signals.",
      "Run discover sources to summarize enabled discovery sources.",
      "Review catalog statuses and enable mirror eligibility only for approved local assets.",
      "Create discover/output/catalog.selected.jsonl after canonical selection and promotion rules are applied to catalog entries.",
    ]);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("generateBundleLocks applies bundle inclusion rules, projection types, and deduplication", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-bundle-locks-"),
  );

  try {
    await writeJsonFile(
      join(projectRoot, "mirror", "policy.json"),
      buildMirrorPolicy(),
    );
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [
        buildAsset("community-skill", {
          source: {
            sourceId: "local-antigravity-manifest",
            authorityTier: "trusted-local",
            sourceKind: "local-directory",
            sourcePriority: 100,
            originUrl: "file:///fixture/community-skill",
            publisher: "Fixture",
            publisherVerified: true,
          },
          install: {
            method: "local-file",
            nativeHosts: ["copilot-vscode"],
            manifestEntry: "community-skill",
          },
        }),
        buildAsset("official-skill", {
          fit: { portfolioFit: 0.4, hostFit: 0.9 },
        }),
        buildAsset("official-skill-low-fit", {
          fit: { portfolioFit: 0.2, hostFit: 0.9 },
        }),
        buildAsset("copilot-agent", {
          assetKind: "agent",
        }),
        buildAsset("shared-mcp", {
          assetKind: "mcp-server",
          hosts: ["opencode"],
        }),
        buildAsset("shared-overlay", {
          assetKind: "instruction",
          hosts: ["shared"],
        }),
        buildAsset("shared-overlay", {
          assetKind: "instruction",
          hosts: ["shared"],
        }),
      ],
    );

    await generateBundleLocks(projectRoot);

    const communityStable = await readJsonFile<BundleLock>(
      join(projectRoot, "mirror", "bundles", "community-stable.lock.json"),
    );
    const copilotCore = await readJsonFile<BundleLock>(
      join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
    );
    const sharedMcp = await readJsonFile<BundleLock>(
      join(projectRoot, "mirror", "bundles", "shared-mcp.lock.json"),
    );
    const sharedOverlays = await readJsonFile<BundleLock>(
      join(projectRoot, "mirror", "bundles", "shared-overlays.lock.json"),
    );

    assert.deepEqual(
      communityStable.assets.map((asset) => asset.assetId),
      ["community-skill"],
    );
    assert.equal(communityStable.assets[0]?.projectionType, "native-skill");

    assert.deepEqual(
      copilotCore.assets.map((asset) => asset.assetId),
      ["copilot-agent", "official-skill"],
    );
    assert.equal(copilotCore.assets[0]?.projectionType, "native-agent");
    assert.equal(
      copilotCore.assets[1]?.notes,
      "Resolve exact upstream artifact and replace unresolved mirrorId during raw mirror acquisition.",
    );

    assert.deepEqual(
      sharedMcp.assets.map((asset) => asset.assetId),
      ["shared-mcp", "shared-overlay"],
    );
    assert.ok(
      sharedMcp.assets.every(
        (asset) => asset.projectionType === "shared-mcp-candidate",
      ),
    );

    assert.deepEqual(
      sharedOverlays.assets.map((asset) => asset.assetId),
      ["shared-overlay"],
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("explainBundleLock prints human and machine-readable inclusion reasons", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-bundle-explain-"),
  );
  const output: string[] = [];

  try {
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [
        buildAsset("official-skill"),
        buildAsset("audit-only", {
          status: {
            cataloged: true,
            mirrorEligible: true,
            installEligible: false,
            activationEligible: false,
          },
        }),
      ],
    );
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      createMirrorIndexEntry("official-skill"),
    ]);
    await writeJsonFile(
      join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
      {
        schemaVersion: 1,
        bundleId: "copilot-core",
        generatedAt: new Date().toISOString(),
        host: "copilot-vscode",
        assets: [
          {
            assetId: "official-skill",
            mirrorId: "sha256-official-skill",
            projectionType: "native-skill",
            activationEligible: true,
          },
          {
            assetId: "audit-only",
            mirrorId: "unresolved:audit-only",
            projectionType: "native-skill",
            activationEligible: false,
          },
        ],
      } satisfies BundleLock,
    );

    t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
      output.push(args.map((value) => String(value)).join(" "));
    });

    await explainBundleLock(projectRoot, ["--bundle", "copilot-core"]);
    assert.match(output.join("\n"), /Bundle: copilot-core/u);
    assert.match(output.join("\n"), /mirror status approved/u);
    assert.match(output.join("\n"), /mirrored for audit only/u);

    output.length = 0;
    await explainBundleLock(projectRoot, ["copilot-core", "--json"]);
    const explained = JSON.parse(output.join("\n")) as {
      assets: Array<{ assetId: string; reason: string }>;
    };
    assert.equal(explained.assets[0]?.assetId, "official-skill");
    assert.match(explained.assets[1]?.reason ?? "", /waiting for mirror/u);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("explainBundleLock renders unknown trust when no catalog or mirror entry exists", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-bundle-explain-unknown-"),
  );

  try {
    await writeJsonFile(
      join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
      {
        schemaVersion: 1,
        bundleId: "copilot-core",
        generatedAt: new Date().toISOString(),
        host: "copilot-vscode",
        assets: [
          {
            assetId: "unresolved-asset",
            mirrorId: "sha256-unresolved",
            projectionType: "native-skill",
            activationEligible: true,
            notes: "fixture",
          },
        ],
      } satisfies BundleLock,
    );
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.rejected.jsonl"),
      [],
    );
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      createMirrorIndexEntry("unresolved-asset", {
        mirrorId: "sha256-unresolved",
        source: {
          authorityTier: "trusted-community",
          publisher: "Fixture",
          publisherVerified: true,
        },
      }),
    ]);

    const output: string[] = [];
    t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
      output.push(args.map((value) => String(value)).join(" "));
    });

    await explainBundleLock(projectRoot, ["copilot-core"]);

    const rendered = output.join("\n");
    assert.match(rendered, /trust: trusted-community/u);
    assert.match(rendered, /mirror: approved \(sha256-unresolved\)/u);

    output.length = 0;
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), []);
    await explainBundleLock(projectRoot, ["copilot-core"]);
    assert.match(output.join("\n"), /trust: unknown/u);

    await explainBundleLock(projectRoot, ["copilot-core", "--json"]);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("explainBundleLock explains rejected and unresolved assets", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-bundle-explain-rejected-"),
  );
  const output: string[] = [];

  try {
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.rejected.jsonl"),
      [buildAsset("rejected-duplicate", { assetKind: "plugin" })],
    );
    await writeJsonFile(
      join(projectRoot, "discover", "output", "selection-report.json"),
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        inputCount: 2,
        selectedCount: 1,
        rejectedCount: 1,
        duplicateDecisions: [
          {
            duplicateGroup: "fixture-group",
            selectedAssetId: "official-skill",
            rejectedAssetIds: ["rejected-duplicate"],
            selectionReason: "official asset outranks duplicate",
          },
        ],
      },
    );
    await writeJsonFile(
      join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
      {
        schemaVersion: 1,
        bundleId: "copilot-core",
        generatedAt: new Date().toISOString(),
        host: "copilot-vscode",
        assets: [
          {
            assetId: "rejected-duplicate",
            mirrorId: "sha256-rejected-duplicate",
            projectionType: "native-plugin",
            activationEligible: true,
          },
          {
            assetId: "missing-catalog",
            mirrorId: "missing-mirror",
            projectionType: "native-skill",
            activationEligible: true,
          },
        ],
      } satisfies BundleLock,
    );

    t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
      output.push(args.map((value) => String(value)).join(" "));
    });

    await explainBundleLock(projectRoot, ["copilot-core", "--json"]);
    const explained = JSON.parse(output.join("\n")) as {
      assets: Array<{
        assetId: string;
        assetKind: string;
        mirrorStatus: string;
        reason: string;
        rejected: boolean;
        sourceAuthorityTier?: string;
      }>;
    };

    assert.equal(explained.assets[0]?.rejected, true);
    assert.equal(explained.assets[0]?.assetKind, "plugin");
    assert.match(explained.assets[0]?.reason ?? "", /rejected as duplicate/u);
    assert.equal(explained.assets[1]?.assetKind, "unknown");
    assert.equal(explained.assets[1]?.mirrorStatus, "unresolved");
    assert.equal(explained.assets[1]?.sourceAuthorityTier, undefined);
    assert.match(
      explained.assets[1]?.reason ?? "",
      /no longer in the selected or rejected catalog/u,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("explainBundleLock requires a bundle id", async () => {
  await assert.rejects(
    explainBundleLock(process.cwd(), []),
    /bundle explain requires --bundle <bundleId>/u,
  );
});

void test("resolveBundleLocks replaces unresolved mirror ids from the mirror index", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-bundle-locks-"),
  );

  try {
    await writeJsonFile(
      join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
      {
        schemaVersion: 1,
        bundleId: "copilot-core",
        generatedAt: new Date().toISOString(),
        host: "copilot-vscode",
        assets: [
          {
            assetId: "official-skill",
            mirrorId: "unresolved:official-skill",
            projectionType: "native-skill",
            activationEligible: true,
          },
          {
            assetId: "unknown-skill",
            mirrorId: "unresolved:unknown-skill",
            projectionType: "native-skill",
            activationEligible: true,
          },
        ],
      } satisfies BundleLock,
    );

    await resolveBundleLocks(
      projectRoot,
      [createMirrorIndexEntry("official-skill")],
      ["copilot-core"],
    );

    const resolvedLock = await readJsonFile<BundleLock>(
      join(projectRoot, "mirror", "bundles", "copilot-core.lock.json"),
    );

    assert.equal(resolvedLock.assets[0]?.mirrorId, "sha256-official-skill");
    assert.equal(resolvedLock.assets[1]?.mirrorId, "unresolved:unknown-skill");
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("resolveBundleLocks silently skips bundle IDs whose lock files do not exist (cold checkout)", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-bundle-locks-cold-"),
  );

  try {
    // No lock files are written — mirror/bundles/ does not exist.
    // resolveBundleLocks must not throw ENOENT.
    await assert.doesNotReject(
      resolveBundleLocks(
        projectRoot,
        [createMirrorIndexEntry("official-skill")],
        ["copilot-core", "opencode-global", "shared-mcp"],
      ),
      "resolveBundleLocks should not throw when lock files are absent",
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("diffMirrorIndex reports added removed and changed assets", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-mirror-diff-"),
  );
  const output: string[] = [];

  try {
    await writeJsonLinesFile(
      join(projectRoot, "mirror", "index.previous.jsonl"),
      [
        createMirrorIndexEntry("removed-skill"),
        createMirrorIndexEntry("changed-skill", { mirrorId: "sha256-old" }),
        createMirrorIndexEntry("stable-skill"),
      ],
    );
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      createMirrorIndexEntry("added-skill"),
      createMirrorIndexEntry("changed-skill", { mirrorId: "sha256-new" }),
      createMirrorIndexEntry("stable-skill"),
    ]);

    t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
      output.push(args.map((value) => String(value)).join(" "));
    });

    await diffMirrorIndex(projectRoot);

    assert.deepEqual(output, [
      "Mirror index diff: previous -> current",
      "  Added assets: added-skill",
      "  Removed assets: removed-skill",
      "  Changed assets: changed-skill",
    ]);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("explainMirrorArtifact prints the matched raw mirror artifact payload", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-mirror-explain-"),
  );
  const output: string[] = [];

  try {
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      createMirrorIndexEntry("fixture-skill"),
    ]);
    await writeJsonFile(
      join(
        projectRoot,
        "mirror",
        "raw",
        "sha256-fixture-skill",
        "manifest.json",
      ),
      {
        files: [{ relativePath: "content.txt", size: 14 }],
      },
    );
    await writeTextFile(
      join(projectRoot, "mirror", "raw", "sha256-fixture-skill", "content.txt"),
      "# Fixture\n\nPreview me.\n",
    );

    t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
      output.push(args.map((value) => String(value)).join(" "));
    });

    await explainMirrorArtifact(projectRoot, ["--asset", "fixture-skill"]);

    const explained = JSON.parse(output.join("\n")) as {
      mirrorIndex: MirrorIndexEntry;
      rawRoot: string;
      manifest: { files: Array<{ relativePath: string; size: number }> };
      contentPreview: string;
    };

    assert.equal(explained.mirrorIndex.assetId, "fixture-skill");
    assert.match(explained.rawRoot, /mirror\/raw\/sha256-fixture-skill$/u);
    assert.equal(explained.manifest.files[0]?.relativePath, "content.txt");
    assert.equal(explained.contentPreview, "# Fixture\n\nPreview me.\n");
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("explainMirrorArtifact rejects calls without a lookup selector", async () => {
  await assert.rejects(
    explainMirrorArtifact(process.cwd(), []),
    /mirror explain requires --asset or --mirror/u,
  );
});

void test("explainMirrorArtifact rejects unknown assets and mirror ids", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-mirror-explain-"),
  );

  try {
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      createMirrorIndexEntry("fixture-skill"),
    ]);

    await assert.rejects(
      explainMirrorArtifact(projectRoot, ["--asset", "missing-skill"]),
      /No matching mirror artifact found\./u,
    );
    await assert.rejects(
      explainMirrorArtifact(projectRoot, ["--mirror", "sha256-missing"]),
      /No matching mirror artifact found\./u,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("generateMirrorPlan recommends catalog generation when no assets exist yet", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-mirror-plan-"),
  );

  try {
    await writeJsonFile(
      join(projectRoot, "mirror", "policy.json"),
      buildMirrorPolicy(),
    );
    await writeJsonLinesFile(
      join(projectRoot, "discover", "catalog.assets.jsonl"),
      [],
    );
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [],
    );

    await generateMirrorPlan(projectRoot);

    const mirrorPlan = await readJsonFile<MirrorPlan>(
      join(projectRoot, ...MIRROR_PLAN_OUTPUT_PATH),
    );

    assert.deepEqual(mirrorPlan.nextActions, [
      "Run discover demand-profile to capture current-directory portfolio signals.",
      "Run discover sources to summarize enabled discovery sources.",
      "Run discover catalog to harvest local manifest and local directory sources into discover/catalog.assets.jsonl.",
      "Create discover/output/catalog.selected.jsonl after canonical selection and promotion rules are applied to catalog entries.",
    ]);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("generateBundleLocks keeps adapted assets in host-specific bundles", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-bundle-locks-"),
  );
  const policy = buildMirrorPolicy();

  try {
    await writeJsonFile(join(projectRoot, "mirror", "policy.json"), {
      ...policy,
      bundleTemplates: [
        ...policy.bundleTemplates,
        {
          id: "cursor-core",
          host: "cursor",
          description: "Cursor fixtures",
          assetKinds: ["skill"],
          defaultPromotion: "manual",
        },
      ],
    });
    await writeJsonLinesFile(
      join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
      [
        buildAsset("cursor-skill", {
          hosts: ["cursor"],
          compatibilityMode: "adaptable",
          source: {
            sourceId: "cursor-fixture",
            authorityTier: "trusted-community",
            sourceKind: "docs",
            sourcePriority: 100,
            originUrl: "https://example.com/cursor-skill",
            publisher: "Fixture",
            publisherVerified: true,
          },
          install: {
            method: "local-file",
            adaptableHosts: ["cursor"],
            manifestEntry: "cursor-skill",
          },
        }),
      ],
    );

    await generateBundleLocks(projectRoot);

    const cursorCore = await readJsonFile<BundleLock>(
      join(projectRoot, "mirror", "bundles", "cursor-core.lock.json"),
    );

    assert.deepEqual(
      cursorCore.assets.map((asset) => asset.assetId),
      ["cursor-skill"],
    );
    assert.equal(cursorCore.assets[0]?.projectionType, "adapted-skill");
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("diffMirrorIndex reports no changes with explicit none markers", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-mirror-diff-"),
  );
  const output: string[] = [];
  const stable = createMirrorIndexEntry("stable-skill");

  try {
    await writeJsonLinesFile(
      join(projectRoot, "mirror", "index.previous.jsonl"),
      [stable],
    );
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      stable,
    ]);

    t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
      output.push(args.map((value) => String(value)).join(" "));
    });

    await diffMirrorIndex(projectRoot);

    assert.deepEqual(output, [
      "Mirror index diff: previous -> current",
      "  Added assets: none",
      "  Removed assets: none",
      "  Changed assets: none",
    ]);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

void test("explainMirrorArtifact resolves by mirror id and tolerates missing previews", async (t) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-mirror-explain-"),
  );
  const output: string[] = [];

  try {
    await writeJsonLinesFile(join(projectRoot, "mirror", "index.jsonl"), [
      createMirrorIndexEntry("fixture-skill"),
    ]);
    await writeJsonFile(
      join(
        projectRoot,
        "mirror",
        "raw",
        "sha256-fixture-skill",
        "manifest.json",
      ),
      {
        files: [],
      },
    );

    t.mock.method(globalThis.console, "log", (...args: unknown[]) => {
      output.push(args.map((value) => String(value)).join(" "));
    });

    await explainMirrorArtifact(projectRoot, [
      "--mirror",
      "sha256-fixture-skill",
    ]);

    const explained = JSON.parse(output.join("\n")) as {
      contentPreview: string | null;
      mirrorIndex: MirrorIndexEntry;
    };
    assert.equal(explained.mirrorIndex.mirrorId, "sha256-fixture-skill");
    assert.equal(explained.contentPreview, null);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});
