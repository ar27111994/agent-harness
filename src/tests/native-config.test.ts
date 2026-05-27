import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeJsonFile, writeTextFile } from "../files.js";
import {
  applyHostNativeFilePayloads,
  collectHostNativeFilePayloads,
  nativeConfigInternals,
  revertNativeConfigOperations,
  toWorkspaceRelativeConfigPath,
} from "../host-adapters/native-config.js";
import type {
  AssetCatalogEntry,
  AssetHostNativeFilePayload,
} from "../types.js";

void test("native config helpers collect host payloads, merge JSON content, and restore previous state", async (context) => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-native-config-"),
  );
  context.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const activeAssets = [
    buildAssetWithNativeConfig("asset-opencode", [
      {
        path: "opencode.json",
        format: "json",
        merge: true,
        content: {
          instructions: ["./instructions/new.md", "./instructions/existing.md"],
          plugins: {
            second: true,
          },
          dedupe: [
            { name: "alpha", id: 1 },
            { id: 2, name: "beta" },
          ],
          scalar: true,
        },
      },
      {
        path: ".opencode/tools/tool.md",
        format: "text",
        content: "# tool\n",
      },
    ]),
    buildAssetWithNativeConfig(
      "asset-cursor",
      [
        {
          path: ".cursor/mcp.json",
          format: "json",
          merge: true,
          content: { servers: [] },
        },
      ],
      "cursor",
    ),
  ];

  assert.deepEqual(
    collectHostNativeFilePayloads(activeAssets, "opencode").map(
      (payload) => payload.path,
    ),
    ["opencode.json", ".opencode/tools/tool.md"],
  );

  await writeJsonFile(join(workspaceRoot, "opencode.json"), {
    instructions: ["./instructions/existing.md"],
    plugins: { first: true },
    dedupe: [{ id: 1, name: "alpha" }],
  });

  const operations = await applyHostNativeFilePayloads({
    workspaceRoot,
    host: "opencode",
    payloads: collectHostNativeFilePayloads(activeAssets, "opencode"),
  });

  const mergedConfig = JSON.parse(
    await readFile(join(workspaceRoot, "opencode.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.deepEqual(
    operations.map((operation) => operation.mode),
    ["merge", "write"],
  );
  assert.deepEqual(mergedConfig, {
    instructions: ["./instructions/existing.md", "./instructions/new.md"],
    plugins: { first: true, second: true },
    dedupe: [
      { id: 1, name: "alpha" },
      { id: 2, name: "beta" },
    ],
    scalar: true,
  });
  assert.equal(
    await readFile(
      join(workspaceRoot, ".opencode", "tools", "tool.md"),
      "utf8",
    ),
    "# tool\n",
  );
  assert.equal(
    toWorkspaceRelativeConfigPath(
      workspaceRoot,
      join(workspaceRoot, ".opencode", "tools", "tool.md"),
    ),
    ".opencode/tools/tool.md",
  );

  await revertNativeConfigOperations({
    workspaceRoot,
    host: "opencode",
    operations,
  });

  const restoredConfig = JSON.parse(
    await readFile(join(workspaceRoot, "opencode.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.deepEqual(restoredConfig, {
    instructions: ["./instructions/existing.md"],
    plugins: { first: true },
    dedupe: [{ id: 1, name: "alpha" }],
  });
  await assert.rejects(
    readFile(join(workspaceRoot, ".opencode", "tools", "tool.md"), "utf8"),
  );
});

void test("workspace-relative config paths gain a ./ prefix when needed", async (context) => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-native-config-"),
  );
  context.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  assert.equal(
    toWorkspaceRelativeConfigPath(
      workspaceRoot,
      join(workspaceRoot, "opencode.json"),
    ),
    "./opencode.json",
  );
});

void test("native config merge operations created from scratch are removed on revert", async (context) => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-native-config-"),
  );
  context.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const operations = await applyHostNativeFilePayloads({
    workspaceRoot,
    host: "opencode",
    payloads: [
      {
        path: "opencode.json",
        format: "json",
        merge: true,
        content: {
          instructions: ["./instructions/generated.md"],
        },
      },
    ],
  });

  assert.deepEqual(operations[0]?.previousContent, null);
  assert.deepEqual(
    JSON.parse(await readFile(join(workspaceRoot, "opencode.json"), "utf8")),
    {
      instructions: ["./instructions/generated.md"],
    },
  );

  await revertNativeConfigOperations({
    workspaceRoot,
    host: "opencode",
    operations,
  });

  await assert.rejects(readFile(join(workspaceRoot, "opencode.json"), "utf8"));
});

