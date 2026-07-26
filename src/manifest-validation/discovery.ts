import type {
  AiEnrichmentInput,
  AiEnrichmentReport,
  AssetCatalogEntry,
  DemandProfile,
  DiscoverDiffReport,
  EnvironmentIndexReport,
  GitHubRepoSnapshot,
  SelectionRegistry,
  SelectionReport,
  SourceIndex,
  SourceRegistry,
} from "../types.js";
import {
  ASSET_KINDS,
  ASSET_PREREQUISITE_KINDS,
  assertArray,
  assertAssetKindArray,
  assertBoolean,
  assertHostTarget,
  assertHostTargetArray,
  assertLiteral,
  assertMaybeNumber,
  assertMaybeString,
  assertMaybeStringArray,
  assertNumber,
  assertRecord,
  assertString,
  assertStringArray,
  AUTHORITY_TIERS,
  COMPATIBILITY_MODES,
  CONTEXT_COST_CLASSES,
  RISK_LEVELS,
  SOURCE_KINDS,
} from "./primitives.js";

function assertNullableString(value: unknown, context: string): void {
  if (value === undefined || value === null) {
    return;
  }

  assertString(value, context);
}

function assertDiffBucket(value: unknown, context: string): void {
  const record = assertRecord(value, context);
  assertStringArray(record.added, `${context}.added`);
  assertStringArray(record.removed, `${context}.removed`);
  assertStringArray(record.changed, `${context}.changed`);
}

function assertCountPair(value: unknown, context: string): void {
  const record = assertRecord(value, context);
  assertNumber(record.baseline, `${context}.baseline`);
  assertNumber(record.current, `${context}.current`);
}

const DEMAND_EVIDENCE_STRENGTHS = ["strong", "medium", "weak"] as const;
const SOURCE_COVERAGE_MODES = [
  "direct",
  "rotating",
  "sampled",
  "indexed",
] as const;
const SOURCE_SYNC_STATUSES = [
  "not-applicable",
  "unsupported",
  "partial",
  "complete",
  "failed",
] as const;
const CLASSIFICATION_CONFIDENCE_LEVELS = ["strong", "medium", "weak"] as const;
const HOST_NATIVE_CONFIG_HOST_KEYS = [
  "opencode",
  "cursor",
  "zed",
  "claude-code",
  "pi",
] as const;

type HostNativeConfigHostKey = (typeof HOST_NATIVE_CONFIG_HOST_KEYS)[number];

/**
 * Validates unknown data as source registry.
 */
export function assertSourceRegistry(
  value: unknown,
  context: string,
): asserts value is SourceRegistry {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertArray(record.sources, `${context}.sources`).forEach((entry, index) => {
    const entryRecord = assertRecord(entry, `${context}.sources[${index}]`);
    assertString(entryRecord.id, `${context}.sources[${index}].id`);
    assertString(entryRecord.name, `${context}.sources[${index}].name`);
    assertLiteral(
      entryRecord.kind,
      SOURCE_KINDS,
      `${context}.sources[${index}].kind`,
    );
    assertLiteral(
      entryRecord.authorityTier,
      AUTHORITY_TIERS,
      `${context}.sources[${index}].authorityTier`,
    );
    assertHostTargetArray(
      entryRecord.hosts,
      `${context}.sources[${index}].hosts`,
    );
    assertAssetKindArray(
      entryRecord.assetKinds,
      `${context}.sources[${index}].assetKinds`,
    );
    assertNumber(entryRecord.priority, `${context}.sources[${index}].priority`);
    assertBoolean(entryRecord.enabled, `${context}.sources[${index}].enabled`);
    assertRecord(
      entryRecord.endpoints,
      `${context}.sources[${index}].endpoints`,
    );
    assertNonEmptyTrimmedStringArray(
      entryRecord.includePaths,
      `${context}.sources[${index}].includePaths`,
    );
    assertNonEmptyTrimmedStringArray(
      entryRecord.excludePaths,
      `${context}.sources[${index}].excludePaths`,
    );
    assertNonEmptyTrimmedStringArray(
      entryRecord.mcpServerPaths,
      `${context}.sources[${index}].mcpServerPaths`,
    );
    assertRecord(entryRecord.rules, `${context}.sources[${index}].rules`);
  });
}

function assertNonEmptyTrimmedStringArray(
  value: unknown,
  context: string,
): void {
  if (value === undefined) {
    return;
  }

  assertArray(value, context).forEach((entry, index) => {
    const entryContext = `${context}[${index}]`;
    const stringEntry = assertString(entry, entryContext);
    if (stringEntry.trim().length === 0) {
      throw new Error(`${entryContext} must not be empty`);
    }
  });
}

