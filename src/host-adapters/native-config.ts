import { resolve } from "node:path";

import {
  pathEntryExists,
  readJsonFileOrNull,
  removePath,
  toPosixPath,
  writeJsonFile,
  writeTextFile,
} from "../files.js";
import type {
  AssetHostNativeConfigMap,
  AssetHostNativeFilePayload,
  NativeConfigOperation,
} from "../types.js";

type JsonObject = Record<string, unknown>;
type NativeConfigHost =
  | "opencode"
  | "cursor"
  | "zed"
  | "claude-code"
  | "pi"
  | "codex";

/**
 * Collects structured native-config file payloads for one host.
 */
export function collectHostNativeFilePayloads(
  assets: Array<{ hostNativeConfig?: AssetHostNativeConfigMap }>,
  host: NativeConfigHost,
): AssetHostNativeFilePayload[] {
  return assets.flatMap((asset) => asset.hostNativeConfig?.[host]?.files ?? []);
}

/**
 * Applies validated native-config payloads for one host and returns reversible operations.
 */
export async function applyHostNativeFilePayloads(options: {
  workspaceRoot: string;
  host: NativeConfigHost;
  payloads: AssetHostNativeFilePayload[];
}): Promise<NativeConfigOperation[]> {
  const operations: NativeConfigOperation[] = [];

  try {
    for (const payload of options.payloads) {
      const relativePath = normalizeRelativePayloadPath(payload.path);
      assertAllowedHostNativePath(options.host, relativePath, payload);
      const absolutePath = resolveWorkspacePath(
        options.workspaceRoot,
        relativePath,
      );

      if (payload.format === "json") {
        const content = assertJsonObject(
          payload.content,
          `${options.host}:${relativePath}`,
        );

        if (payload.merge) {
          const previousValue = await readJsonFileOrNull<unknown>(absolutePath);
          const previousContent =
            previousValue === null
              ? null
              : assertJsonObject(previousValue, absolutePath);
          await mergeJsonFile(absolutePath, content);
          operations.push({
            path: relativePath,
            format: "json",
            mode: "merge",
            content,
            previousContent,
          });
          continue;
        }

        if (await pathEntryExists(absolutePath)) {
          throw new Error(
            `Refusing to overwrite existing ${options.host} ` +
              `host-native JSON file: ${toPosixPath(absolutePath)}`,
          );
        }

        await writeJsonFile(absolutePath, content);
        operations.push({
          path: relativePath,
          format: "json",
          mode: "write",
          content,
        });
        continue;
      }

      if (await pathEntryExists(absolutePath)) {
        throw new Error(
          `Refusing to overwrite existing ${options.host} ` +
            `host-native text file: ${toPosixPath(absolutePath)}`,
        );
      }

      await writeTextFile(absolutePath, payload.content);
      operations.push({
        path: relativePath,
        format: "text",
        mode: "write",
        content: payload.content,
      });
    }
  } catch (error) {
    await rollbackNativeConfigOperations({
      workspaceRoot: options.workspaceRoot,
      host: options.host,
      operations,
    });
    throw error;
  }

  return operations;
}

/**
 * Reverts previously applied native-config operations.
 */
export async function revertNativeConfigOperations(options: {
  workspaceRoot: string;
  host: NativeConfigHost;
  operations: NativeConfigOperation[] | undefined;
}): Promise<void> {
  await rollbackNativeConfigOperations(options);
}

/**
 * Builds a relative workspace path that OpenCode can consume from opencode.json.
 */
