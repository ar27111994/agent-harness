import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { preflightInternals } from "../lib/preflight.js";
import { restoreEnvVar } from "./env-test-utils.js";
import {
  buildExtensionInstallActions,
  buildVsCodeExtensionInstallActions,
  extensionInstallerInternals,
  isValidVsCodeExtensionId,
  resolveVsCodeExtensionId,
} from "../host-adapters/extension-installer.js";
import type { AssetCatalogEntry } from "../types.js";

/**
 * Native-command injection and shell-quoting tests.
 *
 * The repo executes host-native commands through exactly two surfaces:
 * spawn-based runtime commands (src/lib/preflight.ts, `shell: false` or a
 * PowerShell single-quoted wrapper for .cmd/.bat on Windows) and VS Code
 * extension installs (src/host-adapters/extension-installer.ts).
 *
 * Registry-supplied values (extension ids, manifest entries, mirror paths)
 * are untrusted, so these tests pin the two guarantees that make host
 * commands injection-safe: (1) strict boundary filtering rejects any id
 * that could carry shell metacharacters, and (2) every argument that does
 * reach a shell is single-quoted with PowerShell literal escaping — proven
 * here byte-for-byte, including a real end-to-end round-trip on Windows.
 */

/** Shell metacharacter battery: anything that would execute if interpolated. */
const HOSTILE_ARGS = [
  "a&b",
  "x|y",
  "a;b",
  "$(boom)",
  "`tick`",
  "%PATH%",
  "a > out.txt",
  "a < in.txt",
  "dir ^^ echo",
  "'single-quoted'",
  '"double-quoted"',
  "has spaces here",
  "trailing\\",
];

// ---------------------------------------------------------------------------
// VS Code extension id boundary
// ---------------------------------------------------------------------------

void test("extension id validation rejects shell metacharacters and flag smuggling", () => {
  const hostileIds = [
    "evil&calc",
    "x|cmd",
    "a;b",
    "$(rm -rf /)",
    "`malware`",
    "publisher.name --install-extension evil",
    "--install-extension evil",
    "publisher..name",
    "-publisher.name",
    "publisher.na me",
    "publisher/name",
    "publisher\\name",
    "publisher:name",
    '"publisher.name"',
    "publisher.name'",
  ];
  for (const hostileId of hostileIds) {
    assert.equal(
      isValidVsCodeExtensionId(hostileId),
      false,
      `hostile id must be rejected: ${hostileId}`,
    );
  }

  const safeIds = [
    "publisher.name",
    "Microsoft.vscode",
    "ms-python.python",
    "a.b",
    "a-b.c-d",
  ];
  for (const safeId of safeIds) {
    assert.equal(
      isValidVsCodeExtensionId(safeId),
      true,
      `valid id must be accepted: ${safeId}`,
    );
  }
});

void test("extension install action builders drop hostile ids at the boundary", () => {
  const actions = buildExtensionInstallActions({
    extensionIds: [
      "safe.publisher",
      "evil&calc",
      "other.safe",
      'publisher.name"; echo pwned',
    ],
    executable: "code",
    host: "copilot-vscode",
  });

  assert.deepEqual(
    actions.map((action) => action.extensionId),
    ["safe.publisher", "other.safe"],
    "only ids surviving the strict pattern may become install actions",
  );
  for (const action of actions) {
    assert.deepEqual(action.installArgs, [
      "--install-extension",
      action.extensionId,
    ]);
    assert.equal(action.executable, "code");
  }

  const hostActions = buildVsCodeExtensionInstallActions([
    "host.safe",
    "host&unsafe",
  ]);
  assert.deepEqual(
    hostActions.map((action) => action.extensionId),
    ["host.safe"],
  );
});