void test("native config application rolls back earlier writes when a later payload is invalid", async (context) => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-native-config-"),
  );
  context.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await assert.rejects(
    applyHostNativeFilePayloads({
      workspaceRoot,
      host: "opencode",
      payloads: [
        {
          path: ".opencode/tools/generated.md",
          format: "text",
          content: "generated",
        },
        {
          path: "notes.txt",
          format: "text",
          content: "not allowed",
        },
      ],
    }),
    /Unsupported opencode host-native payload target/u,
  );

  await assert.rejects(
    readFile(join(workspaceRoot, ".opencode", "tools", "generated.md"), "utf8"),
  );

  await writeTextFile(
    join(workspaceRoot, ".opencode", "tools", "existing.md"),
    "kept\n",
  );
  await assert.rejects(
    applyHostNativeFilePayloads({
      workspaceRoot,
      host: "opencode",
      payloads: [
        {
          path: ".opencode/tools/existing.md",
          format: "text",
          content: "new content",
        },
      ],
    }),
    /Refusing to overwrite existing opencode host-native text file/u,
  );
  assert.equal(
    await readFile(
      join(workspaceRoot, ".opencode", "tools", "existing.md"),
      "utf8",
    ),
    "kept\n",
  );
});

void test("native config rejects invalid paths and unsupported host surfaces", async (context) => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-native-config-"),
  );
  context.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  for (const payloadPath of [
    "",
    "/absolute.json",
    "C:/absolute.json",
    "./relative.json",
    "dir/../escape.json",
    "dir/",
  ]) {
    await assert.rejects(
      applyHostNativeFilePayloads({
        workspaceRoot,
        host: "opencode",
        payloads: [
          {
            path: payloadPath,
            format: "json",
            merge: true,
            content: {},
          },
        ],
      }),
    );
  }

  await assert.rejects(
    applyHostNativeFilePayloads({
      workspaceRoot,
      host: "opencode",
      payloads: [
        {
          path: "opencode.json",
          format: "json",
          merge: false,
          content: {},
        },
      ],
    }),
    /Unsupported opencode host-native payload target/u,
  );

  await applyHostNativeFilePayloads({
    workspaceRoot,
    host: "cursor",
    payloads: [
      {
        path: ".cursor/agents/generated.md",
        format: "text",
        content: "agent",
      },
      {
        path: ".cursor/hooks.json",
        format: "json",
        merge: true,
        content: { hooks: ["generated"] },
      },
    ],
  });
  assert.equal(
    await readFile(
      join(workspaceRoot, ".cursor", "agents", "generated.md"),
      "utf8",
    ),
    "agent",
  );

  await applyHostNativeFilePayloads({
    workspaceRoot,
    host: "zed",
    payloads: [
      {
        path: ".zed/settings.json",
        format: "json",
        merge: true,
        content: { telemetry: { metrics: false } },
      },
    ],
  });
  assert.deepEqual(
    JSON.parse(
      await readFile(join(workspaceRoot, ".zed", "settings.json"), "utf8"),
    ),
    { telemetry: { metrics: false } },
  );

  await applyHostNativeFilePayloads({
    workspaceRoot,
    host: "claude-code",
    payloads: [
      {
        path: ".mcp.json",
        format: "json",
        merge: true,
        content: { servers: { local: { command: "node" } } },
      },
      {
        path: ".claude/settings.json",
        format: "json",
        merge: true,
        content: { allowed: true },
      },
      {
        path: ".claude/settings.local.json",
        format: "json",
        merge: true,
        content: { localOnly: true },
      },
    ],
  });
  assert.deepEqual(
    JSON.parse(await readFile(join(workspaceRoot, ".mcp.json"), "utf8")),
    { servers: { local: { command: "node" } } },
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(join(workspaceRoot, ".claude", "settings.json"), "utf8"),
    ),
    { allowed: true },
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(workspaceRoot, ".claude", "settings.local.json"),
        "utf8",
      ),
    ),
    { localOnly: true },
  );

  await applyHostNativeFilePayloads({
    workspaceRoot,
    host: "pi",
    payloads: [
      {
        path: ".pi/extensions/generated/index.js",
        format: "text",
        content: "export default true;\n",
      },
      {
        path: ".pi/packages/generated.json",
        format: "text",
        content: '{"name":"generated"}\n',
      },
      {
        path: ".pi/packages/structured.json",
        format: "json",
        merge: false,
        content: { name: "structured" },
      },
    ],
  });
  assert.equal(
    await readFile(
      join(workspaceRoot, ".pi", "extensions", "generated", "index.js"),
      "utf8",
    ),
    "export default true;\n",
  );
  assert.equal(
    await readFile(
      join(workspaceRoot, ".pi", "packages", "generated.json"),
      "utf8",
    ),
    '{"name":"generated"}\n',
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(workspaceRoot, ".pi", "packages", "structured.json"),
        "utf8",
      ),
    ),
    { name: "structured" },
  );

  await assert.rejects(
    applyHostNativeFilePayloads({
      workspaceRoot,
      host: "codex",
      payloads: [
        {
          path: ".codex/settings.json",
          format: "json",
          merge: true,
          content: {},
        },
      ],
    }),
    /Unsupported codex host-native payload target/u,
  );

  await applyHostNativeFilePayloads({
    workspaceRoot,
    host: "codex",
    payloads: [
      {
        path: ".codex/config.toml",
        format: "text",
        content: 'approval_policy = "never"\n',
      },
      {
        path: ".codex/rules/generated.md",
        format: "text",
        content: "# Codex rule\n",
      },
      {
        path: ".agents/skills/generated/SKILL.md",
        format: "text",
        content: "# Codex skill\n",
      },
      {
        path: ".agents/plugins/generated/plugin.json",
        format: "json",
        merge: false,
        content: { name: "generated" },
      },
    ],
  });
  assert.equal(
    await readFile(join(workspaceRoot, ".codex", "config.toml"), "utf8"),
    'approval_policy = "never"\n',
  );
  assert.equal(
    await readFile(
      join(workspaceRoot, ".agents", "skills", "generated", "SKILL.md"),
      "utf8",
    ),
    "# Codex skill\n",
  );

  await assert.rejects(
    applyHostNativeFilePayloads({
      workspaceRoot,
      host: "pi",
      payloads: [
        {
          path: ".pi/packages/structured.json",
          format: "json",
          merge: false,
          content: { name: "replacement" },
        },
      ],
    }),
    /Refusing to overwrite existing pi host-native JSON file/u,
  );

  await writeJsonFile(join(workspaceRoot, ".cursor", "mcp.json"), {
    existing: true,
  });
  await assert.rejects(
    applyHostNativeFilePayloads({
      workspaceRoot,
      host: "cursor",
      payloads: [
        {
          path: ".cursor/mcp.json",
          format: "json",
          merge: false,
          content: { replaced: true },
        },
      ],
    }),
    /Unsupported cursor host-native payload target/u,
  );
});

