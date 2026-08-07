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

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function containsAnyText(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

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

export function extractGemDependencyNames(content: string): string[] {
  return uniqueStrings(
    [...content.matchAll(/^\s*gem\s+["']([^"']+)["']/gimu)]
      .map((match) => match[1]!.trim())
      .filter((value): value is string => Boolean(value)),
  );
}

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

export function extractSwiftDependencyNames(content: string): string[] {
  return uniqueStrings(
    [...content.matchAll(/\.package\s*\([^)]*url:\s*["']([^"']+)["']/giu)]
      .map((match) => match[1]!.trim())
      .filter((value): value is string => Boolean(value)),
  );
}

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

export function isPoetryTableReference(value: string): boolean {
  const trimmedValue = value.trim();
  return (
    /^\{[^}]*\b(?:path|git|url|file)\s*=/iu.test(trimmedValue) ||
    /^(?:git\+|hg\+|ssh:\/\/|git:\/\/|https?:\/\/|file:)/iu.test(trimmedValue)
  );
}

export function isPoetryDependencySection(currentSection: string): boolean {
  return (
    currentSection === "tool.poetry.dependencies" ||
    currentSection === "tool.poetry.dev-dependencies" ||
    /^tool\.poetry\.group\.[^.]+\.dependencies$/u.test(currentSection)
  );
}

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

export function isPlainRequirementLine(line: string): boolean {
  return (
    line.length > 0 &&
    !line.startsWith("#") &&
    !line.startsWith("-") &&
    !line.includes("://") &&
    !/^(git\+|https?:|file:|ssh\+|\.\/|\.\.\/|\/)/iu.test(line)
  );
}

export function isPythonDirectReference(value: string): boolean {
  return /\s+@\s+(?:[\\/]|\.\.?[\\/]|[a-z]:[\\/]|file:|path:|git\+|hg\+|ssh:\/\/|git:\/\/|https?:\/\/)/iu.test(
    value,
  );
}

export function isPlainPackageName(value: string | undefined): value is string {
  return Boolean(value && /^[a-z0-9_.-]+$/iu.test(value));
}

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
