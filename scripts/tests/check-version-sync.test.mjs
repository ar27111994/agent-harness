import test from "node:test";
import assert from "node:assert/strict";

import { validateVersionSync } from "../check-version-sync.mjs";

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
