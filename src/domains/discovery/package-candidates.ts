import type { DemandProfile } from "../../types.js";

export type PackageRegistryKind =
  | "npm"
  | "pypi"
  | "cargo"
  | "go"
  | "maven"
  | "nuget"
  | "gem"
  | "packagist"
  | "swift";

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
