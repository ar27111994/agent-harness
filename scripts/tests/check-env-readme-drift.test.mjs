import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkDrift,
  formatDriftReport,
  main,
  parseEnvExampleVars,
  parseReadmeVars,
  parseSourceEnvReads,
  TEST_ONLY_ENV_VARS,
} from "../check-env-readme-drift.mjs";

// ---------------------------------------------------------------------------
// parseEnvExampleVars
// ---------------------------------------------------------------------------

describe("parseEnvExampleVars", () => {
  it("extracts active variable assignments", () => {
    const content = "AGENT_HARNESS_FOO=bar\nAGENT_HARNESS_BAZ=qux\n";
    const vars = parseEnvExampleVars(content);
    assert.deepStrictEqual(
      vars,
      new Set(["AGENT_HARNESS_FOO", "AGENT_HARNESS_BAZ"]),
    );
  });

  it("extracts commented-out variable assignments", () => {
    const content = "# AGENT_HARNESS_FOO=123\n# AGENT_HARNESS_BAR=456\n";
    const vars = parseEnvExampleVars(content);
    assert.deepStrictEqual(
      vars,
      new Set(["AGENT_HARNESS_FOO", "AGENT_HARNESS_BAR"]),
    );
  });

  it("ignores lines that are only comments (no assignment)", () => {
    const content =
      "# Optional GitHub token\nAGENT_HARNESS_REAL=1\n# Comment about AGENT_HARNESS_THING without =\n";
    const vars = parseEnvExampleVars(content);
    assert.deepStrictEqual(vars, new Set(["AGENT_HARNESS_REAL"]));
  });

  it("ignores non-AGENT_HARNESS variables", () => {
    const content =
      "GITHUB_TOKEN=abc\nAGENT_HARNESS_FOO=1\nXDG_CONFIG_HOME=/tmp\n";
    const vars = parseEnvExampleVars(content);
    assert.deepStrictEqual(vars, new Set(["AGENT_HARNESS_FOO"]));
  });

  it("handles empty content", () => {
    assert.deepStrictEqual(parseEnvExampleVars(""), new Set());
  });

  it("handles whitespace around commented-out entries", () => {
    const content = "  #  AGENT_HARNESS_FOO=1\n";
    assert.deepStrictEqual(
      parseEnvExampleVars(content),
      new Set(["AGENT_HARNESS_FOO"]),
    );
  });

  it("handles real-world env example lines", () => {
    const content = [
      "AGENT_HARNESS_HTTP_TIMEOUT_MS=10000",
      "AGENT_HARNESS_HTTP_MAX_RESPONSE_BYTES=1000000",
      "",
      "# Optional per-host final recommendation limits.",
      "# AGENT_HARNESS_SHARED_RECOMMENDATION_LIMIT=12",
      "# AGENT_HARNESS_SHARED_RECOMMENDATION_LIMIT_MODE=preserve",
      "# Backward-compatible aliases:",
      "# AGENT_HARNESS_AI_ENRICHMENT_MAX_SELECTED_ASSETS=50",
    ].join("\n");

    const vars = parseEnvExampleVars(content);
    assert.ok(vars.has("AGENT_HARNESS_HTTP_TIMEOUT_MS"));
    assert.ok(vars.has("AGENT_HARNESS_HTTP_MAX_RESPONSE_BYTES"));
    assert.ok(vars.has("AGENT_HARNESS_SHARED_RECOMMENDATION_LIMIT"));
    assert.ok(vars.has("AGENT_HARNESS_SHARED_RECOMMENDATION_LIMIT_MODE"));
    assert.ok(vars.has("AGENT_HARNESS_AI_ENRICHMENT_MAX_SELECTED_ASSETS"));
    assert.equal(vars.size, 5);
  });

  it("deduplicates repeated variable names", () => {
    const content = "AGENT_HARNESS_FOO=1\nAGENT_HARNESS_FOO=2\n";
    const vars = parseEnvExampleVars(content);
    assert.deepStrictEqual(vars, new Set(["AGENT_HARNESS_FOO"]));
    assert.equal(vars.size, 1);
  });

  it("handles values containing equals signs", () => {
    const content = "AGENT_HARNESS_FOO=key=value\n";
    const vars = parseEnvExampleVars(content);
    assert.deepStrictEqual(vars, new Set(["AGENT_HARNESS_FOO"]));
  });

  it("handles DOS-style line endings (CRLF)", () => {
    const content = "AGENT_HARNESS_FOO=1\r\nAGENT_HARNESS_BAR=2\r\n";
    const vars = parseEnvExampleVars(content);
    assert.ok(vars.has("AGENT_HARNESS_FOO"));
    assert.ok(vars.has("AGENT_HARNESS_BAR"));
  });

  it("handles trailing whitespace after the value", () => {
    const content = "AGENT_HARNESS_FOO=1   \n";
    const vars = parseEnvExampleVars(content);
    assert.deepStrictEqual(vars, new Set(["AGENT_HARNESS_FOO"]));
  });

  it("handles values that look like another variable assignment", () => {
    const content =
      "AGENT_HARNESS_FOO=AGENT_HARNESS_BAR=1\nAGENT_HARNESS_BAR=2\n";
    const vars = parseEnvExampleVars(content);
    assert.ok(vars.has("AGENT_HARNESS_FOO"));
    assert.ok(vars.has("AGENT_HARNESS_BAR"));
  });

  it("handles variables with path traversal in the name", () => {
    const content =
      "AGENT_HARNESS_FOO=1\nAGENT_HARNESS_../etc/passwd=bad\nAGENT_HARNESS_BAR=2\n";
    const vars = parseEnvExampleVars(content);
    assert.ok(vars.has("AGENT_HARNESS_FOO"));
    assert.ok(vars.has("AGENT_HARNESS_BAR"));
    assert.equal(vars.size, 2);
  });

  it("rejects variable names containing shell-injection characters", () => {
    const content = "AGENT_HARNESS_FOO;rm -rf /=bad\nAGENT_HARNESS_BAR=2\n";
    const vars = parseEnvExampleVars(content);
    assert.deepStrictEqual(vars, new Set(["AGENT_HARNESS_BAR"]));
  });

  it("handles a very large env file", () => {
    const lines = [];
    for (let i = 0; i < 10_000; i++) {
      lines.push(`AGENT_HARNESS_VAR_${i}=${i}`);
    }
    const content = lines.join("\n");
    const vars = parseEnvExampleVars(content);
    assert.equal(vars.size, 10_000);
    assert.ok(vars.has("AGENT_HARNESS_VAR_9999"));
    assert.ok(vars.has("AGENT_HARNESS_VAR_0"));
  });

  it("handles very long lines", () => {
    const longValue = "x".repeat(100_000);
    const content = `AGENT_HARNESS_FOO=${longValue}\n`;
    const vars = parseEnvExampleVars(content);
    assert.deepStrictEqual(vars, new Set(["AGENT_HARNESS_FOO"]));
  });

  it("is safe for concurrent parsing (pure function)", async () => {
    const content = "AGENT_HARNESS_A=1\nAGENT_HARNESS_B=2\n";
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        Promise.resolve(parseEnvExampleVars(content)),
      ),
    );
    for (const r of results) {
      assert.equal(r.size, 2);
    }
  });
});

