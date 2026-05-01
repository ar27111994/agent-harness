import type { AssetKind } from "../types.js";
import { wireOpenCode } from "../host-opencode.js";
import { wireVsCode } from "../host-vscode.js";
import { wireNativeHost } from "./native-wire.js";

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
  requiresLifecycleHostPaths?: boolean;
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

const piCapabilities: HostCapability[] = opencodeCapabilities.map(
  (capability) =>
    capability.assetKind === "mcp-server"
      ? { assetKind: capability.assetKind, behaviors: ["stage"] }
      : capability,
);

export const HOST_ADAPTERS: HostAdapter[] = [
  {
    id: "copilot-vscode",
    aliases: ["vscode", "copilot"],
    displayName: "GitHub Copilot in VS Code",
    lifecycleHost: "copilot-vscode",
    defaultBundleIds: ["copilot-core", "community-stable", "shared-mcp"],
    mutatesHostPaths: true,
    requiresLifecycleHostPaths: true,
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
    requiresLifecycleHostPaths: true,
    capabilities: opencodeCapabilities,
    wire: wireOpenCode,
  },
  {
    id: "cursor",
    aliases: [],
    displayName: "Cursor",
    lifecycleHost: "copilot-vscode",
    defaultBundleIds: ["copilot-core", "community-stable", "shared-mcp"],
    mutatesHostPaths: true,
    requiresLifecycleHostPaths: false,
    capabilities: vscodeCapabilities,
    wire: (options) => wireNativeHost("cursor", options),
  },
  {
    id: "zed",
    aliases: [],
    displayName: "Zed",
    lifecycleHost: "opencode",
    defaultBundleIds: ["opencode-global", "community-stable", "shared-mcp"],
    mutatesHostPaths: true,
    requiresLifecycleHostPaths: false,
    capabilities: opencodeCapabilities,
    wire: (options) => wireNativeHost("zed", options),
  },
  {
    id: "claude-code",
    aliases: ["claude", "claudecode"],
    displayName: "Claude Code",
    lifecycleHost: "opencode",
    defaultBundleIds: ["opencode-global", "community-stable", "shared-mcp"],
    mutatesHostPaths: true,
    requiresLifecycleHostPaths: false,
    capabilities: opencodeCapabilities,
    wire: (options) => wireNativeHost("claude-code", options),
  },
  {
    id: "pi",
    aliases: ["pi-coding-agent"],
    displayName: "Pi",
    lifecycleHost: "opencode",
    defaultBundleIds: ["opencode-global", "community-stable"],
    mutatesHostPaths: true,
    requiresLifecycleHostPaths: false,
    capabilities: piCapabilities,
    wire: (options) => wireNativeHost("pi", options),
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
