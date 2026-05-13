import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export function resolveTscModulePath(cwd = process.cwd()) {
  return join(cwd, "node_modules", "typescript", "bin", "tsc");
}

export function buildProject(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const distPath = resolve(cwd, "dist");
  const tscModulePath = resolveTscModulePath(cwd);

  rmSync(distPath, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 50,
  });

  const result = spawnSync(
    process.execPath,
    [tscModulePath, "-p", "tsconfig.json"],
    {
      cwd,
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }

  return result.status ?? 1;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  buildProject();
}
