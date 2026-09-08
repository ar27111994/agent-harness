import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  REQUIRED_PACKED_FILES,
  buildNpmInvocation,
  resolveNpmCliPath,
  resolvePackageAuditAction,
  runPackageAudit,
  runPackedPackageSmoke,
  toPackageAuditErrorMessage,
  toPackRecordList,
} from "../package-audit.mjs";

const execFileAsync = promisify(execFile);

const posixJoin = (...parts) =>
  join(...parts)
    .split("\\")
    .join("/");

// The fixture represents a compliant package; derive it from the audit's
// pinned required set so the two can never drift apart again.
const REQUIRED_FILES = REQUIRED_PACKED_FILES;

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
  // win32 also routes through node+npm-cli (NEVER a shell — DEP0190 doctrine).
  assert.deepEqual(
    buildNpmInvocation(["pack"], {
      npmExecPath: "C:/tools/npm-cli.js",
      nodeExecPath: "C:/node/node.exe",
      platform: "win32",
    }),
    {
      command: "C:/node/node.exe",
      commandArgs: ["C:/tools/npm-cli.js", "pack"],
      shell: false,
    },
  );
  // A resolved npm-cli path flows through to node+npm-cli regardless of OS.
  assert.deepEqual(
    buildNpmInvocation(["pack"], {
      npmExecPath: "",
      npmConfigPrefix: "/prefix",
      exists: (p) => p === "/prefix/node_modules/npm/bin/npm-cli.js",
      nodeExecPath: "/node",
      platform: "win32",
    }),
    {
      command: "/node",
      commandArgs: ["/prefix/node_modules/npm/bin/npm-cli.js", "pack"],
      shell: false,
    },
  );
  // No reachable npm-cli on POSIX falls back to bare `npm` — a shebang
  // script that spawns cleanly with shell: false (never a shell wrapper).
  assert.deepEqual(
    buildNpmInvocation(["pack"], {
      npmExecPath: "",
      exists: () => false,
      platform: "linux",
    }),
    {
      command: "npm",
      commandArgs: ["pack"],
      shell: false,
    },
  );
  // On win32 there is no shell-less bare launcher — fail loudly (DEP0190)
  // instead of launching `node <nonexistent-path>`.
  assert.throws(
    () =>
      buildNpmInvocation(["pack"], {
        npmExecPath: "",
        exists: () => false,
        platform: "win32",
      }),
    /DEP0190/u,
  );
  assert.equal(resolvePackageAuditAction("smoke"), runPackedPackageSmoke);
  assert.equal(resolvePackageAuditAction("audit"), runPackageAudit);
  assert.equal(toPackageAuditErrorMessage(new Error("boom")), "boom");
  assert.equal(toPackageAuditErrorMessage("plain"), "plain");
});

test("toPackRecordList normalizes npm array, object, null, and scalar pack payloads", () => {
  const arrayRecord = { files: [] };
  assert.equal(toPackRecordList([arrayRecord])[0], arrayRecord);
  assert.equal(toPackRecordList({ "@scope/pkg": arrayRecord })[0], arrayRecord);
  assert.deepEqual(toPackRecordList(null), []);
  assert.deepEqual(toPackRecordList(undefined), []);
  assert.deepEqual(toPackRecordList("scalar"), []);
  assert.equal(toPackRecordList([arrayRecord, { files: [] }]).length, 2);
});

test("resolveNpmCliPath prefers explicit, then first existing prefix/node candidate, else ''", () => {
  const before = {
    npmExecPath: process.env.npm_execpath,
    npmConfigPrefix: process.env.npm_config_prefix,
  };
  try {
    process.env.npm_config_prefix = "/custom/prefix";
    const prefixPath = posixJoin(
      "/custom/prefix",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    const prefixLibPath = posixJoin(
      "/custom/prefix",
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    const execDir = dirname(process.execPath).replaceAll("\\", "/");
    const nodeBundled = posixJoin(
      execDir,
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    const nodeLib = posixJoin(
      execDir,
      "..",
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    const onlyExisting = (paths) => (p) => paths.includes(p);

    // An explicit path always wins, bypassing any existence check.
    assert.equal(
      resolveNpmCliPath({ npmExecPath: "/explicit/cli.js" }, onlyExisting([])),
      "/explicit/cli.js",
    );
    // npm_execpath env is read as the explicit path too.
    process.env.npm_execpath = "/env-execpath/cli.js";
    assert.equal(
      resolveNpmCliPath({}, onlyExisting([])),
      "/env-execpath/cli.js",
    );
    delete process.env.npm_execpath;

    // An empty explicit value is "no explicit path" — falls through to the
    // existing-candidate chain (as buildNpmInvocation relies on).
    assert.equal(
      resolveNpmCliPath(
        { npmExecPath: "", npmConfigPrefix: "/custom/prefix" },
        onlyExisting([prefixPath]),
      ),
      prefixPath,
    );

    // The first existing prefix candidate wins.
    assert.equal(
      resolveNpmCliPath(
        { npmConfigPrefix: "/custom/prefix" },
        onlyExisting([prefixPath]),
      ),
      prefixPath,
    );

    // POSIX distro layout (prefix/lib/node_modules) is probed when the
    // top-level node_modules candidate is absent.
    assert.equal(
      resolveNpmCliPath(
        { npmConfigPrefix: "/custom/prefix" },
        onlyExisting([prefixLibPath]),
      ),
      prefixLibPath,
    );

    // No prefix configured: node-bundled npm is the first existing candidate.
    delete process.env.npm_config_prefix;
    assert.equal(
      resolveNpmCliPath({}, onlyExisting([nodeBundled])),
      nodeBundled,
    );

    // The POSIX lib sibling under the node install is tried before giving up.
    assert.equal(resolveNpmCliPath({}, onlyExisting([nodeLib])), nodeLib);

    // Nothing exists => "" so buildNpmInvocation can fall back to bare npm.
    assert.equal(resolveNpmCliPath({}, onlyExisting([])), "");
  } finally {
    if (before.npmExecPath === undefined) {
      delete process.env.npm_execpath;
    } else {
      process.env.npm_execpath = before.npmExecPath;
    }
    if (before.npmConfigPrefix === undefined) {
      delete process.env.npm_config_prefix;
    } else {
      process.env.npm_config_prefix = before.npmConfigPrefix;
    }
  }
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
    REQUIRED_FILES.filter((file) => file !== "docs/guides/TRUST-CENTER.md"),
  );

  const result = await execFileAsync(
    process.execPath,
    [join(import.meta.dirname, "..", "package-audit.mjs")],
    { cwd, encoding: "utf8" },
  ).catch((error) => error);

  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /Missing required files: docs\/guides\/TRUST-CENTER\.md/u,
  );
});

test("package audit rejects missing v2 trust docs", async () => {
  const cwd = await createFixturePackage(
    REQUIRED_FILES.filter((file) => file !== "docs/guides/TRUST-CENTER.md"),
  );

  await assert.rejects(
    () => runPackageAudit({ cwd }),
    /Missing required files: docs\/guides\/TRUST-CENTER\.md/u,
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
