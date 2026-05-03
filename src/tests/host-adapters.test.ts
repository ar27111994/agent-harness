import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveHostAdapter } from "../host-adapters/registry.js";
import type { WirePlanManifest, WirePreviewManifest } from "../types.js";

const NATIVE_HOSTS = ["cursor", "zed", "claude-code", "pi"] as const;

test("native host adapters are registered with expected lifecycle hosts", () => {
  assert.equal(resolveHostAdapter("cursor")?.lifecycleHost, "copilot-vscode");
  assert.equal(resolveHostAdapter("cursor")?.recommendationHost, "cursor");
  assert.equal(
    resolveHostAdapter("cursor")?.nativeInstall?.assetKind,
    "extension",
  );
  assert.equal(resolveHostAdapter("zed")?.lifecycleHost, "opencode");
  assert.equal(resolveHostAdapter("zed")?.recommendationHost, "zed");
  assert.equal(resolveHostAdapter("claude")?.id, "claude-code");
  assert.equal(resolveHostAdapter("claudecode")?.id, "claude-code");
  assert.equal(resolveHostAdapter("pi-coding-agent")?.id, "pi");

  const vscodeAdapter = resolveHostAdapter("vscode");
  assert.ok(vscodeAdapter);
  assert.equal(vscodeAdapter.runtime?.executable, "code");
  assert.equal(vscodeAdapter.nativeInstall?.assetKind, "extension");
  assert.ok(
    vscodeAdapter.capabilities
      .find((capability) => capability.assetKind === "extension")
      ?.behaviors.includes("native-install"),
  );

  assert.equal(resolveHostAdapter("claude")?.recommendationHost, "claude-code");

  const piAdapter = resolveHostAdapter("pi");
  assert.ok(piAdapter);
  assert.equal(piAdapter.recommendationHost, "pi");
  const piMcpCapability = piAdapter.capabilities.find(
    (capability) => capability.assetKind === "mcp-server",
  );
  assert.deepEqual(piMcpCapability?.behaviors, ["stage"]);
});

test("OpenCode adapter upserts and resets only the managed AGENTS section", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-opencode-"));
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-workspace-"),
  );
  const agentsPath = join(workspaceRoot, "AGENTS.md");

  try {
    await writeFile(agentsPath, "# Existing guidance\n\nKeep this.\n", "utf8");
    const adapter = resolveHostAdapter("opencode");
    assert.ok(adapter);

    await adapter.wire({ projectRoot, workspaceRoot, mode: "apply" });
    const appliedContent = await readFile(agentsPath, "utf8");
    assert.match(appliedContent, /Keep this\./u);
    assert.match(appliedContent, /agent-harness:begin/u);

    await adapter.wire({ projectRoot, workspaceRoot, mode: "reset" });
    const resetContent = await readFile(agentsPath, "utf8");
    assert.match(resetContent, /Keep this\./u);
    assert.doesNotMatch(resetContent, /agent-harness:begin/u);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("native adapters write host-specific project files and wire plans", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-hosts-"));
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-workspace-"),
  );

  try {
    for (const host of NATIVE_HOSTS) {
      const adapter = resolveHostAdapter(host);
      assert.ok(adapter);

      await adapter.wire({ projectRoot, workspaceRoot, mode: "apply" });

      const activationRoot = join(projectRoot, "activate", host);
      const preview = JSON.parse(
        await readFile(
          join(activationRoot, `wire-preview-${host}.json`),
          "utf8",
        ),
      ) as WirePreviewManifest;
      const plan = JSON.parse(
        await readFile(join(activationRoot, "wire-plan.json"), "utf8"),
      ) as WirePlanManifest;

      assert.equal(plan.host, host);
      assert.equal(preview.host, host === "cursor" ? "vscode" : "opencode");
      assert.equal(preview.mode, "apply");
      assert.ok(plan.nativeInstallActions?.length);
      await assertNativeHostFile(host, workspaceRoot);

      await adapter.wire({ projectRoot, workspaceRoot, mode: "reset" });
      await assert.rejects(
        readFile(join(activationRoot, "wire-plan.json"), "utf8"),
        { code: "ENOENT" },
      );
    }
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

async function assertNativeHostFile(
  host: (typeof NATIVE_HOSTS)[number],
  workspaceRoot: string,
): Promise<void> {
  const hostFileByHost = {
    cursor: join(workspaceRoot, ".cursor", "rules", "agent-harness.mdc"),
    zed: join(workspaceRoot, ".rules"),
    "claude-code": join(workspaceRoot, "CLAUDE.md"),
    pi: join(workspaceRoot, "AGENTS.md"),
  } satisfies Record<(typeof NATIVE_HOSTS)[number], string>;

  const content = await readFile(hostFileByHost[host], "utf8");
  assert.match(content, /Agent Harness/u);
}
