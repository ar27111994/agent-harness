import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

interface PackageMetadata {
  description: string;
  keywords: string[];
  homepage: string;
  repository: {
    type: string;
    url: string;
  };
  bugs: {
    url: string;
  };
}

const REQUIRED_KEYWORDS = [
  "ai-agents",
  "agent-assets",
  "agent-harness",
  "developer-tools",
  "cli",
  "automation",
  "supply-chain",
  "mcp",
  "github-copilot",
  "vscode",
  "opencode",
  "openai-codex",
  "cursor",
  "zed",
  "claude-code",
  "pi",
] as const;

void test("package metadata describes the public agent-asset lifecycle surface", async () => {
  const metadata = JSON.parse(
    await readFile(join(process.cwd(), "package.json"), "utf8"),
  ) as PackageMetadata;

  assert.match(metadata.description, /discovering, pinning, staging/u);
  assert.match(metadata.description, /reusable AI-agent assets/u);
  assert.match(metadata.description, /developer workspaces/u);
  assert.doesNotMatch(metadata.description, /runs? agents?/iu);

  for (const keyword of REQUIRED_KEYWORDS) {
    assert.ok(
      metadata.keywords.includes(keyword),
      `package keywords should include ${keyword}`,
    );
  }

  assert.equal(
    metadata.homepage,
    "https://github.com/ar27111994/agent-harness#readme",
  );
  assert.deepEqual(metadata.repository, {
    type: "git",
    url: "git+https://github.com/ar27111994/agent-harness.git",
  });
  assert.deepEqual(metadata.bugs, {
    url: "https://github.com/ar27111994/agent-harness/issues",
  });
});
