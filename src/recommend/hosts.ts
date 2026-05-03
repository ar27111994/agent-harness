import { listHostAdapters } from "../host-adapters/registry.js";
import { SHARED_RECOMMENDATION_HOST } from "./constants.js";
import type { HostTarget } from "../types.js";

export type RecommendationHost = HostTarget;

export function getRecommendationHosts(): RecommendationHost[] {
  return [
    ...new Set([
      SHARED_RECOMMENDATION_HOST,
      ...listHostAdapters().map((adapter) => adapter.recommendationHost),
    ]),
  ];
}

export function isRecommendationHost(
  value: string,
): value is RecommendationHost {
  return getRecommendationHosts().includes(value as RecommendationHost);
}
