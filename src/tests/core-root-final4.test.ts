import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { envFileInternals } from "../config/env-file.js";
import { loadRuntimeConfig } from "../config/runtime.js";
import {
  createDirectoryLink,
  ensureDirectory,
  filesInternals,
  readTextFileOrNull,
  writeTextFile,
} from "../files.js";
import { officialIndexInternals } from "../official-index.js";
import {
  extractRepositoryUrlFromNpmMetadata,
  fetchNpmPackageMetadata,
  fetchNpmPackageSearch,
  fetchPypiPackageMetadata,
  normalizeNpmPackageMetadata,
  normalizePypiPackageMetadata,
  packageRegistryInternals,
} from "../package-registries.js";

void test("core root helpers cover fallback and parser edge branches", () => {
  const config = loadRuntimeConfig({
    AGENT_HARNESS_HOME: "   ",
    HOME: "   ",
    USERPROFILE: "   ",
  });
  assert.equal(config.paths.homeDirectory, homedir());

  assert.deepEqual(
    envFileInternals.collectDotEnvLogicalLines('NOEQUALS"quoted"\nKEY=value'),
    ['NOEQUALS"quoted"', "KEY=value"],
  );
  assert.equal(envFileInternals.parseDotEnvLine("NO_SEPARATOR"), null);
  assert.equal(envFileInternals.parseDotEnvLine("=missing-key"), null);
  assert.equal(
    envFileInternals.parseQuotedDotEnvValue('"unterminated', '"'),
    "unterminated",
  );
  assert.equal(envFileInternals.decodeDoubleQuotedEscape("r"), "\r");
  assert.equal(envFileInternals.decodeDoubleQuotedEscape("\\"), "\\");
  assert.equal(envFileInternals.decodeDoubleQuotedEscape(undefined), "");
});

void test("package and official-index helpers cover remaining normalization edges", async () => {
  const originalUrl = globalThis.URL;
  const badName = {
    toString(): string {
      throw new Error("boom");
    },
  } as unknown as string;

  globalThis.URL = class BrokenUrl {
    constructor() {
      throw new Error("broken");
    }
  } as unknown as typeof URL;

  try {
    assert.deepEqual(await fetchNpmPackageSearch("agent"), []);
  } finally {
    globalThis.URL = originalUrl;
  }

  assert.equal(await fetchNpmPackageMetadata(badName), null);
  assert.equal(await fetchPypiPackageMetadata(badName), null);

  assert.equal(
    officialIndexInternals.normalizeGitHubRepositoryUrl(
      "https://gitlab.com/example/project",
    ),
    null,
  );
  assert.equal(
    officialIndexInternals.normalizeGitHubRepositoryUrl("not-a-url"),
    null,
  );

  const objectRepository = normalizeNpmPackageMetadata(
    {
      repository: { type: 42, url: "github:example/object-repo" },
      time: { modified: 5 },
    },
    "fallback-name",
  );
  assert.deepEqual(objectRepository.repository, {
    type: undefined,
    url: "https://github.com/example/object-repo",
  });
  assert.equal(objectRepository.lastUpdated, undefined);

  const invalidRepository = normalizeNpmPackageMetadata(
    {
      repository: { url: 42 },
    },
    "fallback-name",
  );
  assert.equal(invalidRepository.repository, undefined);

  const missingRepositoryUrl = extractRepositoryUrlFromNpmMetadata({
    name: "fixture",
    repository: { type: "git" },
  });
  assert.equal(missingRepositoryUrl, undefined);

  const pypiMetadata = normalizePypiPackageMetadata(
    {
      info: {
        name: "fixture",
        project_urls: { Docs: 42 },
      },
      releases: { "1.0.0": [{}] },
    },
    "fallback-pypi",
  );
  assert.equal(pypiMetadata?.info.project_urls, undefined);
  assert.equal(pypiMetadata?.lastUpdated, undefined);

  assert.deepEqual(packageRegistryInternals.normalizeStringArray("nope"), []);
  assert.equal(
    packageRegistryInternals.normalizeStringRecord({ count: 1 }),
    undefined,
  );
  assert.equal(
    packageRegistryInternals.isGitHubRepositoryUrl("not-a-url"),
    false,
  );
  assert.equal(
    packageRegistryInternals.buildGitHubRepositoryUrl("", "repo.git"),
    "https://github.com//repo",
  );
  assert.equal(
    packageRegistryInternals.stripUrlSuffix(
      "https://example.com/repo.git#readme",
    ),
    "https://example.com/repo.git",
  );
});

