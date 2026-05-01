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

  console.log(
    JSON.stringify(
      {
        files: result.files.length,
        elapsedMs: Math.round(elapsedMs),
        visitedBytes: result.telemetry.visitedBytes,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(root, { force: true, recursive: true });
}
