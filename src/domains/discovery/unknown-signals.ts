import { basename } from "node:path";

import {
  DEFAULT_IGNORED_DIRECTORY_NAMES,
  listFilesRecursiveWithTelemetry,
  readTextFileOrNull,
  toPosixPath,
  toRelativePosixPath,
  writeJsonFile,
} from "../../files.js";

/**
 * Describes an unknown-but-interesting workspace signal captured for review.
 */
export interface UnknownSignalEntry {
  id: string;
  path: string;
  fileName: string;
  category:
    | "mcp-manifest"
    | "host-rule-folder"
    | "unfamiliar-package-dependency"
    | "plugin-manifest";
  confidence: "high" | "medium" | "low";
  evidence: string[];
  ambiguityNotes: string[];
  suggestedNextAction:
    | "add-signature"
    | "add-source-mapping"
    | "ignore"
    | "quarantine"
    | "needs-research";
}

/**
 * Describes the unknown-signal report persisted by discovery.
 */
export interface UnknownSignalReport {
  schemaVersion: number;
  generatedAt: string;
  scanRoot: string;
  summary: {
    scannedFiles: number;
    signalCount: number;
    scanTruncated?: boolean;
    truncationReason?: string;
    scannedBytes?: number;
    byCategory: Record<UnknownSignalEntry["category"], number>;
  };
  signals: UnknownSignalEntry[];
}

const KNOWN_PACKAGE_PREFIXES = [
  "@types/",
  "@vitejs/",
  "eslint",
  "typescript",
  "vite",
  "react",
  "next",
  "vue",
  "svelte",
  "astro",
  "express",
  "fastify",
  "hono",
  "zod",
  "vitest",
  "jest",
  "playwright",
  "prettier",
] as const;

const HOST_RULE_FOLDER_PATTERNS = [
  /(^|[/\\])\.cursor[/\\](rules|agents|commands|skills)[/\\]/iu,
  /(^|[/\\])\.claude[/\\](agents|commands|skills|hooks)[/\\]/iu,
  /(^|[/\\])\.opencode[/\\](agents|skills|commands|plugins)[/\\]/iu,
  /(^|[/\\])\.codex[/\\]/iu,
  /(^|[/\\])\.agents[/\\](skills|plugins)[/\\]/iu,
] as const;

const MCP_MANIFEST_NAMES = new Set([".mcp.json", "mcp.json"]);
const PLUGIN_MANIFEST_NAMES = new Set([
  "plugin.json",
  "marketplace.json",
  "plugins.json",
]);
const PACKAGE_MANIFEST_NAMES = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
]);
const UNKNOWN_SIGNAL_HOST_CONFIG_DIRECTORIES = new Set([
  ".claude",
  ".cursor",
  ".opencode",
  ".pi",
  ".zed",
]);
const UNKNOWN_SIGNAL_IGNORED_DIRECTORY_NAMES = new Set(
  [...DEFAULT_IGNORED_DIRECTORY_NAMES].filter(
    (directoryName) =>
      !UNKNOWN_SIGNAL_HOST_CONFIG_DIRECTORIES.has(directoryName),
  ),
);

/**
 * Writes a structured unknown-signal backlog report for workspace evolution.
 */
export async function writeUnknownSignalReport(
  scanRoot: string,
  outputPath: string,
): Promise<UnknownSignalReport> {
  const report = await buildUnknownSignalReport(scanRoot);
  await writeJsonFile(outputPath, report);
  return report;
}

/**
 * Builds structured unknown workspace signals from interesting but ambiguous evidence.
 */
