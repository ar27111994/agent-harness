import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runDiscover } from "../discover.js";
import {
  buildUnknownSignalReport,
  unknownSignalInternals,
} from "../domains/discovery/unknown-signals.js";

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

void test("unknown-signal report ignores non-package and unreadable dependency manifests", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "agent-harness-unknown-signals-ignored-"),
  );

  try {
    await writeFile(join(root, "requirements.txt"), "acme-unknown\n", "utf8");
    await mkdir(join(root, "empty-package"), { recursive: true });
    await writeFile(join(root, "bad-package.json"), "not-json", "utf8");

    const report = await buildUnknownSignalReport(root);

    assert.equal(report.summary.signalCount, 0);
    assert.deepEqual(
      await unknownSignalInternals.collectUnfamiliarDependencyNames(
        "requirements.txt",
        join(root, "requirements.txt"),
      ),
      [],
    );
    assert.deepEqual(
      await unknownSignalInternals.collectUnfamiliarDependencyNames(
        "package.json",
        join(root, "missing-package.json"),
      ),
      [],
    );
    assert.equal(unknownSignalInternals.parsePackageJson("null"), null);
    assert.deepEqual(unknownSignalInternals.parsePackageJson("[]"), []);
    assert.deepEqual(
      await unknownSignalInternals.collectUnfamiliarDependencyNames(
        "package.json",
        join(root, "bad-package.json"),
      ),
      [],
    );
    assert.equal(unknownSignalInternals.parsePackageJson("not-json"), null);
    assert.equal(
      unknownSignalInternals.createSignal(
        "package.json",
        "package.json",
        "unfamiliar-package-dependency",
        "low",
        ["dependency may need a technology signature: @acme/unknown"],
      ).suggestedNextAction,
      "add-signature",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("unknown-signal report collects dependency buckets and dedupes repeated signals", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "agent-harness-unknown-signals-deps-"),
  );

  try {
    await writeFile(join(root, ".mcp.json"), "{}\n", "utf8");
    await mkdir(join(root, ".cursor-plugin"), { recursive: true });
    await writeFile(
      join(root, ".cursor-plugin", "manifest.json"),
      "{}\n",
      "utf8",
    );
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        dependencies: { "@types/node": "latest", "@acme/runtime": "1" },
        devDependencies: { "@acme/devtool": "1" },
        optionalDependencies: { "@acme/optional": "1" },
        peerDependencies: { "@acme/peer": "1" },
      }),
      "utf8",
    );

    const report = await buildUnknownSignalReport(root);

    const dependencySignal = report.signals.find(
      (signal) => signal.category === "unfamiliar-package-dependency",
    );
    assert.deepEqual(dependencySignal, {
      id: "unfamiliar-package-dependency:package.json",
      path: "package.json",
      fileName: "package.json",
      category: "unfamiliar-package-dependency",
      confidence: "low",
      evidence: ["dependency may need a technology signature: @acme/runtime"],
      ambiguityNotes: [
        "single dependency names are weak evidence until supported by imports, config, or docs",
      ],
      suggestedNextAction: "add-signature",
    });
    assert.deepEqual(
      report.signals.map((signal) => signal.suggestedNextAction).sort(),
      ["add-signature", "needs-research"],
    );
    assert.deepEqual(
      unknownSignalInternals.dedupeSignals([
        report.signals[0]!,
        report.signals[0]!,
      ]),
      [report.signals[0]],
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
