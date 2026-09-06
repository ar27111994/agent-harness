import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  listGitTags,
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

test("validateVersionSync accepts a matching git tag on main", () => {
  const result = validateVersionSync(
    { version: "2.1.0" },
    {
      version: "2.1.0",
      packages: { "": { version: "2.1.0" } },
    },
    ["v2.0.0", "v2.1.0"],
  );

  assert.equal(result.ok, true);
  assert.equal(result.version, "2.1.0");
  assert.deepEqual(result.errors, []);
});

test("validateVersionSync accepts a forward-bumped manifest with no matching tag yet", () => {
  // Manifest 2.1.0 > latest released tag v2.0.1: a normal pre-release state
  // awaiting its post-merge tag. Must pass (forward bump, reverse of #467).
  const result = validateVersionSync(
    { version: "2.1.0" },
    {
      version: "2.1.0",
      packages: { "": { version: "2.1.0" } },
    },
    ["v2.0.0", "v2.0.1"],
  );

  assert.equal(result.ok, true);
  assert.equal(result.version, "2.1.0");
  assert.deepEqual(result.errors, []);
});

test("validateVersionSync rejects a manifest that regresses against a newer tag without a matching tag", () => {
  // Manifest 2.0.1 <= latest tag v2.1.0 with no v2.0.1 tag: a regression /
  // retag that a pre-merge gate must reject.
  const result = validateVersionSync(
    { version: "2.0.1" },
    {
      version: "2.0.1",
      packages: { "": { version: "2.0.1" } },
    },
    ["v2.0.0", "v2.1.0"],
  );

  assert.equal(result.ok, false);
  assert.match(
    result.errors[0],
    /package\.json version \(2\.0\.1\) does not exceed the latest released tag \(v2\.1\.0\) and has no matching git tag on main/u,
  );
});

test("validateVersionSync treats a tag list with no parseable versions as a forward bump", () => {
  // Tags exist but none are version-shaped ([major].[minor].[patch]): there is
  // no released version to regress below, so a pre-release manifest must pass.
  const result = validateVersionSync(
    { version: "2.1.0" },
    {
      version: "2.1.0",
      packages: { "": { version: "2.1.0" } },
    },
    ["experiments/canary", "latest-canary"],
  );

  assert.equal(result.ok, true);
  assert.equal(result.version, "2.1.0");
  assert.deepEqual(result.errors, []);
});

