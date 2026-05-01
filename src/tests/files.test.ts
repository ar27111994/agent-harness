import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDirectoryLink,
  listFilesRecursiveWithTelemetry,
  pathEntryExists,
  removePath,
  replaceDirectoryLink,
} from "../files.js";

test("recursive scan stops at explicit file budgets", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-scan-"));
  try {
    await writeFile(join(root, "one.txt"), "one", "utf8");
    await writeFile(join(root, "two.txt"), "two", "utf8");

    const result = await listFilesRecursiveWithTelemetry(root, new Set(), {
      maxFiles: 1,
      maxDepth: 10,
      maxBytes: 1000,
    });

    assert.equal(result.files.length, 1);
    assert.equal(result.telemetry.truncated, true);
    assert.equal(result.telemetry.truncationReason, "max-files");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("managed directory links can be created, replaced, and removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-link-"));
  try {
    const firstTarget = join(root, "target-one");
    const secondTarget = join(root, "target-two");
    const linkPath = join(root, "managed-link");
    await mkdir(firstTarget);
    await mkdir(secondTarget);
    await writeFile(join(firstTarget, "one.txt"), "one", "utf8");
    await writeFile(join(secondTarget, "two.txt"), "two", "utf8");

    await createDirectoryLink(linkPath, firstTarget);
    assert.equal(await pathEntryExists(linkPath), true);

    await replaceDirectoryLink(linkPath, secondTarget);
    assert.equal(await pathEntryExists(join(linkPath, "two.txt")), true);

    await removePath(linkPath);
    assert.equal(await pathEntryExists(linkPath), false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
