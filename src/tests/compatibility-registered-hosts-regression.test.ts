import assert from "node:assert/strict";
import test from "node:test";

import {
  ACP_COMPATIBLE_HOSTS,
  MCP_COMPATIBLE_HOSTS,
  VSCODE_EXTENSION_COMPATIBLE_HOSTS,
  inferCompatibleHosts,
} from "../host-adapters/compatibility-matrix.js";
import { listHostAdapters } from "../host-adapters/registry.js";

void test("cross-host compatibility tables only reference registered hosts", () => {
  const registered = new Set(
    listHostAdapters().map((adapter) => adapter.recommendationHost),
  );
  for (const entry of [
    ...MCP_COMPATIBLE_HOSTS,
    ...VSCODE_EXTENSION_COMPATIBLE_HOSTS,
    ...ACP_COMPATIBLE_HOSTS,
  ]) {
    assert.ok(
      registered.has(entry.host),
      `compatibility table references unregistered host: ${entry.host}`,
    );
  }
});

void test("MCP compatibility includes copilot-vscode and never emits windsurf", () => {
  assert.ok(
    MCP_COMPATIBLE_HOSTS.some((entry) => entry.host === "copilot-vscode"),
  );
  const inferred = inferCompatibleHosts("mcp-server", ["shared"]);
  assert.ok(inferred.some((entry) => entry.host === "copilot-vscode"));
  assert.ok(inferred.every((entry) => entry.host !== "windsurf"));
});

void test("VS Code extension compatibility contains no ghost hosts", () => {
  const inferred = inferCompatibleHosts("extension", ["copilot-vscode"]);
  assert.deepEqual(
    inferred.map((entry) => entry.host),
    ["cursor"],
  );
});