/**
 * Validates unknown data as selection registry.
 */
export function assertSelectionRegistry(
  value: unknown,
  context: string,
): asserts value is SelectionRegistry {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  const selectionPolicies = assertRecord(
    record.selectionPolicies,
    `${context}.selectionPolicies`,
  );
  assertBoolean(
    selectionPolicies.officialBeatsPopularity,
    `${context}.selectionPolicies.officialBeatsPopularity`,
  );
  assertBoolean(
    selectionPolicies.starsAreTieBreakerOnly,
    `${context}.selectionPolicies.starsAreTieBreakerOnly`,
  );
  assertBoolean(
    selectionPolicies.preferNativeOverAdaptable,
    `${context}.selectionPolicies.preferNativeOverAdaptable`,
  );
  assertBoolean(
    selectionPolicies.preferLowerRiskWhenEquivalent,
    `${context}.selectionPolicies.preferLowerRiskWhenEquivalent`,
  );
  assertBoolean(
    selectionPolicies.preferLowerContextCostWhenEquivalent,
    `${context}.selectionPolicies.preferLowerContextCostWhenEquivalent`,
  );
  assertString(
    selectionPolicies.communityDefaultPolicy,
    `${context}.selectionPolicies.communityDefaultPolicy`,
  );
  assertStringArray(record.rankingOrder, `${context}.rankingOrder`);
  assertArray(record.duplicateGroups, `${context}.duplicateGroups`).forEach(
    (entry, index) => {
      const entryRecord = assertRecord(
        entry,
        `${context}.duplicateGroups[${index}]`,
      );
      assertString(entryRecord.id, `${context}.duplicateGroups[${index}].id`);
      assertString(
        entryRecord.capability,
        `${context}.duplicateGroups[${index}].capability`,
      );
      assertString(
        entryRecord.preferredAuthorityTier,
        `${context}.duplicateGroups[${index}].preferredAuthorityTier`,
      );
      assertString(
        entryRecord.selectionReason,
        `${context}.duplicateGroups[${index}].selectionReason`,
      );
    },
  );
}

/**
 * Validates unknown data as demand profile.
 */
export function assertDemandProfile(
  value: unknown,
  context: string,
): asserts value is DemandProfile {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertString(record.scanRoot, `${context}.scanRoot`);
  const summary = assertRecord(record.summary, `${context}.summary`);
  assertNumber(summary.scannedFiles, `${context}.summary.scannedFiles`);
  assertNumber(summary.matchedFiles, `${context}.summary.matchedFiles`);
  assertDemandSignalSet(record.signals, `${context}.signals`);
  assertArray(record.evidence, `${context}.evidence`).forEach(
    (entry, index) => {
      const entryRecord = assertRecord(entry, `${context}.evidence[${index}]`);
      assertString(entryRecord.path, `${context}.evidence[${index}].path`);
      assertString(
        entryRecord.fileName,
        `${context}.evidence[${index}].fileName`,
      );
      if (entryRecord.evidenceStrength !== undefined) {
        assertLiteral(
          entryRecord.evidenceStrength,
          DEMAND_EVIDENCE_STRENGTHS,
          `${context}.evidence[${index}].evidenceStrength`,
        );
      }
      assertDemandSignalSet(
        entryRecord.matchedSignals,
        `${context}.evidence[${index}].matchedSignals`,
      );
    },
  );
}

/**
 * Validates unknown data as discover diff report.
 */
export function assertDiscoverDiffReport(
  value: unknown,
  context: string,
): asserts value is DiscoverDiffReport {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertString(record.baselineLabel, `${context}.baselineLabel`);
  assertString(record.currentLabel, `${context}.currentLabel`);
  assertDiffBucket(record.sources, `${context}.sources`);
  assertDiffBucket(record.catalog, `${context}.catalog`);
  assertDiffBucket(record.selection, `${context}.selection`);
  const counts = assertRecord(record.counts, `${context}.counts`);
  assertCountPair(counts.sources, `${context}.counts.sources`);
  assertCountPair(counts.catalog, `${context}.counts.catalog`);
  assertCountPair(counts.selected, `${context}.counts.selected`);
  assertCountPair(counts.rejected, `${context}.counts.rejected`);
  assertStringArray(record.highImpactChanges, `${context}.highImpactChanges`);
}

/**
 * Validates unknown data as source index.
 */
