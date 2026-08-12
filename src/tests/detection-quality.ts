import assert from "node:assert/strict";

import {
  collectDetectorSignals,
  isDetectorInspectableFile,
} from "../domains/discovery/detectors.js";
import { createEmptySignalSet } from "../domains/discovery/signals.js";
import {
  type DetectionFixture,
  ROADMAP_DETECTION_FIXTURES,
} from "./detection-fixtures.js";

// The roadmap fixtures are all positive detection cases. A NEGATIVE control
// is added HERE (not to the shared roadmap list) because the detector
// registry currently recognizes every inspectable shape: an unknown binary
// blob is the honest negative — nothing to detect, and the harness must not
// hallucinate concerns for it. Should a future detector claim .bin files,
// the control's zero-emission assertion below would force a deliberate
// decision instead of silently blurring the negative case.
const fixtures: DetectionFixture[] = [
  ...ROADMAP_DETECTION_FIXTURES,
  {
    archetype: "negative-control",
    fileName: "blob.bin",
    filePath: "assets/unknown/blob.bin",
    expectedConcerns: [],
  },
];

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
  // A fixture that expects NOTHING (negative control) that also emits
  // nothing is perfectly precise and perfectly recalled — 0/0 must not be
  // reported as 0 precision, and NaN recall must never poison the averages.
  const precision =
    signals.concerns.length === 0
      ? fixture.expectedConcerns.length === 0
        ? 1
        : 0
      : truePositiveConcerns / signals.concerns.length;
  const recall =
    fixture.expectedConcerns.length === 0
      ? 1
      : expectedMatches / fixture.expectedConcerns.length;

  return {
    archetype: fixture.archetype,
    fileName: fixture.fileName,
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
// averages — every POSITIVE fixture must detect at least half of its
// expected concerns (recall >= 0.5) and stay precise (precision >= 0.5).
// Negative controls skip the floors entirely (they expect nothing) but must
// never hallucinate concerns (review: guard the recall floor against
// fixtures with no expected concerns).
for (let index = 0; index < results.length; index += 1) {
  const fixture = fixtures[index];
  const result = results[index];
  const expectsNoConcerns = fixture.expectedConcerns.length === 0;
  assert.ok(
    expectsNoConcerns || result.inspected,
    `fixture "${result.archetype}" (${result.fileName}) must be inspectable when concerns are expected`,
  );
  if (expectsNoConcerns) {
    assert.equal(
      result.concerns.length,
      0,
      `negative control fixture "${fixture.fileName}" must not hallucinate concerns, got ${JSON.stringify(
        result.concerns,
      )}`,
    );
    continue;
  }
  assert.ok(
    result.precision >= 0.5,
    `fixture "${result.archetype}" (${result.fileName}) precision ${result.precision} below per-fixture floor`,
  );
  assert.ok(
    result.recall >= 0.5,
    `fixture "${result.archetype}" (${result.fileName}) recall ${result.recall} below per-fixture floor`,
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
