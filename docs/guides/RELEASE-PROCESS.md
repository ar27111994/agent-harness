# Release Process

This is the v2 release checklist for `@ar27111994/agent-harness`. It is intentionally boring: validate everything, inspect the packed npm artifact, smoke-test the package as a consumer, then publish with trusted provenance from GitHub Actions.

## Preconditions

- Work is merged to the release branch/main branch intended for the tag.
- `CHANGELOG.md` has a curated entry for the exact version.
- `package.json` and `package-lock.json` versions match.
- Release notes mention upgrade guidance, known limitations, host support boundaries, and trust/quarantine behavior when relevant.
- No local `.env`, generated state, private config, tarballs, logs, or workspace overlays are staged.

### Regenerate ARD catalog

Before publishing, `.well-known/ai-catalog.json` must be regenerated from the selected catalog. The checked-in file is a static skeleton — shipping it as-is would publish an empty catalog.

```bash
# Build a selected catalog first (or use an existing one)
agent-harness discover select

# Regenerate the ARD catalog from discover/output/catalog.selected.jsonl
agent-harness discover ard-export

# Validate the result
node -e "
  const c = require('./.well-known/ai-catalog.json');
  if (!c.entries || !c.entries.length) {
    console.error('FAIL: ARD catalog is empty — release blocked.');
    process.exit(1);
  }
  console.log('OK: %d entries', c.entries.length);
"
```

If `entries` is empty, the release must **fail** — publishing an empty ARD 1.0 catalog violates the release contract. The regeneration step must run against a populated catalog before tagging and publishing.

## Local release candidate gate

Run from the repository root:

```bash
npm ci
npm run validate:release
```

`validate:release` includes:

- version synchronization
- build
- coverage-backed quality validation
- self-hosting validation
- scan/policy/recommendation quality checks
- CLI smoke test
- workspace smoke test
- packed package smoke test
- package contents audit
- consumer install smoke from the packed tarball

For a faster preflight while editing release metadata, run:

```bash
npm run validate
npm run build
npm run release:package-audit
npm run release:package-smoke
npm publish --dry-run --ignore-scripts --access public --tag latest
```

Use `--tag next` instead of `latest` for prerelease versions containing `-`.

## Package contents audit

The package audit is implemented in `scripts/package-audit.mjs` and wired as:

```bash
npm run release:package-audit
```

It runs `npm pack --dry-run --json --ignore-scripts` and fails if required runtime/docs files are missing or if forbidden paths are included. Required v2 files include:

- `dist/cli.js`
- `dist/cli.d.ts`
- `README.md`
- `CHANGELOG.md`
- `V1-TO-V2-UPGRADE.md`
- `V2-CONTRACT.md`
- `TRUST-CENTER.md`
- `QUARANTINE-PLAYBOOK.md`
- `HARNESS-MAINTENANCE-GUIDE.md`
- discovery policy/source assets
- mirror policy assets

Forbidden classes include source files, scripts, CI internals, generated lifecycle state, host overlays, `.env` files, logs, tarballs, coverage, and `.tmp` output.

## Consumer smoke test

The consumer smoke is implemented in `scripts/package-audit.mjs smoke` and wired as:

```bash
npm run release:package-smoke
```

It creates a temporary workspace, packs the package, installs the tarball with `--ignore-scripts`, and executes the installed CLI:

```bash
agent-harness --no-dotenv --state-root <temp-state> setup hosts
```

This catches missing `files` entries, missing built JS/type artifacts, broken package exports, and CLI startup regressions from the packed artifact rather than the repository checkout.

## GitHub Actions release workflow

`.github/workflows/release.yml` runs on `workflow_dispatch` and `v*.*.*` tags.

Release checks run on Ubuntu, macOS, and Windows:

1. install pinned Node/npm
2. install dependencies with `npm ci`
3. verify tag version matches `package.json` on tag runs
4. compute npm dist-tag (`latest` for stable, `next` for prerelease)
5. detect already-published package versions for rerun safety
6. run `npm run validate:release`
7. run `npm audit --omit=dev`
8. run package audit
9. run packed package smoke on Ubuntu
10. run `npm publish --dry-run --ignore-scripts --access public --tag <dist-tag>` on Ubuntu

The publish job runs only on release tags. It publishes through npm trusted publishing with provenance:

```bash
unset NODE_AUTH_TOKEN
npm publish --ignore-scripts --access public --tag <dist-tag> --provenance
```

Do not add `publishConfig.provenance` to `package.json`; provenance must stay CI-only so local pack/publish dry-runs do not fail outside GitHub Actions.

## GitHub release notes

`scripts/sync-github-release.mjs` creates or updates the GitHub Release after publish. It combines:

1. curated notes from `CHANGELOG.md` for the exact version
2. GitHub-generated release notes from the release API

The changelog entry must exist before tagging. Release notes should include:

- v1 to v2 upgrade guidance or link to `V1-TO-V2-UPGRADE.md`
- host support matrix and known limitations or link to README
- security/trust/quarantine changes or link to `TRUST-CENTER.md`
- package/CLI breaking changes, if any
- smoke-test or validation caveats, if any

## Tagging

After the local gate passes and the changelog is ready:

```bash
git status --short
npm version <version> --no-git-tag-version
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore(release): prepare v<version>"
git tag v<version>
npm run check:version-sync
git push origin <branch>
git push origin v<version>
```

`check:version-sync` runs a tag-vs-manifest guard (#467): the manifest version must **not regress** at or below the highest released git tag unless it has a matching tag of its own. A **forward bump** — the manifest ahead of the latest released tag with no matching tag yet — is the normal pre-release state and passes, because the release workflow creates the `v<version>` tag on main when the release is cut. The guard therefore fails only on a genuine regression or re-tag (e.g. publishing `2.0.0` when `v2.0.0` already exists on main with no matching new tag). A `v`-prefix is required for the guard to treat a tag as a release tag, and prerelease tags (`vX.Y.Z-*`) never stand in as the "latest released" version. On a shallow CI checkout with no tags fetched, the guard is skipped; the workflows fetch full history (`fetch-depth: 0`) so releases are verified. Running the check after `git tag v<version>` (as in the block above) additionally confirms the freshly created tag is recognized before pushing.

If `npm version` is not used, update both `package.json` and `package-lock.json` manually and keep `npm run check:version-sync` green.

## Reruns and failure handling

- If the package version is already published, workflow-dispatch checks should skip duplicate publish dry-run/publish paths where configured.
- If package audit fails, fix `package.json#files` or remove the forbidden generated artifact.
- If package smoke fails, inspect the temp install failure and the package `files` list before changing runtime code.
- If trusted publishing fails, verify npm package trusted-publisher settings and GitHub `id-token: write` permission.
- If GitHub Release sync fails after npm publish, rerun the `github-release` job or run `npm run release:github` with `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_REF_NAME`, and `GITHUB_SHA` set.
