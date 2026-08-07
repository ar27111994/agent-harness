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
 * Extracts dependency names from Cargo.toml dependency sections
 * (`[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`,
 * `[workspace.dependencies]`, and target-scoped variants), filtering the
 * literal `package` key and deduplicating the result.
 */
export function extractCargoDependencyNames(content: string): string[] {
  const dependencyNames: string[] = [];
  let currentSection = "";

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+#.*$/u, "").trim();
    const sectionMatch = /^\[([^\]]+)\]$/u.exec(line);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!.trim();
      continue;
    }

    if (!isCargoDependencySection(currentSection)) {
      continue;
    }

    const dependencyMatch = /^([A-Za-z0-9_-]+)\s*=/u.exec(line);
    if (dependencyMatch) {
      dependencyNames.push(dependencyMatch[1]!);
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
      dependencies.push(requireMatch[1]!);
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
  for (const dependencyMatch of content.matchAll(
    /<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<\/dependency>/giu,
  )) {
    const groupId = dependencyMatch[1]!.trim();
    const artifactId = dependencyMatch[2]!.trim();
    if (groupId && artifactId) {
      dependencies.push(`${groupId}:${artifactId}`);
    }
  }

  for (const gradleMatch of content.matchAll(
    /(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|androidTestImplementation|kapt|annotationProcessor|classpath)\s*\(?["']([^:"']+):([^:"']+)(?::[^"']+)?["']/giu,
  )) {
    const groupId = gradleMatch[1]!.trim();
    const artifactId = gradleMatch[2]!.trim();
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
      .map((match) => match[1]!.trim())
      .filter((value): value is string => Boolean(value)),
  );
}

/**
 * Extracts gem names from Gemfile gem declarations.
 */
export function extractGemDependencyNames(content: string): string[] {
  return uniqueStrings(
    [...content.matchAll(/^\s*gem\s+["']([^"']+)["']/gimu)]
      .map((match) => match[1]!.trim())
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
      .map((match) => match[1]!.trim())
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
  let currentSection = "";
  let inDependencyList = false;

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+#.*$/u, "").trim();
    const sectionMatch = line.match(/^\[([^\]]+)\]$/u);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!.trim();
      inDependencyList = false;
      continue;
    }

    if (isPyProjectDependencyListStart(line, currentSection)) {
      inDependencyList = true;
    }

    if (!inDependencyList) {
      const poetryDependencyName = extractPoetryDependencyName(
        line,
        currentSection,
      );
      if (poetryDependencyName) {
        dependencyNames.push(poetryDependencyName);
      }
      continue;
    }

    for (const dependencyMatch of line.matchAll(/["']([^"']+)["']/gu)) {
      const dependencySpecifier = dependencyMatch[1]!.trim();
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

  const dependencyName = dependencyMatch[1]!;
  const dependencySpec = dependencyMatch[2]!.trim();
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
  let currentSection = "";
  let dependencyIndent: number | null = null;

  for (const rawLine of content.split(/\r?\n/u)) {
    const sectionMatch = /^(\S[^:#]*):\s*$/u.exec(rawLine);
    if (sectionMatch && !rawLine.startsWith(" ")) {
      currentSection = sectionMatch[1]!.trim();
      dependencyIndent = null;
      continue;
    }

    if (!YAML_DEPENDENCY_SECTION_NAMES.has(currentSection)) {
      continue;
    }

    const dependencyMatch = /^(\s*)([A-Za-z0-9_]+):/u.exec(rawLine);
    if (!dependencyMatch || dependencyMatch[1]!.length === 0) {
      continue;
    }

    const indentLength = dependencyMatch[1]!.length;
    dependencyIndent ??= indentLength;
    if (indentLength === dependencyIndent) {
      dependencyNames.push(dependencyMatch[2]!);
    }
  }

  return uniqueStrings(dependencyNames);
}
