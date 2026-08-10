import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  findDisallowedExclusions,
  findUnallowlistedInlineIgnoreBlocks,
  main,
  mainInlineIgnores,
  parseCoverageConfig,
} from "../check-coverage-exclusions.mjs";

describe("parseCoverageConfig", () => {
  it("parses a valid c8 config with an exclude array", () => {
    const parsed = parseCoverageConfig(
      JSON.stringify({ reporter: ["text"], exclude: ["dist/tests/**"] }),
    );
    assert.deepEqual(parsed?.exclude, ["dist/tests/**"]);
  });

  it("returns null for invalid JSON", () => {
    assert.equal(parseCoverageConfig("not json"), null);
  });

  it("returns null when exclude is missing or not an array", () => {
    assert.equal(parseCoverageConfig('{"reporter":["text"]}'), null);
    assert.equal(parseCoverageConfig('{"exclude":"dist/tests/**"}'), null);
  });

  it("returns null for empty content", () => {
    assert.equal(parseCoverageConfig(""), null);
  });
});

describe("findDisallowedExclusions", () => {
  it("allows only non-product exclusions", () => {
    const disallowed = findDisallowedExclusions([
      "dist/tests/**",
      "dist/types/**",
      "scripts/tests/**",
    ]);
    assert.deepEqual(disallowed, []);
  });

  it("flags product modules, including patterns and nested paths", () => {
    const disallowed = findDisallowedExclusions([
      "dist/tests/**",
      "dist/discover.js",
      "dist/domains/foo.js",
      "src/bar.js",
    ]);
    assert.deepEqual(disallowed, [
      "dist/discover.js",
      "dist/domains/foo.js",
      "src/bar.js",
    ]);
  });

  it("flags any future module added without justification", () => {
    const disallowed = findDisallowedExclusions([
      "dist/tests/**",
      "dist/new-module.js",
    ]);
    assert.ok(disallowed.includes("dist/new-module.js"));
  });

  it("handles an empty exclude list", () => {
    assert.deepEqual(findDisallowedExclusions([]), []);
  });
});

describe("findUnallowlistedInlineIgnoreBlocks", () => {
  async function createFixture() {
    const root = await mkdtemp(join(tmpdir(), "inline-ignore-scan-"));
    const write = async (relativePath, content) => {
      const path = join(root, relativePath);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, content);
    };
    await write(
      "src/allowed-file.ts",
      "/* c8 ignore start */\n/* c8 ignore stop */\n",
    );
    await write(
      "src/domains/offender.ts",
      "function x() {}\n/* c8 ignore start */\nfunction y() {}\n/* c8 ignore stop */\n",
    );
    await write("src/clean.ts", "function z() {}\n");
    await write("src/note.json", '{"note": true}\n');
    await write(
      "src/tests/inside-tests.ts",
      "/* c8 ignore start */\n/* c8 ignore stop */\n",
    );
    return root;
  }

  it("flags product files with ignore blocks outside the allowlist", async () => {
    const root = await createFixture();
    try {
      const offenders = await findUnallowlistedInlineIgnoreBlocks(
        root,
        new Set(["src/allowed-file.ts"]),
      );
      assert.deepEqual(offenders, ["src/domains/offender.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores test files entirely", async () => {
    const root = await createFixture();
    try {
      const offenders = await findUnallowlistedInlineIgnoreBlocks(
        root,
        new Set(),
      );
      assert.deepEqual(offenders, [
        "src/allowed-file.ts",
        "src/domains/offender.ts",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns an empty list for a clean tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "inline-ignore-clean-"));
    try {
      await rm(root, { recursive: true, force: true });
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "clean.ts"), "export const x = 1;\n");
      assert.deepEqual(
        await findUnallowlistedInlineIgnoreBlocks(root, new Set()),
        [],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts every remaining product block file in the repo (#451)", async () => {
    const { dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    assert.deepEqual(await findUnallowlistedInlineIgnoreBlocks(repoRoot), []);
  });

  it("mainInlineIgnores exits 1 and lists offenders for an unallowlisted block", async () => {
    const root = await createFixture();
    const logs = [];
    const origError = console.error;
    console.error = (...args) => logs.push(args.join(" "));
    try {
      const code = await mainInlineIgnores(root);
      assert.equal(code, 1);
      assert.match(logs.join(""), /inline-ignore-blocks check: FAIL/u);
      assert.match(logs.join(""), /src\/domains\/offender\.ts/u);
    } finally {
      console.error = origError;
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("main", () => {
  it("exits 0 for a clean exclusion list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coverage-exclusions-ok-"));
    try {
      const configFile = join(dir, ".c8rc.json");
      await writeFile(
        configFile,
        JSON.stringify({ exclude: ["dist/tests/**", "dist/types/**"] }),
      );
      const logs = [];
      const origLog = console.log;
      console.log = (...args) => logs.push(args.join(" "));
      try {
        const code = await main(configFile);
        assert.equal(code, 0);
        assert.match(logs.join(""), /OK/u);
      } finally {
        console.log = origLog;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 and lists disallowed product exclusions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coverage-exclusions-bad-"));
    try {
      const configFile = join(dir, ".c8rc.json");
      await writeFile(
        configFile,
        JSON.stringify({ exclude: ["dist/tests/**", "dist/discover.js"] }),
      );
      const logs = [];
      const origError = console.error;
      console.error = (...args) => logs.push(args.join(" "));
      try {
        const code = await main(configFile);
        assert.equal(code, 1);
        assert.match(logs.join(""), /FAIL/u);
        assert.match(logs.join(""), /dist\/discover\.js/u);
      } finally {
        console.error = origError;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 for an unreadable config file", async () => {
    const logs = [];
    const origError = console.error;
    console.error = (...args) => logs.push(args.join(" "));
    try {
      const code = await main("/nonexistent/.c8rc.json");
      assert.equal(code, 1);
      assert.ok(logs.some((l) => l.includes("Failed to read")));
    } finally {
      console.error = origError;
    }
  });

  it("exits 1 for invalid config content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coverage-exclusions-invalid-"));
    try {
      const configFile = join(dir, ".c8rc.json");
      await writeFile(configFile, "not json");
      const logs = [];
      const origError = console.error;
      console.error = (...args) => logs.push(args.join(" "));
      try {
        const code = await main(configFile);
        assert.equal(code, 1);
        assert.ok(logs.some((l) => l.includes("not a valid JSON")));
      } finally {
        console.error = origError;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exercises the CLI entrypoint .then() chain", async () => {
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

  // #428 AC letter: the gate tool itself must not carry c8-ignore comments.
  // Spawning the direct-execution guard (resolve(argv[1]) === import.meta.url
  // truthy arm) covers those lines for real; the harness merges the child's
  // lcov back into the gate.
  it("runs the direct-execution entrypoint against the repo config and exits 0", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const scriptPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "check-coverage-exclusions.mjs",
    );
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [scriptPath],
      { cwd: repoRoot },
    );
    assert.match(`${stdout}${stderr}`, /coverage-exclusions check: OK/u);
  });
});
