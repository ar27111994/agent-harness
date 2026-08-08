import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDirectoryLink,
  ensureDirectory,
  filesInternals,
  readBinaryFileOrNull,
  readJsonFile,
  readTextFileOrNull,
  writeJsonFile,
  writeTextFile,
} from "../files.js";

void test("file internals cover usable path, ignore handling, and scan edge branches", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-files-internals-"));

  try {
    const targetDirectory = join(root, "target");
    const linkDirectory = join(root, "linked");
    const plainFile = join(root, "plain.txt");
    const scanRoot = join(root, "scan");

    await ensureDirectory(targetDirectory);
    await createDirectoryLink(linkDirectory, targetDirectory);
    await writeTextFile(plainFile, "plain");
    await writeTextFile(join(scanRoot, "match1.txt"), "one");

    assert.equal(
      await filesInternals.isUsableDirectoryPath(targetDirectory),
      true,
    );
    assert.equal(
      await filesInternals.isUsableDirectoryPath(linkDirectory),
      true,
    );
    assert.equal(await filesInternals.isUsableDirectoryPath(plainFile), false);
    assert.equal(
      await filesInternals.isUsableDirectoryPath(join(root, "missing")),
      false,
    );
    assert.equal(
      await filesInternals.shouldIgnoreEnsureDirectoryError(linkDirectory, {
        code: "EEXIST",
      }),
      true,
    );
    assert.equal(
      await filesInternals.shouldIgnoreEnsureDirectoryError(plainFile, {
        code: "EEXIST",
      }),
      false,
    );
    assert.equal(filesInternals.getErrorMessage(404), "404");
    assert.equal(
      filesInternals.globPatternToRegExp("match?.txt").test("match1.txt"),
      true,
    );

    const truncatedTelemetry = {
      truncated: true,
      truncationReason: undefined,
      visitedFiles: 0,
      visitedBytes: 0,
    };
    assert.deepEqual(
      await filesInternals.collectFilesFromDirectory(
        root,
        scanRoot,
        new Set<string>(),
        [],
        { maxDepth: 4, maxFiles: 10, maxBytes: 1000 },
        truncatedTelemetry,
        0,
      ),
      [],
    );

    const depthTelemetry = {
      truncated: false,
      truncationReason: undefined,
      visitedFiles: 0,
      visitedBytes: 0,
    };
    assert.deepEqual(
      await filesInternals.collectFilesFromDirectory(
        root,
        scanRoot,
        new Set<string>(),
        [],
        { maxDepth: 0, maxFiles: 10, maxBytes: 1000 },
        depthTelemetry,
        1,
      ),
      [],
    );
    assert.equal(depthTelemetry.truncated, true);
    assert.equal(depthTelemetry.truncationReason, "max-depth");

    const entryGuardTelemetry = createTelemetryThatTruncatesAfterReads(1);
    assert.deepEqual(
      await filesInternals.collectFilesFromDirectory(
        root,
        scanRoot,
        new Set<string>(),
        [],
        { maxDepth: 4, maxFiles: 10, maxBytes: 1000 },
        entryGuardTelemetry,
        0,
      ),
      [],
    );

    const callbackGuardRoot = join(root, "callback-guard");
    await writeTextFile(join(callbackGuardRoot, "pending.txt"), "pending");
    const callbackGuardTelemetry = createTelemetryThatTruncatesAfterReads(2);
    assert.deepEqual(
      await filesInternals.collectFilesFromDirectory(
        root,
        callbackGuardRoot,
        new Set<string>(),
        [],
        { maxDepth: 4, maxFiles: 10, maxBytes: 1000 },
        callbackGuardTelemetry,
        0,
      ),
      [],
    );
    assert.equal(callbackGuardTelemetry.visitedFiles, 0);

    await writeFile(join(scanRoot, "dangling.txt"), "temp", "utf8");
    const removeSoon = readTextFileOrNull(join(scanRoot, "dangling.txt")).then(
      async () => rm(join(scanRoot, "dangling.txt"), { force: true }),
    );
    const files = await filesInternals.collectFilesFromDirectory(
      root,
      scanRoot,
      new Set<string>(),
      [],
      { maxDepth: 4, maxFiles: 10, maxBytes: 1000 },
      {
        truncated: false,
        truncationReason: undefined,
        visitedFiles: 0,
        visitedBytes: 0,
      },
      0,
    );
    await removeSoon;
    assert.ok(files.some((filePath) => filePath.endsWith("match1.txt")));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function createTelemetryThatTruncatesAfterReads(readLimit: number): {
  truncated: boolean;
  truncationReason: string | undefined;
  visitedFiles: number;
  visitedBytes: number;
} {
  let truncated = false;
  let reads = 0;

  return {
    get truncated() {
      reads += 1;
      return truncated || reads > readLimit;
    },
    set truncated(value: boolean) {
      truncated = value;
    },
    truncationReason: undefined,
    visitedFiles: 0,
    visitedBytes: 0,
  };
}

void test("atomic replace tolerates an EPERM destination removal and keeps retrying (#428)", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-rm-eperm-"));
  const eperm = Object.assign(new Error("injected EPERM"), { code: "EPERM" });
  try {
    filesInternals.setJsonWriteRenameOverride(async () => {
      throw eperm;
    });
    filesInternals.setJsonWriteRemoveOverride(async () => {
      throw eperm;
    });
    await assert.rejects(
      writeJsonFile(join(root, "state.json"), { value: 1 }),
      /EPERM/u,
    );
  } finally {
    filesInternals.setJsonWriteRenameOverride(undefined);
    filesInternals.setJsonWriteRemoveOverride(undefined);
    await rm(root, { force: true, recursive: true });
  }
});

void test("atomic replace rethrows non-EPERM destination removal errors (#428)", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-rm-other-"));
  const notDir = Object.assign(new Error("injected ENOTDIR"), {
    code: "ENOTDIR",
  });
  try {
    filesInternals.setJsonWriteRenameOverride(async () => {
      throw Object.assign(new Error("injected EPERM"), { code: "EPERM" });
    });
    filesInternals.setJsonWriteRemoveOverride(async () => {
      throw notDir;
    });
    await assert.rejects(
      writeJsonFile(join(root, "state.json"), { value: 1 }),
      /ENOTDIR/u,
    );
  } finally {
    filesInternals.setJsonWriteRenameOverride(undefined);
    filesInternals.setJsonWriteRemoveOverride(undefined);
    await rm(root, { force: true, recursive: true });
  }
});

