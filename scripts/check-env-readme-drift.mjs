#!/usr/bin/env node

/**
 * Checks that every AGENT_HARNESS_* variable is documented consistently:
 *
 * 1. Every variable in .env.example must appear in README.md (and vice versa).
 * 2. Every AGENT_HARNESS_* variable READ in src/ must appear in BOTH
 *    README.md and .env.example (#429). Test-only hooks are exempt via
 *    TEST_ONLY_ENV_VARS — they are internal seams, not user-facing config.
 *
 * Usage: node scripts/check-env-readme-drift.mjs
 * Exit 0 if no drift detected, 1 otherwise.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * AGENT_HARNESS_* variables read by the test suite only. These are internal
 * test seams (fetch mocking, fake state roots), never user-facing config, so
 * they are exempt from the README/.env.example documentation requirement.
 */
export const TEST_ONLY_ENV_VARS = new Set([
  "AGENT_HARNESS_ARGV_ECHO_STATE",
  "AGENT_HARNESS_FAKE_CODE_STATE",
  "AGENT_HARNESS_TEST_FETCH_MOCKS",
]);

/**
 * Parses AGENT_HARNESS_* variable names from .env.example content.
 * Matches both active entries (VAR=VALUE) and commented-out entries (# VAR=VALUE).
 * @param {string} envContent
 * @returns {Set<string>}
 */
export function parseEnvExampleVars(envContent) {
  const vars = new Set();
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(/^#?\s*(AGENT_HARNESS_[A-Z0-9_]+)=/);
    if (match) {
      vars.add(match[1]);
    }
  }
  return vars;
}

/**
 * Parses AGENT_HARNESS_* variable names from README content.
 */
export function parseReadmeVars(readmeContent) {
  const vars = new Set();
  const matches = readmeContent.matchAll(/\b(AGENT_HARNESS_[A-Z0-9_]+)\b/g);
  for (const match of matches) {
    vars.add(match[1]);
  }
  return vars;
}

/**
 * Parses AGENT_HARNESS_* variable names from TypeScript source content.
 *
 * Matches both explicit `process.env.AGENT_HARNESS_X` reads and the
 * destructured-parameter style used by src/config/runtime.ts
 * (`env.AGENT_HARNESS_X` where `env` is the process.env binding).
 *
 * @param {string} sourceContent
 * @returns {Set<string>}
 */
export function parseSourceEnvReads(sourceContent) {
  const vars = new Set();
  const matches = sourceContent.matchAll(
    /\b(?:process\.env|env)\.(AGENT_HARNESS_[A-Z0-9_]+)\b/g,
  );
  for (const match of matches) {
    vars.add(match[1]);
  }
  return vars;
}

/**
 * @typedef {object} DriftResult
 * @property {boolean} ok
 * @property {number} envVarCount
 * @property {string[]} missingFromReadme
 * @property {string[]} missingFromEnv
 * @property {number} sourceVarCount
 * @property {string[]} missingFromDocs
 */

/**
 * Runs the drift check given raw file contents. Returns a structured result.
 * `sourceContent` is optional for backward compatibility; when provided,
 * every src-read variable (except test-only hooks) must be documented.
 */
export function checkDrift(envContent, readmeContent, sourceContent = "") {
  const envVars = parseEnvExampleVars(envContent);
  const readmeVars = parseReadmeVars(readmeContent);

  const missingFromReadme = [];
  for (const varName of envVars) {
    if (!readmeVars.has(varName)) {
      missingFromReadme.push(varName);
    }
  }

  const missingFromEnv = [...readmeVars].filter((v) => !envVars.has(v));

  let sourceVarCount = 0;
  const missingFromDocs = [];
  if (sourceContent.length > 0) {
    const sourceVars = [...parseSourceEnvReads(sourceContent)].filter(
      (v) => !TEST_ONLY_ENV_VARS.has(v),
    );
    sourceVarCount = sourceVars.length;
    for (const varName of sourceVars) {
      if (!envVars.has(varName) || !readmeVars.has(varName)) {
        missingFromDocs.push(varName);
      }
    }
  }

  return {
    ok:
      missingFromReadme.length === 0 &&
      missingFromEnv.length === 0 &&
      missingFromDocs.length === 0,
    envVarCount: envVars.size,
    missingFromReadme,
    missingFromEnv,
    sourceVarCount,
    missingFromDocs,
  };
}

