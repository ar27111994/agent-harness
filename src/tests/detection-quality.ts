import assert from "node:assert/strict";

import {
  collectDetectorSignals,
  isDetectorInspectableFile,
} from "../domains/discovery/detectors.js";
import { ROADMAP_DETECTION_FIXTURES } from "./detection-fixtures.js";
import type { DemandSignalSet } from "../types.js";

const fixtures = ROADMAP_DETECTION_FIXTURES;

const results = fixtures.map((fixture) => {
  const signals = createEmptySignalSet();
  const inspected = isDetectorInspectableFile(
    fixture.fileName,
    fixture.filePath,
  );
  if (inspected) {
    collectDetectorSignals(fixture.fileName, fixture.filePath, signals);
  }

  const expectedMatches = fixture.expectedConcerns.filter((concern) =>
    signals.concerns.includes(concern),
  ).length;
  const expectedConcernSet = new Set(fixture.expectedConcerns);
  const unexpectedMatches = (fixture.unexpectedConcerns ?? []).filter(
    (concern) => signals.concerns.includes(concern),
  ).length;
  const truePositiveConcerns = signals.concerns.filter((concern) =>
    expectedConcernSet.has(concern),
  ).length;
  const precision =
    signals.concerns.length === 0
      ? 0
      : Math.max(truePositiveConcerns - unexpectedMatches, 0) /
        signals.concerns.length;
  const recall = expectedMatches / fixture.expectedConcerns.length;

  return {
    archetype: fixture.archetype,
    inspected,
    precision,
    recall,
    concerns: signals.concerns,
  };
});

const averagePrecision = average(results.map((result) => result.precision));
const averageRecall = average(results.map((result) => result.recall));

assert.ok(
  averagePrecision >= 0.8,
  `precision ${averagePrecision} below budget`,
);
assert.ok(averageRecall >= 0.8, `recall ${averageRecall} below budget`);

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      averagePrecision,
      averageRecall,
      results,
    },
    null,
    2,
  ),
);

function createEmptySignalSet(): DemandSignalSet {
  return {
    languages: [],
    packageManagers: [],
    frameworks: [],
    concerns: [],
    tooling: [],
  };
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}
