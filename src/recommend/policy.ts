import { join } from "node:path";

import { getRuntimeConfig } from "../config/runtime.js";
import { pathExists, readJsonFile, readJsonFileOrNull } from "../files.js";
import { listHostAdapters } from "../host-adapters/registry.js";
import {
  assertRecommendationHostPolicyOverride,
  assertRecommendationPolicy,
  assertRecommendationPolicyBase,
  assertRecommendationPolicyBaseOverride,
} from "../manifest-validation.js";
import {
  LEGACY_POLICY_FILE_PATH,
  POLICY_BASE_FILE_PATH,
  POLICY_HOST_DIRECTORY_PATH,
  POLICY_OVERRIDE_BASE_FILE_PATH,
  POLICY_OVERRIDE_HOST_DIRECTORY_PATH,
} from "./constants.js";
import { getRecommendationHosts } from "./hosts.js";
import type {
  AssetKind,
  RecommendationHostPolicy,
  RecommendationHostPolicyOverride,
  RecommendationLimitOverrideMode,
  RecommendationPolicy,
  RecommendationPolicyBase,
  RecommendationPolicyBaseOverride,
  RecommendationPolicyPresetRefs,
  RecommendationPolicyPresets,
  RecommendationTargetAssetKindPreference,
  RecommendationTargetConcernPreference,
} from "../types.js";
import type { RecommendationHost } from "./hosts.js";

/**
 * Loads recommendation policy from project state.
 */
export async function loadRecommendationPolicy(
  projectRoot: string,
): Promise<RecommendationPolicy> {
  const basePolicyPath = join(projectRoot, ...POLICY_BASE_FILE_PATH);
  const basePolicy =
    await readJsonFileOrNull<RecommendationPolicyBase>(basePolicyPath);

  if (!basePolicy) {
    return readJsonFile<RecommendationPolicy>(
      join(projectRoot, ...LEGACY_POLICY_FILE_PATH),
      assertRecommendationPolicy,
    );
  }

  assertRecommendationPolicyBase(basePolicy, basePolicyPath);

  const baseOverridePath = join(projectRoot, ...POLICY_OVERRIDE_BASE_FILE_PATH);
  const baseOverride =
    await readJsonFileOrNull<RecommendationPolicyBaseOverride>(
      baseOverridePath,
    );
  if (baseOverride) {
    assertRecommendationPolicyBaseOverride(baseOverride, baseOverridePath);
    if (baseOverride.schemaVersion !== basePolicy.schemaVersion) {
      throw new Error(
        `Recommendation policy schema mismatch for user base override: expected ${basePolicy.schemaVersion}, received ${baseOverride.schemaVersion}`,
      );
    }
  }

  const recommendationHosts = getRecommendationHosts();
  const defaultHostOverrides = await loadRecommendationHostOverrides(
    projectRoot,
    POLICY_HOST_DIRECTORY_PATH,
    recommendationHosts,
    basePolicy.schemaVersion,
    true,
  );
  const userHostOverrides = await loadRecommendationHostOverrides(
    projectRoot,
    POLICY_OVERRIDE_HOST_DIRECTORY_PATH,
    recommendationHosts,
    basePolicy.schemaVersion,
    false,
  );

  const mergedBasePolicy = mergeRecommendationPolicyBase(
    basePolicy,
    baseOverride ?? undefined,
  );
  const mergedHostOverrides = Object.fromEntries(
    recommendationHosts.map((host) => [
      host,
      mergeRecommendationHostPolicyOverride(
        defaultHostOverrides[host],
        userHostOverrides[host],
      ),
    ]),
  ) as Record<RecommendationHost, RecommendationHostPolicyOverride>;

  const policy = applyRecommendationRuntimeOverrides(
    buildRecommendationPolicyFromSplitFiles(
      mergedBasePolicy,
      mergedHostOverrides,
      recommendationHosts,
    ),
  );

  assertRecommendationPolicy(policy, "recommendation-policy");
  return policy;
}

async function loadRecommendationHostOverrides(
  projectRoot: string,
  directoryPath: readonly string[],
  recommendationHosts: readonly RecommendationHost[],
  schemaVersion: number,
  buildDefaultsWhenMissing: true,
): Promise<Record<RecommendationHost, RecommendationHostPolicyOverride>>;
async function loadRecommendationHostOverrides(
  projectRoot: string,
  directoryPath: readonly string[],
  recommendationHosts: readonly RecommendationHost[],
  schemaVersion: number,
  buildDefaultsWhenMissing: false,
): Promise<
  Partial<Record<RecommendationHost, RecommendationHostPolicyOverride>>
