import { listHostAdapters } from "../host-adapters/registry.js";
import { SHARED_RECOMMENDATION_HOST } from "./constants.js";
import type { HostTarget } from "../types.js";

const DISPLAY_HOST_OVERRIDES: ReadonlyMap<RecommendationHost, string> = new Map(
  [["copilot-vscode", "vscode"]],
);

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

/**
 * Returns the preferred user-facing CLI name for a recommendation host.
 */
export function formatRecommendationHostForDisplay(
  host: RecommendationHost,
): string {
  return DISPLAY_HOST_OVERRIDES.get(host) ?? host;
}

/**
 * Returns the supported user-facing CLI host choices.
 */
export function getRecommendationHostChoices(): string[] {
  return [
    ...new Set(
      getRecommendationHosts().map((host) =>
        formatRecommendationHostForDisplay(host),
      ),
    ),
  ];
}

/**
 * Resolves a user-supplied CLI host value to an internal recommendation host.
 */
export function resolveRecommendationHost(
  value: string,
): RecommendationHost | undefined {
  const normalizedValue = value.trim().toLowerCase();

  if (isRecommendationHost(normalizedValue)) {
    return normalizedValue;
  }

  for (const adapter of listHostAdapters()) {
    if (
      adapter.id === normalizedValue ||
      adapter.aliases.includes(normalizedValue) ||
      formatRecommendationHostForDisplay(adapter.recommendationHost) ===
        normalizedValue
    ) {
      return adapter.recommendationHost;
    }
  }

  return normalizedValue ===
    formatRecommendationHostForDisplay(SHARED_RECOMMENDATION_HOST)
    ? SHARED_RECOMMENDATION_HOST
    : undefined;
}
