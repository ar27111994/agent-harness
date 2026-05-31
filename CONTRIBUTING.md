# Contributing to agent-harness

Thanks for contributing to `agent-harness`.

## Scope

This repository manages a curated asset supply chain for OpenCode, GitHub Copilot in VS Code, Cursor, Zed, Claude Code, Pi, and future host adapters. Changes should preserve the lifecycle boundary between:

1. Discover
2. Mirror
3. Install
4. Activate
5. Wire

## Before you start

- read [`README.md`](./README.md) for the current commands and lifecycle
- review [`IMPLEMENTATION-PLAN.md`](./docs/reference/IMPLEMENTATION-PLAN.md) for architecture intent
- check [`FUTURE-IMPROVEMENTS.md`](./docs/reference/FUTURE-IMPROVEMENTS.md) if your change touches roadmap items

## Development setup

Requirements:

- Node.js 22+
- npm

Install dependencies:

```bash
npm install
```

Build and validate:

```bash
npm run build
npm run check
```

## Contribution guidelines

### Keep phases separate

Do not collapse discovery, mirroring, installation, and activation into one opaque workflow. If a change touches multiple phases, keep responsibilities explicit.

### Prefer official sources

If an official source exists, it should outrank a more popular unofficial source.

### Preserve deterministic outputs

When changing mirror, install, or activation behavior:

- preserve pinned outputs where possible
- avoid hidden side effects
- keep generated state explainable

### Keep activation narrower than installation

Changes to recommendation or activation logic should continue to respect context-budget limits.

### Avoid unsupported promises

If a host workflow is not implemented yet, document it clearly instead of implying full support.

## Documentation expectations

Update documentation when you change:

- commands
- lifecycle behavior
- bundle rules
- host wire-in behavior
- contribution or release workflow

At minimum, update `README.md` when public usage changes.

## Filing issues

Use the templates in [`.github/ISSUE_TEMPLATE/`](./.github/ISSUE_TEMPLATE/).

Suggested categories:

- bug report
- feature request

## Pull requests

Use [`.github/pull_request_template.md`](./.github/pull_request_template.md).

Recommended PR checklist:

- keep the change focused
- explain why the change is needed
- list the commands used for validation
- call out lifecycle, trust, or activation impacts if relevant

## Release expectations

Before tagging or cutting a release:

- ensure docs reflect the current behavior
- ensure validation passes
- make sure any new repo metadata or templates are committed first
