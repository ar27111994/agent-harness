import { applyEdits, modify, parse } from "jsonc-parser";

import { readTextFileOrNull, writeTextFile } from "../files.js";

export async function readVsCodeSettings(
  settingsPath: string,
): Promise<Record<string, unknown>> {
  const rawContent = await readTextFileOrNull(settingsPath);

  if (rawContent === null) {
    return {};
  }

  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const parsedSettings = parse(rawContent, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `VS Code settings.json contains JSONC parse errors and could not be safely patched: ${JSON.stringify(errors)}`,
    );
  }

  if (
    typeof parsedSettings !== "object" ||
    parsedSettings === null ||
    Array.isArray(parsedSettings)
  ) {
    return {};
  }

  return parsedSettings as Record<string, unknown>;
}

export async function patchVsCodeSettings(
  settingsPath: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const originalContent = (await readTextFileOrNull(settingsPath)) ?? "{}\n";
  const formattingOptions = {
    insertSpaces: true,
    tabSize: 2,
    eol: "\n",
  };

  let nextContent = originalContent;

  for (const [key, value] of Object.entries(updates)) {
    const edits = modify(nextContent, [key], value, {
      formattingOptions,
      getInsertionIndex: undefined,
      isArrayInsertion: false,
    });
    nextContent = applyEdits(nextContent, edits);
  }

  await writeTextFile(settingsPath, nextContent);
}
