import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

void test("v2 contract documents stable automation reports", async () => {
  const contract = await readFile(
    join(process.cwd(), "V2-CONTRACT.md"),
    "utf8",
  );

  for (const expected of [
    "discover/output/source-health.json",
    "discover/output/source-drift.json",
    "discover/output/source-verification.json",
    "discover/output/source-candidates.json",
    "discover/output/asset-fingerprints.json",
    "state/quarantine/quarantine-state.json",
    "state/quarantine/reviews.jsonl",
    "state/install/refresh-report.json",
    "state/install/refresh-state.json",
    "activate/<host>/wire-preview-<host>.json",
    "src/types/quarantine.ts",
    "src/types/install.ts",
  ]) {
    assert.match(contract, new RegExp(escapeRegExp(expected), "u"));
  }
});

void test("v2 contract defines apply and compatibility rules", async () => {
  const contract = await readFile(
    join(process.cwd(), "V2-CONTRACT.md"),
    "utf8",
  );

  assert.match(contract, /`--apply` is required/u);
  assert.match(contract, /Additive fields are allowed in v2/u);
  assert.match(contract, /Field removals, type changes, renamed files/u);
  assert.match(contract, /`0` — command completed successfully/u);
  assert.match(contract, /`1` — invalid command\/flags/u);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
