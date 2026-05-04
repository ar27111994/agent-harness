import { listHostAdapters } from "../host-adapters/registry.js";
import { SHARED_RECOMMENDATION_HOST } from "./constants.js";
import type { HostTarget } from "../types.js";

/**
 * Defines the supported recommendation host values.
 */
export type RecommendationHost = HostTarget;

/**
 * Returns get recommendation hosts for the provided inputs.
 */
export function getRecommendationHosts(): RecommendationHost[] {
  return [
    ...new Set([
      SHARED_RECOMMENDATION_HOST,
      ...listHostAdapters().map((adapter) => adapter.recommendationHost),
    ]),
  ];
}

/**
 * Returns whether the provided value matches recommendation host.
 */
export function isRecommendationHost(
  value: string,
): value is RecommendationHost {
  return getRecommendationHosts().includes(value as RecommendationHost);
}