void test("file internals cover usable path, ignore handling, and scan edge branches", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-files-final4-"));

  try {
    const targetDirectory = join(root, "target");
    const linkDirectory = join(root, "linked");
    const plainFile = join(root, "plain.txt");
    const scanRoot = join(root, "scan");

    await ensureDirectory(targetDirectory);
    await createDirectoryLink(linkDirectory, targetDirectory);
    await writeTextFile(plainFile, "plain");
    await writeTextFile(join(scanRoot, "match1.txt"), "one");

    assert.equal(
      await filesInternals.isUsableDirectoryPath(targetDirectory),
      true,
    );
    assert.equal(
      await filesInternals.isUsableDirectoryPath(linkDirectory),
      true,
    );
    assert.equal(await filesInternals.isUsableDirectoryPath(plainFile), false);
    assert.equal(
      await filesInternals.isUsableDirectoryPath(join(root, "missing")),
      false,
    );
    assert.equal(
      await filesInternals.shouldIgnoreEnsureDirectoryError(linkDirectory, {
        code: "EEXIST",
      }),
      true,
    );
    assert.equal(
      await filesInternals.shouldIgnoreEnsureDirectoryError(plainFile, {
        code: "EEXIST",
      }),
      false,
    );
    assert.equal(filesInternals.getErrorMessage(404), "404");
    assert.equal(
      filesInternals.globPatternToRegExp("match?.txt").test("match1.txt"),
      true,
    );

    const truncatedTelemetry = {
      truncated: true,
      truncationReason: undefined,
      visitedFiles: 0,
      visitedBytes: 0,
    };
    assert.deepEqual(
      await filesInternals.collectFilesFromDirectory(
        root,
        scanRoot,
        new Set<string>(),
        [],
        { maxDepth: 4, maxFiles: 10, maxBytes: 1000 },
        truncatedTelemetry,
        0,
      ),
      [],
    );

    const depthTelemetry = {
      truncated: false,
      truncationReason: undefined,
      visitedFiles: 0,
      visitedBytes: 0,
    };
    assert.deepEqual(
      await filesInternals.collectFilesFromDirectory(
        root,
        scanRoot,
        new Set<string>(),
        [],
        { maxDepth: 0, maxFiles: 10, maxBytes: 1000 },
        depthTelemetry,
        1,
      ),
      [],
    );
    assert.equal(depthTelemetry.truncated, true);
    assert.equal(depthTelemetry.truncationReason, "max-depth");

    const entryGuardTelemetry = createTelemetryThatTruncatesAfterReads(1);
    assert.deepEqual(
      await filesInternals.collectFilesFromDirectory(
        root,
        scanRoot,
        new Set<string>(),
        [],
        { maxDepth: 4, maxFiles: 10, maxBytes: 1000 },
        entryGuardTelemetry,
        0,
      ),
      [],
    );

    const callbackGuardRoot = join(root, "callback-guard");
    await writeTextFile(join(callbackGuardRoot, "pending.txt"), "pending");
    const callbackGuardTelemetry = createTelemetryThatTruncatesAfterReads(2);
    assert.deepEqual(
      await filesInternals.collectFilesFromDirectory(
        root,
        callbackGuardRoot,
        new Set<string>(),
        [],
        { maxDepth: 4, maxFiles: 10, maxBytes: 1000 },
        callbackGuardTelemetry,
        0,
      ),
      [],
    );
    assert.equal(callbackGuardTelemetry.visitedFiles, 0);

    await writeFile(join(scanRoot, "dangling.txt"), "temp", "utf8");
    const removeSoon = readTextFileOrNull(join(scanRoot, "dangling.txt")).then(
      async () => rm(join(scanRoot, "dangling.txt"), { force: true }),
    );
    const files = await filesInternals.collectFilesFromDirectory(
      root,
      scanRoot,
      new Set<string>(),
      [],
      { maxDepth: 4, maxFiles: 10, maxBytes: 1000 },
      {
        truncated: false,
        truncationReason: undefined,
        visitedFiles: 0,
        visitedBytes: 0,
      },
      0,
    );
    await removeSoon;
    assert.ok(files.some((filePath) => filePath.endsWith("match1.txt")));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function createTelemetryThatTruncatesAfterReads(readLimit: number): {
  truncated: boolean;
  truncationReason: string | undefined;
  visitedFiles: number;
  visitedBytes: number;
} {
  let truncated = false;
  let reads = 0;

  return {
    get truncated() {
      reads += 1;
      return truncated || reads > readLimit;
    },
    set truncated(value: boolean) {
      truncated = value;
    },
    truncationReason: undefined,
    visitedFiles: 0,
    visitedBytes: 0,
  };
}
