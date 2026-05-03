import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { writeJsonFile } from "../files.js";
import { resolveHostAdapter } from "../host-adapters/registry.js";
import {
  buildAssetPrerequisitesFromMetadata,
  buildPrerequisiteDiagnostics,
  collectActivatedAssetPrerequisiteDiagnostics,
} from "../lib/asset-prerequisites.js";
import { sanitizeAssetId } from "../lib/safe-paths.js";
import type { AssetCatalogEntry } from "../types.js";

void test("metadata prerequisites map known auth providers and explicit env vars", () => {
  const prerequisites = buildAssetPrerequisitesFromMetadata({
    providers: ["openai", "unknown-provider"],
    envVars: ["EXTRA_TOKEN"],
    setupUrl: "https://example.com/setup",
  });

  assert.deepEqual(
    prerequisites.map((prerequisite) => prerequisite.id),
    ["auth:openai", "auth:unknown-provider", "env:EXTRA_TOKEN"],
  );
  assert.deepEqual(prerequisites[0]?.envVars, ["OPENAI_API_KEY"]);
  assert.equal(prerequisites[1]?.kind, "manual");
  assert.equal(prerequisites[2]?.setupUrl, "https://example.com/setup");
});

void test("missing and present environment prerequisites produce actionable diagnostics", (context) => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  context.after(() => {
    if (previousOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
    clearRuntimeConfigForTests();
  });

  delete process.env.OPENAI_API_KEY;
  clearRuntimeConfigForTests();
  const missingDiagnostics = buildPrerequisiteDiagnostics(
    buildAssetWithPrerequisites(),
  );
  assert.equal(missingDiagnostics[0]?.severity, "error");
  assert.match(missingDiagnostics[0]?.action ?? "", /OPENAI_API_KEY/u);

  process.env.OPENAI_API_KEY = "test-token";
  clearRuntimeConfigForTests();
  const readyDiagnostics = buildPrerequisiteDiagnostics(
    buildAssetWithPrerequisites(),
  );
  assert.equal(readyDiagnostics[0]?.severity, "info");
});

void test("activated asset prerequisite collection reads activation state", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-harness-prereq-"));
  try {
    const activationRoot = join(projectRoot, "activate", "copilot-vscode");
    await writeJsonFile(join(activationRoot, "activation-manifest.json"), {
      schemaVersion: 1,
      host: "copilot-vscode",
      generatedAt: new Date().toISOString(),
      activeBundles: [],
      activeAssets: ["github.copilot-auth-helper"],
      runtimeRoot: activationRoot,
      notes: [],
    });
    await writeJsonFile(
      join(
        activationRoot,
        sanitizeAssetId("github.copilot-auth-helper"),
        "asset.json",
      ),
      buildAssetWithPrerequisites(),
    );

    const adapter = resolveHostAdapter("vscode");
    assert.ok(adapter);
    const diagnostics = await collectActivatedAssetPrerequisiteDiagnostics(
      projectRoot,
      adapter,
      { missingEnvSeverity: "warning" },
    );

    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.severity, "warning");
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

function buildAssetWithPrerequisites(): AssetCatalogEntry {
  return {
    id: "github.copilot-auth-helper",
    displayName: "Copilot Auth Helper",
    assetKind: "plugin",
    hosts: ["copilot-vscode"],
    compatibilityMode: "adaptable",
    source: {
      sourceId: "local-test",
      authorityTier: "trusted-local",
      sourceKind: "local-directory",
      sourcePriority: 100,
      originUrl: "file:///tmp/plugin.md",
      publisher: "local",
      publisherVerified: true,
    },
    trust: { score: 100, signals: [] },
    capabilities: ["auth"],
    install: {
      method: "local-file",
      adaptableHosts: ["copilot-vscode"],
      prerequisites: [
        {
          id: "auth:openai",
          kind: "env",
          required: true,
          provider: "openai",
          envVars: ["OPENAI_API_KEY"],
          description: "Configure credentials for openai.",
        },
      ],
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
      candidateRankHint: "test",
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}
