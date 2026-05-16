import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { harvestLocalDirectorySource } from "../domains/discovery/local-harvesters.js";
import { buildGeneratedLocalSources } from "../domains/discovery/local-sources.js";
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

void test("generated Claude Code and Cursor config sources are catalog-only", () => {
  const sourcesById = new Map(
    buildGeneratedLocalSources().map((source) => [source.id, source]),
  );

  assert.equal(
    sourcesById.get("local-claude-code-config")?.rules.allowMirror,
    false,
  );
  assert.equal(
    sourcesById.get("local-claude-code-config")?.rules.allowInstall,
    false,
  );
  assert.equal(
    sourcesById.get("local-cursor-config")?.rules.allowMirror,
    false,
  );
  assert.equal(
    sourcesById.get("local-cursor-config")?.rules.allowInstall,
    false,
  );
});

void test("local Claude Code config harvesting recognizes native components", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-claude-local-"));

  try {
    await writeText(join(root, "CLAUDE.md"), "# Claude memory\n");
    await writeText(join(root, "commands", "review.md"), "Review changes.\n");
    await writeText(join(root, "agents", "reviewer.md"), "# Reviewer\n");
    await writeText(
      join(root, "skills", "repo-guide", "SKILL.md"),
      "---\nname: repo-guide\ndescription: Repository guide\n---\n# Guide\n",
    );
    await writeText(join(root, "workflows", "deploy.yaml"), "name: deploy\n");
    await writeText(
      join(root, "hooks", "audit.json"),
      '{"PreToolUse":[{"hooks":[{"type":"command","command":"echo ok"}]}]}',
    );
    await writeText(
      join(root, ".mcp.json"),
      '{"mcpServers":{"repo":{"command":"node","args":["server.js"]}}}',
    );
    await writeText(
      join(root, "plugins", "team", ".claude-plugin", "plugin.json"),
      '{"name":"team"}',
    );
    await writeText(join(root, "plugins", "team", "README.md"), "# Team\n");
    await writeText(join(root, "notes.txt"), "ignore me\n");

    const entries = await harvestLocalDirectorySource(
      buildLocalSource("local-claude-code-config", root, [
        "opencode",
        "claude-code",
      ]),
      null,
      buildSelectionRegistry(),
      root,
    );
    const kindByPath = new Map(
      entries.map((entry) => [entry.install.relativePath, entry.assetKind]),
    );

    assert.equal(kindByPath.get("CLAUDE.md"), "instruction");
    assert.equal(kindByPath.get("commands/review.md"), "prompt-pack");
    assert.equal(kindByPath.get("agents/reviewer.md"), "agent");
    assert.equal(kindByPath.get("skills/repo-guide/SKILL.md"), "skill");
    assert.equal(kindByPath.get("workflows/deploy.yaml"), "workflow");
    assert.equal(kindByPath.get("hooks/audit.json"), "hook");
    assert.equal(kindByPath.get(".mcp.json"), "mcp-server");
    assert.equal(
      kindByPath.get("plugins/team/.claude-plugin/plugin.json"),
      "plugin",
    );
    assert.equal(kindByPath.get("plugins/team/README.md"), "reference-pack");
    assert.equal(kindByPath.has("notes.txt"), false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("local Cursor config harvesting recognizes native components", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-cursor-local-"));

  try {
    await writeText(join(root, ".cursorrules"), "Keep edits focused.\n");
    await writeText(join(root, "rules", "frontend.mdc"), "# Frontend\n");
    await writeText(join(root, "commands", "review.md"), "Review changes.\n");
    await writeText(join(root, "agents", "security.md"), "# Security\n");
    await writeText(
      join(root, "skills", "api-designer", "SKILL.md"),
      "---\nname: api-designer\ndescription: API design\n---\n# API\n",
    );
    await writeText(
      join(root, "hooks.json"),
      '{"version":1,"hooks":{"preToolUse":[{"command":"echo ok"}]}}',
    );
    await writeText(
      join(root, "plugins", "team", "hooks", "deploy.json"),
      '{"hooks":{"preToolUse":[{"command":"echo ok"}]}}',
    );
    await writeText(
      join(root, "mcp.json"),
      '{"mcpServers":{"repo":{"command":"node","args":["server.js"]}}}',
    );
    await writeText(
      join(root, "plugins", "team", ".cursor-plugin", "plugin.json"),
      '{"name":"team"}',
    );
    await writeText(
      join(root, ".cursor-plugin", "marketplace.json"),
      '{"name":"team-marketplace","plugins":[]}',
    );

    const entries = await harvestLocalDirectorySource(
      buildLocalSource("local-cursor-config", root, [
        "copilot-vscode",
        "cursor",
      ]),
      null,
      buildSelectionRegistry(),
      root,
    );
    const kindByPath = new Map(
      entries.map((entry) => [entry.install.relativePath, entry.assetKind]),
    );

    assert.equal(kindByPath.get(".cursorrules"), "instruction");
    assert.equal(kindByPath.get("rules/frontend.mdc"), "instruction");
    assert.equal(kindByPath.get("commands/review.md"), "prompt-pack");
    assert.equal(kindByPath.get("agents/security.md"), "agent");
    assert.equal(kindByPath.get("skills/api-designer/SKILL.md"), "skill");
    assert.equal(kindByPath.get("hooks.json"), "hook");
    assert.equal(kindByPath.get("plugins/team/hooks/deploy.json"), "hook");
    assert.equal(kindByPath.get("mcp.json"), "mcp-server");
    assert.equal(
      kindByPath.get("plugins/team/.cursor-plugin/plugin.json"),
      "plugin",
    );
    assert.equal(
      kindByPath.get(".cursor-plugin/marketplace.json"),
      "reference-pack",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("local directory source defaults missing endpoint paths to project root", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-local-root-"));

  try {
    await writeText(join(root, "docs", "guide.md"), "# Guide\n");

    const entries = await harvestLocalDirectorySource(
      {
        ...buildLocalSource("local-opencode-context", join(root, "unused"), [
          "opencode",
        ]),
        endpoints: {},
      },
      null,
      buildSelectionRegistry(),
      root,
    );

    assert.deepEqual(
      entries.map((entry) => entry.install.relativePath),
      ["docs/guide.md"],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
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
