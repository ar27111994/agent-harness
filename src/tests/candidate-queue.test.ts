import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeJsonFile } from "../files.js";
import {
  buildSourceCandidateQueue,
  writeSourceCandidateQueue,
} from "../domains/discovery/candidate-queue.js";
import type { SourceDefinition } from "../types.js";

void test("source candidate queue turns unknown signals into reviewable candidates", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-candidates-"),
  );

  try {
    await writeJsonFile(
      join(projectRoot, "discover", "output", "unknown-signals.json"),
      {
        schemaVersion: 1,
        generatedAt: "2026-01-01T00:00:00.000Z",
        scanRoot: projectRoot,
        summary: {
          scannedFiles: 2,
          signalCount: 2,
          byCategory: {
            "mcp-manifest": 1,
            "host-rule-folder": 1,
            "unfamiliar-package-dependency": 0,
            "plugin-manifest": 0,
          },
        },
        signals: [
          {
            id: "mcp-manifest:.mcp.json",
            path: ".mcp.json",
            fileName: ".mcp.json",
            category: "mcp-manifest",
            confidence: "high",
            evidence: ["workspace contains an MCP manifest"],
            ambiguityNotes: ["auth requires review"],
            suggestedNextAction: "needs-research",
          },
          {
            id: "host-rule-folder:.cursor/rules/app.md",
            path: ".cursor/rules/app.md",
            fileName: "app.md",
            category: "host-rule-folder",
            confidence: "medium",
            evidence: ["workspace contains host rules"],
            ambiguityNotes: ["local/private instructions"],
            suggestedNextAction: "add-source-mapping",
          },
        ],
      },
    );

    const report = await buildSourceCandidateQueue(projectRoot, []);
    assert.equal(report.candidateCount, 2);
    assert.equal(report.reviewRequiredCount, 2);
    assert.equal(report.candidates[0]?.provenance, "unknown-signal");
    assert.equal(
      report.candidates.find((candidate) =>
        candidate.label.includes("mcp-manifest"),
      )?.risky,
      true,
    );

    await writeSourceCandidateQueue(projectRoot, []);
    const written = JSON.parse(
      await readFile(
        join(projectRoot, "discover", "output", "source-candidates.json"),
        "utf8",
      ),
    ) as typeof report;
    assert.equal(written.candidateCount, 2);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("source candidate queue marks duplicates from existing sources", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-candidate-dupes-"),
  );

  try {
    await writeJsonFile(
      join(projectRoot, "discover", "output", "unknown-signals.json"),
      {
        schemaVersion: 1,
        generatedAt: "2026-01-01T00:00:00.000Z",
        scanRoot: projectRoot,
        summary: {
          scannedFiles: 1,
          signalCount: 1,
          byCategory: {
            "mcp-manifest": 0,
            "host-rule-folder": 1,
            "unfamiliar-package-dependency": 0,
            "plugin-manifest": 0,
          },
        },
        signals: [
          {
            id: "host-rule-folder:.cursor/rules/app.md",
            path: ".cursor/rules/app.md",
            fileName: "app.md",
            category: "host-rule-folder",
            confidence: "medium",
            evidence: ["workspace contains host rules"],
            ambiguityNotes: ["local/private instructions"],
            suggestedNextAction: "add-source-mapping",
          },
        ],
      },
    );

    const report = await buildSourceCandidateQueue(projectRoot, [
      buildSource("existing", ".cursor/rules/app.md"),
    ]);

    assert.equal(report.candidates[0]?.duplicate, true);
    assert.equal(report.candidates[0]?.suggestedAction, "research");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

function buildSource(id: string, docsUrl: string): SourceDefinition {
  return {
    id,
    name: id,
    kind: "docs",
    authorityTier: "trusted-community",
    hosts: ["cursor"],
    assetKinds: ["instruction"],
    discoveryMode: "catalog",
    priority: 50,
    enabled: true,
    endpoints: { docsUrl },
    rules: {
      officialPreferred: false,
      allowMirror: false,
      allowInstall: false,
    },
  };
}
