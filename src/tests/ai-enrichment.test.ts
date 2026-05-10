import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildAiEnrichmentInputArtifact,
  orchestrateAiEnrichment,
} from "../domains/discovery/ai-enrichment.js";
import { runDiscover } from "../discover.js";
import { runWorkspace } from "../workspace.js";
import {
  clearRuntimeConfigForTests,
  loadRuntimeConfig,
} from "../config/runtime.js";
import {
  createContentHash,
  readJsonFile,
  readTextFileOrNull,
  writeJsonFile,
  writeJsonLinesFile,
} from "../files.js";
import {
  assertAiEnrichmentInput,
  assertAiEnrichmentReport,
} from "../manifest-validation.js";
import type { AssetCatalogEntry, DemandProfile } from "../types.js";

void test("ai enrichment input artifact applies limits and redactions", () => {
  const config = loadRuntimeConfig({
    HOME: "/home/tester",
    AGENT_HARNESS_AI_ENRICHMENT_MODE: "manual",
    AGENT_HARNESS_AI_ENRICHMENT_MAX_SELECTED_ASSETS: "1",
    AGENT_HARNESS_AI_ENRICHMENT_MAX_EVIDENCE_ITEMS: "1",
    AGENT_HARNESS_AI_ENRICHMENT_MAX_CAPABILITIES_PER_ASSET: "2",
    AGENT_HARNESS_AI_ENRICHMENT_REDACT_FILE_PATHS: "true",
    AGENT_HARNESS_AI_ENRICHMENT_REDACT_SOURCE_IDS: "true",
  }).aiEnrichment;
  const demandProfile = buildDemandProfile();
  const selectedEntries = [
    buildCatalogEntry("asset-a", ["react", "typescript", "testing"]),
    buildCatalogEntry("asset-b", ["backend"]),
  ];

  const input = buildAiEnrichmentInputArtifact({
    config,
    demandProfile,
    demandProfileHash: "demand-sha",
    selectedCatalogHash: "selected-sha",
    selectedEntries,
    trigger: "after-select",
    explicit: true,
    interactive: true,
    ci: false,
    configHash: "config-sha",
  });

  assert.equal(input.includedSelectedAssetCount, 1);
  assert.equal(input.includedEvidenceItemCount, 1);
  assert.equal(input.omissions.selectedAssets, 1);
  assert.equal(input.omissions.evidenceItems, 1);
  assert.equal(input.omissions.capabilityValues, 1);
  assert.equal(input.selectedAssets[0]?.capabilities.length, 2);
  assert.match(input.selectedAssets[0]?.sourceId ?? "", /^sha256-/u);
  assert.match(input.demandEvidence[0]?.path ?? "", /^sha256-/u);
  assert.equal(input.fingerprints.demandProfileSha256, "demand-sha");
  assert.equal(input.fingerprints.selectedCatalogSha256, "selected-sha");
  assert.equal(input.fingerprints.configSha256, "config-sha");
});

void test("ai enrichment validators accept nullable fingerprint hashes", () => {
  const config = loadRuntimeConfig({
    HOME: "/home/tester",
    AGENT_HARNESS_AI_ENRICHMENT_MODE: "manual",
  }).aiEnrichment;
  const input = buildAiEnrichmentInputArtifact({
    config,
    demandProfile: buildDemandProfile(),
    demandProfileHash: null,
    selectedCatalogHash: null,
    selectedEntries: [],
    trigger: "after-workspace",
    explicit: false,
    interactive: false,
    ci: false,
    configHash: "config-sha",
  });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    enabled: false,
    mode: input.mode,
    trigger: input.trigger,
    explicit: input.explicit,
    interactive: input.interactive,
    ci: input.ci,
    providerOrigin: input.providerOrigin,
    model: input.model,
    status: "skipped" as const,
    inputSha256: input.fingerprints.inputSha256,
    fingerprints: {
      demandProfileSha256: null,
      selectedCatalogSha256: null,
      configSha256: input.fingerprints.configSha256,
    },
    reason: "AI enrichment was explicitly disabled for this run.",
  };

  assert.doesNotThrow(() => assertAiEnrichmentInput(input, "input"));
  assert.doesNotThrow(() => assertAiEnrichmentReport(report, "report"));
});

