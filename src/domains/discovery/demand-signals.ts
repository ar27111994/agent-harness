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
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  engines?: {
    node?: string;
  };
  keywords?: string[];
  name?: string;
  packageManager?: string;
}

interface ActorJsonShape {
  categories?: string[];
  description?: string;
  dockerfile?: string;
  title?: string;
  webServerSchema?: string;
}

const YAML_DEPENDENCY_SECTION_NAMES = new Set([
  "dependencies",
  "dev_dependencies",
  "dependency_overrides",
  "test_dependencies",
]);

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
  "bun.lockb",
  "tsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "constraints.txt",
  "pubspec.yaml",
  "Podfile",
  "AndroidManifest.xml",
  "Info.plist",
  "project.pbxproj",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "libs.versions.toml",
  "Gemfile",
  "composer.json",
  "Package.swift",
  "mix.exs",
  "rebar.config",
  "Project.toml",
  "Manifest.toml",
  "CMakeLists.txt",
  "Makefile",
  "package.xml",
  "Dockerfile",
  "Containerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  "Directory.Packages.props",
  "packages.config",
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
    fileName.endsWith(".sln") ||
    fileName.endsWith(".tf") ||
    fileName.endsWith(".tfvars") ||
    isLanguageSourceFile(fileName)
  ) {
    return true;
  }

  if (isRequirementsFile(fileName, filePath)) {
    return true;
  }

  if (isDockerfileName(fileName) || isComposeFileName(fileName)) {
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

  if (isRequirementsFile(fileName, filePath)) {
    enrichRequirementsSignals(fileContent, matchedSignals);
  }

  if (fileName === "pyproject.toml") {
    enrichPyProjectSignals(fileContent, matchedSignals);
  }

  if (fileName === "pubspec.yaml") {
    enrichPubspecSignals(fileContent, matchedSignals);
  }

  enrichMultiEcosystemDependencySignals(fileName, fileContent, matchedSignals);

  if (isActorJsonFile(fileName, filePath)) {
    enrichActorJsonSignals(fileContent, matchedSignals);
  }

  if (shouldReadTextForTechnologySignals(fileName)) {
    enrichGenericTextSignals(
      getTechnologySignalTextContent(fileName, fileContent),
      matchedSignals,
    );
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

function isRequirementsFile(fileName: string, filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/gu, "/");
  return (
    /^requirements(?:[-_.][A-Za-z0-9_.-]+)?\.txt$/iu.test(fileName) ||
    /^constraints(?:[-_.][A-Za-z0-9_.-]+)?\.txt$/iu.test(fileName) ||
    /(^|\/)requirements\/[^/]+\.txt$/iu.test(normalizedPath)
  );
}

function isDockerfileName(fileName: string): boolean {
  return (
    /^Dockerfile(?:[.-][A-Za-z0-9_.-]+)?$/u.test(fileName) ||
    fileName === "Containerfile"
  );
}

function isComposeFileName(fileName: string): boolean {
  return /^(?:docker-)?compose(?:[.-][A-Za-z0-9_.-]+)?\.ya?ml$/iu.test(
    fileName,
  );
}

function isLockfileName(fileName: string): boolean {
  return [
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
  ].includes(fileName);
}

function isNugetManifestFile(fileName: string): boolean {
  return (
    fileName.endsWith(".csproj") ||
    fileName === "Directory.Packages.props" ||
    fileName === "packages.config"
  );
}

function isLanguageSourceFile(fileName: string): boolean {
  return /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|rs|go|erl|hrl|ex|exs|jl|php|rb|swift|m|mm|kt|kts|java|cs)$/iu.test(
    fileName,
  );
}

