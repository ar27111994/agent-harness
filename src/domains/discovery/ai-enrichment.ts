import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { getRuntimeConfig } from "../../config/runtime.js";
import {
  createContentHash,
  ensureDirectory,
  readJsonFileOrNull,
  readJsonLinesFile,
  readTextFileOrNull,
  toPosixPath,
} from "../../files.js";
import {
  assertAllowedPublicHttpUrlWithDns,
  fetchJsonWithGuards,
} from "../../lib/http.js";
import {
  assertAiEnrichmentInput,
  assertAiEnrichmentReport,
  assertAssetCatalogEntry,
  assertDemandProfile,
} from "../../manifest-validation.js";
import type {
  AiEnrichmentInput,
  AiEnrichmentInputSelectedAsset,
  AiEnrichmentMode,
  AiEnrichmentReport,
  AiEnrichmentStatus,
  AiEnrichmentTrigger,
  AssetCatalogEntry,
  DemandProfile,
} from "../../types.js";

const INPUT_PATH = ["discover", "output", "ai-enrichment-input.json"] as const;
const OUTPUT_PATH = ["discover", "output", "ai-enrichment.json"] as const;
const DEMAND_PROFILE_PATH = [
  "discover",
  "output",
  "demand-profile.json",
] as const;
const SELECTED_CATALOG_PATH = [
  "discover",
  "output",
  "catalog.selected.jsonl",
] as const;
const MAX_SUMMARY_LENGTH = 4_000;
const MAX_RECOMMENDATION_COUNT = 20;
const MAX_RECOMMENDATION_LENGTH = 300;
const MAX_WARNING_COUNT = 12;
const MAX_WARNING_LENGTH = 240;
const PRETTY_JSON_INDENT_SPACES = 2;
const REDACTED_IDENTIFIER_HASH_LENGTH = 12;
const NEAR_TIE_SELECTION_SAMPLE_SIZE = 8;
const AMBIGUITY_GENERIC_CONCERN_DIVISOR = 2;
const AMBIGUITY_EXACT_MATCH_DENSITY_THRESHOLD = 0.35;
const AMBIGUITY_GENERIC_ONLY_COUNT_THRESHOLD = 3;
const AMBIGUITY_NEAR_TIE_DELTA_THRESHOLD = 0.05;
const AMBIGUITY_NEAR_TIE_COUNT_THRESHOLD = 3;

interface AiEnrichmentRequestOptions {
  trigger: AiEnrichmentTrigger;
  explicitRequested: boolean;
  disableRequested: boolean;
  force: boolean;
  requireSuccess: boolean;
  interactive?: boolean;
  ci?: boolean;
  suggestedCommand?: string;
}

interface AiEnrichmentRequestContext {
  input: AiEnrichmentInput;
  selectedEntries: AssetCatalogEntry[];
  demandProfile: DemandProfile | null;
  previousInput: AiEnrichmentInput | null;
  previousArtifact: AiEnrichmentReport | null;
}

interface AiEnrichmentProviderResponse {
  summary: string;
  recommendations: string[];
  warnings: string[];
}

/**
 * Describes the orchestration result produced by AI enrichment policy/application.
 */
export interface AiEnrichmentOrchestrationResult {
  outcome: AiEnrichmentStatus | "not-requested" | "suggested";
  shouldFail: boolean;
  note?: string;
  input?: AiEnrichmentInput;
  artifact?: AiEnrichmentReport;
}

/**
 * Describes deterministic ambiguity analysis used by `on-ambiguity` mode.
 */
export interface AiEnrichmentAmbiguityResult {
  shouldRun: boolean;
  reasons: string[];
  exactMatchDensity: number;
  genericConcernOnlyCount: number;
  nearTieCount: number;
}

/**
 * Evaluates the current enrichment policy and, when applicable, writes bounded
 * input/output artifacts for manual, semi-automatic, and automatic flows.
 */