function formatDriftReport(result) {
  if (result.ok) {
    const sourcePart =
      result.sourceVarCount !== undefined
        ? ` and ${result.sourceVarCount} src-read vars documented`
        : "";
    return `env-readme drift check: OK — ${result.envVarCount} AGENT_HARNESS_* vars in .env.example, all present in README.md${sourcePart}`;
  }

  const lines = [];
  if (result.missingFromReadme.length > 0) {
    lines.push(
      `env-readme drift: ${result.missingFromReadme.length} var(s) in .env.example but NOT in README.md:`,
    );
    for (const v of result.missingFromReadme) {
      lines.push(`  - ${v}`);
    }
  }
  if (result.missingFromEnv.length > 0) {
    lines.push(
      `env-readme drift: ${result.missingFromEnv.length} var(s) in README.md but NOT in .env.example:`,
    );
    for (const v of result.missingFromEnv) {
      lines.push(`  - ${v}`);
    }
  }
  if ((result.missingFromDocs ?? []).length > 0) {
    lines.push(
      `env-readme drift: ${result.missingFromDocs.length} src-read var(s) NOT documented in README.md AND .env.example:`,
    );
    for (const v of result.missingFromDocs) {
      lines.push(`  - ${v}`);
    }
  }
  return lines.join("\n");
}

/**
 * Reads every `*.ts` file under `srcDir` and returns their concatenated
 * content so the source-direction scan can find env reads.
 * @param {string} srcDir
 * @returns {Promise<string>}
 */
export async function readSourceFiles(srcDir) {
  const chunks = [];
  let files;
  try {
    files = await readdir(srcDir, { recursive: true });
  } catch (err) {
    throw new Error(
      `Failed to read source directory ${srcDir}: ${err.message}`,
      {
        cause: err,
      },
    );
  }
  for (const entry of files) {
    if (typeof entry !== "string" || !entry.endsWith(".ts")) {
      continue;
    }
    chunks.push(await readFile(join(srcDir, entry), "utf-8"));
  }
  return chunks.join("\n");
}

/**
 * Runs the drift check against the real project files.
 * @param {object} [opts] - Optional path overrides for testing.
 * @param {string} [opts.envFile] - Path to .env.example
 * @param {string} [opts.readmeFile] - Path to README.md
 * @param {string} [opts.srcDir] - Path to the src directory to scan
 */
async function main(opts) {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const ENV_FILE = opts?.envFile ?? resolve(rootDir, ".env.example");
  const README_FILE = opts?.readmeFile ?? resolve(rootDir, "README.md");
  const SRC_DIR = opts?.srcDir ?? resolve(rootDir, "src");

  let envContent, readmeContent, sourceContent;
  try {
    envContent = await readFile(ENV_FILE, "utf-8");
  } catch (err) {
    console.error(`Failed to read ${ENV_FILE}: ${err.message}`);
    return 1;
  }
  try {
    readmeContent = await readFile(README_FILE, "utf-8");
  } catch (err) {
    console.error(`Failed to read ${README_FILE}: ${err.message}`);
    return 1;
  }
  try {
    sourceContent = await readSourceFiles(SRC_DIR);
  } catch (err) {
    console.error(String(err));
    return 1;
  }

  const result = checkDrift(envContent, readmeContent, sourceContent);

  if (result.ok) {
    console.log(formatDriftReport(result));
    return 0;
  }

  console.error(formatDriftReport(result));
  return 1;
}

export { main, formatDriftReport };

/* c8 ignore next 3 */
if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code));
}
