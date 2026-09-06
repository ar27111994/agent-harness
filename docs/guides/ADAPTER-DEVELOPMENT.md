# Adapter Development Guide

How to create a new host adapter for `agent-harness`. This guide walks through
registration, lifecycle wiring, capability matrix, and testing — with a worked
example for a hypothetical ExampleHost adapter.

## Architecture Overview

A host adapter translates agent-harness asset recommendations into host-native
configurations. Each adapter handles:

1. **Lifecycle host** — which lifecycle bundles the host consumes (e.g. `opencode`
   or `copilot-vscode`)
2. **Recommendation host** — which host identity supplies default bundles and
   compatibility decisions
3. **Wire handler** — how activated assets are applied to a workspace
4. **Native config** — host-specific JSON/text file payloads (MCP servers, skills,
   instructions)
5. **Preflight diagnostics** — whether the host CLI is installed and accessible
6. **Install/verify/remove** — optional host-native install operations

## Step-by-Step Walkthrough

### 1. Choose a Host Identifier

Pick a unique `id` for your adapter (e.g. `"my-adapter"`). This becomes the CLI
command target:

```bash
agent-harness workspace my-adapter
agent-harness wire my-adapter --preview
```

### 2. Create the Adapter Module

Create `src/host-adapters/my-adapter.ts`:

```typescript
import type { HostTarget } from "../types.js";
import type { HostAdapter, HostCapability } from "./registry.js";

const capabilities: HostCapability[] = [
  { assetKind: "skill", behaviors: ["stage", "wire"] },
  { assetKind: "instruction", behaviors: ["stage", "wire"] },
  { assetKind: "mcp-server", behaviors: ["stage", "wire", "auth-assist"] },
];

const adapter: HostAdapter = {
  id: "my-adapter",
  displayName: "ExampleHost",
  aliases: ["my-adapter-ide"],
  lifecycleHost: "opencode",
  recommendationHost: "my-adapter" as HostTarget,
  defaultBundleIds: ["opencode-global", "community-stable"],
  mutatesHostPaths: true,
  requiresLifecycleHostPaths: true,
  capabilities,
  runtime: {
    executable: "my-adapter",
    versionArgs: ["--version"],
    requiredFor: ["runtime-validation"],
  },
  wire: async ({ projectRoot, workspaceRoot, mode }) => {
    // Delegate to the shared native-wire infrastructure in the implementation.
    void projectRoot;
    void workspaceRoot;
    void mode;
  },
};

export default adapter;
```

### 3. Register in the Adapter Registry

Add your adapter to `src/host-adapters/registry.ts`:

```typescript
import myAdapter from "./my-adapter.js";

const adapters: HostAdapter[] = [
  // ... existing adapters
  myAdapter,
];
```

### 4. Define the Lifecycle Contract

| Concept              | Value          | Why                                          |
| -------------------- | -------------- | -------------------------------------------- |
| `lifecycleHost`      | `"opencode"`   | Reuses OpenCode-compatible bundle structure  |
| `recommendationHost` | `"my-adapter"` | Host identity used for recommendations       |
| `defaultBundleIds`   | `[...]`        | Default bundles activated for this host      |
| `mutatesHostPaths`   | `true`         | Adapter writes files to workspace            |
| `capabilities`       | `[...]`        | Asset kinds and behaviors this host supports |
| `wire`               | `async (...)`  | Applies preview, apply, and reset operations |

Lifecycle hosts determine which bundles assets are sourced from:

- `copilot-vscode` — VS Code / Copilot bundles
- `opencode` — OpenCode-compatible bundles (used by Cursor, Zed, Claude Code, Pi, Codex)
- `shared-mcp` — Cross-host MCP server bundles

### 5. Implement Native Configuration

Each activated asset can carry host-native file payloads. The payload is an
`AssetHostNativeConfig`; adapter wiring decides when and where those files are
materialized:

```typescript
import type { AssetHostNativeConfig } from "../types.js";

const nativeConfig = {
  files: [
    {
      path: ".my-adapter/mcp.json",
      format: "json",
      content: { mcpServers: {} },
    },
    {
      path: ".my-adapter/skills.json",
      format: "json",
      content: { skills: {} },
    },
  ],
} satisfies AssetHostNativeConfig;
```

### 6. Implement the Wire-in Handler

The `wire` step places generated native config files into the workspace. For
ExampleHost, this follows the same pattern as other opencode-hosted adapters:

- Preview mode: print the planned file paths and diff against existing files
- Apply mode: write the files to the workspace
- Reset mode: remove the adapter's files from the workspace

The wire-in is handled by the shared `native-wire.ts` infrastructure. Your
adapter's `wire` method receives `{ projectRoot, workspaceRoot, mode }` and
should delegate to that infrastructure or implement the equivalent lifecycle
operations explicitly.

### 7. Add Preflight Diagnostics

Preflight checks verify the host CLI is installed through the adapter's
`runtime` field:

```typescript
runtime: {
  executable: "my-adapter",
  versionArgs: ["--version"],
  requiredFor: ["runtime-validation"],
},
```

