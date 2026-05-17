import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { clearRuntimeConfigForTests } from "../config/runtime.js";
import {
  countNonEmptyLines,
  createContentHash,
  createDirectoryLink,
  ensureCleanDirectory,
  ensureDirectory,
  listFilesRecursiveWithTelemetry,
  pathEntryExists,
  pathExists,
  readBinaryFileOrNull,
  readJsonFile,
  readJsonFileOrNull,
  readJsonLinesFile,
  readTextFileOrNull,
  replaceDirectoryLink,
  resolveProjectRoot,
  snapshotFileIfExists,
  toPosixPath,
  toRelativePosixPath,
  upsertManagedSection,
  writeBinaryFile,
  writeJsonFileWithSnapshot,
  writeJsonLinesFileWithSnapshot,
  writeTextFile,
} from "../files.js";
import { formatCommandHelp, printCommandHelp } from "../lib/cli-output.js";
import {
  resolveDefaultClaudeCodeConfigRoot,
  resolveDefaultCursorConfigRoot,
  resolveDefaultOpenCodeConfigRoot,
  resolveVsCodeUserSettingsPath,
} from "../lib/paths.js";
import { resolveAllowedRealFilePath } from "../lib/safe-paths.js";
import {
  STATE_ROOT_ENV_VAR,
  prepareStateRoot,
  resolveStateRoot,
} from "../lib/state-root.js";

