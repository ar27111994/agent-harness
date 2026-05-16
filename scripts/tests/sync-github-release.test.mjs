import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  buildReleasePayload,
  generateReleaseNotes,
  getOptionValue,
  getRequiredEnvironmentValue,
  githubRequest,
  resolveReleaseContext,
  syncGitHubRelease,
} from "../sync-github-release.mjs";

const execFileAsync = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(testDir, "..", "sync-github-release.mjs");

const STABLE_CONTEXT = {
  tag: "v1.0.6",
  targetCommitish: "abc123",
  version: "1.0.6",
};

const PRERELEASE_CONTEXT = {
  tag: "v1.0.6-rc.1",
  targetCommitish: "abc123",
  version: "1.0.6-rc.1",
};

test("buildReleasePayload marks stable created releases as latest", () => {
  const payload = buildReleasePayload(STABLE_CONTEXT, "notes");

  assert.equal(payload.make_latest, "true");
  assert.equal(payload.prerelease, false);
});

test("buildReleasePayload omits make_latest for update payloads", () => {
  const payload = buildReleasePayload(STABLE_CONTEXT, "notes", {
    includeMakeLatest: false,
  });

  assert.equal("make_latest" in payload, false);
  assert.equal(payload.prerelease, false);
});

test("buildReleasePayload marks prerelease created releases as not latest", () => {
  const payload = buildReleasePayload(PRERELEASE_CONTEXT, "notes");

  assert.equal(payload.make_latest, "false");
  assert.equal(payload.prerelease, true);
});

test("buildReleasePayload omits make_latest for prerelease update payloads", () => {
  const payload = buildReleasePayload(PRERELEASE_CONTEXT, "notes", {
    includeMakeLatest: false,
  });

  assert.equal("make_latest" in payload, false);
  assert.equal(payload.prerelease, true);
});

test("getOptionValue returns the following token when a flag has a value", () => {
  assert.equal(
    getOptionValue("--repo", ["node", "script", "--repo", "owner/repo"]),
    "owner/repo",
  );
});

test("getOptionValue rejects missing and flag-like values", () => {
  assert.throws(
    () => getOptionValue("--repo", ["node", "script", "--repo"]),
    /Flag --repo requires a value\./u,
  );
  assert.throws(
    () =>
      getOptionValue("--repo", ["node", "script", "--repo", "--tag", "v1.0.6"]),
    /Flag --repo requires a value\./u,
  );
});

test("release context resolves flags and validates package version", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "sync-github-release-context-"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "agent-harness", version: "1.0.6" }),
    "utf8",
  );

  const previousArgv = process.argv;
  const previousCwd = process.cwd;
  const previousEnv = {
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
    GITHUB_REF_NAME: process.env.GITHUB_REF_NAME,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GH_TOKEN: process.env.GH_TOKEN,
    GITHUB_SHA: process.env.GITHUB_SHA,
  };

  process.argv = [
    "node",
    "script",
    "--repo",
    "owner/repo",
    "--tag",
    "v1.0.6",
    "--target",
    "deadbeef",
  ];
  process.cwd = () => cwd;
  process.env.GITHUB_TOKEN = "token";

  try {
    assert.equal(getRequiredEnvironmentValue("GITHUB_TOKEN"), "token");
    let context = resolveReleaseContext();
    assert.deepEqual(context, {
      repo: "owner/repo",
      tag: "v1.0.6",
      token: "token",
      targetCommitish: "deadbeef",
      version: "1.0.6",
      packageName: "agent-harness",
    });

    delete process.env.GITHUB_TOKEN;
    process.env.GH_TOKEN = "fallback-token";
    process.argv = [
      "node",
      "script",
      "--repo",
      "owner/repo",
      "--tag",
      "v1.0.6",
    ];
    context = resolveReleaseContext();
    assert.equal(context.token, "fallback-token");
    assert.equal(context.targetCommitish, undefined);

    process.argv = ["node", "script", "--tag", "v9.9.9"];
    process.env.GITHUB_REPOSITORY = "owner/repo";
    assert.throws(
      () => resolveReleaseContext(),
      /does not match package\.json version 1\.0\.6/u,
    );

    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    process.argv = [
      "node",
      "script",
      "--repo",
      "owner/repo",
      "--tag",
      "v1.0.6",
    ];
    assert.throws(
      () => resolveReleaseContext(),
      /Missing required environment variable GITHUB_TOKEN/u,
    );
    assert.throws(
      () => getRequiredEnvironmentValue("GITHUB_TOKEN"),
      /Missing required environment variable GITHUB_TOKEN/u,
    );
  } finally {
    process.argv = previousArgv;
    process.cwd = previousCwd;
    restoreEnv(previousEnv);
  }
});

