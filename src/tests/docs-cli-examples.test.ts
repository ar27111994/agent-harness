/**
 * Doc/CLI cross-check (#450) — every `agent-harness` CLI example in the
 * README and cheatsheet must parse without unknown flags, using the SAME
 * flag-spec tables the CLI guards run on (single source of truth), and the
 * help texts must list every supported flag.
 *
 * - Fenced bash blocks are validated strictly (flags checked per domain).
 * - Inline backtick references are validated leniently (schematic examples
 *   with `<placeholder>` tokens skip flag checks).
 * - discover/wire/workspace/setup keep their guards inline in their
 *   dispatchers (tested by cli-unknown-argument); this test checks their
 *   documented subcommands structurally.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runActivate } from "../activate.js";
import {
  DOMAIN_SUBCOMMAND_FLAG_SPECS,
  type SubcommandFlagSpec,
} from "../cli-flag-specs.js";
import { runDiscover } from "../discover.js";
import { runMirror } from "../mirror.js";

// ─── parsing helpers ────────────────────────────────────────────────────────

const GLOBAL_FLAGS = new Set([
  "--state-root",
  "--timeout-seconds",
  "--no-dotenv",
  "--help",
  "-h",
  "--version",
  "-V",
]);

const GLOBAL_FLAGS_WITH_VALUES = new Set(["--state-root", "--timeout-seconds"]);

/**
 * Structural subcommand allowlists for domains whose unknown-flag guards
 * live inline in their dispatchers (discover/wire/workspace/setup). The
 * flag-level truth for those domains is enforced at runtime by
 * cli-unknown-argument; this list catches doc examples referencing
 * subcommands that do not exist.
 */
const STRUCTURAL_SUBCOMMANDS: Record<string, ReadonlySet<string>> = {
  discover: new Set([
    "help",
    "demand-profile",
    "sources",
    "sync",
    "index",
    "catalog",
    "select",
    "full",
    "breadth",
    "recall",
    "candidate-pool",
    "stats",
    "diff",
    "environment-index",
    "ard-export",
    "enrich",
    "inspect",
  ]),
  wire: new Set([
    "vscode",
    "opencode",
    "cursor",
    "zed",
    "claude-code",
    "pi",
    "codex",
    "help",
  ]),
  workspace: new Set([
    "vscode",
    "opencode",
    "cursor",
    "zed",
    "claude-code",
    "pi",
    "codex",
    "help",
  ]),
  setup: new Set(["doctor", "hosts", "login", "help"]),
};

interface CliExample {
  file: string;
  lineNumber: number;
  line: string;
  tokens: string[];
}

/**
 * Splits a shell-ish doc line into tokens: env-var prefixes, quoted values,
 * and whitespace-separated words. A trailing `# comment` is cut first.
 */
