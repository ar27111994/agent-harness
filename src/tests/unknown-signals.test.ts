import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runDiscover } from "../discover.js";
import { buildUnknownSignalReport } from "../domains/discovery/unknown-signals.js";

void test("unknown-signal report captures MCP, host, plugin, and unfamiliar dependency evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-unknown-signals-"));

  try {
    await writeFile(join(root, ".mcp.json"), '{"servers":{}}', "utf8");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify(
        {
          dependencies: {
            express: "latest",
            "@acme/unmapped-runtime": "1.0.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await mkdir(join(root, ".cursor", "rules"), { recursive: true });
    await mkdir(join(root, ".codex-plugin"), { recursive: true });
    await writeFile(
      join(root, ".cursor", "rules", "agent-harness.md"),
      "Use project-specific rules.",
      "utf8",
    );
    await writeFile(
      join(root, ".codex-plugin", "plugin.json"),
      '{"name":"demo"}',
      "utf8",
    );

    const report = await buildUnknownSignalReport(root);

    assert.equal(report.summary.signalCount, 4);
    assert.equal(report.summary.byCategory["mcp-manifest"], 1);
    assert.equal(report.summary.byCategory["host-rule-folder"], 1);
    assert.equal(report.summary.byCategory["plugin-manifest"], 1);
    assert.equal(report.summary.byCategory["unfamiliar-package-dependency"], 1);
    assert.ok(
      report.signals.some(
        (signal) =>
          signal.path === "package.json" &&
          signal.category === "unfamiliar-package-dependency" &&
          signal.suggestedNextAction === "add-signature" &&
          signal.evidence.includes(
            "dependency may need a technology signature: @acme/unmapped-runtime",
          ),
      ),
    );
    assert.ok(
      report.signals.some(
        (signal) =>
          signal.path === ".mcp.json" &&
          signal.category === "mcp-manifest" &&
          signal.suggestedNextAction === "needs-research",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("discover demand-profile writes unknown-signal backlog", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-demand-unknown-"));
  const stateRoot = join(root, "state");
  const workspaceRoot = join(root, "workspace");

  try {
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(join(workspaceRoot, ".mcp.json"), '{"servers":{}}', "utf8");
    assert.equal(
      await runDiscover(["demand-profile"], workspaceRoot, stateRoot),
      0,
    );

    const report = JSON.parse(
      await readFile(
        join(stateRoot, "discover", "output", "unknown-signals.json"),
        "utf8",
      ),
    ) as Awaited<ReturnType<typeof buildUnknownSignalReport>>;
    assert.equal(report.signals[0]?.category, "mcp-manifest");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
