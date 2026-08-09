/**
 * Direct coverage for the shared demand-extractor helpers (review DRY /
 * #433-shaped follow-up): the section-walk iterator and the guarded
 * capture-group extraction, including their impossible-by-construction
 * error arms.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  extractCargoDependencyNames,
  extractPubspecDependencyNames,
  extractPyProjectDependencyNames,
  requiredCaptureGroup,
  walkSectionedLines,
} from "../domains/discovery/demand-dependency-extractors.js";

void test("requiredCaptureGroup returns the guaranteed group and throws descriptively otherwise", () => {
  const pattern = /^(a)?(b)$/u;
  const match = pattern.exec("b");
  assert.equal(requiredCaptureGroup(match, 2, "test group", pattern), "b");

  // Optional group: the guard must throw rather than hand back undefined.
  assert.throws(
    () => requiredCaptureGroup(match, 1, "optional group", pattern),
    /optional group.*not guaranteed/u,
  );

  // Absent match: descriptive error naming the pattern.
  assert.throws(
    () => requiredCaptureGroup(null, 1, "missing match", pattern),
    /missing match.*no match found/u,
  );

  // Without a pattern the message still identifies the label.
  assert.throws(
    () => requiredCaptureGroup(null, 1, "bare label"),
    /bare label.*no match found/u,
  );
});

void test("walkSectionedLines tracks sections, comments, and header flags", () => {
  const tomlish = [
    "top = 1",
    "[alpha]",
    "  value = 1 # trailing comment",
    "  other = 2",
    "[beta nested]",
    "value = 3",
  ].join("\n");
  const headerPattern = /^\[([^\]]+)\]$/u;

  const rows = [...walkSectionedLines(tomlish, headerPattern)];
  assert.deepEqual(
    rows.map((row) => row.section),
    ["", "alpha", "alpha", "alpha", "beta nested", "beta nested"],
    "sections update on headers and persist for body lines",
  );
  assert.deepEqual(
    rows.map((row) => row.isHeader),
    [false, true, false, false, true, false],
  );
  assert.equal(
    rows[2].line,
    "value = 1",
    "inline comments stripped by default",
  );

  const stripped = [
    ...walkSectionedLines("  value = 1 # keep\n", headerPattern, {
      stripInlineComments: false,
    }),
  ];
  assert.equal(stripped[0].line, "value = 1 # keep");
  assert.equal(stripped[0].rawLine, "  value = 1 # keep");
});

void test("walkSectionedLines honors requireUnindentedHeader for YAML-style files", () => {
  const yamlish = [
    "name: top",
    "dependencies:",
    "  child: value",
    "other: x",
  ].join("\n");
  const headerPattern = /^(\S[^:#]*):\s*$/u;
  const rows = [
    ...walkSectionedLines(yamlish, headerPattern, {
      stripInlineComments: false,
      requireUnindentedHeader: true,
    }),
  ];

  // "name: top" / "other: x" carry values after the colon, so the YAML
  // header pattern does not match them — they are body lines; "dependencies:"
  // is the only header, and the indented child line is never a header.
  assert.deepEqual(
    rows.map((row) => row.section),
    ["", "dependencies", "dependencies", "dependencies"],
  );
  assert.deepEqual(
    rows.map((row) => row.isHeader),
    [false, true, false, false],
    "indented lines and value-bearing lines must never be treated as headers",
  );
});

void test("refactored extractors behave identically on representative inputs", () => {
  assert.deepEqual(
    extractCargoDependencyNames(
      [
        "[package]",
        'name = "demo"',
        "[dependencies]",
        'serde = "1" # inline comment',
        'tokio = "1"',
        "[dev-dependencies]",
        'package = "1"',
        'criterion = "0.5"',
        "[target.'cfg(unix)'.dependencies]",
        'libc = "0.2"',
      ].join("\n"),
    ),
    ["serde", "tokio", "criterion", "libc"],
  );

  assert.deepEqual(
    extractPyProjectDependencyNames(
      [
        "[project]",
        'name = "demo"',
        'dependencies = ["requests>=2.0", "click[a]"]',
        "[project.optional-dependencies]",
        'test = ["pytest"]',
      ].join("\n"),
    ),
    ["requests", "click", "pytest"],
  );

  assert.deepEqual(
    extractPubspecDependencyNames(
      [
        "name: demo",
        "dependencies:",
        "  http: ^1.0.0",
        "  flutter:",
        "    sdk: flutter",
        "  nested:",
        "    extra: value",
        "dev_dependencies:",
        "  test: ^1.0.0",
        "  http: ^1.0.0",
      ].join("\n"),
    ),
    ["http", "flutter", "nested", "test"],
  );
});
