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
    hostLogins: ["vscode"],
    oauthProviders: ["OpenAI"],
    setupUrl: "https://example.com/setup",
  });

  assert.deepEqual(
    prerequisites.map((prerequisite) => prerequisite.id),
    [
      "auth:openai",
      "auth:unknown-provider",
      "env:EXTRA_TOKEN",
      "host-login:copilot-vscode",
      "oauth:openai",
    ],
  );
  assert.deepEqual(prerequisites[0]?.envVars, ["OPENAI_API_KEY"]);
  assert.equal(prerequisites[0]?.setupUrl, "https://example.com/setup");
  assert.equal(prerequisites[1]?.kind, "manual");
  assert.equal(prerequisites[1]?.setupUrl, "https://example.com/setup");
  assert.equal(prerequisites[2]?.setupUrl, undefined);
  assert.equal(prerequisites[3]?.host, "copilot-vscode");
  assert.equal(prerequisites[4]?.provider, "openai");
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

void test("manual, host-login mismatch, and oauth prerequisites produce actionable diagnostics", (context) => {
  const previousGithubToken = process.env.GITHUB_TOKEN;
  const previousPat = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  context.after(() => {
    if (previousGithubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = previousGithubToken;
    }
    if (previousPat === undefined) {
      delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    } else {
      process.env.GITHUB_PERSONAL_ACCESS_TOKEN = previousPat;
    }
    clearRuntimeConfigForTests();
  });

  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  clearRuntimeConfigForTests();

  const diagnostics = buildPrerequisiteDiagnostics(
    {
      ...buildAssetWithPrerequisites(),
      install: {
        ...buildAssetWithPrerequisites().install,
        prerequisites: [
          {
            id: "manual:review-docs",
            kind: "manual",
            required: true,
            description: "Read the setup docs.",
          },
          {
            id: "host-login:opencode",
            kind: "host-login",
            required: true,
            host: "opencode",
            description: "Sign in to opencode.",
          },
          {
            id: "oauth:github",
            kind: "oauth",
            required: true,
            provider: "github",
            description: "Authorize GitHub.",
          },
        ],
      },
    },
    { adapter: resolveHostAdapter("vscode") ?? undefined },
  );

  assert.equal(diagnostics[0]?.severity, "error");
  assert.match(
    diagnostics[0]?.action ?? "",
    /Complete the provider setup described by the asset/u,
  );
  assert.equal(diagnostics[1]?.severity, "info");
  assert.match(
    diagnostics[1]?.message ?? "",
    /current host is copilot-vscode/u,
  );
  assert.equal(diagnostics[2]?.severity, "error");
  assert.match(
    diagnostics[2]?.action ?? "",
    /Run setup login --provider github/u,
  );

  process.env.GITHUB_TOKEN = "fixture-token";
  clearRuntimeConfigForTests();
  const readyOauth = buildPrerequisiteDiagnostics(
    {
      ...buildAssetWithPrerequisites(),
      install: {
        ...buildAssetWithPrerequisites().install,
        prerequisites: [
          {
            id: "oauth:github",
            kind: "oauth",
            required: true,
            provider: "github",
            description: "Authorize GitHub.",
          },
        ],
      },
    },
    { adapter: resolveHostAdapter("vscode") ?? undefined },
  );
  assert.equal(readyOauth[0]?.severity, "info");
  assert.equal(readyOauth[0]?.action, undefined);
});

void test("manual prerequisite actions include setup urls when provided", () => {
  const diagnostics = buildPrerequisiteDiagnostics({
    ...buildAssetWithPrerequisites(),
    install: {
      ...buildAssetWithPrerequisites().install,
      prerequisites: [
        {
          id: "manual:hosted-setup",
          kind: "manual",
          required: true,
          description: "Follow the hosted setup flow.",
          setupUrl: "https://example.com/setup",
        },
      ],
    },
  });

  assert.equal(diagnostics[0]?.severity, "error");
  assert.equal(diagnostics[0]?.action, "See https://example.com/setup");
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

void test("host-login prerequisites warn for matching or unspecified host contexts", () => {
  const baseAsset = buildAssetWithPrerequisites();
  const matchingDiagnostics = buildPrerequisiteDiagnostics(
    {
      ...baseAsset,
      install: {
        ...baseAsset.install,
        prerequisites: [
          {
            id: "host-login:copilot-vscode",
            kind: "host-login",
            required: true,
            host: "copilot-vscode",
            description: "Sign in to VS Code.",
          },
          {
            id: "host-login:any",
            kind: "host-login",
            required: false,
            description: "Sign in to the active host if needed.",
          },
        ],
      },
    },
    { adapter: resolveHostAdapter("vscode") ?? undefined },
  );

  assert.deepEqual(
    matchingDiagnostics.map((diagnostic) => diagnostic.severity),
    ["warning", "info"],
  );
  assert.match(
    matchingDiagnostics[0]?.message ?? "",
    /signed-in copilot-vscode/u,
  );
  assert.match(matchingDiagnostics[1]?.message ?? "", /signed-in host/u);

  const noPrerequisiteDiagnostics = buildPrerequisiteDiagnostics({
    ...baseAsset,
    install: { ...baseAsset.install, prerequisites: undefined },
  });
  assert.deepEqual(noPrerequisiteDiagnostics, []);
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
