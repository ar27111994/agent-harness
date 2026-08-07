/**
 * demand-manifest-enrichment — manifest and text-content demand enrichment
 * for the discovery scan (#435).
 *
 * Extracted from demand-signals.ts: every enrich* function that reads a
 * manifest file's content (package.json, requirements, pyproject, pubspec,
 * Cargo, go.mod, Maven/Gradle, Gemfile, composer, Swift, NuGet, actor.json)
 * plus the content-read decision helpers. Signal definitions, file
 * classification, and the static (extension/name-only) signal pass stay in
 * demand-signals.ts.
 */

import type { DemandSignalSet } from "../../types.js";
import { addSignals } from "./signals.js";
import { applyTechnologySignatures } from "./technology-signatures.js";
import {
  containsAnyText,
  extractCargoDependencyNames,
  extractComposerDependencyNames,
  extractGemDependencyNames,
  extractGoModuleDependencyNames,
  extractMavenDependencyNames,
  extractNugetDependencyNames,
  extractPubspecDependencyNames,
  extractPyProjectDependencyNames,
  extractSwiftDependencyNames,
  isPlainPackageName,
  isPlainRequirementLine,
  isPythonDirectReference,
  parseJsonOrNull,
} from "./demand-dependency-extractors.js";
import {
  ENV_TEMPLATE_FILE_NAMES,
  isActorJsonFile,
  isDockerfileName,
  isNugetManifestFile,
  isRequirementsFile,
} from "./demand-file-classification.js";

interface PackageJsonShape {
  author?: string | { name?: string };
  bin?: string | Record<string, string>;
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

/**
 * Maximum number of dependency names extracted from a single manifest file
 * for use as tooling demand signals.  Capping at 50 prevents very large
 * lock-files from flooding the signal set with low-signal transitive deps.
 */
const MAX_DEPENDENCY_SIGNALS_PER_FILE = 50;

/**
 * Maximum number of characters read from a text file before lowercasing and
 * applying technology signatures.  250 000 chars covers virtually all real
 * source files while bounding memory usage for pathological inputs such as
 * minified bundles or auto-generated assets.
 */
const TEXT_SIGNAL_READ_LIMIT = 250_000;

const LOGGING_TEXT_MARKERS = ["logger", "logging", "debugger", "debug"];
const MOCKING_TEXT_MARKERS = ["mock", "mocking"];
const REPLAY_TEXT_MARKERS = ["replay", "forwarding", "forwarder"];
const WEBHOOK_TEXT_MARKERS = ["webhook", "webhooks"];

export function enrichPackageJsonSignals(
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

  // Detect Node CLI tools: package exposes executable bin entries AND
  // declares a Node.js engine requirement → emit "node-cli" framework signal
  // so scoring can reward packages that fill a CLI-tooling demand slot.
  if (packageJson.engines?.node && hasNodeCliBinField(packageJson.bin)) {
    addSignals(matchedSignals.frameworks, ["node-cli"]);
  }

  applyTechnologySignatures(matchedSignals, {
    dependencyNames: [...dependencyNames],
    ecosystem: "npm",
    text: packageTextSignals,
  });
  addGenericTextSignals(matchedSignals, packageTextSignals);
  addPackageDependencySignals(matchedSignals, "npm", [...dependencyNames]);
}

function hasNodeCliBinField(
  bin: string | Record<string, string> | undefined,
): boolean {
  if (!bin) {
    return false;
  }
  if (typeof bin === "string") {
    return bin.trim().length > 0;
  }
  // Object form: require at least one entry whose value is a non-empty string.
  // An object with only empty-string values is a malformed manifest and should
  // not generate a node-cli signal.
  return Object.values(bin).some(
    (path) => typeof path === "string" && path.trim().length > 0,
  );
}

function addPackageManagerSignal(
  packageManager: string | undefined,
  matchedSignals: DemandSignalSet,
): void {
  const packageManagerName = packageManager
    ? packageManager.split("@")[0]!.trim()
    : undefined;
  if (
    packageManagerName === "npm" ||
    packageManagerName === "pnpm" ||
    packageManagerName === "yarn" ||
    packageManagerName === "bun"
  ) {
    addSignals(matchedSignals.packageManagers, [packageManagerName]);
  }
}

export function enrichRequirementsSignals(
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
    .map((line) => line.split(/\s+@\s+|[<>=~!;[]/u)[0]!.trim())
    .filter(isPlainPackageName);

  applyTechnologySignatures(matchedSignals, {
    dependencyNames,
    ecosystem: "pypi",
  });
  addPackageDependencySignals(matchedSignals, "pypi", dependencyNames);
}

export function enrichPyProjectSignals(
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

export function enrichPubspecSignals(
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

export function enrichMultiEcosystemDependencySignals(
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

export function addPackageDependencySignals(
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
    .slice(0, MAX_DEPENDENCY_SIGNALS_PER_FILE)
    .map((dependencyName) => `${registryKind}:${dependencyName}`);

  addSignals(matchedSignals.tooling, normalizedNames);
}

export function enrichGenericTextSignals(
  content: string | null,
  matchedSignals: DemandSignalSet,
): void {
  if (!content) {
    return;
  }

  const normalizedContent = content
    .slice(0, TEXT_SIGNAL_READ_LIMIT)
    .toLowerCase();
  applyTechnologySignatures(matchedSignals, {
    text: normalizedContent,
  });
  addGenericTextSignals(matchedSignals, normalizedContent);
}

export function shouldReadTextForTechnologySignals(fileName: string): boolean {
  if (isLockfileName(fileName)) {
    return false;
  }

  if (ENV_TEMPLATE_FILE_NAMES.has(fileName)) {
    return true;
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
      "meson.build",
      "conanfile.txt",
      "conanfile.py",
      "mix.exs",
      "rebar.config",
      "Project.toml",
      "Manifest.toml",
      "go.mod",
      "project.godot",
    ].includes(fileName)
  );
}

export function getTechnologySignalTextContent(
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

export function enrichActorJsonSignals(
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

export function shouldReadFileContent(
  fileName: string,
  filePath: string,
): boolean {
  return (
    fileName === "package.json" ||
    isRequirementsFile(fileName, filePath) ||
    fileName === "pyproject.toml" ||
    isActorJsonFile(fileName, filePath) ||
    shouldReadTextForTechnologySignals(fileName) ||
    shouldReadTextForDependencySignals(fileName)
  );
}

export function shouldReadTextForDependencySignals(fileName: string): boolean {
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

export function addMobilePathSignals(
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

export function enrichDotNetProjectSignals(
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

export function enrichGradleSignals(
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

export function addGenericTextSignals(
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

export function isLockfileName(fileName: string): boolean {
  return [
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
  ].includes(fileName);
}
