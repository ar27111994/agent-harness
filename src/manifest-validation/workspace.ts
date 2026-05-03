import type {
  ActivationManifest,
  CopilotWorkspaceProfileManifest,
  WirePlanManifest,
} from "../types.js";
import {
  assertHostTarget,
  assertLiteral,
  assertNumber,
  assertRecord,
  assertString,
  assertStringArray,
  WIRE_PLAN_HOSTS,
} from "./primitives.js";

export function assertActivationManifest(
  value: unknown,
  context: string,
): asserts value is ActivationManifest {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertHostTarget(record.host, `${context}.host`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertStringArray(record.activeBundles, `${context}.activeBundles`);
  assertStringArray(record.activeAssets, `${context}.activeAssets`);
  assertString(record.runtimeRoot, `${context}.runtimeRoot`);
  assertStringArray(record.notes, `${context}.notes`);
  if (record.generationId !== undefined) {
    assertString(record.generationId, `${context}.generationId`);
  }
}

export function assertCopilotWorkspaceProfileManifest(
  value: unknown,
  context: string,
): asserts value is CopilotWorkspaceProfileManifest {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertString(record.profileId, `${context}.profileId`);
  assertString(record.workspaceRoot, `${context}.workspaceRoot`);
  assertStringArray(record.bundleIds, `${context}.bundleIds`);
  assertStringArray(record.selectedAssetIds, `${context}.selectedAssetIds`);
  if (record.selectedExtensionIds !== undefined) {
    assertStringArray(
      record.selectedExtensionIds,
      `${context}.selectedExtensionIds`,
    );
  }
  assertNumber(record.activationBudget, `${context}.activationBudget`);
}

export function assertWirePlanManifest(
  value: unknown,
  context: string,
): asserts value is WirePlanManifest {
  const record = assertRecord(value, context);
  assertNumber(record.schemaVersion, `${context}.schemaVersion`);
  assertLiteral(record.host, [...WIRE_PLAN_HOSTS], `${context}.host`);
  assertString(record.generatedAt, `${context}.generatedAt`);
  assertString(record.workspaceRoot, `${context}.workspaceRoot`);
  assertString(record.runtimeRoot, `${context}.runtimeRoot`);
  if (record.linkedPaths !== undefined) {
    assertStringArray(record.linkedPaths, `${context}.linkedPaths`);
  }
  if (record.instructionsFiles !== undefined) {
    assertStringArray(record.instructionsFiles, `${context}.instructionsFiles`);
  }
  if (record.agentFiles !== undefined) {
    assertStringArray(record.agentFiles, `${context}.agentFiles`);
  }
  if (record.skillDirs !== undefined) {
    assertStringArray(record.skillDirs, `${context}.skillDirs`);
  }
  if (record.pluginDirs !== undefined) {
    assertStringArray(record.pluginDirs, `${context}.pluginDirs`);
  }
  if (record.workflowFiles !== undefined) {
    assertStringArray(record.workflowFiles, `${context}.workflowFiles`);
  }
  if (record.referenceFiles !== undefined) {
    assertStringArray(record.referenceFiles, `${context}.referenceFiles`);
  }
  if (record.extensionIds !== undefined) {
    assertStringArray(record.extensionIds, `${context}.extensionIds`);
  }
  if (record.mcpServers !== undefined) {
    assertStringArray(record.mcpServers, `${context}.mcpServers`);
  }
  if (record.nativeInstallActions !== undefined) {
    assertStringArray(
      record.nativeInstallActions,
      `${context}.nativeInstallActions`,
    );
  }
  if (record.hookFiles !== undefined) {
    assertStringArray(record.hookFiles, `${context}.hookFiles`);
  }
  assertStringArray(record.notes, `${context}.notes`);
}
