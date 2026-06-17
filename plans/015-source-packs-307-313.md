# Plan 015 — Source pack entries for #307/#308/#309/#310/#311/#313

## Tickets addressed

- **#307** — `gemini-cli-extensions` org (66 official Google repos)
- **#308** — `gemini-cli-extensions/sre` (SRE skill pack, 67★)
- **#309** — `gemini-cli-extensions/data-agent-kit-starter-pack` (11 MCP toolbox servers, 108★)
- **#310** — `NVIDIA/skills` official signed catalog
- **#311** — `payable-api` AssetKind + `solana-foundation/pay-skills` registry
- **#313** — `gemini-cli-extensions/conductor` (3,600★ planning/orchestration plugin)

## What changed

### `src/types/core.ts`

Added `"payable-api"` to the `AssetKind` union type.

### `src/manifest-validation/primitives.ts`

Added `"payable-api"` to the `ASSET_KINDS` constant array.

### `src/host-adapters/opencode.ts`

Added `"payable-api"` to the exhaustive `OPENCODE_DIRECTORY_BY_ASSET_KIND`
record so the TypeScript compiler continues to enforce total coverage of all
asset kinds.

### `discover/source-packs/official.json`

Six new entries added:

| id                                          | Ticket | Priority | Publisher         |
| ------------------------------------------- | ------ | -------- | ----------------- |
| `gemini-cli-extensions-pack`                | #307   | 95       | Google            |
| `gemini-cli-extensions-sre-pack`            | #308   | 93       | Google            |
| `gemini-cli-extensions-data-agent-kit-pack` | #309   | 93       | Google            |
| `nvidia-skills-pack`                        | #310   | 94       | NVIDIA            |
| `solana-foundation-pay-skills-pack`         | #311   | 88       | Solana Foundation |
| `gemini-cli-extensions-conductor-pack`      | #313   | 97       | Google            |

Conductor (3,600★) receives the highest priority (97) in the pack to ensure it
surfaces first for any workspace compatible with planning/orchestration tooling.

## Validation

- `node ./scripts/build.mjs` — clean
- `discover-source-cap.test.js` + `catalog-selection.test.js` — 33/33 pass
- `npx eslint src/types/core.ts src/manifest-validation/primitives.ts src/host-adapters/opencode.ts` — 0 warnings/errors
- `node -e "require('node:fs').readFileSync('discover/source-packs/official.json'); console.log('JSON valid')"` — JSON valid