function tokenizeDocLine(line: string): string[] {
  let text = line.trim();
  // Cut a trailing shell comment (`#` preceded by whitespace, outside quotes).
  let inQuote: string | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (inQuote !== null) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === "#" && (index === 0 || /\s/u.test(text[index - 1]))) {
      text = text.slice(0, index);
      break;
    }
  }
  const raw = text.match(/"([^"]*)"|'([^']*)'|\S+/gu) ?? [];
  return raw.map((token) => token.replace(/^["']|["']$/gu, ""));
}

/**
 * Strips leading `VAR=value` env assignments so `FOO=bar agent-harness …`
 * examples parse like plain invocations.
 */
function stripEnvPrefixes(tokens: string[]): string[] {
  let index = 0;
  while (index < tokens.length && /^[A-Z][A-Z0-9_]*=/u.test(tokens[index])) {
    index += 1;
  }
  return tokens.slice(index);
}

/**
 * Resolves the flag spec for a (domain, subcommand) pair, normalizing the
 * `bundle`/`stage` CLI aliases and the `bundle explain` alias.
 */
function resolveFlagSpec(
  domain: string,
  subcommand: string | undefined,
): SubcommandFlagSpec | undefined {
  let specKey = subcommand;
  if (domain === "bundle") {
    // The `bundle` domain routes to the mirror table; `bundle explain` is
    // the `bundle-explain` subcommand internally.
    specKey = subcommand === "explain" ? "bundle-explain" : subcommand;
  }
  if (specKey === undefined) {
    return undefined;
  }
  return DOMAIN_SUBCOMMAND_FLAG_SPECS[domain]?.[specKey];
}

/**
 * Validates one example against the flag tables. Returns a list of
 * human-readable problems (empty when the example parses cleanly).
 */
function validateCliExample(example: CliExample): string[] {
  const problems: string[] = [];
  const context = `${example.file}:${example.lineNumber}`;

  const tokens = stripEnvPrefixes(example.tokens);
  if (tokens.length === 0) {
    return problems;
  }
  if (tokens[0] !== "agent-harness") {
    return problems;
  }

  // Consume leading global options (e.g. --state-root before the domain).
  let index = 1;
  while (
    index < tokens.length &&
    (GLOBAL_FLAGS.has(tokens[index]) || /^--[a-z-]+=/u.test(tokens[index]))
  ) {
    const flag = tokens[index].includes("=")
      ? tokens[index].slice(0, tokens[index].indexOf("="))
      : tokens[index];
    if (GLOBAL_FLAGS_WITH_VALUES.has(flag) && !tokens[index].includes("=")) {
      index += 1;
    }
    index += 1;
  }
  if (index >= tokens.length) {
    return problems;
  }

  // Schematic/prose examples (`agent-harness <command> ...`, `agent-harness
  // ...`) carry no concrete domain to validate.
  if (tokens[index].startsWith("<") || tokens[index] === "...") {
    return problems;
  }

  const domain = tokens[index];
  index += 1;
  const knownDomains = new Set([
    ...Object.keys(DOMAIN_SUBCOMMAND_FLAG_SPECS),
    "discover",
    "wire",
    "workspace",
    "setup",
  ]);
  if (!knownDomains.has(domain)) {
    problems.push(`${context}: unknown domain '${domain}'`);
    return problems;
  }

  const subcommand = tokens[index];

  // Schematic subcommand (`agent-harness wire <host>`): stop flag checks —
  // the example documents the shape, not concrete flags.
  if (subcommand !== undefined && subcommand.startsWith("<")) {
    return problems;
  }

  const flagTokens = tokens.slice(
    index + (subcommand?.startsWith("-") ? 0 : 1),
  );

  // `--help` / `-h` at domain depth is valid for every domain.
  if (subcommand === "--help" || subcommand === "-h") {
    return problems;
  }
  if (subcommand === undefined) {
    return problems; // domain with no subcommand: dispatch/default handles it
  }

  const spec = resolveFlagSpec(domain, subcommand);
  if (spec !== undefined) {
    // Full flag truth for table-backed domains.
    let flagIndex = 0;
    while (flagIndex < flagTokens.length) {
      const token = flagTokens[flagIndex];
      if (!token.startsWith("-") || token === "-") {
        flagIndex += 1;
        continue;
      }
      if (token.startsWith("<")) {
        flagIndex += 1;
        continue;
      }
      const flag = token.includes("=")
        ? token.slice(0, token.indexOf("="))
        : token;
      if (GLOBAL_FLAGS.has(flag)) {
        if (GLOBAL_FLAGS_WITH_VALUES.has(flag) && !token.includes("=")) {
          flagIndex += 1;
        }
        flagIndex += 1;
        continue;
      }
      if (!spec.knownFlags.has(flag)) {
        problems.push(
          `${context}: '${domain} ${subcommand}' documents unknown option '${flag}'`,
        );
      }
      if (spec.flagsWithValues.has(flag) && !token.includes("=")) {
        flagIndex += 1;
      }
      flagIndex += 1;
    }
    return problems;
  }

  // Structural check for domains with inline guards.
  if (subcommand.startsWith("-")) {
    problems.push(
      `${context}: '${domain}' documents flag-like subcommand '${subcommand}'`,
    );
    return problems;
  }
  const structural = STRUCTURAL_SUBCOMMANDS[domain];
  if (structural !== undefined && !structural.has(subcommand)) {
    problems.push(
      `${context}: '${domain}' documents unknown subcommand '${subcommand}'`,
    );
  }
  return problems;
}

/**
 * Extracts CLI examples from a markdown file: every line inside fenced bash
 * blocks that starts (after env prefixes) with `agent-harness`.
 */
async function extractFencedExamples(filePath: string): Promise<CliExample[]> {
  const text = await readFile(filePath, "utf8");
  const lines = text.split("\n");
  const examples: CliExample[] = [];
  // Track the OPENING fence's info string (bash / sh / json / …); null
  // means outside a fence. Toggling on ANY `` ``` `` line — not just bare
  // or bash-tagged ones — keeps state correct when a non-bash block sits
  // between bash blocks (a bare closing ` ``` ` would otherwise flip the
  // state and swallow/emit the wrong lines, review finding).
  let fenceInfo: string | null = null;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const fenceMatch = /^\s*```(.*)$/u.exec(line);
    if (fenceMatch) {
      fenceInfo = fenceInfo === null ? (fenceMatch[1] ?? "").trim() : null;
      continue;
    }
    if (fenceInfo === null) continue;
    // Only bash/sh (or unspecified) blocks carry shell examples; json etc.
    // blocks are skipped without affecting the fence state.
    if (fenceInfo !== "" && fenceInfo !== "bash" && fenceInfo !== "sh") {
      continue;
    }
    const tokens = stripEnvPrefixes(tokenizeDocLine(line));
    if (tokens[0] !== "agent-harness") continue;
    examples.push({
      file: filePath,
      lineNumber: lineIndex + 1,
      line: line.trim(),
      tokens,
    });
  }
  return examples;
}

/**
 * Extracts inline single-backtick `agent-harness …` references from a file
 * (prose references such as `` `agent-harness wire <host> --preview` ``).
 */
async function extractInlineExamples(filePath: string): Promise<CliExample[]> {
  const text = await readFile(filePath, "utf8");
  const examples: CliExample[] = [];
  const lineStarts: number[] = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") lineStarts.push(index + 1);
  }
  const spanPattern = /`(agent-harness[^`]*)`/gu;
  for (const match of text.matchAll(spanPattern)) {
    const raw = match[1] ?? "";
    const tokens = stripEnvPrefixes(tokenizeDocLine(raw));
    if (tokens[0] !== "agent-harness") continue;
    // Compute 1-based line number from the match index.
    let lineNumber = 1;
    for (let index = 1; index < lineStarts.length; index += 1) {
      if ((match.index ?? 0) >= lineStarts[index]) lineNumber = index + 1;
    }
    examples.push({
      file: filePath,
      lineNumber,
      line: raw.trim(),
      tokens,
    });
  }
  return examples;
}

// ─── tests ──────────────────────────────────────────────────────────────────

void test("every fenced CLI example in README/cheatsheet parses without unknown flags (#450)", async () => {
  const files = ["README.md", "docs/cheatsheet.md"];
  const failures: string[] = [];
  for (const file of files) {
    const examples = await extractFencedExamples(join(process.cwd(), file));
    assert.ok(examples.length > 0, `${file} must contain CLI examples`);
    for (const example of examples) {
      const problems = validateCliExample(example);
      failures.push(...problems);
    }
  }
  assert.deepEqual(failures, [], "every documented command must parse");
});

void test("inline backtick agent-harness references parse without unknown flags (#450)", async () => {
  const files = ["README.md", "docs/cheatsheet.md"];
  const failures: string[] = [];
  for (const file of files) {
    const examples = await extractInlineExamples(join(process.cwd(), file));
    for (const example of examples) {
      failures.push(...validateCliExample(example));
    }
  }
  assert.deepEqual(failures, [], "every inline reference must parse");
});

void test("the doc validator has teeth: bad examples are rejected (#450)", () => {
  const bad = (line: string): string[] =>
    validateCliExample({
      file: "inline",
      lineNumber: 1,
      line,
      tokens: tokenizeDocLine(line),
    });
  // These exact commands were previously documented and silently ignored:
  // mirror plan/acquire take no --host, activate diff takes no --baseline.
  assert.ok(
    bad("agent-harness mirror plan --host opencode").length > 0,
    "mirror plan --host must be rejected",
  );
  assert.ok(
    bad("agent-harness mirror acquire --host opencode").length > 0,
    "mirror acquire --host must be rejected",
  );
  assert.ok(
    bad("agent-harness activate diff --baseline <state-root>").length > 0,
    "activate diff --baseline must be rejected",
  );
  // Good examples still parse cleanly (regression for the fixed lines).
  assert.deepEqual(bad("agent-harness mirror plan"), []);
  assert.deepEqual(bad("agent-harness mirror acquire"), []);
  assert.deepEqual(bad("agent-harness activate diff --host <host>"), []);
});

void test("help texts list every supported/required flag (#450)", async () => {
  // activate rollback documents the required --host/--generation.
  const activateHelp = await captureStdout(() =>
    runActivate(["rollback", "--help"], "", ""),
  );
  assert.match(
    activateHelp,
    /--generation <generation-id> Generation to restore \(required\)/u,
  );
  assert.match(
    activateHelp,
    /--host <host>\s+Target activation host \(required\)/u,
  );

  // discover environment-index documents --json.
  const envIndexHelp = await captureStdout(() =>
    runDiscover(["environment-index", "--help"], "", ""),
  );
  assert.match(envIndexHelp, /--json/u);

  // bundle explain documents --json.
  const bundleHelp = await captureStdout(() =>
    runMirror(["bundle-explain", "--help"], "", ""),
  );
  assert.match(bundleHelp, /--json +Output machine-readable JSON/u);
});

/**
 * Captures stdout written during an invocation (console.log and
 * process.stdout.write) and returns it as a single string.
 */
async function captureStdout(
  invocation: () => Promise<number>,
): Promise<string> {
  const output: string[] = [];
  const originalLog = globalThis.console.log;
  const originalStdoutWrite = process.stdout.write;
  globalThis.console.log = (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  };
  process.stdout.write = ((chunk: unknown): boolean => {
    output.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  let code: number;
  try {
    code = await invocation();
  } finally {
    globalThis.console.log = originalLog;
    process.stdout.write = originalStdoutWrite;
  }
  assert.equal(code, 0, "help invocation must exit 0");
  return output.join("\n");
}

void test("fence scanning skips non-bash blocks without inverting state (review)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-harness-doc-examples-"));
  const filePath = join(dir, "doc.md");
  try {
    await writeFile(
      filePath,
      [
        "```bash",
        "agent-harness discover sources",
        "```",
        "",
        "```json",
        '{"command": "agent-harness recommend report"}',
        "```",
        "",
        "```sh",
        "agent-harness recommend report",
        "```",
        "",
      ].join("\n"),
      "utf8",
    );

    const examples = await extractFencedExamples(filePath);
    assert.deepEqual(
      examples.map((example) => example.line.trim()),
      ["agent-harness discover sources", "agent-harness recommend report"],
      "only bash/sh fenced lines are examples, and a non-bash block between them must not invert the fence state",
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});
