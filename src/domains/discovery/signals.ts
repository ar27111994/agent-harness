import type { DemandSignalSet } from "../../types.js";

export function addSignals(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

export function mergeSignals(
  target: DemandSignalSet,
  source: DemandSignalSet,
): void {
  addSignals(target.languages, source.languages);
  addSignals(target.packageManagers, source.packageManagers);
  addSignals(target.frameworks, source.frameworks);
  addSignals(target.concerns, source.concerns);
  addSignals(target.tooling, source.tooling);
}

export function sortSignalSet(signalSet: DemandSignalSet): DemandSignalSet {
  return {
    languages: [...signalSet.languages].sort(),
    packageManagers: [...signalSet.packageManagers].sort(),
    frameworks: [...signalSet.frameworks].sort(),
    concerns: [...signalSet.concerns].sort(),
    tooling: [...signalSet.tooling].sort(),
  };
}

export function createEmptySignalSet(): DemandSignalSet {
  return {
    languages: [],
    packageManagers: [],
    frameworks: [],
    concerns: [],
    tooling: [],
  };
}

export function hasAnySignals(signalSet: DemandSignalSet): boolean {
  return [
    signalSet.languages,
    signalSet.packageManagers,
    signalSet.frameworks,
    signalSet.concerns,
    signalSet.tooling,
  ].some((values) => values.length > 0);
}
