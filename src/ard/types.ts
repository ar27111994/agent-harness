/**
 * Shared ARD (Agentic Resource Discovery) type mappings and constants.
 *
 * Centralises media-type mappings, trust-signal score boosts, publisher
 * metadata, and the public ARD 1.0 schema/version vocabulary used by both
 * export and registry import.
 */

import type { AssetKind, AuthorityTier, DemandProfile } from "../types.js";

/** Publisher FQDN for agent-harness ARD entries. */
export const ARD_PUBLISHER_FQDN = "ar27111994.dev";

/** Current public ARD manifest specVersion. */
export const ARD_SPEC_VERSION = "1.0" as const;

/** Canonical public ARD ai-catalog schema URI. */
export const ARD_SCHEMA_URI =
  "https://raw.githubusercontent.com/ards-project/ard-spec/main/spec/schemas/ai-catalog.schema.json";

/**
 * Returns the ARD publisher FQDN, respecting the environment override.
 */
export function getArdPublisherFqdn(): string {
  return (
    /* c8 ignore next */
    process.env.AGENT_HARNESS_ARD_PUBLISHER_FQDN?.trim() || ARD_PUBLISHER_FQDN
  );
}

/** Maps agent-harness AssetKind → ARD media type. */
export const ASSET_KIND_TO_ARD_TYPE: Record<AssetKind, string> = {
  "mcp-server": "application/mcp-server+json",
  agent: "application/a2a-agent-card+json",
  skill: "application/ai-skill",
  plugin: "application/ai-skill+json",
  "acp-agent": "application/a2a-agent-card+json",
  extension: "application/vscode-extension+json",
  "reference-pack": "application/ai-catalog+json",
  instruction: "application/ai-skill+md",
  workflow: "application/ai-skill+md",
  hook: "application/ai-skill+json",
  "prompt-pack": "application/ai-skill+md",
  "payable-api": "application/openapi+json",
};

/** Maps ARD media type → agent-harness AssetKind. */
export function ardTypeToAssetKind(ardType: string): AssetKind {
  const map: Record<string, AssetKind> = {
    "application/mcp-server+json": "mcp-server",
    "application/a2a-agent-card+json": "agent",
    "application/ai-skill": "skill",
    "application/ai-skill+md": "skill",
    "application/ai-skill+json": "skill",
    "application/ai-catalog+json": "reference-pack",
    "application/ai-registry+json": "reference-pack",
    "application/openapi+json": "payable-api",
    "application/vscode-extension+json": "extension",
  };
  return map[ardType] ?? "skill";
}

/** Known trust-signal names used in `AssetTrust.signals[]`. */
export const ARD_TRUST_SIGNALS = [
  "ard-identity-bound",
  "ard-compliance-attested",
  "ard-soc2",
  "ard-hipaa",
  "ard-signed",
] as const;

/** Union of the trust-signal identifiers recognized during ARD conversion. */
export type ArdTrustSignal = (typeof ARD_TRUST_SIGNALS)[number];

/**
 * Internal descriptive mapping for imported trust signals. These descriptions
 * are not emitted as ARD attestations: ARD 1.0 requires every attestation to
 * carry a verifiable URI and media type, which local trust flags cannot prove.
 */
export interface ArdSignalDescription {
  type: string;
  description: string;
}

/** Maps local trust-signal identifiers to internal attestation descriptions. */
export const TRUST_SIGNAL_TO_ATTESTATION: Record<string, ArdSignalDescription> =
  {
    "ard-identity-bound": {
      type: "Identity-Binding",
      description: "trustManifest.identity present",
    },
    "ard-compliance-attested": {
      type: "Compliance-Attested",
      description: "trustManifest.attestations[] non-empty",
    },
    "ard-soc2": {
      type: "SOC2-Type2",
      description: "SOC2 Type 2 compliance attestation",
    },
    "ard-hipaa": {
      type: "HIPAA-Audit",
      description: "HIPAA compliance audit attestation",
    },
    "ard-signed": {
      type: "JWS-Signature",
      description: "trustManifest carries a detached JWS signature",
    },
    "oms-signed": {
      type: "OMS-Code-Signature",
      description: "Asset is OMS-signed via skill.oms.sig",
    },
    "oms-trust-anchor": {
      type: "OMS-Trust-Anchor",
      description: "Repository contains nv-agent-root-cert.pem trust anchor",
    },
    "publisher-verified": {
      type: "Publisher-Verified",
      description: "Publisher identity verified by the source registry",
    },
  };

/** Per-signal trust-score boosts applied during catalog entry construction. */
export const TRUST_SIGNAL_SCORE_BOOST: Record<string, number> = {
  "oms-signed": 5,
  "oms-trust-anchor": 3,
  "publisher-verified": 2,
  "ard-identity-bound": 4,
  "ard-compliance-attested": 3,
  "ard-soc2": 3,
  "ard-hipaa": 3,
  "ard-signed": 5,
};

const OFFICIAL_FIRST_PARTY_DOMAINS = new Set([
  "google.com",
  "microsoft.com",
  "github.com",
  "openai.com",
  "anthropic.com",
  "huggingface.co",
  "nvidia.com",
  "salesforce.com",
  "cisco.com",
  "databricks.com",
  "snowflake.com",
  "servicenow.com",
  "godaddy.com",
]);

/**
 * Infers an authority tier from an ARD publisher FQDN. The current identifier
 * grammar is `urn:air:<publisher>:<namespace>:<name>`; callers pass only the
 * publisher segment here, so the authority policy itself is scheme-agnostic.
 */
export function inferAuthorityTierFromArdUrn(
  publisherFqdn: string,
): AuthorityTier {
  if (OFFICIAL_FIRST_PARTY_DOMAINS.has(publisherFqdn.toLowerCase())) {
    return "official-first-party";
  }
  if (
    publisherFqdn.endsWith(".github.io") ||
    publisherFqdn.endsWith(".gitlab.io")
  ) {
    return "trusted-community";
  }
  return "unverified-community";
}

/** Builds a natural-language ARD search query from workspace demand signals. */
export function buildArdQueryText(
  demandProfile?: DemandProfile | null,
): string {
  const parts: string[] = [];

  if (demandProfile) {
    const langs = demandProfile.signals.languages.slice(0, 2);
    const pms = demandProfile.signals.packageManagers.slice(0, 2);
    const fws = demandProfile.signals.frameworks.slice(0, 2);
    const concerns = demandProfile.signals.concerns.slice(0, 2);

    if (langs.length) parts.push(langs.join(" "));
    if (pms.length) parts.push(pms.join(" "));
    if (fws.length) parts.push(fws.join(" "));
    if (concerns.length) parts.push(concerns.join(" "));
  }

  if (parts.length === 0) {
    return "agent skills MCP tools AI coding assistants";
  }

  return `${parts.join(" ")} agent skills MCP tools`;
}
