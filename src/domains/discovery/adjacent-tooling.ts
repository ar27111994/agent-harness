/**
 * Static adjacent tooling matrix by stack signal (#295).
 *
 * Maps demand-profile stack/language signals to high-confidence adjacent package
 * names that a workspace should probably be using but may not have declared yet.
 * These are fetched via registry metadata when the matching signal is present,
 * and tagged as `discoveryMethod: "registry-adjacent-search"` in the catalog.
 *
 * Only include packages with near-universal adoption in their ecosystem.
 * Controversial or niche choices do not belong here.
 */

import type { PackageRegistryKind } from "./package-candidates.js";

/** Adjacent npm packages keyed by demand signal keyword. */
export const ADJACENT_NPM_BY_SIGNAL: Record<string, string[]> = {
  typescript: [
    "eslint",
    "prettier",
    "@typescript-eslint/parser",
    "@typescript-eslint/eslint-plugin",
    "vitest",
    "tsx",
    "tsup",
  ],
  react: [
    "@testing-library/react",
    "@testing-library/jest-dom",
    "@storybook/react",
  ],
  nodejs: ["nodemon", "dotenv", "zod", "pino"],
  node: ["nodemon", "dotenv", "zod", "pino"],
  security: ["snyk", "npm-audit-ci", "socket"],
  testing: ["vitest", "@vitest/coverage-v8"],
  jest: ["@jest/globals", "ts-jest"],
  mcp: [
    "@modelcontextprotocol/server-filesystem",
    "@modelcontextprotocol/server-github",
    "@modelcontextprotocol/server-postgres",
    "@modelcontextprotocol/sdk",
    "fastmcp",
  ],
};

/** Adjacent PyPI packages keyed by demand signal keyword. */
export const ADJACENT_PYPI_BY_SIGNAL: Record<string, string[]> = {
  python: ["ruff", "black", "pytest", "mypy", "uv", "pre-commit"],
  fastapi: ["httpx", "pytest-asyncio", "pydantic-settings"],
  flask: ["pytest", "flask-testing", "black"],
  django: ["pytest-django", "black", "ruff"],
  ml: ["numpy", "pandas", "scikit-learn"],
  torch: ["torchvision", "lightning"],
  security: ["bandit", "safety"],
};

/** Adjacent crates.io crates keyed by demand signal keyword. */
export const ADJACENT_CARGO_BY_SIGNAL: Record<string, string[]> = {
  rust: ["serde", "tokio", "clap", "anyhow", "tracing"],
  async: ["tokio", "async-std"],
  cli: ["clap", "indicatif", "console"],
  web: ["axum", "reqwest", "hyper"],
  testing: ["mockall", "assert_matches"],
};

/** Adjacent NuGet packages keyed by demand signal keyword. */
export const ADJACENT_NUGET_BY_SIGNAL: Record<string, string[]> = {
  csharp: ["Newtonsoft.Json", "Serilog", "xunit", "Moq", "FluentAssertions"],
  dotnet: ["Newtonsoft.Json", "Serilog", "xunit", "Moq", "FluentAssertions"],
  aspnet: ["Swashbuckle.AspNetCore", "AutoMapper", "MediatR"],
  testing: ["xunit", "Moq", "FluentAssertions", "NUnit"],
};

/** Adjacent Maven packages keyed by demand signal keyword (groupId:artifactId). */
export const ADJACENT_MAVEN_BY_SIGNAL: Record<string, string[]> = {
  java: ["org.slf4j:slf4j-api", "com.google.guava:guava", "junit:junit"],
  kotlin: [
    "org.jetbrains.kotlinx:kotlinx-coroutines-core",
    "io.kotest:kotest-runner-junit5",
  ],
  spring: [
    "org.springframework.boot:spring-boot-starter-test",
    "org.mockito:mockito-core",
  ],
  testing: ["org.junit.jupiter:junit-jupiter", "org.mockito:mockito-core"],
};

/** Adjacent Packagist packages keyed by demand signal keyword. */
export const ADJACENT_PACKAGIST_BY_SIGNAL: Record<string, string[]> = {
  php: [
    "phpunit/phpunit",
    "squizlabs/php_codesniffer",
    "phpstan/phpstan",
    "vimeo/psalm",
  ],
  laravel: [
    "laravel/pint",
    "barryvdh/laravel-debugbar",
    "spatie/laravel-permission",
  ],
  symfony: ["phpunit/phpunit", "phpstan/phpstan"],
};

/** Adjacent RubyGems packages keyed by demand signal keyword. */
export const ADJACENT_GEM_BY_SIGNAL: Record<string, string[]> = {
  ruby: ["rubocop", "rspec", "bundler-audit", "brakeman"],
  rails: ["rubocop-rails", "factory_bot_rails", "shoulda-matchers"],
  testing: ["rspec", "minitest", "capybara"],
};

/**
 * Returns static adjacent package names for a given registry kind and a set
 * of demand signal tokens.
 *
 * Tokens are matched case-insensitively against the signal map keys.
 */
export function getAdjacentPackagesForSignals(
  registryKind: PackageRegistryKind,
  signalTokens: Iterable<string>,
): string[] {
  const mapByRegistry: Record<string, Record<string, string[]>> = {
    npm: ADJACENT_NPM_BY_SIGNAL,
    pypi: ADJACENT_PYPI_BY_SIGNAL,
    cargo: ADJACENT_CARGO_BY_SIGNAL,
    nuget: ADJACENT_NUGET_BY_SIGNAL,
    maven: ADJACENT_MAVEN_BY_SIGNAL,
    packagist: ADJACENT_PACKAGIST_BY_SIGNAL,
    gem: ADJACENT_GEM_BY_SIGNAL,
  };

  const map = mapByRegistry[registryKind];
  if (!map) return [];

  const adjacent = new Set<string>();
  for (const token of signalTokens) {
    const key = token.toLowerCase();
    for (const pkg of map[key] ?? []) {
      adjacent.add(pkg);
    }
  }
  return [...adjacent];
}