export async function buildUnknownSignalReport(
  scanRoot: string,
): Promise<UnknownSignalReport> {
  const scanResult = await listFilesRecursiveWithTelemetry(
    scanRoot,
    UNKNOWN_SIGNAL_IGNORED_DIRECTORY_NAMES,
  );
  const signals: UnknownSignalEntry[] = [];

  for (const filePath of scanResult.files) {
    const fileName = basename(filePath);
    const relativePath = toRelativePosixPath(scanRoot, filePath);
    const normalizedPath = relativePath.toLowerCase();

    if (MCP_MANIFEST_NAMES.has(fileName)) {
      signals.push(
        createSignal(relativePath, fileName, "mcp-manifest", "high", [
          "workspace contains an MCP manifest",
        ]),
      );
    }

    if (HOST_RULE_FOLDER_PATTERNS.some((pattern) => pattern.test(filePath))) {
      signals.push(
        createSignal(relativePath, fileName, "host-rule-folder", "medium", [
          "workspace contains host-specific agent/rule assets",
        ]),
      );
    }

    if (
      PLUGIN_MANIFEST_NAMES.has(fileName) ||
      normalizedPath.includes("/.codex-plugin/") ||
      normalizedPath.includes("/.cursor-plugin/")
    ) {
      signals.push(
        createSignal(relativePath, fileName, "plugin-manifest", "medium", [
          "workspace contains a plugin manifest or plugin bundle marker",
        ]),
      );
    }

    if (PACKAGE_MANIFEST_NAMES.has(fileName)) {
      for (const dependencyName of await collectUnfamiliarDependencyNames(
        fileName,
        filePath,
      )) {
        signals.push(
          createSignal(
            `${relativePath}:${dependencyName}`,
            fileName,
            "unfamiliar-package-dependency",
            "low",
            [`dependency may need a technology signature: ${dependencyName}`],
            relativePath,
          ),
        );
      }
    }
  }

  const sortedSignals = dedupeSignals(signals).sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoot: toPosixPath(scanRoot),
    summary: {
      scannedFiles: scanResult.files.length,
      signalCount: sortedSignals.length,
      scanTruncated: scanResult.telemetry.truncated,
      truncationReason: scanResult.telemetry.truncationReason,
      scannedBytes: scanResult.telemetry.visitedBytes,
      byCategory: countByCategory(sortedSignals),
    },
    signals: sortedSignals,
  };
}

function createSignal(
  idPath: string,
  fileName: string,
  category: UnknownSignalEntry["category"],
  confidence: UnknownSignalEntry["confidence"],
  evidence: string[],
  displayPath: string = idPath,
): UnknownSignalEntry {
  const suggestedNextAction = suggestedActionForCategory(category);

  return {
    id: `${category}:${idPath}`,
    path: displayPath,
    fileName,
    category,
    confidence,
    evidence,
    ambiguityNotes: ambiguityNotesForCategory(category),
    suggestedNextAction,
  };
}

function suggestedActionForCategory(
  category: UnknownSignalEntry["category"],
): UnknownSignalEntry["suggestedNextAction"] {
  switch (category) {
    case "mcp-manifest":
    case "plugin-manifest":
      return "needs-research";
    case "host-rule-folder":
      return "add-source-mapping";
    case "unfamiliar-package-dependency":
      return "add-signature";
  }
}

function ambiguityNotesForCategory(
  category: UnknownSignalEntry["category"],
): string[] {
  switch (category) {
    case "mcp-manifest":
      return [
        "manifest presence is strong evidence, but server auth and trust still require review",
      ];
    case "host-rule-folder":
      return [
        "host folders may contain local/private instructions and should not be mirrored automatically",
      ];
    case "plugin-manifest":
      return [
        "plugin manifests may be executable or hook-bearing and need provenance review",
      ];
    case "unfamiliar-package-dependency":
      return [
        "single dependency names are weak evidence until supported by imports, config, or docs",
      ];
  }
}

async function collectUnfamiliarDependencyNames(
  fileName: string,
  filePath: string,
): Promise<string[]> {
  if (fileName !== "package.json") {
    return [];
  }

  const content = await readTextFileOrNull(filePath);
  if (!content) {
    return [];
  }

  const packageJson = parsePackageJson(content);
  if (!packageJson) {
    return [];
  }

  return [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ]
    .filter((dependencyName) => !isKnownDependencyName(dependencyName))
    .sort((left, right) => left.localeCompare(right));
}

function parsePackageJson(content: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
  } catch {
    return null;
  }
}

function isKnownDependencyName(dependencyName: string): boolean {
  return KNOWN_PACKAGE_PREFIXES.some((prefix) =>
    dependencyName.toLowerCase().startsWith(prefix),
  );
}

function dedupeSignals(signals: UnknownSignalEntry[]): UnknownSignalEntry[] {
  return [...new Map(signals.map((signal) => [signal.id, signal])).values()];
}

function countByCategory(
  signals: UnknownSignalEntry[],
): Record<UnknownSignalEntry["category"], number> {
  return {
    "mcp-manifest": signals.filter(
      (signal) => signal.category === "mcp-manifest",
    ).length,
    "host-rule-folder": signals.filter(
      (signal) => signal.category === "host-rule-folder",
    ).length,
    "unfamiliar-package-dependency": signals.filter(
      (signal) => signal.category === "unfamiliar-package-dependency",
    ).length,
    "plugin-manifest": signals.filter(
      (signal) => signal.category === "plugin-manifest",
    ).length,
  };
}

/**
 * Exposes pure helpers for focused unknown-signal branch coverage.
 */
export const unknownSignalInternals = {
  KNOWN_PACKAGE_PREFIXES,
  createSignal,
  dedupeSignals,
  collectUnfamiliarDependencyNames,
  parsePackageJson,
  countByCategory,
};
