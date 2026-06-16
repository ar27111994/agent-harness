/**
 * Tests for the cross-host compatibility matrix:
 * - inferCompatibleHosts auto-populates based on asset kind
 * - isHostInCompatibleHosts / getCompatibleHostEntry utilities
 * - isHostCompatibleWithRecommendationHost honours compatibleHosts in selection
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { HostTarget } from "../types/core.js";
import {
  inferCompatibleHosts,
  isHostInCompatibleHosts,
  getCompatibleHostEntry,
  MCP_COMPATIBLE_HOSTS,
  VSCODE_EXTENSION_COMPATIBLE_HOSTS,
  ACP_COMPATIBLE_HOSTS,
} from "../host-adapters/compatibility-matrix.js";
import { isHostCompatibleWithRecommendationHost } from "../host-adapters/registry.js";

// ---------------------------------------------------------------------------
// inferCompatibleHosts
// ---------------------------------------------------------------------------

void describe("inferCompatibleHosts", () => {
  void it("mcp-server with primary host copilot-vscode gets all other MCP hosts", () => {
    const compatible = inferCompatibleHosts("mcp-server", ["copilot-vscode"]);
    const hosts = compatible.map((c) => c.host);
    // Should include all MCP_COMPATIBLE_HOSTS except copilot-vscode (already primary)
    for (const entry of MCP_COMPATIBLE_HOSTS) {
      if (entry.host === "copilot-vscode") continue;
      assert.ok(
        hosts.includes(entry.host),
        `Expected ${entry.host} in compatible hosts for mcp-server`,
      );
    }
    // Should NOT duplicate the primary host
    assert.ok(
      !hosts.includes("copilot-vscode"),
      "Primary host should not be duplicated in compatibleHosts",
    );
  });

  void it("mcp-server with primary host claude-code excludes claude-code from compatible hosts", () => {
    const compatible = inferCompatibleHosts("mcp-server", ["claude-code"]);
    const hosts = compatible.map((c) => c.host);
    assert.ok(
      !hosts.includes("claude-code"),
      "claude-code is primary — should not appear in compatibleHosts",
    );
    // cursor, zed, opencode, codex should still be present
    assert.ok(hosts.includes("cursor"));
    assert.ok(hosts.includes("zed"));
    assert.ok(hosts.includes("opencode"));
    assert.ok(hosts.includes("codex"));
  });

  void it("mcp-server compatible hosts all have installDiffers: true", () => {
    const compatible = inferCompatibleHosts("mcp-server", []);
    for (const entry of compatible) {
      assert.strictEqual(
        entry.installDiffers,
        true,
        `Expected installDiffers=true for ${entry.host}`,
      );
    }
  });

  void it("extension with primary host copilot-vscode gets cursor partial compat", () => {
    const compatible = inferCompatibleHosts("extension", ["copilot-vscode"]);
    const hosts = compatible.map((c) => c.host);
    assert.ok(hosts.includes("cursor"), "cursor should be in extension compat");
    const cursorEntry = compatible.find((c) => c.host === "cursor");
    assert.strictEqual(cursorEntry?.compatibility, "partial");
  });

  void it("extension primary host cursor does not duplicate cursor", () => {
    const compatible = inferCompatibleHosts("extension", ["cursor"]);
    const hosts = compatible.map((c) => c.host);
    assert.ok(
      !hosts.includes("cursor"),
      "cursor already primary, not in compatibleHosts",
    );
  });

  void it("acp-agent gets zed full compat", () => {
    const compatible = inferCompatibleHosts("acp-agent", []);
    const zedEntry = compatible.find((c) => c.host === "zed");
    assert.ok(zedEntry, "acp-agent should be compatible with zed");
    assert.strictEqual(zedEntry.compatibility, "full");
  });

  void it("skill returns empty compatible hosts", () => {
    const compatible = inferCompatibleHosts("skill", ["claude-code"]);
    assert.deepStrictEqual(compatible, [], "skill has no auto-inferred compat");
  });

  void it("reference-pack returns empty compatible hosts", () => {
    const compatible = inferCompatibleHosts("reference-pack", ["shared"]);
    assert.deepStrictEqual(compatible, []);
  });

  void it("returns a fresh array each call (no mutation across calls)", () => {
    const a = inferCompatibleHosts("mcp-server", []);
    const b = inferCompatibleHosts("mcp-server", []);
    a.push({ host: "mutated-extra" as HostTarget, compatibility: "partial" });
    assert.notStrictEqual(
      a.length,
      b.length,
      "Each call should return an independent array",
    );
  });
});

// ---------------------------------------------------------------------------
// isHostInCompatibleHosts
// ---------------------------------------------------------------------------

void describe("isHostInCompatibleHosts", () => {
  void it("returns true when host is present", () => {
    assert.strictEqual(
      isHostInCompatibleHosts(
        [{ host: "cursor", compatibility: "partial" }],
        "cursor",
      ),
      true,
    );
  });

  void it("returns false when host is absent", () => {
    assert.strictEqual(
      isHostInCompatibleHosts(
        [{ host: "cursor", compatibility: "partial" }],
        "zed",
      ),
      false,
    );
  });

  void it("returns false for undefined compatibleHosts", () => {
    assert.strictEqual(isHostInCompatibleHosts(undefined, "cursor"), false);
  });

  void it("returns false for empty array", () => {
    assert.strictEqual(isHostInCompatibleHosts([], "cursor"), false);
  });
});

// ---------------------------------------------------------------------------
// getCompatibleHostEntry
// ---------------------------------------------------------------------------

void describe("getCompatibleHostEntry", () => {
  void it("returns entry when host is present", () => {
    const entry = getCompatibleHostEntry(
      [{ host: "cursor", compatibility: "partial", installDiffers: true }],
      "cursor",
    );
    assert.ok(entry);
    assert.strictEqual(entry.compatibility, "partial");
    assert.strictEqual(entry.installDiffers, true);
  });

  void it("returns null when host is absent", () => {
    assert.strictEqual(
      getCompatibleHostEntry(
        [{ host: "cursor", compatibility: "partial" }],
        "zed",
      ),
      null,
    );
  });

  void it("returns null for undefined", () => {
    assert.strictEqual(getCompatibleHostEntry(undefined, "cursor"), null);
  });
});

// ---------------------------------------------------------------------------
// isHostCompatibleWithRecommendationHost with compatibleHosts
// ---------------------------------------------------------------------------

void describe("isHostCompatibleWithRecommendationHost — cross-host compat", () => {
  void it("returns true for an mcp-server entry whose compatibleHosts includes the target", () => {
    const entryHosts = ["copilot-vscode"] as const as HostTarget[];
    const compatibleHosts = inferCompatibleHosts("mcp-server", entryHosts);
    // zed is in MCP_COMPATIBLE_HOSTS and is not the primary host
    const result = isHostCompatibleWithRecommendationHost(
      entryHosts,
      "zed",
      "mcp-server",
      compatibleHosts,
    );
    assert.strictEqual(
      result,
      true,
      "mcp-server should be compatible with zed via compatibleHosts",
    );
  });

  void it("returns true for primary host even without compatibleHosts", () => {
    const result = isHostCompatibleWithRecommendationHost(
      ["cursor"],
      "cursor",
      "skill",
      undefined,
    );
    assert.strictEqual(result, true);
  });

  void it("returns false when neither primary nor compatibleHosts include the target", () => {
    const result = isHostCompatibleWithRecommendationHost(
      ["claude-code"],
      "zed",
      "skill",
      [],
    );
    assert.strictEqual(result, false, "skill has no cross-host compat");
  });

  void it("extension with cursor compatibleHost is surfaced for cursor workspaces", () => {
    const entryHosts = ["copilot-vscode"] as HostTarget[];
    const compatibleHosts = inferCompatibleHosts("extension", entryHosts);
    const result = isHostCompatibleWithRecommendationHost(
      entryHosts,
      "cursor",
      "extension",
      compatibleHosts,
    );
    assert.strictEqual(
      result,
      true,
      "extension is surfaced for cursor via compatibleHosts",
    );
  });

  void it("mcp-server with NO compatibleHosts is NOT surfaced for non-primary host", () => {
    const result = isHostCompatibleWithRecommendationHost(
      ["copilot-vscode"],
      "zed",
      "mcp-server",
      undefined, // no compatibleHosts → should not cross-resolve
    );
    assert.strictEqual(
      result,
      false,
      "Without compatibleHosts, mcp-server is not cross-host surfaced",
    );
  });
});

// ---------------------------------------------------------------------------
// Module-level constant integrity checks
// ---------------------------------------------------------------------------

void describe("compatibility matrix constants", () => {
  void it("all MCP_COMPATIBLE_HOSTS entries have installDiffers: true", () => {
    for (const entry of MCP_COMPATIBLE_HOSTS) {
      assert.strictEqual(
        entry.installDiffers,
        true,
        `MCP host ${entry.host} should have installDiffers: true`,
      );
    }
  });

  void it("VSCODE_EXTENSION_COMPATIBLE_HOSTS all have partial compatibility", () => {
    for (const entry of VSCODE_EXTENSION_COMPATIBLE_HOSTS) {
      assert.strictEqual(
        entry.compatibility,
        "partial",
        `Extension compat host ${entry.host} should be partial`,
      );
    }
  });

  void it("ACP_COMPATIBLE_HOSTS all have full compatibility", () => {
    for (const entry of ACP_COMPATIBLE_HOSTS) {
      assert.strictEqual(
        entry.compatibility,
        "full",
        `ACP host ${entry.host} should be full compatibility`,
      );
    }
  });

  void it("no host appears in multiple constant arrays simultaneously for the same kind", () => {
    const mcpHosts = new Set(MCP_COMPATIBLE_HOSTS.map((e) => e.host));
    const vsceHosts = new Set(
      VSCODE_EXTENSION_COMPATIBLE_HOSTS.map((e) => e.host),
    );
    const acpHosts = new Set(ACP_COMPATIBLE_HOSTS.map((e) => e.host));
    // These represent different asset kinds so overlap is acceptable, but
    // validate that we don't accidentally duplicate within the same constant
    assert.strictEqual(
      mcpHosts.size,
      MCP_COMPATIBLE_HOSTS.length,
      "No duplicate hosts in MCP_COMPATIBLE_HOSTS",
    );
    assert.strictEqual(
      vsceHosts.size,
      VSCODE_EXTENSION_COMPATIBLE_HOSTS.length,
      "No duplicate hosts in VSCODE_EXTENSION_COMPATIBLE_HOSTS",
    );
    assert.strictEqual(
      acpHosts.size,
      ACP_COMPATIBLE_HOSTS.length,
      "No duplicate hosts in ACP_COMPATIBLE_HOSTS",
    );
  });
});