>;
async function loadRecommendationHostOverrides(
  projectRoot: string,
  directoryPath: readonly string[],
  recommendationHosts: readonly RecommendationHost[],
  schemaVersion: number,
  buildDefaultsWhenMissing: boolean,
): Promise<
  Partial<Record<RecommendationHost, RecommendationHostPolicyOverride>>
> {
  const hostOverrides = await Promise.all(
    recommendationHosts.map(async (host) => {
      const overridePath = join(projectRoot, ...directoryPath, `${host}.json`);
      const override = (await pathExists(overridePath))
        ? await readJsonFile<RecommendationHostPolicyOverride>(
            overridePath,
            assertRecommendationHostPolicyOverride,
          )
        : buildDefaultsWhenMissing
          ? buildDefaultRecommendationHostPolicyOverride(host, schemaVersion)
          : undefined;

      if (!override) {
        return [host, undefined] as const;
      }

      if (override.schemaVersion !== schemaVersion) {
        throw new Error(
          `Recommendation policy schema mismatch for ${host}: expected ${schemaVersion}, received ${override.schemaVersion}`,
        );
      }

      if (override.host !== host) {
        throw new Error(
          `Recommendation host policy file ${overridePath} declares host ${override.host} instead of ${host}`,
        );
      }

      return [host, override] as const;
    }),
  );

  return Object.fromEntries(hostOverrides) as Partial<
    Record<RecommendationHost, RecommendationHostPolicyOverride>
  >;
}

function mergeRecommendationPolicyBase(
  basePolicy: RecommendationPolicyBase,
  overridePolicy: RecommendationPolicyBaseOverride | undefined,
): RecommendationPolicyBase {
  if (!overridePolicy) {
    return basePolicy;
  }

  return {
    schemaVersion: basePolicy.schemaVersion,
    scoring: overridePolicy.scoring ?? basePolicy.scoring,
    hostDefaults: mergeRecommendationHostPolicy(
      basePolicy.hostDefaults ?? {},
      overridePolicy.hostDefaults ?? {},
    ),
    presets: mergeRecommendationPolicyPresets(
      basePolicy.presets,
      overridePolicy.presets,
    ),
    concernKeywordMap: mergeKeywordMapRecords(
      basePolicy.concernKeywordMap,
      overridePolicy.concernKeywordMap,
    ),
    taskModeKeywordMap: mergeKeywordMapRecords(
      basePolicy.taskModeKeywordMap,
      overridePolicy.taskModeKeywordMap,
    ),
    domainKeywordGroups: mergeKeywordMapRecords(
      basePolicy.domainKeywordGroups,
      overridePolicy.domainKeywordGroups,
    ),
    synonyms: mergeKeywordMapRecords(
      basePolicy.synonyms,
      overridePolicy.synonyms,
    ),
  };
}

function mergeRecommendationPolicyPresets(
  basePresets: RecommendationPolicyPresets | undefined,
  overridePresets: RecommendationPolicyPresets | undefined,
): RecommendationPolicyPresets | undefined {
  if (!basePresets && !overridePresets) {
    return undefined;
  }

  return {
    targetAssetKinds: {
      ...(basePresets?.targetAssetKinds ?? {}),
      ...(overridePresets?.targetAssetKinds ?? {}),
    },
    targetConcerns: {
      ...(basePresets?.targetConcerns ?? {}),
      ...(overridePresets?.targetConcerns ?? {}),
    },
  };
}

function mergeKeywordMapRecords(
  baseRecord: Record<string, string[]>,
  overrideRecord: Record<string, string[]> | undefined,
): Record<string, string[]> {
  return {
    ...baseRecord,
    ...(overrideRecord ?? {}),
  };
}

function mergeRecommendationHostPolicyOverride(
  baseOverride: RecommendationHostPolicyOverride,
  userOverride: RecommendationHostPolicyOverride | undefined,
): RecommendationHostPolicyOverride {
  if (!userOverride) {
    return baseOverride;
  }

  return {
    schemaVersion: baseOverride.schemaVersion,
    host: baseOverride.host,
    presetRefs: mergeRecommendationPolicyPresetRefs(
      baseOverride.presetRefs,
      userOverride.presetRefs,
    ),
    policy: mergeRecommendationHostPolicy(
      baseOverride.policy,
      userOverride.policy,
    ),
  };
}