export async function orchestrateAiEnrichment(
  projectRoot: string,
  options: AiEnrichmentRequestOptions,
): Promise<AiEnrichmentOrchestrationResult> {
  const runtimeConfig = getRuntimeConfig();
  const config = runtimeConfig.aiEnrichment;
  const inputPath = join(projectRoot, ...INPUT_PATH);
  const outputPath = join(projectRoot, ...OUTPUT_PATH);
  const outputDirectory = toPosixPath(join(projectRoot, "discover", "output"));
  const interactive = options.interactive ?? isInteractiveTerminal();
  const ci = options.ci ?? isCiEnvironment(runtimeConfig.env);
  const requireSuccess =
    options.requireSuccess || (ci && config.requireSuccessInCi);
  const demandProfile = await readJsonFileOrNull<DemandProfile>(
    join(projectRoot, ...DEMAND_PROFILE_PATH),
    assertDemandProfile,
  );
  const selectedEntries = await readJsonLinesFile<AssetCatalogEntry>(
    join(projectRoot, ...SELECTED_CATALOG_PATH),
    assertAssetCatalogEntry,
  );
  const demandProfileHash = buildDemandProfileFingerprint(demandProfile);
  const selectedCatalogHash = await hashFileOrNull(
    join(projectRoot, ...SELECTED_CATALOG_PATH),
  );
  const configHash = buildAiEnrichmentConfigHash(config);
  const input = buildAiEnrichmentInputArtifact({
    config,
    demandProfile,
    demandProfileHash,
    selectedCatalogHash,
    selectedEntries,
    trigger: options.trigger,
    explicit: options.explicitRequested,
    interactive,
    ci,
    configHash,
  });
  const previousInput = await readJsonFileOrNull<AiEnrichmentInput>(
    inputPath,
    assertAiEnrichmentInput,
  );
  const previousArtifact = await readJsonFileOrNull<AiEnrichmentReport>(
    outputPath,
    assertAiEnrichmentReport,
  );
  const requestContext: AiEnrichmentRequestContext = {
    input,
    selectedEntries,
    demandProfile,
    previousInput,
    previousArtifact,
  };
  const automaticRequested = shouldAutomaticallyRunAiEnrichment(
    config.mode,
    options.trigger,
    ci,
  );

  if (
    !options.explicitRequested &&
    !options.disableRequested &&
    !automaticRequested
  ) {
    const suggestion = buildAiEnrichmentSuggestion({
      mode: config.mode,
      hasConfig: hasAiEnrichmentConfig(config),
      interactive,
      selectedAssetCount: selectedEntries.length,
      suggestedCommand: options.suggestedCommand,
    });
    if (suggestion) {
      return {
        outcome: "suggested",
        shouldFail: false,
        note: suggestion,
      };
    }

    return {
      outcome: "not-requested",
      shouldFail: false,
    };
  }

  await writeJsonFileAtomically(inputPath, input);

  if (options.disableRequested) {
    const artifact = buildAiEnrichmentArtifact({
      input,
      enabled: hasAiEnrichmentConfig(config),
      status: "skipped",
      reason: "AI enrichment was explicitly disabled for this run.",
    });
    await writeJsonFileAtomically(outputPath, artifact);
    return {
      outcome: artifact.status,
      artifact,
      input,
      shouldFail: false,
      note: `AI enrichment skipped; artifacts written under ${outputDirectory}`,
    };
  }

  if (selectedEntries.length === 0) {
    const artifact = buildAiEnrichmentArtifact({
      input,
      enabled: hasAiEnrichmentConfig(config),
      status: "skipped",
      reason:
        "AI enrichment was skipped because discover/output/catalog.selected.jsonl contains no selected assets.",
    });
    await writeJsonFileAtomically(outputPath, artifact);
    return {
      outcome: artifact.status,
      artifact,
      input,
      shouldFail: requireSuccess,
      note: `AI enrichment skipped; artifacts written under ${outputDirectory}`,
    };
  }

  if (!hasAiEnrichmentConfig(config)) {
    const artifact = buildAiEnrichmentArtifact({
      input,
      enabled: false,
      status: "disabled",
      reason: buildMissingAiEnrichmentConfigMessage(config),
      warnings: [buildMissingAiEnrichmentConfigMessage(config)],
    });
    await writeJsonFileAtomically(outputPath, artifact);
    return {
      outcome: artifact.status,
      artifact,
      input,
      shouldFail: requireSuccess,
      note: `AI enrichment disabled; artifacts written under ${outputDirectory}`,
    };
  }

  if (!options.force) {
    const reusedArtifact = buildCachedAiEnrichmentArtifact(
      requestContext,
      shouldAllowAiEnrichmentCache(config.allowCacheInCi, ci),
    );
    if (reusedArtifact) {
      await writeJsonFileAtomically(outputPath, reusedArtifact);
      return {
        outcome: reusedArtifact.status,
        artifact: reusedArtifact,
        input,
        shouldFail: false,
        note: `AI enrichment reused cached output; artifacts written under ${outputDirectory}`,
      };
    }
  }

  if (!options.explicitRequested && automaticRequested && !options.force) {
    const policySkipArtifact = evaluateAutomaticPolicySkip(
      config.mode,
      config,
      requestContext,
      ci,
    );
    if (policySkipArtifact) {
      await writeJsonFileAtomically(outputPath, policySkipArtifact);
      return {
        outcome: policySkipArtifact.status,
        artifact: policySkipArtifact,
        input,
        shouldFail: requireSuccess,
        note: `AI enrichment skipped; artifacts written under ${outputDirectory}`,
      };
    }
  }

  try {
    const url = await assertAllowedPublicHttpUrlWithDns(
      config.url!,
      config.allowedOrigins,
    );
    const response = await fetchAiEnrichmentResponse(url.toString(), config, {
      model: config.model,
      messages: buildAiEnrichmentMessages(input),
    });
    const parsedResponse = parseAiEnrichmentResponse(response);
    const artifact = buildAiEnrichmentArtifact({
      input,
      enabled: true,
      status: "completed",
      providerOrigin: url.origin,
      summary: parsedResponse.summary,
      recommendations: parsedResponse.recommendations,
      warnings: parsedResponse.warnings,
    });
    await writeJsonFileAtomically(outputPath, artifact);

    return {
      outcome: artifact.status,
      artifact,
      input,
      shouldFail: false,
      note: `AI enrichment completed; artifacts written under ${outputDirectory}`,
    };
  } catch (error) {
    const artifact = buildAiEnrichmentArtifact({
      input,
      enabled: true,
      status: "failed",
      error: toAiEnrichmentErrorMessage(error),
    });
    await writeJsonFileAtomically(outputPath, artifact);
    return {
      outcome: artifact.status,
      artifact,
      input,
      shouldFail: requireSuccess,
      note: `AI enrichment failed; artifacts written under ${outputDirectory}`,
    };
  }
}