void test("resolveVsCodeExtensionId prefers valid manifest entries and skips hostile ones", () => {
  const validAsset = {
    id: "safe.asset-id",
    install: { manifestEntry: undefined },
  } as unknown as AssetCatalogEntry;
  assert.equal(resolveVsCodeExtensionId(validAsset), "safe.asset-id");

  const manifestAsset = {
    id: "unused.id",
    install: { manifestEntry: "manifest.entry" },
  } as unknown as AssetCatalogEntry;
  assert.equal(resolveVsCodeExtensionId(manifestAsset), "manifest.entry");

  const hostileAsset = {
    id: "valid-hash.id",
    install: { manifestEntry: "evil&install" },
  } as unknown as AssetCatalogEntry;
  assert.equal(
    resolveVsCodeExtensionId(hostileAsset),
    "valid-hash.id",
    "hostile manifest entry must fall through to the asset id",
  );

  const allHostileAsset = {
    id: "evil|id",
    install: { manifestEntry: "evil&install" },
  } as unknown as AssetCatalogEntry;
  assert.equal(
    resolveVsCodeExtensionId(allHostileAsset),
    undefined,
    "no id may reach a native command when every candidate is hostile",
  );
});

// ---------------------------------------------------------------------------
// PowerShell wrapper quoting (the only shell-adjacent spawn surface)
// ---------------------------------------------------------------------------

void test("PowerShell wrapper command quotes hostile arguments as literals", () => {
  for (const hostileArg of HOSTILE_ARGS) {
    const quoted = preflightInternals.quotePowerShellLiteral(hostileArg);
    assert.equal(
      quoted,
      `'${hostileArg.replace(/'/gu, "''")}'`,
      `PowerShell literal escaping must wrap and double single quotes: ${hostileArg}`,
    );
    // A correctly quoted single-quoted literal cannot terminate early.
    assert.equal(quoted.startsWith("'"), true);
    assert.equal(quoted.endsWith("'"), true);
  }

  const command = preflightInternals.buildWindowsPowerShellCommand("code", [
    "--install-extension",
    "evil' & calc",
  ]);
  assert.equal(command, "& 'code' '--install-extension' 'evil'' & calc'");

  const roundTrip = preflightInternals.buildWindowsPowerShellCommand(
    "fake.exe",
    ["a&b", "x|y", "a;b"],
  );
  assert.equal(roundTrip, "& 'fake.exe' 'a&b' 'x|y' 'a;b'");
});

// ---------------------------------------------------------------------------
// End-to-end: spawned runtime commands preserve hostile argv verbatim
// ---------------------------------------------------------------------------

async function createArgvEchoFixture(tempRoot: string): Promise<string> {
  const scriptPath = join(tempRoot, "argv-echo.mjs");
  await writeFile(
    scriptPath,
    [
      'import { writeFileSync } from "node:fs";',
      'writeFileSync(process.env.AGENT_HARNESS_ARGV_ECHO_STATE, JSON.stringify(process.argv.slice(2)), "utf8");',
      "",
    ].join("\n"),
    "utf8",
  );
  return scriptPath;
}

void test("spawn-based runtime commands pass hostile arguments verbatim (no shell interpretation)", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-shell-quote-"));
  const envKey = "AGENT_HARNESS_ARGV_ECHO_STATE";
  const originalEnvValue = process.env[envKey];
  try {
    const scriptPath = await createArgvEchoFixture(tempRoot);
    const statePath = join(tempRoot, "argv-state.json");
    process.env[envKey] = statePath;

    const args = ["--flag", ...HOSTILE_ARGS];
    await preflightInternals.runRuntimeCommand(process.execPath, [
      scriptPath,
      ...args,
    ]);

    const received = JSON.parse(await readFile(statePath, "utf8")) as string[];
    assert.deepEqual(
      received,
      args,
      "spawn(shell:false) must deliver every hostile argument byte-identical",
    );
  } finally {
    if (originalEnvValue === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = originalEnvValue;
    }
    await rm(tempRoot, { force: true, recursive: true });
  }
});

