import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliPath = fileURLToPath(new URL("../cli.js", import.meta.url));

void test("discover no-option commands reject unknown flags in the built CLI", () => {
  for (const subcommand of ["demand-profile", "sources", "catalog", "index"]) {
    const result = spawnSync(
      process.execPath,
      [cliPath, "discover", subcommand, "--bogus"],
      { encoding: "utf8" },
    );

    assert.notEqual(
      result.status,
      0,
      `discover ${subcommand} --bogus must fail instead of silently running`,
    );
    assert.match(
      `${result.stderr}${result.stdout}`,
      /unknown (?:option|argument).*--bogus/iu,
      `discover ${subcommand} should explain the invalid flag`,
    );
  }
});
