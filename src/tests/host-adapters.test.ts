import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveHostAdapter } from "../host-adapters/registry.js";
import type { WirePlanManifest, WirePreviewManifest } from "../types.js";

const GUIDANCE_HOSTS = ["cursor", "zed", "claude-code", "pi"] as const;

test("guidance host adapters are registered with expected lifecycle hosts", () => {
  assert.equal(resolveHostAdapter("cursor")?.lifecycleHost, "copilot-vscode");
  assert.equal(resolveHostAdapter("zed")?.lifecycleHost, "opencode");
  assert.equal(resolveHostAdapter("claude")?.id, "claude-code");
  assert.equal(resolveHostAdapter("claudecode")?.id, "claude-code");
  assert.equal(resolveHostAdapter("pi-coding-agent")?.id, "pi");

  const piAdapter = resolveHostAdapter("pi");
  assert.ok(piAdapter);
  const piMcpCapability = piAdapter.capabilities.find(
    (capability) => capability.assetKind === "mcp-server",
  );
  assert.deepEqual(piMcpCapability?.behaviors, ["stage"]);
});

test("guidance adapters write host-specific preview and apply plans", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-hosts-"));
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-workspace-"),
  );

  try {
    for (const host of GUIDANCE_HOSTS) {
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
      assert.ok(plan.notes.some((note) => note.includes(adapter.displayName)));

      await adapter.wire({ projectRoot, workspaceRoot, mode: "reset" });
      await assert.rejects(
        readFile(join(activationRoot, "wire-plan.json"), "utf8"),
        (error: unknown) =>
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT",
      );
    }
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});
