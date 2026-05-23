# Quarantine Review Playbook

Quarantine is a lifecycle state, not a one-time failure. Assets can become safer, riskier, stale, superseded, or newly executable as upstreams change.

## Lifecycle states

- `quarantined` — blocked from install/activation until reviewed.
- `approved-with-warning` — reviewer accepted the asset, but reports preserve warning/evidence history.
- `pinned` review decision — keep the current quarantine outcome stable until a reviewer changes it.
- `rejected` review decision — keep the asset quarantined with explicit evidence.

## Review commands

```bash
agent-harness quarantine list
agent-harness quarantine inspect --asset <asset-id>
agent-harness quarantine report
agent-harness quarantine approve --asset <asset-id> --reason "reviewed source and content"
agent-harness quarantine reject --asset <asset-id> --reason "unsafe prompt or executable behavior"
agent-harness quarantine pin --asset <asset-id> --reason "keep blocked until upstream ownership is verified"
```

`quarantine report` writes `state/quarantine/quarantine-state.json` with current state, reason, first seen time, last reviewed time, suggested action, source evidence, and transition history.

## Transition scenarios

Review before changing quarantine state when any of these occur:

- new risky asset discovered
- previously safe asset gains executable behavior
- upstream ownership or publisher verification changes
- prompt-injection-like content appears or disappears
- quarantined asset receives a safer update
- installed asset becomes risky on refresh
- duplicate official asset supersedes community asset
- reviewer approves, rejects, or pins a prior decision

## Safe handling rules

- Refresh/update workflows must treat `quarantined` as `blocked-quarantined`.
- A safer update may be staged only after review; it must not auto-activate.
- Approval records must include the source URL, publisher evidence, previous/next state, content hash, and reason.
- Rejections and pins remain visible in `reviews.jsonl` and `quarantine-state.json`.
- Prefer official duplicates over community assets, but do not silently promote trust tiers.

## Review checklist

1. Inspect source identity and publisher verification.
2. Compare installed and latest content hashes/fingerprints.
3. Check for hooks, install scripts, MCP servers, plugins, extensions, network behavior, and prompt-injection-like instructions.
4. Check whether an official duplicate supersedes the community asset.
5. Approve only if the risk is understood and acceptable; otherwise reject or pin.