The `setup doctor` command runs all adapter preflights concurrently. A
per-adapter timeout (`AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS`, default 5s)
prevents a hanging CLI from blocking the entire check.

### 8. Add Install/Verify/Remove (Optional)

If your host supports programmatic install of extensions/plugins:

```typescript
// Add a `nativeInstall` provider to the adapter when the host exposes a
// supported programmatic install surface.
```

### 9. Add Recommendation Policy

Create a recommendation policy file at
`discover/recommendation-policy/my-adapter.json`:

```json
{
  "recommendationLimit": 80,
  "maxPerAssetKind": {
    "mcp-server": 15,
    "skill": 40,
    "plugin": 10,
    "agent": 10,
    "instruction": 5
  },
  "targetMinimums": {
    "skill": 8,
    "mcp-server": 4
  }
}
```

### 10. Register the Host in Compatibility Matrix

Add your host to `src/host-adapters/compatibility-matrix.ts`:

```typescript
export const COMPATIBLE_HOSTS: Record<HostTarget, CompatibleHost[]> = {
  // ... existing entries
  "my-adapter": [{ hostId: "my-adapter", installDiffers: false }],
};
```

### 11. Add Workspace and Wire CLI Targets

In `src/workspace.ts` and `src/wire.ts`, the host adapter registry is already
queried dynamically — no code changes needed beyond registration. The CLI
automatically picks up new adapters from the registry.

### 12. Test Your Adapter

Create `src/tests/host-adapters/my-adapter.test.ts`:

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveHostAdapter } from "../../host-adapters/registry.js";
import myAdapter from "../../host-adapters/my-adapter.js";

void test("my-adapter adapter is registered", () => {
  const adapter = resolveHostAdapter("my-adapter");
  assert.ok(adapter != null);
  assert.equal(adapter.id, "my-adapter");
  assert.equal(adapter, myAdapter);
  assert.equal(adapter.lifecycleHost, "opencode");
});

void test("my-adapter adapter exposes a wire contract", async () => {
  await myAdapter.wire({
    projectRoot: "/tmp/test",
    workspaceRoot: "/tmp/test",
    mode: "preview",
  });
});

void test("my-adapter workspace --help shows my-adapter-specific help", async () => {
  // Use the built-cli-harness to verify CLI integration
});
```

### 13. Update Documentation

- Add your host to the README [Supported hosts](#supported-hosts) badge row
- Add a row to the host compatibility table in `docs/guides/TRUST-CENTER.md`
- Add your host to the CLI cheat sheet (`docs/cheatsheet.md`)

## Capability Matrix

| Feature                  | Required | Notes                                            |
| ------------------------ | -------- | ------------------------------------------------ |
| Adapter registration     | Yes      | registry.ts entry                                |
| Lifecycle host mapping   | Yes      | Which bundles the host consumes                  |
| Wire host mapping        | Yes      | Where files are placed in the workspace          |
| Native config generation | Yes      | At minimum, an empty config                      |
| Preflight diagnostics    | Yes      | At minimum, report "not checked"                 |
| Recommendation policy    | Yes      | Per-host caps and minimums                       |
| Wire preview/apply/reset | Yes      | Handled by shared infra if mutatesHostPaths=true |
| Install/verify/remove    | No       | Only if host supports programmatic install       |
| Compatibility matrix     | Yes      | CompatibleHost[] entries                         |

## Host Design Checklist

Before submitting, verify:

- [ ] `resolveHostAdapter("my-host")` returns your adapter
- [ ] `setup hosts` lists your adapter with correct display name
- [ ] `workspace my-host --help` shows host-specific help text (#383)
- [ ] `wire my-host --help` shows host-specific help text (#383)
- [ ] `setup doctor --host my-host` runs preflight diagnostics
- [ ] Recommendation policy file exists at `discover/recommendation-policy/my-host.json`
- [ ] Native config produces valid JSON/text payloads
- [ ] Wire preview shows planned files without writing them
- [ ] Wire apply writes files to workspace
- [ ] Wire reset removes adapter files from workspace
- [ ] Tests cover registration, native config generation, and CLI integration
- [ ] README and docs updated

## See Also

- [Host Adapter Types](https://github.com/ar27111994/agent-harness/blob/main/src/host-adapters/types.ts) — full type definitions
- [Registry](https://github.com/ar27111994/agent-harness/blob/main/src/host-adapters/registry.ts) — adapter registration
- [Native Config](https://github.com/ar27111994/agent-harness/blob/main/src/host-adapters/native-config.ts) — shared config generation
- [Native Wire](https://github.com/ar27111994/agent-harness/blob/main/src/host-adapters/native-wire.ts) — wire-in infrastructure
- [V2 CLI Contract](https://github.com/ar27111994/agent-harness/blob/main/docs/guides/V2-CONTRACT.md) — host lifecycle model
- [Contributing Guide](https://github.com/ar27111994/agent-harness/blob/main/CONTRIBUTING.md) — contribution workflow
