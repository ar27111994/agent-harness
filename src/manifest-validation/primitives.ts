import type {
  AssetKind,
  AssetPrerequisiteKind,
  AuthorityTier,
  BuiltInHostTarget,
  CompatibilityMode,
  HostTarget,
  SourceKind,
} from "../types.js";

export type JsonRecord = Record<string, unknown>;

export const AUTHORITY_TIERS: AuthorityTier[] = [
  "trusted-local",
  "official-first-party",
  "official-marketplace",
  "official-compatible",
  "trusted-community",
  "unverified-community",
];

export const SOURCE_KINDS: SourceKind[] = [
  "repo",
  "docs",
  "marketplace",
  "registry",
  "package-registry",
  "local-manifest",
  "local-directory",
];

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
];

export const ASSET_PREREQUISITE_KINDS: AssetPrerequisiteKind[] = [
  "env",
  "host-login",
  "oauth",
  "manual",
];

export const HOST_TARGETS: BuiltInHostTarget[] = [
  "copilot-vscode",
  "opencode",
  "shared",
  "cursor",
  "zed",
  "claude-code",
  "pi",
];

export const COMPATIBILITY_MODES: CompatibilityMode[] = [
  "native",
  "adaptable",
  "partial",
  "reference-only",
  "incompatible",
];

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export const CONTEXT_COST_CLASSES = [
  "tiny",
  "small",
  "medium",
  "large",
] as const;
export const MIRROR_STATUSES = [
  "approved",
  "approved-with-warning",
  "quarantined",
  "metadata-only",
  "reference-only",
] as const;
export const UPSTREAM_TYPES = [
  "repo",
  "package",
  "marketplace",
  "docs",
  "local",
] as const;
export const WIRE_PLAN_HOSTS = [
  ...HOST_TARGETS,
  "vscode-user",
  "opencode-project",
] as const;

const HOST_TARGET_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export function assertHostTarget(value: unknown, context: string): HostTarget {
  const host = assertString(value, context);
  if (!HOST_TARGET_PATTERN.test(host)) {
    fail(context, "expected a lowercase host identifier");
  }

  return host;
}

export function assertHostTargetArray(value: unknown, context: string): void {
  assertArray(value, context).forEach((entry, index) => {
    assertHostTarget(entry, `${context}[${index}]`);
  });
}

export function assertAssetKindArray(value: unknown, context: string): void {
  assertArray(value, context).forEach((entry, index) => {
    assertLiteral(entry, ASSET_KINDS, `${context}[${index}]`);
  });
}

export function assertStringArray(value: unknown, context: string): string[] {
  return assertArray(value, context).map((entry, index) =>
    assertString(entry, `${context}[${index}]`),
  );
}

export function assertStringArrayRecord(value: unknown, context: string): void {
  const record = assertRecord(value, context);
  Object.entries(record).forEach(([key, entryValue]) => {
    assertStringArray(entryValue, `${context}.${key}`);
  });
}

export function assertArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(context, "expected an array");
  }

  return value;
}

export function assertRecord(value: unknown, context: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(context, "expected an object");
  }

  return value as JsonRecord;
}

export function assertString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    fail(context, "expected a string");
  }

  return value;
}

export function assertNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    fail(context, "expected a number");
  }

  return value;
}

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

export function assertBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    fail(context, "expected a boolean");
  }

  return value;
}

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

export function fail(context: string, message: string): never {
  throw new Error(`Invalid manifest at ${context}: ${message}`);
}
