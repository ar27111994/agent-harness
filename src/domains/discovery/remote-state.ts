import { join } from "node:path";

import { readJsonFileOrNull, writeJsonFile } from "../../files.js";
import { REMOTE_HARVEST_STATE_OUTPUT_PATH } from "./output-paths.js";

export interface RemoteHarvestState {
  schemaVersion: number;
  generatedAt: string;
  nextRepoOffset: number;
  completedSourceIds: string[];
}

export async function loadRemoteHarvestState(
  projectRoot: string,
): Promise<RemoteHarvestState> {
  try {
    return (
      (await readJsonFileOrNull<RemoteHarvestState>(
        join(projectRoot, ...REMOTE_HARVEST_STATE_OUTPUT_PATH),
        assertRemoteHarvestState,
      )) ?? buildDefaultRemoteHarvestState()
    );
  } catch {
    return buildDefaultRemoteHarvestState();
  }
}

function buildDefaultRemoteHarvestState(): RemoteHarvestState {
  return {
    schemaVersion: 1,
    generatedAt: new Date(0).toISOString(),
    nextRepoOffset: 0,
    completedSourceIds: [],
  };
}

function assertRemoteHarvestState(
  value: unknown,
  context: string,
): asserts value is RemoteHarvestState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }

  const record = value as Record<string, unknown>;
  if (typeof record.schemaVersion !== "number") {
    throw new Error(`${context}.schemaVersion must be a number`);
  }
  if (typeof record.generatedAt !== "string") {
    throw new Error(`${context}.generatedAt must be a string`);
  }
  if (typeof record.nextRepoOffset !== "number") {
    throw new Error(`${context}.nextRepoOffset must be a number`);
  }
  if (!Array.isArray(record.completedSourceIds)) {
    throw new Error(`${context}.completedSourceIds must be an array`);
  }
  record.completedSourceIds.forEach((sourceId, index) => {
    if (typeof sourceId !== "string") {
      throw new Error(
        `${context}.completedSourceIds[${index}] must be a string`,
      );
    }
  });
}

export async function writeRemoteHarvestState(
  projectRoot: string,
  state: RemoteHarvestState,
): Promise<void> {
  await writeJsonFile(
    join(projectRoot, ...REMOTE_HARVEST_STATE_OUTPUT_PATH),
    state,
  );
}
