#!/usr/bin/env node

import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createDirectoryLink,
  ensureDirectory,
  pathEntryExists,
  removePath,
  replaceDirectoryLink,
} from "./files.js";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "agent-harness-links-"));
  const firstTarget = join(root, "first-target");
  const secondTarget = join(root, "second-target");
  const linkPath = join(root, "managed-link");

  try {
    await ensureDirectory(firstTarget);
    await ensureDirectory(secondTarget);
    await writeFile(join(firstTarget, "first.txt"), "first", "utf8");
    await writeFile(join(secondTarget, "second.txt"), "second", "utf8");

    await createDirectoryLink(linkPath, firstTarget);
    if (!(await pathEntryExists(linkPath))) {
      throw new Error("managed link was not created");
    }

    await removePath(linkPath);
    if (await pathEntryExists(linkPath)) {
      throw new Error("managed link was not removed");
    }

    await replaceDirectoryLink(linkPath, secondTarget);
    if (!(await pathEntryExists(linkPath))) {
      throw new Error("managed link was not replaced");
    }
  } finally {
    await removePath(root);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
