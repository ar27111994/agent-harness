import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeJsonFile } from "../files.js";
import { loadSourceRegistry } from "../domains/discovery/source-registry.js";
import type { SelectionRegistry, SourceDefinition } from "../types.js";

void test("checked-in source pack entries declare taxonomy fields", async () => {
  for (const sourcePackPath of [
    join(process.cwd(), "discover", "source-packs", "official.json"),
    join(process.cwd(), "discover", "source-packs", "community.json"),
  ]) {
    const sourcePack = JSON.parse(await readFile(sourcePackPath, "utf8")) as {
      entries: Array<{
        id: string;
        kind?: string;
        hosts?: string[];
        assetKinds?: string[];
      }>;
    };
    const incompleteEntries = sourcePack.entries
      .filter(
        (entry) =>
          !entry.kind ||
          !entry.hosts ||
          entry.hosts.length === 0 ||
          !entry.assetKinds ||
          entry.assetKinds.length === 0,
      )
      .map((entry) => entry.id);

    assert.deepEqual(
      incompleteEntries,
      [],
      `${sourcePackPath} entries should declare kind, hosts, and assetKinds`,
    );
  }
});

void test("source registry includes Codex community source pack entries", async () => {
  const registry = await loadSourceRegistry(process.cwd());
  const codexSubagents = registry.sources.find(
    (source) => source.id === "voltagent-awesome-codex-subagents",
  );
  const codexPlugins = registry.sources.find(
    (source) => source.id === "hashgraph-online-awesome-codex-plugins",
  );

  assert.ok(codexSubagents);
  // claude-code plugins are automatically copilot-vscode compatible (PR#287)
  assert.deepEqual(codexSubagents?.hosts, [
    "codex",
    "opencode",
    "claude-code",
    "copilot-vscode",
  ]);
  assert.deepEqual(codexSubagents?.assetKinds, [
    "agent",
    "instruction",
    "workflow",
    "reference-pack",
  ]);

  assert.ok(codexPlugins?.publisher);
  assert.equal(codexPlugins.publisher.name, "Hashgraph Online");
  assert.deepEqual(codexPlugins?.hosts, [
    "codex",
    "shared", // mcp-server + hook assetKinds → cross-host shared delivery
  ]);
  assert.deepEqual(codexPlugins?.assetKinds, [
    "plugin",
    "skill",
    "mcp-server",
    "hook",
    "reference-pack",
  ]);
  assert.deepEqual(codexPlugins?.includePaths, [
    "README.md",
    "**/.codex-plugin/**",
    "**/plugin.json",
    "**/marketplace.json",
    "**/SKILL.md",
    "**/hooks.json",
    "**/.mcp.json",
    "**/*.md",
  ]);
});

void test("source registry includes requested Codex-compatible source pack entries", async () => {
  const registry = await loadSourceRegistry(process.cwd());
  const anthropicClaudeCode = registry.sources.find(
    (source) => source.id === "anthropics-claude-code-pack",
  );
  const trailOfBitsSkills = registry.sources.find(
    (source) => source.id === "trailofbits-skills-pack",
  );
  const trailOfBitsConfig = registry.sources.find(
    (source) => source.id === "trailofbits-claude-code-config",
  );
  const gitNexus = registry.sources.find(
    (source) => source.id === "abhigyanpatwari-gitnexus",
  );
  const superpowers = registry.sources.find(
    (source) => source.id === "obra-superpowers",
  );

  assert.ok(anthropicClaudeCode);
  assert.equal(anthropicClaudeCode?.authorityTier, "official-first-party");
  assert.deepEqual(anthropicClaudeCode?.hosts, [
    "claude-code",
    "opencode",
    "codex",
    "cursor",
    "copilot-vscode",
    "shared", // hook assetKind → cross-host shared delivery
  ]);
  assert.deepEqual(anthropicClaudeCode?.assetKinds, [
    "plugin",
    "skill",
    "agent",
    "instruction",
    "workflow",
    "hook",
    "mcp-server",
    "reference-pack",
  ]);

  assert.ok(trailOfBitsSkills);
  assert.equal(trailOfBitsSkills?.authorityTier, "official-first-party");
  assert.deepEqual(trailOfBitsSkills?.hosts, [
    "codex",
    "claude-code",
    "opencode",
    "cursor",
    "copilot-vscode",
    "shared", // hook assetKind → cross-host shared delivery
  ]);
  assert.deepEqual(trailOfBitsSkills?.includePaths?.slice(0, 4), [
    "README.md",
    "CLAUDE.md",
    ".codex/INSTALL.md",
    ".codex/skills/**",
  ]);

  assert.ok(trailOfBitsConfig);
  assert.equal(trailOfBitsConfig?.authorityTier, "trusted-community");
  assert.deepEqual(trailOfBitsConfig?.hosts, [
    "claude-code",
    "codex",
    "opencode",
    "copilot-vscode", // claude-code ↔ copilot-vscode automatic compat
    "shared", // hook assetKind → cross-host shared delivery
  ]);
  assert.deepEqual(trailOfBitsConfig?.assetKinds, [
    "instruction",
    "workflow",
    "hook",
    "mcp-server",
    "reference-pack",
  ]);

  assert.ok(gitNexus);
  assert.deepEqual(gitNexus?.hosts, [
    "claude-code",
    "cursor",
    "codex",
    "opencode",
    "copilot-vscode",
    "shared", // mcp-server + hook assetKinds → cross-host shared delivery
  ]);
  assert.deepEqual(gitNexus?.assetKinds, [
    "plugin",
    "skill",
    "mcp-server",
    "hook",
    "instruction",
    "workflow",
    "reference-pack",
  ]);

  assert.ok(superpowers);
  assert.ok(superpowers?.hosts.includes("codex"));
  assert.ok(superpowers?.assetKinds.includes("plugin"));
  assert.ok(superpowers?.includePaths?.includes(".codex-plugin/**"));
});

