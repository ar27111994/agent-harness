import { isAbsolute, relative, resolve } from "node:path";

import {
  copyPath,
  ensureCleanDirectory,
  ensureDirectory,
  pathExists,
  toPosixPath,
  writeJsonFile,
} from "../files.js";
import { getRuntimeConfig } from "../config/runtime.js";
import { resolvePortablePath } from "./paths.js";

export const STATE_ROOT_ENV_VAR = "AGENT_HARNESS_STATE_ROOT";

const STATE_ASSET_PATHS = [
  ["discover", "sources.json"],
  ["discover", "selections.json"],
  ["discover", "official-skills-indexes.json"],
  ["discover", "pipeline.json"],
  ["discover", "source-packs"],
  ["discover", "schema"],
  ["discover", "recommendation-policy"],
  ["discover", "seeds"],
  ["mirror", "policy.json"],
  ["mirror", "schema"],
] as const;

export interface StateRootResolutionOptions {
  packageRoot: string;
  workingDirectory: string;
  explicitStateRoot?: string;
}

export interface PreparedStateRoot {
  packageRoot: string;
  stateRoot: string;
  usesPackageRoot: boolean;
}

export function resolveStateRoot(
  options: StateRootResolutionOptions,
): PreparedStateRoot {
  const normalizedPackageRoot = resolve(options.packageRoot);
  const normalizedWorkingDirectory = resolve(options.workingDirectory);
  const configuredStateRoot =
    options.explicitStateRoot ?? getRuntimeConfig().env[STATE_ROOT_ENV_VAR];
  const stateRoot = configuredStateRoot
    ? resolvePortablePath(configuredStateRoot, normalizedWorkingDirectory)
    : normalizedWorkingDirectory === normalizedPackageRoot
      ? normalizedPackageRoot
      : resolve(normalizedWorkingDirectory, ".agent-harness");
  const normalizedStateRoot = resolve(stateRoot);

  return {
    packageRoot: normalizedPackageRoot,
    stateRoot: normalizedStateRoot,
    usesPackageRoot: normalizedStateRoot === normalizedPackageRoot,
  };
}

export async function prepareStateRoot(
  preparedRoot: PreparedStateRoot,
): Promise<void> {
  await ensureDirectory(preparedRoot.stateRoot);

  if (preparedRoot.usesPackageRoot) {
    return;
  }

  if (isPathWithinRoot(preparedRoot.stateRoot, preparedRoot.packageRoot)) {
    throw new Error(
      `Refusing to use a state root that contains the package root: ${toPosixPath(preparedRoot.stateRoot)}`,
    );
  }

  for (const pathSegments of STATE_ASSET_PATHS) {
    const sourcePath = resolve(preparedRoot.packageRoot, ...pathSegments);
    if (!(await pathExists(sourcePath))) {
      continue;
    }

    const destinationPath = resolve(preparedRoot.stateRoot, ...pathSegments);
    if (pathSegments.at(-1)?.includes(".")) {
      await copyPath(sourcePath, destinationPath);
      continue;
    }

    await ensureCleanDirectory(destinationPath);
    await copyPath(sourcePath, destinationPath);
  }

  await writeJsonFile(resolve(preparedRoot.stateRoot, "state-root.json"), {
    schemaVersion: 1,
    packageRoot: toPosixPath(preparedRoot.packageRoot),
    stateRoot: toPosixPath(preparedRoot.stateRoot),
    generatedAt: new Date().toISOString(),
    managedAssets: STATE_ASSET_PATHS.map((segments) => segments.join("/")),
  });
}

function isPathWithinRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(resolve(rootPath), resolve(targetPath));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}
