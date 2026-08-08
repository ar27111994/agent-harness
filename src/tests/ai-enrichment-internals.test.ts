import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  aiEnrichmentInternals,
  analyzeAiEnrichmentAmbiguity,
  buildAiEnrichmentInputArtifact,
  orchestrateAiEnrichment,
  writeAiEnrichmentReport,
} from "../domains/discovery/ai-enrichment.js";
import {
  clearRuntimeConfigForTests,
  loadRuntimeConfig,
} from "../config/runtime.js";
import { readJsonFile, writeJsonFile, writeJsonLinesFile } from "../files.js";
import { restoreEnvVar } from "./env-test-utils.js";
import { assertAiEnrichmentReport } from "../manifest-validation.js";
import type { AssetCatalogEntry, DemandProfile } from "../types.js";

void test("ai enrichment helper exports build request messages and sanitize provider payloads", () => {
  const config = loadRuntimeConfig({
    HOME: "/home/tester",
    AGENT_HARNESS_AI_ENRICHMENT_MODE: "manual",
    AGENT_HARNESS_AI_ENRICHMENT_URL:
      "https://api.openai.com/v1/chat/completions",
    AGENT_HARNESS_AI_ENRICHMENT_API_KEY: "test-key",
  }).aiEnrichment;
  const input = buildAiEnrichmentInputArtifact({
    config,
    demandProfile: buildDemandProfile(),
    demandProfileHash: "demand-sha",
    selectedCatalogHash: "catalog-sha",
    selectedEntries: [buildCatalogEntry("asset-a", ["react", "testing"])],
    trigger: "manual",
    explicit: true,
    interactive: false,
    ci: false,
    configHash: "config-sha",
  });

  const messages = aiEnrichmentInternals.buildAiEnrichmentMessages(input);
  assert.equal(messages.length, 2);
  assert.match(messages[0]?.content ?? "", /Return JSON only\./u);
  assert.deepEqual(JSON.parse(messages[1]?.content ?? "{}"), {
    demandSignals: input.demandSignals,
    demandEvidence: input.demandEvidence,
    selectedAssets: input.selectedAssets,
    omissions: input.omissions,
    selectedAssetCount: input.selectedAssetCount,
    includedSelectedAssetCount: input.includedSelectedAssetCount,
  });

  const parsedTopLevel = aiEnrichmentInternals.parseAiEnrichmentResponse({
    summary: "  Tight\nsummary  ",
    recommendations: ["  Add tests  ", "Add tests", 4, ""],
    warnings: ["  Rate limit risk  ", "Rate limit risk"],
  });
  assert.deepEqual(parsedTopLevel, {
    summary: "Tight summary",
    recommendations: ["Add tests"],
    warnings: ["Rate limit risk"],
  });

  const parsedMessageBlocks = aiEnrichmentInternals.parseAiEnrichmentResponse({
    choices: [
      {
        message: {
          content: [
            {
              text: ' {"summary":"  Block summary  ","recommendations":[" First step ","First step"],"warnings":[" Watch logs "]} ',
            },
            { output_text: "   " },
          ],
        },
      },
    ],
  });
  assert.deepEqual(parsedMessageBlocks, {
    summary: "Block summary",
    recommendations: ["First step"],
    warnings: ["Watch logs"],
  });

  const parsedPlainText = aiEnrichmentInternals.parseAiEnrichmentResponse({
    choices: [
      {
        message: {
          output_text:
            "  Provider returned plain text guidance instead of JSON.  ",
        },
      },
    ],
  });
  assert.deepEqual(parsedPlainText, {
    summary: "Provider returned plain text guidance instead of JSON.",
    recommendations: [],
    warnings: [
      "Provider returned non-JSON enrichment content; stored the raw text as the summary.",
    ],
  });
});

