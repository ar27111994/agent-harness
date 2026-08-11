/**
 * Edge-case file handling at the files API + safe-path layer (review): the
 * suite closes the untested-shape gaps — 0-byte files, whitespace-only names,
 * 255-char names, null-byte filenames, extension-less files, and the
 * sanitization of hostile names through toPosixPath/sanitizeAssetId/
 * sanitizeMirrorId. Real-filesystem round trips run where the platform can
 * represent the name; win32 long-name behavior is asserted per platform so
 * the CI matrix covers both outcomes.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  pathExists,
  readJsonFileOrNull,
  readJsonLinesFile,
  readTextFileOrNull,
  toPosixPath,
  writeTextFile,
} from "../files.js";
import { sanitizeAssetId, sanitizeMirrorId } from "../lib/safe-paths.js";
import { assertAssetCatalogEntry } from "../manifest-validation.js";

void test("0-byte JSON files surface as invalid-JSON errors, not silent absence (review)", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "ah-edge-zero-"));
  context.after(() => rm(root, { recursive: true, force: true }));

  const emptyJsonPath = join(root, "empty.json");
  await writeFile(emptyJsonPath, "", "utf8");
  await assert.rejects(
    readJsonFileOrNull(emptyJsonPath),
    /Invalid JSON/u,
    "a 0-byte state file is a data-integrity error (atomic writes never produce it), never silently treated as absent",
  );

  const emptyTextPath = join(root, "empty.txt");
  await writeFile(emptyTextPath, "", "utf8");
  assert.equal(
    await readTextFileOrNull(emptyTextPath),
    "",
    "0-byte text reads as empty",
  );
});

void test("whitespace-only and extension-less filenames round-trip through the files API (review)", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "ah-edge-name-"));
  context.after(() => rm(root, { recursive: true, force: true }));

  for (const name of ["   ", "no-extension-file", ".hidden", "a b c"]) {
    const filePath = join(root, name);
    await writeTextFile(filePath, `content:${name}`);
    assert.equal(
      await readTextFileOrNull(filePath),
      `content:${name}`,
      `round trip for ${JSON.stringify(name)}`,
    );
  }
});

void test("255-char filenames sanitize deterministically and round-trip on capable platforms (review)", async (context) => {
  const longName = "a".repeat(255);
  const asPosix = toPosixPath(join("C:/some", longName));
  assert.match(asPosix, /a{255}$/u, "255-char name survives posix conversion");

  assert.equal(
    toPosixPath(join("C:/root", longName, "nested.json")),
    `C:/root/${longName}/nested.json`,
    "long paths are preserved verbatim by toPosixPath",
  );

  const assetId = sanitizeAssetId(longName);
  assert.match(
    assetId,
    /^a{255}-[0-9a-f]{12}$/u,
    "255-char sanitized id keeps length + hash",
  );
  assert.equal(sanitizeMirrorId(longName), longName);

  const root = await mkdtemp(join(tmpdir(), "ah-edge-long-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const filePath = join(root, longName);
  try {
    // Long-path-enabled systems (and POSIX) accept the name; the harness
    // must pass it through VERBATIM — never truncate or mangle it.
    await writeTextFile(filePath, "long");
    assert.equal(await readTextFileOrNull(filePath), "long");
  } catch (error) {
    // Windows without the LongPathsEnabled policy rejects the 255-char
    // name. That OS-level error must surface deterministically — never a
    // silent truncation or a partial write.
    const code = (error as NodeJS.ErrnoException).code;
    assert.match(
      String(code ?? error),
      /ENAMETOOLONG|ELOOP|ENOENT|EINVAL|EPERM/u,
      `long-name write must succeed verbatim or surface the OS error, got ${code}`,
    );
  }
});

void test("null-byte filenames are rejected by the OS, never silently mangled (review)", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "ah-edge-nul-"));
  context.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    writeTextFile(join(root, "bad\u0000name.json"), "x"),
    /ERR_INVALID_ARG_VALUE|ENOENT|EINVAL/u,
    "a null byte in a path must throw, never write elsewhere",
  );
});

void test("empty and extension-less JSONL inputs produce empty entry lists (review)", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "ah-edge-jsonl-"));
  context.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, "empty.jsonl"), "", "utf8");
  assert.deepEqual(
    await readJsonLinesFile(join(root, "empty.jsonl"), assertAssetCatalogEntry),
    [],
    "0-byte jsonl reads as no entries",
  );

  const whitespacePath = join(root, "  .jsonl");
  await writeTextFile(whitespacePath, "\n\n");
  assert.deepEqual(
    await readJsonLinesFile(whitespacePath, assertAssetCatalogEntry),
    [],
    "blank lines are not entries",
  );
  assert.equal(await pathExists(whitespacePath), true);
});

void test("hostile names normalize through sanitizers without traversal or jsons: syntax abuse (review)", () => {
  const hostile = [
    "../..\\..\\evil",
    "a/../../b",
    "..",
    ".",
    "",
    "asset",
    "CON",
    "with spaces  and  runs",
    "--double-dash-run--",
    "null\u0000byte",
    "unicode-\u00e9\u4e2d\u6587-name",
    "emoji-\ud83d\ude80-ok",
  ];
  for (const value of hostile) {
    const id = sanitizeAssetId(value);
    assert.doesNotMatch(
      id,
      /(^|[\\/])\.\.([\\/]|$)/u,
      `${JSON.stringify(value)}: no traversal`,
    );
    assert.ok(!id.includes("\u0000"), `${JSON.stringify(value)}: no null byte`);
    assert.ok(
      id.length >= 13,
      `${JSON.stringify(value)}: hash suffix always present`,
    );
    const mirror = sanitizeMirrorId(value);
    assert.ok(
      !mirror.includes("\u0000"),
      `${JSON.stringify(value)}: mirror id strips nulls`,
    );
  }

  // Whitespace-only and empty input fall back to a stable placeholder.
  assert.match(sanitizeAssetId("   "), /^asset-[0-9a-f]{12}$/u);
  assert.match(sanitizeAssetId(""), /^asset-[0-9a-f]{12}$/u);
});
