import assert from "node:assert/strict";
import test from "node:test";

import { getWireMode, runWire, runWireEntrypoint } from "../wire.js";

void test("wire mode parsing rejects positional mode tokens with flag guidance", () => {
  for (const mode of ["preview", "apply", "reset"] as const) {
    assert.throws(
      () => getWireMode([mode]),
      new RegExp(`Positional wire mode '${mode}'.*--${mode}`, "u"),
    );
  }
});

void test("wire mode parsing rejects arbitrary positional arguments with canonical choices", () => {
  assert.throws(
    () => getWireMode(["unexpected"]),
    /wire modes must be passed as '--preview', '--apply', or '--reset'/u,
  );
});

void test("wire mode parsing keeps canonical flag behavior", () => {
  assert.equal(getWireMode([]), "preview");
  assert.equal(getWireMode(["--preview"]), "preview");
  assert.equal(getWireMode(["--apply"]), "apply");
  assert.equal(getWireMode(["--reset"]), "reset");
  assert.equal(getWireMode(["--"]), "preview");
});

void test("wire mode parsing treats an option terminator as a positional boundary", () => {
  assert.throws(
    () => getWireMode(["--", "--preview"]),
    /wire modes must be passed/u,
  );
});

void test("wire dispatch rejects positional apply before host preflight", async () => {
  const messages: string[] = [];
  const originalError = console.error;
  console.error = (...values: unknown[]): void => {
    messages.push(values.map(String).join(" "));
  };

  try {
    const exitCode = await runWire(
      ["opencode", "apply"],
      process.cwd(),
      process.cwd(),
    );
    assert.equal(exitCode, 1);
    assert.equal(messages.length, 1);
    assert.match(messages[0] ?? "", /use '--apply' instead/u);
  } finally {
    console.error = originalError;
  }
});

void test("wire dispatch rethrows unexpected parser errors", async () => {
  await assert.rejects(
    runWire(
      ["opencode", {} as unknown as string],
      process.cwd(),
      process.cwd(),
    ),
  );
});

void test("wire entrypoint converts unexpected failures to a non-zero exit code", async (t) => {
  const output: string[] = [];
  const originalExitCode = process.exitCode;
  t.mock.method(console, "error", (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  });

  process.exitCode = undefined;
  await runWireEntrypoint(
    ["opencode"],
    process.cwd(),
    process.cwd(),
    async () => {
      throw new Error("wire fixture failure");
    },
  );

  assert.equal(process.exitCode, 1);
  assert.match(output.join("\n"), /wire fixture failure/u);
  process.exitCode = originalExitCode;
});