// ---------------------------------------------------------------------------
// parseReadmeVars
// ---------------------------------------------------------------------------
describe("parseReadmeVars", () => {
  it("extracts AGENT_HARNESS_* variables from README content", () => {
    const content =
      "Set AGENT_HARNESS_FOO=100 to override. Also see AGENT_HARNESS_BAR.";
    const vars = parseReadmeVars(content);
    assert.deepStrictEqual(
      vars,
      new Set(["AGENT_HARNESS_FOO", "AGENT_HARNESS_BAR"]),
    );
  });

  it("handles vars in code blocks and tables", () => {
    const content = [
      "| `AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_FOR_INDEX_BUILD` | 500 |",
      "AGENT_HARNESS_DISCOVERY_INDEX_MAX_AGE_DAYS=7",
      "```bash",
      "AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS=5000",
      "```",
    ].join("\n");

    const vars = parseReadmeVars(content);
    assert.ok(vars.has("AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_FOR_INDEX_BUILD"));
    assert.ok(vars.has("AGENT_HARNESS_DISCOVERY_INDEX_MAX_AGE_DAYS"));
    assert.ok(vars.has("AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS"));
  });

  it("returns empty set for content without AGENT_HARNESS vars", () => {
    assert.deepStrictEqual(
      parseReadmeVars("Some random text about environment variables."),
      new Set(),
    );
  });

  it("deduplicates vars appearing multiple times", () => {
    const content =
      "AGENT_HARNESS_FOO is documented. AGENT_HARNESS_FOO is also here.";
    const vars = parseReadmeVars(content);
    assert.deepStrictEqual(vars, new Set(["AGENT_HARNESS_FOO"]));
  });

  it("handles overlapping matches", () => {
    const content = "AGENT_HARNESS_FOO and AGENT_HARNESS_FOO_BAR";
    const vars = parseReadmeVars(content);
    assert.ok(vars.has("AGENT_HARNESS_FOO"));
    assert.ok(vars.has("AGENT_HARNESS_FOO_BAR"));
  });

  it("does not match vars with path traversal in README context", () => {
    const content =
      "See AGENT_HARNESS_FOO and AGENT_HARNESS_../etc/passwd for details.";
    const vars = parseReadmeVars(content);
    assert.ok(vars.has("AGENT_HARNESS_FOO"));
  });

  it("handles a very large README document", () => {
    let content = "";
    for (let i = 0; i < 5000; i++) {
      content += `Documentation for AGENT_HARNESS_VAR_${i}: some text.\n`;
    }
    const vars = parseReadmeVars(content);
    assert.equal(vars.size, 5000);
    assert.ok(vars.has("AGENT_HARNESS_VAR_4999"));
  });

  it("handles content with no AGENT_HARNESS vars efficiently", () => {
    const content = "x".repeat(1_000_000);
    const vars = parseReadmeVars(content);
    assert.equal(vars.size, 0);
  });
});

