import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { restoreEnvVar } from "./env-test-utils.js";
import { writeJsonFile } from "../files.js";
import { resolveHostAdapter } from "../host-adapters/registry.js";
import {
  buildAssetPrerequisitesFromMetadata,
  buildPrerequisiteDiagnostics,
  collectActivatedAssetPrerequisiteDiagnostics,
} from "../lib/asset-prerequisites.js";
import { sanitizeAssetId } from "../lib/safe-paths.js";
import type {
  ActivationManifest,
  AssetCatalogEntry,
  CopilotWorkspaceProfileManifest,
} from "../types.js";

void test("asset prerequisite diagnostics cover malformed env, host login, oauth, and manual guidance branches", (context) => {
  const previousGitHubToken = process.env.GITHUB_TOKEN;
  const previousPersonalToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  const previousMissingTwo = process.env.MISSING_TWO;
  context.after(() => {
    if (previousGitHubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      restoreEnvVar("GITHUB_TOKEN", previousGitHubToken);
    }
    if (previousPersonalToken === undefined) {
      delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    } else {
      restoreEnvVar("GITHUB_PERSONAL_ACCESS_TOKEN", previousPersonalToken);
    }
    if (previousMissingTwo === undefined) {
      delete process.env.MISSING_TWO;
    } else {
      restoreEnvVar("MISSING_TWO", previousMissingTwo);
    }
    clearRuntimeConfigForTests();
  });

  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  delete process.env.MISSING_TWO;
  clearRuntimeConfigForTests();

  const vscodeAdapter = resolveHostAdapter("vscode");
  assert.ok(vscodeAdapter);

  const diagnostics = buildPrerequisiteDiagnostics(
    buildAssetWithPrerequisites(),
    {
      adapter: vscodeAdapter,
      missingEnvSeverity: "warning",
    },
  );

  assert.equal(diagnostics[0]?.severity, "warning");
  assert.match(
    diagnostics[0]?.message ?? "",
    /malformed environment prerequisite/u,
  );
  assert.equal(diagnostics[1]?.severity, "warning");
  assert.match(
    diagnostics[1]?.message ?? "",
    /signed-in copilot-vscode session/u,
  );
  assert.equal(diagnostics[2]?.severity, "info");
  assert.match(
    diagnostics[2]?.message ?? "",
    /declares a host login prerequisite for cursor; current host is copilot-vscode/u,
  );
  assert.equal(diagnostics[3]?.severity, "warning");
  assert.match(
    diagnostics[3]?.action ?? "",
    /Run setup login --provider github/u,
  );
  assert.equal(diagnostics[4]?.severity, "warning");
  assert.match(
    diagnostics[4]?.message ?? "",
    /requires one of MISSING_ONE, MISSING_TWO/u,
  );
  assert.match(
    diagnostics[4]?.action ?? "",
    /Set one of MISSING_ONE, MISSING_TWO/u,
  );
  assert.equal(diagnostics[5]?.severity, "warning");
  assert.match(
    diagnostics[5]?.message ?? "",
    /requires a signed-in host session/u,
  );
  assert.equal(diagnostics[6]?.severity, "warning");
  assert.match(
    diagnostics[6]?.message ?? "",
    /requires OAuth authorization for its provider/u,
  );
  assert.equal(diagnostics[7]?.severity, "warning");
  assert.match(
    diagnostics[7]?.action ?? "",
    /Complete the provider setup described by the asset before applying wire-in/u,
  );

  process.env.MISSING_TWO = " configured ";
  clearRuntimeConfigForTests();
  const envReadyDiagnostics = buildPrerequisiteDiagnostics(
    buildAssetWithPrerequisites(),
    {
      adapter: vscodeAdapter,
      missingEnvSeverity: "warning",
    },
  );
  assert.equal(envReadyDiagnostics[4]?.severity, "info");
  assert.equal(envReadyDiagnostics[4]?.action, undefined);

  process.env.GITHUB_TOKEN = "configured";
  clearRuntimeConfigForTests();
  const readyDiagnostics = buildPrerequisiteDiagnostics(
    buildAssetWithPrerequisites(),
    {
      adapter: vscodeAdapter,
      missingEnvSeverity: "warning",
    },
  );
  assert.equal(readyDiagnostics[3]?.severity, "info");
  assert.equal(readyDiagnostics[3]?.action, undefined);
});

