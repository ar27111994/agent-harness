import assert from "node:assert/strict";
import test from "node:test";

import {
  extractRepositoryUrlFromNpmMetadata,
  extractRepositoryUrlFromPypiMetadata,
  fetchNpmPackageMetadata,
  fetchNpmPackageSearch,
  fetchPypiPackageMetadata,
  normalizeNpmPackageMetadata,
  normalizeNpmPackageSearchResults,
  normalizePypiPackageMetadata,
  sanitizeRepositoryUrl,
} from "../package-registries.js";

void test("package registry fetch helpers normalize responses and tolerate failures", async (t) => {
  const previousFetch = globalThis.fetch;
  const previousMockFlag = process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
  const calls: string[] = [];
  process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = "1";
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousMockFlag === undefined) {
      delete process.env.AGENT_HARNESS_TEST_FETCH_MOCKS;
    } else {
      process.env.AGENT_HARNESS_TEST_FETCH_MOCKS = previousMockFlag;
    }
  });

  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/-/v1/search")) {
      return new Response(
        JSON.stringify({
          objects: [{ package: { name: "pkg", keywords: ["mcp"] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (String(url).includes("/pypi/")) {
      return new Response(JSON.stringify({ info: { name: "py-pkg" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ name: "npm-pkg" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const resolveHostname = async () => [
    { address: "93.184.216.34", family: 4 as const },
  ];

  assert.deepEqual(await fetchNpmPackageSearch("   ", { resolveHostname }), []);
  assert.equal(
    (await fetchNpmPackageSearch("agent", { resolveHostname }))[0]?.name,
    "pkg",
  );
  assert.equal(
    (await fetchNpmPackageMetadata("npm-pkg", { resolveHostname }))?.name,
    "npm-pkg",
  );
  assert.equal(
    (await fetchPypiPackageMetadata("py-pkg", { resolveHostname }))?.info.name,
    "py-pkg",
  );
  assert.ok(calls.some((url) => /registry\.npmjs\.org/u.test(url)));

  globalThis.fetch = async () => {
    throw new Error("network down");
  };

  assert.deepEqual(
    await fetchNpmPackageSearch("agent", { resolveHostname }),
    [],
  );
  assert.equal(
    await fetchNpmPackageMetadata("npm-pkg", { resolveHostname }),
    null,
  );
  assert.equal(
    await fetchPypiPackageMetadata("py-pkg", { resolveHostname }),
    null,
  );
});

void test("package registries normalize npm search and metadata payloads", () => {
  const searchResults = normalizeNpmPackageSearchResults({
    objects: [
      {
        package: {
          name: "agent-harness-skill",
          description: "Useful package",
          keywords: ["mcp", 123, " skill ", ""],
          date: "2026-05-15T00:00:00.000Z",
        },
      },
      {
        package: {
          name: "   ",
        },
      },
      { package: null },
    ],
  });

  assert.deepEqual(normalizeNpmPackageSearchResults(null), []);
  assert.deepEqual(normalizeNpmPackageSearchResults({ objects: "bad" }), []);
  assert.deepEqual(searchResults, [
    {
      name: "agent-harness-skill",
      description: "Useful package",
      keywords: ["mcp", "skill"],
      lastUpdated: "2026-05-15T00:00:00.000Z",
    },
  ]);

  const metadata = normalizeNpmPackageMetadata(
    {
      description: "package description",
      homepage: "https://example.test/home",
      repository: {
        type: "git",
        url: "git+ssh://git@github.com/example/agent-harness-skill.git#readme",
      },
      keywords: ["mcp", 123, "skills"],
      versions: { "1.0.0": {} },
      time: { modified: "2026-05-15T00:00:00.000Z", ignored: 42 },
    },
    "fallback-name",
  );

  assert.equal(metadata.name, "fallback-name");
  assert.equal(metadata.homepage, "https://example.test/home");
  assert.deepEqual(metadata.repository, {
    type: "git",
    url: "https://github.com/example/agent-harness-skill",
  });
  assert.deepEqual(metadata.keywords, ["mcp", "skills"]);
  assert.equal(metadata.lastUpdated, "2026-05-15T00:00:00.000Z");
  assert.equal(
    extractRepositoryUrlFromNpmMetadata(metadata),
    "https://github.com/example/agent-harness-skill",
  );
});

void test("package registries cover invalid and fallback metadata shapes", () => {
  assert.equal(normalizePypiPackageMetadata(null, "fallback"), null);
  assert.equal(normalizePypiPackageMetadata({ info: null }, "fallback"), null);

  const npmMetadata = normalizeNpmPackageMetadata(
    {
      name: "explicit-name",
      homepage: "mailto:invalid",
      repository: "github:example/string-repo",
      keywords: "not-array",
      versions: [],
      time: null,
    },
    "fallback-name",
  );

  assert.equal(npmMetadata.name, "explicit-name");
  assert.equal(npmMetadata.homepage, undefined);
  assert.equal(
    npmMetadata.repository,
    "https://github.com/example/string-repo",
  );
  assert.equal(npmMetadata.keywords, undefined);
  assert.equal(npmMetadata.versions, undefined);
  assert.equal(npmMetadata.lastUpdated, undefined);
  assert.equal(
    extractRepositoryUrlFromNpmMetadata({ name: "none", keywords: [] }),
    undefined,
  );
  assert.equal(
    extractRepositoryUrlFromNpmMetadata({
      name: "bad",
      keywords: [],
      repository: { url: "notaurl" },
    }),
    undefined,
  );

  const pypiMetadata = normalizePypiPackageMetadata(
    {
      info: {
        name: 12,
        summary: 12,
        home_page: "notaurl",
        project_urls: { Docs: "notaurl" },
        version: 12,
        keywords: ["not", "string"],
        package_url: "ftp://invalid.example/pkg",
      },
      releases: {
        invalid: "not-array",
        mixed: [null, { upload_time: "2026-05-01T00:00:00.000Z" }],
      },
    },
    "fallback-pypi",
  );

  assert.equal(pypiMetadata?.info.name, "fallback-pypi");
  assert.equal(pypiMetadata?.info.summary, undefined);
  assert.equal(pypiMetadata?.info.project_urls, undefined);
  assert.equal(pypiMetadata?.info.version, undefined);
  assert.equal(pypiMetadata?.info.keywords, undefined);
  assert.equal(pypiMetadata?.lastUpdated, "2026-05-01T00:00:00.000Z");
  assert.equal(extractRepositoryUrlFromPypiMetadata(pypiMetadata!), undefined);
});

void test("package registries normalize pypi metadata and prefer github repository urls", () => {
  const metadata = normalizePypiPackageMetadata(
    {
      info: {
        summary: "Python package",
        home_page: "https://docs.example.test/project",
        project_urls: {
          Homepage: "https://example.test/home",
          Repository: "https://github.com/example/python-skill/issues",
          Source: "https://github.com/example/python-skill.git?tab=readme",
          Bad: "notaurl",
        },
        version: "1.2.3",
        keywords: "agents,skills",
        package_url: "https://pypi.org/project/python-skill/",
      },
      releases: {
        "1.0.0": [
          { upload_time_iso_8601: "2026-05-10T00:00:00.000Z" },
          { upload_time: "2026-05-11T00:00:00.000Z" },
        ],
        "1.2.3": [{ upload_time_iso_8601: "2026-05-12T00:00:00.000Z" }],
      },
    },
    "python-skill",
  );

  assert.ok(metadata);
  assert.equal(metadata?.info.name, "python-skill");
  assert.deepEqual(metadata?.info.project_urls, {
    Homepage: "https://example.test/home",
    Repository: "https://github.com/example/python-skill/issues",
    Source: "https://github.com/example/python-skill.git?tab=readme",
  });
  assert.equal(metadata?.lastUpdated, "2026-05-12T00:00:00.000Z");
  assert.equal(
    extractRepositoryUrlFromPypiMetadata(metadata!),
    "https://github.com/example/python-skill",
  );
});

void test("package registries sanitize repository urls from common git notations", () => {
  const cases = [
    {
      input: "github:example/repo#readme",
      expected: "https://github.com/example/repo",
    },
    {
      input: "git@github.com:example/repo.git#main",
      expected: "https://github.com/example/repo",
    },
    {
      input: "git+ssh://git@github.com/example/repo.git?raw=1",
      expected: "https://github.com/example/repo",
    },
    {
      input: "git+https://github.com/example/repo.git#readme",
      expected: "https://github.com/example/repo",
    },
    {
      input: "https://example.test/not-github.git#main",
      expected: "https://example.test/not-github",
    },
    {
      input: "not a url.git#main",
      expected: "not a url",
    },
    {
      input: "https://github.com/",
      expected: "https://github.com/",
    },
    {
      input: "github:/missing-owner",
      expected: "github:/missing-owner",
    },
  ] as const;

  for (const { input, expected } of cases) {
    assert.equal(sanitizeRepositoryUrl(input), expected);
  }
});
