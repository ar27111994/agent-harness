# Terminal demo

The published product demo video is live on YouTube: **[youtu.be/u1OmcS97iOg](https://youtu.be/u1OmcS97iOg)** (Remotion source: [`agent-harness-demo-video`](https://github.com/ar27111994/agent-harness-demo-video)). The README hero uses a committed crossfaded GIF from the demo-video repo as the autoplaying silent preview and links that preview to the sound-on YouTube walkthrough.

For the full v2 before/after walkthrough, expected artifacts, and quarantine/security talking points, see [`v2-opencode-walkthrough.md`](./v2-opencode-walkthrough.md).

Issue #232 tracks adding a short public terminal demo near the README hero. The repo keeps this reproducible script so the recording can be regenerated without exposing a private workstation.

## Recording contract

The demo must use a throwaway workspace with no secrets, no `.env`, no private paths, and no personal project names. Record the installed-package path rather than repository-local shortcuts:

```bash
agent-harness workspace opencode --intent general
```

The final README preview should be a crossfaded, muted, looping GIF generated in the demo-video repo with `npm run render:readme-preview`. It should stay outside this package so npm tarballs remain lean.

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

The script creates a public-safe `.tmp/demo-workspace-opencode-*` workspace, prints the exact quick-start command transcript to record, verifies the built CLI can still enumerate host adapters, and prints the important generated-output tree. It intentionally uses deterministic fixture outputs for the recording source so GIF regeneration is not coupled to live registry/GitHub rate limits. Before publishing the final GIF/video, run the real quick-start command in the same throwaway workspace shape and compare the generated output paths shown here. Keep rendered video outputs in the demo-video repo or external hosting; do not commit demo binaries to this package.
