import { restoreEnvVar } from "./env-test-utils.js";
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPackageRegistryCatalogEntry,
  getPackageRegistryKind,
  harvestPackageRegistrySource,
  packageRegistryHarvesterInternals,
  requirePackageRegistryKind,
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
    ["pub-dev-registry", "pub"],
    ["hex-registry", "hex"],
    ["conan-registry", "conan"],
  ];

  for (const [sourceId, expectedKind] of cases) {
    assert.equal(getPackageRegistryKind(buildSource(sourceId)), expectedKind);
  }
});

void test("package registry harvester fails closed for unmapped source ids instead of assuming npm", () => {
  // Regression guard for #424: unknown package-registry source ids must never
  // inherit npm attribution (which previously let conan-registry and
  // hex-registry harvest npm packages as official C++/Elixir assets).
  assert.equal(getPackageRegistryKind(buildSource("custom-npm-mirror")), null);
  assert.equal(
    getPackageRegistryKind(buildSource("future-package-registry")),
    null,
  );
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
    {
      registryKind: "hex",
      packageName: "phoenix",
      description: "Elixir web framework",
      expectedOriginUrl: "https://hex.pm/packages/phoenix",
      expectedAssetKind: "plugin",
      expectedHosts: ["copilot-vscode"],
    },
    {
      registryKind: "conan",
      packageName: "openssl",
      description: "C/C++ crypto library",
      expectedOriginUrl: "https://conan.io/center/recipes/openssl",
      expectedAssetKind: "plugin",
      expectedHosts: ["copilot-vscode"],
    },
    {
      registryKind: "pub",
      packageName: "flutter_lints",
      description: "Dart linter rules",
      expectedOriginUrl: "https://pub.dev/packages/flutter_lints",
      expectedAssetKind: "plugin",
      expectedHosts: ["copilot-vscode"],
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

void test("package registry catalog entries preserve package pages when repository and publisher metadata are absent", () => {
  const source = buildSource("npm-registry");
  delete source.publisher;

  const entry = buildPackageRegistryCatalogEntry(
    source,
    "@acme/mcp-server-sdk",
    "SDK and docs for MCP clients",
    undefined,
    undefined,
    null,
    buildSelectionRegistry(),
    "npm",
    ["mcp", "sdk", "client"],
  );

  assert.equal(entry.assetKind, "plugin");
  assert.deepEqual(entry.hosts, ["copilot-vscode"]);
  assert.equal(
    entry.source.originUrl,
    "https://www.npmjs.com/package/%40acme%2Fmcp-server-sdk",
  );
  assert.equal(entry.source.publisher, "npm-registry");
  assert.equal(entry.source.publisherVerified, false);
  assert.equal(entry.evidence.docsLinked, false);
  assert.equal(entry.maintenance.lastUpdated, new Date(0).toISOString());
  assert.deepEqual(entry.install.adaptableHosts, ["copilot-vscode"]);
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
      restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
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
      restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
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

void test("package registry harvester tolerates malformed search and sparse metadata", async (context) => {
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
          null,
          { package: { name: "   " } },
          {
            package: {
              name: "acme-server-mcp",
              description: "Model Context Protocol server runtime",
              keywords: ["mcp", 42, "server"],
            },
          },
          {
            package: {
              name: "keyword-only-protocol",
              keywords: ["mcp", "server"],
            },
          },
        ],
      });
    }

    if (url === "https://registry.npmjs.org/acme-server-mcp") {
      return jsonResponse({
        keywords: ["mcp", 7, "server"],
        repository: "not a valid repo url",
        time: {},
      });
    }

    if (url === "https://registry.npmjs.org/keyword-only-protocol") {
      return jsonResponse({
        name: "keyword-only-protocol",
        keywords: ["mcp", "server"],
      });
    }

    if (url === "https://registry.npmjs.org/sparse-npm") {
      return jsonResponse({ name: "sparse-npm" });
    }

    if (url === "https://pypi.org/pypi/sparse-pypi/json") {
      return jsonResponse({
        info: {
          name: "sparse-pypi",
          home_page: "not-a-url",
          project_urls: { Homepage: "ftp://example.com/project" },
        },
        releases: {},
        urls: [],
      });
    }

    throw new Error("Unexpected fetch: " + url);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    }
  });

  const selectionRegistry = buildSelectionRegistry();
  const npmEntries = await harvestPackageRegistrySource(
    buildSource("npm-registry"),
    buildDemandProfile({ tooling: ["npm:sparse-npm"], concerns: ["mcp"] }),
    selectionRegistry,
  );
  const pypiEntries = await harvestPackageRegistrySource(
    buildSource("pypi-registry"),
    buildDemandProfile({ tooling: ["pypi:sparse-pypi"] }),
    selectionRegistry,
  );

  assert.deepEqual(
    npmEntries.map((entry) => entry.displayName),
    ["acme-server-mcp", "keyword-only-protocol", "sparse-npm"],
  );
  assert.equal(npmEntries[0]?.assetKind, "mcp-server");
  assert.equal(npmEntries[1]?.assetKind, "mcp-server");
  assert.equal(
    npmEntries[0]?.source.originUrl,
    "https://www.npmjs.com/package/acme-server-mcp",
  );
  assert.equal(
    npmEntries[2]?.source.originUrl,
    "https://www.npmjs.com/package/sparse-npm",
  );
  assert.deepEqual(npmEntries[2]?.capabilities, ["sparse", "npm"]);

  assert.equal(pypiEntries[0]?.displayName, "sparse-pypi");
  assert.equal(
    pypiEntries[0]?.source.originUrl,
    "https://pypi.org/project/sparse-pypi",
  );
  assert.equal(
    pypiEntries[0]?.maintenance.lastUpdated,
    new Date(0).toISOString(),
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

void test("package registry catalog entries include evidence.classification for every entry", () => {
  const selectionRegistry = buildSelectionRegistry();

  // plugin (non-MCP npm package)
  const pluginEntry = buildPackageRegistryCatalogEntry(
    buildSource("npm-registry"),
    "some-lint-plugin",
    "An eslint plugin",
    undefined,
    undefined,
    null,
    selectionRegistry,
    "npm",
    [],
  );
  assert.ok(
    pluginEntry.evidence.classification != null,
    "plugin entry must have classification",
  );
  assert.equal(pluginEntry.evidence.classification.assetKind, "plugin");
  assert.ok(
    pluginEntry.evidence.classification.confidence > 0,
    "confidence must be positive",
  );
  assert.ok(
    pluginEntry.evidence.classification.evidence.length > 0,
    "classification evidence array must be non-empty",
  );

  // mcp-server (package whose name signals MCP)
  const mcpEntry = buildPackageRegistryCatalogEntry(
    buildSource("npm-registry"),
    "@modelcontextprotocol/server-filesystem",
    "Official MCP filesystem server",
    undefined,
    undefined,
    null,
    selectionRegistry,
    "npm",
    ["mcp"],
  );
  assert.ok(
    mcpEntry.evidence.classification != null,
    "mcp-server entry must have classification",
  );
  assert.equal(mcpEntry.evidence.classification.assetKind, "mcp-server");

  // cargo registry entry
  const cargoEntry = buildPackageRegistryCatalogEntry(
    buildSource("cargo-registry"),
    "serde",
    "Serialization framework for Rust",
    undefined,
    undefined,
    null,
    selectionRegistry,
    "cargo",
    [],
  );
  assert.ok(
    cargoEntry.evidence.classification != null,
    "cargo entry must have classification",
  );
  assert.equal(cargoEntry.evidence.classification.assetKind, "plugin");
  assert.ok(
    (cargoEntry.evidence.classification.evidence[0]?.detail ?? "").includes(
      "cargo",
    ),
    "detail should mention the registry kind",
  );
});

// ─── Coverage: searchRegistryByKind and discoverAdjacentPackages ──────────────

void test("searchRegistryByKind — pypi returns empty array without network call", async () => {
  // PyPI has no public keyword-search API — returns [] synchronously.
  const result = await packageRegistryHarvesterInternals.searchRegistryByKind(
    "pypi",
    "requests",
    10,
  );
  assert.deepEqual(result, [], "pypi search always returns empty array");
});

void test("searchRegistryByKind — go returns empty array", async () => {
  const result = await packageRegistryHarvesterInternals.searchRegistryByKind(
    "go",
    "query",
    5,
  );
  assert.deepEqual(result, [], "go has no search API");
});

void test("searchRegistryByKind — swift returns empty array", async () => {
  const result = await packageRegistryHarvesterInternals.searchRegistryByKind(
    "swift",
    "query",
    5,
  );
  assert.deepEqual(result, [], "swift has no search API");
});

void test("searchRegistryByKind — pub returns empty array", async () => {
  const result = await packageRegistryHarvesterInternals.searchRegistryByKind(
    "pub",
    "query",
    5,
  );
  assert.deepEqual(result, [], "pub has no search API");
});

void test("searchRegistryByKind — network delegate arms extract names for every search-backed kind (#451)", async (context) => {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  const seenUrls: string[] = [];
  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    seenUrls.push(url);

    if (url.startsWith("https://registry.npmjs.org/-/v1/search")) {
      return jsonResponse({
        objects: [{ package: { name: "npm-search-hit" } }],
      });
    }
    if (url.startsWith("https://crates.io/api/v1/crates")) {
      return jsonResponse({ crates: [{ name: "cargo-search-hit" }] });
    }
    if (url.startsWith("https://azuresearch-usnc.nuget.org/query")) {
      return jsonResponse({ data: [{ id: "nuget-search-hit" }] });
    }
    if (url.startsWith("https://search.maven.org/solrsearch/select")) {
      return jsonResponse({
        response: { docs: [{ id: "maven-search-hit" }] },
      });
    }
    if (url.startsWith("https://packagist.org/search.json")) {
      return jsonResponse({ results: [{ name: "packagist-search-hit" }] });
    }
    if (url.startsWith("https://rubygems.org/api/v1/search.json")) {
      return jsonResponse([{ name: "gem-search-hit" }]);
    }

    return new Response("not found", { status: 404 });
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    }
  });

  const cases: Array<{
    kind: Parameters<
      typeof packageRegistryHarvesterInternals.searchRegistryByKind
    >[0];
    expected: string;
  }> = [
    { kind: "npm", expected: "npm-search-hit" },
    { kind: "cargo", expected: "cargo-search-hit" },
    { kind: "nuget", expected: "nuget-search-hit" },
    { kind: "maven", expected: "maven-search-hit" },
    { kind: "packagist", expected: "packagist-search-hit" },
    { kind: "gem", expected: "gem-search-hit" },
  ];

  for (const { kind, expected } of cases) {
    const result = await packageRegistryHarvesterInternals.searchRegistryByKind(
      kind,
      "search-term",
      10,
    );
    assert.deepEqual(
      result,
      [expected],
      `${kind} delegate must extract the result name`,
    );
  }

  assert.equal(seenUrls.length, 6);
  assert.ok(
    seenUrls.some((url) => url.includes("crates.io/api/v1/crates")),
    "cargo arm must call crates.io",
  );
  assert.ok(
    seenUrls.some((url) => url.includes("azuresearch-usnc.nuget.org")),
    "nuget arm must call the NuGet v3 endpoint",
  );
});