void test("atomic readers retry a transient EPERM open and succeed (#427/#428)", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-read-eperm-"));
  const statePath = join(root, "state.json");
  const eperm = Object.assign(new Error("injected EPERM"), { code: "EPERM" });
  let calls = 0;
  try {
    await writeJsonFile(statePath, { schemaVersion: 1, seq: 7 });
    filesInternals.setReadFileOpenOverride(async (filePath, encoding) => {
      calls += 1;
      if (calls === 1) {
        throw eperm;
      }
      return readFile(filePath, encoding ?? "utf8");
    });

    const content = await readTextFileOrNull(statePath);
    assert.ok(content !== null && content.includes('"seq": 7'));
    assert.equal(calls, 2, "exactly one retry after the transient failure");
  } finally {
    filesInternals.setReadFileOpenOverride(undefined);
    await rm(root, { force: true, recursive: true });
  }
});

void test("atomic readers rethrow after exhausting the transient-open retry window (#427/#428)", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-read-exhaust-"));
  const statePath = join(root, "state.json");
  const eperm = Object.assign(new Error("injected EPERM"), { code: "EPERM" });
  let calls = 0;
  try {
    await writeJsonFile(statePath, { schemaVersion: 1 });
    filesInternals.setReadFileOpenOverride(async () => {
      calls += 1;
      throw eperm;
    });

    await assert.rejects(() => readJsonFile(statePath), /EPERM/u);
    assert.equal(calls, 5, "initial try plus the four bounded retries");
  } finally {
    filesInternals.setReadFileOpenOverride(undefined);
    await rm(root, { force: true, recursive: true });
  }
});

void test("atomic readers do not retry non-transient or absent files (#427/#428)", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-read-failfast-"));
  const statePath = join(root, "state.json");
  const eisdir = Object.assign(new Error("injected EISDIR"), {
    code: "EISDIR",
  });
  const enoent = Object.assign(new Error("injected ENOENT"), {
    code: "ENOENT",
  });
  const calls: string[] = [];
  try {
    filesInternals.setReadFileOpenOverride(async () => {
      calls.push("fail");
      throw eisdir;
    });
    await assert.rejects(() => readTextFileOrNull(statePath), /EISDIR/u);
    assert.equal(calls.length, 1, "non-transient failures must not retry");

    // ENOENT is part of the atomic contract (absent) and must surface as
    // null on the first attempt without retrying.
    calls.length = 0;
    filesInternals.setReadFileOpenOverride(async () => {
      calls.push("missing");
      throw enoent;
    });
    assert.equal(await readTextFileOrNull(statePath), null);
    assert.equal(calls.length, 1, "absent files must not retry");

    // Binary readers share the same retry semantics.
    calls.length = 0;
    filesInternals.setReadFileOpenOverride(async () => {
      calls.push("binary");
      throw enoent;
    });
    assert.equal(await readBinaryFileOrNull(statePath), null);
    assert.equal(calls.length, 1);
  } finally {
    filesInternals.setReadFileOpenOverride(undefined);
    await rm(root, { force: true, recursive: true });
  }
});
