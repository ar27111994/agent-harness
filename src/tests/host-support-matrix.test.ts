import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ASSET_KINDS } from "../manifest-validation/primitives.js";
import { listHostAdapters } from "../host-adapters/registry.js";
import { buildHostSupportMatrix } from "../host-adapters/support-matrix.js";

void test("v2 host support matrix covers every registered adapter without overstating native install", () => {
  const adapters = listHostAdapters();
  const matrix = buildHostSupportMatrix(adapters);

  assert.deepEqual(
    matrix.map((row) => row.cliTarget),
    adapters.map((adapter) => adapter.id),
  );

  for (const row of matrix) {
    const adapter = adapters.find(
      (candidate) => candidate.id === row.cliTarget,
    );
    assert.ok(adapter, `${row.cliTarget}: adapter should exist`);
    assert.equal(row.lifecycleHost, adapter.lifecycleHost);
    assert.equal(row.recommendationHost, adapter.recommendationHost);
    assert.deepEqual(row.defaultBundles, adapter.defaultBundleIds);
    assert.equal(row.discoverAwareSignals, true);
    assert.equal(row.activateSupport, true);
    assert.equal(row.wirePreview, true);
    assert.equal(row.wireApply, true);
    assert.equal(row.wireReset, true);
    assert.equal(row.supportedAssetKinds.length > 0, true);
    assert.equal(row.knownLimitations.length > 0, true);

    const nativeInstallKinds = adapter.nativeInstall
      ? [adapter.nativeInstall.assetKind]
      : [];
    assert.deepEqual(row.nativeInstallVerifyRemove, nativeInstallKinds);
    assert.equal(
      row.stageInstallSupport,
      nativeInstallKinds.length > 0 ? "stage-plus-native-install" : "stage",
    );

    for (const assetKind of row.supportedAssetKinds) {
      assert.ok(
        ASSET_KINDS.includes(assetKind),
        `${row.cliTarget}: ${assetKind} should be a known asset kind`,
      );
    }
  }

  assert.deepEqual(
    matrix
      .filter((row) => row.nativeInstallVerifyRemove.length > 0)
      .map((row) => row.cliTarget),
    ["copilot-vscode", "cursor"],
  );
  assert.deepEqual(buildHostSupportMatrix([]), []);
  assert.deepEqual(
    buildHostSupportMatrix([
      {
        id: "fixture-host",
        displayName: "Fixture Host",
        aliases: [],
        lifecycleHost: "copilot-vscode",
        recommendationHost: "copilot-vscode",
        defaultBundleIds: [],
        mutatesHostPaths: false,
        capabilities: [],
        wire: async () => undefined,
      },
    ]).map((row) => row.knownLimitations),
    [[]],
  );
});

void test("README documents the v2 host matrix and every supported host row", async () => {
  const readme = await readFile(join(process.cwd(), "README.md"), "utf8");
  const matrix = buildHostSupportMatrix();

  assert.match(readme, /### v2 host support matrix/u);

  for (const row of matrix) {
    const rowPattern = new RegExp(
      `\\|\\s*${escapeRegExp(`\`${row.cliTarget}\``)}\\s*\\|`,
      "u",
    );
    assert.match(
      readme,
      rowPattern,
      `${row.cliTarget}: README should include support matrix row`,
    );
    for (const limitation of row.knownLimitations) {
      assert.match(readme, new RegExp(escapeRegExp(limitation), "u"));
    }
  }

  assert.match(readme, /native install\/verify\/remove stays explicit/u);
  assert.match(
    readme,
    /unsupported\/partial capabilities are intentionally named/u,
  );
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