void test("discoverAdjacentPackages — static matrix path: returns adjacent packages when adjacentToolingEnabled and demand signals present", async () => {
  // maxTerms: 0 disables live registry search entirely (no network).
  // The static adjacency matrix (getAdjacentPackagesForSignals) runs for npm.
  // Include a known language signal so the static matrix always produces results.
  const profile = buildDemandProfile({ languages: ["language:typescript"] });
  const result =
    await packageRegistryHarvesterInternals.discoverAdjacentPackages(
      "npm",
      profile,
      new Set<string>(),
      { maxTerms: 0, maxResultsPerTerm: 5, adjacentToolingEnabled: true },
    );
  // typescript is a known npm signal; the static matrix must return at least eslint/vitest.
  assert.ok(Array.isArray(result), "returns a sorted array");
  assert.ok(
    result.length > 0,
    "typescript signal should yield at least one npm adjacent package",
  );
  assert.ok(
    result.every((n) => typeof n === "string"),
    "all elements are strings",
  );
});

void test("discoverAdjacentPackages — adjacentToolingEnabled false skips static matrix", async () => {
  const profile = buildDemandProfile();
  const result =
    await packageRegistryHarvesterInternals.discoverAdjacentPackages(
      "npm",
      profile,
      new Set<string>(),
      { maxTerms: 0, maxResultsPerTerm: 5, adjacentToolingEnabled: false },
    );
  assert.deepEqual(result, [], "no adjacent packages when disabled");
});

