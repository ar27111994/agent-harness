import { join } from "node:path";

import { getRuntimeConfig } from "../config/runtime.js";
import { pathExists, readJsonFile, readJsonFileOrNull } from "../files.js";
import { listHostAdapters } from "../host-adapters/registry.js";
import {
  assertRecommendationHostPolicyOverride,
  assertRecommendationPolicy,
  assertRecommendationPolicyBase,
} from "../manifest-validation.js";
import {
  LEGACY_POLICY_FILE_PATH,
  POLICY_BASE_FILE_PATH,
  POLICY_HOST_DIRECTORY_PATH,
} from "./constants.js";
import { getRecommendationHosts } from "./hosts.js";
import type {
  AssetKind,
  RecommendationHostPolicy,
  RecommendationHostPolicyOverride,
  RecommendationPolicy,
  RecommendationPolicyBase,
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

  const recommendationHosts = getRecommendationHosts();
  const hostOverrides = await Promise.all(
    recommendationHosts.map(async (host) => {
      const overridePath = join(
        projectRoot,
        ...POLICY_HOST_DIRECTORY_PATH,
        `${host}.json`,
      );
      const override = (await pathExists(overridePath))
        ? await readJsonFile<RecommendationHostPolicyOverride>(
            overridePath,
            assertRecommendationHostPolicyOverride,
          )
        : buildDefaultRecommendationHostPolicyOverride(
            host,
            basePolicy.schemaVersion,
          );

      if (override.schemaVersion !== basePolicy.schemaVersion) {
        throw new Error(
          `Recommendation policy schema mismatch for ${host}: expected ${basePolicy.schemaVersion}, received ${override.schemaVersion}`,
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

  const policy = applyRecommendationRuntimeOverrides(
    buildRecommendationPolicyFromSplitFiles(
      basePolicy,
      Object.fromEntries(hostOverrides) as Record<
        RecommendationHost,
        RecommendationHostPolicyOverride
      >,
      recommendationHosts,
    ),
  );

  assertRecommendationPolicy(policy, "recommendation-policy");
  return policy;
}

function applyRecommendationRuntimeOverrides(
  policy: RecommendationPolicy,
): RecommendationPolicy {
  const limitOverrides = getRuntimeConfig().recommendation.limitOverrides;

  return {
    ...policy,
    hosts: Object.fromEntries(
      Object.entries(policy.hosts).map(([host, hostPolicy]) => {
        const override = limitOverrides[host];
        return [
          host,
          override
            ? { ...hostPolicy, recommendationLimit: override.value }
            : hostPolicy,
        ];
      }),
    ) as RecommendationPolicy["hosts"],
  };
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
