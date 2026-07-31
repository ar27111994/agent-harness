import { SESSION_INTENTS } from "../lib/session-intent.js";
import type {
  RecommendationHostPolicyOverride,
  RecommendationPolicy,
  RecommendationPolicyBase,
  RecommendationPolicyBaseOverride,
  RecommendationReport,
} from "../types.js";
import {
  ASSET_KINDS,
  assertArray,
  assertBoolean,
  assertHostTarget,
  assertLiteral,
  assertMaybeArray,
  assertMaybeNumber,
  assertMaybeRecord,
  assertMaybeString,
  assertMaybeStringArray,
  assertNumber,
  assertRecord,
  assertString,
  assertStringArray,
  assertStringArrayRecord,
  CONTEXT_COST_CLASSES,
  fail,
  HOST_TARGETS,
  type JsonRecord,
} from "./primitives.js";

/**
 * Validates a single RecommendationEntry record.
 * Shared by topByHost and the flat recommendations[] validator so both enforce
 * the same full shape rather than just {assetId, score}.
 */
function assertRecommendationEntry(entry: unknown, context: string): void {
  const entryRecord = assertRecord(entry, context);
  assertString(entryRecord.assetId, `${context}.assetId`);
  assertHostTarget(entryRecord.host, `${context}.host`);
  assertNumber(entryRecord.rank, `${context}.rank`);
  // globalRank is optional — present only in the flat recommendations[] list.
  if (Object.prototype.hasOwnProperty.call(entryRecord, "globalRank")) {
    assertNumber(entryRecord.globalRank, `${context}.globalRank`);
  }
  assertNumber(entryRecord.score, `${context}.score`);
  assertStringArray(entryRecord.reasons, `${context}.reasons`);
  if (Object.prototype.hasOwnProperty.call(entryRecord, "assetKind")) {
    assertLiteral(entryRecord.assetKind, ASSET_KINDS, `${context}.assetKind`);
  }
  if (
    Object.prototype.hasOwnProperty.call(
      entryRecord,
      "classificationConfidence",
    )
  ) {
    assertNumber(
      entryRecord.classificationConfidence,
      `${context}.classificationConfidence`,
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(
      entryRecord,
      "classificationConfidenceLevel",
    )
  ) {
    assertLiteral(
      entryRecord.classificationConfidenceLevel,
      ["strong", "medium", "weak"],
      `${context}.classificationConfidenceLevel`,
    );
  }
  assertString(entryRecord.sourceId, `${context}.sourceId`);
  assertString(entryRecord.sourceFamily, `${context}.sourceFamily`);
  if (Object.prototype.hasOwnProperty.call(entryRecord, "availableLocally")) {
    assertBoolean(entryRecord.availableLocally, `${context}.availableLocally`);
  } else {
    entryRecord.availableLocally = false;
  }
  if (
    Object.prototype.hasOwnProperty.call(entryRecord, "recommendationBasis")
  ) {
    assertLiteral(
      entryRecord.recommendationBasis,
      ["workspace-fit", "local-availability"],
      `${context}.recommendationBasis`,
    );
  } else {
    entryRecord.recommendationBasis = "workspace-fit";
  }
  assertLiteral(
    entryRecord.contextSizeClass,
    [...CONTEXT_COST_CLASSES],
    `${context}.contextSizeClass`,
  );
  assertNumber(
    entryRecord.estimatedPromptWeight,
    `${context}.estimatedPromptWeight`,
  );
  assertLiteral(
    entryRecord.selectionStage,
    ["top-by-host"],
    `${context}.selectionStage`,
  );
  assertStringArray(entryRecord.coverageTags, `${context}.coverageTags`);
  assertStringArray(entryRecord.taskModes, `${context}.taskModes`);
  assertArray(entryRecord.matchedSignals, `${context}.matchedSignals`).forEach(
    (signal, signalIndex) => {
      const signalRecord = assertRecord(
        signal,
        `${context}.matchedSignals[${signalIndex}]`,
      );
      assertString(
        signalRecord.term,
        `${context}.matchedSignals[${signalIndex}].term`,
      );
      assertString(
        signalRecord.signalType,
        `${context}.matchedSignals[${signalIndex}].signalType`,
      );
      assertNumber(
        signalRecord.weight,
        `${context}.matchedSignals[${signalIndex}].weight`,
      );
      assertNumber(
        signalRecord.evidenceCount,
        `${context}.matchedSignals[${signalIndex}].evidenceCount`,
      );
    },
  );
  assertRecommendationScoreBreakdown(
    entryRecord.scoreBreakdown,
    `${context}.scoreBreakdown`,
  );
}

/**
 * Validates unknown data as recommendation report.
 */
export function assertRecommendationReport(
  value: unknown,
  context: string,
): asserts value is RecommendationReport {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertNumber(record.policyVersion, `${context}.policyVersion`);
  if (Object.prototype.hasOwnProperty.call(record, "sessionIntent")) {
    assertLiteral(
      record.sessionIntent,
      [...SESSION_INTENTS],
      `${context}.sessionIntent`,
    );
  } else {
    record.sessionIntent = "general";
  }
  if (Object.prototype.hasOwnProperty.call(record, "sessionIntents")) {
    const sessionIntents = assertArray(
      record.sessionIntents,
      `${context}.sessionIntents`,
    );
    if (sessionIntents.length <= 1) {
      fail(
        `${context}.sessionIntents`,
        "must contain at least two intents when present",
      );
    }
    sessionIntents.forEach((v, i) => {
      assertLiteral(v, [...SESSION_INTENTS], `${context}.sessionIntents[${i}]`);
    });
    if (sessionIntents[0] !== record.sessionIntent) {
      fail(
        `${context}.sessionIntents[0]`,
        "must match sessionIntent when sessionIntents is present",
      );
    }
  }
  const topByHost = assertRecord(record.topByHost, `${context}.topByHost`);

  for (const expectedHost of HOST_TARGETS) {
    if (!Object.prototype.hasOwnProperty.call(topByHost, expectedHost)) {
      fail(`${context}.topByHost`, `missing expected host: ${expectedHost}`);
    }
  }

  Object.entries(topByHost).forEach(([host, entries]) => {
    assertArray(entries, `${context}.topByHost.${host}`).forEach(
      (entry, index) => {
        assertRecommendationEntry(
          entry,
          `${context}.topByHost.${host}[${index}]`,
        );
      },
    );
  });

  const hostSummaries = assertRecord(
    record.hostSummaries,
    `${context}.hostSummaries`,
  );

  for (const expectedHost of HOST_TARGETS) {
    if (!Object.prototype.hasOwnProperty.call(hostSummaries, expectedHost)) {
      fail(
        `${context}.hostSummaries`,
        `missing expected host: ${expectedHost}`,
      );
    }
  }

  Object.entries(hostSummaries).forEach(([host, summary]) => {
    const summaryRecord = assertRecord(
      summary,
      `${context}.hostSummaries.${host}`,
    );
    assertHostTarget(
      summaryRecord.host,
      `${context}.hostSummaries.${host}.host`,
    );
    assertNumber(
      summaryRecord.recommendationLimit,
      `${context}.hostSummaries.${host}.recommendationLimit`,
    );
    assertLiteral(
      summaryRecord.recommendationLimitSource,
      ["policy", "env"],
      `${context}.hostSummaries.${host}.recommendationLimitSource`,
    );
    assertMaybeString(
      summaryRecord.recommendationLimitEnvVar,
      `${context}.hostSummaries.${host}.recommendationLimitEnvVar`,
      false,
    );
    if (
      Object.prototype.hasOwnProperty.call(
        summaryRecord,
        "recommendationLimitOverrideMode",
      )
    ) {
      assertLiteral(
        summaryRecord.recommendationLimitOverrideMode,
        ["preserve", "scale"],
        `${context}.hostSummaries.${host}.recommendationLimitOverrideMode`,
      );
    } else {
      summaryRecord.recommendationLimitOverrideMode = "preserve";
    }
    if (
      Object.prototype.hasOwnProperty.call(
        summaryRecord,
        "recommendationLimitOverrideModeSource",
      )
    ) {
      assertLiteral(
        summaryRecord.recommendationLimitOverrideModeSource,
        ["policy", "env"],
        `${context}.hostSummaries.${host}.recommendationLimitOverrideModeSource`,
      );
    } else {
      summaryRecord.recommendationLimitOverrideModeSource = "policy";
    }
    assertMaybeString(
      summaryRecord.recommendationLimitOverrideModeEnvVar,
      `${context}.hostSummaries.${host}.recommendationLimitOverrideModeEnvVar`,
      false,
    );
    assertMaybeNumber(
      summaryRecord.recommendationLimitScaleFactor,
      `${context}.hostSummaries.${host}.recommendationLimitScaleFactor`,
      false,
    );
    assertMaybeStringArray(
      summaryRecord.recommendationLimitScaledFields,
      `${context}.hostSummaries.${host}.recommendationLimitScaledFields`,
      false,
    );
    assertNumber(
      summaryRecord.activationBudget,
      `${context}.hostSummaries.${host}.activationBudget`,
    );
    assertNumber(
      summaryRecord.selectedCount,
      `${context}.hostSummaries.${host}.selectedCount`,
    );
    assertNumber(
      summaryRecord.totalEstimatedPromptWeight,
      `${context}.hostSummaries.${host}.totalEstimatedPromptWeight`,
    );
    assertStringArray(
      summaryRecord.selectedAssetIds,
      `${context}.hostSummaries.${host}.selectedAssetIds`,
    );
    assertRecord(
      summaryRecord.byAssetKind,
      `${context}.hostSummaries.${host}.byAssetKind`,
    );
    assertRecord(
      summaryRecord.bySourceFamily,
      `${context}.hostSummaries.${host}.bySourceFamily`,
    );
    assertRecord(
      summaryRecord.byConcern,
      `${context}.hostSummaries.${host}.byConcern`,
    );
    assertStringArrayRecord(
      summaryRecord.concernBuckets,
      `${context}.hostSummaries.${host}.concernBuckets`,
    );
    assertStringArrayRecord(
      summaryRecord.taskModeBuckets,
      `${context}.hostSummaries.${host}.taskModeBuckets`,
    );
  });

  assertArray(record.suggestedBundles, `${context}.suggestedBundles`).forEach(
    (bundle, index) => {
      const bundleRecord = assertRecord(
        bundle,
        `${context}.suggestedBundles[${index}]`,
      );
      assertHostTarget(
        bundleRecord.host,
        `${context}.suggestedBundles[${index}].host`,
      );
      assertString(
        bundleRecord.bundleId,
        `${context}.suggestedBundles[${index}].bundleId`,
      );
      assertStringArray(
        bundleRecord.assetIds,
        `${context}.suggestedBundles[${index}].assetIds`,
      );
      assertNumber(
        bundleRecord.estimatedPromptWeight,
        `${context}.suggestedBundles[${index}].estimatedPromptWeight`,
      );
      assertMaybeNumber(
        bundleRecord.activationBudget,
        `${context}.suggestedBundles[${index}].activationBudget`,
        false,
      );
      assertMaybeStringArray(
        bundleRecord.budgetPrunedAssetIds,
        `${context}.suggestedBundles[${index}].budgetPrunedAssetIds`,
        false,
      );
      const budgetPrunedAssets = assertMaybeArray(
        bundleRecord.budgetPrunedAssets,
        `${context}.suggestedBundles[${index}].budgetPrunedAssets`,
        false,
      );
      if (budgetPrunedAssets) {
        budgetPrunedAssets.forEach((asset, assetIndex) => {
          const assetRecord = assertRecord(
            asset,
            `${context}.suggestedBundles[${index}].budgetPrunedAssets[${assetIndex}]`,
          );
          assertString(
            assetRecord.assetId,
            `${context}.suggestedBundles[${index}].budgetPrunedAssets[${assetIndex}].assetId`,
          );
          assertNumber(
            assetRecord.estimatedPromptWeight,
            `${context}.suggestedBundles[${index}].budgetPrunedAssets[${assetIndex}].estimatedPromptWeight`,
          );
          assertNumber(
            assetRecord.remainingBudget,
            `${context}.suggestedBundles[${index}].budgetPrunedAssets[${assetIndex}].remainingBudget`,
          );
          assertString(
            assetRecord.reason,
            `${context}.suggestedBundles[${index}].budgetPrunedAssets[${assetIndex}].reason`,
          );
        });
      }
      assertStringArrayRecord(
        bundleRecord.concernBuckets,
        `${context}.suggestedBundles[${index}].concernBuckets`,
      );
      assertStringArrayRecord(
        bundleRecord.taskModeBuckets,
        `${context}.suggestedBundles[${index}].taskModeBuckets`,
      );
    },
  );

  // Validate the flat deduplicated recommendations list.
  // The field is required on new reports; absent on legacy reports loaded
  // from disk is tolerated with an empty default so activate.ts can read
  // pre-v2.0.0 state files gracefully. New writes must always include this
  // key (asserted by write-path tests). See: #283.
  const rawRecommendations = Object.prototype.hasOwnProperty.call(
    record,
    "recommendations",
  )
    ? assertArray(record.recommendations, `${context}.recommendations`)
    : [];
  rawRecommendations.forEach((entry, index) => {
    // Use the full entry validator (same shape as topByHost entries) so the
    // flat recommendations list is held to the same schema as topByHost.
    assertRecommendationEntry(entry, `${context}.recommendations[${index}]`);
  });
  if (!Object.prototype.hasOwnProperty.call(record, "recommendations")) {
    record.recommendations = [];
  }
}

/**
 * Validates unknown data as recommendation policy.
 */
export function assertRecommendationPolicy(
  value: unknown,
  context: string,
): asserts value is RecommendationPolicy {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertRecommendationScoring(record.scoring, `${context}.scoring`);

  const hosts = assertRecord(record.hosts, `${context}.hosts`);
  HOST_TARGETS.forEach((host) => {
    if (!Object.prototype.hasOwnProperty.call(hosts, host)) {
      fail(`${context}.hosts`, `missing expected host: ${host}`);
    }
  });
  Object.entries(hosts).forEach(([host, hostPolicy]) => {
    assertHostTarget(host, `${context}.hosts.${host}`);
    assertRecommendationHostPolicy(
      hostPolicy,
      `${context}.hosts.${host}`,
      false,
    );
  });

  assertRecommendationKeywordMaps(record, context);
}

/**
 * Validates unknown data as recommendation policy base.
 */
export function assertRecommendationPolicyBase(
  value: unknown,
  context: string,
): asserts value is RecommendationPolicyBase {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertRecommendationScoring(record.scoring, `${context}.scoring`);
  if (record.hostDefaults !== undefined) {
    assertRecommendationHostPolicy(
      record.hostDefaults,
      `${context}.hostDefaults`,
      true,
    );
  }
  if (record.presets !== undefined) {
    assertRecommendationPolicyPresets(record.presets, `${context}.presets`);
  }

  assertRecommendationKeywordMaps(record, context);
}

/**
 * Validates unknown data as recommendation policy base override.
 */
export function assertRecommendationPolicyBaseOverride(
  value: unknown,
  context: string,
): asserts value is RecommendationPolicyBaseOverride {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  if (record.scoring !== undefined) {
    assertRecommendationScoring(record.scoring, `${context}.scoring`);
  }
  if (record.hostDefaults !== undefined) {
    assertRecommendationHostPolicy(
      record.hostDefaults,
      `${context}.hostDefaults`,
      true,
    );
  }
  if (record.presets !== undefined) {
    assertRecommendationPolicyPresets(record.presets, `${context}.presets`);
  }

  assertOptionalRecommendationKeywordMaps(record, context);
}

/**
 * Validates unknown data as recommendation host policy override.
 */
export function assertRecommendationHostPolicyOverride(
  value: unknown,
  context: string,
): asserts value is RecommendationHostPolicyOverride {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertHostTarget(record.host, `${context}.host`);
  if (record.presetRefs !== undefined) {
    assertRecommendationPolicyPresetRefs(
      record.presetRefs,
      `${context}.presetRefs`,
    );
  }
  assertRecommendationHostPolicy(record.policy, `${context}.policy`, true);
}

function assertRecommendationScoring(value: unknown, context: string): void {
  const scoring = assertRecord(value, context);
  assertNumber(scoring.demandMatchCap, `${context}.demandMatchCap`);
  assertNumber(
    scoring.portfolioFitMultiplier,
    `${context}.portfolioFitMultiplier`,
  );
  assertNumber(scoring.trustDivisor, `${context}.trustDivisor`);
  assertNumber(
    scoring.sourcePriorityDivisor,
    `${context}.sourcePriorityDivisor`,
  );
  assertRecord(scoring.authorityWeights, `${context}.authorityWeights`);
  assertRecord(scoring.compatibilityWeights, `${context}.compatibilityWeights`);
  assertRecord(scoring.costPenalties, `${context}.costPenalties`);
  assertRecord(scoring.demandSignalWeights, `${context}.demandSignalWeights`);
  assertRecord(scoring.riskLevelPenalties, `${context}.riskLevelPenalties`);
  const riskFlags = assertRecord(
    scoring.riskFlagPenalties,
    `${context}.riskFlagPenalties`,
  );
  assertNumber(riskFlags.hasHooks, `${context}.riskFlagPenalties.hasHooks`);
  assertNumber(
    riskFlags.hasExecScripts,
    `${context}.riskFlagPenalties.hasExecScripts`,
  );
  assertNumber(
    riskFlags.requiresNetwork,
    `${context}.riskFlagPenalties.requiresNetwork`,
  );
  const freshness = assertRecord(scoring.freshness, `${context}.freshness`);
  assertNumber(freshness.recentDays, `${context}.freshness.recentDays`);
  assertNumber(freshness.recentBoost, `${context}.freshness.recentBoost`);
  assertNumber(freshness.staleDays, `${context}.freshness.staleDays`);
  assertNumber(freshness.stalePenalty, `${context}.freshness.stalePenalty`);
  assertNumber(freshness.unknownPenalty, `${context}.freshness.unknownPenalty`);
  assertNumber(
    scoring.genericCapabilityPenalty,
    `${context}.genericCapabilityPenalty`,
  );
  assertNumber(
    scoring.lowFitPenaltyThreshold,
    `${context}.lowFitPenaltyThreshold`,
  );
  assertNumber(scoring.lowFitPenalty, `${context}.lowFitPenalty`);
  assertNumber(scoring.weakDemandPenalty, `${context}.weakDemandPenalty`);
  assertNumber(
    scoring.outOfDomainGroupPenalty,
    `${context}.outOfDomainGroupPenalty`,
  );
  // Inject default 0 for pre-v2.0.0 policy files that predate this field
  if (scoring.ecosystemMismatchPenalty === undefined) {
    scoring.ecosystemMismatchPenalty = 0;
  }
  assertNumber(
    scoring.ecosystemMismatchPenalty,
    `${context}.ecosystemMismatchPenalty`,
  );
  assertNumber(scoring.coverageGainWeight, `${context}.coverageGainWeight`);
  assertNumber(scoring.sourceDiversityBonus, `${context}.sourceDiversityBonus`);
  assertNumber(
    scoring.assetKindDiversityPenalty,
    `${context}.assetKindDiversityPenalty`,
  );
  assertNumber(scoring.overlapPenalty, `${context}.overlapPenalty`);
  assertRecord(
    scoring.demandTermMultipliers,
    `${context}.demandTermMultipliers`,
  );
}

function assertRecommendationHostPolicy(
  value: unknown,
  context: string,
  partial: boolean,
): void {
  const record = assertRecord(value, context);
  const required = !partial;

  assertMaybeNumber(
    record.recommendationLimit,
    `${context}.recommendationLimit`,
    required,
  );
  assertMaybeNumber(
    record.activationBudget,
    `${context}.activationBudget`,
    required,
  );
  assertMaybeString(
    record.suggestedBundleId,
    `${context}.suggestedBundleId`,
    required,
  );
  assertMaybeString(
    record.recommendationLimitOverrideMode,
    `${context}.recommendationLimitOverrideMode`,
    false,
  );
  if (
    record.recommendationLimitOverrideMode !== undefined &&
    record.recommendationLimitOverrideMode !== "preserve" &&
    record.recommendationLimitOverrideMode !== "scale"
  ) {
    throw new Error(
      `${context}.recommendationLimitOverrideMode must be one of: preserve, scale`,
    );
  }
  assertMaybeNumber(
    record.recommendationLimitScaleFactor,
    `${context}.recommendationLimitScaleFactor`,
    false,
  );
  assertMaybeStringArray(
    record.recommendationLimitScaledFields,
    `${context}.recommendationLimitScaledFields`,
    false,
  );
  assertMaybeNumber(
    record.fallbackSkillCount,
    `${context}.fallbackSkillCount`,
    false,
  );
  assertMaybeNumber(
    record.maxPerSourceFamily,
    `${context}.maxPerSourceFamily`,
    required,
  );
  assertMaybeNumber(
    record.maxPerDuplicateGroup,
    `${context}.maxPerDuplicateGroup`,
    required,
  );
  assertMaybeRecord(
    record.maxPerAssetKind,
    `${context}.maxPerAssetKind`,
    required,
  );

  const targetAssetKinds = assertMaybeArray(
    record.targetAssetKinds,
    `${context}.targetAssetKinds`,
    required,
  );
  if (targetAssetKinds) {
    assertRecommendationTargetAssetKinds(
      targetAssetKinds,
      `${context}.targetAssetKinds`,
    );
  }

  const targetConcerns = assertMaybeArray(
    record.targetConcerns,
    `${context}.targetConcerns`,
    required,
  );
  if (targetConcerns) {
    assertRecommendationTargetConcerns(
      targetConcerns,
      `${context}.targetConcerns`,
    );
  }

  assertMaybeStringArray(
    record.suppressedAssetIdPatterns,
    `${context}.suppressedAssetIdPatterns`,
    required,
  );
  assertMaybeStringArray(
    record.suppressedCapabilityTerms,
    `${context}.suppressedCapabilityTerms`,
    required,
  );
  assertMaybeNumber(
    record.deprioritizedPenalty,
    `${context}.deprioritizedPenalty`,
    false,
  );
  assertMaybeStringArray(
    record.deprioritizedAssetIdPatterns,
    `${context}.deprioritizedAssetIdPatterns`,
    false,
  );
  assertMaybeStringArray(
    record.deprioritizedCapabilityTerms,
    `${context}.deprioritizedCapabilityTerms`,
    false,
  );
  assertMaybeNumber(
    record.sourceSaturationFreeCount,
    `${context}.sourceSaturationFreeCount`,
    false,
  );
  assertMaybeNumber(
    record.sourceSaturationPenaltyStep,
    `${context}.sourceSaturationPenaltyStep`,
    false,
  );
}

function assertRecommendationKeywordMaps(
  record: JsonRecord,
  context: string,
): void {
  assertStringArrayRecord(
    record.concernKeywordMap,
    `${context}.concernKeywordMap`,
  );
  assertStringArrayRecord(
    record.taskModeKeywordMap,
    `${context}.taskModeKeywordMap`,
  );
  assertStringArrayRecord(
    record.domainKeywordGroups,
    `${context}.domainKeywordGroups`,
  );
  assertStringArrayRecord(record.synonyms, `${context}.synonyms`);
}

function assertOptionalRecommendationKeywordMaps(
  record: JsonRecord,
  context: string,
): void {
  if (record.concernKeywordMap !== undefined) {
    assertStringArrayRecord(
      record.concernKeywordMap,
      `${context}.concernKeywordMap`,
    );
  }
  if (record.taskModeKeywordMap !== undefined) {
    assertStringArrayRecord(
      record.taskModeKeywordMap,
      `${context}.taskModeKeywordMap`,
    );
  }
  if (record.domainKeywordGroups !== undefined) {
    assertStringArrayRecord(
      record.domainKeywordGroups,
      `${context}.domainKeywordGroups`,
    );
  }
  if (record.synonyms !== undefined) {
    assertStringArrayRecord(record.synonyms, `${context}.synonyms`);
  }
}

function assertRecommendationPolicyPresets(
  value: unknown,
  context: string,
): void {
  const record = assertRecord(value, context);
  if (record.targetAssetKinds !== undefined) {
    assertRecommendationPresetRecord(
      record.targetAssetKinds,
      `${context}.targetAssetKinds`,
      assertRecommendationTargetAssetKinds,
    );
  }
  if (record.targetConcerns !== undefined) {
    assertRecommendationPresetRecord(
      record.targetConcerns,
      `${context}.targetConcerns`,
      assertRecommendationTargetConcerns,
    );
  }
}

function assertRecommendationPolicyPresetRefs(
  value: unknown,
  context: string,
): void {
  const record = assertRecord(value, context);
  if (record.targetAssetKinds !== undefined) {
    assertStringArray(record.targetAssetKinds, `${context}.targetAssetKinds`);
  }
  if (record.targetConcerns !== undefined) {
    assertStringArray(record.targetConcerns, `${context}.targetConcerns`);
  }
}

function assertRecommendationPresetRecord(
  value: unknown,
  context: string,
  assertEntries: (value: unknown[], context: string) => void,
): void {
  const record = assertRecord(value, context);
  Object.entries(record).forEach(([key, entryValue]) => {
    assertEntries(
      assertArray(entryValue, `${context}.${key}`),
      `${context}.${key}`,
    );
  });
}

function assertRecommendationTargetAssetKinds(
  value: unknown[],
  context: string,
): void {
  value.forEach((target, index) => {
    const targetRecord = assertRecord(target, `${context}[${index}]`);
    assertLiteral(
      targetRecord.assetKind,
      ASSET_KINDS,
      `${context}[${index}].assetKind`,
    );
    assertNumber(targetRecord.minimum, `${context}[${index}].minimum`);
    assertNumber(targetRecord.weight, `${context}[${index}].weight`);
  });
}

function assertRecommendationTargetConcerns(
  value: unknown[],
  context: string,
): void {
  value.forEach((target, index) => {
    const targetRecord = assertRecord(target, `${context}[${index}]`);
    assertString(targetRecord.concern, `${context}[${index}].concern`);
    assertNumber(targetRecord.minimum, `${context}[${index}].minimum`);
    assertNumber(targetRecord.weight, `${context}[${index}].weight`);
  });
}

function assertRecommendationScoreBreakdown(
  value: unknown,
  context: string,
): void {
  const record = assertRecord(value, context);
  assertNumber(record.authority, `${context}.authority`);
  assertNumber(record.compatibility, `${context}.compatibility`);
  assertNumber(record.portfolioFit, `${context}.portfolioFit`);
  assertNumber(record.trust, `${context}.trust`);
  assertNumber(record.sourcePriority, `${context}.sourcePriority`);
  assertNumber(record.demand, `${context}.demand`);
  assertNumber(record.hostPreference, `${context}.hostPreference`);
  assertNumber(record.coverage, `${context}.coverage`);
  assertNumber(record.diversity, `${context}.diversity`);
  // Inject default 0 for reports that predate this field (#401).
  if (record.assetKindDiversityPenalty === undefined) {
    record.assetKindDiversityPenalty = 0;
  }
  assertNumber(
    record.assetKindDiversityPenalty,
    `${context}.assetKindDiversityPenalty`,
  );
  assertNumber(record.freshness, `${context}.freshness`);
  assertNumber(record.costPenalty, `${context}.costPenalty`);
  assertNumber(record.riskPenalty, `${context}.riskPenalty`);
  assertNumber(record.negativePenalty, `${context}.negativePenalty`);
  // Inject default 0 for pre-v2.0.0 reports that predate this field.
  if (record.ecosystemMismatchPenalty === undefined) {
    record.ecosystemMismatchPenalty = 0;
  }
  assertNumber(
    record.ecosystemMismatchPenalty,
    `${context}.ecosystemMismatchPenalty`,
  );
  assertNumber(record.redundancyPenalty, `${context}.redundancyPenalty`);
  assertNumber(record.budgetPenalty, `${context}.budgetPenalty`);
  assertNumber(record.total, `${context}.total`);
}

/**
 * Validates unknown data as recommendation AI review input.
 */
export function assertRecommendationAiReviewInput(
  value: unknown,
  context: string,
): void {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertNumber(record.policyVersion, `${context}.policyVersion`);
  assertNumber(record.reviewLimit, `${context}.reviewLimit`);
  if (record.demandSignals !== null) {
    const demandSignals = assertRecord(
      record.demandSignals,
      `${context}.demandSignals`,
    );
    assertStringArray(
      demandSignals.languages,
      `${context}.demandSignals.languages`,
    );
    assertStringArray(
      demandSignals.packageManagers,
      `${context}.demandSignals.packageManagers`,
    );
    assertStringArray(
      demandSignals.frameworks,
      `${context}.demandSignals.frameworks`,
    );
    assertStringArray(
      demandSignals.concerns,
      `${context}.demandSignals.concerns`,
    );
    assertStringArray(
      demandSignals.tooling,
      `${context}.demandSignals.tooling`,
    );
  }
  assertStringArray(record.reviewedHosts, `${context}.reviewedHosts`);
  assertArray(record.hosts, `${context}.hosts`).forEach(
    (hostEntry, hostIndex) => {
      const hostRecord = assertRecord(
        hostEntry,
        `${context}.hosts[${hostIndex}]`,
      );
      assertHostTarget(hostRecord.host, `${context}.hosts[${hostIndex}].host`);
      assertArray(
        hostRecord.candidates,
        `${context}.hosts[${hostIndex}].candidates`,
      ).forEach((candidate, candidateIndex) => {
        const candidateRecord = assertRecord(
          candidate,
          `${context}.hosts[${hostIndex}].candidates[${candidateIndex}]`,
        );
        assertString(
          candidateRecord.assetId,
          `${context}.hosts[${hostIndex}].candidates[${candidateIndex}].assetId`,
        );
        assertHostTarget(
          candidateRecord.host,
          `${context}.hosts[${hostIndex}].candidates[${candidateIndex}].host`,
        );
        assertNumber(
          candidateRecord.rank,
          `${context}.hosts[${hostIndex}].candidates[${candidateIndex}].rank`,
        );
        assertNumber(
          candidateRecord.score,
          `${context}.hosts[${hostIndex}].candidates[${candidateIndex}].score`,
        );
        assertString(
          candidateRecord.sourceFamily,
          `${context}.hosts[${hostIndex}].candidates[${candidateIndex}].sourceFamily`,
        );
        assertBoolean(
          candidateRecord.availableLocally,
          `${context}.hosts[${hostIndex}].candidates[${candidateIndex}].availableLocally`,
        );
        assertLiteral(
          candidateRecord.recommendationBasis,
          ["workspace-fit", "local-availability"],
          `${context}.hosts[${hostIndex}].candidates[${candidateIndex}].recommendationBasis`,
        );
        assertStringArray(
          candidateRecord.coverageTags,
          `${context}.hosts[${hostIndex}].candidates[${candidateIndex}].coverageTags`,
        );
        assertStringArray(
          candidateRecord.taskModes,
          `${context}.hosts[${hostIndex}].candidates[${candidateIndex}].taskModes`,
        );
        assertStringArray(
          candidateRecord.reasons,
          `${context}.hosts[${hostIndex}].candidates[${candidateIndex}].reasons`,
        );
        assertArray(
          candidateRecord.matchedSignals,
          `${context}.hosts[${hostIndex}].candidates[${candidateIndex}].matchedSignals`,
        );
        assertRecommendationScoreBreakdown(
          candidateRecord.scoreBreakdown,
          `${context}.hosts[${hostIndex}].candidates[${candidateIndex}].scoreBreakdown`,
        );
      });
    },
  );
}

/**
 * Validates unknown data as recommendation AI review artifact.
 */
export function assertRecommendationAiReviewArtifact(
  value: unknown,
  context: string,
): void {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertBoolean(record.enabled, `${context}.enabled`);
  assertLiteral(
    record.status,
    ["disabled", "completed", "failed"],
    `${context}.status`,
  );
  assertMaybeString(record.provider, `${context}.provider`, false);
  assertMaybeString(record.model, `${context}.model`, false);
  assertStringArray(record.reviewedHosts, `${context}.reviewedHosts`);
  assertArray(record.hostReviews, `${context}.hostReviews`).forEach(
    (hostReview, hostIndex) => {
      const hostRecord = assertRecord(
        hostReview,
        `${context}.hostReviews[${hostIndex}]`,
      );
      assertHostTarget(
        hostRecord.host,
        `${context}.hostReviews[${hostIndex}].host`,
      );
      assertStringArray(
        hostRecord.acceptedAssetIds,
        `${context}.hostReviews[${hostIndex}].acceptedAssetIds`,
      );
      assertStringArray(
        hostRecord.suppressedAssetIds,
        `${context}.hostReviews[${hostIndex}].suppressedAssetIds`,
      );
      assertArray(
        hostRecord.questionable,
        `${context}.hostReviews[${hostIndex}].questionable`,
      ).forEach((entry, entryIndex) =>
        assertRecommendationAiReviewNote(
          entry,
          `${context}.hostReviews[${hostIndex}].questionable[${entryIndex}]`,
        ),
      );
      assertArray(
        hostRecord.rerank,
        `${context}.hostReviews[${hostIndex}].rerank`,
      ).forEach((entry, entryIndex) => {
        const rerank = assertRecord(
          entry,
          `${context}.hostReviews[${hostIndex}].rerank[${entryIndex}]`,
        );
        assertString(
          rerank.assetId,
          `${context}.hostReviews[${hostIndex}].rerank[${entryIndex}].assetId`,
        );
        assertNumber(
          rerank.delta,
          `${context}.hostReviews[${hostIndex}].rerank[${entryIndex}].delta`,
        );
        assertString(
          rerank.reason,
          `${context}.hostReviews[${hostIndex}].rerank[${entryIndex}].reason`,
        );
        assertLiteral(
          rerank.confidence,
          ["low", "medium", "high"],
          `${context}.hostReviews[${hostIndex}].rerank[${entryIndex}].confidence`,
        );
      });
    },
  );
  assertMaybeStringArray(record.warnings, `${context}.warnings`, false);
  assertMaybeString(record.error, `${context}.error`, false);
}

function assertRecommendationAiReviewNote(
  value: unknown,
  context: string,
): void {
  const record = assertRecord(value, context);
  assertString(record.assetId, `${context}.assetId`);
  assertString(record.reason, `${context}.reason`);
  assertLiteral(
    record.confidence,
    ["low", "medium", "high"],
    `${context}.confidence`,
  );
}

/** Exposes validation internals for targeted coverage testing. */
export const recommendationValidationInternals = {
  assertRecommendationScoreBreakdown,
};
