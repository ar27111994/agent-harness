import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface DotEnvLoadResult {
  path: string;
  loaded: boolean;
  appliedKeys: string[];
}

export async function loadDotEnvFile(
  directory: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DotEnvLoadResult> {
  const envPath = join(directory, ".env");
  let content: string;

  try {
    content = await readFile(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path: envPath, loaded: false, appliedKeys: [] };
    }

    throw error;
  }

  const parsedEntries = parseDotEnvContent(content);
  const appliedKeys: string[] = [];

  for (const [key, value] of parsedEntries) {
    if (env[key] !== undefined) {
      continue;
    }

    env[key] = value;
    appliedKeys.push(key);
  }

  return { path: envPath, loaded: true, appliedKeys };
}

function parseDotEnvContent(content: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];

  for (const rawLine of content.split(/\r?\n/u)) {
    const parsedLine = parseDotEnvLine(rawLine);
    if (parsedLine) {
      entries.push(parsedLine);
    }
  }

  return entries;
}

function parseDotEnvLine(rawLine: string): [string, string] | null {
  const trimmedLine = rawLine.trim();

  if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) {
    return null;
  }

  const line = trimmedLine.startsWith("export ")
    ? trimmedLine.slice("export ".length).trimStart()
    : trimmedLine;
  const separatorIndex = line.indexOf("=");

  if (separatorIndex <= 0) {
    return null;
  }

  const key = line.slice(0, separatorIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
    return null;
  }

  const rawValue = line.slice(separatorIndex + 1).trim();
  return [key, parseDotEnvValue(rawValue)];
}

function parseDotEnvValue(rawValue: string): string {
  if (rawValue.startsWith('"')) {
    return parseQuotedDotEnvValue(rawValue, '"');
  }

  if (rawValue.startsWith("'")) {
    return parseQuotedDotEnvValue(rawValue, "'");
  }

  return stripInlineComment(rawValue).trim();
}

function parseQuotedDotEnvValue(rawValue: string, quote: '"' | "'"): string {
  let value = "";
  let escaped = false;

  for (let index = 1; index < rawValue.length; index += 1) {
    const character = rawValue[index];

    if (escaped) {
      value += decodeDoubleQuotedEscape(character);
      escaped = false;
      continue;
    }

    if (character === "\\" && quote === '"') {
      escaped = true;
      continue;
    }

    if (character === quote) {
      return value;
    }

    value += character;
  }

  return value;
}

function decodeDoubleQuotedEscape(character: string | undefined): string {
  switch (character) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case '"':
      return '"';
    case "\\":
      return "\\";
    case undefined:
      return "";
    default:
      return `\\${character}`;
  }
}

function stripInlineComment(rawValue: string): string {
  const commentIndex = rawValue.search(/\s#/u);
  return commentIndex === -1 ? rawValue : rawValue.slice(0, commentIndex);
}
