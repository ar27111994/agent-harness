#!/usr/bin/env node
/**
 * Enforces the 100% coverage contract on a NORMALIZED lcov file (#428).
 *
 * The multi-child `node --test` gate merge can carry duplicate per-line
 * records (one hit, one zero) from different children; coverage-gap-report
 * treats zero records as gaps, so the gate first normalizes (see
 * normalize-lcov.mjs) and this script fails when ANY statement, branch,
 * function, or line remains uncovered in the normalized file.
 *
 * Usage: node scripts/assert-full-coverage.mjs <lcov-in>
 */

import { readFile } from "node:fs/promises";
import { parseLcov } from "./normalize-lcov.mjs";

export async function assertFullCoverage(inputPath) {
  const text = await readFile(inputPath, "utf8");
  const records = parseLcov(text);

  const uncoveredByFile = new Map();
  let uncoveredStatements = 0;
  let uncoveredBranches = 0;
  let uncoveredFunctions = 0;
  let uncoveredLines = 0;

  for (const record of records) {
    const fileGaps = [];
    for (const [lineNumber, hits] of record.lines) {
      if (hits <= 0) {
        fileGaps.push(`L${lineNumber}`);
        uncoveredStatements += 1;
        uncoveredLines += 1;
      }
    }
    for (const [key, taken] of record.branches) {
      if (taken <= 0) {
        fileGaps.push(`B${key}`);
        uncoveredBranches += 1;
      }
    }
    for (const [name, hits] of record.fns) {
      if (hits <= 0) {
        fileGaps.push(`F:${name}`);
        uncoveredFunctions += 1;
      }
    }
    if (fileGaps.length > 0) {
      uncoveredByFile.set(record.sf, fileGaps);
    }
  }

  if (
    uncoveredStatements > 0 ||
    uncoveredBranches > 0 ||
    uncoveredFunctions > 0
  ) {
    const samples = [...uncoveredByFile.entries()]
      .slice(0, 10)
      .map(([sf, gaps]) => `  ${sf}: ${gaps.slice(0, 12).join(", ")}`)
      .join("\n");
    throw new Error(
      `Coverage is not 100% after lcov normalization.\n` +
        `  statements: ${uncoveredStatements}, branches: ${uncoveredBranches}, ` +
        `functions: ${uncoveredFunctions}, lines: ${uncoveredLines}\n` +
        `  sample gaps:\n${samples}`,
    );
  }

  return {
    statements: uncoveredStatements,
    branches: uncoveredBranches,
    functions: uncoveredFunctions,
    lines: uncoveredLines,
  };
}

if (
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("assert-full-coverage.mjs")
) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node scripts/assert-full-coverage.mjs <lcov-in>");
    process.exitCode = 1;
  } else {
    try {
      const result = await assertFullCoverage(inputPath);
      console.log(
        `Full coverage verified: 0 uncovered statements/branches/functions/lines (${result.statements}/${result.branches}/${result.functions}/${result.lines}).`,
      );
    } catch (error) {
      console.error(String(error));
      process.exitCode = 1;
    }
  }
}