export function assertEnvironmentIndexReport(
  value: unknown,
  context: string,
): asserts value is EnvironmentIndexReport {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertBoolean(record.experimental, `${context}.experimental`);
  if (record.experimental !== true) {
    throw new Error(`${context}.experimental must be true`);
  }
  assertNumber(record.selectedAssetCount, `${context}.selectedAssetCount`);
  assertArray(record.assets, `${context}.assets`).forEach((asset, index) => {
    const assetRecord = assertRecord(asset, `${context}.assets[${index}]`);
    assertString(assetRecord.assetId, `${context}.assets[${index}].assetId`);
    assertString(
      assetRecord.displayName,
      `${context}.assets[${index}].displayName`,
    );
    assertLiteral(
      assetRecord.assetKind,
      ASSET_KINDS,
      `${context}.assets[${index}].assetKind`,
    );
    assertHostTargetArray(
      assetRecord.hosts,
      `${context}.assets[${index}].hosts`,
    );
    assertString(
      assetRecord.symbolicHandle,
      `${context}.assets[${index}].symbolicHandle`,
    );
    assertStringArray(
      assetRecord.retrievalFacets,
      `${context}.assets[${index}].retrievalFacets`,
    );
    const chunkingHints = assertRecord(
      assetRecord.chunkingHints,
      `${context}.assets[${index}].chunkingHints`,
    );
    assertLiteral(
      chunkingHints.preferredStrategy,
      ["document", "section", "file"],
      `${context}.assets[${index}].chunkingHints.preferredStrategy`,
    );
    assertNumber(
      chunkingHints.maxPromptWeight,
      `${context}.assets[${index}].chunkingHints.maxPromptWeight`,
    );
    const citation = assertRecord(
      assetRecord.citation,
      `${context}.assets[${index}].citation`,
    );
    assertString(
      citation.provenance,
      `${context}.assets[${index}].citation.provenance`,
    );
    assertString(
      citation.sourceUrl,
      `${context}.assets[${index}].citation.sourceUrl`,
    );
    assertString(
      citation.sourceId,
      `${context}.assets[${index}].citation.sourceId`,
    );
    assertStringArray(
      assetRecord.safetyFlags,
      `${context}.assets[${index}].safetyFlags`,
    );
  });
  assertStringArray(record.notes, `${context}.notes`);
}

/**
 * Validates unknown data as source index.
 */
export function assertSourceIndex(
  value: unknown,
  context: string,
): asserts value is SourceIndex {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertNumber(record.sourceCount, `${context}.sourceCount`);
  assertRecord(record.byAuthorityTier, `${context}.byAuthorityTier`);
  assertRecord(record.byKind, `${context}.byKind`);
  assertRecord(record.hostCoverage, `${context}.hostCoverage`);
  assertString(
    record.communityDefaultPolicy,
    `${context}.communityDefaultPolicy`,
  );
  const configurationInputs = assertRecord(
    record.configurationInputs,
    `${context}.configurationInputs`,
  );
  assertString(
    configurationInputs.checkedInRegistryPath,
    `${context}.configurationInputs.checkedInRegistryPath`,
  );
  assertStringArray(
    configurationInputs.sourcePackFiles,
    `${context}.configurationInputs.sourcePackFiles`,
  );
  assertStringArray(
    configurationInputs.officialSkillIndexIds,
    `${context}.configurationInputs.officialSkillIndexIds`,
  );
  assertStringArray(
    configurationInputs.officialUpstreamNamespaces,
    `${context}.configurationInputs.officialUpstreamNamespaces`,
  );
  assertArray(record.enabledSources, `${context}.enabledSources`).forEach(
    (entry, index) => {
      const entryRecord = assertRecord(
        entry,
        `${context}.enabledSources[${index}]`,
      );
      assertString(entryRecord.id, `${context}.enabledSources[${index}].id`);
      assertLiteral(
        entryRecord.kind,
        SOURCE_KINDS,
        `${context}.enabledSources[${index}].kind`,
      );
      assertLiteral(
        entryRecord.authorityTier,
        AUTHORITY_TIERS,
        `${context}.enabledSources[${index}].authorityTier`,
      );
      assertNumber(
        entryRecord.priority,
        `${context}.enabledSources[${index}].priority`,
      );
      assertHostTargetArray(
        entryRecord.hosts,
        `${context}.enabledSources[${index}].hosts`,
      );
      assertLiteral(
        entryRecord.coverageMode,
        SOURCE_COVERAGE_MODES,
        `${context}.enabledSources[${index}].coverageMode`,
      );
      assertLiteral(
        entryRecord.syncStatus,
        SOURCE_SYNC_STATUSES,
        `${context}.enabledSources[${index}].syncStatus`,
      );
      assertMaybeNumber(
        entryRecord.indexedEntryCount,
        `${context}.enabledSources[${index}].indexedEntryCount`,
        false,
      );
      assertMaybeString(
        entryRecord.lastSyncedAt,
        `${context}.enabledSources[${index}].lastSyncedAt`,
        false,
      );
      assertMaybeString(
        entryRecord.syncReason,
        `${context}.enabledSources[${index}].syncReason`,
        false,
      );
    },
  );
}

