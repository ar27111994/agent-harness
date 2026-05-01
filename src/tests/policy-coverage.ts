import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  collectDetectorSignals,
  isDetectorInspectableFile,
} from "../domains/discovery/detectors.js";
import { ROADMAP_DETECTION_FIXTURES } from "./detection-fixtures.js";
import type { DemandSignalSet, RecommendationPolicyBase } from "../types.js";

interface PolicyCoverageResult {
  archetype: string;
  filePath: string;
  emittedTerms: string[];
  mappedTerms: string[];
  unmappedTerms: string[];
}

const projectRoot = process.cwd();
const policy = await readPolicyBase(projectRoot);
const policyTerms = collectPolicyTerms(policy);
const coverageResults = ROADMAP_DETECTION_FIXTURES.map((fixture) => {
  const signals = createEmptySignalSet();
  if (isDetectorInspectableFile(fixture.fileName, fixture.filePath)) {
    collectDetectorSignals(fixture.fileName, fixture.filePath, signals);
  }

  const emittedTerms = collectCoverageTerms(signals);
  const mappedTerms = emittedTerms.filter((term) => policyTerms.has(term));
  const unmappedTerms = emittedTerms.filter((term) => !policyTerms.has(term));

  return {
    archetype: fixture.archetype,
    filePath: fixture.filePath,
    emittedTerms,
    mappedTerms,
    unmappedTerms,
  } satisfies PolicyCoverageResult;
});

const unmappedTerms = [
  ...new Set(coverageResults.flatMap((result) => result.unmappedTerms)),
].sort((left, right) => left.localeCompare(right));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  fixtureCount: coverageResults.length,
  mappedTermCount: coverageResults.reduce(
    (total, result) => total + result.mappedTerms.length,
    0,
  ),
  unmappedTermCount: unmappedTerms.length,
  unmappedTerms,
  results: coverageResults,
};

if (process.argv.includes("--write-draft")) {
  const outputRoot = join(projectRoot, "discover", "output");
  await writeJsonFile(join(outputRoot, "policy-coverage-report.json"), report);
  await writeJsonFile(
    join(outputRoot, "policy-draft-suggestions.json"),
    buildDraftSuggestions(unmappedTerms),
  );
}

console.log(JSON.stringify(report, null, 2));
assert.deepEqual(
  unmappedTerms,
  [],
  `Detector terms missing from recommendation policy maps: ${unmappedTerms.join(", ")}`,
);

async function readPolicyBase(root: string): Promise<RecommendationPolicyBase> {
  const content = await readFile(
    join(root, "discover", "recommendation-policy", "base.json"),
    "utf8",
  );
  return JSON.parse(content) as RecommendationPolicyBase;
}

function collectPolicyTerms(policyBase: RecommendationPolicyBase): Set<string> {
  const terms = new Set<string>();

  addTerms(terms, Object.keys(policyBase.scoring.demandTermMultipliers));
  addTerms(terms, Object.keys(policyBase.concernKeywordMap));
  addTerms(terms, Object.values(policyBase.concernKeywordMap).flat());
  addTerms(terms, Object.keys(policyBase.taskModeKeywordMap));
  addTerms(terms, Object.values(policyBase.taskModeKeywordMap).flat());
  addTerms(terms, Object.keys(policyBase.domainKeywordGroups));
  addTerms(terms, Object.values(policyBase.domainKeywordGroups).flat());
  addTerms(terms, Object.keys(policyBase.synonyms));
  addTerms(terms, Object.values(policyBase.synonyms).flat());

  return terms;
}

function collectCoverageTerms(signals: DemandSignalSet): string[] {
  return [
    ...signals.languages,
    ...signals.frameworks,
    ...signals.concerns,
    ...signals.tooling,
  ]
    .filter((term) => !term.startsWith("detector:"))
    .filter((term) => !term.startsWith("pypi:"))
    .sort((left, right) => left.localeCompare(right));
}

function buildDraftSuggestions(unmappedTerms: string[]): {
  schemaVersion: number;
  generatedAt: string;
  requiresHumanApproval: true;
  suggestedPolicyAdditions: {
    concernKeywordMap: Record<string, string[]>;
    synonyms: Record<string, string[]>;
    demandTermMultipliers: Record<string, number>;
  };
} {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    requiresHumanApproval: true,
    suggestedPolicyAdditions: {
      concernKeywordMap: Object.fromEntries(
        unmappedTerms.map((term) => [term, [term]]),
      ),
      synonyms: Object.fromEntries(unmappedTerms.map((term) => [term, [term]])),
      demandTermMultipliers: Object.fromEntries(
        unmappedTerms.map((term) => [term, 1]),
      ),
    },
  };
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function addTerms(target: Set<string>, values: string[]): void {
  for (const value of values) {
    target.add(value);
  }
}

function createEmptySignalSet(): DemandSignalSet {
  return {
    languages: [],
    packageManagers: [],
    frameworks: [],
    concerns: [],
    tooling: [],
  };
}
