import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPackageRegistryCatalogEntry,
  getPackageRegistryKind,
  harvestPackageRegistrySource,
} from "../domains/discovery/package-registry-harvester.js";
import type {
  AssetCatalogEntry,
  DemandProfile,
  SelectionRegistry,
  SourceDefinition,
} from "../types.js";

void test("package registry harvester maps configured sources to registry families", () => {
  const cases: Array<[string, string]> = [
    ["cargo-registry", "cargo"],
    ["go-registry", "go"],
    ["maven-registry", "maven"],
    ["nuget-registry", "nuget"],
    ["rubygems-registry", "gem"],
    ["packagist-registry", "packagist"],
    ["swift-package-index", "swift"],
    ["pypi-registry", "pypi"],
    ["npm-registry", "npm"],
  ];

  for (const [sourceId, expectedKind] of cases) {
    assert.equal(getPackageRegistryKind(buildSource(sourceId)), expectedKind);
  }
});

void test("package registry catalog entries derive asset kinds, hosts, and origin urls from metadata", () => {
  const selectionRegistry = buildSelectionRegistry();
  const demandProfile = buildDemandProfile();
  const cases: Array<{
    registryKind: Parameters<typeof buildPackageRegistryCatalogEntry>[7];
    packageName: string;
    description: string;
    repositoryUrl?: string;
    expectedOriginUrl: string;
    expectedAssetKind: AssetCatalogEntry["assetKind"];
    expectedHosts: AssetCatalogEntry["hosts"];
    packageKeywords?: string[];
  }> = [
    {
      registryKind: "cargo",
      packageName: "crate-tool",
      description: "General package",
      expectedOriginUrl: "https://crates.io/crates/crate-tool",
      expectedAssetKind: "plugin",
      expectedHosts: ["copilot-vscode"],
    },
    {
      registryKind: "go",
      packageName: "github.com/acme/go-tool",
      description: "General package",
      expectedOriginUrl: "https://pkg.go.dev/github.com/acme/go-tool",
      expectedAssetKind: "plugin",
      expectedHosts: ["copilot-vscode"],
    },
    {
      registryKind: "maven",
      packageName: "com.acme:tooling",
      description: "General package",
      expectedOriginUrl:
        "https://central.sonatype.com/search?q=com.acme%3Atooling",
      expectedAssetKind: "plugin",
      expectedHosts: ["copilot-vscode"],
    },
    {
      registryKind: "nuget",
      packageName: "Acme.Tools",
      description: "General package",
      expectedOriginUrl: "https://www.nuget.org/packages/Acme.Tools",
      expectedAssetKind: "plugin",
      expectedHosts: ["copilot-vscode"],
    },
    {
      registryKind: "gem",
      packageName: "agent_tools",
      description: "General package",
      expectedOriginUrl: "https://rubygems.org/gems/agent_tools",
      expectedAssetKind: "plugin",
      expectedHosts: ["copilot-vscode"],
    },
    {
      registryKind: "packagist",
      packageName: "acme/agent-tools",
      description: "General package",
      expectedOriginUrl: "https://packagist.org/packages/acme/agent-tools",
      expectedAssetKind: "plugin",
      expectedHosts: ["copilot-vscode"],
    },
    {
      registryKind: "swift",
      packageName: "swift-agent",
      description: "General package",
      expectedOriginUrl:
        "https://swiftpackageindex.com/search?query=swift-agent",
      expectedAssetKind: "plugin",
      expectedHosts: ["copilot-vscode"],
    },
    {
      registryKind: "npm",
      packageName: "acme-mcp-server",
      description: "MCP server for Acme",
      repositoryUrl: "https://github.com/acme/mcp-server",
      expectedOriginUrl: "https://github.com/acme/mcp-server",
      expectedAssetKind: "mcp-server",
      expectedHosts: ["shared"],
      packageKeywords: ["mcp", "server"],
    },
    {
      registryKind: "pypi",
      packageName: "fastmcp",
      description: "Model Context Protocol server",
      expectedOriginUrl: "https://pypi.org/project/fastmcp",
      expectedAssetKind: "mcp-server",
      expectedHosts: ["shared"],
      packageKeywords: ["mcp", "server"],
    },
  ];

  for (const entryCase of cases) {
    const entry = buildPackageRegistryCatalogEntry(
      buildSource(`${entryCase.registryKind}-registry`),
      entryCase.packageName,
      entryCase.description,
      entryCase.repositoryUrl,
      "2026-05-15T00:00:00.000Z",
      demandProfile,
      selectionRegistry,
      entryCase.registryKind,
      entryCase.packageKeywords ?? [],
    );

    assert.equal(entry.source.originUrl, entryCase.expectedOriginUrl);
    assert.equal(entry.assetKind, entryCase.expectedAssetKind);
    assert.deepEqual(entry.hosts, entryCase.expectedHosts);
    assert.equal(
      entry.compatibilityMode,
      entryCase.expectedAssetKind === "mcp-server" ? "native" : "adaptable",
    );
  }
});