/**
 * Validates unknown data as asset catalog entry.
 */
export function assertAssetCatalogEntry(
  value: unknown,
  context: string,
): asserts value is AssetCatalogEntry {
  const record = assertRecord(value, context);
  assertString(record.id, `${context}.id`);
  assertString(record.displayName, `${context}.displayName`);
  assertLiteral(record.assetKind, ASSET_KINDS, `${context}.assetKind`);
  assertHostTargetArray(record.hosts, `${context}.hosts`);
  assertLiteral(
    record.compatibilityMode,
    COMPATIBILITY_MODES,
    `${context}.compatibilityMode`,
  );

  const source = assertRecord(record.source, `${context}.source`);
  assertString(source.sourceId, `${context}.source.sourceId`);
  assertLiteral(
    source.authorityTier,
    AUTHORITY_TIERS,
    `${context}.source.authorityTier`,
  );
  assertLiteral(
    source.sourceKind,
    SOURCE_KINDS,
    `${context}.source.sourceKind`,
  );
  assertNumber(source.sourcePriority, `${context}.source.sourcePriority`);
  assertString(source.originUrl, `${context}.source.originUrl`);
  assertString(source.publisher, `${context}.source.publisher`);
  assertBoolean(
    source.publisherVerified,
    `${context}.source.publisherVerified`,
  );

  const install = assertRecord(record.install, `${context}.install`);
  assertString(install.method, `${context}.install.method`);
  if (install.prerequisites !== undefined) {
    assertAssetPrerequisites(
      install.prerequisites,
      `${context}.install.prerequisites`,
    );
  }
  const maintenance = assertRecord(
    record.maintenance,
    `${context}.maintenance`,
  );
  assertString(maintenance.lastUpdated, `${context}.maintenance.lastUpdated`);
  assertNumber(maintenance.stars, `${context}.maintenance.stars`);
  assertString(
    maintenance.releaseCadence,
    `${context}.maintenance.releaseCadence`,
  );
  const evidence = assertRecord(record.evidence, `${context}.evidence`);
  if (evidence.classification !== undefined) {
    assertAssetClassificationEvidence(
      evidence.classification,
      `${context}.evidence.classification`,
    );
  }
  const risk = assertRecord(record.risk, `${context}.risk`);
  assertLiteral(risk.level, [...RISK_LEVELS], `${context}.risk.level`);
  assertBoolean(risk.hasHooks, `${context}.risk.hasHooks`);
  assertBoolean(risk.hasExecScripts, `${context}.risk.hasExecScripts`);
  assertBoolean(risk.requiresNetwork, `${context}.risk.requiresNetwork`);
  const contextCost = assertRecord(
    record.contextCost,
    `${context}.contextCost`,
  );
  assertLiteral(
    contextCost.sizeClass,
    [...CONTEXT_COST_CLASSES],
    `${context}.contextCost.sizeClass`,
  );
  assertNumber(
    contextCost.estimatedPromptWeight,
    `${context}.contextCost.estimatedPromptWeight`,
  );
  const fit = assertRecord(record.fit, `${context}.fit`);
  assertNumber(fit.portfolioFit, `${context}.fit.portfolioFit`);
  assertNumber(fit.hostFit, `${context}.fit.hostFit`);
  const status = assertRecord(record.status, `${context}.status`);
  assertBoolean(status.cataloged, `${context}.status.cataloged`);
  assertBoolean(status.mirrorEligible, `${context}.status.mirrorEligible`);
  assertBoolean(status.installEligible, `${context}.status.installEligible`);
  assertBoolean(
    status.activationEligible,
    `${context}.status.activationEligible`,
  );
  if (record.queryMetadata !== undefined) {
    assertAssetQueryMetadata(record.queryMetadata, `${context}.queryMetadata`);
  }
  if (record.hostNativeConfig !== undefined) {
    assertAssetHostNativeConfigMap(
      record.hostNativeConfig,
      `${context}.hostNativeConfig`,
    );
  }
}

