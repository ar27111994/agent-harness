export type AuthorityTier =
  | "trusted-local"
  | "official-first-party"
  | "official-marketplace"
  | "official-compatible"
  | "trusted-community"
  | "unverified-community";

export type SourceKind =
  | "repo"
  | "docs"
  | "marketplace"
  | "registry"
  | "package-registry"
  | "local-manifest"
  | "local-directory";

export type AssetKind =
  | "skill"
  | "plugin"
  | "mcp-server"
  | "agent"
  | "instruction"
  | "workflow"
  | "hook"
  | "extension"
  | "prompt-pack"
  | "reference-pack";

export type BuiltInHostTarget =
  | "copilot-vscode"
  | "opencode"
  | "shared"
  | "cursor"
  | "zed"
  | "claude-code"
  | "pi";

export type HostTarget = BuiltInHostTarget | (string & {});

export type CompatibilityMode =
  | "native"
  | "adaptable"
  | "partial"
  | "reference-only"
  | "incompatible";