function collectStaticSignals(
  fileName: string,
  filePath: string,
): DemandSignalSet {
  const matchedSignals = createEmptySignalSet();

  addMobilePathSignals(filePath, matchedSignals);

  if (/\.swift$/iu.test(fileName)) {
    addSignals(matchedSignals.languages, ["swift"]);
  }

  if (/\.(m|mm)$/iu.test(fileName)) {
    addSignals(matchedSignals.languages, ["objective-c"]);
  }

  if (/\.(kt|kts)$/iu.test(fileName)) {
    addSignals(matchedSignals.languages, ["kotlin"]);
  }

  if (/\.java$/iu.test(fileName)) {
    addSignals(matchedSignals.languages, ["java"]);
  }

  if (/\.cs$/iu.test(fileName)) {
    addSignals(matchedSignals.languages, ["csharp"]);
  }

  if (/\.rs$/iu.test(fileName)) {
    addSignals(matchedSignals.languages, ["rust"]);
  }

  if (/\.go$/iu.test(fileName)) {
    addSignals(matchedSignals.languages, ["go"]);
  }

  if (/\.(c|h)$/iu.test(fileName)) {
    addSignals(matchedSignals.languages, ["c"]);
  }

  if (/\.(cc|cpp|cxx|hh|hpp|hxx)$/iu.test(fileName)) {
    addSignals(matchedSignals.languages, ["cpp"]);
  }

  if (/\.(erl|hrl)$/iu.test(fileName)) {
    addSignals(matchedSignals.languages, ["erlang"]);
  }

  if (/\.(ex|exs)$/iu.test(fileName)) {
    addSignals(matchedSignals.languages, ["elixir"]);
  }

  if (/\.jl$/iu.test(fileName)) {
    addSignals(matchedSignals.languages, ["julia"]);
  }

  if (/\.php$/iu.test(fileName)) {
    addSignals(matchedSignals.languages, ["php"]);
  }

  if (/\.rb$/iu.test(fileName)) {
    addSignals(matchedSignals.languages, ["ruby"]);
  }

  if (fileName === "package.json") {
    addSignals(matchedSignals.languages, ["javascript"]);
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

  if (fileName === "bun.lockb") {
    addSignals(matchedSignals.packageManagers, ["bun"]);
  }

  if (fileName === "tsconfig.json") {
    addSignals(matchedSignals.languages, ["typescript"]);
    addSignals(matchedSignals.tooling, ["typescript"]);
  }

  if (fileName === "pyproject.toml" || isRequirementsFile(fileName, filePath)) {
    addSignals(matchedSignals.languages, ["python"]);
    addSignals(matchedSignals.packageManagers, ["pip"]);
  }

  if (fileName === "pubspec.yaml") {
    addSignals(matchedSignals.languages, ["dart"]);
    addSignals(matchedSignals.packageManagers, ["pub"]);
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

  if (fileName === "build.gradle.kts") {
    addSignals(matchedSignals.languages, ["kotlin"]);
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

  if (fileName === "mix.exs") {
    addSignals(matchedSignals.languages, ["elixir"]);
    addSignals(matchedSignals.packageManagers, ["hex"]);
  }

  if (fileName === "rebar.config") {
    addSignals(matchedSignals.languages, ["erlang"]);
    addSignals(matchedSignals.packageManagers, ["rebar"]);
  }

  if (fileName === "Project.toml" || fileName === "Manifest.toml") {
    addSignals(matchedSignals.languages, ["julia"]);
    addSignals(matchedSignals.packageManagers, ["julia-pkg"]);
  }

  if (fileName === "CMakeLists.txt") {
    addSignals(matchedSignals.languages, ["c", "cpp"]);
    addSignals(matchedSignals.tooling, ["cmake"]);
  }

  if (fileName === "Makefile") {
    addSignals(matchedSignals.tooling, ["make"]);
  }

  if (fileName === "Podfile") {
    addSignals(matchedSignals.packageManagers, ["cocoapods"]);
    addSignals(matchedSignals.concerns, ["mobile", "ios"]);
    addSignals(matchedSignals.tooling, ["cocoapods", "ios"]);
  }

  if (fileName === "AndroidManifest.xml") {
    addSignals(matchedSignals.concerns, ["mobile", "android"]);
    addSignals(matchedSignals.tooling, ["android"]);
  }

  if (fileName === "Info.plist" || fileName === "project.pbxproj") {
    addSignals(matchedSignals.concerns, ["mobile", "ios"]);
    addSignals(matchedSignals.tooling, ["ios", "xcode"]);
  }

  if (fileName === "deno.json") {
    addSignals(matchedSignals.languages, ["typescript"]);
    addSignals(matchedSignals.tooling, ["deno"]);
  }

  if (isDockerfileName(fileName) || isComposeFileName(fileName)) {
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
    ...Object.keys(packageJson.optionalDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
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

  addPackageManagerSignal(packageJson.packageManager, matchedSignals);

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

function addPackageManagerSignal(
  packageManager: string | undefined,
  matchedSignals: DemandSignalSet,
): void {
  const packageManagerName = packageManager?.split("@")[0]?.trim();
  if (
    packageManagerName === "npm" ||
    packageManagerName === "pnpm" ||
    packageManagerName === "yarn" ||
    packageManagerName === "bun"
  ) {
    addSignals(matchedSignals.packageManagers, [packageManagerName]);
  }
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

function enrichPubspecSignals(
  content: string | null,
  matchedSignals: DemandSignalSet,
): void {
  if (!content) {
    return;
  }

  const dependencyNames = extractPubspecDependencyNames(content);

  applyTechnologySignatures(matchedSignals, {
    dependencyNames,
    ecosystem: "pub",
  });
  addPackageDependencySignals(matchedSignals, "pub", dependencyNames);
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
    case "Cargo.toml": {
      const dependencyNames = extractCargoDependencyNames(content);
      applyTechnologySignatures(matchedSignals, {
        dependencyNames,
        ecosystem: "cargo",
      });
      addPackageDependencySignals(matchedSignals, "cargo", dependencyNames);
      return;
    }
    case "go.mod": {
      const dependencyNames = extractGoModuleDependencyNames(content);
      applyTechnologySignatures(matchedSignals, {
        dependencyNames,
        ecosystem: "go",
      });
      addPackageDependencySignals(matchedSignals, "go", dependencyNames);
      return;
    }
    case "pom.xml": {
      const dependencyNames = extractMavenDependencyNames(content);
      applyTechnologySignatures(matchedSignals, {
        dependencyNames,
        ecosystem: "maven",
      });
      addPackageDependencySignals(matchedSignals, "maven", dependencyNames);
      return;
    }
    case "build.gradle":
    case "build.gradle.kts": {
      const dependencyNames = extractMavenDependencyNames(content);
      applyTechnologySignatures(matchedSignals, {
        dependencyNames,
        ecosystem: "maven",
      });
      addPackageDependencySignals(matchedSignals, "maven", dependencyNames);
      enrichGradleSignals(content, fileName, matchedSignals);
      return;
    }
    case "Gemfile": {
      const dependencyNames = extractGemDependencyNames(content);
      applyTechnologySignatures(matchedSignals, {
        dependencyNames,
        ecosystem: "gem",
      });
      addPackageDependencySignals(matchedSignals, "gem", dependencyNames);
      return;
    }
    case "composer.json": {
      const dependencyNames = extractComposerDependencyNames(content);
      applyTechnologySignatures(matchedSignals, {
        dependencyNames,
        ecosystem: "packagist",
      });
      addPackageDependencySignals(matchedSignals, "packagist", dependencyNames);
      return;
    }
    case "Package.swift": {
      const dependencyNames = extractSwiftDependencyNames(content);
      applyTechnologySignatures(matchedSignals, {
        dependencyNames,
        ecosystem: "swift",
      });
      addPackageDependencySignals(matchedSignals, "swift", dependencyNames);
      return;
    }
    default:
      if (isNugetManifestFile(fileName)) {
        const dependencyNames = extractNugetDependencyNames(content);
        applyTechnologySignatures(matchedSignals, {
          dependencyNames,
          ecosystem: "nuget",
        });
        addPackageDependencySignals(matchedSignals, "nuget", dependencyNames);
        enrichDotNetProjectSignals(content, matchedSignals);
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
  if (isLockfileName(fileName)) {
    return false;
  }

  if (isDockerfileName(fileName)) {
    return true;
  }

  return (
    /\.(json|ya?ml|toml|xml|gradle|csproj|props|targets|md|mdx|txt|ini|cfg|conf)$/iu.test(
      fileName,
    ) ||
    [
      "Gemfile",
      "Package.swift",
      "Podfile",
      "Makefile",
      "CMakeLists.txt",
      "mix.exs",
      "rebar.config",
      "Project.toml",
      "Manifest.toml",
      "go.mod",
      "project.godot",
    ].includes(fileName)
  );
}

function getTechnologySignalTextContent(
  fileName: string,
  content: string | null,
): string | null {
  if (!content) {
    return null;
  }

  if (!isDockerfileName(fileName)) {
    return content;
  }

  return content
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
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
    isRequirementsFile(fileName, filePath) ||
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
    ].includes(fileName) || isNugetManifestFile(fileName)
  );
}

function addMobilePathSignals(
  filePath: string,
  matchedSignals: DemandSignalSet,
): void {
  const normalizedPath = filePath.replace(/\\/gu, "/");

  if (/(^|\/)(ios|iphone|ipad)(\/|$)/iu.test(normalizedPath)) {
    addSignals(matchedSignals.concerns, ["mobile", "ios"]);
    addSignals(matchedSignals.tooling, ["ios"]);
  }

  if (/(^|\/)android(\/|$)/iu.test(normalizedPath)) {
    addSignals(matchedSignals.concerns, ["mobile", "android"]);
    addSignals(matchedSignals.tooling, ["android"]);
  }

  if (/(^|\/)maui(\/|$)/iu.test(normalizedPath)) {
    addSignals(matchedSignals.concerns, ["mobile"]);
    addSignals(matchedSignals.frameworks, ["maui"]);
    addSignals(matchedSignals.tooling, ["dotnet-maui"]);
  }

  if (/(^|\/)xamarin(\/|$)/iu.test(normalizedPath)) {
    addSignals(matchedSignals.concerns, ["mobile"]);
    addSignals(matchedSignals.frameworks, ["xamarin"]);
    addSignals(matchedSignals.tooling, ["xamarin"]);
  }
}

function extractPubspecDependencyNames(content: string): string[] {
  const dependencyNames: string[] = [];
  let currentSection = "";
  let dependencyIndent: number | null = null;

  for (const rawLine of content.split(/\r?\n/u)) {
    const sectionMatch = /^(\S[^:#]*):\s*$/u.exec(rawLine);
    if (sectionMatch?.[1] && !rawLine.startsWith(" ")) {
      currentSection = sectionMatch[1].trim();
      dependencyIndent = null;
      continue;
    }

    if (!YAML_DEPENDENCY_SECTION_NAMES.has(currentSection)) {
      continue;
    }

    const dependencyMatch = /^(\s*)([A-Za-z0-9_]+):/u.exec(rawLine);
    if (!dependencyMatch?.[1] || !dependencyMatch[2]) {
      continue;
    }

    const indentLength = dependencyMatch[1].length;
    dependencyIndent ??= indentLength;
    if (indentLength === dependencyIndent) {
      dependencyNames.push(dependencyMatch[2]);
    }
  }

  return uniqueStrings(dependencyNames);
}

function enrichDotNetProjectSignals(
  content: string,
  matchedSignals: DemandSignalSet,
): void {
  const normalizedContent = content.toLowerCase();

  if (
    /<targetframeworks?>[^<]*(net[0-9.]+-ios|net[0-9.]+-maccatalyst)/iu.test(
      content,
    )
  ) {
    addSignals(matchedSignals.concerns, ["mobile", "ios"]);
    addSignals(matchedSignals.tooling, ["ios"]);
  }

  if (/<targetframeworks?>[^<]*net[0-9.]+-android/iu.test(content)) {
    addSignals(matchedSignals.concerns, ["mobile", "android"]);
    addSignals(matchedSignals.tooling, ["android"]);
  }

  if (
    normalizedContent.includes("<usemaui>true</usemaui>") ||
    normalizedContent.includes("microsoft.maui")
  ) {
    addSignals(matchedSignals.frameworks, ["maui"]);
    addSignals(matchedSignals.concerns, ["mobile"]);
    addSignals(matchedSignals.tooling, ["dotnet-maui"]);
  }

  if (normalizedContent.includes("xamarin.forms")) {
    addSignals(matchedSignals.frameworks, ["xamarin"]);
    addSignals(matchedSignals.concerns, ["mobile"]);
    addSignals(matchedSignals.tooling, ["xamarin"]);
  }
}

function enrichGradleSignals(
  content: string,
  fileName: string,
  matchedSignals: DemandSignalSet,
): void {
  const normalizedContent = content.toLowerCase();
  if (
    fileName === "build.gradle.kts" ||
    normalizedContent.includes("org.jetbrains.kotlin.android") ||
    normalizedContent.includes('kotlin("android")') ||
    normalizedContent.includes("kotlin('android')")
  ) {
    addSignals(matchedSignals.languages, ["kotlin"]);
  }

  if (
    normalizedContent.includes("com.android.application") ||
    normalizedContent.includes("com.android.library") ||
    normalizedContent.includes("org.jetbrains.kotlin.android")
  ) {
    addSignals(matchedSignals.concerns, ["mobile", "android"]);
    addSignals(matchedSignals.tooling, ["android-gradle"]);
  }
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
    sectionName === "workspace.dependencies" ||
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
    /(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|androidTestImplementation|kapt|annotationProcessor|classpath)\s*\(?["']([^:"']+):([^:"']+)(?::[^"']+)?["']/giu,
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
        /<(?:PackageReference|PackageVersion)\s+[^>]*Include=["']([^"']+)["']/giu,
      ),
      ...content.matchAll(/<package\s+[^>]*id=["']([^"']+)["']/giu),
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
