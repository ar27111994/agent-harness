import assert from "node:assert/strict";
import test from "node:test";

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

void test("package registry and official-index helpers cover normalization edges", async () => {
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
