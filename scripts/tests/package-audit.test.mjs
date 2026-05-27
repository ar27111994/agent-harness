import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  buildNpmInvocation,
  resolvePackageAuditAction,
  runPackageAudit,
  runPackedPackageSmoke,
  toPackageAuditErrorMessage,
} from "../package-audit.mjs";

const execFileAsync = promisify(execFile);

const REQUIRED_FILES = [
  "dist/cli.js",
  "dist/cli.d.ts",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "V1-TO-V2-UPGRADE.md",
  "V2-CONTRACT.md",
  "TRUST-CENTER.md",
  "SAFE-DEFAULTS.md",
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

test("packed package smoke installs fixture tarball and cleans it up", async () => {
  const cwd = await createFixturePackage(REQUIRED_FILES, {
    name: "@ar27111994/agent-harness",
  });

  await writeFile(
    join(cwd, "dist", "cli.js"),
    [
      "#!/usr/bin/env node",
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "const stateRoot = process.argv[process.argv.indexOf('--state-root') + 1];",
      "mkdirSync(stateRoot, { recursive: true });",
      "writeFileSync(join(stateRoot, 'setup-hosts-smoke.json'), JSON.stringify({ ok: true }) + '\\n');",
    ].join("\n"),
    "utf8",
  );

  await runPackedPackageSmoke({ cwd });

  await assert.rejects(
    () =>
      rm(resolve(cwd, "ar27111994-agent-harness-1.2.3.tgz"), {
        force: false,
      }),
    { code: "ENOENT" },
  );
});

test("package audit builds deterministic npm invocations", () => {
  assert.deepEqual(
    buildNpmInvocation(["pack"], {
      npmExecPath: "/tmp/npm-cli.js",
      nodeExecPath: "/tmp/node",
      platform: "linux",
    }),
    {
      command: "/tmp/node",
      commandArgs: ["/tmp/npm-cli.js", "pack"],
      shell: false,
    },
  );
  assert.deepEqual(
    buildNpmInvocation(["pack"], {
      npmExecPath: "",
      platform: "win32",
    }),
    {
      command: "npm.cmd",
      commandArgs: ["pack"],
      shell: true,
    },
  );
  assert.deepEqual(
    buildNpmInvocation(["pack"], {
      npmExecPath: "",
      platform: "linux",
    }),
    {
      command: "npm",
      commandArgs: ["pack"],
      shell: false,
    },
  );
  assert.equal(resolvePackageAuditAction("smoke"), runPackedPackageSmoke);
  assert.equal(resolvePackageAuditAction("audit"), runPackageAudit);
  assert.equal(toPackageAuditErrorMessage(new Error("boom")), "boom");
  assert.equal(toPackageAuditErrorMessage("plain"), "plain");
});

test("package audit rejects malformed npm pack payloads", async () => {
  const cwd = await createFixturePackage(REQUIRED_FILES);
  const fakeNpm = join(cwd, "fake-npm.mjs");
  const previousNpmExecPath = process.env.npm_execpath;
  await writeFile(fakeNpm, "console.log('[]');\n", "utf8");
  process.env.npm_execpath = fakeNpm;

  try {
    await assert.rejects(
      () => runPackageAudit({ cwd }),
      /npm pack --dry-run did not return a package file list/u,
    );
    await assert.rejects(
      () => runPackedPackageSmoke({ cwd }),
      /npm pack did not report a tarball filename/u,
    );
  } finally {
    if (previousNpmExecPath === undefined) {
      delete process.env.npm_execpath;
    } else {
      process.env.npm_execpath = previousNpmExecPath;
    }
  }
});

test("package audit direct execution reports failures", async () => {
  const cwd = await createFixturePackage(
    REQUIRED_FILES.filter((file) => file !== "TRUST-CENTER.md"),
  );

  const result = await execFileAsync(
    process.execPath,
    [join(import.meta.dirname, "..", "package-audit.mjs")],
    { cwd, encoding: "utf8" },
  ).catch((error) => error);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Missing required files: TRUST-CENTER\.md/u);
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

test("package audit rejects forbidden generated state and assistant metadata", async () => {
  const cwd = await createFixturePackage([
    ...REQUIRED_FILES,
    ".agent-harness/state.json",
    ".openclaw/workspace-state.json",
    "SOUL.md",
  ]);

  await assert.rejects(
    () => runPackageAudit({ cwd }),
    /Forbidden files: \.agent-harness\/state\.json, \.openclaw\/workspace-state\.json, SOUL\.md/u,
  );
});

async function createFixturePackage(files, packageOptions = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "agent-harness-package-audit-"));
  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: packageOptions.name ?? "@example/package-audit-fixture",
        version: "1.2.3",
        type: "module",
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