/**
 * Builds the bounded enrichment input artifact used for cache/freshness checks
 * and request inspection.
 */
export function buildAiEnrichmentInputArtifact(options: {
  config: ReturnType<typeof getRuntimeConfig>["aiEnrichment"];
  demandProfile: DemandProfile | null;
  demandProfileHash: string | null;
  selectedCatalogHash: string | null;
  selectedEntries: AssetCatalogEntry[];
  trigger: AiEnrichmentTrigger;
  explicit: boolean;
  interactive: boolean;
  ci: boolean;
  configHash: string;
}): AiEnrichmentInput {
  const { config, demandProfile, selectedEntries } = options;
  let omittedCapabilityValues = 0;
  const selectedAssets = selectedEntries
    .slice(0, config.maxSelectedAssets)
    .map<AiEnrichmentInputSelectedAsset>((entry) => {
      const capabilities = entry.capabilities.slice(
        0,
        config.maxCapabilitiesPerAsset,
      );
      omittedCapabilityValues += Math.max(
        0,
        entry.capabilities.length - capabilities.length,
      );

      return {
        id: entry.id,
        displayName: entry.displayName,
        assetKind: entry.assetKind,
        hosts: entry.hosts,
        authorityTier: entry.source.authorityTier,
        sourceId: config.redactSourceIdentifiers
          ? redactIdentifier(entry.source.sourceId)
          : entry.source.sourceId,
        capabilities,
      };
    });
  const demandEvidence = (demandProfile?.evidence ?? [])
    .slice(0, config.maxEvidenceItems)
    .map((evidence) => ({
      fileName: evidence.fileName,
      path: config.redactFilePaths
        ? redactIdentifier(evidence.path)
        : evidence.path,
      evidenceStrength: evidence.evidenceStrength,
      matchedSignals: {
        languages: [...evidence.matchedSignals.languages],
        packageManagers: [...evidence.matchedSignals.packageManagers],
        frameworks: [...evidence.matchedSignals.frameworks],
        concerns: [...evidence.matchedSignals.concerns],
        tooling: [...evidence.matchedSignals.tooling],
      },
    }));
  const inputFingerprint = createContentHash(
    JSON.stringify({
      demandProfileSha256: options.demandProfileHash,
      selectedCatalogSha256: options.selectedCatalogHash,
      configSha256: options.configHash,
    }),
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: config.mode,
    trigger: options.trigger,
    explicit: options.explicit,
    interactive: options.interactive,
    ci: options.ci,
    model: config.model,
    providerOrigin: extractProviderOrigin(config.url),
    selectedAssetCount: selectedEntries.length,
    includedSelectedAssetCount: selectedAssets.length,
    evidenceItemCount: demandProfile?.evidence.length ?? 0,
    includedEvidenceItemCount: demandEvidence.length,
    omissions: {
      selectedAssets: Math.max(
        0,
        selectedEntries.length - selectedAssets.length,
      ),
      evidenceItems: Math.max(
        0,
        (demandProfile?.evidence.length ?? 0) - demandEvidence.length,
      ),
      capabilityValues: omittedCapabilityValues,
      sourceIdentifiersRedacted: config.redactSourceIdentifiers,
      filePathsRedacted: config.redactFilePaths,
    },
    fingerprints: {
      demandProfileSha256: options.demandProfileHash,
      selectedCatalogSha256: options.selectedCatalogHash,
      configSha256: options.configHash,
      inputSha256: inputFingerprint,
    },
    demandSignals: demandProfile
      ? {
          languages: [...demandProfile.signals.languages],
          packageManagers: [...demandProfile.signals.packageManagers],
          frameworks: [...demandProfile.signals.frameworks],
          concerns: [...demandProfile.signals.concerns],
          tooling: [...demandProfile.signals.tooling],
        }
      : null,
    demandEvidence,
    selectedAssets,
  };
}

