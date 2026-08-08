import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  prepareStateRoot,
  resolveStateRoot,
  runWithStateRootSeedLock,
  STATE_ROOT_SEED_LOCK_FILE,
  stateRootInternals,
} from "../lib/state-root.js";

const REQUIRED_ASSET_FILES = [
  join("discover", "sources.json"),
  join("discover", "selections.json"),
  join("discover", "official-skills-indexes.json"),
  join("discover", "official-upstreams.json"),
  join("discover", "pipeline.json"),
  join("mirror", "policy.json"),
];

const REQUIRED_ASSET_DIRECTORIES = [
  join("discover", "source-packs"),
  join("discover", "schema"),
  join("discover", "recommendation-policy", "hosts"),
  join("discover", "seeds"),
  join("mirror", "schema"),
];

void test("state root defaults to package root for repository-local execution", () => {
  const prepared = resolveStateRoot({
    packageRoot: "/repo/agent-harness",
    workingDirectory: "/repo/agent-harness",
  });

  assert.equal(prepared.usesPackageRoot, true);
  assert.equal(prepared.stateRoot.endsWith("agent-harness"), true);
});

void test("state root defaults to workspace-local .agent-harness outside package root", () => {
  const prepared = resolveStateRoot({
    packageRoot: "/opt/agent-harness",
    workingDirectory: "/workspace/project",
  });

  assert.equal(prepared.usesPackageRoot, false);
  assert.equal(
    prepared.stateRoot.endsWith(join("project", ".agent-harness")),
    true,
  );
});

