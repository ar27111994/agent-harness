import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const EXPORTED_DECLARATION_PATTERN =
  /^export\s+(?:default\s+)?(?:(?:async\s+)?(?:function|class|interface|type|enum)\s+(?<name>[A-Za-z_$][\w$]*)|(?:const|let|var)\s+(?<variable>[A-Za-z_$][\w$]*|[[{])|\{\s*[^}]+\s*\}(?:\s*from\s*["'][^"']+["'])?)/u;

void test("public exported declarations have docstrings", async () => {
  const sourceRoot = join(process.cwd(), "src");
  const missingDocstrings: string[] = [];

  for (const filePath of await listSourceFiles(sourceRoot)) {
    const content = await readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/u);

    lines.forEach((line, index) => {
      const match = EXPORTED_DECLARATION_PATTERN.exec(line);
      if (!match || hasDocComment(lines, index)) {
        return;
      }

      missingDocstrings.push(
        `${filePath.replace(process.cwd(), "").replace(/^[/\\]/u, "")}:${index + 1}:${match.groups?.name ?? match.groups?.variable ?? "re-export"}`,
      );
    });
  }

  assert.deepEqual(missingDocstrings, []);
});

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "tests") {
        continue;
      }
      files.push(...(await listSourceFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files;
}

function hasDocComment(lines: string[], declarationIndex: number): boolean {
  for (let index = declarationIndex - 1; index >= 0; index -= 1) {
    const trimmedLine = lines[index]?.trim() ?? "";
    if (trimmedLine.length === 0) {
      continue;
    }

    return trimmedLine.endsWith("*/");
  }

  return false;
}
