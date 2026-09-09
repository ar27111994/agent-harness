/**
 * Regression tests for scripts/validate-ard-schema.mjs (#486).
 *
 * The ARD export envelope changed once already (generatedAt -> specVersion)
 * and the release.yml gate was patched to read the new field name. A schema
 * guard is the durable fix: validate the generated catalog against the
 * vendored schema so a future envelope change fails LOUDLY at the gate. These
 * tests pin that the guard passes the real catalog and rejects a catalog that
 * is missing specVersion, has empty entries, is not valid JSON, or is a null
 * root.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { after, test } from "node:test";

import {
  validateArdCatalogFile,
  validateJsonSchema,
} from "../validate-ard-schema.mjs";

const scriptPath = join(process.cwd(), "scripts", "validate-ard-schema.mjs");
const schemaPath = join(
  process.cwd(),
  "discover",
  "schema",
  "ard-ai-catalog-1.0.schema.json",
);

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "ard-schema-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runGate(filePath) {
  try {
    await promisify(execFile)(process.execPath, [scriptPath, filePath], {
      cwd: process.cwd(),
    });
    return { code: 0, output: "" };
  } catch (error) {
    return {
      code: error.code ?? -1,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    };
  }
}

void test("the schema guard passes the real committed catalog", async () => {
  const errors = await validateArdCatalogFile(
    join(process.cwd(), ".well-known", "ai-catalog.json"),
    schemaPath,
  );
  assert.deepEqual(errors, []);
  const run = await runGate(
    join(process.cwd(), ".well-known", "ai-catalog.json"),
  );
  assert.equal(run.code, 0);
});

void test("the schema guard rejects a catalog missing specVersion", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "no-spec.json");
    await writeFile(
      path,
      JSON.stringify({
        host: { displayName: "x" },
        entries: [
          {
            identifier: "urn:air:example.com:repo:skill-a",
            displayName: "A",
            type: "application/ai-skill",
            url: "https://example.com/a",
          },
        ],
      }),
      "utf8",
    );
    const errors = await validateArdCatalogFile(path, schemaPath);
    assert.ok(
      errors.some((e) => e.includes("missing required property specVersion")),
    );
    const run = await runGate(path);
    assert.equal(run.code, 1);
    assert.match(run.output, /missing required property specVersion/u);
  });
});

void test("the schema guard rejects a catalog with empty entries", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "empty-entries.json");
    await writeFile(
      path,
      JSON.stringify({ specVersion: "1.0", entries: [] }),
      "utf8",
    );
    const errors = await validateArdCatalogFile(path, schemaPath);
    assert.ok(errors.some((e) => e.includes("expected at least 1 entry")));
    const run = await runGate(path);
    assert.equal(run.code, 1);
    assert.match(run.output, /ARD schema validation failed/u);
  });
});

void test("the schema guard rejects a catalog that is not valid JSON", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "bad.json");
    await writeFile(path, "not valid json {{{", "utf8");
    const errors = await validateArdCatalogFile(path, schemaPath);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /catalog is not valid JSON/u);
    const run = await runGate(path);
    assert.equal(run.code, 1);
    assert.match(run.output, /catalog is not valid JSON/u);
  });
});

void test("the schema guard rejects a null root", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "null.json");
    await writeFile(path, "null", "utf8");
    const errors = await validateArdCatalogFile(path, schemaPath);
    assert.ok(errors.some((e) => e.includes("expected type")));
    const run = await runGate(path);
    assert.equal(run.code, 1);
  });
});

void test("validateJsonSchema rejects an unexpected top-level property (additionalProperties: false)", () => {
  const errors = validateJsonSchema(
    { specVersion: "1.0", entries: [], generatedAt: "2026-01-01T00:00:00Z" },
    {
      type: "object",
      required: ["specVersion", "entries"],
      properties: {
        specVersion: { type: "string" },
        entries: { type: "array" },
      },
      additionalProperties: false,
    },
  );
  assert.ok(errors.some((e) => e.includes("unexpected property generatedAt")));
});

// Restore process.exitCode set by any in-process CLI side effects.
after(() => {
  process.exitCode = undefined;
});