test("githubRequest handles 404, 204, errors, and timeout failures", async () => {
  const originalFetch = globalThis.fetch;
  const originalAbortTimeout = AbortSignal.timeout;
  const requests = [];
  let callCount = 0;
  const networkError = new Error("network down");

  AbortSignal.timeout = (ms) => ({ timeoutMs: ms });
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    callCount += 1;

    if (callCount === 1) {
      return new Response("missing", { status: 404 });
    }
    if (callCount === 2) {
      return new Response(null, { status: 204 });
    }
    if (callCount === 3) {
      return new Response("boom", { status: 500, statusText: "Bad" });
    }
    if (callCount === 4) {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    }
    if (callCount === 5) {
      throw networkError;
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    assert.equal(
      await githubRequest({
        token: "token",
        method: "GET",
        endpoint: "/repos/owner/repo/releases/tags/v1.0.6",
        tolerate404: true,
      }),
      null,
    );
    assert.equal(
      await githubRequest({
        token: "token",
        method: "PATCH",
        endpoint: "/repos/owner/repo/releases/1",
      }),
      null,
    );
    await assert.rejects(
      () =>
        githubRequest({
          token: "token",
          method: "GET",
          endpoint: "/repos/owner/repo/releases",
        }),
      /failed \(500\): boom/u,
    );
    await assert.rejects(
      () =>
        githubRequest({
          token: "token",
          method: "GET",
          endpoint: "/repos/owner/repo/releases",
          timeoutMs: 25,
        }),
      /timed out after 25ms/u,
    );
    await assert.rejects(
      () =>
        githubRequest({
          token: "token",
          method: "GET",
          endpoint: "/repos/owner/repo/releases",
        }),
      (error) => {
        assert.equal(error, networkError);
        return true;
      },
    );

    const ok = await githubRequest({
      token: "token",
      method: "POST",
      endpoint: "/repos/owner/repo/releases",
      body: { hello: "world" },
    });
    assert.deepEqual(ok, { ok: true });
    assert.equal(
      requests.at(-1)?.options?.body,
      JSON.stringify({ hello: "world" }),
    );
    assert.equal(
      requests.at(-1)?.options?.headers?.Authorization,
      "Bearer token",
    );
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalAbortTimeout;
  }
});

test("generateReleaseNotes combines changelog notes with generated notes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "sync-github-release-notes-"));
  await writeFile(
    join(cwd, "CHANGELOG.md"),
    [
      "# Changelog",
      "",
      "## [1.0.6] - 2026-05-15",
      "",
      "### Added",
      "",
      "- manual summary",
      "",
    ].join("\n"),
    "utf8",
  );

  const originalFetch = globalThis.fetch;
  const previousCwd = process.cwd;
  process.cwd = () => cwd;
  let includeGeneratedBody = true;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify(
        includeGeneratedBody
          ? { body: "## What's Changed\n\n- generated" }
          : {},
      ),
      { status: 200 },
    );

  try {
    const notes = await generateReleaseNotes({
      ...STABLE_CONTEXT,
      repo: "owner/repo",
      token: "token",
    });
    assert.match(notes, /manual summary/u);
    assert.match(notes, /Auto-generated release notes/u);
    assert.match(notes, /generated/u);

    includeGeneratedBody = false;
    const manualOnlyNotes = await generateReleaseNotes({
      ...STABLE_CONTEXT,
      repo: "owner/repo",
      token: "token",
    });
    assert.match(manualOnlyNotes, /manual summary/u);
    assert.doesNotMatch(manualOnlyNotes, /Auto-generated release notes/u);
  } finally {
    globalThis.fetch = originalFetch;
    process.cwd = previousCwd;
  }
});

