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

## Security patterns — do not copy

Some internal implementations use security-sensitive patterns that are **not safe to replicate** without a separate security review. Before copying any of the patterns below into a new feature, read the linked rationale and request a review.

### The `getAllowedOrigins` / self-derived allowlist pattern (source-sync only)

`src/domains/discovery/source-sync.ts` derives an HTTP origin allowlist at request time from checked-in source definitions. This pattern is safe in that specific context because:

- The input URLs come exclusively from the checked-in source registry (not user input at runtime).
- The shared HTTP guard layer enforces an independent SSRF backstop that rejects private-IP, loopback, link-local, and bare-IP targets regardless of the allowlist.
- The scope is intentionally limited to batch registry/docs fetches under a single domain context.

**Do not reuse this pattern for:** custom webhook URLs, user-supplied proxy endpoints, OAuth callback URLs, third-party redirect targets, or any URL that originates from runtime user input or untrusted external data. Those cases require a separately-reviewed allowlist, a stricter URL validation layer, or routing through the public-hostname guard without a caller-supplied allowlist.

If you are unsure whether your feature's URL handling is in scope for this pattern, open an issue before submitting a PR.

For the full technical description of the boundary, see [`docs/guides/TRUST-CENTER.md`](./docs/guides/TRUST-CENTER.md#source-sync-origin-allowlist-and-ssrf-backstop).

### The `no-magic-numbers` ESLint rule

Large modules in `eslint.config.mjs` under `magicThresholdFiles` are required to extract named constants for all numeric literals. If you add a new module to that list, all existing magic numbers in the file must be extracted before the PR can merge — do not batch-suppress with `// eslint-disable`. Named constants must be `const` declarations placed near the function or at the top of the file, with names that explain the meaning of the value (e.g. `PROFILE_ID_MAX_LENGTH` rather than `MAX_96`).

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