void test(
  "Windows .cmd wrapper round-trips safe arguments through PowerShell verbatim",
  { skip: process.platform !== "win32" },
  async () => {
    const tempRoot = await mkdtemp(
      join(tmpdir(), "agent-harness-shell-quote-cmd-"),
    );
    const envKey = "AGENT_HARNESS_ARGV_ECHO_STATE";
    const originalEnvValue = process.env[envKey];
    try {
      const scriptPath = await createArgvEchoFixture(tempRoot);
      const statePath = join(tempRoot, "argv-state.json");
      const binDir = join(tempRoot, "bin");
      await mkdir(binDir, { recursive: true });
      const wrapperPath = join(binDir, "fake-echo.cmd");
      await writeFile(
        wrapperPath,
        `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`,
        "utf8",
      );
      process.env[envKey] = statePath;

      const safeArgs = [
        "--version",
        "plain",
        "has spaces",
        "single'quote",
        "dot.star_plus-dash",
        "a/b",
        "--flag=value",
      ];
      const spawned = await preflightInternals.runRuntimeCommand(
        wrapperPath,
        safeArgs,
        undefined,
      );

      assert.equal(
        spawned.exitCode,
        0,
        `wrapper must succeed, got: ${spawned.message}`,
      );
      const received = JSON.parse(
        await readFile(statePath, "utf8"),
      ) as string[];
      assert.deepEqual(
        received,
        safeArgs,
        "safe wrapper arguments must survive the PowerShell literal round-trip verbatim",
      );
    } finally {
      if (originalEnvValue === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = originalEnvValue;
      }
      await rm(tempRoot, { force: true, recursive: true });
    }
  },
);

void test("shell-metacharacter detection covers every cmd.exe interpretation", () => {
  const metaArguments = [
    "a&b",
    "x|y",
    "a > out",
    "a < in",
    "dir ^^ echo",
    "%PATH%",
    "!VAR!",
    'quote"break',
    "line\nbreak",
    "carriage\rreturn",
    "nul\u0000byte",
  ];
  for (const hostile of metaArguments) {
    assert.equal(
      preflightInternals.containsShellMetaCharacters(hostile),
      true,
      `cmd metacharacter must be detected: ${JSON.stringify(hostile)}`,
    );
    assert.equal(containsEveryMetaCharacter(hostile), true);
  }

  const safeArguments = [
    "--version",
    "plain",
    "has spaces",
    "single'quote",
    "dot.star_plus-dash",
    "a/b",
    "--flag=value",
    "a;b",
    "",
  ];
  // Independent oracle (G3): validate each safe value against a separate
  // hostile-character pattern, not against the function under test, so a
  // regression in the detection itself cannot pass by construction.
  for (const value of safeArguments) {
    assert.equal(
      containsEveryMetaCharacter(value),
      false,
      `oracle: ${JSON.stringify(value)} must be metachar-free`,
    );
    assert.equal(
      preflightInternals.containsShellMetaCharacters(value),
      false,
      `guard: ${JSON.stringify(value)} must pass the metacharacter guard`,
    );
  }

  assert.equal(
    preflightInternals.isWindowsShellWrapperPath(
      "C:\\Tools\\code.cmd",
      "win32",
    ),
    true,
  );
  assert.equal(
    preflightInternals.isWindowsShellWrapperPath("C:\\Tools\\run.bat", "win32"),
    true,
  );
  assert.equal(
    preflightInternals.isWindowsShellWrapperPath(
      "C:\\Tools\\code.exe",
      "win32",
    ),
    false,
  );
  assert.equal(
    preflightInternals.isWindowsShellWrapperPath(
      "C:\\Tools\\code.cmd",
      "linux",
    ),
    false,
  );
  assert.equal(
    preflightInternals.isWindowsShellWrapperPath("C:\\Tools\\code", "win32"),
    false,
  );
});