test("direct CLI execution reports configuration failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sync-release-cli-failure-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.6" }),
    "utf8",
  );

  await assert.rejects(
    execFileAsync(process.execPath, [scriptPath], {
      cwd: dir,
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "",
        GITHUB_REF_NAME: "",
        GITHUB_TOKEN: "",
        GH_TOKEN: "",
      },
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(
        error.stderr,
        /Missing required environment variable GITHUB_REPOSITORY/u,
      );
      return true;
    },
  );

  await assert.rejects(
    execFileAsync(process.execPath, [scriptPath], {
      cwd: dir,
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_REF_NAME: "v1.0.6",
        GITHUB_TOKEN: "token",
        AGENT_HARNESS_SYNC_RELEASE_THROW_STRING: "1",
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS,
          `--import=${pathToFileURL(join(testDir, "fixtures", "sync-github-release-non-error-loader.mjs")).href}`,
        ]
          .filter(Boolean)
          .join(" "),
      },
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /string failure/u);
      return true;
    },
  );
});

test("syncGitHubRelease updates existing releases and creates missing ones", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "sync-github-release-run-"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "agent-harness", version: "1.0.6" }),
    "utf8",
  );
  await writeFile(
    join(cwd, "CHANGELOG.md"),
    ["# Changelog", "", "## [1.0.6] - 2026-05-15", "", "- release notes"].join(
      "\n",
    ),
    "utf8",
  );

  const originalFetch = globalThis.fetch;
  const previousArgv = process.argv;
  const previousCwd = process.cwd;
  const originalLog = console.log;
  const logs = [];
  const fetchCalls = [];

  process.argv = ["node", "script"];
  process.cwd = () => cwd;
  process.env.GITHUB_REPOSITORY = "owner/repo";
  process.env.GITHUB_REF_NAME = "v1.0.6";
  process.env.GITHUB_SHA = "abc123";
  process.env.GITHUB_TOKEN = "token";
  console.log = (...args) => logs.push(args.join(" "));

  let phase = "update";
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({
      url: String(url),
      method: options.method,
      body: options.body,
    });
    if (String(url).endsWith("/generate-notes")) {
      return new Response(JSON.stringify({ body: "generated" }), {
        status: 200,
      });
    }
    if (String(url).includes("/releases/tags/")) {
      return phase === "update"
        ? new Response(JSON.stringify({ id: 17 }), { status: 200 })
        : new Response("missing", { status: 404 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    await syncGitHubRelease();
    phase = "create";
    await syncGitHubRelease();

    assert.ok(
      fetchCalls.some(
        (call) => /\/releases\/17$/u.test(call.url) && call.method === "PATCH",
      ),
    );
    assert.ok(
      fetchCalls.some(
        (call) => /\/releases$/u.test(call.url) && call.method === "POST",
      ),
    );
    assert.ok(
      logs.some((line) => /Updated GitHub release v1\.0\.6/u.test(line)),
    );
    assert.ok(
      logs.some((line) => /Created GitHub release v1\.0\.6/u.test(line)),
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.argv = previousArgv;
    process.cwd = previousCwd;
    console.log = originalLog;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_REF_NAME;
    delete process.env.GITHUB_SHA;
    delete process.env.GITHUB_TOKEN;
  }
});

test("restoreEnv restores and deletes environment variables", () => {
  process.env.AGENT_HARNESS_SYNC_TEST_KEEP = "old";
  process.env.AGENT_HARNESS_SYNC_TEST_DELETE = "stale";

  restoreEnv({
    AGENT_HARNESS_SYNC_TEST_KEEP: "new",
    AGENT_HARNESS_SYNC_TEST_DELETE: undefined,
  });

  assert.equal(process.env.AGENT_HARNESS_SYNC_TEST_KEEP, "new");
  assert.equal(process.env.AGENT_HARNESS_SYNC_TEST_DELETE, undefined);
  delete process.env.AGENT_HARNESS_SYNC_TEST_KEEP;
});

function restoreEnv(previousEnv) {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
