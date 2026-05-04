import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Describes dot env load result data exchanged by the lifecycle pipeline.
 */
export interface DotEnvLoadResult {
  path: string;
  loaded: boolean;
  appliedKeys: string[];
}

/**
 * Loads a `.env` file from `directory` into the provided environment object.
 * Existing environment variables win over file values so shell/process-manager
 * configuration can override local defaults safely.
 */
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
  const originalKeys = new Set(Object.keys(env));
  const pendingEntries = new Map<string, string>();

  for (const [key, value] of parsedEntries) {
    if (originalKeys.has(key)) {
      continue;
    }

    pendingEntries.set(key, value);
  }

  for (const [key, value] of pendingEntries) {
    env[key] = value;
  }

  return {
    path: envPath,
    loaded: true,
    appliedKeys: [...pendingEntries.keys()],
  };
}

/**
 * Parses dotenv content into ordered key/value entries while preserving quoted
 * multiline values as single logical assignments.
 */
function parseDotEnvContent(content: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];

  for (const logicalLine of collectDotEnvLogicalLines(content)) {
    const parsedLine = parseDotEnvLine(logicalLine);
    if (parsedLine) {
      entries.push(parsedLine);
    }
  }

  return entries;
}

/**
 * Splits physical file content into dotenv logical lines by tracking quote
 * state, escape characters, and line continuations.
 */
function collectDotEnvLogicalLines(content: string): string[] {
  const logicalLines: string[] = [];
  let currentLine = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let lineContinuation = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (character === "\r" && nextCharacter === "\n") {
      index += 1;
      handleLogicalNewline();
      continue;
    }

    if (character === "\n" || character === "\r") {
      handleLogicalNewline();
      continue;
    }

    if (lineContinuation) {
      lineContinuation = false;
      if (character === " " || character === "\t") {
        continue;
      }
    }

    currentLine += character;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }

    if ((character === '"' || character === "'") && shouldToggleQuote()) {
      quote = quote === character ? null : character;
    }
  }

  if (quote !== null) {
    throw new Error("Unterminated quoted value in .env file.");
  }

  if (currentLine.length > 0 || lineContinuation) {
    logicalLines.push(currentLine);
  }

  return logicalLines;

  function handleLogicalNewline(): void {
    if (quote !== null) {
      currentLine += "\n";
      return;
    }

    if (currentLine.endsWith("\\") && !currentLine.endsWith("\\\\")) {
      currentLine = currentLine.slice(0, -1);
      lineContinuation = true;
      return;
    }

    logicalLines.push(currentLine);
    currentLine = "";
    lineContinuation = false;
  }

  function shouldToggleQuote(): boolean {
    if (quote !== null) {
      return true;
    }

    const equalIndex = currentLine.indexOf("=");
    if (equalIndex === -1) {
      return false;
    }

    const valueBeforeCharacter = currentLine.slice(equalIndex + 1, -1);
    return valueBeforeCharacter.trim().length === 0;
  }
}

/**
 * Parses one dotenv logical line, ignoring comments, blanks, malformed keys,
 * and optional `export` prefixes.
 */
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

/**
 * Normalizes a dotenv value by applying quoted-value handling or stripping
 * inline comments from unquoted values.
 */
function parseDotEnvValue(rawValue: string): string {
  if (rawValue.startsWith('"')) {
    return parseQuotedDotEnvValue(rawValue, '"');
  }

  if (rawValue.startsWith("'")) {
    return parseQuotedDotEnvValue(rawValue, "'");
  }

  return stripInlineComment(rawValue).trim();
}

/**
 * Reads a quoted dotenv value and decodes double-quoted escape sequences while
 * preserving single-quoted content literally.
 */
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

/**
 * Converts supported dotenv double-quoted escape characters to their runtime
 * value, leaving unknown escapes visibly escaped.
 */
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

/**
 * Removes an unquoted inline comment introduced by whitespace followed by `#`.
 */
function stripInlineComment(rawValue: string): string {
  const commentIndex = rawValue.search(/\s#/u);
  return commentIndex === -1 ? rawValue : rawValue.slice(0, commentIndex);
}