void test("asset prerequisite metadata builder dedupes providers env vars host aliases and oauth entries", () => {
  assert.deepEqual(
    buildAssetPrerequisitesFromMetadata({
      providers: ["", "  "],
      envVars: [""],
    }),
    [],
  );

  const prerequisites = buildAssetPrerequisitesFromMetadata({
    providers: [" GitHub ", "custom", "github"],
    envVars: ["OPENAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
    hostLogins: ["vscode", "cursor", "vscode"],
    oauthProviders: [" github ", "custom-oauth", "github"],
    setupUrl: "https://example.com/setup",
  });

  assert.deepEqual(
    prerequisites.map((prerequisite) => prerequisite.id),
    [
      "auth:custom",
      "auth:github",
      "env:ANTHROPIC_API_KEY",
      "env:OPENAI_API_KEY",
      "host-login:copilot-vscode",
      "host-login:cursor",
      "oauth:custom-oauth",
      "oauth:github",
    ],
  );
  assert.deepEqual(prerequisites[0], {
    id: "auth:custom",
    kind: "manual",
    required: true,
    provider: "custom",
    envVars: undefined,
    setupUrl: "https://example.com/setup",
    description: "Complete manual authentication setup for custom.",
  });
  assert.deepEqual(prerequisites[1]?.envVars, [
    "GITHUB_TOKEN",
    "GITHUB_PERSONAL_ACCESS_TOKEN",
  ]);
  assert.equal(prerequisites[4]?.host, "copilot-vscode");
  assert.match(
    prerequisites[7]?.description ?? "",
    /OAuth authorization for github/u,
  );
});

void test("activated prerequisite collection reads lifecycle, shared, and profile-selected assets", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-prereq-extended-"),
  );

  try {
    const lifecycleActivationRoot = join(
      projectRoot,
      "activate",
      "copilot-vscode",
    );
    const sharedActivationRoot = join(projectRoot, "activate", "shared");
    const lifecycleAssetId = "asset.lifecycle";
    const sharedAssetId = "asset.shared";
    const profileAssetId = "asset.profile";

    await writeJsonFile(
      join(lifecycleActivationRoot, "activation-manifest.json"),
      {
        schemaVersion: 1,
        host: "copilot-vscode",
        generatedAt: new Date().toISOString(),
        activeBundles: [],
        activeAssets: [lifecycleAssetId],
        runtimeRoot: lifecycleActivationRoot,
        notes: [],
      } satisfies ActivationManifest,
    );
    await writeJsonFile(
      join(sharedActivationRoot, "activation-manifest.json"),
      {
        schemaVersion: 1,
        host: "shared",
        generatedAt: new Date().toISOString(),
        activeBundles: [],
        activeAssets: [sharedAssetId],
        runtimeRoot: sharedActivationRoot,
        notes: [],
      } satisfies ActivationManifest,
    );
    await writeJsonFile(
      join(lifecycleActivationRoot, "workspace-profile-manifest.json"),
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        profileId: "profile",
        workspaceRoot: projectRoot,
        bundleIds: [],
        selectedAssetIds: [profileAssetId],
        selectedInstructionIds: [],
        selectedAgentIds: [],
        selectedWorkflowIds: [],
        activationBudget: 3,
      } satisfies CopilotWorkspaceProfileManifest,
    );

    await Promise.all([
      writeJsonFile(
        join(
          lifecycleActivationRoot,
          sanitizeAssetId(lifecycleAssetId),
          "asset.json",
        ),
        buildCollectedAsset(lifecycleAssetId, "lifecycle token"),
      ),
      writeJsonFile(
        join(
          sharedActivationRoot,
          sanitizeAssetId(sharedAssetId),
          "asset.json",
        ),
        buildCollectedAsset(sharedAssetId, "shared token"),
      ),
      writeJsonFile(
        join(
          lifecycleActivationRoot,
          sanitizeAssetId(profileAssetId),
          "asset.json",
        ),
        buildCollectedAsset(profileAssetId, "profile token"),
      ),
    ]);

    const adapter = resolveHostAdapter("vscode");
    assert.ok(adapter);

    const diagnostics = await collectActivatedAssetPrerequisiteDiagnostics(
      projectRoot,
      adapter,
      { missingEnvSeverity: "warning" },
    );

    assert.deepEqual(
      diagnostics
        .map((diagnostic) => diagnostic.code)
        .sort((left, right) => left.localeCompare(right)),
      [
        `asset-prerequisite-missing:${lifecycleAssetId}:env:${lifecycleAssetId.toUpperCase().replace(/\./gu, "_")}`,
        `asset-prerequisite-missing:${profileAssetId}:env:${profileAssetId.toUpperCase().replace(/\./gu, "_")}`,
        `asset-prerequisite-missing:${sharedAssetId}:env:${sharedAssetId.toUpperCase().replace(/\./gu, "_")}`,
      ],
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

function buildAssetWithPrerequisites(): AssetCatalogEntry {
  return {
    id: "asset.extended",
    displayName: "Extended prerequisites",
    assetKind: "plugin",
    hosts: ["copilot-vscode"],
    compatibilityMode: "adaptable",
    source: {
      sourceId: "asset.extended-source",
      authorityTier: "trusted-local",
      sourceKind: "local-directory",
      sourcePriority: 1,
      originUrl: "https://example.com/asset.extended",
      publisher: "tests",
      publisherVerified: true,
    },
    trust: { score: 100, signals: [] },
    capabilities: ["auth"],
    install: {
      method: "local-file",
      adaptableHosts: ["copilot-vscode"],
      prerequisites: [
        {
          id: "env:broken",
          kind: "env",
          required: true,
          description: "broken env",
        },
        {
          id: "host-login:copilot-vscode",
          kind: "host-login",
          required: true,
          host: "copilot-vscode",
          description: "Sign in to VS Code",
        },
        {
          id: "host-login:cursor",
          kind: "host-login",
          required: true,
          host: "cursor",
          description: "Sign in to Cursor",
        },
        {
          id: "oauth:github",
          kind: "oauth",
          required: true,
          provider: "github",
          description: "Authorize GitHub",
        },
        {
          id: "env:multiple",
          kind: "env",
          required: true,
          envVars: ["MISSING_ONE", "MISSING_TWO"],
          description: "Configure one fallback token",
        },
        {
          id: "host-login:any",
          kind: "host-login",
          required: true,
          description: "Sign in to current host",
        },
        {
          id: "oauth:unknown",
          kind: "oauth",
          required: true,
          description: "Authorize unknown provider",
        },
        {
          id: "manual:setup",
          kind: "manual",
          required: true,
          description: "Perform manual setup",
        },
      ],
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
    },
    maintenance: {
      lastUpdated: "2026-01-01T00:00:00.000Z",
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
      candidateRankHint: "extended",
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}

function buildCollectedAsset(
  assetId: string,
  description: string,
): AssetCatalogEntry {
  const envVar = assetId.toUpperCase().replace(/\./gu, "_");
  return {
    id: assetId,
    displayName: assetId,
    assetKind: "plugin",
    hosts: ["copilot-vscode"],
    compatibilityMode: "adaptable",
    source: {
      sourceId: `${assetId}-source`,
      authorityTier: "trusted-local",
      sourceKind: "local-directory",
      sourcePriority: 1,
      originUrl: `https://example.com/${assetId}`,
      publisher: "tests",
      publisherVerified: true,
    },
    trust: { score: 100, signals: [] },
    capabilities: ["fixture"],
    install: {
      method: "local-file",
      adaptableHosts: ["copilot-vscode"],
      prerequisites: [
        {
          id: `env:${envVar}`,
          kind: "env",
          required: true,
          envVars: [envVar],
          description,
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
      lastUpdated: "2026-01-01T00:00:00.000Z",
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
      candidateRankHint: assetId,
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}