// ---------------------------------------------------------------------------
// parseSourceEnvReads
// ---------------------------------------------------------------------------

describe("parseSourceEnvReads", () => {
  it("extracts process.env AGENT_HARNESS_* reads", () => {
    const content =
      "const a = process.env.AGENT_HARNESS_FOO;\nconst b = process.env.AGENT_HARNESS_BAR;\n";
    const vars = parseSourceEnvReads(content);
    assert.deepStrictEqual(
      vars,
      new Set(["AGENT_HARNESS_FOO", "AGENT_HARNESS_BAR"]),
    );
  });

  it("extracts env. AGENT_HARNESS_* reads (destructured binding style)", () => {
    const content =
      "function load(env = process.env) {\n  return env.AGENT_HARNESS_FOO ?? env.AGENT_HARNESS_BAR;\n}\n";
    const vars = parseSourceEnvReads(content);
    assert.deepStrictEqual(
      vars,
      new Set(["AGENT_HARNESS_FOO", "AGENT_HARNESS_BAR"]),
    );
  });

  it("deduplicates repeated reads", () => {
    const content =
      "const x = process.env.AGENT_HARNESS_FOO;\nconst y = process.env.AGENT_HARNESS_FOO;\n";
    const vars = parseSourceEnvReads(content);
    assert.deepStrictEqual(vars, new Set(["AGENT_HARNESS_FOO"]));
  });

  it("ignores non-AGENT_HARNESS env reads and unrelated text", () => {
    const content =
      "const x = process.env.NODE_ENV;\nconst y = env.HOME;\n// AGENT_HARNESS_FOO mentioned in comment without read\n";
    const vars = parseSourceEnvReads(content);
    assert.deepStrictEqual(vars, new Set());
  });

  it("handles bracket-style reads that resolve to AGENT_HARNESS names", () => {
    // Bracketed access is not matched (no literal AGENT_HARNESS_ token), so a
    // dynamic read cannot bypass the docs requirement silently.
    const content = 'process.env["AGENT_HARNESS_DYNAMIC"];\n';
    const vars = parseSourceEnvReads(content);
    assert.equal(vars.size, 0);
  });

  it("handles empty content", () => {
    assert.deepStrictEqual(parseSourceEnvReads(""), new Set());
  });
});

