import { listHostAdapters } from "../host-adapters/registry.js";
import type { InstallRefreshReport } from "../types.js";

/**
 * Describes a normalized actionable diagnostic for user-facing failures.
 */
export interface ActionableDiagnostic {
  title: string;
  summary: string;
  why?: string;
  nextCommands?: string[];
  reportPaths?: string[];
  policyBlock?: boolean;
}

/**
 * Formats an actionable diagnostic with stable labels for CLI output/tests.
 */
export function formatActionableDiagnostic(
  diagnostic: ActionableDiagnostic,
): string {
  const lines = [diagnostic.title, `What happened: ${diagnostic.summary}`];

  if (diagnostic.why) {
    lines.push(`Why it matters: ${diagnostic.why}`);
  }

  if (diagnostic.policyBlock) {
    lines.push("Block type: policy/review gate, not a runtime crash.");
  }

  if (diagnostic.reportPaths?.length) {
    lines.push("Reports to inspect:");
    for (const reportPath of diagnostic.reportPaths) {
      lines.push(`  - ${reportPath}`);
    }
  }

  if (diagnostic.nextCommands?.length) {
    lines.push("Next commands:");
    for (const command of diagnostic.nextCommands) {
      lines.push(`  - ${command}`);
    }
  }

  return lines.join("\n");
}

/**
 * Builds an actionable diagnostic for unknown host adapter input.
 */
export function unknownHostDiagnostic(hostName: string): ActionableDiagnostic {
  const supportedHosts = listHostAdapters()
    .flatMap((adapter) => [adapter.id, ...adapter.aliases])
    .sort((left, right) => left.localeCompare(right));

  return {
    title: "Unsupported host adapter",
    summary: `'${hostName}' is not a registered host target or alias.`,
    why: "The harness cannot choose lifecycle paths, recommendation policy, or wire behavior for an unknown host.",
    nextCommands: [
      "agent-harness setup hosts",
      `agent-harness wire <${supportedHosts.join("|")}> --preview`,
    ],
  };
}

/**
 * Builds an actionable diagnostic for unsupported native install requests.
 */
export function unsupportedNativeInstallDiagnostic(options: {
  displayName: string;
  hostId: string;
}): ActionableDiagnostic {
  return {
    title: "Unsupported native install capability",
    summary: `${options.displayName} does not expose a native install/verify/remove provider in agent-harness.`,
    why: "This is a capability boundary: project-local wire preview/apply may still be supported, but native/global host installs are intentionally explicit and adapter-specific.",
    nextCommands: [
      `agent-harness wire ${options.hostId} --preview`,
      "agent-harness setup hosts",
    ],
    reportPaths: [
      "docs/guides/TRUST-CENTER.md",
      "README.md#v2-host-support-matrix",
    ],
    policyBlock: true,
  };
}

/**
 * Builds an actionable diagnostic for native install plans with no selected assets.
 */
export function noNativeInstallAssetsDiagnostic(options: {
  displayName: string;
  assetKind: string;
  hostId: string;
}): ActionableDiagnostic {
  return {
    title: "No native-install assets selected",
    summary: `No selected ${options.assetKind} assets are ready for native install on ${options.displayName}.`,
    why: "Native installs operate only on assets that passed discovery, recommendation, mirror, stage, and activation for the adapter's lifecycle host.",
    nextCommands: [
      `agent-harness workspace ${options.hostId} --intent general`,
      `agent-harness install native --host ${options.hostId} --operation plan`,
    ],
    reportPaths: [
      "state/recommendations.json",
      "activate/<host>/activation-manifest.json",
      "activate/<host>/workspace-profile-manifest.json",
    ],
  };
}

/**
 * Builds an actionable diagnostic when refresh/apply is blocked by policy.
 */
export function installRefreshPolicyDiagnostic(
  report: InstallRefreshReport,
): ActionableDiagnostic | null {
  const reviewCount = report.hosts.reduce(
    (count, host) => count + host.reviewRequiredCount,
    0,
  );
  const quarantinedCount = report.hosts.reduce(
    (count, host) => count + host.quarantinedCount,
    0,
  );
  const blockedCount = report.hosts.reduce(
    (count, host) => count + host.blockedCount,
    0,
  );

  if (reviewCount + quarantinedCount + blockedCount === 0) {
    return null;
  }

  return {
    title: "Install refresh blocked by review policy",
    summary: `${reviewCount} asset(s) require review, ${quarantinedCount} asset(s) are quarantined, and ${blockedCount} asset(s) are blocked.`,
    why: "Refresh policy blocks unsafe or ambiguous assets from being staged, activated, or wired automatically.",
    nextCommands: [
      "agent-harness quarantine list",
      "agent-harness quarantine inspect --asset <asset-id>",
      "agent-harness install refresh --host <host>",
    ],
    reportPaths: [
      "state/install/refresh-report.json",
      "state/quarantine/quarantine-state.json",
      "state/quarantine/reviews.jsonl",
    ],
    policyBlock: true,
  };
}