void test("native config rejects unsupported zed, claude-code, and pi targets", async (context) => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-native-config-"),
  );
  context.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await assert.rejects(
    applyHostNativeFilePayloads({
      workspaceRoot,
      host: "zed",
      payloads: [
        {
          path: ".zed/tasks.json",
          format: "json",
          merge: true,
          content: {},
        },
      ],
    }),
    /Unsupported zed host-native payload target/u,
  );

  await assert.rejects(
    applyHostNativeFilePayloads({
      workspaceRoot,
      host: "claude-code",
      payloads: [
        {
          path: ".claude/commands/generated.json",
          format: "json",
          merge: true,
          content: {},
        },
      ],
    }),
    /Unsupported claude-code host-native payload target/u,
  );

  await assert.rejects(
    applyHostNativeFilePayloads({
      workspaceRoot,
      host: "pi",
      payloads: [
        {
          path: ".pi/settings.json",
          format: "json",
          merge: true,
          content: {},
        },
      ],
    }),
    /Unsupported pi host-native payload target/u,
  );
});

void test("native config revert removes emptied merged files and tolerates malformed text operation payloads", async (context) => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-native-config-"),
  );
  context.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeJsonFile(join(workspaceRoot, "opencode.json"), {
    instructions: ["./generated.md"],
    nested: { only: true },
  });

  await revertNativeConfigOperations({
    workspaceRoot,
    host: "opencode",
    operations: [
      {
        path: "opencode.json",
        format: "json",
        mode: "merge",
        content: {
          instructions: ["./generated.md"],
          nested: { only: true },
        },
      },
      {
        path: ".opencode/tools/generated.md",
        format: "text",
        mode: "write",
        content: { not: "text" } as never,
      },
    ],
  });

  await assert.rejects(readFile(join(workspaceRoot, "opencode.json"), "utf8"));
});

