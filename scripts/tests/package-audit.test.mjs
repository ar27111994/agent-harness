import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { runPackageAudit } from "../package-audit.mjs";

const REQUIRED_FILES = [
  "dist/cli.js",
  "dist/cli.d.ts",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "V1-TO-V2-UPGRADE.md",
  "V2-CONTRACT.md",
  "TRUST-CENTER.md",
  "RELEASE-PROCESS.md",
  "QUARANTINE-PLAYBOOK.md",
  "HARNESS-MAINTENANCE-GUIDE.md",
  "discover/sources.json",
  "mirror/policy.json",
];

test("package audit accepts expected runtime and documentation files", async () => {
  const cwd = await createFixturePackage(REQUIRED_FILES);

  const summary = await runPackageAudit({ cwd });

  assert.equal(summary.package, "@example/package-audit-fixture");
  assert.equal(summary.version, "1.2.3");
  assert.ok(summary.fileCount >= REQUIRED_FILES.length);
});

test("package audit rejects missing v2 trust docs", async () => {
  const cwd = await createFixturePackage(
    REQUIRED_FILES.filter((file) => file !== "TRUST-CENTER.md"),
  );

  await assert.rejects(
    () => runPackageAudit({ cwd }),
    /Missing required files: TRUST-CENTER\.md/u,
  );
});

test("package audit rejects forbidden generated state", async () => {
  const cwd = await createFixturePackage([
    ...REQUIRED_FILES,
    ".agent-harness/state.json",
  ]);

  await assert.rejects(
    () => runPackageAudit({ cwd }),
    /Forbidden files: \.agent-harness\/state\.json/u,
  );
});

async function createFixturePackage(files) {
  const cwd = await mkdtemp(join(tmpdir(), "agent-harness-package-audit-"));
  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: "@example/package-audit-fixture",
        version: "1.2.3",
        files,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  for (const file of files) {
    const filePath = join(cwd, ...file.split("/"));
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      file.endsWith(".json") ? "{}\n" : `${file}\n`,
      "utf8",
    );
  }

  return cwd;
}