/**
 * Computes deterministic ambiguity heuristics for the current discovery output.
 */
export function analyzeAiEnrichmentAmbiguity(options: {
  demandProfile: DemandProfile | null;
  selectedEntries: AssetCatalogEntry[];
}): AiEnrichmentAmbiguityResult {
  const { demandProfile, selectedEntries } = options;
  if (!demandProfile || selectedEntries.length === 0) {
    return {
      shouldRun: false,
      reasons: [],
      exactMatchDensity: 1,
      genericConcernOnlyCount: 0,
      nearTieCount: 0,
    };
  }

  const exactDemandTerms = buildNormalizedTermSet([
    ...demandProfile.signals.frameworks,
    ...demandProfile.signals.packageManagers,
    ...demandProfile.signals.tooling,
  ]);
  const concernTerms = buildNormalizedTermSet(demandProfile.signals.concerns);
  let exactMatchCount = 0;
  let genericConcernOnlyCount = 0;

  for (const entry of selectedEntries) {
    const entryTerms = buildEntryTermSet(entry);
    const hasExactMatch = intersects(entryTerms, exactDemandTerms);
    const hasConcernMatch = intersects(entryTerms, concernTerms);

    if (hasExactMatch) {
      exactMatchCount += 1;
    }
    if (!hasExactMatch && hasConcernMatch) {
      genericConcernOnlyCount += 1;
    }
  }

  const exactMatchDensity = exactMatchCount / selectedEntries.length;
  const nearTieCount = countNearTieSelections(selectedEntries);
  const reasons: string[] = [];

  if (exactMatchDensity < AMBIGUITY_EXACT_MATCH_DENSITY_THRESHOLD) {
    reasons.push(
      `low exact-match density (${exactMatchCount}/${selectedEntries.length})`,
    );
  }
  if (
    genericConcernOnlyCount >=
    Math.max(
      AMBIGUITY_GENERIC_ONLY_COUNT_THRESHOLD,
      Math.ceil(selectedEntries.length / AMBIGUITY_GENERIC_CONCERN_DIVISOR),
    )
  ) {
    reasons.push(
      `too many generic concern-only winners (${genericConcernOnlyCount}/${selectedEntries.length})`,
    );
  }
  if (nearTieCount >= AMBIGUITY_NEAR_TIE_COUNT_THRESHOLD) {
    reasons.push(`too many near-tied selections (${nearTieCount})`);
  }

  return {
    shouldRun: reasons.length > 0,
    reasons,
    exactMatchDensity,
    genericConcernOnlyCount,
    nearTieCount,
  };
}

