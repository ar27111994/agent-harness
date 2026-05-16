import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  main,
  readJsonFile,
  validateVersionSync,
} from "../check-version-sync.mjs";

const execFileAsync = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(testDir, "..", "check-version-sync.mjs");

test("validateVersionSync accepts matching package and lockfile versions", () => {
  const result = validateVersionSync(
    { version: "1.0.6" },
    {
      version: "1.0.6",
      packages: {
        "": {
          version: "1.0.6",
        },
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.version, "1.0.6");
  assert.deepEqual(result.errors, []);
});

test("validateVersionSync reports top-level and root-package drift", () => {
  const result = validateVersionSync(
    { version: "1.0.6" },
    {
      version: "1.0.5",
      packages: {
        "": {
          version: "1.0.4",
        },
      },
    },
  );

  assert.equal(result.ok, false);
  assert.match(
    result.errors[0],
    /package\.json version \(1\.0\.6\) does not match package-lock\.json version \(1\.0\.5\)/u,
  );
  assert.match(
    result.errors[1],
    /package\.json version \(1\.0\.6\) does not match package-lock\.json packages\[''\]\.version \(1\.0\.4\)/u,
  );
});

test("validateVersionSync reports missing version fields", () => {
  const result = validateVersionSync({}, { packages: {} });

  assert.equal(result.ok, false);
  assert.equal(result.version, null);
  assert.deepEqual(result.errors, [
    "package.json is missing a version field.",
    "package-lock.json is missing a top-level version field.",
    "package-lock.json is missing packages[''].version.",
  ]);
});

test("readJsonFile parses JSON documents from disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "version-sync-json-"));
  const jsonPath = join(dir, "fixture.json");
  await writeFile(jsonPath, JSON.stringify({ version: "1.2.3" }), "utf8");

  assert.deepEqual(readJsonFile(jsonPath), { version: "1.2.3" });
});

test("direct CLI execution validates the current working directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "version-sync-cli-"));
  await writeVersionFiles(dir, "3.0.0", "3.0.0", "3.0.0");

  const { stdout } = await execFileAsync(process.execPath, [scriptPath], {
    cwd: dir,
  });

  assert.match(stdout, /synchronized at 3\.0\.0/u);
});

test("main reports success and failure without throwing", async (t) => {
  const originalExitCode = process.exitCode;
  const originalLog = console.log;
  const originalError = console.error;
  const logs = [];
  const errors = [];
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));
  t.after(() => {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  });

  const goodDir = await mkdtemp(join(tmpdir(), "version-sync-good-"));
  await writeVersionFiles(goodDir, "2.0.0", "2.0.0", "2.0.0");
  process.exitCode = undefined;
  assert.deepEqual(main({ cwd: goodDir }), {
    ok: true,
    version: "2.0.0",
    errors: [],
  });
  assert.equal(process.exitCode, undefined);
  assert.match(logs.at(-1), /synchronized at 2\.0\.0/u);

  const badDir = await mkdtemp(join(tmpdir(), "version-sync-bad-"));
  await writeVersionFiles(badDir, "2.0.0", "2.0.1", "2.0.2");
  process.exitCode = undefined;
  const badResult = main({ cwd: badDir });
  assert.equal(badResult.ok, false);
  assert.equal(process.exitCode, 1);
  assert.equal(errors.length, 2);
});

async function writeVersionFiles(
  dir,
  packageVersion,
  lockfileVersion,
  rootPackageVersion,
) {
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ version: packageVersion }),
    "utf8",
  );
  await writeFile(
    join(dir, "package-lock.json"),
    JSON.stringify({
      version: lockfileVersion,
      packages: { "": { version: rootPackageVersion } },
    }),
    "utf8",
  );
}
