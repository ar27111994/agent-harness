/**
 * demand-file-classification — file-kind predicates and demand evidence
 * strength for the discovery scan (#435).
 *
 * Extracted from demand-signals.ts so signal definitions stay separate from
 * the file-classification surface used by the collector and the pipeline.
 */

import type { DemandEvidenceStrength } from "../../types.js";
import { isDetectorInspectableFile } from "./detectors.js";

const ACTOR_JSON_PATH_PATTERN = /[\\/]\.actor[\\/]actor\.json$/iu;
const IGNORED_DEMAND_EVIDENCE_PATTERNS = [
  /(^|[/\\])\.github[/\\]ISSUE_TEMPLATE([/\\]|$)/iu,
  /(^|[/\\])pull_request_template\.(md|txt)$/iu,
  /(^|[/\\])(?:changelog|contributing)\.(md|mdx|txt)$/iu,
  /(^|[/\\])(?:roadmap|implementation-plan|future-improvements)\.(md|mdx|txt)$/iu,
];
const WEAK_DEMAND_TEXT_FILE_PATTERN = /\.(md|mdx|rst|adoc|txt)$/iu;

/**
 * Known environment-template file names whose content is inspected for
 * technology signals.
 */
export const ENV_TEMPLATE_FILE_NAMES = new Set([
  ".env.example",
  ".env.sample",
  ".env.template",
  "env.example",
  "env.sample",
  "env.template",
]);

/**
 * Manifest file names inspected directly for demand evidence during a scan.
 */
export const INSPECTABLE_FILE_NAMES = new Set([
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
  "meson.build",
  "conanfile.txt",
  "conanfile.py",
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
  ...ENV_TEMPLATE_FILE_NAMES,
]);

/**
 * Provides should inspect file for the lifecycle pipeline.
 */
export function shouldInspectFile(fileName: string, filePath: string): boolean {
  if (getDemandEvidenceStrength(fileName, filePath) === null) {
    return false;
  }

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

  if (isTestFrameworkConfigFileName(fileName)) {
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
 * Returns whether the provided value matches actor json file.
 */
export function isActorJsonFile(fileName: string, filePath: string): boolean {
  return (
    /^actor\.json$/iu.test(fileName) || ACTOR_JSON_PATH_PATTERN.test(filePath)
  );
}

/**
 * Classifies demand evidence strength for the lifecycle pipeline.
 */
export function getDemandEvidenceStrength(
  fileName: string,
  filePath: string,
): DemandEvidenceStrength | null {
  const normalizedPath = filePath.replace(/\\/gu, "/");

  if (
    IGNORED_DEMAND_EVIDENCE_PATTERNS.some((pattern) =>
      pattern.test(normalizedPath),
    )
  ) {
    return null;
  }

  if (
    isActorJsonFile(fileName, filePath) ||
    fileName === "input_schema.json" ||
    isRequirementsFile(fileName, filePath) ||
    isLockfileName(fileName) ||
    isLanguageSourceFile(fileName) ||
    isNugetManifestFile(fileName) ||
    fileName.endsWith(".sln") ||
    fileName.endsWith(".tf") ||
    fileName.endsWith(".tfvars") ||
    isDockerfileName(fileName) ||
    isComposeFileName(fileName) ||
    isTestFrameworkConfigFileName(fileName) ||
    /openapi|swagger/iu.test(fileName) ||
    INSPECTABLE_FILE_NAMES.has(fileName)
  ) {
    return "strong";
  }

  if (WEAK_DEMAND_TEXT_FILE_PATTERN.test(fileName)) {
    return "weak";
  }

  if (isDetectorInspectableFile(fileName, filePath)) {
    return "medium";
  }

  return null;
}

/**
 * Returns whether a file is a pip requirements/constraints file (including
 * suffixed variants and entries under a requirements/ directory).
 */
export function isRequirementsFile(
  fileName: string,
  filePath: string,
): boolean {
  const normalizedPath = filePath.replace(/\\/gu, "/");
  return (
    /^requirements(?:[-_.][A-Za-z0-9_.-]+)?\.txt$/iu.test(fileName) ||
    /^constraints(?:[-_.][A-Za-z0-9_.-]+)?\.txt$/iu.test(fileName) ||
    /(^|\/)requirements\/[^/]+\.txt$/iu.test(normalizedPath)
  );
}

/**
 * Returns whether a file name is a Dockerfile (or suffixed/variant form) or
 * the Containerfile alternative.
 */
export function isDockerfileName(fileName: string): boolean {
  return (
    /^Dockerfile(?:[.-][A-Za-z0-9_.-]+)?$/u.test(fileName) ||
    fileName === "Containerfile"
  );
}

/**
 * Detects test-framework config filenames (playwright/vitest/jest).
 *
 * Single canonical check shared by demand-scoring and evidence-strength
 * classification (#436); a framework config file is a strong demand signal
 * for its ecosystem.
 */
export function isTestFrameworkConfigFileName(fileName: string): boolean {
  return (
    fileName.startsWith("playwright.config.") ||
    fileName.startsWith("vitest.config.") ||
    fileName.startsWith("jest.config.")
  );
}

/**
 * Returns whether a file name is a docker-compose or plain compose YAML.
 */
export function isComposeFileName(fileName: string): boolean {
  return /^(?:docker-)?compose(?:[.-][A-Za-z0-9_.-]+)?\.ya?ml$/iu.test(
    fileName,
  );
}

/**
 * Returns whether a file name is a package-manager lock file.
 */
export function isLockfileName(fileName: string): boolean {
  return [
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
  ].includes(fileName);
}

/**
 * Returns whether a file name is a .NET project manifest (csproj or shared
 * package management file).
 */
export function isNugetManifestFile(fileName: string): boolean {
  return (
    fileName.endsWith(".csproj") ||
    fileName === "Directory.Packages.props" ||
    fileName === "packages.config"
  );
}

/**
 * Returns whether a file name is a language source file carrying strong
 * demand evidence for its ecosystem.
 */
export function isLanguageSourceFile(fileName: string): boolean {
  return /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|rs|go|erl|hrl|ex|exs|jl|php|rb|swift|m|mm|kt|kts|java|cs)$/iu.test(
    fileName,
  );
}