function mergeRecommendationPolicyPresetRefs(
  basePresetRefs: RecommendationPolicyPresetRefs | undefined,
  userPresetRefs: RecommendationPolicyPresetRefs | undefined,
): RecommendationPolicyPresetRefs | undefined {
  const targetAssetKinds = mergeOptionalUniqueStrings(
    basePresetRefs?.targetAssetKinds,
    userPresetRefs?.targetAssetKinds,
  );
  const targetConcerns = mergeOptionalUniqueStrings(
    basePresetRefs?.targetConcerns,
    userPresetRefs?.targetConcerns,
  );

  if (!targetAssetKinds && !targetConcerns) {
    return undefined;
  }

  return {
    targetAssetKinds,
    targetConcerns,
  };
}

function applyRecommendationRuntimeOverrides(
  policy: RecommendationPolicy,
): RecommendationPolicy {
  const recommendationRuntime = getRuntimeConfig().recommendation;

  return {
    ...policy,
    hosts: Object.fromEntries(
      Object.entries(policy.hosts).map(([host, hostPolicy]) => [
        host,
        applyRecommendationHostRuntimeOverrides(
          hostPolicy,
          recommendationRuntime.limitOverrides[host],
          recommendationRuntime.limitOverrideModes[host],
        ),
      ]),
    ) as RecommendationPolicy["hosts"],
  };
}

function applyRecommendationHostRuntimeOverrides(
  hostPolicy: RecommendationHostPolicy,
  limitOverride: { value: number; envVar: string } | undefined,
  modeOverride:
    | { value: RecommendationLimitOverrideMode; envVar: string }
    | undefined,
): RecommendationHostPolicy {
  const overrideMode =
    modeOverride?.value ??
    hostPolicy.recommendationLimitOverrideMode ??
    "preserve";
  const normalizedPolicy: RecommendationHostPolicy = {
    ...hostPolicy,
    recommendationLimitOverrideMode: overrideMode,
    recommendationLimitScaleFactor: undefined,
    recommendationLimitScaledFields: undefined,
  };

  if (!limitOverride) {
    return normalizedPolicy;
  }

  if (overrideMode !== "scale") {
    return {
      ...normalizedPolicy,
      recommendationLimit: limitOverride.value,
    };
  }

  return scaleRecommendationHostPolicy(normalizedPolicy, limitOverride.value);
}

function scaleRecommendationHostPolicy(
  hostPolicy: RecommendationHostPolicy,
  nextRecommendationLimit: number,
): RecommendationHostPolicy {
  const previousRecommendationLimit = Math.max(
    1,
    hostPolicy.recommendationLimit,
  );
  const scaleFactor = nextRecommendationLimit / previousRecommendationLimit;
  const scaledFields: string[] = [];

  const fallbackSkillCount = scaleOptionalPolicyCount(
    hostPolicy.fallbackSkillCount,
    scaleFactor,
    "fallbackSkillCount",
    scaledFields,
  );
  const maxPerSourceFamily = scalePolicyCount(
    hostPolicy.maxPerSourceFamily,
    scaleFactor,
    "maxPerSourceFamily",
    scaledFields,
  );
  const maxPerDuplicateGroup = scalePolicyCount(
    hostPolicy.maxPerDuplicateGroup,
    scaleFactor,
    "maxPerDuplicateGroup",
    scaledFields,
  );
  const sourceSaturationFreeCount = scaleOptionalPolicyCount(
    hostPolicy.sourceSaturationFreeCount,
    scaleFactor,
    "sourceSaturationFreeCount",
    scaledFields,
    true,
  );
  const maxPerAssetKind = Object.fromEntries(
    Object.entries(hostPolicy.maxPerAssetKind).map(([assetKind, value]) => {
      const scaledValue = scalePolicyCount(
        value,
        scaleFactor,
        `maxPerAssetKind.${assetKind}`,
        scaledFields,
      );
      return [assetKind, scaledValue];
    }),
  ) as RecommendationHostPolicy["maxPerAssetKind"];
  const targetAssetKinds = hostPolicy.targetAssetKinds.map((entry) => ({
    ...entry,
    minimum: scalePolicyCount(
      entry.minimum,
      scaleFactor,
      `targetAssetKinds.${entry.assetKind}.minimum`,
      scaledFields,
    ),
  }));
  const targetConcerns = hostPolicy.targetConcerns.map((entry) => ({
    ...entry,
    minimum: scalePolicyCount(
      entry.minimum,
      scaleFactor,
      `targetConcerns.${entry.concern}.minimum`,
      scaledFields,
    ),
  }));

  return {
    ...hostPolicy,
    recommendationLimit: nextRecommendationLimit,
    recommendationLimitOverrideMode: "scale",
    recommendationLimitScaleFactor: scaleFactor,
    recommendationLimitScaledFields: [...new Set(scaledFields)].sort(),
    fallbackSkillCount,
    maxPerSourceFamily,
    maxPerDuplicateGroup,
    sourceSaturationFreeCount,
    maxPerAssetKind,
    targetAssetKinds,
    targetConcerns,
  };
}

