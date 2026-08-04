#!/usr/bin/env node

/**
 * Guards the coverage gate's exclusion list (#428).
 *
 * The "100% coverage" claim must describe a truthful scope: only
 * non-product code (tests, type declarations, script tests) may be excluded
 * from measurement. Adding a product module to .c8rc.json's exclude list
 * silently shrinks the measured surface — this script fails the gate when
 * that happens without an explicit, reviewed justification.
 *
 * Usage: node scripts/check-coverage-exclusions.mjs
 * Exit 0 when the exclusion list contains only allowed entries, 1 otherwise.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Exclusions that are always legitimate: test bundles, type declarations,
 * and script test files. Product modules must NOT be added here.
 */
export const ALLOWED_COVERAGE_EXCLUSIONS = new Set([
  "dist/tests/**",
  "dist/types/**",
  "scripts/tests/**",
]);

/**
 * Parses the coverage exclude list from .c8rc.json content.
 * @param {string} configContent
 * @returns {{exclude: string[]} | null}
 */
export function parseCoverageConfig(configContent) {
  try {
    const parsed = JSON.parse(configContent);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.exclude)) {
      return parsed;
    }
  } catch {
    // fall through to null
  }
  return null;
}

/**
 * Returns product-module exclusions that are not in the allowlist.
 * @param {string[]} exclude
 * @returns {string[]}
 */
export function findDisallowedExclusions(exclude) {
  return exclude.filter((entry) => !ALLOWED_COVERAGE_EXCLUSIONS.has(entry));
}

/**
 * Runs the guard against the real .c8rc.json.
 * @param {string} [configFile] - Path override for testing
 * @returns {Promise<number>} exit code
 */
export async function main(configFile) {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const CONFIG_FILE = configFile ?? resolve(rootDir, ".c8rc.json");

  let content;
  try {
    content = await readFile(CONFIG_FILE, "utf-8");
  } catch (err) {
    console.error(`Failed to read ${CONFIG_FILE}: ${err.message}`);
    return 1;
  }

  const config = parseCoverageConfig(content);
  if (config === null) {
    console.error(
      `${CONFIG_FILE} is not a valid JSON config with an "exclude" array.`,
    );
    return 1;
  }

  const disallowed = findDisallowedExclusions(config.exclude);
  if (disallowed.length === 0) {
    console.log(
      `coverage-exclusions check: OK — ${config.exclude.length} exclusion(s), all non-product (tests/types/scripts).`,
    );
    return 0;
  }

  console.error(
    `coverage-exclusions check: FAIL — product module(s) excluded from coverage measurement:`,
  );
  for (const entry of disallowed) {
    console.error(`  - ${entry}`);
  }
  console.error(
    "The '100% coverage' claim must cover the whole product. Remove the exclusion and write the missing tests instead; do not re-add product modules without a documented, reviewed justification.",
  );
  return 1;
}

/* c8 ignore next 3 */
if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code));
}
