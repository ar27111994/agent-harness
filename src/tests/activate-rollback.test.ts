import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, rename as fsRename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { activateInternals } from "../activate.js";

const { swapActivationRuntimeRoot } = activateInternals;

async function makeDir(parent: string, name: string): Promise<string> {
  const path = join(parent, name);
  await mkdir(path, { recursive: true });
  return path;
}

void test("normal path — staging replaces runtime", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "ah-normal-"));
  try {
    const runtime = await makeDir(tmp, "runtime");
    await writeFile(join(runtime, "curr.json"), '{"v":1}');
    const staging = await makeDir(tmp, "staging");
    await writeFile(join(staging, "new.json"), '{"v":2}');

    await swapActivationRuntimeRoot(runtime, staging);

    const { readFile } = await import("node:fs/promises");
    const parsed = JSON.parse(
      await readFile(join(runtime, "new.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.deepStrictEqual(parsed, { v: 2 }, "staging content moved to runtime");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

void test("no existing runtime — fresh deploy", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "ah-noroot-"));
  try {
    const runtime = join(tmp, "fresh");
    const staging = await makeDir(tmp, "staging");
    await writeFile(join(staging, "new.json"), '{"v":2}');

    await swapActivationRuntimeRoot(runtime, staging);

    const { readFile } = await import("node:fs/promises");
    const parsed = JSON.parse(
      await readFile(join(runtime, "new.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.deepStrictEqual(parsed, { v: 2 }, "staging deployed to runtime");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

void test("rolls back when staging is missing", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "ah-rollback-"));
  try {
    const runtime = await makeDir(tmp, "runtime");
    await writeFile(join(runtime, "curr.json"), '{"v":1}');
    const staging = join(tmp, "staging");

    try {
      await swapActivationRuntimeRoot(runtime, staging);
      assert.fail("Expected throw");
    } catch (err) {
      assert.ok(
        err instanceof Error && !(err instanceof AggregateError),
        "plain Error when rollback succeeds",
      );
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

void test("AggregateError when both apply rename and rollback rename fail", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "ah-double-"));
  try {
    const runtime = await makeDir(tmp, "runtime");
    await writeFile(join(runtime, "curr.json"), '{"v":1}');
    const staging = await makeDir(tmp, "staging");
    await writeFile(join(staging, "new.json"), '{"v":2}');
    const backupPath = `${runtime}.previous`;

    // Injectable rename: call 1 (backup) succeeds, calls 2+3 (apply, rollback) fail.
    let callCount = 0;
    async function mockRename(oldPath: string, newPath: string) {
      callCount++;
      if (callCount === 1) return fsRename(oldPath, newPath);
      const err = new Error(`rename call ${callCount}`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }

    try {
      await swapActivationRuntimeRoot(runtime, staging, mockRename);
      assert.fail("Expected AggregateError");
    } catch (err) {
      assert.ok(
        err instanceof AggregateError,
        `Expected AggregateError, got ${err?.constructor?.name}`,
      );
      const agg = err as AggregateError;
      assert.strictEqual(agg.errors.length, 2, "contains both errors");
      assert.ok(
        agg.message.includes("rollback also failed"),
        "message describes double failure",
      );
      assert.ok(
        agg.message.includes(backupPath),
        "message includes backup path",
      );
      assert.equal(
        (agg.errors[0] as NodeJS.ErrnoException).code,
        "ENOENT",
        "apply error code preserved",
      );
      assert.equal(
        (agg.errors[1] as NodeJS.ErrnoException).code,
        "ENOENT",
        "rollback error code preserved",
      );
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
