#!/usr/bin/env node
// Dumps exact source context for every uncovered line/branch in lcov.info
// against the current src tree. Usage: node scripts/dump-gap-context.mjs [lcov-path]
import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const lcovPath = process.argv[2] ?? "coverage/lcov.info";
const root = resolve(".");
const lcov = readFileSync(lcovPath, "utf8");

function srcPathFor(sf) {
  const normalized = sf.replaceAll("/", sep);
  const prefixSrc = `${sep}src${sep}`;
  const prefixScripts = `${sep}scripts${sep}`;
  if (
    normalized.startsWith(`src${sep}`) ||
    normalized.startsWith(`scripts${sep}`)
  ) {
    return join(root, normalized);
  }
  for (const marker of [prefixSrc, prefixScripts]) {
    const idx = normalized.lastIndexOf(marker);
    if (idx >= 0) {
      return join(root, normalized.slice(idx + 1));
    }
  }
  return null;
}

const records = [];
let current = null;
for (const line of lcov.split("\n")) {
  if (line.startsWith("SF:")) {
    if (current) records.push(current);
    current = { sf: line.slice(3), lines: [], branches: [], fns: [] };
  } else if (current && line.startsWith("DA:")) {
    const [ln, hits] = line.slice(3).split(",");
    if (Number(hits) === 0) current.lines.push(Number(ln));
  } else if (current && line.startsWith("BRDA:")) {
    const [ln, block, branch, taken] = line.slice(5).split(",");
    if (taken === "0") current.branches.push(Number(ln));
  } else if (current && line.startsWith("FN:")) {
    const [ln, name] = line.slice(3).split(",");
    current.fns.push({ ln: Number(ln), name });
  } else if (current && line.startsWith("FNDA:")) {
    const [hits, ln] = line.slice(5).split(",");
    const fn = current.fns.find((f) => String(f.ln) === ln);
    if (fn) fn.hits = Number(hits);
  }
}
if (current) records.push(current);

let anyOutput = false;
for (const rec of records) {
  const uncoveredLines = rec.lines;
  const uncoveredBranches = rec.branches;
  const uncoveredFns = rec.fns.filter((f) => f.hits === 0);
  if (
    uncoveredLines.length === 0 &&
    uncoveredBranches.length === 0 &&
    uncoveredFns.length === 0
  )
    continue;
  anyOutput = true;
  console.log(`\n===== ${rec.sf} =====`);
  if (uncoveredFns.length) {
    console.log(
      `  FUNCTIONS: ${uncoveredFns.map((f) => `${f.name}@${f.ln}`).join(", ")}`,
    );
  }
  if (uncoveredBranches.length) {
    console.log(
      `  BRANCHES at lines: ${[...new Set(uncoveredBranches)].join(", ")}`,
    );
  }
  const srcLines = readLines(srcPathFor(rec.sf));
  if (srcLines) {
    const unique = [...new Set(uncoveredLines)];
    const display = new Map();
    for (const ln of unique) {
      for (
        let i = Math.max(0, ln - 4);
        i <= Math.min(srcLines.length, ln + 3);
        i++
      ) {
        if (!display.has(i)) display.set(i, ln);
      }
    }
    const sorted = [...display.keys()].sort((a, b) => a - b);
    for (const ln of sorted) {
      const marker = display.get(ln) === ln ? ">>" : "  ";
      console.log(
        `${marker} ${String(ln).padStart(5)}| ${srcLines[ln - 1] ?? ""}`,
      );
    }
  } else {
    console.log(`  LINES: ${uncoveredLines.join(", ")} (no src file resolved)`);
  }
}
if (!anyOutput) console.log("No gaps found.");

function readLines(file) {
  if (!file) return null;
  try {
    return readFileSync(file, "utf8").split("\n");
  } catch {
    return null;
  }
}
