#!/usr/bin/env node

/**
 * Checks that every AGENT_HARNESS_* variable documented in .env.example
 * also appears in README.md, and vice versa.
 *
 * Usage: node scripts/check-env-readme-drift.mjs
 * Exit 0 if no drift detected, 1 otherwise.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
 * @typedef {object} DriftResult
 * @property {boolean} ok
 * @property {number} envVarCount
 * @property {string[]} missingFromReadme
 * @property {string[]} missingFromEnv
 */

/**
 * Runs the drift check given raw file contents. Returns a structured result.
 */
export function checkDrift(envContent, readmeContent) {
  const envVars = parseEnvExampleVars(envContent);
  const readmeVars = parseReadmeVars(readmeContent);

  const missingFromReadme = [];
  for (const varName of envVars) {
    if (!readmeContent.includes(varName)) {
      missingFromReadme.push(varName);
    }
  }

  const missingFromEnv = [...readmeVars].filter((v) => !envVars.has(v));

  return {
    ok: missingFromReadme.length === 0 && missingFromEnv.length === 0,
    envVarCount: envVars.size,
    missingFromReadme,
    missingFromEnv,
  };
}

function formatDriftReport(result) {
  if (result.ok) {
    return `env-readme drift check: OK — ${result.envVarCount} AGENT_HARNESS_* vars in .env.example, all present in README.md`;
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
  return lines.join("\n");
}

/**
 * Runs the drift check against the real project files.
 * @param {object} [opts] - Optional path overrides for testing.
 * @param {string} [opts.envFile] - Path to .env.example
 * @param {string} [opts.readmeFile] - Path to README.md
 */
async function main(opts) {
  const rootDir = opts?.envFile
    ? ""
    : resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const ENV_FILE = opts?.envFile ?? resolve(rootDir, ".env.example");
  const README_FILE = opts?.readmeFile ?? resolve(rootDir, "README.md");

  const envContent = await readFile(ENV_FILE, "utf-8");
  const readmeContent = await readFile(README_FILE, "utf-8");

  const result = checkDrift(envContent, readmeContent);

  if (result.ok) {
    console.log(formatDriftReport(result));
    return 0;
  }

  console.error(formatDriftReport(result));
  return 1;
}

export { main, formatDriftReport };

/* c8 ignore next 3 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code));
}
