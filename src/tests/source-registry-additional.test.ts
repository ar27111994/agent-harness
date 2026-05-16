import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeJsonFile } from "../files.js";
import { loadSourceRegistry } from "../domains/discovery/source-registry.js";
import type { SourceDefinition } from "../types.js";

void test("source registry merges generated local sources while preserving user settings and refreshing endpoints", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-registry-"),
  );

  try {
    await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
      schemaVersion: 1,
      sources: [
        {
          ...buildSource(
            "local-opencode-config",
            "https://example.invalid/ignored",
          ),
          enabled: false,
          priority: 5,
          rules: {
            officialPreferred: false,
            allowMirror: false,
            allowInstall: false,
          },
          endpoints: { path: "C:/custom/opencode" },
        },
      ],
    });

    const registry = await loadSourceRegistry(projectRoot);
    const localSource = registry.sources.find(
      (source) => source.id === "local-opencode-config",
    );

    assert.ok(localSource);
    // User settings (enabled, priority, rules) are preserved by the merge
    assert.equal(localSource.enabled, false);
    assert.equal(localSource.priority, 5);
    assert.equal(localSource.rules.allowMirror, false);
    // Endpoints always come from the generated source (machine-specific paths are refreshed)
    assert.ok(
      localSource.endpoints.path !== undefined,
      "endpoints.path should be a machine-specific generated path",
    );
    // kind comes from user's sources.json, which overrides the generated kind in merge
    assert.equal(localSource.kind, "repo");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("source registry rejects malformed optional source pack fields", async () => {
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
      join(projectRoot, "discover", "source-packs", "broken.json"),
      {
        schemaVersion: 1,
        entries: [
          {
            id: "broken",
            repo: "https://github.com/acme/broken",
            publisherVerified: "yes",
          },
        ],
      },
    );

    await assert.rejects(
      () => loadSourceRegistry(projectRoot),
      /publisherVerified must be a boolean/u,
    );

    await writeJsonFile(
      join(projectRoot, "discover", "source-packs", "broken.json"),
      {
        schemaVersion: 1,
        entries: [
          {
            id: "broken",
            repo: "https://github.com/acme/broken",
            priority: "high",
          },
        ],
      },
    );

    await assert.rejects(
      () => loadSourceRegistry(projectRoot),
      /priority must be a number/u,
    );

    await writeJsonFile(
      join(projectRoot, "discover", "source-packs", "broken.json"),
      {
        schemaVersion: 1,
        entries: [
          {
            id: "broken",
            repo: "https://github.com/acme/broken",
            enabled: "sometimes",
          },
        ],
      },
    );

    await assert.rejects(
      () => loadSourceRegistry(projectRoot),
      /enabled must be a boolean/u,
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("source registry rejects additional malformed optional source pack fields", async () => {
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
      join(projectRoot, "discover", "source-packs", "broken.json"),
      {
        schemaVersion: 1,
        entries: [
          {
            id: "broken",
            repo: "https://github.com/acme/broken",
            name: 42,
          },
        ],
      },
    );
    await assert.rejects(
      () => loadSourceRegistry(projectRoot),
      /name must be a string when set/u,
    );

    await writeJsonFile(
      join(projectRoot, "discover", "source-packs", "broken.json"),
      {
        schemaVersion: 1,
        entries: [
          {
            id: "broken",
            repo: "https://github.com/acme/broken",
            assetKinds: ["definitely-not-an-asset-kind"],
          },
        ],
      },
    );
    await assert.rejects(
      () => loadSourceRegistry(projectRoot),
      /assetKinds\[0\] must be one of/u,
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("source registry rejects malformed source pack shapes and required fields", async () => {
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
      join(projectRoot, "discover", "source-packs", "broken.json"),
      [],
    );
    await assert.rejects(
      () => loadSourceRegistry(projectRoot),
      /broken\.json must be an object/u,
    );

    await writeJsonFile(
      join(projectRoot, "discover", "source-packs", "broken.json"),
      {
        schemaVersion: "1",
        entries: [],
      },
    );
    await assert.rejects(
      () => loadSourceRegistry(projectRoot),
      /schemaVersion must be a number/u,
    );

    await writeJsonFile(
      join(projectRoot, "discover", "source-packs", "broken.json"),
      {
        schemaVersion: 1,
        entries: "nope",
      },
    );
    await assert.rejects(
      () => loadSourceRegistry(projectRoot),
      /entries must be an array/u,
    );

    await writeJsonFile(
      join(projectRoot, "discover", "source-packs", "broken.json"),
      {
        schemaVersion: 1,
        entries: [{ id: 12, repo: "https://github.com/acme/broken" }],
      },
    );
    await assert.rejects(
      () => loadSourceRegistry(projectRoot),
      /id must be a string/u,
    );

    await writeJsonFile(
      join(projectRoot, "discover", "source-packs", "broken.json"),
      {
        schemaVersion: 1,
        entries: [{ id: "broken", repo: 12 }],
      },
    );
    await assert.rejects(
      () => loadSourceRegistry(projectRoot),
      /repo must be a string/u,
    );

    await writeJsonFile(
      join(projectRoot, "discover", "source-packs", "broken.json"),
      {
        schemaVersion: 1,
        entries: [{ id: " ", repo: "https://github.com/acme/broken" }],
      },
    );
    await assert.rejects(
      () => loadSourceRegistry(projectRoot),
      /id must not be empty/u,
    );

    await writeJsonFile(
      join(projectRoot, "discover", "source-packs", "broken.json"),
      {
        schemaVersion: 1,
        entries: [{ id: "broken", repo: "/" }],
      },
    );
    await assert.rejects(
      () => loadSourceRegistry(projectRoot),
      /repo must include a repository path/u,
    );

    await writeJsonFile(
      join(projectRoot, "discover", "source-packs", "broken.json"),
      {
        schemaVersion: 1,
        entries: [
          {
            id: "broken",
            repo: "https://github.com/acme/broken",
            authorityTier: "not-real",
          },
        ],
      },
    );
    await assert.rejects(
      () => loadSourceRegistry(projectRoot),
      /authorityTier must be one of/u,
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("source registry dedupes repositories across ssh and https identities with trimming", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-source-registry-"),
  );

  try {
    await writeJsonFile(join(projectRoot, "discover", "sources.json"), {
      schemaVersion: 1,
      sources: [
        buildSource("existing-repo", "https://github.com/Acme/Toolbox.git"),
      ],
    });
    await writeJsonFile(
      join(projectRoot, "discover", "source-packs", "community.json"),
      {
        schemaVersion: 1,
        entries: [
          {
            id: "duplicate-repo",
            repo: "git@github.com:acme/toolbox.git",
          },
          {
            id: "ssh-generated",
            repo: "ssh://git@github.com/acme/new-tool.git/",
          },
        ],
      },
    );

    const registry = await loadSourceRegistry(projectRoot);

    // The duplicate (https vs ssh pointing to same repo) should be deduped
    assert.equal(
      registry.sources.some((source) => source.id === "duplicate-repo"),
      false,
    );
    assert.equal(
      registry.sources.find((source) => source.id === "ssh-generated")
        ?.publisher?.owner,
      "acme",
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("source registry generates source pack entries from path-like repositories", async () => {
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
      join(projectRoot, "discover", "source-packs", "paths.json"),
      {
        schemaVersion: 1,
        entries: [
          {
            id: "path-like-repo",
            repo: "acme/path-like-tool",
          },
          {
            id: "single-segment-repo",
            repo: "single-segment-tool",
          },
        ],
      },
    );

    const registry = await loadSourceRegistry(projectRoot);
    const pathLike = registry.sources.find(
      (source) => source.id === "path-like-repo",
    );
    const singleSegment = registry.sources.find(
      (source) => source.id === "single-segment-repo",
    );

    assert.equal(pathLike?.name, "Path Like Tool");
    assert.equal(pathLike?.publisher?.owner, "acme");
    assert.equal(pathLike?.publisher?.name, "acme");
    assert.equal(singleSegment?.name, "Single Segment Tool");
    assert.equal(singleSegment?.publisher?.owner, undefined);
    assert.equal(singleSegment?.publisher?.name, "single-segment-repo");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

function buildSource(id: string, repo: string): SourceDefinition {
  return {
    id,
    name: id,
    kind: repo.startsWith("http") ? "repo" : "repo",
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
