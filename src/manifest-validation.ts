import type { GitHubRepoSnapshot } from "./github.js";
import type {
  ActivationManifest,
  AssetCatalogEntry,
  AssetKind,
  AuthorityTier,
  BundleLock,
  CompatibilityMode,
  CopilotWorkspaceProfileManifest,
  DemandProfile,
  HostTarget,
  InstallGenerationManifest,
  InstallProgressState,
  InstalledBundleManifest,
  InstalledPackageManifest,
  MirrorAcquireState,
  MirrorIndexEntry,
  MirrorPolicy,
  RecommendationPolicy,
  RecommendationPolicyBase,
  RecommendationHostPolicyOverride,
  RecommendationReport,
  SelectionRegistry,
  SelectionReport,
  SourceIndex,
  SourceKind,
  SourceRegistry,
  WirePlanManifest,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

const AUTHORITY_TIERS: AuthorityTier[] = [
  "trusted-local",
  "official-first-party",
  "official-marketplace",
  "official-compatible",
  "trusted-community",
  "unverified-community",
];

const SOURCE_KINDS: SourceKind[] = [
  "repo",
  "docs",
  "marketplace",
  "registry",
  "package-registry",
  "local-manifest",
  "local-directory",
];

const ASSET_KINDS: AssetKind[] = [
  "skill",
  "plugin",
  "mcp-server",
  "agent",
  "instruction",
  "workflow",
  "hook",
  "extension",
  "prompt-pack",
  "reference-pack",
];

const HOST_TARGETS: HostTarget[] = [
  "copilot-vscode",
  "opencode",
  "shared",
  "cursor",
  "zed",
  "claude-code",
  "pi",
];

const COMPATIBILITY_MODES: CompatibilityMode[] = [
  "native",
  "adaptable",
  "partial",
  "reference-only",
  "incompatible",
];

const RISK_LEVELS = ["low", "medium", "high"] as const;
const CONTEXT_COST_CLASSES = ["tiny", "small", "medium", "large"] as const;
const MIRROR_STATUSES = [
  "approved",
  "approved-with-warning",
  "quarantined",
  "metadata-only",
  "reference-only",
] as const;
const UPSTREAM_TYPES = [
  "repo",
  "package",
  "marketplace",
  "docs",
  "local",
] as const;
const WIRE_PLAN_HOSTS = [
  ...HOST_TARGETS,
  "vscode-user",
  "opencode-project",
] as const;

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
    assertRecord(entryRecord.rules, `${context}.sources[${index}].rules`);
  });
}

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
      assertDemandSignalSet(
        entryRecord.matchedSignals,
        `${context}.evidence[${index}].matchedSignals`,
      );
    },
  );
}

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
}

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
}

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
}

export function assertMirrorPolicy(
  value: unknown,
  context: string,
): asserts value is MirrorPolicy {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  const selection = assertRecord(record.selection, `${context}.selection`);
  assertBoolean(
    selection.officialBeatsPopularity,
    `${context}.selection.officialBeatsPopularity`,
  );
  assertBoolean(
    selection.requirePinnedProvenance,
    `${context}.selection.requirePinnedProvenance`,
  );
  assertString(
    selection.communityDefaultPolicy,
    `${context}.selection.communityDefaultPolicy`,
  );
  const audit = assertRecord(record.audit, `${context}.audit`);
  assertBoolean(audit.alwaysAudit, `${context}.audit.alwaysAudit`);
  assertStringArray(audit.quarantineOn, `${context}.audit.quarantineOn`);
  assertRecord(record.store, `${context}.store`);
  assertArray(record.bundleTemplates, `${context}.bundleTemplates`).forEach(
    (entry, index) => {
      const entryRecord = assertRecord(
        entry,
        `${context}.bundleTemplates[${index}]`,
      );
      assertString(entryRecord.id, `${context}.bundleTemplates[${index}].id`);
      assertLiteral(
        entryRecord.host,
        HOST_TARGETS,
        `${context}.bundleTemplates[${index}].host`,
      );
      assertAssetKindArray(
        entryRecord.assetKinds,
        `${context}.bundleTemplates[${index}].assetKinds`,
      );
    },
  );
}