function shouldAutomaticallyRunAiEnrichment(
  mode: AiEnrichmentMode,
  trigger: AiEnrichmentTrigger,
  ci: boolean,
): boolean {
  switch (mode) {
    case "after-select":
      return trigger === "after-select";
    case "after-workspace":
      return trigger === "after-workspace";
    case "on-ambiguity":
    case "on-input-change":
      return trigger === "after-select" || trigger === "after-workspace";
    case "ci-only":
      return (
        ci && (trigger === "after-select" || trigger === "after-workspace")
      );
    case "manual":
    case "off":
    default:
      return false;
  }
}

function buildAiEnrichmentSuggestion(options: {
  mode: AiEnrichmentMode;
  hasConfig: boolean;
  interactive: boolean;
  selectedAssetCount: number;
  suggestedCommand?: string;
}): string | undefined {
  if (
    !options.interactive ||
    !options.hasConfig ||
    options.selectedAssetCount === 0 ||
    options.mode !== "manual"
  ) {
    return undefined;
  }

  return `AI enrichment is configured but stays manual by default. Re-run ${options.suggestedCommand ?? "this command with --ai-enrich"} or use 'agent-harness discover enrich'.`;
}

function evaluateAutomaticPolicySkip(
  mode: AiEnrichmentMode,
  config: ReturnType<typeof getRuntimeConfig>["aiEnrichment"],
  context: AiEnrichmentRequestContext,
  ci: boolean,
): AiEnrichmentReport | null {
  if (mode === "on-ambiguity") {
    const ambiguity = analyzeAiEnrichmentAmbiguity({
      demandProfile: context.demandProfile,
      selectedEntries: context.selectedEntries,
    });
    if (!ambiguity.shouldRun) {
      return buildAiEnrichmentArtifact({
        input: context.input,
        enabled: true,
        status: "skipped",
        reason:
          "Automatic AI enrichment did not run because deterministic selection did not meet the on-ambiguity trigger.",
        warnings: undefined,
      });
    }
  }

  if (
    mode === "on-input-change" &&
    context.previousInput?.fingerprints.inputSha256 ===
      context.input.fingerprints.inputSha256
  ) {
    return buildAiEnrichmentArtifact({
      input: context.input,
      enabled: true,
      status: "skipped",
      reason:
        "Automatic AI enrichment did not run because the enrichment inputs have not changed.",
    });
  }

  if (
    config.autoMinIntervalMs > 0 &&
    context.previousArtifact &&
    context.previousArtifact.status !== "skipped" &&
    context.previousArtifact.status !== "disabled" &&
    Date.now() - Date.parse(context.previousArtifact.generatedAt) <
      config.autoMinIntervalMs
  ) {
    return buildAiEnrichmentArtifact({
      input: context.input,
      enabled: true,
      status: "skipped",
      reason:
        "Automatic AI enrichment did not run because the automatic cooldown window is still active.",
      warnings: [
        `Automatic mode cooldown: ${config.autoMinIntervalMs}ms`,
        ...(ci && !config.allowCacheInCi
          ? ["CI cache reuse is disabled for this run."]
          : []),
      ],
    });
  }

  return null;
}

