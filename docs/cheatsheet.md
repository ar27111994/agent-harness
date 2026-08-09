# CLI Cheat Sheet

Quick reference for common `agent-harness` workflows. All commands assume the
CLI is installed and on `PATH`. Use `agent-harness --help` for the full command
tree.

## Core Pipeline

```bash
# Full discover → wire pipeline for a host
agent-harness workspace opencode --intent general

# Step-by-step (recommended for first use)
agent-harness discover full                    # Scan workspace, sync sources, select catalog
agent-harness recommend report --host opencode # Score and rank recommendations
agent-harness mirror plan                      # Plan mirror acquisition
agent-harness mirror acquire                   # Download and pin assets
agent-harness install bundle --host opencode   # Stage into lifecycle stores
agent-harness install refresh                  # Sync staged assets with mirrors
agent-harness activate host --host opencode    # Build host runtime views
agent-harness wire opencode --preview          # Preview wire plan (safe)
agent-harness wire opencode --apply            # Apply wire plan to workspace
```

## Discovery

```bash
agent-harness discover demand-profile          # Scan workspace for demand signals
agent-harness discover sources                 # Refresh the discovery source index
agent-harness discover sync                    # Harvest source data (network)
agent-harness discover sync --full              # Run full sync (bypass cached index)
agent-harness discover full --no-sync           # Run pipeline skipping source sync
agent-harness discover full --sync-all          # Sync all sources (skip demand filtering)
agent-harness discover catalog                 # Build full asset catalog
agent-harness discover select                  # Filter catalog by demand + policy
agent-harness discover full                    # Run full pipeline (demand → select)
agent-harness discover breadth                 # Breadth pass: demand → catalog → bottleneck assessment
agent-harness discover index                   # Build full paginated catalog index (500 pages/source default)
agent-harness discover recall                  # Recall-focused candidate review pass
agent-harness discover candidate-pool          # Inspect the candidate queue
agent-harness discover stats                   # Catalog statistics summary
agent-harness discover diff                    # Diff discovery outputs across runs
agent-harness discover inspect                 # Inspect catalog entries and provenance
agent-harness discover environment-index       # Environment index (workspace/toolchain snapshot)
agent-harness discover enrich                  # AI enrichment pass (optional)
agent-harness discover ard-export              # Export to ARD ai-catalog.json
```

## Recommendations

```bash
agent-harness recommend report --host <host>   # Scored recommendations for host
agent-harness recommend evaluate               # Evaluate recommendation quality
agent-harness recommend explain --asset <id>   # Why an asset was selected/rejected
```

## Mirror

```bash
agent-harness mirror plan                      # Preview mirror plan
agent-harness mirror acquire                   # Download selected assets
agent-harness mirror diff                      # Compare local vs remote mirrors
agent-harness mirror locks                     # Generate bundle lock files
agent-harness mirror explain --asset <id>      # Mirror provenance for an asset
```

## Install & Activate

```bash
agent-harness install bundle --host <host>     # Stage assets into lifecycle stores
agent-harness install refresh                  # Refresh staged assets from mirrors
agent-harness install reconcile                # Reconcile staged vs expected state
agent-harness install reset                    # Reset install state
agent-harness activate host --host <host>      # Build host-specific runtime views
agent-harness activate reset                   # Reset activation state
```

## Wire (Host Integration)

```bash
agent-harness wire opencode --preview          # Preview OpenCode wire plan
agent-harness wire opencode --apply            # Apply OpenCode wire plan
agent-harness wire cursor --preview            # Preview Cursor wire plan
agent-harness wire cursor --apply              # Apply Cursor wire plan
agent-harness wire zed --preview               # Preview Zed wire plan
agent-harness wire zed --apply                 # Apply Zed wire plan
agent-harness wire claude-code --preview       # Preview Claude Code wire plan
agent-harness wire claude-code --apply         # Apply Claude Code wire plan
agent-harness wire pi --preview                # Preview Pi wire plan
agent-harness wire pi --apply                  # Apply Pi wire plan
agent-harness wire codex --preview             # Preview Codex wire plan
agent-harness wire codex --apply               # Apply Codex wire plan
```

