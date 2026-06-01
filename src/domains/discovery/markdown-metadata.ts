import type { AssetPrerequisite } from "../../types.js";
import { buildAssetPrerequisitesFromMetadata } from "../../lib/asset-prerequisites.js";

/**
 * Describes parsed markdown metadata data exchanged by the lifecycle pipeline.
 */
export interface ParsedMarkdownMetadata {
  fields: Record<string, string | string[]>;
  heading: string | null;
  description: string | null;
  tags: string[];
  dependencies: string[];
  authProviders: string[];
  requiredEnvVars: string[];
  setupUrls: string[];
  prerequisites: AssetPrerequisite[];
  lineCount: number;
  body: string;
}

/**
 * Provides extract markdown metadata for the lifecycle pipeline.
 */
export function extractMarkdownMetadata(
  content: string,
): ParsedMarkdownMetadata {
  const { fields, body } = parseFrontmatter(content);
  const heading = extractHeading(body);
  const description =
    getFirstStringField(fields.description) ??
    extractDescriptionFromBody(body, heading);
  const tags = getStringArrayField(fields.tags);
  const dependencies = getStringArrayField(fields.dependencies);
  const authProviders = getStringArrayField(fields.auth);
  const requiredEnvVars = getStringArrayField(fields.requiresEnv);
  const requiredHostLogins = getStringArrayField(fields.requiresHostLogin);
  const requiredOauthProviders = getStringArrayField(fields.requiresOAuth);
  const setupUrls = getStringArrayField(fields.setupUrl);
  const setupUrl = setupUrls[0];
  const prerequisites = buildAssetPrerequisitesFromMetadata({
    providers: authProviders,
    envVars: requiredEnvVars,
    hostLogins: requiredHostLogins,
    oauthProviders: requiredOauthProviders,
    setupUrl,
  });
  const lineCount = content.split(/\r?\n/u).length;

  return {
    fields,
    heading,
    description,
    tags,
    dependencies,
    authProviders,
    requiredEnvVars,
    setupUrls,
    prerequisites,
    lineCount,
    body,
  };
}

function parseFrontmatter(content: string): {
  fields: Record<string, string | string[]>;
  body: string;
} {
  if (!content.startsWith("---")) {
    return { fields: {}, body: content };
  }

  const lines = content.split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") {
    return { fields: {}, body: content };
  }

  const supportedKeys = new Set([
    "name",
    "description",
    "tags",
    "dependencies",
    "auth",
    "requiresEnv",
    "requiresHostLogin",
    "requiresOAuth",
    "setupUrl",
    "type",
    "kind",
    "assetKind",
    "mode",
    "compatibility",
  ]);
  const fields: Record<string, string | string[]> = {};
  let currentArrayKey: string | null = null;
  let bodyStartIndex = 1;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmedLine = line.trim();

    if (trimmedLine === "---") {
      bodyStartIndex = index + 1;
      break;
    }

    if (trimmedLine.length === 0) {
      continue;
    }

    const topLevelMatch =
      line === trimmedLine
        ? /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u.exec(trimmedLine)
        : null;
    if (topLevelMatch) {
      const [, key, rawValue] = topLevelMatch;
      if (!supportedKeys.has(key)) {
        currentArrayKey = null;
        continue;
      }

      if (rawValue.length === 0) {
        fields[key] = [];
        currentArrayKey = key;
        continue;
      }

      fields[key] = parseFrontmatterValue(rawValue);
      currentArrayKey = Array.isArray(fields[key]) ? key : null;
      continue;
    }

    if (currentArrayKey && /^-\s+/u.test(trimmedLine)) {
      const items = fields[currentArrayKey] as string[];
      items.push(stripWrappingQuotes(trimmedLine.replace(/^-\s+/u, "")));
      fields[currentArrayKey] = items;
      continue;
    }

    currentArrayKey = null;
  }

  return {
    fields,
    body: lines.slice(bodyStartIndex).join("\n"),
  };
}

function parseFrontmatterValue(value: string): string | string[] {
  const trimmedValue = value.trim();

  if (trimmedValue.startsWith("[") && trimmedValue.endsWith("]")) {
    return trimmedValue
      .slice(1, -1)
      .split(",")
      .map((item) => stripWrappingQuotes(item.trim()))
      .filter((item) => item.length > 0);
  }

  return stripWrappingQuotes(trimmedValue);
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/gu, "");
}

/**
 * Returns get first string field for the provided inputs.
 */
export function getFirstStringField(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return null;
}

function getStringArrayField(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.filter((item) => item.length > 0);
  }

  if (typeof value === "string" && value.length > 0) {
    return [value];
  }

  return [];
}

function extractHeading(body: string): string | null {
  const lines = body.split(/\r?\n/u);

  for (const line of lines) {
    const match = /^#\s+(.+)$/u.exec(line.trim());
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

function extractDescriptionFromBody(
  body: string,
  heading: string | null,
): string | null {
  const lines = body.split(/\r?\n/u);

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (
      trimmedLine.length === 0 ||
      trimmedLine === heading ||
      trimmedLine.startsWith("#") ||
      trimmedLine.startsWith("<!--") ||
      trimmedLine.startsWith("**")
    ) {
      continue;
    }

    return trimmedLine;
  }

  return null;
}
