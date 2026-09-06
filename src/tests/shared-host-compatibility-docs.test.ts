import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { runRecommend } from "../recommend.js";

void test("shared compatibility reference distinguishes catalog tags from concrete adapters", async () => {
  const document = await readFile(
    join(process.cwd(), "docs", "reference", "SHARED-HOST-COMPATIBILITY.md"),
    "utf8",
  );

  assert.match(document, /`shared` is a catalog compatibility\/source tag/iu);
  assert.match(document, /not a registered lifecycle adapter/iu);
  assert.match(document, /MCP server/u);
  assert.match(document, /compatibleHosts/u);
  assert.match(document, /VS Code extension/u);
  assert.match(document, /partial.*Cursor/isu);
  assert.match(
    document,
    /does not make every asset compatible with every host/iu,
  );
});

void test("recommend parent help points users to the shared compatibility reference", async (t) => {
  const lines: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });

  const exitCode = await runRecommend(["help"], process.cwd(), process.cwd());
  assert.equal(exitCode, 0);
  const rendered = lines.join("\n");
  assert.match(rendered, /SHARED-HOST-COMPATIBILITY\.md/u);
  assert.match(rendered, /'shared'.*not a wire\/workspace adapter/iu);
});

void test("recommend facade suppresses the shared note when help has options", async (t) => {
  const lines: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  const exitCode = await runRecommend(
    ["help", "--bogus"],
    process.cwd(),
    process.cwd(),
  );
  assert.equal(exitCode, 1);
  assert.doesNotMatch(lines.join("\n"), /SHARED-HOST-COMPATIBILITY\.md/u);
});