export function assertBundleLock(
  value: unknown,
  context: string,
): asserts value is BundleLock {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.bundleId, `${context}.bundleId`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertLiteral(record.host, HOST_TARGETS, `${context}.host`);
  assertArray(record.assets, `${context}.assets`).forEach((entry, index) => {
    const entryRecord = assertRecord(entry, `${context}.assets[${index}]`);
    assertString(entryRecord.assetId, `${context}.assets[${index}].assetId`);
    assertString(entryRecord.mirrorId, `${context}.assets[${index}].mirrorId`);
    assertString(
      entryRecord.projectionType,
      `${context}.assets[${index}].projectionType`,
    );
    assertBoolean(
      entryRecord.activationEligible,
      `${context}.assets[${index}].activationEligible`,
    );
  });
}

export function assertMirrorIndexEntry(
  value: unknown,
  context: string,
): asserts value is MirrorIndexEntry {
  const record = assertRecord(value, context);
  assertString(record.mirrorId, `${context}.mirrorId`);
  assertString(record.assetId, `${context}.assetId`);
  const upstream = assertRecord(record.upstream, `${context}.upstream`);
  assertLiteral(upstream.type, [...UPSTREAM_TYPES], `${context}.upstream.type`);
  assertString(upstream.url, `${context}.upstream.url`);
  const source = assertRecord(record.source, `${context}.source`);
  assertLiteral(
    source.authorityTier,
    AUTHORITY_TIERS,
    `${context}.source.authorityTier`,
  );
  assertString(source.publisher, `${context}.source.publisher`);
  assertBoolean(
    source.publisherVerified,
    `${context}.source.publisherVerified`,
  );
  assertString(record.mirroredAt, `${context}.mirroredAt`);
  assertString(record.contentHash, `${context}.contentHash`);
  assertLiteral(record.status, [...MIRROR_STATUSES], `${context}.status`);
}

export function assertMirrorAcquireState(
  value: unknown,
  context: string,
): asserts value is MirrorAcquireState {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.updatedAt, `${context}.updatedAt`);
  assertNumber(record.batchSize, `${context}.batchSize`);
  assertNumber(record.totalEligibleCount, `${context}.totalEligibleCount`);
  assertNumber(record.mirroredCount, `${context}.mirroredCount`);
  assertNumber(record.remainingCount, `${context}.remainingCount`);
  assertStringArray(record.lastBatchAssetIds, `${context}.lastBatchAssetIds`);
}

export function assertInstalledPackageManifest(
  value: unknown,
  context: string,
): asserts value is InstalledPackageManifest {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.assetId, `${context}.assetId`);
  assertString(record.mirrorId, `${context}.mirrorId`);
  assertLiteral(record.host, HOST_TARGETS, `${context}.host`);
  assertString(record.installedAt, `${context}.installedAt`);
  assertLiteral(record.assetKind, ASSET_KINDS, `${context}.assetKind`);
  assertString(record.filesRoot, `${context}.filesRoot`);
  assertBoolean(record.activationEligible, `${context}.activationEligible`);
  assertBoolean(record.activeByDefault, `${context}.activeByDefault`);
}

export function assertInstalledBundleManifest(
  value: unknown,
  context: string,
): asserts value is InstalledBundleManifest {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.bundleId, `${context}.bundleId`);
  assertLiteral(record.host, HOST_TARGETS, `${context}.host`);
  assertString(record.installedAt, `${context}.installedAt`);
  assertArray(record.packages, `${context}.packages`).forEach(
    (entry, index) => {
      const entryRecord = assertRecord(entry, `${context}.packages[${index}]`);
      assertString(
        entryRecord.assetId,
        `${context}.packages[${index}].assetId`,
      );
      assertString(
        entryRecord.manifestPath,
        `${context}.packages[${index}].manifestPath`,
      );
    },
  );
}

export function assertInstallGenerationManifest(
  value: unknown,
  context: string,
): asserts value is InstallGenerationManifest {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.generationId, `${context}.generationId`);
  assertLiteral(record.host, HOST_TARGETS, `${context}.host`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertStringArray(record.bundleIds, `${context}.bundleIds`);
  assertStringArray(
    record.packageManifestPaths,
    `${context}.packageManifestPaths`,
  );
  if (record.pinned !== undefined) {
    assertBoolean(record.pinned, `${context}.pinned`);
  }
  if (record.pinReason !== undefined) {
    assertString(record.pinReason, `${context}.pinReason`);
  }
}

export function assertInstallProgressState(
  value: unknown,
  context: string,
): asserts value is InstallProgressState {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.updatedAt, `${context}.updatedAt`);
  assertRecord(record.bundles, `${context}.bundles`);
}