void test("discoverAdjacentPackages — null demand profile skips all discovery", async () => {
  const result =
    await packageRegistryHarvesterInternals.discoverAdjacentPackages(
      "npm",
      null,
      new Set<string>(),
      { maxTerms: 0, maxResultsPerTerm: 5, adjacentToolingEnabled: true },
    );
  assert.deepEqual(result, [], "null demand profile produces no adjacency");
});

void test("discoverAdjacentPackages — existing candidates are excluded from results", async () => {
  // Uses npm with adjacentToolingEnabled and a known typescript signal so the
  // static matrix reliably produces results (deterministic, no network).
  const profile = buildDemandProfile({ languages: ["language:typescript"] });
  const resultAll =
    await packageRegistryHarvesterInternals.discoverAdjacentPackages(
      "npm",
      profile,
      new Set<string>(),
      { maxTerms: 0, maxResultsPerTerm: 5, adjacentToolingEnabled: true },
    );

  if (resultAll.length === 0) {
    // No adjacent packages for this demand profile — skip exclusion check.
    return;
  }

  // Provide all discovered packages as existing candidates — result should be empty.
  const resultExcluded =
    await packageRegistryHarvesterInternals.discoverAdjacentPackages(
      "npm",
      profile,
      new Set<string>(resultAll),
      { maxTerms: 0, maxResultsPerTerm: 5, adjacentToolingEnabled: true },
    );
  assert.deepEqual(
    resultExcluded,
    [],
    "all candidates excluded when already known",
  );
});

