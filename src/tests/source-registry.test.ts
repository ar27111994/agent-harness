import assert from "node:assert/strict";
import test from "node:test";

import { loadSourceRegistry } from "../domains/discovery/source-registry.js";

const FULL_SUPPORTED_HOSTS = [
  "copilot-vscode",
  "opencode",
  "cursor",
  "zed",
  "claude-code",
  "pi",
  "codex",
] as const;

const PORTABLE_MULTI_HOST_SOURCE_IDS = [
  "skills-sh",
  "mcp-spec-docs",
  "mcp-registry",
  "npm-registry",
  "pypi-registry",
  "cargo-registry",
  "go-registry",
  "maven-registry",
  "nuget-registry",
  "rubygems-registry",
  "packagist-registry",
  "swift-package-index",
  "supabase-agent-skills",
  "antigravity-awesome-skills",
  "anthropics-skills",
  "anthropics-claude-cookbooks",
  "remotion-dev-skills",
  "vercel-labs-agent-skills",
  "openai-skills",
  "microsoft-skills",
  "google-gemini-skills",
  "apify-agent-skills",
  "expo-skills",
  "huggingface-skills",
  "neondatabase-agent-skills",
  "pbakaus-impeccable",
  "mattpocock-skills",
  "flutter-skills",
  "genkit-ai-skills",
  "firebase-skills",
] as const;

void test("source registry models direct official discovery coverage for supported hosts", async () => {
  const registry = await loadSourceRegistry(process.cwd());
  const configuredSources = registry.sources;

  const cursorMarketplace = configuredSources.find(
    (source) => source.id === "cursor-marketplace",
  );
  assert.ok(cursorMarketplace);
  assert.equal(cursorMarketplace.kind, "marketplace");
  assert.equal(cursorMarketplace.authorityTier, "official-marketplace");
  assertSameHostSet(cursorMarketplace.hosts, ["cursor", "codex"]);
  assert.equal(
    cursorMarketplace.endpoints.baseUrl,
    "https://cursor.com/marketplace",
  );

  const mattPocockSkills = configuredSources.find(
    (source) => source.id === "mattpocock-skills",
  );
  assert.ok(mattPocockSkills);
  assert.equal(mattPocockSkills.kind, "repo");
  assert.equal(mattPocockSkills.authorityTier, "trusted-community");
  assertSameHostSet(mattPocockSkills.hosts, FULL_SUPPORTED_HOSTS);
  assert.equal(
    mattPocockSkills.endpoints.repo,
    "https://github.com/mattpocock/skills",
  );

  const mcpRegistry = configuredSources.find(
    (source) => source.id === "mcp-registry",
  );
  assert.ok(mcpRegistry);
  assert.equal(mcpRegistry.kind, "registry");
  assert.equal(mcpRegistry.authorityTier, "official-first-party");
  assertSameHostSet(mcpRegistry.hosts, FULL_SUPPORTED_HOSTS);
  assert.equal(
    mcpRegistry.endpoints.apiUrl,
    "https://registry.modelcontextprotocol.io/v0/servers",
  );

  const scopeblindGateway = configuredSources.find(
    (source) => source.id === "scopeblind-gateway",
  );
  assert.ok(scopeblindGateway);
  assertSameHostSet(scopeblindGateway.hosts, [
    ...FULL_SUPPORTED_HOSTS,
    "shared",
  ]);

  for (const sourceId of PORTABLE_MULTI_HOST_SOURCE_IDS) {
    assertSourceHasHosts(
      configuredSources,
      sourceId,
      FULL_SUPPORTED_HOSTS,
      `${sourceId} should target every supported host instead of legacy minimized host pairs`,
    );
  }

  assertHostHasOfficialDocs(configuredSources, "copilot-vscode");
  assertHostHasOfficialDocs(configuredSources, "opencode");
  assertHostHasOfficialDocs(configuredSources, "cursor");
  assertHostHasOfficialDocs(configuredSources, "zed");
  assertHostHasOfficialDocs(configuredSources, "claude-code");
  assertHostHasOfficialDocs(configuredSources, "pi");
  assertHostHasOfficialDocs(configuredSources, "codex");

  assertHostHasOfficialRegistryOrMarketplace(
    configuredSources,
    "copilot-vscode",
  );
  assertHostHasOfficialRegistryOrMarketplace(configuredSources, "cursor");
  assertHostHasOfficialRegistryOrMarketplace(configuredSources, "zed");
  assertHostHasOfficialRegistryOrMarketplace(configuredSources, "pi");
  assertHostHasOfficialRegistryOrMarketplace(configuredSources, "codex");
});

function assertSourceHasHosts(
  sources: Awaited<ReturnType<typeof loadSourceRegistry>>["sources"],
  sourceId: string,
  expectedHosts: readonly string[],
  mismatchMessage: string,
): void {
  const source = sources.find((candidate) => candidate.id === sourceId);
  assert.ok(source, `${sourceId} should exist in the checked-in registry`);
  assertSameHostSet(source.hosts, expectedHosts, mismatchMessage);
}

function assertSameHostSet(
  actualHosts: readonly string[],
  expectedHosts: readonly string[],
  message?: string,
): void {
  assert.deepEqual(
    [...actualHosts].sort(),
    [...expectedHosts].sort(),
    message ?? "",
  );
}

function assertHostHasOfficialDocs(
  sources: Awaited<ReturnType<typeof loadSourceRegistry>>["sources"],
  host: string,
): void {
  assert.ok(
    sources.some(
      (source) =>
        source.hosts.includes(host) &&
        source.kind === "docs" &&
        source.authorityTier === "official-first-party",
    ),
    `${host} should have at least one direct official docs source`,
  );
}

function assertHostHasOfficialRegistryOrMarketplace(
  sources: Awaited<ReturnType<typeof loadSourceRegistry>>["sources"],
  host: string,
): void {
  assert.ok(
    sources.some(
      (source) =>
        source.hosts.includes(host) &&
        ["marketplace", "registry", "package-registry"].includes(source.kind) &&
        [
          "official-marketplace",
          "official-first-party",
          "official-compatible",
        ].includes(source.authorityTier),
    ),
    `${host} should have at least one direct official registry or marketplace source`,
  );
}
