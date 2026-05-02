import type { HostTarget } from "./core.js";

export interface ActivationManifest {
  schemaVersion: number;
  host: HostTarget;
  generatedAt: string;
  generationId?: string;
  activeBundles: string[];
  activeAssets: string[];
  runtimeRoot: string;
  notes: string[];
}

export interface CopilotWorkspaceOverlayManifest {
  schemaVersion: 1;
  host: "copilot-vscode";
  generatedAt: string;
  workspaceRoot: string;
  selectedBundleIds: string[];
  selectedAssetIds: string[];
  activationBudget: number;
  mode: string;
  sessionIntent?: string;
  concernBuckets?: Record<string, string[]>;
  taskModeBuckets?: Record<string, string[]>;
}

export interface CopilotWorkspaceProfileManifest {
  schemaVersion: number;
  generatedAt: string;
  profileId: string;
  workspaceRoot: string;
  bundleIds: string[];
  selectedAssetIds: string[];
  selectedInstructionIds: string[];
  selectedAgentIds: string[];
  selectedWorkflowIds: string[];
  selectedPluginIds?: string[];
  selectedExtensionIds?: string[];
  selectedHookIds?: string[];
  selectedSkillIds?: string[];
  activationBudget: number;
  sessionIntent?: string;
}

export interface WirePlanManifest {
  schemaVersion: number;
  host:
    | HostTarget
    | "vscode-user"
    | "opencode-project"
    | "cursor"
    | "zed"
    | "claude-code"
    | "pi";
  generatedAt: string;
  workspaceRoot: string;
  runtimeRoot: string;
  linkedPaths?: string[];
  instructionsFiles?: string[];
  agentFiles?: string[];
  skillDirs?: string[];
  pluginDirs?: string[];
  workflowFiles?: string[];
  referenceFiles?: string[];
  extensionIds?: string[];
  mcpServers?: string[];
  nativeInstallActions?: string[];
  hookFiles?: string[];
  notes: string[];
}

export interface WirePreviewManifest {
  schemaVersion: number;
  host: "vscode" | "opencode";
  mode: "preview" | "apply" | "reset";
  generatedAt: string;
  workspaceRoot: string;
  targetPaths: string[];
  notes: string[];
}
