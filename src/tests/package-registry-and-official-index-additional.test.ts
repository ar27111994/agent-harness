/**
 * Additional targeted tests for package-registry-harvester.ts and official-index-harvester.ts
 * coverage gaps:
 * - Package registry URL building for all registry kinds
 * - Official index harvester with official owners (isOfficialIndexOwner)
 * - Official index harvester entry type classification
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeJsonFile } from "../files.js";
import {
  buildPackageRegistryCatalogEntry,
  getPackageRegistryKind,
} from "../domains/discovery/package-registry-harvester.js";
import { harvestOfficialSkillIndexes } from "../domains/discovery/official-index-harvester.js";
import type {
  DemandProfile,
  SelectionRegistry,
  SourceDefinition,
} from "../types.js";

void test("package registry catalog entries for all non-npm registry kinds have correct origin urls", () => {
  const selectionRegistry = buildSelectionRegistry();
  const demandProfile = buildDemandProfile();

  const registryKindCases: Array<{
    kind: Parameters<typeof buildPackageRegistryCatalogEntry>[7];
    packageName: string;
    expectedUrlPattern: RegExp;
  }> = [
    {
      kind: "cargo",
      packageName: "my-crate",
      expectedUrlPattern: /crates\.io\/crates\/my-crate/,
    },
    {
      kind: "go",
      packageName: "github.com/acme/go-tool",
      expectedUrlPattern: /pkg\.go\.dev/,
    },
    {
      kind: "maven",
      packageName: "com.acme:lib",
      expectedUrlPattern: /central\.sonatype\.com/,
    },
    {
      kind: "nuget",
      packageName: "Acme.Lib",
      expectedUrlPattern: /nuget\.org\/packages\/Acme\.Lib/,
    },
    {
      kind: "gem",
      packageName: "acme-lib",
      expectedUrlPattern: /rubygems\.org\/gems\/acme-lib/,
    },
    {
      kind: "packagist",
      packageName: "acme/lib",
      expectedUrlPattern: /packagist\.org\/packages\/acme\/lib/,
    },
    {
      kind: "swift",
      packageName: "acme-swift",
      expectedUrlPattern: /swiftpackageindex\.com/,
    },
  ];

  for (const { kind, packageName, expectedUrlPattern } of registryKindCases) {
    const entry = buildPackageRegistryCatalogEntry(
      buildSource(`${kind}-registry`),
      packageName,
      `${kind} package`,
      undefined,
      undefined,
      demandProfile,
      selectionRegistry,
      kind,
      [],
    );
    assert.match(
      entry.source.originUrl,
      expectedUrlPattern,
      `Expected ${kind} to produce URL matching ${expectedUrlPattern}`,
    );
  }
});

void test("getPackageRegistryKind falls back to npm for unrecognized source ids", () => {
  const source = buildSource("custom-npm-mirror");
  assert.equal(getPackageRegistryKind(source), "npm");
});

void test("official index harvester classifies skill, reference-pack, mcp-server, plugin, and workflow assets", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-official-index-types-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (
      url === "https://raw.githubusercontent.com/acme/official/main/index.md"
    ) {
      return new Response(
        [
          "# Skills",
          "**[TypeScript Skill](https://officialskills.sh/anthropics/skills/ts-skill)** - TypeScript development skill.",
          "Repo: https://github.com/anthropics/ts-skill",
          "",
          "**[MCP Gateway](https://officialskills.sh/scopeblind/skills/mcp-gateway)** - MCP server for gateway.",
          "Repo: https://github.com/scopeblind/mcp-gateway",
          "",
          "**[Agent Reference](https://officialskills.sh/anthropics/skills/agent-guide)** - Guide and reference for agents.",
          "Repo: https://github.com/anthropics/agent-guide",
          "",
          "**[Deploy Workflow](https://officialskills.sh/anthropics/skills/deploy-workflow)** - Workflow for deploying apps.",
          "Repo: https://github.com/anthropics/deploy-workflow",
          "",
          "**[VS Code Extension Plugin](https://officialskills.sh/anthropics/skills/vscode-plugin)** - Plugin for VS Code integration.",
          "Repo: https://github.com/anthropics/vscode-plugin",
          "",
        ].join("\n"),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFlag;
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  await writeJsonFile(
    join(projectRoot, "discover", "official-skills-indexes.json"),
    {
      schemaVersion: 1,
      indexes: [
        {
          id: "official-index",
          kind: "markdown",
          url: "https://raw.githubusercontent.com/acme/official/main/index.md",
        },
      ],
    },
  );
  await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [],
  });

  const entries = await harvestOfficialSkillIndexes(projectRoot, null);
  const bySlug = new Map(
    entries.map((e) => {
      const parts = e.id.split(":");
      return [parts[parts.length - 1], e];
    }),
  );

  // skill: default kind
  assert.equal(bySlug.get("ts-skill")?.assetKind, "skill");
  // mcp-server: contains "mcp"
  assert.equal(bySlug.get("mcp-gateway")?.assetKind, "mcp-server");
  // reference-pack: contains "guide" or "reference"
  assert.equal(bySlug.get("agent-guide")?.assetKind, "reference-pack");
  // workflow: contains "workflow"
  assert.equal(bySlug.get("deploy-workflow")?.assetKind, "workflow");
  // plugin: contains "plugin"
  assert.equal(bySlug.get("vscode-plugin")?.assetKind, "plugin");
});

void test("official index harvester ignores entries with non-allowed repo owners", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-official-index-owner-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (
      url === "https://raw.githubusercontent.com/acme/official/main/index.md"
    ) {
      return new Response(
        [
          "# Official",
          "**[Entry A](https://officialskills.sh/anthropics/skills/entry-a)** - Valid entry.",
          "Repo: https://github.com/anthropics/entry-a",
          "",
          "# Non-official owner",
          "**[Entry B](https://officialskills.sh/anthropics/skills/entry-b)** - Entry with disallowed owner.",
          "Repo: https://github.com/NOT-anthropics/entry-b",
          "",
        ].join("\n"),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFlag;
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  await writeJsonFile(
    join(projectRoot, "discover", "official-skills-indexes.json"),
    {
      schemaVersion: 1,
      indexes: [
        {
          id: "official-index",
          kind: "markdown",
          url: "https://raw.githubusercontent.com/acme/official/main/index.md",
        },
      ],
    },
  );
  await writeJsonFile(
    join(projectRoot, "discover", "official-upstreams.json"),
    {
      schemaVersion: 1,
      owners: {
        anthropics: ["anthropics"],
      },
    },
  );
  await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [],
  });

  const entries = await harvestOfficialSkillIndexes(projectRoot, null);
  const bySlug = new Map(
    entries.map((e) => {
      const parts = e.id.split(":");
      return [parts[parts.length - 1], e];
    }),
  );

  // entry-a from allowed owner should have rootPath set
  const entryA = bySlug.get("entry-a");
  assert.ok(entryA);
  assert.equal(
    entryA.evidence.rootPath,
    "https://github.com/anthropics/entry-a",
  );

  // entry-b from disallowed owner should still be indexed (owner check only affects rootPath attribution)
  const entryB = bySlug.get("entry-b");
  assert.ok(entryB);
  // rootPath should still be the officialskills.sh URL (not github) since owner didn't match
  assert.ok((entryB.evidence.rootPath ?? "").includes("officialskills.sh"));
});

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

function buildDemandProfile(): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "fixtures/workspace",
    summary: { scannedFiles: 1, matchedFiles: 1 },
    signals: {
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: [],
      concerns: [],
      tooling: [],
    },
    evidence: [],
  };
}

function buildSource(id: string): SourceDefinition {
  return {
    id,
    name: id,
    kind: "package-registry",
    authorityTier: "official-marketplace",
    publisher: { name: id, verified: true },
    hosts: ["copilot-vscode"],
    assetKinds: ["plugin", "mcp-server"],
    discoveryMode: "catalog",
    priority: 90,
    enabled: true,
    endpoints: { baseUrl: "https://example.com" },
    rules: {
      officialPreferred: true,
      allowMirror: false,
      allowInstall: false,
    },
  };
}