void test("ai enrichment helper exports reject malformed provider responses and expose utility conversions", async () => {
  assert.throws(
    () => aiEnrichmentInternals.parseAiEnrichmentResponse(null),
    /not a JSON object/u,
  );
  assert.throws(
    () => aiEnrichmentInternals.parseAiEnrichmentResponse({ choices: [] }),
    /completion choices/u,
  );
  assert.throws(
    () => aiEnrichmentInternals.parseAiEnrichmentResponse({ choices: [{}] }),
    /completion message/u,
  );
  assert.throws(
    () =>
      aiEnrichmentInternals.parseAiEnrichmentResponse({
        choices: [{ message: { content: [{ ignored: true }] } }],
      }),
    /readable message content/u,
  );
  assert.throws(
    () => aiEnrichmentInternals.parseAiEnrichmentContent("   \n  "),
    /content was empty/u,
  );
  assert.throws(
    () => aiEnrichmentInternals.sanitizeAiEnrichmentContent({ summary: "   " }),
    /usable summary/u,
  );
  assert.throws(
    () => aiEnrichmentInternals.sanitizeAiEnrichmentContent("not-an-object"),
    /usable summary/u,
  );

  assert.equal(aiEnrichmentInternals.sanitizeSummary(42), "");
  assert.deepEqual(aiEnrichmentInternals.sanitizeStringList("nope", 2, 10), []);
  assert.deepEqual(aiEnrichmentInternals.asUnknownArray([1, 2]), [1, 2]);
  assert.equal(aiEnrichmentInternals.asUnknownArray({ length: 1 }), null);
  assert.deepEqual(aiEnrichmentInternals.asJsonObject({ ok: true }), {
    ok: true,
  });
  assert.equal(aiEnrichmentInternals.asJsonObject(["nope"]), null);

  assert.equal(aiEnrichmentInternals.buildDemandProfileFingerprint(null), null);
  assert.equal(
    aiEnrichmentInternals.normalizeConfiguredUrl(undefined),
    undefined,
  );
  assert.equal(
    aiEnrichmentInternals.normalizeConfiguredUrl(":not-a-url"),
    undefined,
  );
  assert.equal(
    aiEnrichmentInternals.extractProviderOrigin(undefined),
    undefined,
  );
  assert.equal(
    aiEnrichmentInternals.extractProviderOrigin("not-a-url"),
    undefined,
  );
  assert.equal(
    aiEnrichmentInternals.extractProviderOrigin(
      "https://api.openai.com/v1/chat/completions",
    ),
    "https://api.openai.com",
  );

  assert.equal(
    aiEnrichmentInternals.hasAiEnrichmentConfig({
      url: "https://api.openai.com/v1/chat/completions",
      apiKey: "key",
    } as never),
    true,
  );
  assert.equal(
    aiEnrichmentInternals.hasAiEnrichmentConfig({
      url: "https://api.openai.com/v1/chat/completions",
      apiKey: "",
    } as never),
    false,
  );
  assert.match(
    aiEnrichmentInternals.buildMissingAiEnrichmentConfigMessage({
      url: undefined,
      apiKey: undefined,
    } as never),
    /AI_ENRICHMENT_URL.*AI_ENRICHMENT_API_KEY/u,
  );
  assert.match(
    aiEnrichmentInternals.buildMissingAiEnrichmentConfigMessage({
      url: "https://api.openai.com/v1/chat/completions",
      apiKey: undefined,
    } as never),
    /AI_ENRICHMENT_API_KEY/u,
  );
  assert.equal(
    aiEnrichmentInternals.buildMissingAiEnrichmentConfigMessage({
      url: "https://api.openai.com/v1/chat/completions",
      apiKey: "test-key",
    } as never),
    "AI enrichment is disabled by configuration.",
  );

  assert.equal(
    aiEnrichmentInternals.shouldAutomaticallyRunAiEnrichment(
      "after-workspace",
      "after-workspace",
      false,
    ),
    true,
  );
  assert.equal(
    aiEnrichmentInternals.shouldAutomaticallyRunAiEnrichment(
      "on-input-change",
      "after-workspace",
      false,
    ),
    true,
  );
  assert.equal(
    aiEnrichmentInternals.shouldAutomaticallyRunAiEnrichment(
      "ci-only",
      "after-select",
      false,
    ),
    false,
  );
  assert.equal(
    aiEnrichmentInternals.shouldAutomaticallyRunAiEnrichment(
      "ci-only",
      "after-workspace",
      true,
    ),
    true,
  );
  assert.equal(
    aiEnrichmentInternals.shouldAutomaticallyRunAiEnrichment(
      "off",
      "after-select",
      true,
    ),
    false,
  );
  assert.equal(
    aiEnrichmentInternals.buildAiEnrichmentSuggestion({
      mode: "manual",
      hasConfig: true,
      interactive: false,
      selectedAssetCount: 1,
    }),
    undefined,
  );
  assert.match(
    aiEnrichmentInternals.buildAiEnrichmentSuggestion({
      mode: "manual",
      hasConfig: true,
      interactive: true,
      selectedAssetCount: 1,
      suggestedCommand: "agent-harness discover select --ai-enrich",
    }) ?? "",
    /discover select --ai-enrich/u,
  );
  assert.match(
    aiEnrichmentInternals.buildAiEnrichmentSuggestion({
      mode: "manual",
      hasConfig: true,
      interactive: true,
      selectedAssetCount: 1,
    }) ?? "",
    /this command with --ai-enrich/u,
  );

  assert.equal(
    aiEnrichmentInternals.isCiEnvironment({} as NodeJS.ProcessEnv),
    false,
  );
  assert.equal(
    aiEnrichmentInternals.isCiEnvironment({ CI: "false" } as NodeJS.ProcessEnv),
    false,
  );
  assert.equal(
    aiEnrichmentInternals.isCiEnvironment({ CI: "1" } as NodeJS.ProcessEnv),
    true,
  );

  let fetchAttemptCount = 0;
  const cleanupFetch = installFetchMock(async () => {
    fetchAttemptCount += 1;
    if (fetchAttemptCount === 1) {
      return jsonResponse(null);
    }
    return jsonResponse({
      summary: "Fetched summary",
      recommendations: ["Ship it"],
    });
  });

  try {
    const config = loadRuntimeConfig({
      HOME: "/home/tester",
      AGENT_HARNESS_AI_ENRICHMENT_MODE: "manual",
      AGENT_HARNESS_AI_ENRICHMENT_URL:
        "https://api.openai.com/v1/chat/completions",
      AGENT_HARNESS_AI_ENRICHMENT_API_KEY: "test-key",
      AGENT_HARNESS_AI_ENRICHMENT_RETRY_MAX_ATTEMPTS: "2",
      AGENT_HARNESS_AI_ENRICHMENT_RETRY_BACKOFF_MS: "1",
      AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS: "https://api.openai.com",
    }).aiEnrichment;

    const response = await aiEnrichmentInternals.fetchAiEnrichmentResponse(
      "https://api.openai.com/v1/chat/completions",
      config,
      {
        model: config.model,
        messages: [{ role: "user", content: "retry me" }],
      },
    );

    assert.deepEqual(response, {
      summary: "Fetched summary",
      recommendations: ["Ship it"],
    });

    fetchAttemptCount = 0;
    await assert.rejects(
      () =>
        aiEnrichmentInternals.fetchAiEnrichmentResponse(
          "https://api.openai.com/v1/chat/completions",
          {
            ...config,
            retryMaxAttempts: 1,
          },
          {
            model: config.model,
            messages: [{ role: "user", content: "fail permanently" }],
          },
        ),
      /empty or invalid JSON response/u,
    );

    await aiEnrichmentInternals.sleep(1);
    assert.equal(
      typeof aiEnrichmentInternals.isInteractiveTerminal(),
      "boolean",
    );
  } finally {
    cleanupFetch();
  }
});

