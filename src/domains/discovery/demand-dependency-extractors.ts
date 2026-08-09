/**
 * demand-dependency-extractors — pure parse-only dependency-name extractors
 * for ecosystem manifests (#435).
 *
 * Extracted from demand-signals.ts so the extraction helpers (Cargo, Go,
 * Maven/Gradle, NuGet, Gem, Composer, Swift, Pubspec, PyProject/Poetry,
 * requirements) live apart from signal definitions and file classification.
 * Every function here is a pure string parser: no I/O, no signal mutation.
 */

export const YAML_DEPENDENCY_SECTION_NAMES = new Set([
  "dependencies",
  "dev_dependencies",
  "dependency_overrides",
  "test_dependencies",
]);

/**
 * Parses a JSON string, returning null for empty or invalid input.
 */
export function parseJsonOrNull<T>(content: string | null): T | null {
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Deduplicates string values while preserving first-occurrence order.
 */
export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Returns true when any needle occurs in the haystack.
 */
export function containsAnyText(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

/**
 * Second capture group index for extractor patterns that guarantee both
 * groups (see {@link requiredCaptureGroup}); named so the no-magic-numbers
 * guard accepts the index alongside the first group.
 */
const SECOND_CAPTURE_GROUP = 2;

/**
 * Returns capture group `groupIndex` from a regular expression match, or
 * throws with a descriptive error when the match is absent or the group is
 * optional in the pattern.
 *
 * This is the #433 guarded-lookup shape applied to regex extraction: the
 * legacy extractors asserted `match[groupIndex]!` on mandatory groups —
 * provably safe, but a non-null assertion. The throw arms are unreachable
 * through the extractors (every caller checks the match first and every
 * pattern guarantees the group); they are covered directly by the
 * internals test suite.
 */
export function requiredCaptureGroup(
  match: RegExpMatchArray | RegExpExecArray | null,
  groupIndex: number,
  label: string,
  pattern?: RegExp,
): string {
  if (match === null) {
    throw new Error(
      `Failed to parse ${label}: no match found${pattern ? ` for ${pattern}` : ""}.`,
    );
  }

  const group = match[groupIndex];
  if (group === undefined) {
    throw new Error(
      `Failed to parse ${label}: capture group ${groupIndex} is not guaranteed${pattern ? ` by ${pattern}` : ""}.`,
    );
  }

  return group;
}

/**
 * Walks the lines of a sectioned config file (TOML `[section]` headers,
 * YAML `name:` headers, ...), yielding every line with the section that was
 * current BEFORE the line was processed.
 *
 * The legacy cargo/pyproject/pubspec extractors duplicated this walk
 * verbatim (review DRY finding); a single iterator keeps section tracking,
 * comment stripping, and header detection in one place. Headers are YIELDED
 * (with `isHeader: true`) so callers can reset per-section state — every
 * caller's original loop `continue`d on headers anyway.
 *
 * Line cleaning strips trailing inline comments by default
 * (`stripInlineComments: false` preserves raw lines — YAML indentation
 * matters), and `requireUnindentedHeader` restricts header detection to
 * column-0 headers (YAML section markers).
 */
export function* walkSectionedLines(
  content: string,
  sectionHeaderPattern: RegExp,
  options: {
    stripInlineComments?: boolean;
    requireUnindentedHeader?: boolean;
  } = {},
): Generator<{
  section: string;
  line: string;
  rawLine: string;
  isHeader: boolean;
}> {
  let currentSection = "";

  for (const rawLine of content.split(/\r?\n/u)) {
    const line =
      options.stripInlineComments === false
        ? rawLine.trim()
        : rawLine.replace(/\s+#.*$/u, "").trim();
    const sectionMatch =
      options.requireUnindentedHeader === true && rawLine.startsWith(" ")
        ? null
        : sectionHeaderPattern.exec(line);
    if (sectionMatch) {
      currentSection = requiredCaptureGroup(
        sectionMatch,
        1,
        "section header",
        sectionHeaderPattern,
      ).trim();
    }

    yield {
      section: currentSection,
      line,
      rawLine,
      isHeader: sectionMatch !== null,
    };
  }
}

/**
 * Extracts dependency names from Cargo.toml dependency sections
 * (`[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`,
 * `[workspace.dependencies]`, and target-scoped variants), filtering the
 * literal `package` key and deduplicating the result.
 */
export function extractCargoDependencyNames(content: string): string[] {
  const dependencyNames: string[] = [];
  const sectionPattern = /^\[([^\]]+)\]$/u;
  const dependencyPattern = /^([A-Za-z0-9_-]+)\s*=/u;

  for (const { section, line, isHeader } of walkSectionedLines(
    content,
    sectionPattern,
  )) {
    if (isHeader) {
      continue;
    }

    if (!isCargoDependencySection(section)) {
      continue;
    }

    const dependencyMatch = dependencyPattern.exec(line);
    if (dependencyMatch) {
      dependencyNames.push(
        requiredCaptureGroup(
          dependencyMatch,
          1,
          "Cargo dependency name",
          dependencyPattern,
        ),
      );
    }
  }

  return uniqueStrings(
    dependencyNames.filter((dependencyName) => dependencyName !== "package"),
  );
}

/**
 * Returns whether a Cargo.toml section name is a dependency section.
 */
export function isCargoDependencySection(sectionName: string): boolean {
  return (
    sectionName === "dependencies" ||
    sectionName === "dev-dependencies" ||
    sectionName === "build-dependencies" ||
    sectionName === "workspace.dependencies" ||
    /^target\..+\.(?:dependencies|dev-dependencies|build-dependencies)$/u.test(
      sectionName,
    )
  );
}

/**
 * Extracts module paths from a Go module file (single-module `require`
 * lines and block bodies), deduplicating the result.
 */
export function extractGoModuleDependencyNames(content: string): string[] {
  const dependencies: string[] = [];
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.replace(/\/\/.*$/u, "").trim();
    const requireMatch =
      /^(?:require\s+)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+)\s+v?\d/iu.exec(line);
    if (requireMatch) {
      dependencies.push(
        requiredCaptureGroup(
          requireMatch,
          1,
          "Go module path",
          /^(?:require\s+)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+)\s+v?\d/iu,
        ),
      );
    }
  }
  return uniqueStrings(dependencies);
}

