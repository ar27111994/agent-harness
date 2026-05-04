import { readTextFileOrNull } from "../../files.js";
import type { DemandSignalSet } from "../../types.js";
import {
  collectDetectorSignals,
  isDetectorInspectableFile,
} from "./detectors.js";
import { addSignals, createEmptySignalSet } from "./signals.js";
import { applyTechnologySignatures } from "./technology-signatures.js";

interface PackageJsonShape {
  author?: string | { name?: string };
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: {
    node?: string;
  };
  keywords?: string[];
  name?: string;
}

interface ActorJsonShape {
  categories?: string[];
  description?: string;
  dockerfile?: string;
  title?: string;
  webServerSchema?: string;
}

const ACTOR_JSON_PATH_PATTERN = /[\\/]\.actor[\\/]actor\.json$/iu;
const LOGGING_TEXT_MARKERS = ["logger", "logging", "debugger", "debug"];
const MOCKING_TEXT_MARKERS = ["mock", "mocking"];
const REPLAY_TEXT_MARKERS = ["replay", "forwarding", "forwarder"];
const WEBHOOK_TEXT_MARKERS = ["webhook", "webhooks"];
const INSPECTABLE_FILE_NAMES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "tsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "composer.json",
  "Package.swift",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "deno.json",
  "actor.json",
  "input_schema.json",
]);

/**
 * Provides should inspect file for the lifecycle pipeline.
 */
export function shouldInspectFile(fileName: string, filePath: string): boolean {
  if (isActorJsonFile(fileName, filePath) || fileName === "input_schema.json") {
    return true;
  }

  if (
    fileName.endsWith(".csproj") ||
    fileName.endsWith(".tf") ||
    fileName.endsWith(".tfvars")
  ) {
    return true;
  }

  if (
    fileName.startsWith("playwright.config.") ||
    fileName.startsWith("vitest.config.") ||
    fileName.startsWith("jest.config.")
  ) {
    return true;
  }

  if (/openapi|swagger/iu.test(fileName)) {
    return true;
  }

  if (INSPECTABLE_FILE_NAMES.has(fileName)) {
    return true;
  }

  return (
    /docker-compose\./iu.test(filePath) ||
    isDetectorInspectableFile(fileName, filePath)
  );
}

/**
 * Collects demand signals for file from the provided inputs.
 */
export async function collectDemandSignalsForFile(
  fileName: string,
  filePath: string,
): Promise<DemandSignalSet> {
  const matchedSignals = collectStaticSignals(fileName, filePath);

  collectDetectorSignals(fileName, filePath, matchedSignals);

  const fileContent = shouldReadFileContent(fileName, filePath)
    ? await readTextFileOrNull(filePath)
    : null;

  if (fileName === "package.json") {
    enrichPackageJsonSignals(fileContent, matchedSignals);
  }

  if (fileName === "requirements.txt") {
    enrichRequirementsSignals(fileContent, matchedSignals);
  }

  if (fileName === "pyproject.toml") {
    enrichPyProjectSignals(fileContent, matchedSignals);
  }

  enrichMultiEcosystemDependencySignals(fileName, fileContent, matchedSignals);

  if (isActorJsonFile(fileName, filePath)) {
    enrichActorJsonSignals(fileContent, matchedSignals);
  }

  if (shouldReadTextForTechnologySignals(fileName)) {
    enrichGenericTextSignals(fileContent, matchedSignals);
  }

  return matchedSignals;
}

/**
 * Returns whether the provided value matches actor json file.
 */
export function isActorJsonFile(fileName: string, filePath: string): boolean {
  return (
    /^actor\.json$/iu.test(fileName) || ACTOR_JSON_PATH_PATTERN.test(filePath)
  );
}