export function toWorkspaceRelativeConfigPath(
  workspaceRoot: string,
  absolutePath: string,
): string {
  const relativePath = toPosixPath(absolutePath).replace(
    `${toPosixPath(workspaceRoot).replace(/\/+$/u, "")}/`,
    "",
  );
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

async function rollbackNativeConfigOperations(options: {
  workspaceRoot: string;
  host: NativeConfigHost;
  operations: NativeConfigOperation[] | undefined;
}): Promise<void> {
  if (!options.operations || options.operations.length === 0) {
    return;
  }

  for (const operation of [...options.operations].reverse()) {
    const absolutePath = resolveValidatedOperationPath(
      options.workspaceRoot,
      options.host,
      operation,
    );

    if (operation.mode === "write") {
      await removePath(absolutePath);
      continue;
    }

    if (operation.previousContent !== undefined) {
      if (operation.previousContent === null) {
        await removePath(absolutePath);
      } else {
        await writeJsonFile(absolutePath, operation.previousContent);
      }
      continue;
    }

    const currentValue = await readJsonFileOrNull<unknown>(absolutePath);
    const currentObject = asJsonObject(currentValue);
    const patch = asJsonObject(operation.content);
    if (!currentObject || !patch) {
      continue;
    }

    const nextValue = removeJsonPatch(currentObject, patch);
    await writeOrRemoveJsonFile(absolutePath, nextValue);
  }
}

function resolveValidatedOperationPath(
  workspaceRoot: string,
  host: NativeConfigHost,
  operation: NativeConfigOperation,
): string {
  const relativePath = normalizeRelativePayloadPath(operation.path);
  assertAllowedHostNativePath(
    host,
    relativePath,
    buildValidationPayload(relativePath, operation),
  );
  return resolveWorkspacePath(workspaceRoot, relativePath);
}

function buildValidationPayload(
  relativePath: string,
  operation: NativeConfigOperation,
): AssetHostNativeFilePayload {
  if (operation.format === "text") {
    return {
      path: relativePath,
      format: "text",
      content: typeof operation.content === "string" ? operation.content : "",
    };
  }

  return {
    path: relativePath,
    format: "json",
    merge: operation.mode === "merge",
    content: isJsonObject(operation.content) ? operation.content : {},
  };
}

function resolveWorkspacePath(
  workspaceRoot: string,
  relativePath: string,
): string {
  const absoluteWorkspaceRoot = resolve(workspaceRoot);
  const absolutePath = resolve(
    absoluteWorkspaceRoot,
    ...relativePath.split("/"),
  );
  const normalizedWorkspaceRoot = toPosixPath(absoluteWorkspaceRoot).replace(
    /\/+$/u,
    "",
  );
  const normalizedPath = toPosixPath(absolutePath);

  if (
    normalizedPath === normalizedWorkspaceRoot ||
    !normalizedPath.startsWith(`${normalizedWorkspaceRoot}/`)
  ) {
    throw new Error(
      `Resolved host-native path escapes workspace root: ${relativePath}`,
    );
  }

  return absolutePath;
}

function normalizeRelativePayloadPath(payloadPath: string): string {
  const normalizedPath = payloadPath.trim().replace(/\\+/gu, "/");
  if (normalizedPath.length === 0) {
    throw new Error("Host-native payload path must not be empty.");
  }
  if (
    normalizedPath.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalizedPath) ||
    normalizedPath.endsWith("/")
  ) {
    throw new Error(
      `Host-native payload path must be workspace-relative: ${payloadPath}`,
    );
  }

  const segments = normalizedPath.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new Error(
      `Host-native payload path must not contain empty, '.' , or '..' segments: ${payloadPath}`,
    );
  }

  return segments.join("/");
}

