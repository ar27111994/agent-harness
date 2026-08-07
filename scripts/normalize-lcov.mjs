#!/usr/bin/env node
/**
 * Normalizes a merged lcov file produced by c8 after a multi-child
 * `node --test` gate run (#428).
 *
 * c8 merges V8 coverage from every test-file child process into one lcov.
 * With source maps, the same source line can carry MULTIPLE DA records (one
 * per column range emitted by a child). When children execute different
 * column ranges of the same line — normal for transpiled output — a line can
 * end up with records like `DA:33,1` AND `DA:33,0`. Consumers that treat any
 * zero record as "uncovered" then report FALSE gaps for lines that were
 * provably executed (verified by single-process per-file runs).
 *
 * The canonical lcov semantics for duplicate line records is aggregation
 * (per-line hit count = the maximum executed count). This script rewrites
 * each record so every (line | line:block:branch | function) carries a
 * single aggregated value, making the merged file faithful to reality:
 *
 * - DA:<line>,<n>  -> one record per line with the max hit count
 * - BRDA:<line>,<block>,<branch>,<taken> -> one record per triple, max taken
 * - FNDA:<hits>,<name> -> one record per function name, max hits
 *
 * Output is canonical lcov: BRDA triples are emitted comma-separated exactly
 * like c8 writes them, and branches whose aggregated taken count is <= 0 are
 * written as `-` (the lcov "never taken" marker). The file therefore parses
 * identically with the same tooling that reads raw c8 output, and uncovered
 * branches remain detectable after normalization.
 *
 * `parseLcov` is the single shared lcov parser: `assert-full-coverage.mjs`
 * and `coverage-gap-report.mjs` both consume it, so a format change cannot
 * silently diverge between enforcement and reporting again (#428 follow-up).
 *
 * Usage: node scripts/normalize-lcov.mjs <lcov-in> <lcov-out>
 */

import { readFile, writeFile } from "node:fs/promises";

export async function normalizeLcov(inputPath, outputPath) {
  const text = await readFile(inputPath, "utf8");
  const records = parseLcov(text);
  const normalized = serializeRecords(records);
  await writeFile(outputPath, `${normalized}\n`, "utf8");
  return records;
}