function assertAssetQueryMetadata(value: unknown, context: string): void {
  const record = assertRecord(value, context);
  assertString(record.symbolicHandle, `${context}.symbolicHandle`);
  assertStringArray(record.retrievalFacets, `${context}.retrievalFacets`);
  const chunkingHints = assertRecord(
    record.chunkingHints,
    `${context}.chunkingHints`,
  );
  assertLiteral(
    chunkingHints.preferredStrategy,
    ["document", "section", "file"],
    `${context}.chunkingHints.preferredStrategy`,
  );
  assertNumber(
    chunkingHints.maxPromptWeight,
    `${context}.chunkingHints.maxPromptWeight`,
  );
  const citation = assertRecord(record.citation, `${context}.citation`);
  assertString(citation.provenance, `${context}.citation.provenance`);
  assertString(citation.sourceUrl, `${context}.citation.sourceUrl`);
  assertString(citation.sourceId, `${context}.citation.sourceId`);
  assertStringArray(record.safetyFlags, `${context}.safetyFlags`);
}

function assertAssetClassificationEvidence(
  value: unknown,
  context: string,
): void {
  const record = assertRecord(value, context);
  assertLiteral(record.assetKind, ASSET_KINDS, `${context}.assetKind`);
  assertNumber(record.confidence, `${context}.confidence`);
  assertLiteral(
    record.level,
    CLASSIFICATION_CONFIDENCE_LEVELS,
    `${context}.level`,
  );
  assertArray(record.evidence, `${context}.evidence`).forEach(
    (entry, index) => {
      const evidence = assertRecord(entry, `${context}.evidence[${index}]`);
      assertString(evidence.source, `${context}.evidence[${index}].source`);
      assertLiteral(
        evidence.strength,
        CLASSIFICATION_CONFIDENCE_LEVELS,
        `${context}.evidence[${index}].strength`,
      );
      assertString(evidence.detail, `${context}.evidence[${index}].detail`);
    },
  );
}

/**
 * Validates unknown data as selection report.
 */
export function assertSelectionReport(
  value: unknown,
  context: string,
): asserts value is SelectionReport {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertNumber(record.inputCount, `${context}.inputCount`);
  assertNumber(record.selectedCount, `${context}.selectedCount`);
  assertNumber(record.rejectedCount, `${context}.rejectedCount`);
  // acceptanceRate — inject computed default for pre-v2.0.0 reports
  if (record.acceptanceRate === undefined) {
    const inputCount = record.inputCount as number;
    const selectedCount = record.selectedCount as number;
    record.acceptanceRate =
      inputCount > 0
        ? Number((selectedCount / inputCount).toFixed(4))
        : 0;
  } else {
    assertNumber(record.acceptanceRate, `${context}.acceptanceRate`);
  }
  // rejectionSummary — inject empty default for pre-v2.0.0 reports
  if (record.rejectionSummary === undefined) {
    record.rejectionSummary = {};
  } else {
    const summaryRecord = assertRecord(
      record.rejectionSummary,
      `${context}.rejectionSummary`,
    );
    for (const [reason, count] of Object.entries(summaryRecord)) {
      assertNumber(count, `${context}.rejectionSummary.${reason}`);
    }
  }
  // sampleRejected — inject empty default for pre-v2.0.0 reports
  if (record.sampleRejected === undefined) {
    record.sampleRejected = [];
  } else {
    const samples = assertArray(
      record.sampleRejected,
      `${context}.sampleRejected`,
    );
    for (let i = 0; i < samples.length; i++) {
      const sample = assertRecord(
        samples[i],
        `${context}.sampleRejected[${i}]`,
      );
      assertString(sample.assetId, `${context}.sampleRejected[${i}].assetId`);
      assertString(sample.reason, `${context}.sampleRejected[${i}].reason`);
    }
  }
  // sourceDiversityWarning — optional, added in v2.0.0 (#304)
  if (record.sourceDiversityWarning !== undefined) {
    assertString(
      record.sourceDiversityWarning,
      `${context}.sourceDiversityWarning`,
    );
  }
}

/**
 * Validates unknown data as AI enrichment input artifact.
 */
