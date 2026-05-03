import assert from "node:assert/strict";
import test from "node:test";

import { collectPackageCandidatesFromDemandProfile } from "../domains/discovery/package-candidates.js";
import type { DemandProfile } from "../types.js";

void test("package candidates are de-duped, sorted, and scoped by registry", () => {
  const demandProfile = buildDemandProfile();

  assert.deepEqual(collectPackageCandidatesFromDemandProfile(null, "npm"), []);
  assert.deepEqual(
    collectPackageCandidatesFromDemandProfile(demandProfile, "npm"),
    ["@modelcontextprotocol/sdk", "react"],
  );
  assert.deepEqual(
    collectPackageCandidatesFromDemandProfile(demandProfile, "pypi"),
    ["duckdb", "fastapi"],
  );
  assert.deepEqual(
    collectPackageCandidatesFromDemandProfile(demandProfile, "cargo"),
    ["axum"],
  );
  assert.deepEqual(
    collectPackageCandidatesFromDemandProfile(demandProfile, "maven"),
    ["org.springframework.boot:spring-boot-starter-web"],
  );
});

function buildDemandProfile(): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: "/tmp/project",
    summary: {
      scannedFiles: 2,
      matchedFiles: 2,
    },
    signals: {
      languages: [],
      packageManagers: [],
      frameworks: [],
      concerns: [],
      tooling: [],
    },
    evidence: [
      {
        path: "package.json",
        fileName: "package.json",
        matchedSignals: {
          languages: [],
          packageManagers: [],
          frameworks: ["react"],
          concerns: [],
          tooling: ["npm:react", "npm:@modelcontextprotocol/sdk", "cargo:axum"],
        },
      },
      {
        path: "requirements.txt",
        fileName: "requirements.txt",
        matchedSignals: {
          languages: [],
          packageManagers: [],
          frameworks: ["python-backend"],
          concerns: [],
          tooling: [
            "pypi:fastapi",
            "pypi:duckdb",
            "npm:react",
            "maven:org.springframework.boot:spring-boot-starter-web",
          ],
        },
      },
    ],
  };
}