function containsEveryMetaCharacter(value: string): boolean {
  return value.includes("\u0000") || /[&|<>^%!"\r\n]/u.test(value);
}

void test(
  "Windows wrapper with shell-metacharacter arguments is refused before execution",
  { skip: process.platform !== "win32" },
  async () => {
    const tempRoot = await mkdtemp(
      join(tmpdir(), "agent-harness-shell-quote-refuse-"),
    );
    try {
      const markerPath = join(tempRoot, "wrapper-ran.marker");
      const binDir = join(tempRoot, "bin");
      await mkdir(binDir, { recursive: true });
      const wrapperPath = join(binDir, "fake-echo.cmd");
      await writeFile(
        wrapperPath,
        ["@echo off", `> "${markerPath}" echo ran`, ""].join("\r\n"),
        "utf8",
      );

      const spawned = await preflightInternals.runRuntimeCommand(
        wrapperPath,
        [...HOSTILE_ARGS],
        undefined,
      );

      assert.equal(
        spawned.exitCode,
        Number.MAX_SAFE_INTEGER,
        "hostile wrapper invocation must be refused, not executed",
      );
      assert.match(spawned.message, /Refusing/u);
      assert.equal(
        await readFile(markerPath, "utf8").catch(() => null),
        null,
        "the wrapper must never execute when arguments contain cmd metacharacters",
      );
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  },
);

void test(
  "extension installer refuses shell-metacharacter arguments on wrapper candidates",
  { skip: process.platform !== "win32" },
  async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-ext-refuse-"));
    try {
      const markerPath = join(tempRoot, "ext-ran.marker");
      const wrapperPath = join(tempRoot, "fake-ext.cmd");
      await writeFile(
        wrapperPath,
        ["@echo off", `> "${markerPath}" echo ran`, ""].join("\r\n"),
        "utf8",
      );

      const result = await extensionInstallerInternals.executeNativeCommand(
        wrapperPath,
        ["evil&extension-id"],
      );

      assert.equal(
        result.exitCode,
        Number.MAX_SAFE_INTEGER,
        "hostile extension ids must be refused on shell candidates",
      );
      assert.match(result.stderr, /Refusing/u);
      assert.equal(
        await readFile(markerPath, "utf8").catch(() => null),
        null,
        "a shell wrapper must never be invoked with metacharacter arguments",
      );
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Extension installer: shell-free PowerShell wrapper execution (#448)
// ---------------------------------------------------------------------------

void test("extension installer builds shell-free PowerShell specs for .cmd wrappers on every platform (#448)", () => {
  const spec = extensionInstallerInternals.buildNativeCommandSpec(
    "C:\\Tools\\cli.cmd",
    ["--flag=has space", "a'b", "a&b"],
    "win32",
  );

  assert.deepEqual(
    spec,
    {
      executable: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "& 'C:\\Tools\\cli.cmd' '--flag=has space' 'a''b' 'a&b'",
      ],
    },
    "wrapper execution must be a single-quoted PowerShell literal command — no shell:true concatenation (DEP0190)",
  );
  // The spawn spec carries no `shell` option; execFile defaults to
  // shell:false, so Node never emits DEP0190 for wrapper invocations.
  assert.equal(Object.hasOwn(spec, "shell"), false);
  assert.deepEqual(
    extensionInstallerInternals.buildNativeCommandSpec(
      "C:\\Tools\\cli.exe",
      ["--version"],
      "win32",
    ),
    { executable: "C:\\Tools\\cli.exe", args: ["--version"] },
    "non-wrapper executables keep direct execution",
  );
});

void test(
  "extension installer .cmd wrapper round-trips safe arguments verbatim without DEP0190 (#448)",
  { skip: process.platform !== "win32" },
  async () => {
    const tempRoot = await mkdtemp(
      join(tmpdir(), "agent-harness-ext-installer-cmd-"),
    );
    const envKey = "AGENT_HARNESS_ARGV_ECHO_STATE";
    const originalEnvValue = process.env[envKey];
    try {
      const scriptPath = await createArgvEchoFixture(tempRoot);
      const statePath = join(tempRoot, "argv-state.json");
      const binDir = join(tempRoot, "bin");
      await mkdir(binDir, { recursive: true });
      const wrapperPath = join(binDir, "fake-ext.cmd");
      await writeFile(
        wrapperPath,
        `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`,
        "utf8",
      );
      process.env[envKey] = statePath;

      const safeArgs = ["--install-extension", "github.copilot", "--force"];
      const result = await extensionInstallerInternals.executeNativeCommand(
        wrapperPath,
        safeArgs,
      );

      assert.equal(
        result.exitCode,
        0,
        `wrapper invocation must succeed, got: ${result.stderr}`,
      );
      assert.equal(
        result.stderr.includes("DEP0190"),
        false,
        "no shell:true deprecation warning may reach stderr",
      );
      const received = JSON.parse(
        await readFile(statePath, "utf8"),
      ) as string[];
      assert.deepEqual(
        received,
        safeArgs,
        "safe wrapper arguments must survive the PowerShell literal round-trip verbatim",
      );
    } finally {
      restoreEnvVar(envKey, originalEnvValue);
      await rm(tempRoot, { force: true, recursive: true });
    }
  },
);
