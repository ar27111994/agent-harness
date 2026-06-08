# Security Policy

## Supported versions

Security fixes are currently targeted at the latest stable `2.x` release line on `main`.

| Version                                | Supported |
| -------------------------------------- | --------- |
| `2.x`                                  | Yes       |
| `1.x`                                  | No        |
| `0.x`                                  | No        |
| older prereleases / abandoned branches | No        |

If you are unsure whether an issue affects a supported build, report it anyway and include the exact package version, tag, or commit SHA you tested.

## What to report here

Please use this policy for vulnerabilities such as:

- sandbox or path-traversal escapes
- unsafe remote fetch / SSRF / DNS pinning bypasses
- quarantine or trust-policy bypasses
- credential, token, or secret exposure caused by the harness
- unintended execution of untrusted content
- release / packaging / supply-chain integrity issues

The source-sync module defends against SSRF through a layered model: (1) an origin allowlist derived from checked-in source definitions that restricts outbound fetch to declared hostnames, and (2) an independent HTTP guard backstop that rejects private-IP, loopback, link-local, and bare-IP-literal targets regardless of the allowlist. Both layers must be preserved in any refactor or extension of source-sync. A bypass of either layer — for example, a way to inject an arbitrary hostname into the allowlist, or to circumvent the private-IP backstop through DNS rebinding — is a security vulnerability. See [`TRUST-CENTER.md`](./docs/guides/TRUST-CENTER.md#source-sync-origin-allowlist-and-ssrf-backstop) for a full description of the boundary.

For general bugs, feature requests, recommendation quality issues, or host-integration quirks, please use the normal GitHub issue tracker instead of a private security report.

## How to report a vulnerability

Please **do not open a public GitHub issue** for a suspected security vulnerability.

Use one of these private channels instead:

1. **Preferred:** GitHub Security Advisories / private vulnerability reporting for this repository.
2. **Fallback:** email `admin@ar27111994.dev` with the subject line `agent-harness security report`.

Please include as much of the following as you can:

- affected version(s), tag(s), or commit SHA(s)
- a short description of the impact
- reproduction steps or a proof of concept
- whether the issue requires special configuration, credentials, or a malicious workspace/source
- any suggested fix or mitigation
- whether you believe the issue is already publicly known

If logs or artifacts contain tokens, secrets, or private repository details, redact them before sending.

## Response expectations

Best effort targets:

- initial acknowledgment within **3 business days**
- triage / severity assessment within **7 business days**
- status update after confirmation, mitigation, or rejection

These are goals, not guarantees, but reports will be handled as quickly as possible.

## Disclosure guidance

Please allow time for investigation and a fix before public disclosure.

Once a report is confirmed and a patch or mitigation is available, coordinated disclosure is welcome. If the report turns out not to be a security issue, it may be redirected to the normal issue tracker.
