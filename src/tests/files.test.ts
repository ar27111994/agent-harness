import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDirectoryLink,
  ensureDirectory,
  readTextFileOrNull,
  removeManagedSection,
  upsertManagedSection,
  writeTextFile,
} from "../files.js";

void test("ensureDirectory accepts an existing managed directory link", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-files-test-"));

  try {
    const targetDirectory = join(root, "target");
    const linkedDirectory = join(root, "linked");

    await ensureDirectory(targetDirectory);
    await createDirectoryLink(linkedDirectory, targetDirectory);
    await ensureDirectory(linkedDirectory);

    await writeTextFile(join(linkedDirectory, "proof.txt"), "ok");
    assert.equal(
      await readTextFileOrNull(join(targetDirectory, "proof.txt")),
      "ok",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("removeManagedSection leaves unmanaged content untouched when marker is absent", () => {
  const originalContent = "# AGENTS\n\nKeep this file exactly as-is.";
  assert.equal(
    removeManagedSection({
      originalContent,
      markerId: "agent-harness",
    }),
    originalContent,
  );
});

void test("managed section round-trips for appended markdown", () => {
  const originalContent = "# AGENTS\n\nProject-specific guidance.";
  const nextContent = upsertManagedSection({
    originalContent,
    markerId: "agent-harness",
    bodyLines: ["Managed content"],
  });

  assert.match(nextContent, /agent-harness:begin/u);
  assert.equal(
    removeManagedSection({
      originalContent: nextContent,
      markerId: "agent-harness",
    }),
    `${originalContent}\n`,
  );
});
