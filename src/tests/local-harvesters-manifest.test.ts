/**
 * Targeted tests for local-harvesters.ts coverage gaps:
 * - harvestLocalManifestSource: manifest loading, classifyManifestEntryAssetKind, collectManifestCapabilities
 * - local-opencode-config classification
 * - local-opencode-context classification
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import {
  harvestLocalDirectorySource,
  harvestLocalManifestSource,
} from "../domains/discovery/local-harvesters.js";
import type {
  AssetKind,
  HostTarget,
  SelectionRegistry,
  SourceDefinition,
} from "../types.js";

const LOCAL_ASSET_KINDS: AssetKind[] = [
  "skill",
  "plugin",
  "agent",
  "workflow",
  "prompt-pack",
  "hook",
  "instruction",
  "mcp-server",
  "reference-pack",
];

void test("local manifest source maps entries to correct asset kinds and builds capabilities", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-manifest-"));

  try {
    const manifestPath = join(root, "manifest.json");
    await writeText(
      manifestPath,
      JSON.stringify({
        updatedAt: "2026-05-15T00:00:00.000Z",
        entries: [
          "skills/my-skill",
          "agents/my-agent",
          "plugins/my-plugin",
          "mcp-servers/my-mcp",
          "workflows/my-workflow",
        ],
      }),
    );

    const source = buildManifestSource("local-manifest", root, manifestPath);
    const entries = await harvestLocalManifestSource(
      source,
      null,
      buildSelectionRegistry(),
      root,
    );
    const kindByEntry = new Map(
      entries.map((e) => [e.install.manifestEntry, e.assetKind]),
    );

    assert.equal(kindByEntry.get("skills/my-skill"), "skill");
    assert.equal(kindByEntry.get("agents/my-agent"), "agent");
    assert.equal(kindByEntry.get("plugins/my-plugin"), "plugin");
    assert.equal(kindByEntry.get("mcp-servers/my-mcp"), "mcp-server");
    assert.equal(kindByEntry.get("workflows/my-workflow"), "skill");
    assert.equal(
      entries[0]?.maintenance.lastUpdated,
      "2026-05-15T00:00:00.000Z",
    );
    assert.equal(entries[0]?.install.method, "manifest-entry");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("local manifest source returns empty array when manifest file is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-manifest-"));

  try {
    const source = buildManifestSource(
      "local-manifest",
      root,
      join(root, "nonexistent.json"),
    );
    const entries = await harvestLocalManifestSource(
      source,
      null,
      buildSelectionRegistry(),
      root,
    );
    assert.deepEqual(entries, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("local manifest source returns empty array when entries list is empty", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-manifest-"));

  try {
    const manifestPath = join(root, "manifest.json");
    await writeText(manifestPath, JSON.stringify({ entries: [] }));
    const source = buildManifestSource("local-manifest", root, manifestPath);
    const entries = await harvestLocalManifestSource(
      source,
      null,
      buildSelectionRegistry(),
      root,
    );
    assert.deepEqual(entries, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("local manifest source uses file mtime when updatedAt is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-manifest-"));

  try {
    const manifestPath = join(root, "manifest.json");
    await writeText(
      manifestPath,
      JSON.stringify({ entries: ["skills/my-skill"] }),
    );
    const source = buildManifestSource("local-manifest", root, manifestPath);
    const entries = await harvestLocalManifestSource(
      source,
      null,
      buildSelectionRegistry(),
      root,
    );
    assert.equal(entries.length, 1);
    assert.ok(entries[0]?.maintenance.lastUpdated);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("local opencode config harvesting recognizes native components", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-opencode-local-"));

  try {
    await writeText(
      join(root, "skills", "my-skill", "SKILL.md"),
      "---\nname: my-skill\ndescription: A skill\n---\n# My Skill\n",
    );
    await writeText(join(root, "agents", "reviewer.md"), "# Reviewer agent\n");
    await writeText(join(root, "commands", "review.md"), "Review changes.\n");
    await writeText(
      join(root, "plugins", "helper.ts"),
      "export function helper() {}",
    );
    // Should be ignored (not matching any pattern for opencode)
    await writeText(join(root, "docs", "notes.md"), "Just notes.\n");

    const entries = await harvestLocalDirectorySource(
      buildLocalSource("local-opencode-config", root, ["opencode"]),
      null,
      buildSelectionRegistry(),
      root,
    );
    const kindByPath = new Map(
      entries.map((e) => [e.install.relativePath, e.assetKind]),
    );

    assert.equal(kindByPath.get("skills/my-skill/SKILL.md"), "skill");
    assert.equal(kindByPath.get("agents/reviewer.md"), "agent");
    assert.equal(kindByPath.get("commands/review.md"), "prompt-pack");
    assert.equal(kindByPath.get("plugins/helper.ts"), "plugin");
    assert.equal(kindByPath.has("docs/notes.md"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("local antigravity skill harvesting filters by install manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-antigravity-"));
  const previousHome = process.env.AGENT_HARNESS_HOME;

  try {
    process.env.AGENT_HARNESS_HOME = root;
    clearRuntimeConfigForTests();

    await writeText(
      join(root, ".agents", "skills", ".antigravity-install-manifest.json"),
      JSON.stringify({ entries: ["skills/approved-skill"] }),
    );
    await writeText(
      join(root, "skills", "approved-skill", "SKILL.md"),
      "---\nname: Approved Skill\n---\n# Approved Skill\n",
    );
    await writeText(
      join(root, "skills", "unlisted-skill", "SKILL.md"),
      "# Unlisted Skill\n",
    );

    const source = buildLocalSource("local-antigravity-skills", root, [
      "copilot-vscode",
    ]);
    delete source.publisher;

    const entries = await harvestLocalDirectorySource(
      source,
      null,
      buildSelectionRegistry(),
      root,
    );
    const cachedEntries = await harvestLocalDirectorySource(
      source,
      null,
      buildSelectionRegistry(),
      root,
    );

    assert.deepEqual(
      entries.map((entry) => entry.install.relativePath),
      ["skills/approved-skill/SKILL.md"],
    );
    assert.deepEqual(
      cachedEntries.map((entry) => entry.install.relativePath),
      ["skills/approved-skill/SKILL.md"],
    );
    assert.equal(entries[0]?.source.sourceId, "local-antigravity-manifest");
    assert.equal(entries[0]?.source.publisher, "local-antigravity-skills");
    assert.equal(entries[0]?.source.publisherVerified, false);
    assert.equal(entries[0]?.displayName, "Approved Skill");
  } finally {
    if (previousHome === undefined) {
      delete process.env.AGENT_HARNESS_HOME;
    } else {
      process.env.AGENT_HARNESS_HOME = previousHome;
    }
    clearRuntimeConfigForTests();
    await rm(root, { recursive: true, force: true });
  }
});

void test("local cursor config ignores unrecognized markdown files", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-cursor-local-"));

  try {
    await writeText(join(root, "notes.md"), "# Notes\n");

    const entries = await harvestLocalDirectorySource(
      buildLocalSource("local-cursor-config", root, ["cursor"]),
      null,
      buildSelectionRegistry(),
      root,
    );

    assert.deepEqual(entries, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("local opencode context harvesting classifies workflows and reference packs", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-opencode-ctx-"));

  try {
    await writeText(
      join(root, "workflows", "deploy.md"),
      "# Deploy workflow\n",
    );
    await writeText(join(root, "docs", "guide.md"), "# Guide\n");
    // json files should be ignored for opencode-context (not .md)
    await writeText(join(root, "config.json"), "{}");

    const entries = await harvestLocalDirectorySource(
      buildLocalSource("local-opencode-context", root, ["opencode"]),
      null,
      buildSelectionRegistry(),
      root,
    );
    const kindByPath = new Map(
      entries.map((e) => [e.install.relativePath, e.assetKind]),
    );

    assert.equal(kindByPath.get("workflows/deploy.md"), "workflow");
    assert.equal(kindByPath.get("docs/guide.md"), "reference-pack");
    assert.equal(kindByPath.has("config.json"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("local directory source returns empty for non-existent paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-missing-"));
  await rm(root, { recursive: true, force: true });

  const entries = await harvestLocalDirectorySource(
    buildLocalSource("local-opencode-config", root, ["opencode"]),
    null,
    buildSelectionRegistry(),
    root,
  );
  assert.deepEqual(entries, []);
});

async function writeText(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function buildLocalSource(
  id: string,
  root: string,
  hosts: HostTarget[],
): SourceDefinition {
  return {
    id,
    name: id,
    kind: "local-directory",
    authorityTier: "trusted-local",
    publisher: { name: "local", verified: true },
    hosts,
    assetKinds: LOCAL_ASSET_KINDS,
    discoveryMode: "seed",
    priority: 100,
    enabled: true,
    endpoints: { path: root },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  };
}

function buildManifestSource(
  id: string,
  _root: string,
  filePath: string,
): SourceDefinition {
  return {
    id,
    name: id,
    kind: "local-manifest",
    authorityTier: "trusted-local",
    publisher: { name: "local", verified: true },
    hosts: ["copilot-vscode"],
    assetKinds: LOCAL_ASSET_KINDS,
    discoveryMode: "seed",
    priority: 100,
    enabled: true,
    endpoints: { file: filePath },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  };
}

function buildSelectionRegistry(): SelectionRegistry {
  return {
    schemaVersion: 1,
    selectionPolicies: {
      officialBeatsPopularity: true,
      starsAreTieBreakerOnly: true,
      preferNativeOverAdaptable: true,
      preferLowerRiskWhenEquivalent: true,
      preferLowerContextCostWhenEquivalent: true,
      communityDefaultPolicy: "catalog-only-unless-promoted",
    },
    rankingOrder: [],
    duplicateGroups: [],
  };
}
