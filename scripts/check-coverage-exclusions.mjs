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

import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname, join, relative } from "node:path";
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
 * Product files that may contain `c8 ignore start|stop` blocks. Every entry
 * must be justified in docs/reference/COVERAGE-100-ROADMAP.md; adding a new
 * ignore block anywhere else fails the gate (#451).
 */
export const ALLOWED_INLINE_IGNORE_FILES = new Set([
  "src/domains/discovery/semantic-scoring.ts",
  "src/package-registries.ts",
]);

/**
 * Returns product files containing a `c8 ignore start` block that are not in
 * the allowlist. Scans src/ recursively, skipping test files, and returns
 * repo-relative POSIX paths sorted alphabetically.
 * @param {string} sourceRoot
 * @param {ReadonlySet<string>} [allowed]
 * @returns {Promise<string[]>}
 */
export async function findUnallowlistedInlineIgnoreBlocks(
  sourceRoot,
  allowed = ALLOWED_INLINE_IGNORE_FILES,
) {
  const offenders = [];
  const srcRoot = resolve(sourceRoot, "src");
  const stack = [srcRoot];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "tests" && currentDir === srcRoot) {
          continue; // Test files are excluded from the gate; ignores there are irrelevant.
        }
        stack.push(entryPath);
        continue;
      }
      if (!entry.name.endsWith(".ts")) {
        continue;
      }
      const relativePath = relative(sourceRoot, entryPath).replace(/\\/gu, "/");
      if (allowed.has(relativePath)) {
        continue;
      }
      const content = await readFile(entryPath, "utf8");
      if (content.includes("c8 ignore start")) {
        offenders.push(relativePath);
      }
    }
  }

  return offenders.sort();
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

/**
 * Runs the inline-ignore-block guard. Accepts an optional source root so the
 * failure path is directly testable; defaults to the repo root.
 * @param {string} [sourceRoot]
 * @returns {Promise<number>} exit code
 */
export async function mainInlineIgnores(sourceRoot) {
  const rootDir =
    sourceRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const offenders = await findUnallowlistedInlineIgnoreBlocks(rootDir);
  if (offenders.length === 0) {
    console.log(
      "inline-ignore-blocks check: OK — all c8 ignore start blocks are allowlisted and justified in COVERAGE-100-ROADMAP.md.",
    );
    return 0;
  }

  console.error(
    "inline-ignore-blocks check: FAIL — c8 ignore start block(s) in product files outside the allowlist:",
  );
  for (const file of offenders) {
    console.error(`  - ${file}`);
  }
  console.error(
    "Remove the ignore block and write real tests, or add the file to ALLOWED_INLINE_IGNORE_FILES with a justification in docs/reference/COVERAGE-100-ROADMAP.md.",
  );
  return 1;
}

// Direct-execution guard (no c8-ignore per the #428 "no new ignore
// comments" AC): the truthy arm is covered by the spawned direct-run test
// in scripts/tests/check-coverage-exclusions.test.mjs, which the coverage
// harness merges back into the gate's lcov.
if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.all([main(), mainInlineIgnores()]).then((codes) => {
    process.exit(Math.max(...codes));
  });
}
