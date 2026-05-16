import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { buildMarkdown, main, parseLcov } from "../coverage-gap-report.mjs";

const execFileAsync = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(testDir, "..", "coverage-gap-report.mjs");

const SAMPLE_LCOV = [
  "TN:",
  "noise before any source file is ignored",
  "SF:src/example.ts",
  "FN:2,covered",
  "FN:malformedWithoutComma",
  "FN:8,missed",
  "FNDA:3,covered",
  "FNDA:malformedWithoutComma",
  "FNDA:0,missed",
  "FNDA:0,anonymousWithoutDeclaration",
  "DA:malformedWithoutComma",
  "DA:not-a-number,0",
  "DA:1,1",
  "DA:2,0",
  "DA:3,0",
  "DA:5,1",
  "BRDA:not-a-number,0,0,0",
  "BRDA:3,0,0,1",
  "BRDA:3,0,1,0",
  "BRDA:4,0,2,-",
  "end_of_record",
  "SF:src/fully-covered.ts",
  "FN:1,coveredAgain",
  "FNDA:1,coveredAgain",
  "DA:1,1",
].join("\n");

void test("parseLcov reports uncovered lines, functions, and branches", () => {
  const records = parseLcov(SAMPLE_LCOV);

  assert.deepEqual(records, [
    {
      file: "src/example.ts",
      uncoveredLines: [2, 3],
      uncoveredFunctions: [
        { line: 8, name: "missed" },
        { line: null, name: "anonymousWithoutDeclaration" },
      ],
      uncoveredBranches: [
        { line: 3, block: "0", branch: "1" },
        { line: 4, block: "0", branch: "2" },
      ],
    },
  ]);
});

void test("parseLcov ignores blank lines and incomplete DA/BRDA payloads", () => {
  const records = parseLcov(
    [
      "",
      "SF:src/example.ts",
      "",
      "DA:7",
      "DA:8,0",
      "BRDA:9,0,1",
      "BRDA:10,,,0",
      "",
    ].join("\n"),
  );

  assert.deepEqual(records, [
    {
      file: "src/example.ts",
      uncoveredLines: [8],
      uncoveredFunctions: [],
      uncoveredBranches: [{ line: 10, block: "", branch: "" }],
    },
  ]);
});

void test("buildMarkdown summarizes contiguous line misses", () => {
  const markdown = buildMarkdown([
    {
      file: "src/example|with-pipe.ts",
      uncoveredLines: [2, 3, 8, 3],
      uncoveredFunctions: [{ line: null, name: "anonymous" }],
      uncoveredBranches: [{ line: 8, block: "0", branch: "1" }],
    },
    {
      file: "src/branch-only.ts",
      uncoveredLines: [],
      uncoveredFunctions: [],
      uncoveredBranches: [],
    },
  ]);

  assert.match(markdown, /Coverage Gap Report/u);
  assert.match(markdown, /2-3, 8/u);
  assert.match(markdown, /anonymous/u);
  assert.match(markdown, /8:0:1/u);
  assert.match(markdown, /src\/example\\\|with-pipe\.ts/u);
  assert.match(markdown, /—/u);
});

void test("direct CLI execution writes markdown to stdout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coverage-gap-report-cli-"));
  const inputPath = join(dir, "lcov.info");
  await writeFile(inputPath, SAMPLE_LCOV, "utf8");

  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    inputPath,
  ]);

  assert.match(stdout, /src\/example\.ts/u);
  assert.match(stdout, /anonymousWithoutDeclaration/u);
});

void test("main writes markdown to a file or stdout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coverage-gap-report-"));
  const inputPath = join(dir, "lcov.info");
  const outputPath = join(dir, "gaps.md");
  await writeFile(inputPath, SAMPLE_LCOV, "utf8");

  await main({ inputPath, outputPath });
  const fileOutput = await readFile(outputPath, "utf8");
  assert.match(fileOutput, /src\/example\.ts/u);

  let stdoutOutput = "";
  await main({
    inputPath,
    stdout: {
      write(chunk) {
        stdoutOutput += chunk;
      },
    },
  });
  assert.equal(stdoutOutput, fileOutput);
});

void test("main falls back to process argv when inputPath is omitted", async () => {
  const dir = await mkdtemp(
    join(tmpdir(), "coverage-gap-report-default-input-"),
  );
  const inputPath = join(dir, "lcov.info");
  await writeFile(inputPath, SAMPLE_LCOV, "utf8");

  const previousArgv = process.argv;
  const previousWorkingDirectory = process.cwd();
  process.argv = ["node", scriptPath, inputPath];

  let stdoutOutput = "";
  try {
    await main({
      stdout: {
        write(chunk) {
          stdoutOutput += chunk;
        },
      },
    });

    await mkdir(join(dir, "coverage"));
    await writeFile(join(dir, "coverage", "lcov.info"), SAMPLE_LCOV, "utf8");
    process.argv = ["node", scriptPath];
    process.chdir(dir);
    stdoutOutput = "";
    await main({
      stdout: {
        write(chunk) {
          stdoutOutput += chunk;
        },
      },
    });
  } finally {
    process.argv = previousArgv;
    process.chdir(previousWorkingDirectory);
  }

  assert.match(stdoutOutput, /src\/example\.ts/u);
});
