import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

type BaseSource = {
  id: string;
  kind: string;
  hosts: string[];
  enabled: boolean;
  endpoints: Record<string, string>;
};
type PackEntry = {
  id: string;
  kind?: string;
  hosts?: string[];
  enabled?: boolean;
  repo: string;
};

void test("default source configuration covers an official channel for every host", async () => {
  const base = JSON.parse(
    await readFile(join(process.cwd(), "discover", "sources.json"), "utf8"),
  ) as { sources: BaseSource[] };
  const pack = JSON.parse(
    await readFile(
      join(
        process.cwd(),
        "discover",
        "source-packs",
        "official-host-channels-v2.1.json",
      ),
      "utf8",
    ),
  ) as { entries: PackEntry[] };

  const sourceIds = new Set([
    ...base.sources.map((source) => source.id),
    ...pack.entries.map((source) => source.id),
  ]);
  const expectedByHost = new Map<string, string>([
    ["copilot-vscode", "open-vsx-registry"],
    ["opencode", "opencode-official-repo"],
    ["cursor", "cursor-marketplace"],
    ["zed", "zed-extension-registry"],
    ["claude-code", "anthropic-claude-plugins-official"],
    ["pi", "pi-official-skills"],
    ["codex", "openai-codex-repo"],
  ]);

  for (const [host, sourceId] of expectedByHost) {
    assert.ok(
      sourceIds.has(sourceId),
      `${host} missing official channel ${sourceId}`,
    );
  }

  for (const id of [
    "open-vsx-registry",
    "anthropic-claude-plugins-official",
    "openai-codex-repo",
    "opencode-official-repo",
    "pi-official-skills",
  ]) {
    const entry = pack.entries.find((candidate) => candidate.id === id);
    assert.ok(entry, `missing v2.1 official source ${id}`);
    assert.notEqual(
      entry.enabled,
      false,
      `${id} must be asset-producing/enabled`,
    );
    assert.notEqual(entry.kind, "docs", `${id} must not rely on docs scraping`);
  }

  const mcpRegistry = base.sources.find(
    (source) => source.id === "mcp-registry",
  );
  assert.ok(mcpRegistry);
  assert.equal(
    mcpRegistry.endpoints.baseUrl,
    "https://registry.modelcontextprotocol.io/",
  );
  assert.match(
    mcpRegistry.endpoints.apiUrl ?? "",
    /^https:\/\/registry\.modelcontextprotocol\.io\//u,
  );
});
