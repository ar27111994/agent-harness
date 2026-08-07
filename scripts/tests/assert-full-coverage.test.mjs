import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertFullCoverage } from "../assert-full-coverage.mjs";

const COVERED_LCOV = [
  "SF:src/example.ts",
  "FN:1,fn",
  "FNDA:1,fn",
  "DA:1,1",
  "BRDA:1,0,0,1",
  "BRDA:1,0,1,1",
  "BRDA:2,3,1,4",
  "end_of_record",
].join("\n");

void test("assertFullCoverage passes for a fully covered file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "assert-full-covered-"));
  const inputPath = join(dir, "lcov.info");
  await writeFile(inputPath, COVERED_LCOV, "utf8");

  const result = await assertFullCoverage(inputPath);
  assert.deepEqual(result, {
    statements: 0,
    branches: 0,
    functions: 0,
    lines: 0,
  });
});

void test("assertFullCoverage fails when any statement/branch/function is uncovered", async () => {
  const dir = await mkdtemp(join(tmpdir(), "assert-full-gaps-"));
  const inputPath = join(dir, "lcov.info");
  await writeFile(
    inputPath,
    [
      "SF:src/example.ts",
      "FN:1,coveredFn",
      "FN:2,missedFn",
      "FNDA:1,coveredFn",
      "FNDA:0,missedFn",
      "DA:1,1",
      "DA:2,0",
      "BRDA:1,0,0,1",
      "BRDA:1,0,1,0",
      "BRDA:3,0,2,-",
      "end_of_record",
    ].join("\n"),
    "utf8",
  );

  await assert.rejects(
    () => assertFullCoverage(inputPath),
    (error) => {
      assert.match(String(error), /statements: 1/u);
      assert.match(String(error), /branches: 2/u);
      assert.match(String(error), /functions: 1/u);
      assert.match(String(error), /lines: 1/u);
      return true;
    },
  );
});

void test("assertFullCoverage treats '-' never-taken branches as uncovered", async () => {
  const dir = await mkdtemp(join(tmpdir(), "assert-full-dash-"));
  const inputPath = join(dir, "lcov.info");
  await writeFile(
    inputPath,
    [
      "SF:src/example.ts",
      "FN:1,fn",
      "FNDA:1,fn",
      "DA:1,1",
      "BRDA:1,0,0,1",
      "BRDA:1,0,1,-",
      "end_of_record",
    ].join("\n"),
    "utf8",
  );

  await assert.rejects(() => assertFullCoverage(inputPath), /branches: 1/u);
});