void test("source registry includes Penpot MCP source pack entries", async () => {
  const registry = await loadSourceRegistry(process.cwd());
  const penpotSource = registry.sources.find(
    (source) => source.id === "penpot-mcp-pack",
  );
  const communitySkillSource = registry.sources.find(
    (source) => source.id === "ar27111994-penpot-mcp",
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
    "codex",
    "copilot-vscode", // claude-code ↔ copilot-vscode automatic compat
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

  assert.ok(communitySkillSource);
  assert.equal(communitySkillSource?.authorityTier, "trusted-community");
  assert.equal(communitySkillSource?.publisher?.name, "ar27111994");
  assert.deepEqual(communitySkillSource?.hosts, [
    "opencode",
    "cursor",
    "zed",
    "claude-code",
    "pi",
    "shared",
    "codex",
    "copilot-vscode",
  ]);
  assert.deepEqual(communitySkillSource?.assetKinds, [
    "skill",
    "mcp-server",
    "instruction",
    "workflow",
    "reference-pack",
  ]);
  assert.equal(
    communitySkillSource?.endpoints.repo,
    "https://github.com/ar27111994/penpot-mcp",
  );
  assert.deepEqual(communitySkillSource?.includePaths, [
    "README.md",
    "penpot-mcp/SKILL.md",
    "penpot-mcp/references/**",
    "CONTRIBUTING.md",
    "SECURITY.md",
  ]);
});

void test("source registry includes agent-scripts source pack entry", async () => {
  const registry = await loadSourceRegistry(process.cwd());
  const agentScripts = registry.sources.find(
    (source) => source.id === "steipete-agent-scripts",
  );

  assert.ok(agentScripts);
  assert.equal(agentScripts?.authorityTier, "trusted-community");
  assert.equal(agentScripts?.publisher?.name, "steipete");
  assert.deepEqual(agentScripts?.hosts, [
    "claude-code",
    "codex",
    "opencode",
    "cursor",
    "copilot-vscode",
    "shared", // hook assetKind → cross-host shared delivery
  ]);
  assert.deepEqual(agentScripts?.assetKinds, [
    "skill",
    "agent",
    "instruction",
    "workflow",
    "hook",
    "plugin",
    "mcp-server",
    "prompt-pack",
    "reference-pack",
  ]);
  assert.equal(
    agentScripts?.endpoints.repo,
    "https://github.com/steipete/agent-scripts",
  );
  assert.deepEqual(agentScripts?.includePaths, [
    "README.md",
    "AGENTS.MD",
    "tools.md",
    ".github/copilot-instructions.md",
    "skills/**",
    "docs/**",
    "hooks/**",
    "scripts/validate-skills",
    "scripts/committer",
    "scripts/browser-tools.ts",
    "scripts/trash.ts",
  ]);
  assert.deepEqual(agentScripts?.excludePaths, [
    ".github/workflows/**",
    ".vscode/**",
    "release/**",
  ]);
});

void test("source registry includes the v2 requested official and community sources", async () => {
  const registry = await loadSourceRegistry(process.cwd());

  const cursorPlugins = registry.sources.find(
    (source) => source.id === "cursor-plugins-pack",
  );
  const scientificAgentSkills = registry.sources.find(
    (source) => source.id === "k-dense-ai-scientific-agent-skills",
  );
  const agencyAgents = registry.sources.find(
    (source) => source.id === "msitarzewski-agency-agents",
  );

  assert.ok(cursorPlugins, "cursor/plugins should be registered");
  assert.equal(cursorPlugins?.authorityTier, "official-first-party");
  assert.equal(cursorPlugins?.publisher?.name, "Cursor");
  assert.equal(cursorPlugins?.publisher?.verified, true);
  assert.equal(
    cursorPlugins?.endpoints.repo,
    "https://github.com/cursor/plugins",
  );
  assert.ok(cursorPlugins?.hosts.includes("cursor"));
  assert.ok(cursorPlugins?.assetKinds.includes("plugin"));

  assert.ok(
    scientificAgentSkills,
    "K-Dense-AI/scientific-agent-skills should be registered",
  );
  assert.equal(scientificAgentSkills?.authorityTier, "trusted-community");
  assert.equal(scientificAgentSkills?.publisher?.name, "K-Dense-AI");
  assert.equal(
    scientificAgentSkills?.endpoints.repo,
    "https://github.com/K-Dense-AI/scientific-agent-skills",
  );
  assert.ok(scientificAgentSkills?.assetKinds.includes("skill"));

  assert.ok(agencyAgents, "msitarzewski/agency-agents should be registered");
  assert.equal(agencyAgents?.authorityTier, "trusted-community");
  assert.equal(agencyAgents?.publisher?.name, "msitarzewski");
  assert.equal(
    agencyAgents?.endpoints.repo,
    "https://github.com/msitarzewski/agency-agents",
  );
  assert.ok(agencyAgents?.assetKinds.includes("agent"));

  // ── Five newly registered v2 packs ────────────────────────────────────────

  const knowledgeWorkPlugins = registry.sources.find(
    (source) => source.id === "anthropics-knowledge-work-plugins-pack",
  );
  assert.ok(
    knowledgeWorkPlugins,
    "anthropics/knowledge-work-plugins should be registered",
  );
  assert.equal(knowledgeWorkPlugins?.authorityTier, "official-first-party");
  assert.equal(knowledgeWorkPlugins?.publisher?.name, "Anthropic");
  assert.equal(
    knowledgeWorkPlugins?.endpoints.repo,
    "https://github.com/anthropics/knowledge-work-plugins",
  );
  assert.ok(knowledgeWorkPlugins?.assetKinds.includes("plugin"));
  assert.ok(knowledgeWorkPlugins?.hosts.includes("copilot-vscode"));

  const understandAnything = registry.sources.find(
    (source) => source.id === "egonex-ai-understand-anything",
  );
  assert.ok(
    understandAnything,
    "Egonex-AI/Understand-Anything should be registered",
  );
  assert.equal(understandAnything?.authorityTier, "unverified-community");
  assert.equal(understandAnything?.publisher?.name, "Egonex-AI");
  assert.equal(
    understandAnything?.endpoints.repo,
    "https://github.com/Egonex-AI/Understand-Anything",
  );
  assert.ok(understandAnything?.assetKinds.includes("plugin"));

  const tasteSkill = registry.sources.find(
    (source) => source.id === "leonxlnx-taste-skill",
  );
  assert.ok(tasteSkill, "Leonxlnx/taste-skill should be registered");
  assert.equal(tasteSkill?.authorityTier, "trusted-community");
  assert.equal(tasteSkill?.publisher?.name, "Leonxlnx");
  assert.equal(
    tasteSkill?.endpoints.repo,
    "https://github.com/Leonxlnx/taste-skill",
  );
  assert.ok(tasteSkill?.assetKinds.includes("skill"));
  assert.ok(tasteSkill?.hosts.includes("copilot-vscode"));

  const cybersecuritySkills = registry.sources.find(
    (source) => source.id === "mukul975-anthropic-cybersecurity-skills",
  );
  assert.ok(
    cybersecuritySkills,
    "mukul975/Anthropic-Cybersecurity-Skills should be registered",
  );
  assert.equal(cybersecuritySkills?.authorityTier, "unverified-community");
  assert.equal(cybersecuritySkills?.publisher?.name, "mukul975");
  assert.equal(
    cybersecuritySkills?.endpoints.repo,
    "https://github.com/mukul975/Anthropic-Cybersecurity-Skills",
  );
  assert.ok(cybersecuritySkills?.assetKinds.includes("skill"));

  const academicResearch = registry.sources.find(
    (source) => source.id === "imbad0202-academic-research-skills",
  );
  assert.ok(
    academicResearch,
    "Imbad0202/academic-research-skills should be registered",
  );
  assert.equal(academicResearch?.authorityTier, "unverified-community");
  assert.equal(academicResearch?.publisher?.name, "Imbad0202");
  assert.equal(
    academicResearch?.endpoints.repo,
    "https://github.com/Imbad0202/academic-research-skills",
  );
  assert.ok(academicResearch?.assetKinds.includes("skill"));
  assert.ok(academicResearch?.hosts.includes("copilot-vscode"));
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
            kind: "registry",
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
    assert.equal(generated?.kind, "registry");
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