/**
 * Extracts Maven `groupId:artifactId` pairs from pom.xml dependency blocks
 * and from Gradle configuration dependency declarations.
 */
export function extractMavenDependencyNames(content: string): string[] {
  const dependencies: string[] = [];
  const dependencyBlockPattern =
    /<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<\/dependency>/giu;
  for (const dependencyMatch of content.matchAll(dependencyBlockPattern)) {
    const groupId = requiredCaptureGroup(
      dependencyMatch,
      1,
      "Maven groupId",
      dependencyBlockPattern,
    ).trim();
    const artifactId = requiredCaptureGroup(
      dependencyMatch,
      SECOND_CAPTURE_GROUP,
      "Maven artifactId",
      dependencyBlockPattern,
    ).trim();
    if (groupId && artifactId) {
      dependencies.push(`${groupId}:${artifactId}`);
    }
  }

  const gradlePattern =
    /(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|androidTestImplementation|kapt|annotationProcessor|classpath)\s*\(?["']([^:"']+):([^:"']+)(?::[^"']+)?["']/giu;
  for (const gradleMatch of content.matchAll(gradlePattern)) {
    const groupId = requiredCaptureGroup(
      gradleMatch,
      1,
      "Gradle dependency group",
      gradlePattern,
    ).trim();
    const artifactId = requiredCaptureGroup(
      gradleMatch,
      SECOND_CAPTURE_GROUP,
      "Gradle dependency artifact",
      gradlePattern,
    ).trim();
    if (groupId && artifactId) {
      dependencies.push(`${groupId}:${artifactId}`);
    }
  }

  return uniqueStrings(dependencies);
}

/**
 * Extracts package names from NuGet package references (PackageReference /
 * PackageVersion / packages.config package entries).
 */
export function extractNugetDependencyNames(content: string): string[] {
  return uniqueStrings(
    [
      ...content.matchAll(
        /<(?:PackageReference|PackageVersion)\s+[^>]*Include=["']([^"']+)["']/giu,
      ),
      ...content.matchAll(/<package\s+[^>]*id=["']([^"']+)["']/giu),
    ]
      .map((match) => requiredCaptureGroup(match, 1, "NuGet package id").trim())
      .filter((value): value is string => Boolean(value)),
  );
}

/**
 * Extracts gem names from Gemfile gem declarations.
 */
export function extractGemDependencyNames(content: string): string[] {
  return uniqueStrings(
    [...content.matchAll(/^\s*gem\s+["']([^"']+)["']/gimu)]
      .map((match) =>
        requiredCaptureGroup(
          match,
          1,
          "Gem name",
          /^\s*gem\s+["']([^"']+)["']/gimu,
        ).trim(),
      )
      .filter((value): value is string => Boolean(value)),
  );
}

/**
 * Extracts dependency names from composer.json `require` and `require-dev`,
 * filtering the literal `php` key.
 */
export function extractComposerDependencyNames(content: string): string[] {
  try {
    const parsed = JSON.parse(content) as {
      require?: Record<string, unknown>;
      "require-dev"?: Record<string, unknown>;
    };
    return uniqueStrings([
      ...Object.keys(parsed.require ?? {}),
      ...Object.keys(parsed["require-dev"] ?? {}),
    ]).filter((dependencyName) => dependencyName !== "php");
  } catch {
    return [];
  }
}

/**
 * Extracts the repository URLs of Swift Package Manager `.package` entries.
 */
export function extractSwiftDependencyNames(content: string): string[] {
  return uniqueStrings(
    [...content.matchAll(/\.package\s*\([^)]*url:\s*["']([^"']+)["']/giu)]
      .map((match) =>
        requiredCaptureGroup(
          match,
          1,
          "Swift package URL",
          /\.package\s*\([^)]*url:\s*["']([^"']+)["']/giu,
        ).trim(),
      )
      .filter((value): value is string => Boolean(value)),
  );
}

/**
 * Extracts dependency names from pyproject.toml: PEP 621 `dependencies`
 * lists, `project.optional-dependencies` groups, and Poetry tool sections,
 * skipping direct references and non-package specifiers.
 */
export function extractPyProjectDependencyNames(content: string): string[] {
  const dependencyNames: string[] = [];
  const sectionPattern = /^\[([^\]]+)\]$/u;
  const quotedPattern = /["']([^"']+)["']/gu;
  let inDependencyList = false;

  for (const { section, line, isHeader } of walkSectionedLines(
    content,
    sectionPattern,
  )) {
    if (isHeader) {
      inDependencyList = false;
      continue;
    }

    if (isPyProjectDependencyListStart(line, section)) {
      inDependencyList = true;
    }

    if (!inDependencyList) {
      const poetryDependencyName = extractPoetryDependencyName(line, section);
      if (poetryDependencyName) {
        dependencyNames.push(poetryDependencyName);
      }
      continue;
    }

    for (const dependencyMatch of line.matchAll(quotedPattern)) {
      const dependencySpecifier = requiredCaptureGroup(
        dependencyMatch,
        1,
        "pyproject dependency specifier",
        quotedPattern,
      ).trim();
      if (isPythonDirectReference(dependencySpecifier)) {
        continue;
      }

      const packageName = dependencySpecifier
        .split(/\s+@\s+|[<>=~!;[]/u)[0]!
        .trim();
      if (isPlainPackageName(packageName)) {
        dependencyNames.push(packageName);
      }
    }

    const unquotedLine = line.replaceAll(/["'][^"']*["']/gu, "");
    if (unquotedLine.includes("]")) {
      inDependencyList = false;
    }
  }

  return uniqueStrings(dependencyNames);
}

/**
 * Extracts a single Poetry dependency name from a `name = spec` line inside
 * a Poetry dependency section, or null for non-dependency, python, direct
 * reference, or table-reference lines.
 */
export function extractPoetryDependencyName(
  line: string,
  currentSection: string,
): string | null {
  if (!isPoetryDependencySection(currentSection)) {
    return null;
  }

  const dependencyMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/u);
  if (!dependencyMatch) {
    return null;
  }

  const dependencyPattern = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/u;
  const dependencyName = requiredCaptureGroup(
    dependencyMatch,
    1,
    "Poetry dependency name",
    dependencyPattern,
  );
  const dependencySpec = requiredCaptureGroup(
    dependencyMatch,
    SECOND_CAPTURE_GROUP,
    "Poetry dependency spec",
    dependencyPattern,
  ).trim();
  if (
    dependencyName.toLowerCase() === "python" ||
    isPythonDirectReference(dependencySpec) ||
    isPoetryTableReference(dependencySpec)
  ) {
    return null;
  }

  return dependencyName;
}

/**
 * Returns whether a Poetry dependency spec is a table reference (`{ ... }`
 * with path/git/url/file keys) or a direct VCS/URL reference.
 */
export function isPoetryTableReference(value: string): boolean {
  const trimmedValue = value.trim();
  return (
    /^\{[^}]*\b(?:path|git|url|file)\s*=/iu.test(trimmedValue) ||
    /^(?:git\+|hg\+|ssh:\/\/|git:\/\/|https?:\/\/|file:)/iu.test(trimmedValue)
  );
}

/**
 * Returns whether the section name is a Poetry dependency section.
 */
export function isPoetryDependencySection(currentSection: string): boolean {
  return (
    currentSection === "tool.poetry.dependencies" ||
    currentSection === "tool.poetry.dev-dependencies" ||
    /^tool\.poetry\.group\.[^.]+\.dependencies$/u.test(currentSection)
  );
}

/**
 * Returns whether a line opens a pyproject dependency list for the current
 * section: `dependencies = [` under `[project]` or `name = [` under
 * `[project.optional-dependencies]`.
 */
export function isPyProjectDependencyListStart(
  line: string,
  currentSection: string,
): boolean {
  if (currentSection === "project") {
    return /^dependencies\s*=\s*\[/u.test(line);
  }

  if (currentSection === "project.optional-dependencies") {
    return /^[A-Za-z0-9_.-]+\s*=\s*\[/u.test(line);
  }

  return false;
}

/**
 * Returns whether a requirements.txt line looks like a plain package
 * specifier (non-empty, not a comment/option, no URL or path prefix).
 */
export function isPlainRequirementLine(line: string): boolean {
  return (
    line.length > 0 &&
    !line.startsWith("#") &&
    !line.startsWith("-") &&
    !line.includes("://") &&
    !/^(git\+|https?:|file:|ssh\+|\.\/|\.\.\/|\/)/iu.test(line)
  );
}

/**
 * Returns whether a dependency specifier is a direct reference (local path
 * or VCS/URL) rather than a plain package name.
 */
export function isPythonDirectReference(value: string): boolean {
  return /\s+@\s+(?:[\\/]|\.\.?[\\/]|[a-z]:[\\/]|file:|path:|git\+|hg\+|ssh:\/\/|git:\/\/|https?:\/\/)/iu.test(
    value,
  );
}

/**
 * Type guard for plain package names (alphanumeric, dot, underscore,
 * hyphen only).
 */
export function isPlainPackageName(value: string | undefined): value is string {
  return Boolean(value && /^[a-z0-9_.-]+$/iu.test(value));
}

/**
 * Extracts dependency package names from pubspec.yaml dependency sections
 * (dependencies/dev_dependencies/dependency_overrides/test_dependencies)
 * using indentation to distinguish nested specs.
 */
export function extractPubspecDependencyNames(content: string): string[] {
  const dependencyNames: string[] = [];
  const sectionPattern = /^(\S[^:#]*):\s*$/u;
  const dependencyPattern = /^(\s*)([A-Za-z0-9_]+):/u;
  let dependencyIndent: number | null = null;

  for (const { section, rawLine, isHeader } of walkSectionedLines(
    content,
    sectionPattern,
    { stripInlineComments: false, requireUnindentedHeader: true },
  )) {
    if (isHeader) {
      dependencyIndent = null;
      continue;
    }

    if (!YAML_DEPENDENCY_SECTION_NAMES.has(section)) {
      continue;
    }

    const dependencyMatch = dependencyPattern.exec(rawLine);
    if (
      !dependencyMatch ||
      requiredCaptureGroup(
        dependencyMatch,
        1,
        "pubspec dependency indent",
        dependencyPattern,
      ).length === 0
    ) {
      continue;
    }

    const indentLength = requiredCaptureGroup(
      dependencyMatch,
      1,
      "pubspec dependency indent",
      dependencyPattern,
    ).length;
    dependencyIndent ??= indentLength;
    if (indentLength === dependencyIndent) {
      dependencyNames.push(
        requiredCaptureGroup(
          dependencyMatch,
          SECOND_CAPTURE_GROUP,
          "pubspec dependency name",
          dependencyPattern,
        ),
      );
    }
  }

  return uniqueStrings(dependencyNames);
}