void test("ai enrichment helper exports cover ambiguity and policy helper branches", () => {
  const config = loadRuntimeConfig({
    HOME: "/home/tester",
    AGENT_HARNESS_AI_ENRICHMENT_MODE: "on-input-change",
    AGENT_HARNESS_AI_ENRICHMENT_URL:
      "https://api.openai.com/v1/chat/completions",
    AGENT_HARNESS_AI_ENRICHMENT_API_KEY: "test-key",
    AGENT_HARNESS_AI_ENRICHMENT_AUTO_MIN_INTERVAL_MS: "60000",
  }).aiEnrichment;
  const input = buildAiEnrichmentInputArtifact({
    config,
    demandProfile: buildDemandProfile(),
    demandProfileHash: "demand-sha",
    selectedCatalogHash: "catalog-sha",
    selectedEntries: [
      buildCatalogEntry("asset-concern-a", ["frontend"]),
      buildCatalogEntry("asset-concern-b", ["frontend"]),
      buildCatalogEntry("asset-concern-c", ["frontend"]),
      buildCatalogEntry("asset-concern-d", ["frontend"]),
      buildCatalogEntry("asset-concern-e", ["frontend"]),
    ],
    trigger: "after-select",
    explicit: false,
    interactive: false,
    ci: true,
    configHash: "config-sha",
  });

  const ambiguityWithoutInputs = analyzeAiEnrichmentAmbiguity({
    demandProfile: null,
    selectedEntries: [],
  });
  assert.deepEqual(ambiguityWithoutInputs, {
    shouldRun: false,
    reasons: [],
    exactMatchDensity: 1,
    genericConcernOnlyCount: 0,
    nearTieCount: 0,
  });

  const ambiguous = analyzeAiEnrichmentAmbiguity({
    demandProfile: buildDemandProfile(),
    selectedEntries: [
      buildCatalogEntry("asset-concern-a", ["frontend"]),
      buildCatalogEntry("asset-concern-b", ["frontend"]),
      buildCatalogEntry("asset-concern-c", ["frontend"]),
      buildCatalogEntry("asset-concern-d", ["frontend"]),
      buildCatalogEntry("asset-near-tie", ["frontend", "backend"]),
    ].map((entry, index) => ({
      ...entry,
      fit: {
        portfolioFit: 0.91 - index * 0.01,
        hostFit: entry.fit.hostFit,
      },
    })),
  });
  assert.equal(ambiguous.shouldRun, true);
  assert.ok(
    ambiguous.reasons.some((reason) =>
      reason.includes("low exact-match density"),
    ),
  );
  assert.ok(
    ambiguous.reasons.some((reason) =>
      reason.includes("generic concern-only winners"),
    ),
  );
  assert.ok(
    ambiguous.reasons.some((reason) => reason.includes("near-tied selections")),
  );

  const cachedContext: Parameters<
    typeof aiEnrichmentInternals.buildCachedAiEnrichmentArtifact
  >[0] = {
    input,
    demandProfile: buildDemandProfile(),
    selectedEntries: [buildCatalogEntry("asset-a", ["react"])],
    previousInput: {
      fingerprints: { inputSha256: input.fingerprints.inputSha256 },
    } as never,
    previousArtifact: {
      generatedAt: new Date(Date.now() - 1_000).toISOString(),
      inputSha256: input.fingerprints.inputSha256,
      providerOrigin: "https://api.openai.com",
      summary: "Cached summary",
      recommendations: ["Cached recommendation"],
      warnings: ["Cached warning"],
      status: "completed",
    } as never,
  };

  const cached = aiEnrichmentInternals.buildCachedAiEnrichmentArtifact(
    cachedContext,
    true,
  );
  assert.equal(cached?.status, "reused");
  assert.equal(
    aiEnrichmentInternals.buildCachedAiEnrichmentArtifact(
      {
        ...cachedContext,
        previousArtifact: {
          ...cachedContext.previousArtifact!,
          status: "reused",
        } as never,
      },
      true,
    )?.status,
    "reused",
  );
  assert.equal(
    aiEnrichmentInternals.buildCachedAiEnrichmentArtifact(cachedContext, false),
    null,
  );

  const unchangedSkip = aiEnrichmentInternals.evaluateAutomaticPolicySkip(
    "on-input-change",
    config,
    cachedContext,
    false,
  );
  assert.match(unchangedSkip?.reason ?? "", /inputs have not changed/u);

  const cooldownContext: Parameters<
    typeof aiEnrichmentInternals.evaluateAutomaticPolicySkip
  >[2] = {
    ...cachedContext,
    previousInput: null,
    previousArtifact: cachedContext.previousArtifact!,
  };
  const cooldownSkip = aiEnrichmentInternals.evaluateAutomaticPolicySkip(
    "after-select",
    config,
    cooldownContext,
    true,
  );
  assert.match(cooldownSkip?.reason ?? "", /cooldown window/u);
  assert.deepEqual(cooldownSkip?.warnings, [
    "Automatic mode cooldown: 60000ms",
  ]);

  const ciCooldownWithoutCache =
    aiEnrichmentInternals.evaluateAutomaticPolicySkip(
      "after-select",
      { ...config, allowCacheInCi: false },
      cooldownContext,
      true,
    );
  assert.deepEqual(ciCooldownWithoutCache?.warnings, [
    "Automatic mode cooldown: 60000ms",
    "CI cache reuse is disabled for this run.",
  ]);

  const noSkipContext: Parameters<
    typeof aiEnrichmentInternals.evaluateAutomaticPolicySkip
  >[2] = {
    ...cachedContext,
    previousInput: null,
    previousArtifact: null,
  };
  assert.equal(
    aiEnrichmentInternals.evaluateAutomaticPolicySkip(
      "after-select",
      { ...config, autoMinIntervalMs: 0 },
      noSkipContext,
      false,
    ),
    null,
  );

  assert.deepEqual(
    aiEnrichmentInternals.sanitizeStringList(
      [" first ", "second", "third", "second"],
      2,
      20,
    ),
    ["first", "second"],
  );

  const originalStdoutIsTty = process.stdout.isTTY;
  const originalStderrIsTty = process.stderr.isTTY;
  try {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true,
    });
    assert.equal(aiEnrichmentInternals.isInteractiveTerminal(), true);
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: false,
    });
    assert.equal(aiEnrichmentInternals.isInteractiveTerminal(), false);
  } finally {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: originalStdoutIsTty,
    });
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: originalStderrIsTty,
    });
  }
});

