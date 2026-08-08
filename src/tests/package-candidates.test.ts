import assert from "node:assert/strict";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import { restoreEnvVar } from "./env-test-utils.js";
import {
  collectNpmMcpSearchQueriesFromDemandProfile,
  collectPackageCandidatesFromDemandProfile,
} from "../domains/discovery/package-candidates.js";
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

void test("MCP package discovery builds search queries instead of package allowlists", () => {
  const demandProfile = buildMcpDemandProfile();

  assert.deepEqual(
    collectPackageCandidatesFromDemandProfile(demandProfile, "npm"),
    [],
  );
  assert.deepEqual(collectNpmMcpSearchQueriesFromDemandProfile(demandProfile), [
    "apify mcp server",
    "firebase mcp server",
    "database mcp server",
    "duckdb mcp server",
    "postgres mcp server",
  ]);
});

void test("MCP package discovery respects configured query caps", (context) => {
  const previousLimit = process.env.AGENT_HARNESS_NPM_MCP_SEARCH_QUERY_LIMIT;
  process.env.AGENT_HARNESS_NPM_MCP_SEARCH_QUERY_LIMIT = "2";
  clearRuntimeConfigForTests();

  context.after(() => {
    if (previousLimit === undefined) {
      delete process.env.AGENT_HARNESS_NPM_MCP_SEARCH_QUERY_LIMIT;
    } else {
      restoreEnvVar("AGENT_HARNESS_NPM_MCP_SEARCH_QUERY_LIMIT", previousLimit);
    }
    clearRuntimeConfigForTests();
  });

  assert.deepEqual(
    collectNpmMcpSearchQueriesFromDemandProfile(buildMcpDemandProfile()),
    ["apify mcp server", "firebase mcp server"],
  );
});

function buildMcpDemandProfile(): DemandProfile {
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
      packageManagers: ["npm"],
      frameworks: ["apify", "firebase"],
      concerns: ["data", "database"],
      tooling: ["duckdb", "postgres"],
    },
    evidence: [],
  };
}

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
