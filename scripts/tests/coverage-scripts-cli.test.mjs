import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));

const COVERED_LCOV = [
  "SF:src/example.ts",
  "FN:1,fn",
  "FNDA:1,fn",
  "DA:1,1",
  "BRDA:1,0,0,1",
  "BRDA:1,0,1,1",
  "end_of_record",
].join("\n");

// ─── assert-full-coverage.mjs direct CLI (#428) ──────────────────────────────

void test("assert-full-coverage CLI passes for a fully covered file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "assert-cli-ok-"));
  const inputPath = join(dir, "lcov.info");
  await writeFile(inputPath, COVERED_LCOV, "utf8");

  const { stdout } = await execFileAsync(process.execPath, [
    join(testDir, "..", "assert-full-coverage.mjs"),
    inputPath,
  ]);
  assert.match(stdout, /Full coverage verified: 0 uncovered/u);
});

void test("assert-full-coverage CLI fails for an uncovered branch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "assert-cli-fail-"));
  const inputPath = join(dir, "lcov.info");
  await writeFile(
    inputPath,
    [
      "SF:src/example.ts",
      "FN:1,fn",
      "FNDA:1,fn",
      "DA:1,1",
      "BRDA:1,0,0,1",
      "BRDA:1,0,1,0",
      "end_of_record",
    ].join("\n"),
    "utf8",
  );

  await assert.rejects(
    () =>
      execFileAsync(process.execPath, [
        join(testDir, "..", "assert-full-coverage.mjs"),
        inputPath,
      ]),
    /Coverage is not 100% after lcov normalization/u,
  );
});

void test("assert-full-coverage CLI prints usage when no input path is given", async () => {
  await assert.rejects(
    () =>
      execFileAsync(process.execPath, [
        join(testDir, "..", "assert-full-coverage.mjs"),
      ]),
    /Usage: node scripts\/assert-full-coverage\.mjs/u,
  );
});

// ─── normalize-lcov.mjs direct CLI (#428) ────────────────────────────────────

void test("normalize-lcov CLI prints usage when an argument is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "normalize-cli-usage-"));
  await assert.rejects(
    () =>
      execFileAsync(process.execPath, [
        join(testDir, "..", "normalize-lcov.mjs"),
        join(dir, "lcov.info"),
      ]),
    /Usage: node scripts\/normalize-lcov\.mjs/u,
  );
});
