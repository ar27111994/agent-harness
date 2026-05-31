import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { REPORT_FILE_PATH } from "../recommend/constants.js";

void test("v2 contract documents the canonical recommendation report path", async () => {
  const contract = await readFile(
    join(process.cwd(), "docs", "guides", "V2-CONTRACT.md"),
    "utf8",
  );

  // Guard against doc/code drift: the contract must document the exact path
  // the recommendation command actually writes, derived from the code constant.
  const canonicalReportPath = REPORT_FILE_PATH.join("/");
  assert.match(
    contract,
    new RegExp(escapeRegExp(canonicalReportPath), "u"),
    `V2-CONTRACT.md must document the canonical recommendation report path "${canonicalReportPath}"`,
  );
});

void test("v2 contract documents stable automation reports", async () => {
  const contract = await readFile(
    join(process.cwd(), "docs", "guides", "V2-CONTRACT.md"),
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
    join(process.cwd(), "docs", "guides", "V2-CONTRACT.md"),
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