function collectStaticSignals(
  fileName: string,
  filePath: string,
): DemandSignalSet {
  const matchedSignals = createEmptySignalSet();

  if (fileName === "package.json") {
    addSignals(matchedSignals.languages, ["javascript"]);
    addSignals(matchedSignals.packageManagers, ["npm"]);
  }

  if (fileName === "package-lock.json") {
    addSignals(matchedSignals.packageManagers, ["npm"]);
  }

  if (fileName === "pnpm-lock.yaml") {
    addSignals(matchedSignals.packageManagers, ["pnpm"]);
  }

  if (fileName === "yarn.lock") {
    addSignals(matchedSignals.packageManagers, ["yarn"]);
  }

  if (fileName === "tsconfig.json") {
    addSignals(matchedSignals.languages, ["typescript"]);
    addSignals(matchedSignals.tooling, ["typescript"]);
  }

  if (fileName === "pyproject.toml" || fileName === "requirements.txt") {
    addSignals(matchedSignals.languages, ["python"]);
    addSignals(matchedSignals.packageManagers, ["pip"]);
  }

  if (fileName === "Cargo.toml") {
    addSignals(matchedSignals.languages, ["rust"]);
    addSignals(matchedSignals.packageManagers, ["cargo"]);
  }

  if (fileName === "go.mod") {
    addSignals(matchedSignals.languages, ["go"]);
    addSignals(matchedSignals.packageManagers, ["go-modules"]);
  }

  if (
    fileName === "pom.xml" ||
    fileName === "build.gradle" ||
    fileName === "build.gradle.kts"
  ) {
    addSignals(matchedSignals.languages, ["java"]);
    addSignals(matchedSignals.packageManagers, ["maven-gradle"]);
  }

  if (fileName.endsWith(".csproj")) {
    addSignals(matchedSignals.languages, ["csharp"]);
    addSignals(matchedSignals.packageManagers, ["nuget"]);
  }

  if (fileName === "Gemfile") {
    addSignals(matchedSignals.languages, ["ruby"]);
    addSignals(matchedSignals.packageManagers, ["bundler"]);
  }

  if (fileName === "composer.json") {
    addSignals(matchedSignals.languages, ["php"]);
    addSignals(matchedSignals.packageManagers, ["composer"]);
  }

  if (fileName === "Package.swift") {
    addSignals(matchedSignals.languages, ["swift"]);
    addSignals(matchedSignals.packageManagers, ["swiftpm"]);
  }

  if (fileName === "deno.json") {
    addSignals(matchedSignals.languages, ["typescript"]);
    addSignals(matchedSignals.tooling, ["deno"]);
  }

  if (
    fileName === "Dockerfile" ||
    fileName === "docker-compose.yml" ||
    fileName === "docker-compose.yaml" ||
    fileName.startsWith("docker-compose.")
  ) {
    addSignals(matchedSignals.concerns, ["containerization", "infrastructure"]);
    addSignals(matchedSignals.tooling, ["docker"]);
  }

  if (fileName.endsWith(".tf") || fileName.endsWith(".tfvars")) {
    addSignals(matchedSignals.concerns, ["terraform", "infrastructure"]);
    addSignals(matchedSignals.tooling, ["terraform"]);
  }

  if (fileName.startsWith("playwright.config.")) {
    addSignals(matchedSignals.concerns, ["e2e-testing", "testing"]);
    addSignals(matchedSignals.tooling, ["playwright"]);
  }

  if (
    fileName.startsWith("vitest.config.") ||
    fileName.startsWith("jest.config.")
  ) {
    addSignals(matchedSignals.concerns, ["testing"]);
    addSignals(matchedSignals.tooling, [
      fileName.startsWith("vitest") ? "vitest" : "jest",
    ]);
  }

  if (/openapi|swagger/iu.test(fileName)) {
    addSignals(matchedSignals.concerns, ["api-design", "openapi"]);
    addSignals(matchedSignals.tooling, ["openapi"]);
  }

  if (
    /\.actor[/]/iu.test(filePath) ||
    /^actor\.json$/iu.test(fileName) ||
    /input_schema\.json$/iu.test(fileName)
  ) {
    addSignals(matchedSignals.concerns, ["actor-development", "automation"]);
    addSignals(matchedSignals.tooling, ["actor-runtime"]);
  }

  return matchedSignals;
}

