import { wireOpenCode } from "../host-opencode.js";
import { wireVsCode } from "../host-vscode.js";
import type { HostTarget } from "../types.js";

export type RuntimeHostTarget = Exclude<HostTarget, "shared">;

export interface HostAdapter {
  cliName: string;
  host: RuntimeHostTarget;
  displayName: string;
  defaultBundleIds: string[];
  supportedAssetBehaviors: string[];
  wire(options: {
    projectRoot: string;
    workspaceRoot: string;
    mode: "preview" | "apply" | "reset";
  }): Promise<void>;
}

const HOST_ADAPTERS = new Map<string, HostAdapter>();

registerHostAdapter({
  cliName: "vscode",
  host: "copilot-vscode",
  displayName: "VS Code / GitHub Copilot",
  defaultBundleIds: ["copilot-core", "community-stable", "shared-mcp"],
  supportedAssetBehaviors: ["stage", "activate", "wire", "auth-assist"],
  wire: wireVsCode,
});

registerHostAdapter({
  cliName: "opencode",
  host: "opencode",
  displayName: "OpenCode",
  defaultBundleIds: ["opencode-global", "community-stable", "shared-mcp"],
  supportedAssetBehaviors: ["stage", "activate", "wire"],
  wire: wireOpenCode,
});

export function registerHostAdapter(adapter: HostAdapter): void {
  HOST_ADAPTERS.set(adapter.cliName, adapter);
  HOST_ADAPTERS.set(adapter.host, adapter);
}

export function getHostAdapter(name: string): HostAdapter | undefined {
  return HOST_ADAPTERS.get(name);
}

export function listHostAdapters(): HostAdapter[] {
  return [...new Set(HOST_ADAPTERS.values())].sort((left, right) =>
    left.cliName.localeCompare(right.cliName),
  );
}
