import type {
  AssetKind,
  AssetPrerequisiteKind,
  AuthorityTier,
  BuiltInHostTarget,
  CompatibilityMode,
  HostTarget,
  SourceKind,
} from "../types.js";

/**
 * Defines the supported json record values.
 */
export type JsonRecord = Record<string, unknown>;

/**
 * Defines authority tiers shared by the lifecycle pipeline.
 */
export const AUTHORITY_TIERS: AuthorityTier[] = [
  "trusted-local",
  "official-first-party",
  "official-marketplace",
  "official-compatible",
  "trusted-community",
  "unverified-community",
];

/**
 * Defines source kinds shared by the lifecycle pipeline.
 */
export const SOURCE_KINDS: SourceKind[] = [
  "repo",
  "docs",
  "marketplace",
  "registry",
  "package-registry",
  "ard-registry",
  "local-manifest",
  "local-directory",
];

/**
 * Defines asset kinds shared by the lifecycle pipeline.
 */
export const ASSET_KINDS: AssetKind[] = [
  "skill",
  "plugin",
  "mcp-server",
  "agent",
  "instruction",
  "workflow",
  "hook",
  "extension",
  "prompt-pack",
  "reference-pack",
  "payable-api",
  "acp-agent",
];

/**
 * Defines asset prerequisite kinds shared by the lifecycle pipeline.
 */
export const ASSET_PREREQUISITE_KINDS: AssetPrerequisiteKind[] = [
  "env",
  "host-login",
  "oauth",
  "manual",
];

/**
 * Defines host targets shared by the lifecycle pipeline.
 */
export const HOST_TARGETS: BuiltInHostTarget[] = [
  "copilot-vscode",
  "opencode",
  "shared",
  "cursor",
  "zed",
  "claude-code",
  "pi",
  "codex",
];

/**
 * Defines compatibility modes shared by the lifecycle pipeline.
 */
export const COMPATIBILITY_MODES: CompatibilityMode[] = [
  "native",
  "adaptable",
  "partial",
  "reference-only",
  "incompatible",
];

/**
 * Defines risk levels shared by the lifecycle pipeline.
 */
export const RISK_LEVELS = ["low", "medium", "high"] as const;
/**
 * Defines context cost classes shared by the lifecycle pipeline.
 */
export const CONTEXT_COST_CLASSES = [
  "tiny",
  "small",
  "medium",
  "large",
] as const;
/**
 * Defines mirror statuses shared by the lifecycle pipeline.
 */
export const MIRROR_STATUSES = [
  "approved",
  "approved-with-warning",
  "quarantined",
  "metadata-only",
  "reference-only",
] as const;
/**
 * Defines upstream types shared by the lifecycle pipeline.
 */
export const UPSTREAM_TYPES = [
  "repo",
  "package",
  "marketplace",
  "docs",
  "local",
] as const;
/**
 * Defines wire plan hosts shared by the lifecycle pipeline.
 */
export const WIRE_PLAN_HOSTS = [
  ...HOST_TARGETS,
  "vscode-user",
  "opencode-project",
] as const;

const HOST_TARGET_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

/**
 * Validates unknown data as host target.
 */
export function assertHostTarget(value: unknown, context: string): HostTarget {
  const host = assertString(value, context);
  if (!HOST_TARGET_PATTERN.test(host)) {
    fail(context, "expected a lowercase host identifier");
  }

  return host;
}

/**
 * Validates unknown data as host target array.
 */
export function assertHostTargetArray(value: unknown, context: string): void {
  assertArray(value, context).forEach((entry, index) => {
    assertHostTarget(entry, `${context}[${index}]`);
  });
}

/**
 * Validates unknown data as asset kind array.
 */
export function assertAssetKindArray(value: unknown, context: string): void {
  assertArray(value, context).forEach((entry, index) => {
    assertLiteral(entry, ASSET_KINDS, `${context}[${index}]`);
  });
}

/**
 * Validates unknown data as string array.
 */
export function assertStringArray(value: unknown, context: string): string[] {
  return assertArray(value, context).map((entry, index) =>
    assertString(entry, `${context}[${index}]`),
  );
}

/**
 * Validates unknown data as string array record.
 */
export function assertStringArrayRecord(value: unknown, context: string): void {
  const record = assertRecord(value, context);
  Object.entries(record).forEach(([key, entryValue]) => {
    assertStringArray(entryValue, `${context}.${key}`);
  });
}

/**
 * Validates unknown data as array.
 */
export function assertArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(context, "expected an array");
  }

  return value;
}

/**
 * Validates unknown data as record.
 */
export function assertRecord(value: unknown, context: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(context, "expected an object");
  }

  return value as JsonRecord;
}

/**
 * Validates unknown data as string.
 */
export function assertString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    fail(context, "expected a string");
  }

  return value;
}

/**
 * Validates unknown data as number.
 */
export function assertNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    fail(context, "expected a number");
  }

  return value;
}

/**
 * Validates unknown data as maybe string.
 */
export function assertMaybeString(
  value: unknown,
  context: string,
  required: boolean,
): void {
  if (value === undefined) {
    if (required) {
      fail(context, "expected a string");
    }
    return;
  }

  assertString(value, context);
}

/**
 * Validates unknown data as maybe number.
 */
export function assertMaybeNumber(
  value: unknown,
  context: string,
  required: boolean,
): void {
  if (value === undefined) {
    if (required) {
      fail(context, "expected a number");
    }
    return;
  }

  assertNumber(value, context);
}

/**
 * Validates unknown data as maybe array.
 */
export function assertMaybeArray(
  value: unknown,
  context: string,
  required: boolean,
): unknown[] | undefined {
  if (value === undefined) {
    if (required) {
      fail(context, "expected an array");
    }
    return undefined;
  }

  return assertArray(value, context);
}

/**
 * Validates unknown data as maybe record.
 */
export function assertMaybeRecord(
  value: unknown,
  context: string,
  required: boolean,
): JsonRecord | undefined {
  if (value === undefined) {
    if (required) {
      fail(context, "expected an object");
    }
    return undefined;
  }

  return assertRecord(value, context);
}

/**
 * Validates unknown data as maybe string array.
 */
export function assertMaybeStringArray(
  value: unknown,
  context: string,
  required: boolean,
): string[] | undefined {
  if (value === undefined) {
    if (required) {
      fail(context, "expected an array");
    }
    return undefined;
  }

  return assertStringArray(value, context);
}

/**
 * Validates unknown data as boolean.
 */
export function assertBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    fail(context, "expected a boolean");
  }

  return value;
}

/**
 * Validates unknown data as literal.
 */
export function assertLiteral<T extends string>(
  value: unknown,
  allowed: readonly T[],
  context: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(context, `expected one of ${allowed.join(", ")}`);
  }

  return value as T;
}

/**
 * Provides fail for the lifecycle pipeline.
 */
export function fail(context: string, message: string): never {
  throw new Error(`Invalid manifest at ${context}: ${message}`);
}