void test("package registry harvester skips npm and pypi candidates when metadata is unavailable", async (context) => {
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

    if (url.startsWith("https://registry.npmjs.org/-/v1/search?")) {
      return jsonResponse({ objects: [] });
    }

    return new Response("not found", { status: 404 });
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFetchMockFlag;
    }
  });

  const selectionRegistry = buildSelectionRegistry();
  const npmEntries = await harvestPackageRegistrySource(
    buildSource("npm-registry"),
    buildDemandProfile({ tooling: ["npm:missing-package"] }),
    selectionRegistry,
  );
  const pypiEntries = await harvestPackageRegistrySource(
    buildSource("pypi-registry"),
    buildDemandProfile({ tooling: ["pypi:missing-package"] }),
    selectionRegistry,
  );

  assert.deepEqual(npmEntries, []);
  assert.deepEqual(pypiEntries, []);
});

void test("package registry harvester builds generic entries for non-network registries", async () => {
  const entries = await harvestPackageRegistrySource(
    buildSource("cargo-registry"),
    buildDemandProfile({ tooling: ["cargo:serde"] }),
    buildSelectionRegistry(),
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.displayName, "serde");
  assert.equal(entries[0]?.source.originUrl, "https://crates.io/crates/serde");
  assert.ok(entries[0]?.capabilities.includes("serde"));
  assert.ok(entries[0]?.capabilities.includes("cargo"));
});

void test("package registry harvester enriches npm search results and pypi metadata without network access", async (context) => {
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

    if (url.startsWith("https://registry.npmjs.org/-/v1/search?")) {
      return jsonResponse({
        objects: [
          {
            package: {
              name: "@modelcontextprotocol/server-filesystem",
              description: "Model Context Protocol server for files",
              keywords: ["mcp", "server"],
            },
          },
          {
            package: {
              name: "mcp-docs",
              description: "Model Context Protocol docs only",
              keywords: ["mcp", "docs"],
            },
          },
        ],
      });
    }

    if (url === "https://registry.npmjs.org/acme-tool") {
      return jsonResponse({
        name: "acme-tool",
        description: "Acme developer tooling",
        keywords: ["tooling", "automation"],
        repository: {
          type: "git",
          url: "git+https://github.com/acme/tool.git",
        },
        time: { modified: "2026-05-10T00:00:00.000Z" },
      });
    }

    if (
      url ===
      "https://registry.npmjs.org/%40modelcontextprotocol%2Fserver-filesystem"
    ) {
      return jsonResponse({
        name: "@modelcontextprotocol/server-filesystem",
        description: "Model Context Protocol server for files",
        keywords: ["mcp", "server"],
        repository: {
          type: "git",
          url: "git+https://github.com/modelcontextprotocol/server-filesystem.git",
        },
        time: { modified: "2026-05-12T00:00:00.000Z" },
      });
    }

    if (url === "https://pypi.org/pypi/fastmcp/json") {
      return jsonResponse({
        info: {
          summary: "Fast MCP server framework",
          project_urls: {
            Source: "https://github.com/jlowin/fastmcp",
          },
          home_page: "https://fastmcp.example",
        },
        releases: {
          "1.0.0": [{ upload_time_iso_8601: "2026-05-09T00:00:00.000Z" }],
        },
        urls: [],
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousFetchMockFlag;
    }
  });

  const selectionRegistry = buildSelectionRegistry();
  const npmEntries = await harvestPackageRegistrySource(
    buildSource("npm-registry"),
    buildDemandProfile({ tooling: ["npm:acme-tool"], concerns: ["mcp"] }),
    selectionRegistry,
  );
  const pypiEntries = await harvestPackageRegistrySource(
    buildSource("pypi-registry"),
    buildDemandProfile({ tooling: ["pypi:fastmcp"] }),
    selectionRegistry,
  );

  assert.deepEqual(
    npmEntries.map((entry) => entry.displayName),
    ["@modelcontextprotocol/server-filesystem", "acme-tool"],
  );
  assert.equal(npmEntries[0]?.assetKind, "mcp-server");
  assert.deepEqual(npmEntries[0]?.hosts, ["shared"]);
  assert.equal(npmEntries[1]?.assetKind, "plugin");
  assert.equal(npmEntries[1]?.source.originUrl, "https://github.com/acme/tool");

  assert.equal(pypiEntries[0]?.displayName, "fastmcp");
  assert.equal(pypiEntries[0]?.assetKind, "mcp-server");
  assert.equal(
    pypiEntries[0]?.source.originUrl,
    "https://github.com/jlowin/fastmcp",
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

function buildDemandProfile(
  overrides: Partial<DemandProfile["signals"]> = {},
): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "fixtures/workspace",
    summary: {
      scannedFiles: 1,
      matchedFiles: 1,
    },
    signals: {
      languages: overrides.languages ?? [],
      packageManagers: overrides.packageManagers ?? ["npm"],
      frameworks: overrides.frameworks ?? [],
      concerns: overrides.concerns ?? [],
      tooling: overrides.tooling ?? [],
    },
    evidence: [
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: [],
          packageManagers: [],
          frameworks: [],
          concerns: [],
          tooling: overrides.tooling ?? [],
        },
      },
    ],
  };
}

function buildSource(id: string): SourceDefinition {
  return {
    id,
    name: id,
    kind: id === "pypi-registry" ? "package-registry" : "package-registry",
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

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