void test("file helpers cover validation snapshots links and ignore budgets", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-files-coverage-"));

  try {
    assert.equal(resolveProjectRoot(join(root, "src", "cli.ts")), root);
    assert.equal(resolveProjectRoot(join(root, "dist", "cli.js")), root);
    assert.equal(
      resolveProjectRoot(join(root, "scripts", "run.mjs")),
      join(root, "scripts"),
    );

    const jsonPath = join(root, "state", "config.json");
    await writeTextFile(jsonPath, '{"value":2}');
    const validated = await readJsonFile<{ value: number }>(
      jsonPath,
      (value, context): asserts value is { value: number } => {
        assert.equal(context, toPosixPath(jsonPath));
        assert.equal(typeof (value as { value?: unknown }).value, "number");
      },
    );
    assert.deepEqual(validated, { value: 2 });

    const invalidJsonPath = join(root, "state", "invalid.json");
    await writeTextFile(invalidJsonPath, "{broken");
    await assert.rejects(
      readJsonFile(invalidJsonPath),
      /Invalid JSON in .*invalid\.json/u,
    );
    assert.equal(
      await readJsonFileOrNull(join(root, "state", "missing.json")),
      null,
    );

    const binaryPath = join(root, "state", "data.bin");
    const binaryValue = Buffer.from([1, 2, 3, 4]);
    await writeBinaryFile(binaryPath, binaryValue);
    assert.deepEqual(await readBinaryFileOrNull(binaryPath), binaryValue);
    assert.equal(
      await readBinaryFileOrNull(join(root, "state", "missing.bin")),
      null,
    );

    const snapshotSource = join(root, "snapshot", "source.txt");
    const snapshotPath = join(root, "snapshot", "source.snapshot.txt");
    await snapshotFileIfExists(snapshotSource, snapshotPath);
    assert.equal(await readTextFileOrNull(snapshotPath), null);

    await writeTextFile(snapshotSource, "original text");
    await snapshotFileIfExists(snapshotSource, snapshotPath);
    assert.equal(await readTextFileOrNull(snapshotPath), "original text");

    const jsonSnapshotPath = join(root, "snapshot", "config.snapshot.json");
    await writeJsonFileWithSnapshot(jsonPath, jsonSnapshotPath, { value: 5 });
    assert.deepEqual(
      JSON.parse((await readFile(jsonSnapshotPath, "utf8")).trim()),
      { value: 2 },
    );

    const jsonlPath = join(root, "snapshot", "events.jsonl");
    const jsonlSnapshotPath = join(root, "snapshot", "events.snapshot.jsonl");
    await writeTextFile(jsonlPath, '{"before":true}\n');
    await writeJsonLinesFileWithSnapshot(jsonlPath, jsonlSnapshotPath, [
      { after: true },
    ]);
    assert.equal(
      await readTextFileOrNull(jsonlSnapshotPath),
      '{"before":true}\n',
    );

    await writeTextFile(
      jsonlPath,
      ['{"id":1}', "", ' {"id":2} ', ""].join("\n"),
    );
    const jsonlValues = await readJsonLinesFile<{ id: number }>(
      jsonlPath,
      (value, context): asserts value is { id: number } => {
        assert.match(context, /events\.jsonl:\d+/u);
        assert.equal(typeof (value as { id?: unknown }).id, "number");
      },
    );
    assert.deepEqual(jsonlValues, [{ id: 1 }, { id: 2 }]);
    assert.deepEqual(
      await readJsonLinesFile(join(root, "snapshot", "missing.jsonl")),
      [],
    );

    await writeTextFile(jsonlPath, '{"id":1}\nnot-json\n');
    await assert.rejects(
      readJsonLinesFile(jsonlPath),
      /Invalid JSONL in .*events\.jsonl:2/u,
    );

    const ensureFilePath = join(root, "plain-file");
    await writeTextFile(ensureFilePath, "not a directory");
    await assert.rejects(
      ensureDirectory(ensureFilePath),
      /ENOTDIR|EEXIST|EPERM|EINVAL/u,
    );

    const missingTargetLink = join(root, "links", "missing-target");
    await assert.rejects(
      createDirectoryLink(
        join(root, "links", "broken-link"),
        missingTargetLink,
      ),
      /target does not exist/u,
    );

    const existingTarget = join(root, "targets", "a");
    const occupiedLinkPath = join(root, "links", "occupied");
    await ensureDirectory(existingTarget);
    await writeTextFile(occupiedLinkPath, "occupied");
    await assert.rejects(
      createDirectoryLink(occupiedLinkPath, existingTarget),
      /destination already exists/u,
    );

    const linkPath = join(root, "links", "active");
    const firstTarget = join(root, "targets", "first");
    const secondTarget = join(root, "targets", "second");
    await Promise.all([
      ensureDirectory(firstTarget),
      ensureDirectory(secondTarget),
    ]);
    await createDirectoryLink(linkPath, firstTarget);
    await createDirectoryLink(`${linkPath}.next`, firstTarget);
    await replaceDirectoryLink(linkPath, secondTarget);
    await writeTextFile(join(linkPath, "proof.txt"), "relinked");
    assert.equal(
      await readTextFileOrNull(join(secondTarget, "proof.txt")),
      "relinked",
    );

    const dirtyDirectory = join(root, "dirty");
    await writeTextFile(join(dirtyDirectory, "old.txt"), "old");
    await ensureCleanDirectory(dirtyDirectory);
    assert.equal(await pathExists(join(dirtyDirectory, "old.txt")), false);
    assert.equal(await pathExists(dirtyDirectory), true);
    assert.equal(await pathEntryExists(dirtyDirectory), true);

    const expectedHash = createHash("sha256")
      .update("hello", "utf8")
      .digest("hex");
    assert.equal(createContentHash("hello"), expectedHash);
    assert.equal(createContentHash(Buffer.from("hello")), expectedHash);
    assert.equal(toPosixPath("alpha\\beta\\gamma"), "alpha/beta/gamma");
    assert.equal(
      toRelativePosixPath(root, join(root, "nested", "file.txt")),
      "nested/file.txt",
    );
    assert.equal(countNonEmptyLines("\n alpha \n\n beta\n   \n"), 2);
    assert.equal(
      upsertManagedSection({
        originalContent: [
          "before",
          "<!-- agent-harness:test:begin -->",
          "old",
          "<!-- agent-harness:test:end -->",
          "after",
        ].join("\n"),
        markerId: "agent-harness:test",
        bodyLines: ["new"],
      }),
      [
        "before",
        "<!-- agent-harness:test:begin -->",
        "new",
        "<!-- agent-harness:test:end -->",
        "after",
      ].join("\n"),
    );

    const scanRoot = join(root, "scan");
    await writeTextFile(join(scanRoot, "keep.txt"), "keep");
    await writeTextFile(join(scanRoot, "notes.log"), "ignored log");
    await writeTextFile(join(scanRoot, "foo", "bar.txt"), "keep via negation");
    await writeTextFile(join(scanRoot, "foo", "baz.txt"), "ignore via glob");
    await writeTextFile(join(scanRoot, "cache", "skip.txt"), "ignore dir");
    await writeTextFile(
      join(scanRoot, "nested", "generated.txt"),
      "ignore path",
    );
    await writeTextFile(
      join(scanRoot, "win", "temp", "skip.txt"),
      "ignore windows style",
    );
    await writeTextFile(join(scanRoot, ".git", "config"), "ignored default");
    await writeTextFile(
      join(scanRoot, "discover", "output", "artifact.json"),
      "ignored default",
    );
    await writeTextFile(
      join(scanRoot, ".gitignore"),
      [
        "# comment",
        "*.log",
        "cache/",
        "foo/**",
        "!foo/bar.txt",
        "nested/generated.txt",
        "win\\temp/",
      ].join("\n"),
    );

    const scanned = await listFilesRecursiveWithTelemetry(scanRoot);
    assert.deepEqual(
      scanned.files
        .map((filePath) => toRelativePosixPath(scanRoot, filePath))
        .sort(),
      [".gitignore", "foo/bar.txt", "keep.txt"],
    );
    assert.equal(scanned.telemetry.truncated, false);

    const depthLimited = await listFilesRecursiveWithTelemetry(
      scanRoot,
      undefined,
      {
        maxDepth: 0,
      },
    );
    assert.equal(depthLimited.telemetry.truncated, true);
    assert.equal(depthLimited.telemetry.truncationReason, "max-depth");

    const fileLimited = await listFilesRecursiveWithTelemetry(
      scanRoot,
      undefined,
      {
        maxFiles: 1,
        maxBytes: 10_000,
      },
    );
    assert.equal(fileLimited.telemetry.truncated, true);
    assert.equal(fileLimited.telemetry.truncationReason, "max-files");

    const bytesLimited = await listFilesRecursiveWithTelemetry(
      scanRoot,
      undefined,
      {
        maxFiles: 20,
        maxBytes: 3,
      },
    );
    assert.equal(bytesLimited.telemetry.truncated, true);
    assert.equal(bytesLimited.telemetry.truncationReason, "max-bytes");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("command help formatting handles empty entries sections and printing", (t) => {
  const formatted = formatCommandHelp({
    heading: "Usage: agent-harness",
    entries: [],
    sections: [{ title: "Examples", lines: ["agent-harness doctor"] }],
  });
  assert.equal(
    formatted,
    ["Usage: agent-harness", "", "Examples", "  agent-harness doctor"].join(
      "\n",
    ),
  );

  const writes: string[] = [];
  t.mock.method(process.stdout, "write", (chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  });

  printCommandHelp({
    heading: "Commands",
    entries: [{ command: "sync", description: "Synchronize state" }],
  });

  assert.equal(writes.join(""), "Commands\n  sync Synchronize state\n");
});

void test("path helpers resolve host config roots for win32 darwin and linux", () => {
  const previousHome = process.env.AGENT_HARNESS_HOME;
  const previousAppData = process.env.APPDATA;
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const platformDescriptor = Object.getOwnPropertyDescriptor(
    process,
    "platform",
  );

  try {
    process.env.AGENT_HARNESS_HOME = "/home/tester";
    process.env.APPDATA = "C:/Users/tester/AppData/Roaming";
    process.env.XDG_CONFIG_HOME = "/home/tester/.config-alt";

    Object.defineProperty(process, "platform", { value: "win32" });
    clearRuntimeConfigForTests();
    assert.equal(
      toPosixPath(resolveVsCodeUserSettingsPath()),
      "C:/Users/tester/AppData/Roaming/Code/User/settings.json",
    );
    assert.equal(
      toPosixPath(resolveDefaultOpenCodeConfigRoot()),
      "C:/Users/tester/AppData/Roaming/opencode",
    );

    Object.defineProperty(process, "platform", { value: "darwin" });
    clearRuntimeConfigForTests();
    assert.equal(
      toPosixPath(resolveVsCodeUserSettingsPath()),
      "/home/tester/Library/Application Support/Code/User/settings.json",
    );
    assert.equal(
      toPosixPath(resolveDefaultOpenCodeConfigRoot()),
      "/home/tester/Library/Application Support/opencode",
    );

    Object.defineProperty(process, "platform", { value: "linux" });
    clearRuntimeConfigForTests();
    assert.equal(
      toPosixPath(resolveVsCodeUserSettingsPath()),
      "/home/tester/.config-alt/Code/User/settings.json",
    );
    assert.equal(
      toPosixPath(resolveDefaultOpenCodeConfigRoot()),
      "/home/tester/.config-alt/opencode",
    );
    assert.equal(
      toPosixPath(resolveDefaultClaudeCodeConfigRoot()),
      "/home/tester/.claude",
    );
    assert.equal(
      toPosixPath(resolveDefaultCursorConfigRoot()),
      "/home/tester/.cursor",
    );
  } finally {
    if (platformDescriptor) {
      Object.defineProperty(process, "platform", platformDescriptor);
    }
    restoreEnv("AGENT_HARNESS_HOME", previousHome);
    restoreEnv("APPDATA", previousAppData);
    restoreEnv("XDG_CONFIG_HOME", previousXdg);
    clearRuntimeConfigForTests();
  }
});

void test("state root resolution honors explicit and env overrides and protects nested package roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-state-root-extra-"));
  const previousHome = process.env.AGENT_HARNESS_HOME;
  const previousStateRoot = process.env[STATE_ROOT_ENV_VAR];

  try {
    const packageRoot = join(root, "package");
    const workingDirectory = join(root, "workspace");
    const envHome = join(root, "home");
    await Promise.all([
      ensureDirectory(packageRoot),
      ensureDirectory(workingDirectory),
      ensureDirectory(envHome),
    ]);

    process.env.AGENT_HARNESS_HOME = envHome;
    process.env[STATE_ROOT_ENV_VAR] = "~/state-from-env";
    clearRuntimeConfigForTests();

    const envResolved = resolveStateRoot({ packageRoot, workingDirectory });
    assert.equal(envResolved.stateRoot, join(envHome, "state-from-env"));

    const explicitResolved = resolveStateRoot({
      packageRoot,
      workingDirectory,
      explicitStateRoot: "relative-state",
    });
    assert.equal(
      explicitResolved.stateRoot,
      join(workingDirectory, "relative-state"),
    );
    assert.equal(explicitResolved.usesPackageRoot, false);

    await prepareStateRoot({
      packageRoot,
      stateRoot: packageRoot,
      usesPackageRoot: true,
    });
    assert.equal(await pathExists(join(packageRoot, "state-root.json")), false);

    await assert.rejects(
      prepareStateRoot({
        packageRoot: join(root, "nested", "package"),
        stateRoot: join(root, "nested"),
        usesPackageRoot: false,
      }),
      /Refusing to use a state root that contains the package root/u,
    );
  } finally {
    restoreEnv("AGENT_HARNESS_HOME", previousHome);
    restoreEnv(STATE_ROOT_ENV_VAR, previousStateRoot);
    clearRuntimeConfigForTests();
    await rm(root, { force: true, recursive: true });
  }
});

void test("safe path resolution rejects missing files even inside allowed roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-safe-real-"));

  try {
    const allowedRoot = join(root, "allowed");
    const missingFile = join(allowedRoot, "missing.txt");
    await ensureDirectory(allowedRoot);

    assert.equal(
      await resolveAllowedRealFilePath(missingFile, [allowedRoot]),
      null,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

void test("safe path resolution tolerates unrelated and unresolved allowed roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-safe-real-roots-"));

  try {
    const allowedRoot = join(root, "allowed");
    const unrelatedRoot = join(root, "unrelated");
    const missingRoot = join(root, "missing-root");
    const filePath = join(allowedRoot, "nested", "file.txt");
    await ensureDirectory(dirname(filePath));
    await ensureDirectory(unrelatedRoot);
    await writeTextFile(filePath, "ok");

    assert.equal(
      await resolveAllowedRealFilePath(filePath, [
        unrelatedRoot,
        missingRoot,
        allowedRoot,
      ]),
      await realpath(filePath),
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