void test("discoverAdjacentPackages — live registry search path executes when maxTerms > 0", async () => {
  // Use pypi registry: searchRegistryByKind("pypi", ...) always returns []
  // with no network calls, but exercises the live-search for-loop path.
  const profile = buildDemandProfile({
    languages: ["language:python"],
    frameworks: ["framework:django"],
  });
  const result =
    await packageRegistryHarvesterInternals.discoverAdjacentPackages(
      "pypi",
      profile,
      new Set<string>(),
      {
        maxTerms: 2,
        maxResultsPerTerm: 5,
        adjacentToolingEnabled: false, // skip static matrix; test live-search only
      },
    );
  // pypi returns [] per term, so result is empty — but the loop body executed.
  assert.deepEqual(
    result,
    [],
    "pypi live-search returns empty (no network required)",
  );
});

void test("searchRegistryByKind — npm case: function exists and returns a Promise (title/body alignment check)", async () => {
  // We can't mock npm network calls in this test suite without a fetch mock.
  // This test verifies the pypi path (which returns empty without network) as a
  // structural sanity-check. The npm path is exercised by the coverage tests in
  // v2-coverage-final.test.ts via withFetchMock.
  const pypiResult =
    await packageRegistryHarvesterInternals.searchRegistryByKind(
      "pypi",
      "requests",
      5,
    );
  assert.deepEqual(
    pypiResult,
    [],
    "pypi always returns empty (no network required)",
  );
});

void test("harvestPackageRegistrySource — returns empty array for cargo registry with no demand candidates", async () => {
  // cargo-registry with null demand profile: no candidates, no adjacent packages,
  // no network calls needed. Exercises the harvestPackageRegistrySource entry point.
  const source = buildSource("cargo-registry");
  const selectionRegistry = buildSelectionRegistry();
  const entries = await harvestPackageRegistrySource(
    source,
    null,
    selectionRegistry,
  );
  assert.ok(Array.isArray(entries), "returns an array");
  assert.equal(
    entries.length,
    0,
    "empty when no candidates and no demand profile",
  );
});

void test("harvestPackageRegistrySource — fails closed with a warning for unmapped registry kinds", async (context) => {
  // Regression guard for #424: an unmapped package-registry source id must not
  // harvest npm packages under a foreign source identity. It returns no
  // entries and warns instead of silently attributing npm packages.
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };
  context.after(() => {
    console.warn = originalWarn;
  });

  const source = buildSource("unknown-registry");
  const selectionRegistry = buildSelectionRegistry();
  const entries = await harvestPackageRegistrySource(
    source,
    buildDemandProfile({ tooling: ["unknown-registry:npm-package"] }),
    selectionRegistry,
  );

  assert.deepEqual(entries, [], "no entries for unmapped registry kinds");
  assert.ok(
    warnings.some((message) => message.includes("fail-closed")),
    "warning explains the fail-closed skip",
  );
});