void test("prepareStateRoot syncs package assets into mutable state root", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-state-root-"));
  const packageRoot = join(root, "package");
  const stateRoot = join(root, "state");

  try {
    for (const filePath of REQUIRED_ASSET_FILES) {
      await writeAssetFile(packageRoot, filePath, { filePath });
    }
    for (const directoryPath of REQUIRED_ASSET_DIRECTORIES) {
      await writeAssetFile(packageRoot, join(directoryPath, "fixture.json"), {
        directoryPath,
      });
    }

    await prepareStateRoot({ packageRoot, stateRoot, usesPackageRoot: false });

    for (const filePath of REQUIRED_ASSET_FILES) {
      assert.deepEqual(
        JSON.parse(await readFile(join(stateRoot, filePath), "utf8")),
        {
          filePath,
        },
      );
    }
    for (const directoryPath of REQUIRED_ASSET_DIRECTORIES) {
      assert.deepEqual(
        JSON.parse(
          await readFile(
            join(stateRoot, directoryPath, "fixture.json"),
            "utf8",
          ),
        ),
        { directoryPath },
      );
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("prepareStateRoot preserves user-owned recommendation policy overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-state-root-"));
  const packageRoot = join(root, "package");
  const stateRoot = join(root, "state");
  const userOverridePath = join(
    stateRoot,
    "discover",
    "recommendation-policy",
    "overrides",
    "hosts",
    "copilot-vscode.json",
  );

  try {
    for (const filePath of REQUIRED_ASSET_FILES) {
      await writeAssetFile(packageRoot, filePath, { filePath });
    }
    for (const directoryPath of REQUIRED_ASSET_DIRECTORIES) {
      await writeAssetFile(packageRoot, join(directoryPath, "fixture.json"), {
        directoryPath,
      });
    }

    await prepareStateRoot({ packageRoot, stateRoot, usesPackageRoot: false });
    await writeAssetFile(
      stateRoot,
      join(
        "discover",
        "recommendation-policy",
        "overrides",
        "hosts",
        "copilot-vscode.json",
      ),
      {
        kind: "user-override",
      },
    );

    await writeAssetFile(
      packageRoot,
      join("discover", "recommendation-policy", "hosts", "fixture.json"),
      { refreshed: true },
    );
    await prepareStateRoot({ packageRoot, stateRoot, usesPackageRoot: false });

    assert.deepEqual(JSON.parse(await readFile(userOverridePath, "utf8")), {
      kind: "user-override",
    });
    assert.deepEqual(
      JSON.parse(
        await readFile(
          join(
            stateRoot,
            "discover",
            "recommendation-policy",
            "hosts",
            "fixture.json",
          ),
          "utf8",
        ),
      ),
      {
        directoryPath: join("discover", "recommendation-policy", "hosts"),
      },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("prepareStateRoot seeds recommendation policy defaults only once", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-state-root-"));
  const packageRoot = join(root, "package");
  const stateRoot = join(root, "state");
  const stateBasePolicyPath = join(
    stateRoot,
    "discover",
    "recommendation-policy",
    "base.json",
  );
  const stateHostPolicyPath = join(
    stateRoot,
    "discover",
    "recommendation-policy",
    "hosts",
    "fixture.json",
  );

  try {
    for (const filePath of REQUIRED_ASSET_FILES) {
      await writeAssetFile(packageRoot, filePath, { filePath });
    }
    for (const directoryPath of REQUIRED_ASSET_DIRECTORIES) {
      await writeAssetFile(packageRoot, join(directoryPath, "fixture.json"), {
        directoryPath,
      });
    }
    await writeAssetFile(
      packageRoot,
      join("discover", "recommendation-policy", "base.json"),
      { source: "package-initial" },
    );
    await writeAssetFile(
      packageRoot,
      join("discover", "recommendation-policy", "hosts", "fixture.json"),
      { source: "package-initial" },
    );

    await prepareStateRoot({ packageRoot, stateRoot, usesPackageRoot: false });

    await writeAssetFile(
      stateRoot,
      join("discover", "recommendation-policy", "base.json"),
      {
        source: "state-user-edited",
      },
    );
    await writeAssetFile(
      stateRoot,
      join("discover", "recommendation-policy", "hosts", "fixture.json"),
      { source: "state-user-edited" },
    );

    await writeAssetFile(
      packageRoot,
      join("discover", "recommendation-policy", "base.json"),
      { source: "package-updated" },
    );
    await writeAssetFile(
      packageRoot,
      join("discover", "recommendation-policy", "hosts", "fixture.json"),
      { source: "package-updated" },
    );
    await prepareStateRoot({ packageRoot, stateRoot, usesPackageRoot: false });

    assert.deepEqual(JSON.parse(await readFile(stateBasePolicyPath, "utf8")), {
      source: "state-user-edited",
    });
    assert.deepEqual(JSON.parse(await readFile(stateHostPolicyPath, "utf8")), {
      source: "state-user-edited",
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

async function writeAssetFile(
  packageRoot: string,
  relativePath: string,
  value: unknown,
): Promise<void> {
  const filePath = join(packageRoot, relativePath);
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// State-root seed lock (#428 cross-process hardening) — every branch of the
// exclusive per-root lock, exercised deterministically with test policy
// overrides instead of real timers.
// ---------------------------------------------------------------------------

/** Restores the default lock policy after every internals-driven test. */
function resetSeedLockPolicy(): void {
  stateRootInternals.resetSeedLockPolicyForTests();
}

void test("seed lock waits for a live holder and then proceeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-seed-lock-"));
  try {
    const lockPath = join(root, STATE_ROOT_SEED_LOCK_FILE);
    stateRootInternals.setSeedLockPolicyForTests({
      staleAfterMs: 60_000,
      waitBudgetMs: 5_000,
      pollIntervalMs: 10,
    });
    let releaseHolder: () => void = () => {};
    const holderStarted = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });

    const holder = runWithStateRootSeedLock(root, async () => {
      await holderStarted;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      await readFile(lockPath, "utf8").then(() => true),
      true,
      "the live holder must own the lock file",
    );

    const waiter = runWithStateRootSeedLock(root, async () => {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    // The waiter must still be blocked while the holder is live.
    releaseHolder();
    await Promise.all([holder, waiter]);

    assert.equal(
      await readFile(lockPath, "utf8").catch(() => null),
      null,
      "lock file must be removed once the holder finishes",
    );
  } finally {
    resetSeedLockPolicy();
    await rm(root, { force: true, recursive: true });
  }
});

void test("seed lock breaks stale crash litter and proceeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-seed-lock-"));
  try {
    const lockPath = join(root, STATE_ROOT_SEED_LOCK_FILE);
    stateRootInternals.setSeedLockPolicyForTests({
      staleAfterMs: 60_000,
      waitBudgetMs: 5_000,
      pollIntervalMs: 10,
    });
    await writeFile(lockPath, '{"pid":1,"startedAt":"stale"}', "utf8");
    const oneHourAgo = new Date(Date.now() - 3_600_000);
    await utimes(lockPath, oneHourAgo, oneHourAgo);

    await runWithStateRootSeedLock(root, async () => {});

    assert.equal(
      await readFile(lockPath, "utf8").catch(() => null),
      null,
      "stale lock litter must be broken and removed",
    );
  } finally {
    resetSeedLockPolicy();
    await rm(root, { force: true, recursive: true });
  }
});

void test("seed lock times out with guidance when a live holder exceeds the budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-seed-lock-"));
  try {
    const lockPath = join(root, STATE_ROOT_SEED_LOCK_FILE);
    stateRootInternals.setSeedLockPolicyForTests({
      staleAfterMs: 60_000,
      waitBudgetMs: 80,
      pollIntervalMs: 10,
    });
    await writeFile(lockPath, '{"pid":999,"startedAt":"live"}', "utf8");

    await assert.rejects(
      runWithStateRootSeedLock(root, async () => {}),
      /Timed out waiting for another process/u,
    );
    assert.equal(
      (await readFile(lockPath, "utf8").catch(() => null)) !== null,
      true,
      "a live holder's lock must not be removed on timeout",
    );
  } finally {
    resetSeedLockPolicy();
    await rm(root, { force: true, recursive: true });
  }
});

void test("seed lock releases the lock when the section throws", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-seed-lock-"));
  try {
    const lockPath = join(root, STATE_ROOT_SEED_LOCK_FILE);

    await assert.rejects(
      runWithStateRootSeedLock(root, async () => {
        throw new Error("seed boom");
      }),
      /seed boom/u,
    );
    assert.equal(
      await readFile(lockPath, "utf8").catch(() => null),
      null,
      "the lock must be removed even when the seed section fails",
    );

    // The next section must be able to acquire the lock immediately.
    await runWithStateRootSeedLock(root, async () => {});
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("concurrent prepareStateRoot calls never race managed-asset seeding", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-seed-lock-"));
  const packageRoot = join(root, "package");
  const stateRoot = join(root, "state");

  try {
    for (const filePath of REQUIRED_ASSET_FILES) {
      await writeAssetFile(packageRoot, filePath, { filePath });
    }
    for (const directoryPath of REQUIRED_ASSET_DIRECTORIES) {
      await writeAssetFile(packageRoot, join(directoryPath, "fixture.json"), {
        directoryPath,
      });
    }

    const prepared = { packageRoot, stateRoot, usesPackageRoot: false };
    await Promise.all([
      prepareStateRoot(prepared),
      prepareStateRoot(prepared),
      prepareStateRoot(prepared),
    ]);

    for (const filePath of REQUIRED_ASSET_FILES) {
      assert.deepEqual(
        JSON.parse(await readFile(join(stateRoot, filePath), "utf8")),
        { filePath },
      );
    }
    assert.deepEqual(
      (
        JSON.parse(
          await readFile(join(stateRoot, "state-root.json"), "utf8"),
        ) as { schemaVersion: number }
      ).schemaVersion,
      1,
    );
    assert.equal(
      await readFile(join(stateRoot, STATE_ROOT_SEED_LOCK_FILE), "utf8").catch(
        () => null,
      ),
      null,
      "no lock litter after concurrent preparation",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("seed lock rethrows non-contention lock-open failures unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-seed-lock-"));
  try {
    // A regular file as the state "root" makes open(<root>/lock, "wx")
    // fail with a non-EEXIST error (ENOTDIR/ENOENT) on every platform —
    // not a contention signal — proving unrelated failures propagate
    // unchanged instead of being mistaken for lock contention.
    const blockerPath = join(root, "not-a-directory");
    await writeFile(blockerPath, "blocker", "utf8");

    await assert.rejects(
      runWithStateRootSeedLock(blockerPath, async () => {}),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: unknown }).code !== "EEXIST",
    );
    assert.equal(
      await readFile(blockerPath, "utf8").catch(() => null),
      "blocker",
      "the blocking file must remain untouched after the failure",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("stale-lock probe treats a vanished lock as not stale", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-seed-lock-"));
  try {
    stateRootInternals.setSeedLockPolicyForTests({
      staleAfterMs: 10,
      waitBudgetMs: 5_000,
      pollIntervalMs: 10,
    });
    // The stat-miss path: the holder removed the lock between our failed
    // open and the stale probe — the probe must say "not stale" so the
    // next loop iteration re-attempts acquisition instead of breaking it.
    assert.equal(
      await stateRootInternals.isStaleLockFileForTests(
        join(root, STATE_ROOT_SEED_LOCK_FILE),
      ),
      false,
    );
  } finally {
    resetSeedLockPolicy();
    await rm(root, { force: true, recursive: true });
  }
});

void test("path-exists classification handles non-error payloads defensively", async () => {
  // The lock-open catch classifies by error code defensively; payloads that
  // are not Error-like objects must be treated as non-contention so they
  // fall through to the rethrow path instead of being swallowed.
  assert.equal(
    stateRootInternals.isPathExistsErrorForTests("not-an-error"),
    false,
  );
  assert.equal(
    stateRootInternals.isPathExistsErrorForTests({ code: "EEXIST" }),
    true,
  );
  assert.equal(
    stateRootInternals.isPathExistsErrorForTests({ code: "EPERM" }),
    false,
  );
});
