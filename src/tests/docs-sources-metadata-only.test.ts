import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { sourceRegistryInternals } from "../domains/discovery/source-registry.js";
import type { SourceRegistry } from "../types.js";

void test("docs-kind sources are metadata-only and excluded from enabled-source counts", async () => {
  const rawRegistry = JSON.parse(
    await readFile(join(process.cwd(), "discover", "sources.json"), "utf8"),
  ) as SourceRegistry;
  const docsBeforePolicy = rawRegistry.sources.filter(
    (source) => source.kind === "docs",
  );
  assert.ok(
    docsBeforePolicy.length > 0,
    "fixture must contain docs-kind sources",
  );

  const effectiveRegistry =
    sourceRegistryInternals.applyMetadataOnlySourcePolicy(rawRegistry);
  const docsAfterPolicy = effectiveRegistry.sources.filter(
    (source) => source.kind === "docs",
  );

  assert.equal(docsAfterPolicy.length, docsBeforePolicy.length);
  assert.ok(docsAfterPolicy.every((source) => source.enabled === false));
  assert.ok(
    effectiveRegistry.sources
      .filter((source) => source.enabled)
      .every((source) => source.kind !== "docs"),
    "enabled-source counts must only include asset-producing source kinds",
  );
});

void test("metadata-only policy also disables future docs sources from packs", () => {
  const registry: SourceRegistry = {
    schemaVersion: 1,
    sources: [
      {
        id: "future-docs",
        name: "Future docs",
        kind: "docs",
        authorityTier: "official-first-party",
        hosts: ["opencode"],
        assetKinds: ["reference-pack"],
        discoveryMode: "catalog",
        priority: 100,
        enabled: true,
        endpoints: { docsUrl: "https://example.com/docs" },
        rules: {
          officialPreferred: true,
          allowMirror: false,
          allowInstall: false,
        },
      },
      {
        id: "real-repo",
        name: "Real repo",
        kind: "repo",
        authorityTier: "trusted-community",
        hosts: ["opencode"],
        assetKinds: ["skill"],
        discoveryMode: "catalog",
        priority: 50,
        enabled: true,
        endpoints: { repo: "https://github.com/example/real-repo" },
        rules: {
          officialPreferred: false,
          allowMirror: false,
          allowInstall: false,
        },
      },
    ],
  };

  const effective =
    sourceRegistryInternals.applyMetadataOnlySourcePolicy(registry);
  assert.equal(
    effective.sources.find((source) => source.id === "future-docs")?.enabled,
    false,
  );
  assert.equal(
    effective.sources.find((source) => source.id === "real-repo")?.enabled,
    true,
  );
});