export function parseLcov(text) {
  const records = [];
  let current = null;
  const lineHits = new Map(); // SF -> line -> max hits
  const branchTaken = new Map(); // SF -> line:block:branch key -> max taken
  const functionHits = new Map(); // SF -> name -> max hits
  const knownFunctions = new Map(); // SF -> name -> line

  const flush = () => {
    if (current === null) return;
    const sf = current.sf;
    // Every SF: line below registers all four maps before current is set,
    // and repeated SF blocks (multi-child merges) intentionally share the
    // same maps so max-aggregation covers both; a missing map is an
    // internal bug and fails loudly downstream instead of being patched
    // with an empty map that would silently drop records.
    records.push({
      sf,
      lines: lineHits.get(sf),
      branches: branchTaken.get(sf),
      fns: functionHits.get(sf),
      fnLines: knownFunctions.get(sf),
    });
  };

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("SF:")) {
      flush();
      current = { sf: line.slice(3) };
      if (!lineHits.has(current.sf)) lineHits.set(current.sf, new Map());
      if (!branchTaken.has(current.sf)) branchTaken.set(current.sf, new Map());
      if (!functionHits.has(current.sf))
        functionHits.set(current.sf, new Map());
      if (!knownFunctions.has(current.sf))
        knownFunctions.set(current.sf, new Map());
      continue;
    }
    if (!current) continue;
    if (line.startsWith("DA:")) {
      const [lineNumberRaw, hitsRaw] = line.slice(3).split(",");
      const lineNumber = Number.parseInt(lineNumberRaw, 10);
      const hits = Number.parseInt(hitsRaw, 10);
      if (!Number.isInteger(lineNumber) || !Number.isFinite(hits)) continue;
      const bucket = lineHits.get(current.sf);
      bucket.set(lineNumber, Math.max(bucket.get(lineNumber) ?? 0, hits));
      continue;
    }
    if (line.startsWith("BRDA:")) {
      // Canonical lcov: BRDA:<line>,<block>,<branch>,<taken> where <taken>
      // is a hit count or `-` for never-taken branches.
      const [lineNumberRaw, blockRaw, branchRaw, takenRaw] = line
        .slice(5)
        .split(",");
      const lineNumber = Number.parseInt(lineNumberRaw, 10);
      if (!Number.isInteger(lineNumber)) continue;
      const taken = takenRaw === "-" ? -1 : Number.parseInt(takenRaw, 10);
      if (!Number.isFinite(taken)) continue;
      const key = `${lineNumber}:${blockRaw}:${branchRaw}`;
      const bucket = branchTaken.get(current.sf);
      bucket.set(key, Math.max(bucket.get(key) ?? -1, taken));
      continue;
    }
    if (line.startsWith("FN:")) {
      const [lineNumberRaw, name] = line.slice(3).split(",");
      const lineNumber = Number.parseInt(lineNumberRaw, 10);
      if (Number.isInteger(lineNumber) && name !== undefined) {
        knownFunctions.get(current.sf).set(name, lineNumber);
      }
      continue;
    }
    if (line.startsWith("FNDA:")) {
      const [hitsRaw, name] = line.slice(5).split(",");
      const hits = Number.parseInt(hitsRaw, 10);
      if (!Number.isFinite(hits) || name === undefined) continue;
      const bucket = functionHits.get(current.sf);
      bucket.set(name, Math.max(bucket.get(name) ?? 0, hits));
      continue;
    }
    if (
      line.startsWith("TN:") ||
      line.startsWith("LF:") ||
      line.startsWith("LH:") ||
      line.startsWith("BRF:") ||
      line.startsWith("BRH:") ||
      line.startsWith("FNF:") ||
      line.startsWith("FNH:")
    ) {
      // Summary counters are recomputed by the serializer; drop raw ones so
      // downstream consumers do not double-count.
      continue;
    }
  }
  flush();
  return records;
}

export function serializeRecords(records) {
  let summaryLH = 0;
  let summaryLF = 0;
  let summaryBRH = 0;
  let summaryBRF = 0;
  let summaryFNH = 0;
  let summaryFNF = 0;

  const blocks = [];
  for (const record of records) {
    const lines = [...record.lines.entries()].sort((a, b) => a[0] - b[0]);
    const branches = [...record.branches.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    const fns = [...record.fns.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    summaryLF += lines.length;
    summaryLH += lines.filter(([, hits]) => hits > 0).length;
    summaryBRF += branches.length;
    summaryBRH += branches.filter(([, taken]) => taken > 0).length;
    summaryFNF += fns.length;
    summaryFNH += fns.filter(([, hits]) => hits > 0).length;

    const out = [`SF:${record.sf}`];
    for (const [name, lineNumber] of record.fnLines.entries()) {
      out.push(`FN:${lineNumber},${name}`);
    }
    for (const [name, hits] of fns) {
      out.push(`FNDA:${hits},${name}`);
    }
    for (const [lineNumber, hits] of lines) {
      out.push(`DA:${lineNumber},${hits}`);
    }
    for (const [key, taken] of branches) {
      const [lineNumber, blockRaw, branchRaw] = key.split(":");
      const takenValue = taken > 0 ? taken : taken === -1 ? "-" : "0";
      out.push(`BRDA:${lineNumber},${blockRaw},${branchRaw},${takenValue}`);
    }
    out.push("end_of_record");
    blocks.push(out.join("\n"));
  }

  const footer = [
    `LF:${summaryLF}`,
    `LH:${summaryLH}`,
    `BRF:${summaryBRF}`,
    `BRH:${summaryBRH}`,
    `FNF:${summaryFNF}`,
    `FNH:${summaryFNH}`,
  ].join("\n");

  return `${blocks.join("\n")}\n${footer}`;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("normalize-lcov.mjs");

if (isDirectExecution) {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) {
    console.error(
      "Usage: node scripts/normalize-lcov.mjs <lcov-in> <lcov-out>",
    );
    process.exitCode = 1;
  } else {
    await normalizeLcov(inputPath, outputPath);
  }
}