function enrichPackageJsonSignals(
  content: string | null,
  matchedSignals: DemandSignalSet,
): void {
  const packageJson = parseJsonOrNull<PackageJsonShape>(content);

  if (!packageJson) {
    return;
  }

  const dependencyNames = new Set<string>([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);
  const packageTextSignals = [
    packageJson.name ?? "",
    packageJson.description ?? "",
    ...(packageJson.keywords ?? []),
    typeof packageJson.author === "string"
      ? packageJson.author
      : (packageJson.author?.name ?? ""),
  ]
    .join(" ")
    .toLowerCase();
  if (dependencyNames.has("typescript")) {
    addSignals(matchedSignals.languages, ["typescript"]);
    addSignals(matchedSignals.tooling, ["typescript"]);
  }

  if (packageJson.engines?.node) {
    addSignals(matchedSignals.tooling, ["node"]);
  }

  applyTechnologySignatures(matchedSignals, {
    dependencyNames: [...dependencyNames],
    ecosystem: "npm",
    text: packageTextSignals,
  });
  addGenericTextSignals(matchedSignals, packageTextSignals);
  addPackageDependencySignals(matchedSignals, "npm", [...dependencyNames]);
}

function enrichRequirementsSignals(
  content: string | null,
  matchedSignals: DemandSignalSet,
): void {
  if (!content) {
    return;
  }

  const dependencyNames = content
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+#.*$/u, "").trim())
    .filter(isPlainRequirementLine)
    .filter((line) => !isPythonDirectReference(line))
    .map((line) => line.split(/\s+@\s+|[<>=~!;[]/u)[0]?.trim())
    .filter(isPlainPackageName);

  applyTechnologySignatures(matchedSignals, {
    dependencyNames,
    ecosystem: "pypi",
  });
  addPackageDependencySignals(matchedSignals, "pypi", dependencyNames);
}

function enrichPyProjectSignals(
  content: string | null,
  matchedSignals: DemandSignalSet,
): void {
  if (!content) {
    return;
  }

  const dependencyNames = extractPyProjectDependencyNames(content);

  applyTechnologySignatures(matchedSignals, {
    dependencyNames,
    ecosystem: "pypi",
  });
  addPackageDependencySignals(matchedSignals, "pypi", dependencyNames);
}

function extractPyProjectDependencyNames(content: string): string[] {
  const dependencyNames: string[] = [];
  let currentSection = "";
  let inDependencyList = false;

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+#.*$/u, "").trim();
    const sectionMatch = line.match(/^\[([^\]]+)\]$/u);
    if (sectionMatch) {
      currentSection = sectionMatch[1]?.trim() ?? "";
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
      const dependencySpecifier = dependencyMatch[1]?.trim();
      if (isPythonDirectReference(dependencySpecifier)) {
        continue;
      }

      const packageName = dependencySpecifier
        ?.split(/\s+@\s+|[<>=~!;[]/u)[0]
        ?.trim();
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

function extractPoetryDependencyName(
  line: string,
  currentSection: string,
): string | null {
  if (!isPoetryDependencySection(currentSection)) {
    return null;
  }

  const dependencyMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/u);
  const dependencyName = dependencyMatch?.[1];
  const dependencySpec = dependencyMatch?.[2]?.trim();
  if (
    !dependencyName ||
    dependencyName.toLowerCase() === "python" ||
    isPythonDirectReference(dependencySpec) ||
    isPoetryTableReference(dependencySpec)
  ) {
    return null;
  }

  return isPlainPackageName(dependencyName) ? dependencyName : null;
}

function isPoetryTableReference(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const trimmedValue = value.trim();
  return (
    trimmedValue.startsWith("{") ||
    /^\{[^}]*\b(?:path|git|url|file)\s*=/iu.test(trimmedValue) ||
    /^(?:git\+|hg\+|ssh:\/\/|git:\/\/|https?:\/\/|file:)/iu.test(trimmedValue)
  );
}

function isPoetryDependencySection(currentSection: string): boolean {
  return (
    currentSection === "tool.poetry.dependencies" ||
    currentSection === "tool.poetry.dev-dependencies" ||
    /^tool\.poetry\.group\.[^.]+\.dependencies$/u.test(currentSection)
  );
}

function isPyProjectDependencyListStart(
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

function isPlainRequirementLine(line: string): boolean {
  return (
    line.length > 0 &&
    !line.startsWith("#") &&
    !line.startsWith("-") &&
    !line.includes("://") &&
    !/^(git\+|https?:|file:|ssh\+|\.\/|\.\.\/|\/)/iu.test(line)
  );
}

function isPythonDirectReference(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return /\s+@\s+(?:[\\/]|\.\.?[\\/]|[a-z]:[\\/]|file:|path:|git\+|hg\+|ssh:\/\/|git:\/\/|https?:\/\/)/iu.test(
    value,
  );
}

function isPlainPackageName(value: string | undefined): value is string {
  return Boolean(value && /^[a-z0-9_.-]+$/iu.test(value));
}

function enrichMultiEcosystemDependencySignals(
  fileName: string,
  content: string | null,
  matchedSignals: DemandSignalSet,
): void {
  if (
    fileName === "package.json" ||
    fileName === "requirements.txt" ||
    fileName === "pyproject.toml"
  ) {
    return;
  }

  if (!content) {
    return;
  }

  switch (fileName) {
    case "Cargo.toml":
      addPackageDependencySignals(
        matchedSignals,
        "cargo",
        extractCargoDependencyNames(content),
      );
      return;
    case "go.mod":
      addPackageDependencySignals(
        matchedSignals,
        "go",
        extractGoModuleDependencyNames(content),
      );
      return;
    case "pom.xml":
    case "build.gradle":
    case "build.gradle.kts":
      addPackageDependencySignals(
        matchedSignals,
        "maven",
        extractMavenDependencyNames(content),
      );
      return;
    case "Gemfile":
      addPackageDependencySignals(
        matchedSignals,
        "gem",
        extractGemDependencyNames(content),
      );
      return;
    case "composer.json":
      addPackageDependencySignals(
        matchedSignals,
        "packagist",
        extractComposerDependencyNames(content),
      );
      return;
    case "Package.swift":
      addPackageDependencySignals(
        matchedSignals,
        "swift",
        extractSwiftDependencyNames(content),
      );
      return;
    default:
      if (fileName.endsWith(".csproj")) {
        addPackageDependencySignals(
          matchedSignals,
          "nuget",
          extractNugetDependencyNames(content),
        );
      }
  }
}

function addPackageDependencySignals(
  matchedSignals: DemandSignalSet,
  registryKind: string,
  dependencyNames: string[],
): void {
  const ignoredPrefixes = registryKind === "npm" ? ["@types/"] : [];
  const normalizedNames = dependencyNames
    .map((dependencyName) => dependencyName.trim())
    .filter((dependencyName) => dependencyName.length > 0)
    .filter(
      (dependencyName) =>
        !ignoredPrefixes.some((prefix) => dependencyName.startsWith(prefix)),
    )
    .slice(0, 50)
    .map((dependencyName) => `${registryKind}:${dependencyName}`);

  addSignals(matchedSignals.tooling, normalizedNames);
}

function enrichGenericTextSignals(
  content: string | null,
  matchedSignals: DemandSignalSet,
): void {
  if (!content) {
    return;
  }

  const normalizedContent = content.slice(0, 250_000).toLowerCase();
  applyTechnologySignatures(matchedSignals, {
    text: normalizedContent,
  });
  addGenericTextSignals(matchedSignals, normalizedContent);
}

function shouldReadTextForTechnologySignals(fileName: string): boolean {
  return (
    /\.(json|ya?ml|toml|xml|gradle|csproj|props|targets|md|mdx|txt|ini|cfg|conf)$/iu.test(
      fileName,
    ) ||
    [
      "Dockerfile",
      "Gemfile",
      "Package.swift",
      "Podfile",
      "Makefile",
      "CMakeLists.txt",
      "go.mod",
      "requirements.txt",
      "project.godot",
    ].includes(fileName)
  );
}

function enrichActorJsonSignals(
  content: string | null,
  matchedSignals: DemandSignalSet,
): void {
  const actorJson = parseJsonOrNull<ActorJsonShape>(content);

  if (!actorJson) {
    return;
  }

  const actorTextSignals = [
    actorJson.title ?? "",
    actorJson.description ?? "",
    ...(actorJson.categories ?? []).map((value) => value.replaceAll("_", " ")),
  ]
    .join(" ")
    .toLowerCase();

  if (actorJson.dockerfile) {
    addSignals(matchedSignals.concerns, ["containerization"]);
    addSignals(matchedSignals.tooling, ["docker"]);
  }

  if (actorJson.webServerSchema) {
    addSignals(matchedSignals.concerns, ["backend"]);
  }

  applyTechnologySignatures(matchedSignals, {
    text: actorTextSignals,
  });
  addGenericTextSignals(matchedSignals, actorTextSignals);
}

function shouldReadFileContent(fileName: string, filePath: string): boolean {
  return (
    fileName === "package.json" ||
    fileName === "requirements.txt" ||
    fileName === "pyproject.toml" ||
    isActorJsonFile(fileName, filePath) ||
    shouldReadTextForTechnologySignals(fileName) ||
    shouldReadTextForDependencySignals(fileName)
  );
}

function shouldReadTextForDependencySignals(fileName: string): boolean {
  return (
    [
      "Cargo.toml",
      "go.mod",
      "pom.xml",
      "build.gradle",
      "build.gradle.kts",
      "Gemfile",
      "composer.json",
      "Package.swift",
    ].includes(fileName) || fileName.endsWith(".csproj")
  );
}

function parseJsonOrNull<T>(content: string | null): T | null {
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function addGenericTextSignals(
  matchedSignals: DemandSignalSet,
  normalizedText: string,
): void {
  if (containsAnyText(normalizedText, WEBHOOK_TEXT_MARKERS)) {
    addSignals(matchedSignals.concerns, ["webhook", "integration"]);
    addSignals(matchedSignals.tooling, ["webhook"]);
  }

  if (containsAnyText(normalizedText, REPLAY_TEXT_MARKERS)) {
    addSignals(matchedSignals.concerns, ["replay"]);
  }

  if (containsAnyText(normalizedText, MOCKING_TEXT_MARKERS)) {
    addSignals(matchedSignals.concerns, ["mocking"]);
  }

  if (containsAnyText(normalizedText, LOGGING_TEXT_MARKERS)) {
    addSignals(matchedSignals.concerns, ["logging", "debugging"]);
  }

  if (containsAnyText(normalizedText, ["integration"])) {
    addSignals(matchedSignals.concerns, ["integration"]);
  }
}

function extractCargoDependencyNames(content: string): string[] {
  const dependencyNames: string[] = [];
  let currentSection = "";

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+#.*$/u, "").trim();
    const sectionMatch = /^\[([^\]]+)\]$/u.exec(line);
    if (sectionMatch?.[1]) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    if (!isCargoDependencySection(currentSection)) {
      continue;
    }

    const dependencyMatch = /^([A-Za-z0-9_-]+)\s*=/u.exec(line);
    if (dependencyMatch?.[1]) {
      dependencyNames.push(dependencyMatch[1]);
    }
  }

  return uniqueStrings(
    dependencyNames.filter((dependencyName) => dependencyName !== "package"),
  );
}

function isCargoDependencySection(sectionName: string): boolean {
  return (
    sectionName === "dependencies" ||
    sectionName === "dev-dependencies" ||
    sectionName === "build-dependencies" ||
    /^target\..+\.(?:dependencies|dev-dependencies|build-dependencies)$/u.test(
      sectionName,
    )
  );
}

function extractGoModuleDependencyNames(content: string): string[] {
  const dependencies: string[] = [];
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.replace(/\/\/.*$/u, "").trim();
    const requireMatch =
      /^(?:require\s+)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+)\s+v?\d/iu.exec(line);
    if (requireMatch?.[1]) {
      dependencies.push(requireMatch[1]);
    }
  }
  return uniqueStrings(dependencies);
}

function extractMavenDependencyNames(content: string): string[] {
  const dependencies: string[] = [];
  for (const dependencyMatch of content.matchAll(
    /<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<\/dependency>/giu,
  )) {
    const groupId = dependencyMatch[1]?.trim();
    const artifactId = dependencyMatch[2]?.trim();
    if (groupId && artifactId) {
      dependencies.push(`${groupId}:${artifactId}`);
    }
  }

  for (const gradleMatch of content.matchAll(
    /(?:implementation|api|compileOnly|runtimeOnly|testImplementation)\s*\(?["']([^:"']+):([^:"']+):[^"']+["']/giu,
  )) {
    const groupId = gradleMatch[1]?.trim();
    const artifactId = gradleMatch[2]?.trim();
    if (groupId && artifactId) {
      dependencies.push(`${groupId}:${artifactId}`);
    }
  }

  return uniqueStrings(dependencies);
}

function extractNugetDependencyNames(content: string): string[] {
  return uniqueStrings(
    [
      ...content.matchAll(
        /<PackageReference\s+[^>]*Include=["']([^"']+)["']/giu,
      ),
    ]
      .map((match) => match[1]?.trim())
      .filter((value): value is string => Boolean(value)),
  );
}

function extractGemDependencyNames(content: string): string[] {
  return uniqueStrings(
    [...content.matchAll(/^\s*gem\s+["']([^"']+)["']/gimu)]
      .map((match) => match[1]?.trim())
      .filter((value): value is string => Boolean(value)),
  );
}

function extractComposerDependencyNames(content: string): string[] {
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

function extractSwiftDependencyNames(content: string): string[] {
  return uniqueStrings(
    [...content.matchAll(/\.package\s*\([^)]*url:\s*["']([^"']+)["']/giu)]
      .map((match) => match[1]?.trim())
      .filter((value): value is string => Boolean(value)),
  );
}

function containsAnyText(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
