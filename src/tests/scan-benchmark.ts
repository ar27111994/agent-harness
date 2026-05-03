import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { listFilesRecursiveWithTelemetry } from "../files.js";

const root = await mkdtemp(join(tmpdir(), "agent-harness-benchmark-"));
try {
  for (let directoryIndex = 0; directoryIndex < 10; directoryIndex += 1) {
    const directoryPath = join(root, `fixture-${directoryIndex}`);
    await mkdir(directoryPath);
    for (let fileIndex = 0; fileIndex < 20; fileIndex += 1) {
      await writeFile(
        join(directoryPath, `file-${fileIndex}.md`),
        `# Fixture ${directoryIndex}-${fileIndex}\n`,
        "utf8",
      );
    }
  }

  const startedAt = performance.now();
  const result = await listFilesRecursiveWithTelemetry(root, new Set(), {
    maxDepth: 4,
    maxFiles: 1000,
    maxBytes: 1_000_000,
  });
  const elapsedMs = performance.now() - startedAt;

  assert.equal(result.telemetry.truncated, false);
  assert.equal(result.files.length, 200);
  assert.ok(elapsedMs < 5000, `scan benchmark exceeded budget: ${elapsedMs}ms`);

  const stressRoot = join(root, "stress");
  await mkdir(stressRoot);
  await mkdir(join(stressRoot, ".agent-harness"));
  for (let fileIndex = 0; fileIndex < 1000; fileIndex += 1) {
    await writeFile(join(stressRoot, `source-${fileIndex}.txt`), "x", "utf8");
    await writeFile(
      join(stressRoot, ".agent-harness", `ignored-${fileIndex}.txt`),
      "x",
      "utf8",
    );
  }

  const stressStartedAt = performance.now();
  const stressResult = await listFilesRecursiveWithTelemetry(
    stressRoot,
    undefined,
    {
      maxDepth: 4,
      maxFiles: 2000,
      maxBytes: 5_000_000,
    },
  );
  const stressElapsedMs = performance.now() - stressStartedAt;

  assert.equal(stressResult.telemetry.truncated, false);
  assert.equal(stressResult.files.length, 1000);
  assert.ok(
    stressElapsedMs < 5000,
    `scan stress benchmark exceeded budget: ${stressElapsedMs}ms`,
  );

  console.log(
    JSON.stringify(
      {
        files: result.files.length,
        elapsedMs: Math.round(elapsedMs),
        stressFiles: stressResult.files.length,
        stressElapsedMs: Math.round(stressElapsedMs),
        visitedBytes: result.telemetry.visitedBytes,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(root, { force: true, recursive: true });
}
