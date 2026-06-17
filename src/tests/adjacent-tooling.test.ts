import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getAdjacentPackagesForSignals,
  ADJACENT_NPM_BY_SIGNAL,
  ADJACENT_PYPI_BY_SIGNAL,
  ADJACENT_CARGO_BY_SIGNAL,
  ADJACENT_NUGET_BY_SIGNAL,
  ADJACENT_MAVEN_BY_SIGNAL,
  ADJACENT_PACKAGIST_BY_SIGNAL,
  ADJACENT_GEM_BY_SIGNAL,
} from "../domains/discovery/adjacent-tooling.js";

void test("getAdjacentPackagesForSignals — npm/typescript returns eslint and vitest", () => {
  const result = getAdjacentPackagesForSignals("npm", ["typescript"]);
  assert.ok(result.includes("eslint"), "should include eslint");
  assert.ok(result.includes("vitest"), "should include vitest");
});

void test("getAdjacentPackagesForSignals — npm/react returns testing-library", () => {
  const result = getAdjacentPackagesForSignals("npm", ["react"]);
  assert.ok(
    result.some((p) => p.includes("testing-library")),
    "should include a testing-library package",
  );
});

void test("getAdjacentPackagesForSignals — npm/mcp returns @modelcontextprotocol/sdk", () => {
  const result = getAdjacentPackagesForSignals("npm", ["mcp"]);
  assert.ok(
    result.includes("@modelcontextprotocol/sdk"),
    "should include @modelcontextprotocol/sdk",
  );
});

void test("getAdjacentPackagesForSignals — pypi/python returns ruff and pytest", () => {
  const result = getAdjacentPackagesForSignals("pypi", ["python"]);
  assert.ok(result.includes("ruff"), "should include ruff");
  assert.ok(result.includes("pytest"), "should include pytest");
});

void test("getAdjacentPackagesForSignals — cargo/rust returns serde and tokio", () => {
  const result = getAdjacentPackagesForSignals("cargo", ["rust"]);
  assert.ok(result.includes("serde"), "should include serde");
  assert.ok(result.includes("tokio"), "should include tokio");
});

void test("getAdjacentPackagesForSignals — unknown registry kind returns empty array", () => {
  // 'go' has no static matrix currently — should not throw, returns []
  const result = getAdjacentPackagesForSignals("go", ["go"]);
  assert.deepEqual(result, []);
});

void test("getAdjacentPackagesForSignals — empty signal set returns empty array", () => {
  const result = getAdjacentPackagesForSignals("npm", []);
  assert.deepEqual(result, []);
});

void test("getAdjacentPackagesForSignals — multiple signals merge and deduplicate", () => {
  // Both "typescript" and "testing" share "vitest" in npm map
  const result = getAdjacentPackagesForSignals("npm", [
    "typescript",
    "testing",
  ]);
  const vitest = result.filter((p) => p === "vitest");
  assert.equal(vitest.length, 1, "vitest should appear exactly once");
});

void test("getAdjacentPackagesForSignals — case-insensitive signal matching", () => {
  const lower = getAdjacentPackagesForSignals("npm", ["typescript"]);
  const upper = getAdjacentPackagesForSignals("npm", ["TypeScript"]);
  assert.deepEqual(lower, upper, "matching should be case-insensitive");
});

void test("ADJACENT_NPM_BY_SIGNAL — all entries are non-empty arrays", () => {
  for (const [key, pkgs] of Object.entries(ADJACENT_NPM_BY_SIGNAL)) {
    assert.ok(
      Array.isArray(pkgs) && pkgs.length > 0,
      `npm signal "${key}" must have at least one package`,
    );
  }
});

void test("ADJACENT_PYPI_BY_SIGNAL — all entries are non-empty arrays", () => {
  for (const [key, pkgs] of Object.entries(ADJACENT_PYPI_BY_SIGNAL)) {
    assert.ok(
      Array.isArray(pkgs) && pkgs.length > 0,
      `pypi signal "${key}" must have at least one package`,
    );
  }
});

void test("ADJACENT_CARGO_BY_SIGNAL — all entries are non-empty arrays", () => {
  for (const [key, pkgs] of Object.entries(ADJACENT_CARGO_BY_SIGNAL)) {
    assert.ok(
      Array.isArray(pkgs) && pkgs.length > 0,
      `cargo signal "${key}" must have at least one package`,
    );
  }
});

void test("ADJACENT_NUGET_BY_SIGNAL — all entries are non-empty arrays", () => {
  for (const [key, pkgs] of Object.entries(ADJACENT_NUGET_BY_SIGNAL)) {
    assert.ok(
      Array.isArray(pkgs) && pkgs.length > 0,
      `nuget signal "${key}" must have at least one package`,
    );
  }
});

void test("ADJACENT_MAVEN_BY_SIGNAL — all entries are non-empty arrays", () => {
  for (const [key, pkgs] of Object.entries(ADJACENT_MAVEN_BY_SIGNAL)) {
    assert.ok(
      Array.isArray(pkgs) && pkgs.length > 0,
      `maven signal "${key}" must have at least one package`,
    );
  }
});

void test("ADJACENT_PACKAGIST_BY_SIGNAL — all entries are non-empty arrays", () => {
  for (const [key, pkgs] of Object.entries(ADJACENT_PACKAGIST_BY_SIGNAL)) {
    assert.ok(
      Array.isArray(pkgs) && pkgs.length > 0,
      `packagist signal "${key}" must have at least one package`,
    );
  }
});

void test("ADJACENT_GEM_BY_SIGNAL — all entries are non-empty arrays", () => {
  for (const [key, pkgs] of Object.entries(ADJACENT_GEM_BY_SIGNAL)) {
    assert.ok(
      Array.isArray(pkgs) && pkgs.length > 0,
      `gem signal "${key}" must have at least one package`,
    );
  }
});
