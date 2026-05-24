import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

void test("v2 demo walkthrough documents the full reproducible value chain", async () => {
  const walkthrough = await readFile(
    join(process.cwd(), "docs", "demo", "v2-opencode-walkthrough.md"),
    "utf8",
  );

  for (const expected of [
    "agent-harness workspace opencode --intent general",
    ".agent-harness/discover/output/demand-profile.json",
    ".agent-harness/discover/output/source-index.json",
    ".agent-harness/discover/output/selection-report.json",
    ".agent-harness/state/recommendations.json",
    ".agent-harness/mirror/bundles/opencode-global.lock.json",
    ".agent-harness/activate/opencode/activation-manifest.json",
    ".agent-harness/activate/opencode/wire-preview-opencode.json",
    ".opencode/context/project-intelligence/agent-harness/wire-plan.json",
    "## Before and after host wiring",
    "## What was selected, skipped, quarantined, staged, activated, and wired",
    "## Quarantine and risk behavior to point out in recordings",
    "TRUST-CENTER.md",
    "QUARANTINE-PLAYBOOK.md",
  ]) {
    assert.match(walkthrough, new RegExp(escapeRegExp(expected), "u"));
  }
});

void test("README and demo index link the v2 walkthrough", async () => {
  const readme = await readFile(join(process.cwd(), "README.md"), "utf8");
  const demoIndex = await readFile(
    join(process.cwd(), "docs", "demo", "README.md"),
    "utf8",
  );

  assert.match(readme, /docs\/demo\/v2-opencode-walkthrough\.md/u);
  assert.match(demoIndex, /v2-opencode-walkthrough\.md/u);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
