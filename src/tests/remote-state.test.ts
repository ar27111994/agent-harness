import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadRemoteHarvestState,
  writeRemoteHarvestState,
} from "../domains/discovery/remote-state.js";

void test("remote harvest state returns defaults for missing or invalid state", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-remote-state-"),
  );

  try {
    assert.deepEqual(await loadRemoteHarvestState(projectRoot), {
      schemaVersion: 1,
      generatedAt: new Date(0).toISOString(),
      nextRepoOffset: 0,
      completedSourceIds: [],
    });

    const statePath = join(
      projectRoot,
      "state",
      "discover",
      "remote-harvest.json",
    );
    await mkdir(join(projectRoot, "state", "discover"), { recursive: true });
    await writeFile(statePath, JSON.stringify({ schemaVersion: 2 }), "utf8");

    assert.deepEqual(await loadRemoteHarvestState(projectRoot), {
      schemaVersion: 1,
      generatedAt: new Date(0).toISOString(),
      nextRepoOffset: 0,
      completedSourceIds: [],
    });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

void test("remote harvest state round-trips persisted values", async () => {
  const projectRoot = await mkdtemp(
    join(tmpdir(), "agent-harness-remote-state-"),
  );

  try {
    const state = {
      schemaVersion: 1 as const,
      generatedAt: "2026-05-15T00:00:00.000Z",
      nextRepoOffset: 25,
      completedSourceIds: ["alpha", "beta"],
    };

    await writeRemoteHarvestState(projectRoot, state);

    assert.deepEqual(await loadRemoteHarvestState(projectRoot), state);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
