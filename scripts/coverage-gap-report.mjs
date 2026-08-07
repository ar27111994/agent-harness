#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseLcov as parseLcovNormalized } from "./normalize-lcov.mjs";

/**
 * Parses an lcov file into gap records (files with uncovered
 * lines/functions/branches). The canonical parser lives in
 * normalize-lcov.mjs — this adapter converts its merged record shape into
 * the per-file gap arrays the report renderer consumes, so the two scripts
 * can never silently diverge on BRDA parsing again (#428 follow-up).
 */
export function parseLcov(text) {
  return parseLcovNormalized(text)
    .map((record) => {
      const uncoveredLines = [];
      for (const [lineNumber, hits] of record.lines) {
        if (hits <= 0) uncoveredLines.push(lineNumber);
      }
      const uncoveredFunctions = [];
      for (const [name, hits] of record.fns) {
        if (hits <= 0) {
          uncoveredFunctions.push({
            line: record.fnLines.get(name) ?? null,
            name,
          });
        }
      }
      const uncoveredBranches = [];
      for (const [key, taken] of record.branches) {
        if (taken <= 0) {
          const [lineNumber, block, branch] = key.split(":");
          uncoveredBranches.push({
            line: Number.parseInt(lineNumber, 10),
            block,
            branch,
          });
        }
      }
      return {
        file: record.sf,
        uncoveredLines,
        uncoveredFunctions,
        uncoveredBranches,
      };
    })
    .filter(
      (record) =>
        record.uncoveredLines.length > 0 ||
        record.uncoveredFunctions.length > 0 ||
        record.uncoveredBranches.length > 0,
    );
}

export function buildMarkdown(records) {
  const lines = [
    "# Coverage Gap Report",
    "",
    "Generated from `coverage/lcov.info` after `npm run test:coverage`.",
    "",
    "| File | Uncovered lines | Uncovered functions | Uncovered branches |",
    "| --- | ---: | ---: | ---: |",
  ];

  for (const record of records) {
    const uncoveredLineList = summarizeNumbers(record.uncoveredLines);
    const uncoveredFunctionList = record.uncoveredFunctions
      .map((entry) =>
        entry.line === null ? entry.name : `${entry.name}@${entry.line}`,
      )
      .join(", ");
    const uncoveredBranchList = record.uncoveredBranches
      .map((entry) => `${entry.line}:${entry.block}:${entry.branch}`)
      .join(", ");
    lines.push(
      `| \`${escapeMarkdownCell(record.file)}\` | ${formatCell(uncoveredLineList)} | ${formatCell(uncoveredFunctionList)} | ${formatCell(uncoveredBranchList)} |`,
    );
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function summarizeNumbers(values) {
  if (values.length === 0) return "";
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let previous = sorted[0];

  for (const value of sorted.slice(1)) {
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    ranges.push(formatRange(start, previous));
    start = value;
    previous = value;
  }

  ranges.push(formatRange(start, previous));
  return ranges.join(", ");
}

function formatRange(start, end) {
  return start === end ? String(start) : `${start}-${end}`;
}

function formatCell(value) {
  if (!value) return "—";
  return escapeMarkdownCell(value);
}

function escapeMarkdownCell(value) {
  return value.replace(/\\/gu, "\\\\").replace(/\|/gu, "\\|");
}

export async function main({
  inputPath,
  outputPath,
  stdout = process.stdout,
} = {}) {
  // CLI-argv fallback only applies when THIS script is the direct entry
  // (argv[1] is the script path). Under a test runner argv points at the
  // runner, and leaking runner flags into outputPath would be wrong.
  const isDirectExecution =
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  const resolvedInputPath =
    inputPath ??
    (isDirectExecution ? process.argv[2] : undefined) ??
    "coverage/lcov.info";
  const resolvedOutputPath =
    outputPath ?? (isDirectExecution ? process.argv[3] : undefined);

  const records = parseLcov(await readFile(resolvedInputPath, "utf8"));
  const markdown = buildMarkdown(records);
  if (resolvedOutputPath) {
    await writeFile(resolvedOutputPath, markdown, "utf8");
  } else {
    stdout.write(markdown);
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  await main();
}