void test("native config merge and revert handle non-object json and synthesized merge removals", async (context) => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-native-config-"),
  );
  context.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeTextFile(join(workspaceRoot, "opencode.json"), "[]\n");
  await assert.rejects(
    applyHostNativeFilePayloads({
      workspaceRoot,
      host: "opencode",
      payloads: [
        {
          path: "opencode.json",
          format: "json",
          merge: true,
          content: { generated: true },
        },
      ],
    }),
    /opencode\.json must contain a JSON object/u,
  );

  await writeJsonFile(join(workspaceRoot, "opencode.json"), {
    instructions: ["./keep.md", ["nested"]],
    nested: {
      keep: true,
      remove: true,
    },
    scalar: true,
  });

  await revertNativeConfigOperations({
    workspaceRoot,
    host: "opencode",
    operations: [
      {
        path: "opencode.json",
        format: "json",
        mode: "merge",
        content: {
          instructions: [["nested"]],
          nested: { remove: true },
          scalar: true,
        },
      },
    ],
  });

  assert.deepEqual(
    JSON.parse(await readFile(join(workspaceRoot, "opencode.json"), "utf8")),
    {
      instructions: ["./keep.md"],
      nested: {
        keep: true,
      },
    },
  );

  await revertNativeConfigOperations({
    workspaceRoot,
    host: "opencode",
    operations: [
      {
        path: "opencode.json",
        format: "json",
        mode: "merge",
        content: { nested: true },
      },
    ],
  });

  assert.deepEqual(
    JSON.parse(await readFile(join(workspaceRoot, "opencode.json"), "utf8")),
    {
      instructions: ["./keep.md"],
    },
  );

  await writeTextFile(join(workspaceRoot, "opencode.json"), "[]\n");
  await revertNativeConfigOperations({
    workspaceRoot,
    host: "opencode",
    operations: [
      {
        path: "opencode.json",
        format: "json",
        mode: "merge",
        content: { ignored: true },
      },
      {
        path: "opencode.json",
        format: "json",
        mode: "merge",
        content: [] as never,
      },
    ],
  });
  assert.equal(
    await readFile(join(workspaceRoot, "opencode.json"), "utf8"),
    "[]\n",
  );
});

function buildAssetWithNativeConfig(
  assetId: string,
  payloads: AssetHostNativeFilePayload[],
  host: keyof NonNullable<AssetCatalogEntry["hostNativeConfig"]> = "opencode",
): AssetCatalogEntry {
  return {
    id: assetId,
    displayName: assetId,
    assetKind: "plugin",
    hosts: ["opencode"],
    compatibilityMode: "adaptable",
    source: {
      sourceId: `${assetId}-source`,
      authorityTier: "trusted-local",
      sourceKind: "local-directory",
      sourcePriority: 1,
      originUrl: "file:///tmp/test",
      publisher: "tests",
      publisherVerified: true,
    },
    trust: { score: 100, signals: [] },
    capabilities: [],
    install: {
      method: "local-file",
      adaptableHosts: ["opencode"],
    },
    evidence: {
      manifestFound: true,
      readmeFound: false,
      examplesFound: false,
      docsLinked: false,
    },
    maintenance: {
      lastUpdated: new Date().toISOString(),
      stars: 0,
      releaseCadence: "local",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: {
      sizeClass: "tiny",
      estimatedPromptWeight: 1,
    },
    fit: {
      portfolioFit: 1,
      hostFit: 1,
    },
    dedupe: {
      candidateRankHint: assetId,
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
    hostNativeConfig: {
      [host]: {
        files: payloads,
      },
    },
  };
}

void test("native config internals reject resolved paths that escape the workspace", () => {
  const workspaceRoot = join(tmpdir(), "agent-harness-native-config-root");

  assert.throws(
    () => nativeConfigInternals.resolveWorkspacePath(workspaceRoot, ""),
    /escapes workspace root/u,
  );
  assert.throws(
    () =>
      nativeConfigInternals.resolveWorkspacePath(
        workspaceRoot,
        "../escape.json",
      ),
    /escapes workspace root/u,
  );
});
