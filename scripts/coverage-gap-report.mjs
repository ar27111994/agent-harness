#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function parseLcov(text) {
  const records = [];
  let current = null;
  const functionsByLineAndName = new Map();

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("SF:")) {
      current = {
        file: line.slice(3),
        uncoveredLines: [],
        uncoveredFunctions: [],
        uncoveredBranches: [],
      };
      functionsByLineAndName.clear();
      records.push(current);
      continue;
    }

    if (!current) continue;

    if (line.startsWith("FN:")) {
      const payload = line.slice(3);
      const commaIndex = payload.indexOf(",");
      if (commaIndex >= 0) {
        const lineNumber = Number.parseInt(payload.slice(0, commaIndex), 10);
        const name = payload.slice(commaIndex + 1);
        functionsByLineAndName.set(name, lineNumber);
      }
      continue;
    }

    if (line.startsWith("FNDA:")) {
      const payload = line.slice(5);
      const commaIndex = payload.indexOf(",");
      if (commaIndex >= 0) {
        const hits = Number.parseInt(payload.slice(0, commaIndex), 10);
        const name = payload.slice(commaIndex + 1);
        if (hits === 0) {
          current.uncoveredFunctions.push({
            line: functionsByLineAndName.get(name) ?? null,
            name,
          });
        }
      }
      continue;
    }

    if (line.startsWith("DA:")) {
      const [lineNumberRaw, hitsRaw] = line.slice(3).split(",");
      const lineNumber = Number.parseInt(lineNumberRaw, 10);
      const hits = Number.parseInt(hitsRaw, 10);
      if (Number.isInteger(lineNumber) && hits === 0) {
        current.uncoveredLines.push(lineNumber);
      }
      continue;
    }

    if (line.startsWith("BRDA:")) {
      const [lineNumberRaw, blockRaw, branchRaw, hitsRaw] = line
        .slice(5)
        .split(",");
      const lineNumber = Number.parseInt(lineNumberRaw, 10);
      const hits = hitsRaw === "-" ? 0 : Number.parseInt(hitsRaw, 10);
      if (Number.isInteger(lineNumber) && hits === 0) {
        current.uncoveredBranches.push({
          line: lineNumber,
          block: blockRaw,
          branch: branchRaw,
        });
      }
    }
  }

  return records.filter(
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
  inputPath = process.argv[2] ?? "coverage/lcov.info",
  outputPath = process.argv[3],
  stdout = process.stdout,
} = {}) {
  const records = parseLcov(await readFile(inputPath, "utf8"));
  const markdown = buildMarkdown(records);
  if (outputPath) {
    await writeFile(outputPath, markdown, "utf8");
  } else {
    stdout.write(markdown);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
