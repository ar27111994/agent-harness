import assert from "node:assert/strict";
import test from "node:test";

import {
  collectDetectorSignals,
  isDetectorInspectableFile,
} from "../domains/discovery/detectors.js";
import { createEmptySignalSet } from "../domains/discovery/signals.js";
import { ROADMAP_DETECTION_FIXTURES } from "./detection-fixtures.js";

void test("detector packs match representative non-software artifacts", () => {
  for (const fixture of ROADMAP_DETECTION_FIXTURES) {
    const signals = createEmptySignalSet();

    assert.equal(
      isDetectorInspectableFile(fixture.fileName, fixture.filePath),
      true,
      fixture.filePath,
    );
    collectDetectorSignals(fixture.fileName, fixture.filePath, signals);
    for (const expectedConcern of fixture.expectedConcerns) {
      assert.ok(
        signals.concerns.includes(expectedConcern),
        `${fixture.filePath} should emit ${expectedConcern}`,
      );
    }
    for (const unexpectedConcern of fixture.unexpectedConcerns ?? []) {
      assert.equal(
        signals.concerns.includes(unexpectedConcern),
        false,
        `${fixture.filePath} should not emit ${unexpectedConcern}`,
      );
    }
  }
});
