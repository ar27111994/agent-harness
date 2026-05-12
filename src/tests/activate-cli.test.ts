import assert from "node:assert/strict";
import test from "node:test";

import { runActivate } from "../activate.js";

void test("activate validates every repeated intent value", async () => {
  await assert.rejects(
    () =>
      runActivate(
        ["host", "--intent", "backend", "--intent", "docss"],
        process.cwd(),
        process.cwd(),
      ),
    /Invalid --intent value 'docss'/u,
  );
});
