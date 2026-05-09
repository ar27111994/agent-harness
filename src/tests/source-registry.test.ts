import assert from "node:assert/strict";
import test from "node:test";

import { loadSourceRegistry } from "../domains/discovery/source-registry.js";

void test("source registry models direct official discovery coverage for supported hosts", async () => {
  const registry = await loadSourceRegistry(process.cwd());
  const configuredSources = registry.sources;

  const cursorMarketplace = configuredSources.find(
    (source) => source.id === "cursor-marketplace",
  );
  assert.ok(cursorMarketplace);
  assert.equal(cursorMarketplace.kind, "marketplace");
  assert.equal(cursorMarketplace.authorityTier, "official-marketplace");
  assert.deepEqual(cursorMarketplace.hosts, ["cursor"]);
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
  assert.deepEqual(mattPocockSkills.hosts, ["copilot-vscode", "opencode"]);
  assert.equal(
    mattPocockSkills.endpoints.repo,
    "https://github.com/mattpocock/skills",
  );

  assertHostHasOfficialDocs(configuredSources, "copilot-vscode");
  assertHostHasOfficialDocs(configuredSources, "opencode");
  assertHostHasOfficialDocs(configuredSources, "cursor");
  assertHostHasOfficialDocs(configuredSources, "zed");
  assertHostHasOfficialDocs(configuredSources, "claude-code");
  assertHostHasOfficialDocs(configuredSources, "pi");

  assertHostHasOfficialRegistryOrMarketplace(
    configuredSources,
    "copilot-vscode",
  );
  assertHostHasOfficialRegistryOrMarketplace(configuredSources, "cursor");
  assertHostHasOfficialRegistryOrMarketplace(configuredSources, "zed");
  assertHostHasOfficialRegistryOrMarketplace(configuredSources, "pi");
});

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