function buildCachedAiEnrichmentArtifact(
  context: AiEnrichmentRequestContext,
  allowCacheReuse: boolean,
): AiEnrichmentReport | null {
  if (!allowCacheReuse) {
    return null;
  }

  if (
    context.previousInput?.fingerprints.inputSha256 !==
      context.input.fingerprints.inputSha256 ||
    !isReusableAiEnrichmentArtifact(context.previousArtifact) ||
    context.previousArtifact.inputSha256 !==
      context.input.fingerprints.inputSha256
  ) {
    return null;
  }

  return buildAiEnrichmentArtifact({
    input: context.input,
    enabled: true,
    status: "reused",
    providerOrigin: context.previousArtifact.providerOrigin,
    summary: context.previousArtifact.summary,
    recommendations: context.previousArtifact.recommendations,
    warnings: context.previousArtifact.warnings,
    reason:
      "Reused the previous AI enrichment output because the inputs are unchanged.",
    reusedFromGeneratedAt: context.previousArtifact.generatedAt,
  });
}

function isReusableAiEnrichmentArtifact(
  artifact: AiEnrichmentReport | null,
): artifact is AiEnrichmentReport {
  return Boolean(
    artifact &&
    (artifact.status === "completed" || artifact.status === "reused"),
  );
}

function buildAiEnrichmentArtifact(options: {
  input: AiEnrichmentInput;
  enabled: boolean;
  status: AiEnrichmentStatus;
  providerOrigin?: string;
  summary?: string;
  recommendations?: string[];
  warnings?: string[];
  reason?: string;
  error?: string;
  reusedFromGeneratedAt?: string;
}): AiEnrichmentReport {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    enabled: options.enabled,
    mode: options.input.mode,
    trigger: options.input.trigger,
    explicit: options.input.explicit,
    interactive: options.input.interactive,
    ci: options.input.ci,
    providerOrigin: options.providerOrigin ?? options.input.providerOrigin,
    model: options.input.model,
    status: options.status,
    inputSha256: options.input.fingerprints.inputSha256,
    fingerprints: {
      demandProfileSha256: options.input.fingerprints.demandProfileSha256,
      selectedCatalogSha256: options.input.fingerprints.selectedCatalogSha256,
      configSha256: options.input.fingerprints.configSha256,
    },
    summary: options.summary,
    recommendations: options.recommendations,
    warnings: options.warnings,
    reason: options.reason,
    error: options.error,
    reusedFromGeneratedAt: options.reusedFromGeneratedAt,
  };
}

function buildMissingAiEnrichmentConfigMessage(
  config: ReturnType<typeof getRuntimeConfig>["aiEnrichment"],
): string {
  const missingSettings: string[] = [];
  if (!config.url) {
    missingSettings.push("AGENT_HARNESS_AI_ENRICHMENT_URL");
  }
  if (!config.apiKey) {
    missingSettings.push("AGENT_HARNESS_AI_ENRICHMENT_API_KEY");
  }

  return missingSettings.length === 0
    ? "AI enrichment is disabled by configuration."
    : `AI enrichment is disabled. Set ${missingSettings.join(" and ")} to enable it.`;
}

function hasAiEnrichmentConfig(
  config: ReturnType<typeof getRuntimeConfig>["aiEnrichment"],
): boolean {
  return Boolean(config.url && config.apiKey);
}

function buildAiEnrichmentConfigHash(
  config: ReturnType<typeof getRuntimeConfig>["aiEnrichment"],
): string {
  return createContentHash(
    JSON.stringify({
      urlOrigin: extractProviderOrigin(config.url),
      url: normalizeConfiguredUrl(config.url),
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

function buildAiEnrichmentMessages(
  input: AiEnrichmentInput,
): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: [
        "You are reviewing deterministic agent-harness discovery outputs.",
        "Return JSON only.",
        "Provide a concise summary plus actionable next recommendations.",
        "Do not mutate ranking or invent assets that are not present in the selected asset list.",
        "Schema:",
        JSON.stringify({
          summary: "brief synthesis",
          recommendations: ["actionable recommendation"],
          warnings: ["optional caveat"],
        }),
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        demandSignals: input.demandSignals,
        demandEvidence: input.demandEvidence,
        selectedAssets: input.selectedAssets,
        omissions: input.omissions,
        selectedAssetCount: input.selectedAssetCount,
        includedSelectedAssetCount: input.includedSelectedAssetCount,
      }),
    },
  ];
}

