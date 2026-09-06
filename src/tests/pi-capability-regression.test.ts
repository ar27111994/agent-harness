import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveHostAdapter,
  type HostCapability,
} from "../host-adapters/registry.js";
import { buildHostSupportMatrix } from "../host-adapters/support-matrix.js";

void test("Pi only advertises wire behavior for implemented native surfaces", () => {
  const pi = resolveHostAdapter("pi");
  assert.ok(pi);

  const wireKinds = new Set(
    pi.capabilities
      .filter((capability) => capability.behaviors.includes("wire"))
      .map((capability) => capability.assetKind),
  );
  assert.deepEqual(
    [...wireKinds].sort(),
    [
      "extension",
      "instruction",
      "prompt-pack",
      "reference-pack",
      "skill",
    ].sort(),
  );

  for (const stageOnlyKind of [
    "agent",
    "plugin",
    "hook",
    "workflow",
    "mcp-server",
  ] as const) {
    const matchedCapability: HostCapability | undefined = pi.capabilities.find(
      (candidate: HostCapability) => candidate.assetKind === stageOnlyKind,
    );
    assert.ok(
      matchedCapability,
      `missing stage-only Pi capability for ${stageOnlyKind}`,
    );
    assert.deepEqual(matchedCapability.behaviors, ["stage"]);
  }
});

void test("Pi support matrix documents MCP as stage-only", () => {
  const row = buildHostSupportMatrix().find(
    (candidate) => candidate.cliTarget === "pi",
  );
  assert.ok(row);
  assert.ok(
    row.knownLimitations.some((line) =>
      line.includes("MCP assets are staged as references"),
    ),
  );
});
