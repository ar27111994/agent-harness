# Terminal demo`n`nFor the full v2 before/after walkthrough, expected artifacts, and quarantine/security talking points, see [`v2-opencode-walkthrough.md`](./v2-opencode-walkthrough.md).

Issue #232 tracks adding a short public terminal demo near the README hero. The repo keeps this reproducible script so the recording can be regenerated without exposing a private workstation.

## Recording contract

The demo must use a throwaway workspace with no secrets, no `.env`, no private paths, and no personal project names. Record the installed-package path rather than repository-local shortcuts:

```bash
agent-harness workspace opencode --intent general
```

The final recording should show:

1. the command being run from a clean demo workspace
2. major lifecycle phases completing
3. the final workspace summary
4. a compact directory glance at generated `.agent-harness/` state and project-local OpenCode files
5. no tokens, private filesystem paths, host config roots, or unrelated local files

## Regenerate locally

From the repository root after `npm install` and `npm run build`:

```bash
node docs/demo/workspace-opencode-demo.mjs
```

The script creates a public-safe `.tmp/demo-workspace-opencode-*` workspace, prints the exact quick-start command transcript to record, verifies the built CLI can still enumerate host adapters, and prints the important generated-output tree. It intentionally uses deterministic fixture outputs for the recording source so GIF regeneration is not coupled to live registry/GitHub rate limits. Before publishing the final GIF/video, run the real quick-start command in the same throwaway workspace shape and compare the generated output paths shown here. If the rendered GIF/video is too large for git, upload it as a release asset and link it from the README while keeping this source script committed.