export function assertAiEnrichmentInput(
  value: unknown,
  context: string,
): asserts value is AiEnrichmentInput {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertLiteral(
    record.mode,
    [
      "off",
      "manual",
      "after-select",
      "after-workspace",
      "on-ambiguity",
      "on-input-change",
      "ci-only",
    ],
    `${context}.mode`,
  );
  assertLiteral(
    record.trigger,
    ["manual", "after-select", "after-workspace"],
    `${context}.trigger`,
  );
  assertBoolean(record.explicit, `${context}.explicit`);
  assertBoolean(record.interactive, `${context}.interactive`);
  assertBoolean(record.ci, `${context}.ci`);
  assertString(record.model, `${context}.model`);
  assertMaybeString(record.providerOrigin, `${context}.providerOrigin`, false);
  assertNumber(record.selectedAssetCount, `${context}.selectedAssetCount`);
  assertNumber(
    record.includedSelectedAssetCount,
    `${context}.includedSelectedAssetCount`,
  );
  assertNumber(record.evidenceItemCount, `${context}.evidenceItemCount`);
  assertNumber(
    record.includedEvidenceItemCount,
    `${context}.includedEvidenceItemCount`,
  );

  const omissions = assertRecord(record.omissions, `${context}.omissions`);
  assertNumber(omissions.selectedAssets, `${context}.omissions.selectedAssets`);
  assertNumber(omissions.evidenceItems, `${context}.omissions.evidenceItems`);
  assertNumber(
    omissions.capabilityValues,
    `${context}.omissions.capabilityValues`,
  );
  assertBoolean(
    omissions.sourceIdentifiersRedacted,
    `${context}.omissions.sourceIdentifiersRedacted`,
  );
  assertBoolean(
    omissions.filePathsRedacted,
    `${context}.omissions.filePathsRedacted`,
  );

  const fingerprints = assertRecord(
    record.fingerprints,
    `${context}.fingerprints`,
  );
  assertNullableString(
    fingerprints.demandProfileSha256,
    `${context}.fingerprints.demandProfileSha256`,
  );
  assertNullableString(
    fingerprints.selectedCatalogSha256,
    `${context}.fingerprints.selectedCatalogSha256`,
  );
  assertString(
    fingerprints.configSha256,
    `${context}.fingerprints.configSha256`,
  );
  assertString(fingerprints.inputSha256, `${context}.fingerprints.inputSha256`);

  if (record.demandSignals !== null) {
    assertDemandSignalSet(record.demandSignals, `${context}.demandSignals`);
  }

  assertArray(record.demandEvidence, `${context}.demandEvidence`).forEach(
    (entry, index) => {
      const evidence = assertRecord(
        entry,
        `${context}.demandEvidence[${index}]`,
      );
      assertString(
        evidence.fileName,
        `${context}.demandEvidence[${index}].fileName`,
      );
      assertMaybeString(
        evidence.path,
        `${context}.demandEvidence[${index}].path`,
        false,
      );
      if (evidence.evidenceStrength !== undefined) {
        assertLiteral(
          evidence.evidenceStrength,
          DEMAND_EVIDENCE_STRENGTHS,
          `${context}.demandEvidence[${index}].evidenceStrength`,
        );
      }
      assertDemandSignalSet(
        evidence.matchedSignals,
        `${context}.demandEvidence[${index}].matchedSignals`,
      );
    },
  );

  assertArray(record.selectedAssets, `${context}.selectedAssets`).forEach(
    (entry, index) => {
      const asset = assertRecord(entry, `${context}.selectedAssets[${index}]`);
      assertString(asset.id, `${context}.selectedAssets[${index}].id`);
      assertString(
        asset.displayName,
        `${context}.selectedAssets[${index}].displayName`,
      );
      assertLiteral(
        asset.assetKind,
        ASSET_KINDS,
        `${context}.selectedAssets[${index}].assetKind`,
      );
      assertHostTargetArray(
        asset.hosts,
        `${context}.selectedAssets[${index}].hosts`,
      );
      assertLiteral(
        asset.authorityTier,
        AUTHORITY_TIERS,
        `${context}.selectedAssets[${index}].authorityTier`,
      );
      assertMaybeString(
        asset.sourceId,
        `${context}.selectedAssets[${index}].sourceId`,
        false,
      );
      assertStringArray(
        asset.capabilities,
        `${context}.selectedAssets[${index}].capabilities`,
      );
    },
  );
}

/**
 * Validates unknown data as AI enrichment output/report artifact.
 */