function scaleOptionalPolicyCount(
  value: number | undefined,
  scaleFactor: number,
  fieldName: string,
  scaledFields: string[],
  allowZero = false,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return scalePolicyCount(
    value,
    scaleFactor,
    fieldName,
    scaledFields,
    allowZero,
  );
}

function scalePolicyCount(
  value: number,
  scaleFactor: number,
  fieldName: string,
  scaledFields: string[],
  allowZero = false,
): number {
  if (value === 0) {
    return 0;
  }

  const scaledValue = allowZero
    ? Math.max(0, Math.round(value * scaleFactor))
    : Math.max(1, Math.round(value * scaleFactor));

  if (scaledValue !== value) {
    scaledFields.push(fieldName);
  }

  return scaledValue;
}

function buildDefaultRecommendationHostPolicyOverride(
  host: RecommendationHost,
  schemaVersion: number,
): RecommendationHostPolicyOverride {
  const adapter = listHostAdapters().find(
    (entry) => entry.recommendationHost === host,
  );

  return {
    schemaVersion,
    host,
    policy: {
      recommendationLimit: 12,
      activationBudget: 2_500,
      suggestedBundleId: adapter?.defaultBundleIds[0] ?? `${host}-bundle`,
      recommendationLimitOverrideMode: "preserve",
      fallbackSkillCount: 4,
      maxPerSourceFamily: 4,
      maxPerDuplicateGroup: 2,
      maxPerAssetKind: {},
      targetAssetKinds: [],
      targetConcerns: [],
      suppressedAssetIdPatterns: [],
      suppressedCapabilityTerms: [],
    },
  };
}

function buildRecommendationPolicyFromSplitFiles(
  basePolicy: RecommendationPolicyBase,
  hostOverrides: Record<RecommendationHost, RecommendationHostPolicyOverride>,
  recommendationHosts: readonly RecommendationHost[],
): RecommendationPolicy {
  const hostDefaults = basePolicy.hostDefaults ?? {};
  const presets = basePolicy.presets;

  return {
    schemaVersion: basePolicy.schemaVersion,
    scoring: basePolicy.scoring,
    hosts: Object.fromEntries(
      recommendationHosts.map((host) => [
        host,
        mergeRecommendationHostPolicy(
          hostDefaults,
          buildRecommendationHostPolicyFromPresets(
            host,
            presets,
            hostOverrides[host].presetRefs,
          ),
          hostOverrides[host].policy,
        ),
      ]),
    ) as Record<RecommendationHost, RecommendationHostPolicy>,
    concernKeywordMap: basePolicy.concernKeywordMap,
    taskModeKeywordMap: basePolicy.taskModeKeywordMap,
    domainKeywordGroups: basePolicy.domainKeywordGroups,
    synonyms: basePolicy.synonyms,
  };
}

