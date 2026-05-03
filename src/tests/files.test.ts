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

test("recursive scan skips agent-harness generated directories by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-ignore-"));
  try {
    await writeFile(join(root, "source.md"), "source", "utf8");
    await mkdir(join(root, "activate"));
    await mkdir(join(root, ".cursor"));
    await writeFile(
      join(root, "activate", "generated.md"),
      "generated",
      "utf8",
    );
    await writeFile(join(root, ".cursor", "rule.mdc"), "generated", "utf8");

    const result = await listFilesRecursiveWithTelemetry(root);
    assert.deepEqual(
      result.files.map((filePath) => filePath.slice(root.length + 1)),
      ["source.md"],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("recursive scan honors project ignore files", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-gitignore-"));
  try {
    await mkdir(join(root, "generated"));
    await mkdir(join(root, "ignored-dir"));
    await writeFile(
      join(root, ".gitignore"),
      "ignored-dir/\nignored.md\n*.log\ngenerated/**\n!generated/keep.md\n",
      "utf8",
    );
    await writeFile(join(root, "included.md"), "included", "utf8");
    await writeFile(join(root, "ignored.md"), "ignored", "utf8");
    await writeFile(join(root, "trace.log"), "ignored", "utf8");
    await writeFile(join(root, "generated", "drop.md"), "ignored", "utf8");
    await writeFile(join(root, "generated", "keep.md"), "included", "utf8");
    await writeFile(join(root, "ignored-dir", "nested.md"), "ignored", "utf8");

    const result = await listFilesRecursiveWithTelemetry(root, new Set());
    assert.deepEqual(
      result.files
        .map((filePath) => filePath.slice(root.length + 1).replace(/\\/gu, "/"))
        .sort(),
      [".gitignore", "generated/keep.md", "included.md"],
    );
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