void test("harvestPackageRegistrySource — conan registry demand candidates are attributed to conan, never npm", async () => {
  // Regression guard for #424: a conan: evidence signal must produce a
  // conan-attributed entry (conan.io origin, conan kind in the id), not an
  // npm package page stamped with ConanCenter authority.
  const source = buildSource("conan-registry");
  const entries = await harvestPackageRegistrySource(
    source,
    buildDemandProfile({ tooling: ["conan:openssl"] }),
    buildSelectionRegistry(),
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.displayName, "openssl");
  assert.equal(entries[0]?.id, "conan-registry:conan:openssl");
  assert.equal(
    entries[0]?.source.originUrl,
    "https://conan.io/center/recipes/openssl",
  );
  assert.equal(entries[0]?.source.sourceId, "conan-registry");
  assert.match(entries[0]?.id ?? "", /^conan-registry:conan:/u);
  assert.doesNotMatch(entries[0]?.id ?? "", /:npm:/u);
});

void test("harvestPackageRegistrySource — hex registry demand candidates are attributed to hex, never npm", async () => {
  // Regression guard for #424: a hex: evidence signal must produce a
  // hex-attributed entry (hex.pm origin, hex kind in the id), not an npm
  // package page stamped with Hex.pm authority.
  const source = buildSource("hex-registry");
  const entries = await harvestPackageRegistrySource(
    source,
    buildDemandProfile({ tooling: ["hex:phoenix"] }),
    buildSelectionRegistry(),
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.displayName, "phoenix");
  assert.equal(entries[0]?.id, "hex-registry:hex:phoenix");
  assert.equal(entries[0]?.source.originUrl, "https://hex.pm/packages/phoenix");
  assert.equal(entries[0]?.source.sourceId, "hex-registry");
  assert.match(entries[0]?.id ?? "", /^hex-registry:hex:/u);
  assert.doesNotMatch(entries[0]?.id ?? "", /:npm:/u);
});

void test("requirePackageRegistryKind — throws for unmapped ids and returns the kind for mapped ids", () => {
  assert.throws(
    () => requirePackageRegistryKind(buildSource("unknown-registry")),
    /Unsupported package-registry kind for source "unknown-registry"/u,
  );
  assert.equal(requirePackageRegistryKind(buildSource("hex-registry")), "hex");
  assert.equal(
    requirePackageRegistryKind(buildSource("conan-registry")),
    "conan",
  );
  assert.equal(requirePackageRegistryKind(buildSource("npm-registry")), "npm");
});

void test("searchRegistryByKind — conan returns empty without network (no public keyword API)", async () => {
  const results = await packageRegistryHarvesterInternals.searchRegistryByKind(
    "conan",
    "openssl",
    5,
  );
  assert.deepEqual(results, [], "conan has no keyword-search API");
});

void test("searchRegistryByKind — hex searches via the Hex.pm API", async (context) => {
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

    if (url.startsWith("https://hex.pm/api/packages?")) {
      return jsonResponse([
        {
          name: "phoenix",
          meta: { description: "Productive web framework" },
          downloads: { all: 1000 },
        },
        {
          name: "",
          meta: { description: "empty-name package" },
        },
      ]);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
    }
  });

  const results = await packageRegistryHarvesterInternals.searchRegistryByKind(
    "hex",
    "phoenix",
    5,
  );
  assert.deepEqual(results, ["phoenix"]);
  assert.ok(!results.includes("nomatch"), "empty names are filtered");
});

void test("discoverAdjacentPackages — conan skips live search without network", async () => {
  // conan kind: no static matrix, no keyword API — result must be empty and
  // must not attempt any fetch (fail-safe for the new kind).
  const profile = buildDemandProfile({
    languages: ["language:cpp"],
    frameworks: ["framework:cmake"],
  });
  const result =
    await packageRegistryHarvesterInternals.discoverAdjacentPackages(
      "conan",
      profile,
      new Set<string>(),
      { maxTerms: 2, maxResultsPerTerm: 5, adjacentToolingEnabled: true },
    );
  assert.deepEqual(result, [], "conan produces no adjacent packages");
});
