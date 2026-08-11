import assert from "node:assert/strict";

import {
  collectDetectorSignals,
  isDetectorInspectableFile,
} from "../domains/discovery/detectors.js";
import { createEmptySignalSet } from "../domains/discovery/signals.js";
import { ROADMAP_DETECTION_FIXTURES } from "./detection-fixtures.js";

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
  const truePositiveConcerns = signals.concerns.filter((concern) =>
    expectedConcernSet.has(concern),
  ).length;
  const precision =
    signals.concerns.length === 0
      ? 0
      : truePositiveConcerns / signals.concerns.length;
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

// Review: per-fixture floors so one weak archetype cannot hide behind the
// averages — every fixture must detect at least half of its expected
// concerns (recall >= 0.5) and stay precise (precision >= 0.5), and every
// fixture must be inspected at all.
for (const result of results) {
  assert.ok(
    result.inspected,
    `fixture "${result.archetype}" (${result.concerns}) must be inspectable`,
  );
  assert.ok(
    result.precision >= 0.5,
    `fixture "${result.archetype}" precision ${result.precision} below per-fixture floor`,
  );
  assert.ok(
    result.recall >= 0.5,
    `fixture "${result.archetype}" recall ${result.recall} below per-fixture floor`,
  );
}

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

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}
