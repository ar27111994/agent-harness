# Coverage 100% Roadmap

Issue: [#207](https://github.com/ar27111994/agent-harness/issues/207)

## Current status

`npm run validate:coverage` now builds the project, runs the coverage-gated test suite, and regenerates the gap ledger for the intended covered runtime surface. The latest verified local Windows run reports:

- statements: `100%` (`37621/37621`)
- branches: `100%` (`6861/6861`)
- functions: `100%` (`1121/1121`)
- lines: `100%` (`37621/37621`)
- tests: `681/681` passing

The generated gap ledger is empty: `coverage/coverage-gaps.md` has no uncovered line, function, or branch rows. The checked-in `.c8rc.json` gate is now ratcheted to `100` for statements, branches, functions, and lines. This was reached through source simplification for confirmed dead branches and behavioral coverage for reachable runtime paths, not by broadening runtime exclusions.

## Maintained target

The staged ratchet is complete for the currently covered runtime surface:

1. **Completed: `>=99.5%` across statements, branches, functions, and lines.** This floor was used as the first safe release ratchet once real coverage supported it.
2. **Completed: `>=99.9%` across all four metrics.** The final residual pass made this intermediate target unnecessary as a long-lived gate.
3. **Current gate: `100%` statements, branches, functions, and lines.** Keep this gate unless the covered runtime surface changes in a deliberate, documented way.

Future work should preserve the 100% gate by adding real behavioral tests for new reachable paths, removing genuinely dead defensive branches, or documenting only narrow dispatch/generated exclusions when a file is outside the intended runtime surface.

## Reproducible gap inventory

After running coverage, generate the exact uncovered line/function/branch ledger with:

```bash
npm run test:coverage
npm run coverage:gaps
```

For the normal coverage gate, use:

```bash
npm run validate:coverage
```

`npm run validate:coverage` builds the project, runs `npm run test:coverage`, and refreshes `coverage/coverage-gaps.md` from `coverage/lcov.info` in one command.

The generated gap file is intentionally ignored with the rest of the coverage output. A clean report should keep only the table header and no uncovered rows.

## Exclusion policy

Current `.c8rc.json` exclusions are limited to:

- generated test/type files under `dist/tests/**` and `dist/types/**`
- top-level compiled CLI entrypoints under `dist/*.js` that only dispatch into tested modules

Do not add runtime module exclusions to make the percentage green. If a future file appears impossible to cover cleanly, first classify it as:

1. legitimate dead code to remove,
2. a testability gap requiring dependency injection/refactor,
3. missing regression coverage, or
4. generated/dispatch-only code that belongs in `.c8rc.json` with a documented reason.

## Completion checklist for closing #207

- `npm run coverage:gaps` reports no uncovered lines, functions, or branches for the intended covered runtime surface.
- `.c8rc.json` thresholds are `100` for statements, branches, functions, and lines.
- Any excluded file is dispatch-only/generated or test/type output, not runtime logic masked to improve percentages.
- `npm run validate:coverage` passes locally and in CI.
- `npm run validate:release` passes after the threshold change.
