import type { AssetKind } from "../types.js";
import { wireOpenCode } from "../host-opencode.js";
import { wireVsCode } from "../host-vscode.js";
import { writeHostGuidanceWirePlan } from "./wire-guidance.js";

export type LifecycleHost = "copilot-vscode" | "opencode";
export type WireMode = "preview" | "apply" | "reset";
export type HostBehavior =
  | "stage"
  | "wire"
  | "native-install"
  | "auth-assist"
  | "runtime-validation";

export interface HostCapability {
  assetKind: AssetKind;
  behaviors: HostBehavior[];
}

export interface HostAdapter {
  id: string;
  aliases: string[];
  displayName: string;
  lifecycleHost: LifecycleHost;
  defaultBundleIds: string[];
  mutatesHostPaths: boolean;
  capabilities: HostCapability[];
  wire(options: {
    projectRoot: string;
    workspaceRoot: string;
    mode: WireMode;
  }): Promise<void>;
}

const vscodeCapabilities: HostCapability[] = [
  { assetKind: "instruction", behaviors: ["stage", "wire"] },
  { assetKind: "agent", behaviors: ["stage", "wire"] },
  { assetKind: "skill", behaviors: ["stage", "wire"] },
  { assetKind: "plugin", behaviors: ["stage", "wire"] },
  { assetKind: "hook", behaviors: ["stage", "wire"] },
  {
    assetKind: "extension",
    behaviors: ["stage", "native-install", "runtime-validation"],
  },
  { assetKind: "mcp-server", behaviors: ["stage", "wire", "auth-assist"] },
];

const opencodeCapabilities: HostCapability[] = [
  { assetKind: "instruction", behaviors: ["stage", "wire"] },
  { assetKind: "agent", behaviors: ["stage", "wire"] },
  { assetKind: "skill", behaviors: ["stage", "wire"] },
  { assetKind: "plugin", behaviors: ["stage", "wire"] },
  { assetKind: "hook", behaviors: ["stage", "wire"] },
  { assetKind: "workflow", behaviors: ["stage", "wire"] },
  { assetKind: "reference-pack", behaviors: ["stage", "wire"] },
  { assetKind: "mcp-server", behaviors: ["stage", "wire", "auth-assist"] },
];

export const HOST_ADAPTERS: HostAdapter[] = [
  {
    id: "copilot-vscode",
    aliases: ["vscode", "copilot"],
    displayName: "GitHub Copilot in VS Code",
    lifecycleHost: "copilot-vscode",
    defaultBundleIds: ["copilot-core", "community-stable", "shared-mcp"],
    mutatesHostPaths: true,
    capabilities: vscodeCapabilities,
    wire: wireVsCode,
  },
  {
    id: "opencode",
    aliases: ["open-code"],
    displayName: "OpenCode",
    lifecycleHost: "opencode",
    defaultBundleIds: ["opencode-global", "community-stable", "shared-mcp"],
    mutatesHostPaths: true,
    capabilities: opencodeCapabilities,
    wire: wireOpenCode,
  },
  {
    id: "cursor",
    aliases: [],
    displayName: "Cursor",
    lifecycleHost: "copilot-vscode",
    defaultBundleIds: ["copilot-core", "community-stable", "shared-mcp"],
    mutatesHostPaths: false,
    capabilities: vscodeCapabilities,
    wire: (options) => writeHostGuidanceWirePlan("cursor", options),
  },
  {
    id: "zed",
    aliases: [],
    displayName: "Zed",
    lifecycleHost: "opencode",
    defaultBundleIds: ["opencode-global", "community-stable", "shared-mcp"],
    mutatesHostPaths: false,
    capabilities: opencodeCapabilities,
    wire: (options) => writeHostGuidanceWirePlan("zed", options),
  },
];

export function resolveHostAdapter(target: string): HostAdapter | null {
  const normalizedTarget = target.toLowerCase();
  return (
    HOST_ADAPTERS.find(
      (adapter) =>
        adapter.id === normalizedTarget ||
        adapter.aliases.includes(normalizedTarget),
    ) ?? null
  );
}

export function listHostAdapters(): HostAdapter[] {
  return [...HOST_ADAPTERS];
}
