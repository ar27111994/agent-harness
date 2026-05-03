import type { GitHubRepoSnapshot } from "../github.js";
import type {
  AssetCatalogEntry,
  DemandProfile,
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

function assertDemandSignalSet(value: unknown, context: string): void {
  const record = assertRecord(value, context);
  assertStringArray(record.languages, `${context}.languages`);
  assertStringArray(record.packageManagers, `${context}.packageManagers`);
  assertStringArray(record.frameworks, `${context}.frameworks`);
  assertStringArray(record.concerns, `${context}.concerns`);
  assertStringArray(record.tooling, `${context}.tooling`);
}
