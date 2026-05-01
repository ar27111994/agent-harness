import assert from "node:assert/strict";
import test from "node:test";

import {
  collectDetectorSignals,
  isDetectorInspectableFile,
} from "../domains/discovery/detectors.js";
import type { DemandSignalSet } from "../types.js";

const cases: Array<{
  fileName: string;
  filePath: string;
  expectedConcern: string;
}> = [
  {
    fileName: "analysis.ipynb",
    filePath: "research/analysis.ipynb",
    expectedConcern: "notebooks",
  },
  {
    fileName: "dataset.parquet",
    filePath: "data/dataset.parquet",
    expectedConcern: "data",
  },
  {
    fileName: "part.step",
    filePath: "cad/part.step",
    expectedConcern: "cad",
  },
  {
    fileName: "paper.tex",
    filePath: "research/paper.tex",
    expectedConcern: "research",
  },
  {
    fileName: "model.onnx",
    filePath: "models/model.onnx",
    expectedConcern: "machine-learning",
  },
];

test("detector packs match representative non-software artifacts", () => {
  for (const fixture of cases) {
    const signals = createEmptySignalSet();

    assert.equal(
      isDetectorInspectableFile(fixture.fileName, fixture.filePath),
      true,
      fixture.filePath,
    );
    collectDetectorSignals(fixture.fileName, fixture.filePath, signals);
    assert.ok(
      signals.concerns.includes(fixture.expectedConcern),
      `${fixture.filePath} should emit ${fixture.expectedConcern}`,
    );
  }
});

function createEmptySignalSet(): DemandSignalSet {
  return {
    languages: [],
    packageManagers: [],
    frameworks: [],
    concerns: [],
    tooling: [],
  };
}