void test("explicit ai enrichment writes a disabled artifact when config is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-ai-enrichment-"));

  try {
    await writeDiscoveryInputs(root);

    await withEnv(
      {
        HOME: "/home/tester",
        AGENT_HARNESS_AI_ENRICHMENT_URL: undefined,
        AGENT_HARNESS_AI_ENRICHMENT_API_KEY: undefined,
        AGENT_HARNESS_AI_ENRICHMENT_MODE: "manual",
      },
      async () => {
        const result = await orchestrateAiEnrichment(root, {
          trigger: "manual",
          explicitRequested: true,
          disableRequested: false,
          force: false,
          requireSuccess: false,
        });

        assert.equal(result.outcome, "disabled");
        const input = await readJsonFile(
          join(root, "discover", "output", "ai-enrichment-input.json"),
          assertAiEnrichmentInput,
        );
        const artifact = await readJsonFile(
          join(root, "discover", "output", "ai-enrichment.json"),
          assertAiEnrichmentReport,
        );

        assert.equal(input.selectedAssetCount, 2);
        assert.equal(artifact.status, "disabled");
        assert.equal(artifact.enabled, false);
        assert.match(artifact.reason ?? "", /AGENT_HARNESS_AI_ENRICHMENT_URL/u);
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("explicit disable does not fail even when require-success is requested", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-ai-enrichment-"));

  try {
    await writeDiscoveryInputs(root);

    await withEnv(
      {
        HOME: "/home/tester",
        AGENT_HARNESS_AI_ENRICHMENT_URL:
          "https://api.openai.com/v1/chat/completions",
        AGENT_HARNESS_AI_ENRICHMENT_API_KEY: "***",
        AGENT_HARNESS_AI_ENRICHMENT_MODE: "after-select",
        AGENT_HARNESS_AI_ENRICHMENT_REQUIRE_SUCCESS_IN_CI: "true",
      },
      async () => {
        const result = await orchestrateAiEnrichment(root, {
          trigger: "after-select",
          explicitRequested: false,
          disableRequested: true,
          force: false,
          requireSuccess: true,
          ci: true,
        });

        assert.equal(result.outcome, "skipped");
        assert.equal(result.shouldFail, false);
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("automatic ai enrichment reuses cached output when inputs are unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-ai-enrichment-"));

  try {
    await writeDiscoveryInputs(root);

    await withEnv(
      {
        HOME: "/home/tester",
        AGENT_HARNESS_AI_ENRICHMENT_URL:
          "https://api.openai.com/v1/chat/completions",
        AGENT_HARNESS_AI_ENRICHMENT_API_KEY: "test-key",
        AGENT_HARNESS_AI_ENRICHMENT_MODE: "after-select",
      },
      async () => {
        const config = loadRuntimeConfig(process.env).aiEnrichment;
        const demandProfile = buildDemandProfile();
        const input = buildAiEnrichmentInputArtifact({
          config,
          demandProfile,
          demandProfileHash: buildDemandProfileFingerprint(demandProfile),
          selectedCatalogHash: await hashFile(
            root,
            "discover/output/catalog.selected.jsonl",
          ),
          selectedEntries: [
            buildCatalogEntry("asset-a", ["react", "typescript"]),
            buildCatalogEntry("asset-b", ["testing"]),
          ],
          trigger: "after-select",
          explicit: false,
          interactive: false,
          ci: false,
          configHash: buildAiEnrichmentConfigHash(config),
        });

        await writeJsonFile(
          join(root, "discover", "output", "ai-enrichment-input.json"),
          input,
        );
        await writeJsonFile(
          join(root, "discover", "output", "ai-enrichment.json"),
          {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            enabled: true,
            mode: "after-select",
            trigger: "after-select",
            explicit: false,
            interactive: false,
            ci: false,
            providerOrigin: "https://api.openai.com",
            model: config.model,
            status: "completed",
            inputSha256: input.fingerprints.inputSha256,
            fingerprints: {
              demandProfileSha256: input.fingerprints.demandProfileSha256,
              selectedCatalogSha256: input.fingerprints.selectedCatalogSha256,
              configSha256: input.fingerprints.configSha256,
            },
            summary: "Cached summary",
            recommendations: ["Cached recommendation"],
          },
        );

        const result = await orchestrateAiEnrichment(root, {
          trigger: "after-select",
          explicitRequested: false,
          disableRequested: false,
          force: false,
          requireSuccess: false,
        });

        assert.equal(result.outcome, "reused");
        const artifact = await readJsonFile(
          join(root, "discover", "output", "ai-enrichment.json"),
          assertAiEnrichmentReport,
        );
        assert.equal(artifact.status, "reused");
        assert.equal(artifact.summary, "Cached summary");
        assert.match(artifact.reason ?? "", /unchanged/u);
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("cached output is not reused when the prior artifact input hash mismatches", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-ai-enrichment-"));

  try {
    await writeDiscoveryInputs(root);

    await withEnv(
      {
        HOME: "/home/tester",
        AGENT_HARNESS_AI_ENRICHMENT_URL:
          "https://api.openai.com/v1/chat/completions",
        AGENT_HARNESS_AI_ENRICHMENT_API_KEY: "test-key",
        AGENT_HARNESS_AI_ENRICHMENT_MODE: "after-select",
      },
      async () => {
        const config = loadRuntimeConfig(process.env).aiEnrichment;
        const demandProfile = buildDemandProfile();
        const input = buildAiEnrichmentInputArtifact({
          config,
          demandProfile,
          demandProfileHash: buildDemandProfileFingerprint(demandProfile),
          selectedCatalogHash: await hashFile(
            root,
            "discover/output/catalog.selected.jsonl",
          ),
          selectedEntries: [
            buildCatalogEntry("asset-a", ["react", "typescript"]),
            buildCatalogEntry("asset-b", ["testing"]),
          ],
          trigger: "after-select",
          explicit: false,
          interactive: false,
          ci: false,
          configHash: buildAiEnrichmentConfigHash(config),
        });

        await writeJsonFile(
          join(root, "discover", "output", "ai-enrichment-input.json"),
          input,
        );
        await writeJsonFile(
          join(root, "discover", "output", "ai-enrichment.json"),
          {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            enabled: true,
            mode: "after-select",
            trigger: "after-select",
            explicit: false,
            interactive: false,
            ci: false,
            providerOrigin: "https://api.openai.com",
            model: config.model,
            status: "completed",
            inputSha256: "different-input-sha",
            fingerprints: {
              demandProfileSha256: input.fingerprints.demandProfileSha256,
              selectedCatalogSha256: input.fingerprints.selectedCatalogSha256,
              configSha256: input.fingerprints.configSha256,
            },
            summary: "Stale summary",
            recommendations: ["Stale recommendation"],
          },
        );

        const result = await orchestrateAiEnrichment(root, {
          trigger: "after-select",
          explicitRequested: false,
          disableRequested: false,
          force: false,
          requireSuccess: false,
        });

        assert.equal(result.outcome, "skipped");
        const artifact = await readJsonFile(
          join(root, "discover", "output", "ai-enrichment.json"),
          assertAiEnrichmentReport,
        );
        assert.equal(artifact.status, "skipped");
        assert.match(artifact.reason ?? "", /cooldown/u);
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("on-ambiguity mode writes a skipped artifact when deterministic outputs are confident", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-ai-enrichment-"));

  try {
    await writeDiscoveryInputs(root, {
      selectedEntries: [
        buildCatalogEntry("asset-react", ["react", "frontend", "typescript"]),
        buildCatalogEntry("asset-testing", ["testing", "jest", "react"]),
      ],
    });

    await withEnv(
      {
        HOME: "/home/tester",
        AGENT_HARNESS_AI_ENRICHMENT_URL:
          "https://api.openai.com/v1/chat/completions",
        AGENT_HARNESS_AI_ENRICHMENT_API_KEY: "test-key",
        AGENT_HARNESS_AI_ENRICHMENT_MODE: "on-ambiguity",
      },
      async () => {
        const result = await orchestrateAiEnrichment(root, {
          trigger: "after-select",
          explicitRequested: false,
          disableRequested: false,
          force: false,
          requireSuccess: false,
        });

        assert.equal(result.outcome, "skipped");
        const artifact = await readJsonFile(
          join(root, "discover", "output", "ai-enrichment.json"),
          assertAiEnrichmentReport,
        );
        assert.equal(artifact.status, "skipped");
        assert.match(artifact.reason ?? "", /on-ambiguity/u);
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("manual suggestion treats suggested commands as complete commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-ai-enrichment-"));

  try {
    await writeDiscoveryInputs(root);

    await withEnv(
      {
        HOME: "/home/tester",
        AGENT_HARNESS_AI_ENRICHMENT_URL:
          "https://api.openai.com/v1/chat/completions",
        AGENT_HARNESS_AI_ENRICHMENT_API_KEY: "test-key",
        AGENT_HARNESS_AI_ENRICHMENT_MODE: "manual",
      },
      async () => {
        const result = await orchestrateAiEnrichment(root, {
          trigger: "after-select",
          explicitRequested: false,
          disableRequested: false,
          force: false,
          requireSuccess: false,
          interactive: true,
          suggestedCommand: "'agent-harness discover full --ai-enrich'",
        });

        assert.equal(result.outcome, "suggested");
        assert.ok(result.note);
        const flagMatches = result.note.match(/--ai-enrich/gu) ?? [];
        assert.equal(flagMatches.length, 1);
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("on-ambiguity still evaluates ambiguity when earlier artifacts are reusable", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-ai-enrichment-"));

  try {
    await writeDiscoveryInputs(root, {
      selectedEntries: [
        buildCatalogEntry("asset-react", ["react", "frontend", "typescript"]),
        buildCatalogEntry("asset-testing", ["testing", "jest", "react"]),
      ],
    });

    await withEnv(
      {
        HOME: "/home/tester",
        AGENT_HARNESS_AI_ENRICHMENT_URL:
          "https://api.openai.com/v1/chat/completions",
        AGENT_HARNESS_AI_ENRICHMENT_API_KEY: "test-key",
        AGENT_HARNESS_AI_ENRICHMENT_MODE: "on-ambiguity",
      },
      async () => {
        const config = loadRuntimeConfig(process.env).aiEnrichment;
        const demandProfile = buildDemandProfile();
        const currentInput = buildAiEnrichmentInputArtifact({
          config,
          demandProfile,
          demandProfileHash: buildDemandProfileFingerprint(demandProfile),
          selectedCatalogHash: await hashFile(
            root,
            "discover/output/catalog.selected.jsonl",
          ),
          selectedEntries: [
            buildCatalogEntry("asset-react", [
              "react",
              "frontend",
              "typescript",
            ]),
            buildCatalogEntry("asset-testing", ["testing", "jest", "react"]),
          ],
          trigger: "after-select",
          explicit: false,
          interactive: false,
          ci: false,
          configHash: buildAiEnrichmentConfigHash(config),
        });

        await writeJsonFile(
          join(root, "discover", "output", "ai-enrichment-input.json"),
          {
            ...currentInput,
            fingerprints: {
              ...currentInput.fingerprints,
              inputSha256: "different-input-sha",
            },
          },
        );
        await writeJsonFile(
          join(root, "discover", "output", "ai-enrichment.json"),
          {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            enabled: true,
            mode: "on-ambiguity",
            trigger: "after-select",
            explicit: false,
            interactive: false,
            ci: false,
            providerOrigin: "https://api.openai.com",
            model: config.model,
            status: "completed",
            inputSha256: "different-input-sha",
            fingerprints: {
              demandProfileSha256:
                currentInput.fingerprints.demandProfileSha256,
              selectedCatalogSha256:
                currentInput.fingerprints.selectedCatalogSha256,
              configSha256: currentInput.fingerprints.configSha256,
            },
            summary: "Cached summary",
            recommendations: ["Cached recommendation"],
          },
        );

        const result = await orchestrateAiEnrichment(root, {
          trigger: "after-select",
          explicitRequested: false,
          disableRequested: false,
          force: false,
          requireSuccess: false,
        });

        assert.equal(result.outcome, "skipped");
        const artifact = await readJsonFile(
          join(root, "discover", "output", "ai-enrichment.json"),
          assertAiEnrichmentReport,
        );
        assert.equal(artifact.status, "skipped");
        assert.match(artifact.reason ?? "", /on-ambiguity/u);
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("on-input-change reuses cached output across demand-profile generatedAt churn", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-ai-enrichment-"));

  try {
    const demandProfile = buildDemandProfile();
    await writeDiscoveryInputs(root, { demandProfile });

    await withEnv(
      {
        HOME: "/home/tester",
        AGENT_HARNESS_AI_ENRICHMENT_URL:
          "https://api.openai.com/v1/chat/completions",
        AGENT_HARNESS_AI_ENRICHMENT_API_KEY: "test-key",
        AGENT_HARNESS_AI_ENRICHMENT_MODE: "on-input-change",
      },
      async () => {
        const config = loadRuntimeConfig(process.env).aiEnrichment;
        const selectedEntries = [
          buildCatalogEntry("asset-a", ["react", "typescript"]),
          buildCatalogEntry("asset-b", ["testing", "jest"]),
        ];
        const selectedCatalogHash = await hashFile(
          root,
          "discover/output/catalog.selected.jsonl",
        );
        const previousInput = buildAiEnrichmentInputArtifact({
          config,
          demandProfile,
          demandProfileHash: buildDemandProfileFingerprint(demandProfile),
          selectedCatalogHash,
          selectedEntries,
          trigger: "after-select",
          explicit: false,
          interactive: false,
          ci: false,
          configHash: buildAiEnrichmentConfigHash(config),
        });

        await writeJsonFile(
          join(root, "discover", "output", "ai-enrichment-input.json"),
          previousInput,
        );
        await writeJsonFile(
          join(root, "discover", "output", "ai-enrichment.json"),
          {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            enabled: true,
            mode: "on-input-change",
            trigger: "after-select",
            explicit: false,
            interactive: false,
            ci: false,
            providerOrigin: "https://api.openai.com",
            model: config.model,
            status: "completed",
            inputSha256: previousInput.fingerprints.inputSha256,
            fingerprints: {
              demandProfileSha256:
                previousInput.fingerprints.demandProfileSha256,
              selectedCatalogSha256:
                previousInput.fingerprints.selectedCatalogSha256,
              configSha256: previousInput.fingerprints.configSha256,
            },
            summary: "Cached summary",
            recommendations: ["Cached recommendation"],
          },
        );

        await writeJsonFile(
          join(root, "discover", "output", "demand-profile.json"),
          {
            ...demandProfile,
            generatedAt: new Date(Date.now() + 60_000).toISOString(),
          },
        );

        const result = await orchestrateAiEnrichment(root, {
          trigger: "after-select",
          explicitRequested: false,
          disableRequested: false,
          force: false,
          requireSuccess: false,
        });

        assert.equal(result.outcome, "reused");
        const artifact = await readJsonFile(
          join(root, "discover", "output", "ai-enrichment.json"),
          assertAiEnrichmentReport,
        );
        assert.equal(artifact.status, "reused");
        assert.match(artifact.reason ?? "", /unchanged/u);
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("discover rejects --no-ai-enrich with --require-ai-enrich", async () => {
  await assert.rejects(
    () =>
      runDiscover(
        ["select", "--no-ai-enrich", "--require-ai-enrich"],
        "C:/fixture/workspace",
        "C:/fixture/project",
      ),
    /--no-ai-enrich and --require-ai-enrich cannot be used together\./u,
  );
});

void test("workspace rejects --no-ai-enrich with --require-ai-enrich", async () => {
  await assert.rejects(
    () =>
      runWorkspace(
        ["vscode", "--no-ai-enrich", "--require-ai-enrich"],
        "C:/fixture/workspace",
        "C:/fixture/project",
      ),
    /--no-ai-enrich and --require-ai-enrich cannot be used together\./u,
  );
});

async function writeDiscoveryInputs(
  projectRoot: string,
  options: {
    demandProfile?: DemandProfile;
    selectedEntries?: AssetCatalogEntry[];
  } = {},
): Promise<void> {
  await writeJsonFile(
    join(projectRoot, "discover", "output", "demand-profile.json"),
    options.demandProfile ?? buildDemandProfile(),
  );
  await writeJsonLinesFile(
    join(projectRoot, "discover", "output", "catalog.selected.jsonl"),
    options.selectedEntries ?? [
      buildCatalogEntry("asset-a", ["react", "typescript"]),
      buildCatalogEntry("asset-b", ["testing", "jest"]),
    ],
  );
}

function buildDemandProfile(): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "C:/fixture",
    summary: {
      scannedFiles: 4,
      matchedFiles: 4,
    },
    signals: {
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: ["react"],
      concerns: ["frontend", "testing"],
      tooling: ["jest"],
    },
    evidence: [
      {
        path: "src/app.tsx",
        fileName: "app.tsx",
        evidenceStrength: "strong",
        matchedSignals: {
          languages: ["typescript"],
          packageManagers: [],
          frameworks: ["react"],
          concerns: ["frontend"],
          tooling: [],
        },
      },
      {
        path: "package.json",
        fileName: "package.json",
        evidenceStrength: "medium",
        matchedSignals: {
          languages: [],
          packageManagers: ["npm"],
          frameworks: [],
          concerns: ["testing"],
          tooling: ["jest"],
        },
      },
    ],
  };
}

function buildCatalogEntry(
  id: string,
  capabilities: string[],
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: "skill",
    hosts: ["copilot-vscode"],
    compatibilityMode: "native",
    source: {
      sourceId: `${id}-source`,
      authorityTier: "trusted-community",
      sourceKind: "repo",
      sourcePriority: 80,
      originUrl: `https://example.com/${id}`,
      publisher: `${id}-publisher`,
      publisherVerified: false,
    },
    trust: {
      score: 80,
      signals: ["authority:trusted-community"],
    },
    capabilities,
    install: {
      method: "local-file",
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
    },
    maintenance: {
      lastUpdated: new Date().toISOString(),
      stars: 0,
      releaseCadence: "test",
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
      portfolioFit: 0.95,
      hostFit: 0.95,
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

async function hashFile(
  projectRoot: string,
  relativePath: string,
): Promise<string> {
  const content = await readTextFileOrNull(
    join(projectRoot, ...relativePath.split("/")),
  );
  assert.ok(content);
  return createContentHash(content);
}

function buildAiEnrichmentConfigHash(
  config: ReturnType<typeof loadRuntimeConfig>["aiEnrichment"],
): string {
  return createContentHash(
    JSON.stringify({
      urlOrigin: config.url ? new URL(config.url).origin : undefined,
      url: config.url ? new URL(config.url).toString() : undefined,
      mode: config.mode,
      model: config.model,
      maxSelectedAssets: config.maxSelectedAssets,
      maxEvidenceItems: config.maxEvidenceItems,
      maxCapabilitiesPerAsset: config.maxCapabilitiesPerAsset,
      redactFilePaths: config.redactFilePaths,
      redactSourceIdentifiers: config.redactSourceIdentifiers,
      requestTimeoutMs: config.requestTimeoutMs,
      responseMaxBytes: config.responseMaxBytes,
    }),
  );
}

function buildDemandProfileFingerprint(
  demandProfile: DemandProfile | null,
): string | null {
  if (!demandProfile) {
    return null;
  }

  return createContentHash(
    JSON.stringify({
      schemaVersion: demandProfile.schemaVersion,
      signals: demandProfile.signals,
      evidence: demandProfile.evidence,
    }),
  );
}

async function withEnv(
  overrides: Record<string, string | undefined>,
  callback: () => Promise<void>,
): Promise<void> {
  const previousValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previousValues.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  clearRuntimeConfigForTests();

  try {
    await callback();
  } finally {
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearRuntimeConfigForTests();
  }
}
