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

/**
 * Validates unknown data as activation manifest.
 */
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

/**
 * Validates unknown data as copilot workspace profile manifest.
 */
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
  assertStringArray(
    record.selectedInstructionIds,
    `${context}.selectedInstructionIds`,
  );
  assertStringArray(record.selectedAgentIds, `${context}.selectedAgentIds`);
  assertStringArray(
    record.selectedWorkflowIds,
    `${context}.selectedWorkflowIds`,
  );
  assertOptionalStringArray(
    record.selectedPluginIds,
    `${context}.selectedPluginIds`,
  );
  assertOptionalStringArray(
    record.selectedExtensionIds,
    `${context}.selectedExtensionIds`,
  );
  assertOptionalStringArray(
    record.selectedHookIds,
    `${context}.selectedHookIds`,
  );
  assertOptionalStringArray(
    record.selectedSkillIds,
    `${context}.selectedSkillIds`,
  );
  assertNumber(record.activationBudget, `${context}.activationBudget`);
  if (record.sessionIntent !== undefined) {
    assertString(record.sessionIntent, `${context}.sessionIntent`);
  }
}

function assertOptionalStringArray(value: unknown, context: string): void {
  if (value !== undefined) {
    assertStringArray(value, context);
  }
}

/**
 * Validates unknown data as wire plan manifest.
 */
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
  if (record.nativeConfigOperations !== undefined) {
    assertNativeConfigOperations(
      record.nativeConfigOperations,
      `${context}.nativeConfigOperations`,
    );
  }
  assertStringArray(record.notes, `${context}.notes`);
}

function assertNativeConfigOperations(value: unknown, context: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }

  const operations = value;

  operations.forEach((entry, index) => {
    const operation = assertRecord(entry, `${context}[${index}]`);
    assertString(operation.path, `${context}[${index}].path`);
    assertLiteral(
      operation.format,
      ["text", "json"],
      `${context}[${index}].format`,
    );
    assertLiteral(
      operation.mode,
      ["write", "merge"],
      `${context}[${index}].mode`,
    );
    if (operation.content !== undefined) {
      if (operation.format === "text") {
        assertString(operation.content, `${context}[${index}].content`);
      } else {
        assertRecord(operation.content, `${context}[${index}].content`);
      }
    }
    if (
      operation.previousContent !== undefined &&
      operation.previousContent !== null
    ) {
      assertRecord(
        operation.previousContent,
        `${context}[${index}].previousContent`,
      );
    }
  });
}
