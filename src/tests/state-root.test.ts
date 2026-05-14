import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { prepareStateRoot, resolveStateRoot } from "../lib/state-root.js";

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