export function assertAiEnrichmentReport(
  value: unknown,
  context: string,
): asserts value is AiEnrichmentReport {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertBoolean(record.enabled, `${context}.enabled`);
  assertLiteral(
    record.mode,
    [
      "off",
      "manual",
      "after-select",
      "after-workspace",
      "on-ambiguity",
      "on-input-change",
      "ci-only",
    ],
    `${context}.mode`,
  );
  assertLiteral(
    record.trigger,
    ["manual", "after-select", "after-workspace"],
    `${context}.trigger`,
  );
  assertBoolean(record.explicit, `${context}.explicit`);
  assertBoolean(record.interactive, `${context}.interactive`);
  assertBoolean(record.ci, `${context}.ci`);
  assertMaybeString(record.providerOrigin, `${context}.providerOrigin`, false);
  assertString(record.model, `${context}.model`);
  assertLiteral(
    record.status,
    ["disabled", "skipped", "completed", "reused", "failed"],
    `${context}.status`,
  );
  assertString(record.inputSha256, `${context}.inputSha256`);

  const fingerprints = assertRecord(
    record.fingerprints,
    `${context}.fingerprints`,
  );
  assertNullableString(
    fingerprints.demandProfileSha256,
    `${context}.fingerprints.demandProfileSha256`,
  );
  assertNullableString(
    fingerprints.selectedCatalogSha256,
    `${context}.fingerprints.selectedCatalogSha256`,
  );
  assertString(
    fingerprints.configSha256,
    `${context}.fingerprints.configSha256`,
  );

  assertMaybeString(record.summary, `${context}.summary`, false);
  assertMaybeStringArray(
    record.recommendations,
    `${context}.recommendations`,
    false,
  );
  assertMaybeStringArray(record.warnings, `${context}.warnings`, false);
  assertMaybeString(record.reason, `${context}.reason`, false);
  assertMaybeString(record.error, `${context}.error`, false);
  assertMaybeString(
    record.reusedFromGeneratedAt,
    `${context}.reusedFromGeneratedAt`,
    false,
  );
}

/**
 * Validates unknown data as git hub repo snapshot.
 */
export function assertGitHubRepoSnapshot(
  value: unknown,
  context: string,
): asserts value is GitHubRepoSnapshot {
  const record = assertRecord(value, context);
  assertString(record.owner, `${context}.owner`);
  assertString(record.repo, `${context}.repo`);
  assertString(record.sourceId, `${context}.sourceId`);
  assertString(record.fetchedAt, `${context}.fetchedAt`);
  const repoSummary = assertRecord(
    record.repoSummary,
    `${context}.repoSummary`,
  );
  assertString(repoSummary.name, `${context}.repoSummary.name`);
  if (repoSummary.description != null) {
    assertString(repoSummary.description, `${context}.repoSummary.description`);
  }
  assertString(repoSummary.fullName, `${context}.repoSummary.fullName`);
  assertString(
    repoSummary.defaultBranch,
    `${context}.repoSummary.defaultBranch`,
  );
  if (repoSummary.updatedAt != null) {
    assertString(repoSummary.updatedAt, `${context}.repoSummary.updatedAt`);
  }
  if (repoSummary.pushedAt != null) {
    assertString(repoSummary.pushedAt, `${context}.repoSummary.pushedAt`);
  }
  assertNumber(repoSummary.stars, `${context}.repoSummary.stars`);
  if (repoSummary.language != null) {
    assertString(repoSummary.language, `${context}.repoSummary.language`);
  }
  assertStringArray(repoSummary.topics, `${context}.repoSummary.topics`);
  assertBoolean(repoSummary.archived, `${context}.repoSummary.archived`);
  assertString(repoSummary.htmlUrl, `${context}.repoSummary.htmlUrl`);

  if (record.readme != null) {
    const readme = assertRecord(record.readme, `${context}.readme`);
    assertString(readme.path, `${context}.readme.path`);
    assertString(readme.sha, `${context}.readme.sha`);
    assertNumber(readme.size, `${context}.readme.size`);
    if (readme.htmlUrl != null) {
      assertString(readme.htmlUrl, `${context}.readme.htmlUrl`);
    }
    if (readme.downloadUrl != null) {
      assertString(readme.downloadUrl, `${context}.readme.downloadUrl`);
    }
  }

  const tree = assertRecord(record.tree, `${context}.tree`);
  assertString(tree.sha, `${context}.tree.sha`);
  assertBoolean(tree.truncated, `${context}.tree.truncated`);
  assertArray(tree.entries, `${context}.tree.entries`).forEach(
    (entry, index) => {
      const entryRecord = assertRecord(
        entry,
        `${context}.tree.entries[${index}]`,
      );
      assertString(entryRecord.path, `${context}.tree.entries[${index}].path`);
      assertString(entryRecord.type, `${context}.tree.entries[${index}].type`);
      if (entryRecord.size != null) {
        assertNumber(
          entryRecord.size,
          `${context}.tree.entries[${index}].size`,
        );
      }
      assertString(entryRecord.sha, `${context}.tree.entries[${index}].sha`);
    },
  );
}