function mergeRecommendationHostPolicy(
  ...layers: Array<Partial<RecommendationHostPolicy>>
): RecommendationHostPolicy {
  const scalarPolicy = layers.reduce<Partial<RecommendationHostPolicy>>(
    (mergedPolicy, layer) => ({ ...mergedPolicy, ...layer }),
    {},
  );
  const maxPerAssetKind = layers.reduce<Partial<Record<AssetKind, number>>>(
    (mergedLimits, layer) => ({
      ...mergedLimits,
      ...(layer.maxPerAssetKind ?? {}),
    }),
    {},
  );

  return {
    ...scalarPolicy,
    maxPerAssetKind,
    targetAssetKinds: mergeByStableKey(
      layers.flatMap((layer) => layer.targetAssetKinds ?? []),
      (entry) => entry.assetKind,
    ),
    targetConcerns: mergeByStableKey(
      layers.flatMap((layer) => layer.targetConcerns ?? []),
      (entry) => entry.concern,
    ),
    suppressedAssetIdPatterns: mergeUniqueStrings(
      ...layers.map((layer) => layer.suppressedAssetIdPatterns),
    ),
    suppressedCapabilityTerms: mergeUniqueStrings(
      ...layers.map((layer) => layer.suppressedCapabilityTerms),
    ),
    deprioritizedAssetIdPatterns: mergeOptionalUniqueStrings(
      ...layers.map((layer) => layer.deprioritizedAssetIdPatterns),
    ),
    deprioritizedCapabilityTerms: mergeOptionalUniqueStrings(
      ...layers.map((layer) => layer.deprioritizedCapabilityTerms),
    ),
    recommendationLimitScaledFields: mergeOptionalUniqueStrings(
      ...layers.map((layer) => layer.recommendationLimitScaledFields),
    ),
  } as RecommendationHostPolicy;
}

function buildRecommendationHostPolicyFromPresets(
  host: RecommendationHost,
  presets: RecommendationPolicyPresets | undefined,
  presetRefs: RecommendationPolicyPresetRefs | undefined,
): Partial<RecommendationHostPolicy> {
  if (!presetRefs) {
    return {};
  }

  return {
    targetAssetKinds: resolveTargetAssetKindPresets(
      host,
      presets?.targetAssetKinds,
      presetRefs.targetAssetKinds,
    ),
    targetConcerns: resolveTargetConcernPresets(
      host,
      presets?.targetConcerns,
      presetRefs.targetConcerns,
    ),
  };
}

function resolveTargetAssetKindPresets(
  host: RecommendationHost,
  presetCatalog: RecommendationPolicyPresets["targetAssetKinds"],
  presetRefs: string[] | undefined,
): RecommendationTargetAssetKindPreference[] | undefined {
  if (!presetRefs || presetRefs.length === 0) {
    return undefined;
  }

  if (!presetCatalog) {
    throw new Error(
      `Recommendation policy for ${host} references targetAssetKinds presets, but no targetAssetKinds presets are defined.`,
    );
  }

  return mergeByStableKey(
    presetRefs.flatMap((presetName) => {
      const preset = presetCatalog[presetName];
      if (!preset) {
        throw new Error(
          `Recommendation policy for ${host} references missing targetAssetKinds preset ${presetName}.`,
        );
      }
      return preset;
    }),
    (entry) => entry.assetKind,
  );
}

function resolveTargetConcernPresets(
  host: RecommendationHost,
  presetCatalog: RecommendationPolicyPresets["targetConcerns"],
  presetRefs: string[] | undefined,
): RecommendationTargetConcernPreference[] | undefined {
  if (!presetRefs || presetRefs.length === 0) {
    return undefined;
  }

  if (!presetCatalog) {
    throw new Error(
      `Recommendation policy for ${host} references targetConcerns presets, but no targetConcerns presets are defined.`,
    );
  }

  return mergeByStableKey(
    presetRefs.flatMap((presetName) => {
      const preset = presetCatalog[presetName];
      if (!preset) {
        throw new Error(
          `Recommendation policy for ${host} references missing targetConcerns preset ${presetName}.`,
        );
      }
      return preset;
    }),
    (entry) => entry.concern,
  );
}

function mergeUniqueStrings(
  ...collections: Array<string[] | undefined>
): string[] {
  return [...new Set(collections.flatMap((collection) => collection ?? []))];
}

function mergeByStableKey<T>(
  items: T[],
  keySelector: (item: T) => string,
): T[] {
  const orderedKeys: string[] = [];
  const entryByKey = new Map<string, T>();

  for (const item of items) {
    const key = keySelector(item);
    if (!entryByKey.has(key)) {
      orderedKeys.push(key);
    }
    entryByKey.set(key, item);
  }

  return orderedKeys.map((key) => entryByKey.get(key) as T);
}

function mergeOptionalUniqueStrings(
  ...collections: Array<string[] | undefined>
): string[] | undefined {
  const merged = mergeUniqueStrings(...collections);
  return merged.length > 0 ? merged : undefined;
}