## Setup & Diagnostics

```bash
agent-harness setup hosts                      # List registered host adapters
agent-harness setup doctor                     # Check host CLI availability
agent-harness setup doctor --host <host>       # Check specific host readiness
agent-harness setup login                      # Interactive host login
```

## Rebuild & Maintenance

```bash
agent-harness rebuild clean                    # Clean generated state
agent-harness rebuild full                     # Full rebuild from sources
agent-harness quarantine list                  # List quarantined mirror artifacts
agent-harness quarantine approve --asset <id>  # Approve with warning
agent-harness quarantine reject --asset <id>   # Reject while keeping quarantine
agent-harness quarantine pin --asset <id>      # Pin a quarantine decision
agent-harness bundle explain <bundleId>        # Explain bundle lock contents
```

## Workspace (One-Shot)

```bash
agent-harness workspace vscode                 # Full pipeline for VS Code/Copilot
agent-harness workspace opencode               # Full pipeline for OpenCode
agent-harness workspace cursor                 # Full pipeline for Cursor
agent-harness workspace zed                    # Full pipeline for Zed
agent-harness workspace claude-code            # Full pipeline for Claude Code
agent-harness workspace pi                     # Full pipeline for Pi
agent-harness workspace codex                  # Full pipeline for Codex
```

## Common Flags

```bash
--state-root <path>       # Override state directory (default: .agent-harness)
--timeout-seconds <n>     # Deadline in seconds for long operations (10–3600)
--intent <intent>         # Workspace intent hint (general, frontend, backend, etc.)
--host <host>             # Target host (vscode, opencode, cursor, zed, claude-code, pi, codex)
--preview                 # Preview without applying changes
--apply                   # Apply changes to workspace
--no-dotenv               # Skip .env file loading
--quiet                   # Suppress non-critical output
--summary                 # Aggregate summary instead of per-item output
```

## Key Environment Variables

```bash
AGENT_HARNESS_STATE_ROOT=.agent-harness        # State directory
GITHUB_TOKEN=<token>                           # GitHub API token (5,000 req/h)
AGENT_HARNESS_DEBUG=false                      # Enable debug output
AGENT_HARNESS_SCAN_MAX_FILES=20000             # Max files to scan
AGENT_HARNESS_SCAN_MAX_DEPTH=14                # Max directory depth
AGENT_HARNESS_SOURCE_SYNC_MAX_PAGES_FOR_INDEX_BUILD=500  # Pages per source in index build
AGENT_HARNESS_MAX_ENTRIES_PER_SOURCE=200       # Max catalog entries per source
AGENT_HARNESS_DISCOVERY_INDEX_MAX_AGE_DAYS=7   # Index freshness threshold
AGENT_HARNESS_TIMEOUT_SECONDS=120              # Deadline for long operations (10–3600)
```

## Quick Troubleshooting

| Symptom                                    | Check                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `setup doctor` host not found              | Host CLI on PATH? Run `setup hosts` to list adapters                                                                     |
| Empty recommendations                      | Run `discover full` first; check `demand-profile.json`                                                                   |
| `install refresh` ENOENT                   | Run `mirror acquire` first to populate bundles                                                                           |
| Slow first `discover full`                 | Demand-based filtering narrows sync to relevant ecosystem sources; use `--sync-all` for full sync or `--no-sync` to skip |
| Windows git-bash path error (`C:\\c\\...`) | MSYS paths are auto-normalised; if issues persist use native Windows paths or `cygpath -w`                               |
| `recommend explain` no output              | Asset may be rejected; check `selection-report.json`                                                                     |

## See Also

- [Troubleshooting Guide](guides/TROUBLESHOOTING.md)
- [v2 Safe Defaults](guides/SAFE-DEFAULTS.md)
- [v2 CLI and Report Contract](guides/V2-CONTRACT.md)
- [Security and Trust Center](guides/TRUST-CENTER.md)
- [Release Process](guides/RELEASE-PROCESS.md)
- [Full README](../README.md)