function assertAssetPrerequisites(value: unknown, context: string): void {
  assertArray(value, context).forEach((entry, index) => {
    const prerequisite = assertRecord(entry, `${context}[${index}]`);
    assertString(prerequisite.id, `${context}[${index}].id`);
    assertLiteral(
      prerequisite.kind,
      ASSET_PREREQUISITE_KINDS,
      `${context}[${index}].kind`,
    );
    assertBoolean(prerequisite.required, `${context}[${index}].required`);
    assertString(prerequisite.description, `${context}[${index}].description`);
    assertMaybeString(
      prerequisite.provider,
      `${context}[${index}].provider`,
      false,
    );
    assertMaybeStringArray(
      prerequisite.envVars,
      `${context}[${index}].envVars`,
      false,
    );
    assertMaybeString(
      prerequisite.setupUrl,
      `${context}[${index}].setupUrl`,
      false,
    );
    if (prerequisite.host !== undefined) {
      assertHostTarget(prerequisite.host, `${context}[${index}].host`);
    }
  });
}

function assertAssetHostNativeConfigMap(value: unknown, context: string): void {
  const record = assertRecord(value, context);
  for (const hostKey of HOST_NATIVE_CONFIG_HOST_KEYS) {
    const hostValue = record[hostKey];
    if (hostValue === undefined) {
      continue;
    }

    const hostRecord = assertRecord(hostValue, `${context}.${hostKey}`);
    assertArray(hostRecord.files, `${context}.${hostKey}.files`).forEach(
      (entry, index) => {
        const entryRecord = assertRecord(
          entry,
          `${context}.${hostKey}.files[${index}]`,
        );
        const entryPath = assertString(
          entryRecord.path,
          `${context}.${hostKey}.files[${index}].path`,
        );
        const entryFormat = assertLiteral(
          entryRecord.format,
          ["text", "json"],
          `${context}.${hostKey}.files[${index}].format`,
        );

        if (entryFormat === "text") {
          assertString(
            entryRecord.content,
            `${context}.${hostKey}.files[${index}].content`,
          );
          if (entryRecord.merge !== undefined) {
            throw new Error(
              `${context}.${hostKey}.files[${index}].merge is only valid ` +
                "for json payloads",
            );
          }
        } else {
          assertRecord(
            entryRecord.content,
            `${context}.${hostKey}.files[${index}].content`,
          );
          if (entryRecord.merge !== undefined) {
            assertBoolean(
              entryRecord.merge,
              `${context}.${hostKey}.files[${index}].merge`,
            );
          }
        }

        assertHostNativeFilePayloadConstraints(
          hostKey,
          entryPath,
          entryFormat,
          entryRecord.merge === true,
          `${context}.${hostKey}.files[${index}]`,
        );
      },
    );
  }
}

function assertHostNativeFilePayloadConstraints(
  hostKey: HostNativeConfigHostKey,
  path: string,
  format: "text" | "json",
  merge: boolean,
  context: string,
): void {
  const mergeOnlyJsonPaths: Record<HostNativeConfigHostKey, readonly string[]> =
    {
      opencode: ["opencode.json"],
      cursor: [".cursor/mcp.json", ".cursor/hooks.json"],
      zed: [".zed/settings.json"],
      "claude-code": [
        ".mcp.json",
        ".claude/settings.json",
        ".claude/settings.local.json",
      ],
      pi: [],
    };

  const writeOnlyPrefixes: Record<HostNativeConfigHostKey, readonly string[]> =
    {
      opencode: [".opencode/tools/"],
      cursor: [".cursor/hooks/", ".cursor/agents/"],
      zed: [],
      "claude-code": [],
      pi: [".pi/extensions/", ".pi/packages/"],
    };

  if (mergeOnlyJsonPaths[hostKey]?.includes(path)) {
    if (format !== "json") {
      throw new Error(`${context}.format must be "json" for ${path}`);
    }
    if (!merge) {
      throw new Error(`${context}.merge must be true for ${path}`);
    }
    return;
  }

  if (writeOnlyPrefixes[hostKey]?.some((prefix) => path.startsWith(prefix))) {
    if (merge) {
      throw new Error(`${context}.merge must not be true for ${path}`);
    }
    return;
  }
}

function assertDemandSignalSet(value: unknown, context: string): void {
  const record = assertRecord(value, context);
  assertStringArray(record.languages, `${context}.languages`);
  assertStringArray(record.packageManagers, `${context}.packageManagers`);
  assertStringArray(record.frameworks, `${context}.frameworks`);
  assertStringArray(record.concerns, `${context}.concerns`);
  assertStringArray(record.tooling, `${context}.tooling`);
}