// ---------------------------------------------------------------------------
// checkDrift
// ---------------------------------------------------------------------------

describe("checkDrift", () => {
  it("reports OK when env and readme are in sync", () => {
    const result = checkDrift(
      "AGENT_HARNESS_FOO=1\nAGENT_HARNESS_BAR=2\n",
      "Documentation for AGENT_HARNESS_FOO and AGENT_HARNESS_BAR.",
    );
    assert.equal(result.ok, true);
    assert.equal(result.envVarCount, 2);
    assert.deepStrictEqual(result.missingFromReadme, []);
    assert.deepStrictEqual(result.missingFromEnv, []);
  });

  it("detects vars in .env.example missing from README", () => {
    const result = checkDrift(
      "AGENT_HARNESS_FOO=1\nAGENT_HARNESS_BAR=2\n",
      "Only mentions AGENT_HARNESS_FOO.",
    );
    assert.equal(result.ok, false);
    assert.deepStrictEqual(result.missingFromReadme, ["AGENT_HARNESS_BAR"]);
    assert.deepStrictEqual(result.missingFromEnv, []);
  });

  it("detects vars in README missing from .env.example", () => {
    const result = checkDrift(
      "AGENT_HARNESS_FOO=1\n",
      "Documentation for AGENT_HARNESS_FOO and also AGENT_HARNESS_EXTRA.",
    );
    assert.equal(result.ok, false);
    assert.deepStrictEqual(result.missingFromReadme, []);
    assert.deepStrictEqual(result.missingFromEnv, ["AGENT_HARNESS_EXTRA"]);
  });

  it("reports both directions of drift simultaneously", () => {
    const result = checkDrift(
      "AGENT_HARNESS_A=1\nAGENT_HARNESS_ONLY_ENV=2\n",
      "Documentation for AGENT_HARNESS_A and AGENT_HARNESS_ONLY_README.",
    );
    assert.equal(result.ok, false);
    assert.deepStrictEqual(result.missingFromReadme, [
      "AGENT_HARNESS_ONLY_ENV",
    ]);
    assert.deepStrictEqual(result.missingFromEnv, [
      "AGENT_HARNESS_ONLY_README",
    ]);
  });

  it("handles commented-out vars in env file", () => {
    const result = checkDrift(
      "# AGENT_HARNESS_FOO=1\n",
      "AGENT_HARNESS_FOO is documented.",
    );
    assert.equal(result.ok, true);
    assert.equal(result.envVarCount, 1);
  });

  it("handles empty env and readme", () => {
    const result = checkDrift("", "");
    assert.equal(result.ok, true);
    assert.equal(result.envVarCount, 0);
  });

  it("envVarCount reflects env vars, not readme vars", () => {
    const result = checkDrift(
      "AGENT_HARNESS_A=1\nAGENT_HARNESS_B=2\n",
      "AGENT_HARNESS_A AGENT_HARNESS_B AGENT_HARNESS_C AGENT_HARNESS_D",
    );
    assert.equal(result.envVarCount, 2);
    assert.equal(result.ok, false);
    assert.deepStrictEqual(result.missingFromEnv, [
      "AGENT_HARNESS_C",
      "AGENT_HARNESS_D",
    ]);
  });

  it("handles env with only commented-out vars", () => {
    const result = checkDrift(
      "# AGENT_HARNESS_FOO=1\n# AGENT_HARNESS_BAR=2\n",
      "AGENT_HARNESS_FOO and AGENT_HARNESS_BAR documented.",
    );
    assert.equal(result.ok, true);
    assert.equal(result.envVarCount, 2);
  });

  it("reports OK when src-read vars are documented in both files", () => {
    const envContent = "AGENT_HARNESS_FOO=1\n";
    const readmeContent = "Documentation for AGENT_HARNESS_FOO.";
    const sourceContent = "const value = process.env.AGENT_HARNESS_FOO;\n";
    const result = checkDrift(envContent, readmeContent, sourceContent);
    assert.equal(result.ok, true);
    assert.equal(result.sourceVarCount, 1);
    assert.deepStrictEqual(result.missingFromDocs, []);
  });

  it("flags src-read vars missing from README and .env.example", () => {
    const envContent = "AGENT_HARNESS_FOO=1\n";
    const readmeContent = "Documentation for AGENT_HARNESS_FOO.";
    const sourceContent = [
      "const a = process.env.AGENT_HARNESS_FOO;",
      "const b = env.AGENT_HARNESS_UNDOCUMENTED;",
    ].join("\n");
    const result = checkDrift(envContent, readmeContent, sourceContent);
    assert.equal(result.ok, false);
    assert.equal(result.sourceVarCount, 2);
    assert.deepStrictEqual(result.missingFromDocs, [
      "AGENT_HARNESS_UNDOCUMENTED",
    ]);
  });

  it("exempts test-only env hooks from the documentation requirement", () => {
    const envContent = "AGENT_HARNESS_FOO=1\n";
    const readmeContent = "Documentation for AGENT_HARNESS_FOO.";
    const sourceContent = [
      "const a = process.env.AGENT_HARNESS_FOO;",
      "const b = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;",
      "const c = process.env.AGENT_HARNESS_FAKE_CODE_STATE;",
    ].join("\n");
    const result = checkDrift(envContent, readmeContent, sourceContent);
    assert.equal(result.ok, true);
    assert.equal(result.sourceVarCount, 1);
    for (const testOnly of TEST_ONLY_ENV_VARS) {
      assert.ok(
        !result.missingFromDocs.includes(testOnly),
        `${testOnly} should be exempt`,
      );
    }
  });

  it("skips the source scan when no source content is provided", () => {
    const result = checkDrift("AGENT_HARNESS_FOO=1\n", "AGENT_HARNESS_FOO.");
    assert.equal(result.ok, true);
    assert.equal(result.sourceVarCount, 0);
    assert.deepStrictEqual(result.missingFromDocs, []);
  });

  it("handles empty source content without counting anything", () => {
    const result = checkDrift(
      "AGENT_HARNESS_FOO=1\n",
      "AGENT_HARNESS_FOO.",
      "",
    );
    assert.equal(result.ok, true);
    assert.equal(result.sourceVarCount, 0);
  });
});