async function fetchAiEnrichmentResponse(
  url: string,
  config: ReturnType<typeof getRuntimeConfig>["aiEnrichment"],
  body: {
    model: string;
    messages: Array<{ role: "system" | "user"; content: string }>;
  },
): Promise<unknown> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < config.retryMaxAttempts; attempt += 1) {
    try {
      const response = await fetchJsonWithGuards(url, {
        allowedOrigins: config.allowedOrigins,
        body: JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        maxBytes: config.responseMaxBytes,
        method: "POST",
        timeoutMs: config.requestTimeoutMs,
      });
      if (response === null) {
        throw new Error(
          "AI enrichment request returned an empty or invalid JSON response.",
        );
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt === config.retryMaxAttempts - 1) {
        break;
      }
      if (config.retryBackoffMs > 0) {
        await sleep(config.retryBackoffMs * (attempt + 1));
      }
    }
  }

  throw lastError;
}

function parseAiEnrichmentResponse(
  response: unknown,
): AiEnrichmentProviderResponse {
  const responseRecord = asJsonObject(response);
  if (responseRecord && typeof responseRecord.summary === "string") {
    return sanitizeAiEnrichmentContent(responseRecord);
  }

  const content = extractAiEnrichmentMessageContent(response);
  return parseAiEnrichmentContent(content);
}

function extractAiEnrichmentMessageContent(response: unknown): string {
  const responseRecord = asJsonObject(response);
  if (!responseRecord) {
    throw new Error("AI enrichment response was not a JSON object.");
  }

  const choices = asUnknownArray(responseRecord.choices);
  if (!choices || choices.length === 0) {
    throw new Error(
      "AI enrichment response did not include any completion choices.",
    );
  }

  const firstChoice = asJsonObject(choices[0]);
  const message = asJsonObject(firstChoice?.message);
  if (!message) {
    throw new Error(
      "AI enrichment response did not include a completion message.",
    );
  }

  if (
    typeof message.content === "string" &&
    message.content.trim().length > 0
  ) {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    const textParts = message.content
      .map((block) => asJsonObject(block))
      .filter((block): block is Record<string, unknown> => block !== null)
      .flatMap((block) => {
        if (typeof block.text === "string") {
          return [block.text];
        }
        if (typeof block.output_text === "string") {
          return [block.output_text];
        }
        return [];
      })
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    if (textParts.length > 0) {
      return textParts.join("\n");
    }
  }

  if (typeof message.output_text === "string" && message.output_text.trim()) {
    return message.output_text;
  }

  throw new Error(
    "AI enrichment response did not include any readable message content.",
  );
}

function parseAiEnrichmentContent(
  content: string,
): AiEnrichmentProviderResponse {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    throw new Error("AI enrichment response content was empty.");
  }

  try {
    const parsed = JSON.parse(trimmedContent) as unknown;
    return sanitizeAiEnrichmentContent(parsed);
  } catch {
    return {
      summary: sanitizeSummary(trimmedContent),
      recommendations: [],
      warnings: [
        "Provider returned non-JSON enrichment content; stored the raw text as the summary.",
      ],
    };
  }
}

function sanitizeAiEnrichmentContent(
  value: unknown,
): AiEnrichmentProviderResponse {
  const record = asJsonObject(value) ?? {};
  const summary = sanitizeSummary(record.summary);
  const recommendations = sanitizeStringList(
    record.recommendations,
    MAX_RECOMMENDATION_COUNT,
    MAX_RECOMMENDATION_LENGTH,
  );
  const warnings = sanitizeStringList(
    record.warnings,
    MAX_WARNING_COUNT,
    MAX_WARNING_LENGTH,
  );

  if (!summary) {
    throw new Error(
      "AI enrichment response JSON did not include a usable summary.",
    );
  }

  return {
    summary,
    recommendations,
    warnings,
  };
}

function sanitizeSummary(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.slice(0, MAX_SUMMARY_LENGTH);
}

function sanitizeStringList(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: string[] = [];
  const seenValues = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const normalized = entry.replace(/\s+/gu, " ").trim().slice(0, maxLength);
    if (!normalized || seenValues.has(normalized)) {
      continue;
    }

    seenValues.add(normalized);
    entries.push(normalized);
    if (entries.length >= maxItems) {
      break;
    }
  }

  return entries;
}

