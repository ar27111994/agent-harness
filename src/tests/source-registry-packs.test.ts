import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeJsonFile } from "../files.js";
import { loadSourceRegistry } from "../domains/discovery/source-registry.js";
import type { SelectionRegistry, SourceDefinition } from "../types.js";

void test("source registry includes official Penpot MCP source pack entry", async () => {
  const registry = await loadSourceRegistry(process.cwd());
  const penpotSource = registry.sources.find(
    (source) => source.id === "penpot-mcp-pack",
  );

  assert.ok(penpotSource);
  assert.equal(penpotSource?.authorityTier, "official-first-party");
  assert.equal(penpotSource?.publisher?.name, "Penpot");
  assert.equal(penpotSource?.publisher?.verified, true);
  assert.deepEqual(penpotSource?.hosts, [
    "opencode",
    "cursor",
    "zed",
    "claude-code",
    "pi",
    "shared",
  ]);
  assert.deepEqual(penpotSource?.assetKinds, ["mcp-server", "reference-pack"]);
  assert.equal(
    penpotSource?.endpoints.repo,
    "https://github.com/penpot/penpot",
  );
  assert.deepEqual(penpotSource?.includePaths, [
    "mcp/README.md",
    "mcp/packages/server/**",
    "docs/mcp/**",
    "docs/user-guide/integrations/mcp/**",
  ]);
  assert.deepEqual(penpotSource?.excludePaths, ["mcp/packages/plugin/**"]);
  assert.deepEqual(penpotSource?.mcpServerPaths, [
    "mcp/packages/server/src/**",
  ]);
});

void test("source registry generates repo sources from packs and dedupes matching repo identities", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-registry-"),
  );

  try {
    await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
      schemaVersion: 1,
      sources: [
        buildSource("existing-repo", "https://github.com/acme/toolbox"),
      ],
    });
    await writeJsonFile(
      join(projectRoot, "discover", "selections.json"),
      buildSelectionRegistry(),
    );
    await writeJsonFile(
      join(projectRoot, "discover", "source-packs", "community.json"),
      {
        schemaVersion: 1,
        entries: [
          {
            id: "duplicate-by-id",
            repo: "https://github.com/acme/other-repo",
          },
          {
            id: "new-toolkit",
            repo: "git@github.com:acme/new-toolkit.git",
            authorityTier: "official-compatible",
            publisherVerified: true,
            priority: 75,
            enabled: false,
            includePaths: ["packages/server/**"],
            excludePaths: ["packages/plugin/**"],
            mcpServerPaths: ["packages/server/src/**"],
          },
          {
            id: "duplicate-repo-url",
            repo: "git@github.com:acme/toolbox.git",
          },
        ],
      },
    );
    await writeJsonFile(
      join(projectRoot, "discover", "source-packs", "z-extra.json"),
      {
        schemaVersion: 1,
        entries: [
          {
            id: "duplicate-by-id",
            repo: "https://github.com/acme/duplicate-by-id",
          },
        ],
      },
    );

    const registry = await loadSourceRegistry(projectRoot);
    const generated = registry.sources.find(
      (source) => source.id === "new-toolkit",
    );

    assert.ok(generated);
    assert.equal(generated?.name, "New Toolkit.Git");
    assert.equal(generated?.authorityTier, "official-compatible");
    assert.deepEqual(generated?.hosts, ["copilot-vscode", "opencode"]);
    assert.deepEqual(generated?.assetKinds, [
      "skill",
      "agent",
      "instruction",
      "workflow",
      "plugin",
      "mcp-server",
    ]);
    assert.equal(generated?.priority, 75);
    assert.equal(generated?.enabled, false);
    assert.equal(generated?.publisher?.owner, "acme");
    assert.equal(generated?.publisher?.verified, true);
    assert.deepEqual(generated?.includePaths, ["packages/server/**"]);
    assert.deepEqual(generated?.excludePaths, ["packages/plugin/**"]);
    assert.deepEqual(generated?.mcpServerPaths, ["packages/server/src/**"]);
    assert.equal(
      generated?.endpoints.repo,
      "git@github.com:acme/new-toolkit.git",
    );

    assert.equal(
      registry.sources.filter((source) => source.id === "duplicate-by-id")
        .length,
      1,
    );
    assert.equal(
      registry.sources.some((source) => source.id === "duplicate-repo-url"),
      false,
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("source registry rejects malformed source pack entries", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-registry-"),
  );

  try {
    await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
      schemaVersion: 1,
      sources: [
        buildSource("existing-repo", "https://github.com/acme/toolbox"),
      ],
    });
    for (const pathField of [
      "includePaths",
      "excludePaths",
      "mcpServerPaths",
    ]) {
      await rm(join(projectRoot, "discover", "source-packs"), {
        recursive: true,
        force: true,
      });
      await writeJsonFile(
        join(projectRoot, "discover", "source-packs", "broken.json"),
        {
          schemaVersion: 1,
          entries: [
            {
              id: "broken",
              repo: "https://github.com/acme/broken",
              [pathField]: [""],
            },
          ],
        },
      );

      await assert.rejects(
        () => loadSourceRegistry(projectRoot),
        new RegExp(
          `broken\\.json\\.entries\\[0\\]\\.${pathField}\\[0\\].*must not be empty`,
          "iu",
        ),
      );
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("source registry rejects invalid host values in source pack entries", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-registry-"),
  );

  try {
    await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
      schemaVersion: 1,
      sources: [
        buildSource("existing-repo", "https://github.com/acme/toolbox"),
      ],
    });
    await writeJsonFile(
      join(projectRoot, "discover", "source-packs", "broken-host.json"),
      {
        schemaVersion: 1,
        entries: [
          {
            id: "broken-host",
            repo: "https://github.com/acme/broken-host",
            hosts: ["Not-A-Host"],
          },
        ],
      },
    );

    await assert.rejects(
      () => loadSourceRegistry(projectRoot),
      /broken-host\.json\.entries\[0\]\.hosts\[0\].*lowercase host identifier/iu,
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
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

function buildSource(id: string, repo: string): SourceDefinition {
  return {
    id,
    name: id,
    kind: "repo",
    authorityTier: "trusted-community",
    publisher: { name: "acme", verified: false, owner: "acme" },
    hosts: ["copilot-vscode"],
    assetKinds: ["skill"],
    discoveryMode: "catalog",
    priority: 60,
    enabled: true,
    endpoints: { repo },
    rules: {
      officialPreferred: true,
      allowMirror: false,
      allowInstall: false,
    },
  };
}