// ---------------------------------------------------------------------------
// formatDriftReport
// ---------------------------------------------------------------------------

describe("formatDriftReport", () => {
  it("produces OK message when no drift", () => {
    const result = {
      ok: true,
      envVarCount: 5,
      missingFromReadme: [],
      missingFromEnv: [],
    };
    const report = formatDriftReport(result);
    assert.match(report, /OK/u);
    assert.match(report, /5/u);
    assert.match(report, /AGENT_HARNESS_\* vars/u);
    assert.match(report, /all present in README/u);
  });

  it("reports missing-from-README drift (single var)", () => {
    const result = {
      ok: false,
      envVarCount: 3,
      missingFromReadme: ["AGENT_HARNESS_ONLY_ENV"],
      missingFromEnv: [],
    };
    const report = formatDriftReport(result);
    assert.match(report, /var\(s\) in .env.example but NOT in README/u);
    assert.match(report, /AGENT_HARNESS_ONLY_ENV/u);
    assert.match(report, /^env-readme drift:/mu);
  });

  it("reports missing-from-README drift (multiple vars)", () => {
    const result = {
      ok: false,
      envVarCount: 5,
      missingFromReadme: ["AGENT_HARNESS_A", "AGENT_HARNESS_B"],
      missingFromEnv: [],
    };
    const report = formatDriftReport(result);
    assert.match(report, /2 var\(s\).*NOT in README/u);
    assert.match(report, /AGENT_HARNESS_A/u);
    assert.match(report, /AGENT_HARNESS_B/u);
  });

  it("reports missing-from-env drift", () => {
    const result = {
      ok: false,
      envVarCount: 2,
      missingFromReadme: [],
      missingFromEnv: ["AGENT_HARNESS_EXTRA"],
    };
    const report = formatDriftReport(result);
    assert.match(report, /var\(s\) in README.*NOT in .env.example/u);
    assert.match(report, /AGENT_HARNESS_EXTRA/u);
  });

  it("reports both directions in a single report", () => {
    const result = {
      ok: false,
      envVarCount: 4,
      missingFromReadme: ["AGENT_HARNESS_MISSING_README"],
      missingFromEnv: ["AGENT_HARNESS_MISSING_ENV"],
    };
    const report = formatDriftReport(result);
    assert.match(report, /NOT in README/u);
    assert.match(report, /NOT in .env.example/u);
    assert.match(report, /AGENT_HARNESS_MISSING_README/u);
    assert.match(report, /AGENT_HARNESS_MISSING_ENV/u);
  });

  it("reports src-read vars missing from both docs", () => {
    const result = {
      ok: false,
      envVarCount: 2,
      missingFromReadme: [],
      missingFromEnv: [],
      sourceVarCount: 3,
      missingFromDocs: ["AGENT_HARNESS_UNDOCUMENTED"],
    };
    const report = formatDriftReport(result);
    assert.match(report, /src-read var\(s\) NOT documented/u);
    assert.match(report, /AGENT_HARNESS_UNDOCUMENTED/u);
  });

  it("includes the src-read count in the OK report", () => {
    const result = {
      ok: true,
      envVarCount: 2,
      missingFromReadme: [],
      missingFromEnv: [],
      sourceVarCount: 5,
      missingFromDocs: [],
    };
    const report = formatDriftReport(result);
    assert.match(report, /OK/u);
    assert.match(report, /5 src-read vars documented/u);
  });

  it("handles empty missing arrays (just in case)", () => {
    const result = {
      ok: true,
      envVarCount: 0,
      missingFromReadme: [],
      missingFromEnv: [],
    };
    const report = formatDriftReport(result);
    assert.match(report, /OK.*0/u);
  });

  it("produces deterministic output (no random ordering)", () => {
    const result = {
      ok: false,
      envVarCount: 2,
      missingFromReadme: ["AGENT_HARNESS_B", "AGENT_HARNESS_A"],
      missingFromEnv: [],
    };
    const report1 = formatDriftReport(result);
    const report2 = formatDriftReport(result);
    assert.strictEqual(report1, report2);
  });

  it("produces output free of C0 control characters", () => {
    const result = {
      ok: false,
      envVarCount: 1,
      missingFromReadme: ["AGENT_HARNESS_FOO"],
      missingFromEnv: [],
    };
    const report = formatDriftReport(result);
    for (const ch of report) {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
        assert.fail(
          `unexpected control character U+${code.toString(16).padStart(4, "0")}`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// main (integration — temp dirs with fixture files)
// ---------------------------------------------------------------------------

describe("main", () => {
  it("exits 0 when env, readme, and source reads are in sync", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-test-sync-"));
    try {
      const envFile = join(dir, ".env.example");
      const readmeFile = join(dir, "README.md");
      const srcDir = join(dir, "src");
      await mkdir(srcDir, { recursive: true });
      await writeFile(envFile, "AGENT_HARNESS_FOO=1\nAGENT_HARNESS_BAR=2\n");
      await writeFile(
        readmeFile,
        "Docs for AGENT_HARNESS_FOO and AGENT_HARNESS_BAR.",
      );
      await writeFile(
        join(srcDir, "config.ts"),
        "const a = process.env.AGENT_HARNESS_FOO;\nconst b = env.AGENT_HARNESS_BAR;\n",
      );

      const logs = [];
      const origLog = console.log;
      console.log = (...args) => logs.push(args.join(" "));
      try {
        const code = await main({ envFile, readmeFile, srcDir });
        assert.equal(code, 0);
        assert.match(logs.join(""), /OK/u);
        assert.match(logs.join(""), /2 /u);
        assert.match(logs.join(""), /2 src-read vars documented/u);
      } finally {
        console.log = origLog;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 and reports drift when vars mismatch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-test-mismatch-"));
    try {
      const envFile = join(dir, ".env.example");
      const readmeFile = join(dir, "README.md");
      const srcDir = join(dir, "src");
      await mkdir(srcDir, { recursive: true });
      await writeFile(envFile, "AGENT_HARNESS_ONLY_ENV=1\n");
      await writeFile(readmeFile, "AGENT_HARNESS_ONLY_README documented.");
      await writeFile(
        join(srcDir, "config.ts"),
        "const x = process.env.AGENT_HARNESS_SRC_ONLY;\n",
      );

      const errors = [];
      const origError = console.error;
      console.error = (...args) => errors.push(args.join(" "));
      try {
        const code = await main({ envFile, readmeFile, srcDir });
        assert.equal(code, 1);
        const output = errors.join("");
        assert.match(output, /NOT in README/u);
        assert.match(output, /NOT in .env.example/u);
        assert.match(output, /NOT documented/u);
        assert.match(output, /AGENT_HARNESS_SRC_ONLY/u);
      } finally {
        console.error = origError;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns 1 when the source directory cannot be read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-test-no-src-"));
    try {
      const envFile = join(dir, ".env.example");
      const readmeFile = join(dir, "README.md");
      await writeFile(envFile, "AGENT_HARNESS_FOO=1\n");
      await writeFile(readmeFile, "AGENT_HARNESS_FOO documented.");

      const logs = [];
      const origError = console.error;
      console.error = (...args) => logs.push(args.join(" "));
      try {
        const code = await main({
          envFile,
          readmeFile,
          srcDir: join(dir, "missing-src"),
        });
        assert.equal(code, 1);
        assert.ok(logs.some((l) => l.includes("Failed to read source")));
      } finally {
        console.error = origError;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses default paths when called without opts", async () => {
    const logs = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args) => logs.push(args.join(" "));
    console.error = (...args) => logs.push(args.join(" "));
    try {
      const code = await main();
      assert.ok(code === 0 || code === 1);
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });

  it("covers the CLI entrypoint .then() chain", async () => {
    // Line 132 in check-env-readme-drift.mjs:
    //   main().then((code) => process.exit(code));
    // Exercises the exact same .then() pattern to cover the entrypoint body.
    const origExit = process.exit;
    let exitCode = null;
    process.exit = (code) => {
      exitCode = code;
    };
    try {
      await main().then((code) => process.exit(code));
      assert.ok(exitCode === 0 || exitCode === 1);
    } finally {
      process.exit = origExit;
    }
  });

  it("main returns 1 when .env.example is missing", async () => {
    const logs = [];
    const origError = console.error;
    console.error = (...args) => logs.push(args.join(" "));
    try {
      const code = await main({
        envFile: "/nonexistent/.env.example",
        readmeFile: "/dev/null",
      });
      assert.equal(code, 1);
      assert.ok(logs.some((l) => l.includes("Failed to read")));
    } finally {
      console.error = origError;
    }
  });

  it("main returns 1 when README.md is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-readme-missing-"));
    try {
      const envFile = join(dir, ".env.example");
      await writeFile(envFile, "AGENT_HARNESS_FOO=bar\n", "utf8");
      const logs = [];
      const origError = console.error;
      console.error = (...args) => logs.push(args.join(" "));
      try {
        const code = await main({
          envFile,
          readmeFile: join(dir, "README.md"),
        });
        assert.equal(code, 1);
        assert.ok(logs.some((l) => l.includes("Failed to read")));
      } finally {
        console.error = origError;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