async function writeJsonFileAtomically(
  filePath: string,
  value: unknown,
): Promise<void> {
  await ensureDirectory(dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(
    tempPath,
    `${JSON.stringify(value, null, PRETTY_JSON_INDENT_SPACES)}\n`,
    "utf8",
  );
  await rename(tempPath, filePath);
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

async function hashFileOrNull(filePath: string): Promise<string | null> {
  const content = await readTextFileOrNull(filePath);
  return content === null ? null : createContentHash(content);
}

function normalizeConfiguredUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
}

function extractProviderOrigin(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function redactIdentifier(value: string): string {
  return `sha256-${createContentHash(value).slice(0, REDACTED_IDENTIFIER_HASH_LENGTH)}`;
}

function buildNormalizedTermSet(values: readonly string[]): Set<string> {
  const terms = new Set<string>();

  for (const value of values) {
    for (const token of tokenize(value)) {
      terms.add(token);
    }
  }

  return terms;
}

function buildEntryTermSet(entry: AssetCatalogEntry): Set<string> {
  return buildNormalizedTermSet([
    entry.id,
    entry.displayName,
    entry.source.sourceId,
    ...entry.capabilities,
  ]);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 1);
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
}

function countNearTieSelections(entries: AssetCatalogEntry[]): number {
  const rankedFits = entries
    .map((entry) => entry.fit.portfolioFit)
    .sort((left, right) => right - left)
    .slice(0, NEAR_TIE_SELECTION_SAMPLE_SIZE);
  let nearTieCount = 0;

  for (let index = 1; index < rankedFits.length; index += 1) {
    const previousFit = rankedFits[index - 1];
    const currentFit = rankedFits[index];
    if (
      previousFit !== undefined &&
      currentFit !== undefined &&
      Math.abs(previousFit - currentFit) <= AMBIGUITY_NEAR_TIE_DELTA_THRESHOLD
    ) {
      nearTieCount += 1;
    }
  }

  return nearTieCount;
}

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdout.isTTY && process.stderr.isTTY);
}

function isCiEnvironment(env: NodeJS.ProcessEnv): boolean {
  const normalizedValue = env.CI?.trim().toLowerCase();
  return (
    normalizedValue !== undefined &&
    normalizedValue !== "" &&
    normalizedValue !== "0" &&
    normalizedValue !== "false"
  );
}

function asUnknownArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? Array.from<unknown>(value) : null;
}

function asJsonObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toAiEnrichmentErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shouldAllowAiEnrichmentCache(
  allowCacheInCi: boolean,
  ci: boolean,
): boolean {
  return allowCacheInCi || !ci;
}

/**
 * Narrow internal surface for deterministic helper coverage.
 *
 * These helpers stay module-local implementation details for production flows,
 * but are exported so tests can exercise parser/sanitizer branches without
 * having to tunnel every case through the network orchestration path.
 */
export const aiEnrichmentInternals = {
  buildDemandProfileFingerprint,
  buildAiEnrichmentMessages,
  buildCachedAiEnrichmentArtifact,
  buildMissingAiEnrichmentConfigMessage,
  buildAiEnrichmentSuggestion,
  evaluateAutomaticPolicySkip,
  extractAiEnrichmentMessageContent,
  extractProviderOrigin,
  fetchAiEnrichmentResponse,
  hasAiEnrichmentConfig,
  isCiEnvironment,
  isInteractiveTerminal,
  normalizeConfiguredUrl,
  parseAiEnrichmentContent,
  parseAiEnrichmentResponse,
  sanitizeAiEnrichmentContent,
  sanitizeStringList,
  sanitizeSummary,
  shouldAutomaticallyRunAiEnrichment,
  sleep,
  shouldAllowAiEnrichmentCache,
  toAiEnrichmentErrorMessage,
  asJsonObject,
  asUnknownArray,
};

/**
 * Preserves the original low-level explicit enrichment entrypoint for programmatic callers.
 */
export async function writeAiEnrichmentReport(
  projectRoot: string,
): Promise<void> {
  await orchestrateAiEnrichment(projectRoot, {
    trigger: "manual",
    explicitRequested: true,
    disableRequested: false,
    force: false,
    requireSuccess: false,
  });
}

async function sleep(timeMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, timeMs);
  });
}