export function assertActivationManifest(
  value: unknown,
  context: string,
): asserts value is ActivationManifest {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertLiteral(record.host, HOST_TARGETS, `${context}.host`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertStringArray(record.activeBundles, `${context}.activeBundles`);
  assertStringArray(record.activeAssets, `${context}.activeAssets`);
  assertString(record.runtimeRoot, `${context}.runtimeRoot`);
  assertStringArray(record.notes, `${context}.notes`);
  if (record.generationId !== undefined) {
    assertString(record.generationId, `${context}.generationId`);
  }
}

export function assertRecommendationReport(
  value: unknown,
  context: string,
): asserts value is RecommendationReport {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertNumber(record.policyVersion, `${context}.policyVersion`);
  const topByHost = assertRecord(record.topByHost, `${context}.topByHost`);

  for (const expectedHost of HOST_TARGETS) {
    if (!Object.prototype.hasOwnProperty.call(topByHost, expectedHost)) {
      fail(`${context}.topByHost`, `missing expected host: ${expectedHost}`);
    }
  }

  Object.entries(topByHost).forEach(([host, entries]) => {
    assertArray(entries, `${context}.topByHost.${host}`).forEach(
      (entry, index) => {
        const entryRecord = assertRecord(
          entry,
          `${context}.topByHost.${host}[${index}]`,
        );
        assertString(
          entryRecord.assetId,
          `${context}.topByHost.${host}[${index}].assetId`,
        );
        assertLiteral(
          entryRecord.host,
          HOST_TARGETS,
          `${context}.topByHost.${host}[${index}].host`,
        );
        assertNumber(
          entryRecord.rank,
          `${context}.topByHost.${host}[${index}].rank`,
        );
        assertNumber(
          entryRecord.score,
          `${context}.topByHost.${host}[${index}].score`,
        );
        assertStringArray(
          entryRecord.reasons,
          `${context}.topByHost.${host}[${index}].reasons`,
        );
        assertString(
          entryRecord.sourceId,
          `${context}.topByHost.${host}[${index}].sourceId`,
        );
        assertString(
          entryRecord.sourceFamily,
          `${context}.topByHost.${host}[${index}].sourceFamily`,
        );
        assertLiteral(
          entryRecord.contextSizeClass,
          [...CONTEXT_COST_CLASSES],
          `${context}.topByHost.${host}[${index}].contextSizeClass`,
        );
        assertNumber(
          entryRecord.estimatedPromptWeight,
          `${context}.topByHost.${host}[${index}].estimatedPromptWeight`,
        );
        assertString(
          entryRecord.selectionStage,
          `${context}.topByHost.${host}[${index}].selectionStage`,
        );
        assertStringArray(
          entryRecord.coverageTags,
          `${context}.topByHost.${host}[${index}].coverageTags`,
        );
        assertStringArray(
          entryRecord.taskModes,
          `${context}.topByHost.${host}[${index}].taskModes`,
        );
        assertArray(
          entryRecord.matchedSignals,
          `${context}.topByHost.${host}[${index}].matchedSignals`,
        ).forEach((signal, signalIndex) => {
          const signalRecord = assertRecord(
            signal,
            `${context}.topByHost.${host}[${index}].matchedSignals[${signalIndex}]`,
          );
          assertString(
            signalRecord.term,
            `${context}.topByHost.${host}[${index}].matchedSignals[${signalIndex}].term`,
          );
          assertString(
            signalRecord.signalType,
            `${context}.topByHost.${host}[${index}].matchedSignals[${signalIndex}].signalType`,
          );
          assertNumber(
            signalRecord.weight,
            `${context}.topByHost.${host}[${index}].matchedSignals[${signalIndex}].weight`,
          );
          assertNumber(
            signalRecord.evidenceCount,
            `${context}.topByHost.${host}[${index}].matchedSignals[${signalIndex}].evidenceCount`,
          );
        });
        assertRecommendationScoreBreakdown(
          entryRecord.scoreBreakdown,
          `${context}.topByHost.${host}[${index}].scoreBreakdown`,
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
    assertLiteral(
      summaryRecord.host,
      HOST_TARGETS,
      `${context}.hostSummaries.${host}.host`,
    );
    assertNumber(
      summaryRecord.recommendationLimit,
      `${context}.hostSummaries.${host}.recommendationLimit`,
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
      assertLiteral(
        bundleRecord.host,
        HOST_TARGETS,
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
}

export function assertRecommendationPolicy(
  value: unknown,
  context: string,
): asserts value is RecommendationPolicy {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertRecommendationScoring(record.scoring, `${context}.scoring`);

  const hosts = assertRecord(record.hosts, `${context}.hosts`);
  HOST_TARGETS.forEach((host) => {
    assertRecommendationHostPolicy(
      hosts[host],
      `${context}.hosts.${host}`,
      false,
    );
  });

  assertRecommendationKeywordMaps(record, context);
}

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

export function assertRecommendationHostPolicyOverride(
  value: unknown,
  context: string,
): asserts value is RecommendationHostPolicyOverride {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertLiteral(record.host, HOST_TARGETS, `${context}.host`);
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
  assertNumber(scoring.coverageGainWeight, `${context}.coverageGainWeight`);
  assertNumber(scoring.sourceDiversityBonus, `${context}.sourceDiversityBonus`);
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

export function assertCopilotWorkspaceProfileManifest(
  value: unknown,
  context: string,
): asserts value is CopilotWorkspaceProfileManifest {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertString(record.profileId, `${context}.profileId`);
  assertString(record.workspaceRoot, `${context}.workspaceRoot`);
  assertStringArray(record.bundleIds, `${context}.bundleIds`);
  assertStringArray(record.selectedAssetIds, `${context}.selectedAssetIds`);
  if (record.selectedExtensionIds !== undefined) {
    assertStringArray(
      record.selectedExtensionIds,
      `${context}.selectedExtensionIds`,
    );
  }
  assertNumber(record.activationBudget, `${context}.activationBudget`);
}

export function assertWirePlanManifest(
  value: unknown,
  context: string,
): asserts value is WirePlanManifest {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertLiteral(record.host, [...WIRE_PLAN_HOSTS], `${context}.host`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertString(record.workspaceRoot, `${context}.workspaceRoot`);
  assertString(record.runtimeRoot, `${context}.runtimeRoot`);
  if (record.linkedPaths !== undefined) {
    assertStringArray(record.linkedPaths, `${context}.linkedPaths`);
  }
  if (record.instructionsFiles !== undefined) {
    assertStringArray(record.instructionsFiles, `${context}.instructionsFiles`);
  }
  if (record.agentFiles !== undefined) {
    assertStringArray(record.agentFiles, `${context}.agentFiles`);
  }
  if (record.skillDirs !== undefined) {
    assertStringArray(record.skillDirs, `${context}.skillDirs`);
  }
  if (record.pluginDirs !== undefined) {
    assertStringArray(record.pluginDirs, `${context}.pluginDirs`);
  }
  if (record.workflowFiles !== undefined) {
    assertStringArray(record.workflowFiles, `${context}.workflowFiles`);
  }
  if (record.referenceFiles !== undefined) {
    assertStringArray(record.referenceFiles, `${context}.referenceFiles`);
  }
  if (record.extensionIds !== undefined) {
    assertStringArray(record.extensionIds, `${context}.extensionIds`);
  }
  if (record.mcpServers !== undefined) {
    assertStringArray(record.mcpServers, `${context}.mcpServers`);
  }
  if (record.nativeInstallActions !== undefined) {
    assertStringArray(
      record.nativeInstallActions,
      `${context}.nativeInstallActions`,
    );
  }
  if (record.hookFiles !== undefined) {
    assertStringArray(record.hookFiles, `${context}.hookFiles`);
  }
  assertStringArray(record.notes, `${context}.notes`);
}

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
  if (repoSummary.description !== null) {
    assertString(repoSummary.description, `${context}.repoSummary.description`);
  }
  assertString(repoSummary.fullName, `${context}.repoSummary.fullName`);
  assertString(
    repoSummary.defaultBranch,
    `${context}.repoSummary.defaultBranch`,
  );
  if (repoSummary.updatedAt !== null) {
    assertString(repoSummary.updatedAt, `${context}.repoSummary.updatedAt`);
  }
  if (repoSummary.pushedAt !== null) {
    assertString(repoSummary.pushedAt, `${context}.repoSummary.pushedAt`);
  }
  assertNumber(repoSummary.stars, `${context}.repoSummary.stars`);
  if (repoSummary.language !== null) {
    assertString(repoSummary.language, `${context}.repoSummary.language`);
  }
  assertStringArray(repoSummary.topics, `${context}.repoSummary.topics`);
  assertBoolean(repoSummary.archived, `${context}.repoSummary.archived`);
  assertString(repoSummary.htmlUrl, `${context}.repoSummary.htmlUrl`);

  if (record.readme !== null) {
    const readme = assertRecord(record.readme, `${context}.readme`);
    assertString(readme.path, `${context}.readme.path`);
    assertString(readme.sha, `${context}.readme.sha`);
    assertNumber(readme.size, `${context}.readme.size`);
    if (readme.htmlUrl !== null) {
      assertString(readme.htmlUrl, `${context}.readme.htmlUrl`);
    }
    if (readme.downloadUrl !== null) {
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
      if (entryRecord.size !== null) {
        assertNumber(
          entryRecord.size,
          `${context}.tree.entries[${index}].size`,
        );
      }
      assertString(entryRecord.sha, `${context}.tree.entries[${index}].sha`);
    },
  );
}

function assertDemandSignalSet(value: unknown, context: string): void {
  const record = assertRecord(value, context);
  assertStringArray(record.languages, `${context}.languages`);
  assertStringArray(record.packageManagers, `${context}.packageManagers`);
  assertStringArray(record.frameworks, `${context}.frameworks`);
  assertStringArray(record.concerns, `${context}.concerns`);
  assertStringArray(record.tooling, `${context}.tooling`);
}

function assertHostTargetArray(value: unknown, context: string): void {
  assertArray(value, context).forEach((entry, index) => {
    assertLiteral(entry, HOST_TARGETS, `${context}[${index}]`);
  });
}

function assertAssetKindArray(value: unknown, context: string): void {
  assertArray(value, context).forEach((entry, index) => {
    assertLiteral(entry, ASSET_KINDS, `${context}[${index}]`);
  });
}

function assertStringArray(value: unknown, context: string): string[] {
  return assertArray(value, context).map((entry, index) =>
    assertString(entry, `${context}[${index}]`),
  );
}

function assertStringArrayRecord(value: unknown, context: string): void {
  const record = assertRecord(value, context);
  Object.entries(record).forEach(([key, entryValue]) => {
    assertStringArray(entryValue, `${context}.${key}`);
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
  assertNumber(record.freshness, `${context}.freshness`);
  assertNumber(record.costPenalty, `${context}.costPenalty`);
  assertNumber(record.riskPenalty, `${context}.riskPenalty`);
  assertNumber(record.negativePenalty, `${context}.negativePenalty`);
  assertNumber(record.redundancyPenalty, `${context}.redundancyPenalty`);
  assertNumber(record.budgetPenalty, `${context}.budgetPenalty`);
  assertNumber(record.total, `${context}.total`);
}

function assertArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(context, "expected an array");
  }

  return value;
}

function assertRecord(value: unknown, context: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(context, "expected an object");
  }

  return value as JsonRecord;
}

function assertString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    fail(context, "expected a string");
  }

  return value;
}

function assertNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    fail(context, "expected a number");
  }

  return value;
}

function assertMaybeString(
  value: unknown,
  context: string,
  required: boolean,
): void {
  if (value === undefined) {
    if (required) {
      fail(context, "expected a string");
    }
    return;
  }

  assertString(value, context);
}

function assertMaybeNumber(
  value: unknown,
  context: string,
  required: boolean,
): void {
  if (value === undefined) {
    if (required) {
      fail(context, "expected a number");
    }
    return;
  }

  assertNumber(value, context);
}

function assertMaybeArray(
  value: unknown,
  context: string,
  required: boolean,
): unknown[] | undefined {
  if (value === undefined) {
    if (required) {
      fail(context, "expected an array");
    }
    return undefined;
  }

  return assertArray(value, context);
}

function assertMaybeRecord(
  value: unknown,
  context: string,
  required: boolean,
): JsonRecord | undefined {
  if (value === undefined) {
    if (required) {
      fail(context, "expected an object");
    }
    return undefined;
  }

  return assertRecord(value, context);
}

function assertMaybeStringArray(
  value: unknown,
  context: string,
  required: boolean,
): string[] | undefined {
  if (value === undefined) {
    if (required) {
      fail(context, "expected an array");
    }
    return undefined;
  }

  return assertStringArray(value, context);
}

function assertBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    fail(context, "expected a boolean");
  }

  return value;
}

function assertLiteral<T extends string>(
  value: unknown,
  allowed: readonly T[],
  context: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(context, `expected one of ${allowed.join(", ")}`);
  }

  return value as T;
}

function fail(context: string, message: string): never {
  throw new Error(`Invalid manifest at ${context}: ${message}`);
}
