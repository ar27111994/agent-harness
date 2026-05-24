import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

void test("v2 trust center documents safe defaults, guarantees, and non-guarantees", async () => {
  const trustCenter = await readFile(
    join(process.cwd(), "TRUST-CENTER.md"),
    "utf8",
  );

  for (const expected of [
    "official-first-party",
    "official-compatible",
    "trusted-community",
    "unverified-community",
    "Quarantined assets must not be staged, activated, refreshed into an installed generation, or wired",
    "Prompt-injection-like content is a risk signal",
    "The harness will never silently:",
    "install VS Code/Cursor marketplace extensions",
    "enable executable hooks, plugins, MCP servers, or custom tools",
    "source-sync boundary",
    "## Guarantees",
    "## Non-guarantees and limitations",
    "## User responsibilities",
    "## Maintainer responsibilities",
  ]) {
    assert.match(trustCenter, new RegExp(escapeRegExp(expected), "u"));
  }
});

void test("README and maintenance docs link the v2 trust center", async () => {
  const files = [
    "README.md",
    "HARNESS-MAINTENANCE-GUIDE.md",
    "QUARANTINE-PLAYBOOK.md",
  ];

  for (const file of files) {
    const content = await readFile(join(process.cwd(), file), "utf8");
    assert.match(
      content,
      /TRUST-CENTER\.md/u,
      `${file} should link TRUST-CENTER.md`,
    );
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
