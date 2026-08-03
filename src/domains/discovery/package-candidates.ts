import { getRuntimeConfig } from "../../config/runtime.js";
import type { DemandProfile } from "../../types.js";

const NPM_MCP_SEARCH_TERM_STOPLIST = new Set([
  "api",
  "backend",
  "cloud",
  "data",
  "frontend",
  "integration",
  "mobile",
  "npm",
  "service",
  "testing",
]);

/**
 * Defines the supported package registry kind values.
 */
export type PackageRegistryKind =
  | "npm"
  | "pypi"
  | "cargo"
  | "go"
  | "maven"
  | "nuget"
  | "gem"
  | "packagist"
  | "swift"
  | "pub";

/**
 * Collects package candidates from demand profile from the provided inputs.
 */
export function collectPackageCandidatesFromDemandProfile(
  demandProfile: DemandProfile | null,
  registryKind: PackageRegistryKind,
): string[] {
  if (!demandProfile) {
    return [];
  }

  const packageCandidates = new Set<string>();

  for (const evidence of demandProfile.evidence) {
    const joinedSignals = [
      ...evidence.matchedSignals.frameworks,
      ...evidence.matchedSignals.concerns,
      ...evidence.matchedSignals.tooling,
    ];

    for (const signal of joinedSignals) {
      const dependencyPrefix = `${registryKind}:`;
      if (signal.startsWith(dependencyPrefix)) {
        packageCandidates.add(signal.slice(dependencyPrefix.length));
      }
    }
  }

  return [...packageCandidates].sort((left, right) =>
    left.localeCompare(right),
  );
}

/**
 * Builds npm search queries for executable MCP server package discovery from
 * workspace demand signals instead of a checked-in package allowlist.
 */
export function collectNpmMcpSearchQueriesFromDemandProfile(
  demandProfile: DemandProfile | null,
): string[] {
  if (!demandProfile) {
    return [];
  }

  const demandTerms = [
    ...new Set(
      [
        ...demandProfile.signals.frameworks,
        ...demandProfile.signals.concerns,
        ...demandProfile.signals.tooling,
      ]
        .flatMap(splitIntoTerms)
        .filter((term) => term.length >= 3)
        .filter((term) => !NPM_MCP_SEARCH_TERM_STOPLIST.has(term)),
    ),
  ];

  const queries: string[] = [];
  if (demandTerms.includes("mcp")) {
    queries.push("keywords:mcp-server", "model context protocol server");
  }

  for (const term of demandTerms) {
    if (term !== "mcp") {
      queries.push(`${term} mcp server`);
    }
  }

  return [...new Set(queries)].slice(
    0,
    getRuntimeConfig().discovery.npmMcpSearchQueryLimit,
  );
}

function splitIntoTerms(value: string): string[] {
  return value
    .replace(/^(npm|pypi|cargo|go|maven|nuget|gem|packagist|swift|pub):/u, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((term) => term.length > 0);
}
