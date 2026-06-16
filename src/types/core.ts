/**
 * Defines the supported authority tier values.
 */
export type AuthorityTier =
  | "trusted-local"
  | "official-first-party"
  | "official-marketplace"
  | "official-compatible"
  | "trusted-community"
  | "unverified-community";

/**
 * Defines the supported source kind values.
 */
export type SourceKind =
  | "repo"
  | "docs"
  | "marketplace"
  | "registry"
  | "package-registry"
  | "local-manifest"
  | "local-directory";

/**
 * Defines the supported asset kind values.
 */
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
  | "reference-pack"
  | "payable-api"
  /** ACP-compatible agent compatible with JetBrains Agent Client Protocol and Zed external-agent forwarding. */
  | "acp-agent";

/**
 * Defines the supported built in host target values.
 */
export type BuiltInHostTarget =
  | "copilot-vscode"
  | "opencode"
  | "shared"
  | "cursor"
  | "zed"
  | "claude-code"
  | "pi"
  | "codex";

/**
 * Defines the supported host target values.
 */
export type HostTarget = BuiltInHostTarget | (string & {});

/**
 * Defines the supported session intent values.
 */
export type SessionIntent =
  | "general"
  | "frontend"
  | "backend"
  | "mobile"
  | "devops"
  | "security"
  | "docs"
  | "testing"
  | "research"
  | "data"
  | "design"
  | "product"
  | "marketing";

/**
 * Defines the supported compatibility mode values.
 */
export type CompatibilityMode =
  | "native"
  | "adaptable"
  | "partial"
  | "reference-only"
  | "incompatible";
