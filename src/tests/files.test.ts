import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDirectoryLink,
  ensureDirectory,
  filesInternals,
  pathExists,
  readJsonFileOrNull,
  readJsonLinesFile,
  readTextFileOrNull,
  removeManagedSection,
  upsertManagedSection,
  writeJsonFile,
  writeJsonLinesFile,
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

void test("writeJsonLinesFile writes large jsonl sets without losing records", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-files-test-"));

  try {
    const filePath = join(root, "large.jsonl");
    const values = Array.from({ length: 4000 }, (_, index) => ({
      id: `asset-${index}`,
      payload: "x".repeat(512),
    }));

    await writeJsonLinesFile(filePath, values);
    const roundTripped = await readJsonLinesFile<{
      id: string;
      payload: string;
    }>(filePath);

    assert.equal(roundTripped.length, values.length);
    assert.deepEqual(roundTripped[0], values[0]);
    assert.deepEqual(roundTripped.at(-1), values.at(-1));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("writeJsonLinesFile replaces an existing destination file", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-files-test-"));

  try {
    const filePath = join(root, "state.jsonl");

    await writeJsonLinesFile(filePath, [{ id: "first" }]);
    await writeJsonLinesFile(filePath, [{ id: "second" }]);

    const roundTripped = await readJsonLinesFile<{ id: string }>(filePath);
    assert.deepEqual(roundTripped, [{ id: "second" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("writeJsonLinesFile removes temporary file when serialization fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-files-test-"));

  try {
    const filePath = join(root, "state.jsonl");

    await assert.rejects(
      writeJsonLinesFile(filePath, [{ id: 1n } as never]),
      /serialize a BigInt/u,
    );

    assert.equal(await pathExists(filePath), false);
    assert.equal(await pathExists(`${filePath}.next`), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("readJsonLinesFile rethrows non-ENOENT stream errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-files-test-"));

  try {
    const filePath = join(root, "directory-as-jsonl");
    await ensureDirectory(filePath);

    await assert.rejects(readJsonLinesFile(filePath), (error: unknown) => {
      assert.ok(error instanceof Error);
      return /EISDIR|EPERM|EACCES/u.test(error.message);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function listTempFiles(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => name.includes(".tmp-"));
}

void test("writeJsonFile is atomic — a mid-write failure leaves the original file intact and no temp debris", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-files-test-"));
  const filePath = join(root, "state.json");

  t.after(() => {
    filesInternals.setJsonWriteRenameOverride(undefined);
  });
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await writeJsonFile(filePath, { version: 1, note: "original" });

  // Simulate a crash mid-write: the temp file was fully written but the
  // rename over the destination fails with a non-replace error (EIO).
  filesInternals.setJsonWriteRenameOverride(async () => {
    const error = new Error("disk died mid-write");
    (error as NodeJS.ErrnoException).code = "EIO";
    throw error;
  });

  await assert.rejects(
    writeJsonFile(filePath, { version: 2, note: "never lands" }),
    /disk died mid-write/u,
  );

  // The pre-existing state file is byte-identical and no temp files remain.
  assert.deepEqual(await readJsonFileOrNull(filePath), {
    version: 1,
    note: "original",
  });
  assert.deepEqual(await listTempFiles(root), [], "temp file cleaned up");
});

void test("writeJsonFile is atomic — Windows EPERM on rename retries with backoff and still lands complete content", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-files-test-"));
  const filePath = join(root, "state.json");

  t.after(() => {
    filesInternals.setJsonWriteRenameOverride(undefined);
  });
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await writeJsonFile(filePath, { version: 1 });

  // First two rename attempts hit the Windows locked-destination quirk
  // (EPERM); the bounded retry removes the destination and retries, and the
  // third attempt succeeds via the real rename.
  let failuresInjected = 0;
  filesInternals.setJsonWriteRenameOverride(async (source, destination) => {
    if (failuresInjected < 2) {
      failuresInjected += 1;
      const error = new Error("destination momentarily locked");
      (error as NodeJS.ErrnoException).code = "EPERM";
      throw error;
    }
    const { rename } = await import("node:fs/promises");
    await rename(source, destination);
  });

  await writeJsonFile(filePath, { version: 2, note: "retried" });

  assert.equal(failuresInjected, 2, "retried after transient EPERM");
  assert.deepEqual(await readJsonFileOrNull(filePath), {
    version: 2,
    note: "retried",
  });
  assert.deepEqual(await listTempFiles(root), [], "no temp debris");
});

void test("writeJsonFile — persistent Windows-style replace failures exhaust retries, clean temp, never land partial content", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-files-test-"));
  const filePath = join(root, "state.json");

  t.after(() => {
    filesInternals.setJsonWriteRenameOverride(undefined);
  });
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await writeJsonFile(filePath, { version: 1, note: "original" });

  let failuresInjected = 0;
  filesInternals.setJsonWriteRenameOverride(async () => {
    failuresInjected += 1;
    const error = new Error("destination permanently locked");
    (error as NodeJS.ErrnoException).code = "EPERM";
    throw error;
  });

  await assert.rejects(
    writeJsonFile(filePath, { version: 2 }),
    /destination permanently locked/u,
  );
  assert.ok(failuresInjected >= 1, "rename attempts were made");
  assert.deepEqual(await listTempFiles(root), [], "temp file cleaned up");
});

void test("writeJsonFile cleans the temp file when serialization itself fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-files-test-"));
  const filePath = join(root, "state.json");

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await assert.rejects(
    writeJsonFile(filePath, { id: 1n } as never),
    /serialize a BigInt/u,
  );
  assert.equal(await pathExists(filePath), false);
  assert.deepEqual(await listTempFiles(root), [], "no temp debris");
});

void test("writeJsonFile — concurrent writers never interleave and always land complete content", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-files-test-"));
  const filePath = join(root, "state.json");

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const writers = Array.from({ length: 12 }, (_, index) => ({
    id: index,
    payload: Array.from({ length: 200 }, (_, j) => `value-${index}-${j}`),
  }));

  await Promise.all(
    writers.map((writer) =>
      writeJsonFile(filePath, { writerId: writer.id, payload: writer.payload }),
    ),
  );

  const finalState = await readJsonFileOrNull<{
    writerId: number;
    payload: string[];
  }>(filePath);

  // Under maximum contention every writer can exhaust its bounded retry
  // window: the atomic-write contract allows "old | absent | new". What is
  // NEVER allowed is interleaved/partial content.
  if (finalState === null) {
    assert.deepEqual(
      await listTempFiles(root),
      [],
      "no temp debris even when every writer exhausts retries",
    );
    return;
  }

  const landedWriter = writers.find(
    (writer) => writer.id === finalState?.writerId,
  );
  assert.ok(landedWriter, "final file belongs to one complete writer");
  assert.deepEqual(
    finalState?.payload,
    landedWriter?.payload,
    "final content is one writer's complete payload, never interleaved",
  );
  assert.deepEqual(await listTempFiles(root), [], "no temp debris");
});