test("validateVersionSync ignores non-version tags when computing the latest released tag", () => {
  // A mix of version and non-version tags: only version-shaped tags count
  // toward "latest released", so this is a forward bump over v2.0.0.
  const result = validateVersionSync(
    { version: "2.1.0" },
    {
      version: "2.1.0",
      packages: { "": { version: "2.1.0" } },
    },
    ["v2.0.0", "experiments/canary", "refs/heads/topic"],
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("validateVersionSync treats duplicate released tags as a single latest version", () => {
  // Two tags sharing the same version triple must not error: the latest
  // released tag is v2.1.0 (present), even with a duplicate v2.1.0.
  const result = validateVersionSync(
    { version: "2.1.0" },
    {
      version: "2.1.0",
      packages: { "": { version: "2.1.0" } },
    },
    ["v2.1.0", "v2.1.0"],
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("validateVersionSync requires v<version> and rejects a bare unprefixed tag", () => {
  // release.yml only fires on refs/tags/v* — a bare "2.1.0" tag would not
  // trigger a release. With the latest released version being 2.1.0 and no
  // v2.1.0 tag present, the manifest is not ahead and has no matching release
  // tag → must fail (CodeRabbit fD17H: require the v-prefixed release tag).
  const result = validateVersionSync(
    { version: "2.1.0" },
    {
      version: "2.1.0",
      packages: { "": { version: "2.1.0" } },
    },
    ["2.1.0"],
  );

  assert.equal(result.ok, false);
  assert.match(
    result.errors[0],
    /package\.json version \(2\.1\.0\) does not exceed the latest released tag \(v2\.1\.0\)/u,
  );
});

test("validateVersionSync lets a stable release follow its own prerelease tag", () => {
  // v2.1.0-rc.1 is a prerelease: it must not count as the "latest released"
  // stable version, so a forward-bumped manifest at 2.1.0 (awaiting its stable
  // release tag) passes (CodeRabbit fQ6iR: preserve prerelease precedence).
  const result = validateVersionSync(
    { version: "2.1.0" },
    {
      version: "2.1.0",
      packages: { "": { version: "2.1.0" } },
    },
    ["v2.0.0", "v2.1.0-rc.1"],
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("validateVersionSync skips the tag check when tags are undefined", () => {
  const result = validateVersionSync(
    { version: "2.1.0" },
    {
      version: "2.1.0",
      packages: { "": { version: "2.1.0" } },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("validateVersionSync skips the tag check when the tag list is empty", () => {
  const result = validateVersionSync(
    { version: "2.1.0" },
    {
      version: "2.1.0",
      packages: { "": { version: "2.1.0" } },
    },
    [],
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("validateVersionSync does not emit a tag error when package.json lacks a version", () => {
  const result = validateVersionSync({}, { version: "2.1.0" }, ["v2.1.0"]);

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    "package.json is missing a version field.",
    "package-lock.json is missing packages[''].version.",
  ]);
});

test("listGitTags returns tag names in a git repository", async () => {
  const dir = await mkdtemp(join(tmpdir(), "version-sync-tags-"));
  await runGit(dir, ["init", "--quiet"]);
  await runGit(dir, ["config", "user.email", "test@example.com"]);
  await runGit(dir, ["config", "user.name", "Test Runner"]);
  await writeFile(join(dir, "gitignore"), "node_modules\n", "utf8");
  await runGit(dir, ["add", "."]);
  await runGit(dir, ["commit", "--quiet", "-m", "initial", "--no-verify"]);
  await runGit(dir, ["tag", "v2.1.0"]);
  await runGit(dir, ["tag", "v2.0.0"]);

  const tags = listGitTags(dir);
  assert.deepEqual(tags.sort(), ["v2.0.0", "v2.1.0"]);
});

test("listGitTags returns null outside a git repository", async () => {
  const dir = await mkdtemp(join(tmpdir(), "version-sync-no-git-"));
  assert.equal(listGitTags(dir), null);
});

test("listGitTags returns null when git is unavailable", () => {
  assert.equal(listGitTags("Z:/definitely-not-a-directory/path"), null);
});

test("main accepts a forward-bumped manifest awaiting its post-merge tag", async (t) => {
  const originalExitCode = process.exitCode;
  const originalLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(" "));
  t.after(() => {
    console.log = originalLog;
    process.exitCode = originalExitCode;
  });

  const dir = await mkdtemp(join(tmpdir(), "version-sync-tag-fwd-"));
  await writeVersionFiles(dir, "2.1.0", "2.1.0", "2.1.0");
  process.exitCode = undefined;
  const result = main({ cwd: dir, tags: ["v2.0.0"] });

  assert.equal(result.ok, true);
  assert.equal(process.exitCode, undefined);
  assert.match(logs.at(-1), /synchronized at 2\.1\.0/u);
});

test("main fails when the manifest regresses against a newer released tag", async (t) => {
  const originalExitCode = process.exitCode;
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(" "));
  t.after(() => {
    console.error = originalError;
    process.exitCode = originalExitCode;
  });

  const dir = await mkdtemp(join(tmpdir(), "version-sync-tag-fail-"));
  await writeVersionFiles(dir, "2.0.1", "2.0.1", "2.0.1");
  process.exitCode = undefined;
  const result = main({ cwd: dir, tags: ["v2.0.0", "v2.1.0"] });

  assert.equal(result.ok, false);
  assert.equal(process.exitCode, 1);
  assert.equal(errors.length, 1);
  assert.match(
    errors[0],
    /package\.json version \(2\.0\.1\) does not exceed the latest released tag \(v2\.1\.0\)/u,
  );
});

async function runGit(cwd, args) {
  await execFileAsync("git", args, { cwd });
}

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
