import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReleasePayload,
  getOptionValue,
} from "../sync-github-release.mjs";

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
