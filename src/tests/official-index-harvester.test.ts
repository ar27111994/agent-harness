import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeJsonFile } from "../files.js";
import { harvestOfficialSkillIndexes } from "../domains/discovery/official-index-harvester.js";
import type {
  DemandProfile,
  SelectionRegistry,
  SourceDefinition,
} from "../types.js";

void test("official index harvester parses entries, resolves repo-backed sources, and dedupes duplicates", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-official-index-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
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
          "# Anthropic",
          "**[Workflow Kit](https://officialskills.sh/anthropics/skills/workflow-kit)** - Reference cookbook for testing workflows.",
          "Repo: https://github.com/anthropics/workflow-kit",
          "",
          "# Scopeblind",
          "**[MCP Gateway](https://officialskills.sh/scopeblind/skills/mcp-gateway)** - MCP server plugin for gateway access.",
          "Repo: https://github.com/scopeblind/mcp-gateway",
          "",
          "# Anthropic duplicate",
          "**[Workflow Kit](https://officialskills.sh/anthropics/skills/workflow-kit)** - Reference cookbook for testing workflows.",
          "Repo: https://github.com/anthropics/workflow-kit",
        ].join("\n"),
        {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        },
      );
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  context.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFetchMockFlag;
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
        scopeblind: ["scopeblind"],
      },
    },
  );
  await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [
      buildSource(
        "anthropics-workflow-kit",
        "https://github.com/anthropics/workflow-kit",
        "official-first-party",
      ),
      buildSource(
        "scopeblind-gateway",
        "https://github.com/scopeblind/mcp-gateway",
        "official-first-party",
      ),
    ],
  });

  const entries = await harvestOfficialSkillIndexes(
    projectRoot,
    buildDemandProfile(),
    buildSelectionRegistry(),
  );
  const ids = entries.map((entry) => entry.id).sort();

  assert.deepEqual(ids, [
    "anthropics-workflow-kit:workflow-kit",
    "official-index:anthropics:workflow-kit",
    "official-index:scopeblind:mcp-gateway",
    "scopeblind-gateway:mcp-gateway",
  ]);

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  assert.equal(
    byId.get("official-index:anthropics:workflow-kit")?.assetKind,
    "workflow",
  );
  assert.equal(
    byId.get("official-index:anthropics:workflow-kit")?.compatibilityMode,
    "native",
  );
  assert.deepEqual(byId.get("official-index:scopeblind:mcp-gateway")?.hosts, [
    "copilot-vscode",
    "opencode",
    "shared",
  ]);
  assert.equal(
    byId.get("official-index:scopeblind:mcp-gateway")?.assetKind,
    "mcp-server",
  );
  assert.equal(
    byId.get("anthropics-workflow-kit:workflow-kit")?.source.sourceId,
    "anthropics-workflow-kit",
  );
  assert.equal(
    byId.get("anthropics-workflow-kit:workflow-kit")?.install.method,
    "github-tree-metadata",
  );
  assert.equal(
    byId.get("anthropics-workflow-kit:workflow-kit")?.status.installEligible,
    true,
  );
  assert.equal(
    byId.get("anthropics-workflow-kit:workflow-kit")?.evidence.rootPath,
    "https://github.com/anthropics/workflow-kit",
  );
});

void test("official index harvester ignores missing configs and unavailable fetches", async (context) => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-official-index-"),
  );
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async () => new Response(null, { status: 404 });

  context.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFetchMockFlag;
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
    schemaVersion: 1,
    sources: [],
  });

  assert.deepEqual(
    await harvestOfficialSkillIndexes(
      projectRoot,
      null,
      buildSelectionRegistry(),
    ),
    [],
  );

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

  assert.deepEqual(
    await harvestOfficialSkillIndexes(
      projectRoot,
      null,
      buildSelectionRegistry(),
    ),
    [],
  );
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
    summary: {
      scannedFiles: 1,
      matchedFiles: 1,
    },
    signals: {
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: ["workflow"],
      concerns: ["testing"],
      tooling: ["mcp"],
    },
    evidence: [],
  };
}

function buildSource(
  id: string,
  repo: string,
  authorityTier: SourceDefinition["authorityTier"],
): SourceDefinition {
  return {
    id,
    name: id,
    kind: "repo",
    authorityTier,
    publisher: { name: id, verified: true },
    hosts: ["copilot-vscode", "opencode", "shared"],
    assetKinds: ["workflow", "mcp-server", "reference-pack"],
    discoveryMode: "catalog",
    priority: 90,
    enabled: true,
    endpoints: { repo },
    rules: {
      officialPreferred: true,
      allowMirror: true,
      allowInstall: true,
    },
  };
}