void test("ai enrichment reuses cached outputs in CI when cache reuse is allowed", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-ai-enrichment-"));
  let requestCount = 0;
  const cleanupFetch = installFetchMock(async () => {
    requestCount += 1;
    return jsonResponse({
      summary: "Cached summary",
      recommendations: ["Keep the cached result"],
      warnings: [],
    });
  });

  try {
    await writeDiscoveryInputs(root);

    await withEnv(
      {
        HOME: "/home/tester",
        AGENT_HARNESS_AI_ENRICHMENT_URL:
          "https://api.openai.com/v1/chat/completions",
        AGENT_HARNESS_AI_ENRICHMENT_API_KEY: "test-key",
        AGENT_HARNESS_AI_ENRICHMENT_MODE: "after-select",
        AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS: "https://api.openai.com",
        AGENT_HARNESS_AI_ENRICHMENT_ALLOW_CACHE_IN_CI: "true",
      },
      async () => {
        const completed = await orchestrateAiEnrichment(root, {
          trigger: "after-select",
          explicitRequested: false,
          disableRequested: false,
          force: false,
          requireSuccess: true,
          ci: true,
        });
        const reused = await orchestrateAiEnrichment(root, {
          trigger: "after-select",
          explicitRequested: false,
          disableRequested: false,
          force: false,
          requireSuccess: true,
          ci: true,
        });

        assert.equal(completed.outcome, "completed");
        assert.equal(reused.outcome, "reused");
        assert.equal(reused.artifact?.summary, "Cached summary");
        assert.equal(requestCount, 1);
      },
    );
  } finally {
    cleanupFetch();
    await rm(root, { recursive: true, force: true });
  }
});

