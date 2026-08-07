import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  normalizeLcov,
  parseLcov,
  serializeRecords,
} from "../normalize-lcov.mjs";

const execFileAsync = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(testDir, "..", "normalize-lcov.mjs");

/**
 * Regression fixture for #428: a normalized file must keep uncovered
 * branches DETECTABLE. The original serializer wrote BRDA records as
 * `BRDA:486:84:0,0` (colon key + comma taken) while the parser reads
 * canonical `BRDA:486,84,0,0`; re-parsing the old output produced
 * `taken = NaN` and `NaN <= 0` is false, so assert-full-coverage could
 * never fail on branches. This fixture mirrors that exact data shape.
 */
const SAMPLE_LCOV = [
  "SF:src/example.ts",
  "FN:2,covered",
  "FN:8,missed",
  "FNDA:3,covered",
  "FNDA:0,missed",
  "DA:1,1",
  "DA:2,0",
  "DA:3,1",
  "BRDA:10,0,0,1",
  "BRDA:11,0,1,0",
  "BRDA:11,0,2,-",
  "BRDA:12,0,3,0",
  "end_of_record",
].join("\n");

void test("normalizeLcov round-trip preserves uncovered branches (#428 regression)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "normalize-lcov-roundtrip-"));
  const inputPath = join(dir, "lcov.info");
  const outputPath = join(dir, "lcov.normalized.info");
  await writeFile(inputPath, `${SAMPLE_LCOV}\n`, "utf8");

  await normalizeLcov(inputPath, outputPath);
  const normalizedText = await readFile(outputPath, "utf8");

  // Serialized BRDA records must be canonical comma-separated lcov so the
  // same parser that reads raw c8 output reads the normalized file.
  assert.match(
    normalizedText,
    /BRDA:11,0,1,0/u,
    "uncovered-taken-0 branch must be emitted as canonical comma BRDA",
  );
  assert.match(
    normalizedText,
    /BRDA:11,0,2,-/u,
    "never-taken branch must be emitted as '-' per lcov semantics",
  );
  assert.doesNotMatch(
    normalizedText,
    /BRDA:\d+:\d+:\d+/u,
    "BRDA must never be serialized with colon-separated triple (old #428 bug)",
  );

  // Re-parsing the normalized file must surface the same uncovered set.
  const reparsed = parseLcov(normalizedText);
  assert.equal(reparsed.length, 1);
  const [record] = reparsed;
  assert.equal(record.sf, "src/example.ts");
  const uncoveredBranches = [...record.branches].filter(
    ([, taken]) => taken <= 0,
  );
  assert.deepEqual(
    uncoveredBranches.map(([key]) => key).sort(),
    ["11:0:1", "11:0:2", "12:0:3"],
    "uncovered branches must survive the normalize round-trip",
  );
});

void test("parseLcov max-aggregates duplicate DA/BRDA/FNDA records", () => {
  const records = parseLcov(
    [
      "SF:src/dup.ts",
      "FN:5,fn",
      "FNDA:0,fn",
      "FNDA:4,fn",
      "DA:5,0",
      "DA:5,2",
      "BRDA:5,0,0,0",
      "BRDA:5,0,0,1",
      "end_of_record",
    ].join("\n"),
  );

  assert.equal(records.length, 1);
  const [record] = records;
  assert.equal(record.lines.get(5), 2, "DA duplicates max-aggregate to 2");
  assert.equal(record.fns.get("fn"), 4, "FNDA duplicates max-aggregate to 4");
  assert.equal(
    record.branches.get("5:0:0"),
    1,
    "BRDA duplicates max-aggregate to 1 (executed in one child)",
  );
});

void test("parseLcov rejects malformed records without poisoning the output", () => {
  const records = parseLcov(
    [
      "TN:noise",
      "SF:src/example.ts",
      "DA:not-a-number,0",
      "DA:7",
      "DA:8,0",
      "BRDA:not-a-number,0,0,0",
      "BRDA:9,0,1",
      "BRDA:10,,,0",
      "FNDA:0,noDeclaration",
      "FN:2,declared",
      "FNDA:0,declared",
      "end_of_record",
    ].join("\n"),
  );

  assert.equal(records.length, 1);
  const [record] = records;
  // Malformed DA/BRDA records are skipped; only well-formed uncovered
  // records surface.
  assert.deepEqual([...record.lines.keys()], [8]);
  assert.deepEqual([...record.branches.keys()].sort(), ["10::"]);
  assert.equal(record.branches.get("10::"), 0);
  // FNDA with no FN declaration is tracked (line unknown), declared fn maps
  // to its FN line.
  assert.equal(record.fns.get("noDeclaration"), 0);
  assert.equal(record.fnLines.get("declared"), 2);
});

void test("serializeRecords emits canonical summary counters", () => {
  const text = serializeRecords(
    parseLcov(
      [
        "SF:src/example.ts",
        "FN:2,covered",
        "FN:8,missed",
        "FNDA:3,covered",
        "FNDA:0,missed",
        "DA:1,1",
        "DA:2,0",
        "BRDA:10,0,0,1",
        "BRDA:11,0,1,0",
        "BRDA:11,0,2,-",
        "end_of_record",
      ].join("\n"),
    ),
  );

  const [, footer] = text.trim().split("\nend_of_record\n");
  assert.match(footer, /^LF:2/mu);
  assert.match(footer, /^LH:1/mu);
  assert.match(footer, /^BRF:3/mu);
  assert.match(footer, /^BRH:1/mu);
  assert.match(footer, /^FNF:2/mu);
  assert.match(footer, /^FNH:1/mu);
});

void test("direct CLI execution writes a normalized file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "normalize-lcov-cli-"));
  const inputPath = join(dir, "lcov.info");
  const outputPath = join(dir, "lcov.normalized.info");
  await writeFile(inputPath, SAMPLE_LCOV, "utf8");

  await execFileAsync(process.execPath, [scriptPath, inputPath, outputPath]);

  const normalized = await readFile(outputPath, "utf8");
  assert.match(normalized, /^SF:src\/example\.ts/mu);
  assert.match(normalized, /BRDA:11,0,1,0/u);
});
