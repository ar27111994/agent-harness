import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

void test("v2 safe defaults are documented in one policy matrix", async () => {
  const safeDefaults = await readFile(
    join(process.cwd(), "SAFE-DEFAULTS.md"),
    "utf8",
  );

  for (const expected of [
    "wire <host>` is preview mode by default",
    "install native --operation install --apply",
    "Quarantined assets remain `blocked-quarantined` until reviewed.",
    "trusted-community` and `unverified-community` executable assets require review",
    "Policy blocks vs hard errors",
    "state/install/refresh-report.json",
    "activate/<host>/wire-preview-<host>.json",
  ]) {
    assert.match(safeDefaults, new RegExp(escapeRegExp(expected), "u"));
  }
});

void test("README, trust center, and package metadata link safe defaults", async () => {
  const readme = await readFile(join(process.cwd(), "README.md"), "utf8");
  const trustCenter = await readFile(
    join(process.cwd(), "TRUST-CENTER.md"),
    "utf8",
  );
  const packageJson = await readFile(
    join(process.cwd(), "package.json"),
    "utf8",
  );

  assert.match(readme, /SAFE-DEFAULTS\.md/u);
  assert.match(trustCenter, /SAFE-DEFAULTS\.md/u);
  assert.match(packageJson, /"SAFE-DEFAULTS\.md"/u);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
