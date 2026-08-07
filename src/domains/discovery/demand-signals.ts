/**
 * demand-signals — demand signal collection for the discovery scan (#435).
 *
 * After the #435 split, this module keeps only the collection surface:
 * the inspectable-file/evidence-strength re-exports, the per-file collector
 * that orchestrates static + detector + manifest enrichment passes, and the
 * extension/name-only static signal pass. File-kind classification lives in
 * demand-file-classification.ts, manifest parsing in
 * demand-dependency-extractors.ts, and content enrichment in
 * demand-manifest-enrichment.ts.
 */

import { readTextFileOrNull } from "../../files.js";
import type { DemandSignalSet } from "../../types.js";
import { collectDetectorSignals } from "./detectors.js";
import { addSignals, createEmptySignalSet } from "./signals.js";
import {
  isActorJsonFile,
  getDemandEvidenceStrength,
  isRequirementsFile,
  isDockerfileName,
  isComposeFileName,
  isTestFrameworkConfigFileName,
} from "./demand-file-classification.js";
import {
  enrichPackageJsonSignals,
  enrichRequirementsSignals,
  enrichPyProjectSignals,
  enrichPubspecSignals,
  enrichMultiEcosystemDependencySignals,
  enrichActorJsonSignals,
  enrichGenericTextSignals,
  shouldReadFileContent,
  shouldReadTextForTechnologySignals,
  getTechnologySignalTextContent,
  addMobilePathSignals,
} from "./demand-manifest-enrichment.js";

// Re-exported public surface (unchanged) for demand-profile and tests.
export {
  shouldInspectFile,
  isActorJsonFile,
  getDemandEvidenceStrength,
} from "./demand-file-classification.js";

/**
 * Collects demand signals for file from the provided inputs.
 */
export async function collectDemandSignalsForFile(
  fileName: string,
  filePath: string,
): Promise<DemandSignalSet> {
  const evidenceStrength = getDemandEvidenceStrength(fileName, filePath);
  const matchedSignals = collectStaticSignals(fileName, filePath);

  if (evidenceStrength === null) {
    return matchedSignals;
  }

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

  if (
    evidenceStrength !== "weak" &&
    shouldReadTextForTechnologySignals(fileName)
  ) {
    enrichGenericTextSignals(
      getTechnologySignalTextContent(fileName, fileContent),
      matchedSignals,
    );
  }

  return matchedSignals;
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

  if (fileName === "meson.build") {
    addSignals(matchedSignals.languages, ["c", "cpp"]);
    addSignals(matchedSignals.tooling, ["meson"]);
  }

  if (fileName === "conanfile.txt" || fileName === "conanfile.py") {
    addSignals(matchedSignals.languages, ["c", "cpp"]);
    addSignals(matchedSignals.packageManagers, ["conan"]);
    addSignals(matchedSignals.tooling, ["conan"]);
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

  if (isTestFrameworkConfigFileName(fileName)) {
    if (fileName.startsWith("playwright.config.")) {
      addSignals(matchedSignals.concerns, ["e2e-testing", "testing"]);
      addSignals(matchedSignals.tooling, ["playwright"]);
    } else {
      addSignals(matchedSignals.concerns, ["testing"]);
      addSignals(matchedSignals.tooling, [
        fileName.startsWith("vitest") ? "vitest" : "jest",
      ]);
    }
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