function assertAllowedHostNativePath(
  host: NativeConfigHost,
  relativePath: string,
  payload: AssetHostNativeFilePayload,
): void {
  const mergeRequired = payload.format === "json" && payload.merge === true;

  switch (host) {
    case "opencode":
      if (
        (relativePath === "opencode.json" &&
          payload.format === "json" &&
          mergeRequired) ||
        relativePath.startsWith(".opencode/tools/")
      ) {
        return;
      }
      break;
    case "cursor":
      if (
        ([".cursor/mcp.json", ".cursor/hooks.json"].includes(relativePath) &&
          payload.format === "json" &&
          mergeRequired) ||
        relativePath.startsWith(".cursor/hooks/") ||
        relativePath.startsWith(".cursor/agents/")
      ) {
        return;
      }
      break;
    case "zed":
      if (
        relativePath === ".zed/settings.json" &&
        payload.format === "json" &&
        mergeRequired
      ) {
        return;
      }
      break;
    case "claude-code":
      if (
        [
          ".mcp.json",
          ".claude/settings.json",
          ".claude/settings.local.json",
        ].includes(relativePath) &&
        payload.format === "json" &&
        mergeRequired
      ) {
        return;
      }
      break;
    case "pi":
      if (
        relativePath.startsWith(".pi/extensions/") ||
        relativePath.startsWith(".pi/packages/")
      ) {
        return;
      }
      break;
    case "codex":
      if (
        (relativePath === ".codex/config.toml" && payload.format === "text") ||
        (relativePath === ".codex/hooks.json" &&
          payload.format === "json" &&
          mergeRequired) ||
        relativePath.startsWith(".codex/rules/") ||
        relativePath.startsWith(".agents/plugins/") ||
        relativePath.startsWith(".agents/skills/")
      ) {
        return;
      }
      break;
  }

  throw new Error(
    `Unsupported ${host} host-native payload target: ${relativePath}. Use only documented host-native surfaces for this adapter.`,
  );
}

async function mergeJsonFile(
  filePath: string,
  patch: JsonObject,
): Promise<void> {
  const currentValue = await readJsonFileOrNull<unknown>(filePath);
  const currentObject =
    currentValue === null ? {} : assertJsonObject(currentValue, filePath);
  await writeJsonFile(filePath, mergeJsonObjects(currentObject, patch));
}

function mergeJsonObjects(base: JsonObject, patch: JsonObject): JsonObject {
  const merged: JsonObject = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    const existingValue = merged[key];

    if (Array.isArray(value)) {
      const patchValues = toUnknownArray(value);
      const existingValues = toUnknownArray(existingValue);
      merged[key] = dedupeJsonArray([...existingValues, ...patchValues]);
      continue;
    }

    if (isJsonObject(value) && isJsonObject(existingValue)) {
      merged[key] = mergeJsonObjects(existingValue, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

function removeJsonPatch(base: JsonObject, patch: JsonObject): JsonObject {
  const nextValue: JsonObject = { ...base };

  for (const [key, patchValue] of Object.entries(patch)) {
    const currentValue = nextValue[key];

    if (Array.isArray(patchValue) && Array.isArray(currentValue)) {
      const patchKeys = new Set(patchValue.map(stableJsonKey));
      const remainingEntries = currentValue.filter(
        (entry) => !patchKeys.has(stableJsonKey(entry)),
      );
      if (remainingEntries.length === 0) {
        delete nextValue[key];
      } else {
        nextValue[key] = remainingEntries;
      }
      continue;
    }

    if (isJsonObject(patchValue) && isJsonObject(currentValue)) {
      const nestedValue = removeJsonPatch(currentValue, patchValue);
      if (Object.keys(nestedValue).length === 0) {
        delete nextValue[key];
      } else {
        nextValue[key] = nestedValue;
      }
      continue;
    }

    delete nextValue[key];
  }

  return nextValue;
}

async function writeOrRemoveJsonFile(
  filePath: string,
  value: JsonObject,
): Promise<void> {
  if (Object.keys(value).length === 0) {
    await removePath(filePath);
    return;
  }

  await writeJsonFile(filePath, value);
}

function toUnknownArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const values: unknown[] = [];
  for (const entry of value) {
    values.push(entry);
  }

  return values;
}

function dedupeJsonArray(values: unknown[]): unknown[] {
  const dedupedValues: unknown[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const key = stableJsonKey(value);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    dedupedValues.push(value);
  }

  return dedupedValues;
}

function stableJsonKey(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value));
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => toStableJsonValue(entry));
  }

  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, toStableJsonValue(entryValue)]),
    );
  }

  return value;
}

function assertJsonObject(value: unknown, context: string): JsonObject {
  if (isJsonObject(value)) {
    return value;
  }

  throw new Error(`${context} must contain a JSON object.`);
}

function asJsonObject(value: unknown): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Exposes pure native-config helpers for focused behavioral coverage.
 */
export const nativeConfigInternals = {
  assertAllowedHostNativePath,
  resolveWorkspacePath,
};