void test("ai enrichment writes a failed artifact when provider parsing exhausts retries", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-ai-enrichment-"));
  const cleanupFetch = installFetchMock(async () => jsonResponse(null));

  try {
    await writeDiscoveryInputs(root);

    await withEnv(
      {
        HOME: "/home/tester",
        AGENT_HARNESS_AI_ENRICHMENT_URL:
          "https://api.openai.com/v1/chat/completions",
        AGENT_HARNESS_AI_ENRICHMENT_API_KEY: "test-key",
        AGENT_HARNESS_AI_ENRICHMENT_MODE: "after-select",
        AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS: "https://api.openai.com",
        AGENT_HARNESS_AI_ENRICHMENT_RETRY_MAX_ATTEMPTS: "1",
      },
      async () => {
        const failed = await orchestrateAiEnrichment(root, {
          trigger: "after-select",
          explicitRequested: false,
          disableRequested: false,
          force: true,
          requireSuccess: true,
        });

        assert.equal(failed.outcome, "failed");
        assert.equal(failed.shouldFail, true);
        assert.match(failed.artifact?.error ?? "", /empty or invalid JSON/u);
      },
    );
  } finally {
    cleanupFetch();
    await rm(root, { recursive: true, force: true });
  }
});

void test("ai enrichment can return not-requested and skip empty selections before network work", async () => {
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
        const notRequested = await orchestrateAiEnrichment(root, {
          trigger: "after-select",
          explicitRequested: false,
          disableRequested: false,
          force: false,
          requireSuccess: false,
          interactive: false,
        });

        assert.equal(notRequested.outcome, "not-requested");
        await assert.rejects(
          () =>
            readFile(
              join(root, "discover", "output", "ai-enrichment-input.json"),
              "utf8",
            ),
          /ENOENT/u,
        );
      },
    );

    await writeJsonLinesFile(
      join(root, "discover", "output", "catalog.selected.jsonl"),
      [],
    );

    await withEnv(
      {
        HOME: "/home/tester",
        AGENT_HARNESS_AI_ENRICHMENT_URL:
          "https://api.openai.com/v1/chat/completions",
        AGENT_HARNESS_AI_ENRICHMENT_API_KEY: "test-key",
        AGENT_HARNESS_AI_ENRICHMENT_MODE: "manual",
      },
      async () => {
        const skipped = await orchestrateAiEnrichment(root, {
          trigger: "manual",
          explicitRequested: true,
          disableRequested: false,
          force: false,
          requireSuccess: true,
        });

        assert.equal(skipped.outcome, "skipped");
        assert.equal(skipped.shouldFail, true);
        assert.match(skipped.artifact?.reason ?? "", /no selected assets/u);
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("writeAiEnrichmentReport performs the explicit manual enrichment flow", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-ai-enrichment-"));
  const cleanupFetch = installFetchMock(async () =>
    jsonResponse({
      choices: [
        {
          message: {
            content:
              '{"summary":"  Final summary  ","recommendations":[" Add docs "],"warnings":[" Keep prompts small "]}',
          },
        },
      ],
    }),
  );

  try {
    await writeDiscoveryInputs(root);

    await withEnv(
      {
        HOME: "/home/tester",
        AGENT_HARNESS_AI_ENRICHMENT_URL:
          "https://api.openai.com/v1/chat/completions",
        AGENT_HARNESS_AI_ENRICHMENT_API_KEY: "test-key",
        AGENT_HARNESS_AI_ENRICHMENT_MODE: "manual",
        AGENT_HARNESS_AI_ENRICHMENT_ALLOWED_ORIGINS: "https://api.openai.com",
      },
      async () => {
        await writeAiEnrichmentReport(root);

        const artifact = await readJsonFile(
          join(root, "discover", "output", "ai-enrichment.json"),
          assertAiEnrichmentReport,
        );

        assert.equal(artifact.status, "completed");
        assert.equal(artifact.summary, "Final summary");
        assert.deepEqual(artifact.recommendations, ["Add docs"]);
        assert.deepEqual(artifact.warnings, ["Keep prompts small"]);
      },
    );
  } finally {
    cleanupFetch();
    await rm(root, { recursive: true, force: true });
  }
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

function installFetchMock(
  responder: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response> | Response,
): () => void {
  const originalFetch = globalThis.fetch;
  const previousFetchMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";

  globalThis.fetch = async (input, init) => responder(input, init);

  return () => {
    globalThis.fetch = originalFetch;
    if (previousFetchMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
      return;
    }
    restoreEnvVar("AGENT_HARNESS_TEST_FETCH_MOCKS", previousFetchMockFlag);
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
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
